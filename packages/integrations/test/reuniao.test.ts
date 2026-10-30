import { createHash } from 'node:crypto';
import {
  AccessToken,
  EgressInfo,
  EgressStatus,
  TrackSource,
  TrackType,
  WebhookEvent,
} from 'livekit-server-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  codificarChave,
  criarArmazenamento,
  criarServicoVideo,
  juntarFalas,
  lerSegmentos,
  promptResumoReuniao,
  resumirReuniao,
  traduzirAviso,
  transcreverAudio,
  transcricaoParaIa,
  urlDaApi,
} from '../src/reuniao/index.js';

afterEach(() => vi.unstubAllGlobals());

/** Como o WebhookReceiver monta o aviso (o campo "event" é preenchido depois do construtor). */
const aviso = (d: ConstructorParameters<typeof WebhookEvent>[0] & { event: string }) =>
  Object.assign(new WebhookEvent(d), { event: d.event }) as WebhookEvent;

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });

describe('reuniões: armazenamento das gravações', () => {
  const arm = criarArmazenamento({
    endpoint: 'https://conta.r2.cloudflarestorage.com/',
    regiao: 'auto',
    bucket: 'gravacoes',
    chave: 'AKIDEXEMPLO',
    segredo: 'segredo-de-exemplo-com-tamanho-suficiente',
  });

  it('codifica cada parte do caminho e mantém as barras', () => {
    expect(codificarChave('conta-1/sala 2/ação.mp4')).toBe('conta-1/sala%202/a%C3%A7%C3%A3o.mp4');
  });

  it('gera link temporário assinado, no caminho do bucket', async () => {
    const url = new URL(
      await arm.urlAssinada('conta-1/reuniao.mp4', { segundos: 600, baixarComo: 'Reunião.mp4' }),
    );
    expect(url.origin).toBe('https://conta.r2.cloudflarestorage.com');
    expect(url.pathname).toBe('/gravacoes/conta-1/reuniao.mp4');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get('response-content-disposition')).toContain('attachment');
  });

  it('apaga um arquivo (404 é ignorado) e muitos de uma vez, em lote', async () => {
    const pedidos: { metodo: string; caminho: string; corpo: string; md5: string | null }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (req: Request) => {
        const u = new URL(req.url);
        pedidos.push({
          metodo: req.method,
          caminho: u.pathname + u.search,
          corpo: await req.text(),
          md5: req.headers.get('content-md5'),
        });
        return new Response(null, { status: req.url.includes('sumiu') ? 404 : 200 });
      }),
    );
    await arm.apagar(['a/sumiu.ogg']);
    expect(pedidos[0]).toMatchObject({ metodo: 'DELETE', caminho: '/gravacoes/a/sumiu.ogg' });
    pedidos.length = 0;
    await arm.apagar(['a/p/000000', 'a/p/000001', 'a/p/000000']);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]!.metodo).toBe('POST');
    expect(pedidos[0]!.caminho).toBe('/gravacoes?delete');
    expect(pedidos[0]!.corpo).toContain('<Key>a/p/000000</Key>');
    expect(pedidos[0]!.corpo).toContain('<Key>a/p/000001</Key>');
    expect(pedidos[0]!.md5).toMatch(/==$/);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('negado', { status: 403 })),
    );
    await expect(arm.apagar(['x'])).rejects.toThrow(/403/);
  });

  it('guarda pedaços e sobe arquivo grande em partes', async () => {
    const pedidos: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (req: Request) => {
        const u = new URL(req.url);
        pedidos.push(`${req.method} ${u.pathname}${u.search}`);
        if (u.searchParams.has('uploads'))
          return new Response(
            '<InitiateMultipartUploadResult><UploadId>UP1</UploadId></InitiateMultipartUploadResult>',
          );
        if (u.searchParams.has('partNumber')) return new Response(null, { headers: { etag: '"e1"' } });
        if (req.method === 'GET') return new Response(new Uint8Array([1, 2, 3]));
        return new Response('<CompleteMultipartUploadResult/>');
      }),
    );
    await arm.enviar('s/p/000001', new Uint8Array([9]));
    expect(await arm.ler('s/p/000001')).toEqual(new Uint8Array([1, 2, 3]));
    const id = await arm.iniciarEmPartes('s/final.mp4', 'video/mp4');
    expect(id).toBe('UP1');
    expect(await arm.enviarParte('s/final.mp4', id, 1, new Uint8Array(10))).toBe('"e1"');
    await arm.concluirEmPartes('s/final.mp4', id, [{ numero: 1, etag: '"e1"' }]);
    expect(pedidos).toEqual([
      'PUT /gravacoes/s/p/000001',
      'GET /gravacoes/s/p/000001',
      'POST /gravacoes/s/final.mp4?uploads',
      'PUT /gravacoes/s/final.mp4?partNumber=1&uploadId=UP1',
      'POST /gravacoes/s/final.mp4?uploadId=UP1',
    ]);
    // Erro dentro de um 200 (o S3 faz isso ao concluir) também é erro.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<Error><Code>InvalidPart</Code></Error>')),
    );
    await expect(arm.concluirEmPartes('s/final.mp4', id, [])).rejects.toThrow(/InvalidPart/);
  });
});

describe('reuniões: vídeo (LiveKit)', () => {
  it('troca wss por https para a API do servidor', () => {
    expect(urlDaApi('wss://meu.livekit.cloud/')).toBe('https://meu.livekit.cloud');
    expect(urlDaApi('ws://localhost:7880')).toBe('http://localhost:7880');
  });

  it('dá acesso só àquela sala, podendo levantar a mão', async () => {
    const video = criarServicoVideo({
      url: 'wss://meu.livekit.cloud',
      apiKey: 'APIchave',
      apiSecret: 'segredo-do-livekit-com-mais-de-32-caracteres',
    });
    expect(video.gravaArquivos).toBe(false);
    const jwt = await video.acesso({
      sala: 'pt-1-1',
      identidade: 'c-abc',
      nome: 'Carlos',
      atributos: { papel: 'convidado' },
    });
    const carga = JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString());
    expect(carga.sub).toBe('c-abc');
    expect(carga.name).toBe('Carlos');
    expect(carga.attributes).toEqual({ papel: 'convidado' });
    expect(carga.video).toMatchObject({ room: 'pt-1-1', roomJoin: true, canUpdateOwnMetadata: true });
    expect(carga.video.roomAdmin).toBeUndefined();
    expect(carga.exp - carga.nbf).toBeGreaterThan(11 * 3600);
  });

  it('confere a assinatura do aviso do LiveKit', async () => {
    const segredo = 'segredo-do-livekit-com-mais-de-32-caracteres';
    const video = criarServicoVideo({
      url: 'wss://meu.livekit.cloud',
      apiKey: 'APIchave',
      apiSecret: segredo,
    });
    const corpo = JSON.stringify({
      event: 'room_finished',
      id: 'ev9',
      createdAt: '1761800000',
      room: { name: 'pt-3-1' },
    });
    const t = new AccessToken('APIchave', segredo);
    t.sha256 = createHash('sha256').update(corpo).digest('base64');
    const assinatura = await t.toJwt();
    expect(await video.lerAviso(corpo, assinatura)).toEqual({
      tipo: 'sala_encerrada',
      id: 'ev9',
      sala: 'pt-3-1',
      em: new Date(1_761_800_000_000),
    });
    await expect(video.lerAviso(corpo.replace('pt-3-1', 'pt-9-9'), assinatura)).rejects.toThrow();
    await expect(video.lerAviso(corpo, undefined)).rejects.toThrow();
  });

  it('traduz os avisos: entrada, microfone e gravação pronta', () => {
    const entrou = traduzirAviso(
      aviso({
        event: 'participant_joined',
        id: 'ev1',
        createdAt: 1_761_800_000n,
        room: { name: 'pt-1-1' },
        participant: { identity: 'u-5', name: 'Rafael' },
      }),
    );
    expect(entrou).toEqual({
      tipo: 'entrou',
      id: 'ev1',
      sala: 'pt-1-1',
      identidade: 'u-5',
      nome: 'Rafael',
      em: new Date(1_761_800_000_000),
    });

    const mic = traduzirAviso(
      aviso({
        event: 'track_published',
        id: 'ev2',
        room: { name: 'pt-1-1' },
        participant: { identity: 'c-1', name: 'Carlos' },
        track: { sid: 'TR_1', type: TrackType.AUDIO, source: TrackSource.MICROPHONE },
      }),
    );
    expect(mic).toMatchObject({ tipo: 'microfone', trilhaId: 'TR_1', identidade: 'c-1' });

    const tela = traduzirAviso(
      aviso({
        event: 'track_published',
        id: 'ev3',
        room: { name: 'pt-1-1' },
        track: { sid: 'TR_2', type: TrackType.VIDEO, source: TrackSource.SCREEN_SHARE },
      }),
    );
    expect(tela.tipo).toBe('outro');

    const pronta = traduzirAviso(
      aviso({
        event: 'egress_ended',
        id: 'ev4',
        egressInfo: new EgressInfo({
          egressId: 'EG_1',
          roomName: 'pt-1-1',
          status: EgressStatus.EGRESS_COMPLETE,
          startedAt: 1_761_800_000_000_000_000n,
          request: { case: 'track', value: { roomName: 'pt-1-1', trackId: 'TR_1' } },
          fileResults: [
            {
              filename: 'conta-1/sala-1/sessao-1/audio-c-1.ogg',
              size: 1_234_567n,
              duration: 61_500_000_000n,
              startedAt: 1_761_800_002_000_000_000n,
            },
          ],
        }),
      }),
    );
    expect(pronta).toMatchObject({
      tipo: 'gravacao',
      gravacaoId: 'EG_1',
      de: 'audio',
      trilhaId: 'TR_1',
      situacao: 'pronta',
      arquivo: {
        chave: 'conta-1/sala-1/sessao-1/audio-c-1.ogg',
        bytes: 1_234_567,
        segundos: 62,
        inicio: new Date(1_761_800_002_000),
      },
    });

    const falhou = traduzirAviso(
      aviso({
        event: 'egress_ended',
        id: 'ev5',
        egressInfo: new EgressInfo({
          egressId: 'EG_2',
          roomName: 'pt-1-1',
          status: EgressStatus.EGRESS_FAILED,
          error: 'sem permissão no bucket',
        }),
      }),
    );
    expect(falhou).toMatchObject({
      situacao: 'falhou',
      de: 'sala',
      arquivo: null,
      erro: 'sem permissão no bucket',
    });
  });
});

describe('reuniões: transcrição', () => {
  it('tira o que o Whisper inventa no silêncio', () => {
    expect(
      lerSegmentos([
        { start: 0, end: 2.4, text: ' Bom dia, pessoal. ', no_speech_prob: 0.01, avg_logprob: -0.2 },
        { start: 3, end: 5, text: 'Legendas pela comunidade Amara.org', no_speech_prob: 0.1 },
        { start: 6, end: 8, text: 'hmm', no_speech_prob: 0.9, avg_logprob: -1.1 },
        { start: 9, end: 30, text: 'sim sim sim sim', compression_ratio: 3.4 },
        { start: 31.25, end: 33, text: 'Quanto custa?' },
      ]),
    ).toEqual([
      { inicioMs: 0, fimMs: 2400, texto: 'Bom dia, pessoal.' },
      { inicioMs: 31250, fimMs: 33000, texto: 'Quanto custa?' },
    ]);
  });

  it('junta as falas de todos pela hora e emenda as da mesma pessoa', () => {
    const falas = juntarFalas([
      {
        identidade: 'u-1',
        nome: 'Rafael',
        deslocamentoMs: 0,
        trechos: [
          { inicioMs: 1000, fimMs: 3000, texto: 'Bom dia.' },
          { inicioMs: 3500, fimMs: 5000, texto: 'Vamos começar?' },
          { inicioMs: 20_000, fimMs: 22_000, texto: 'Nessa faixa fica R$ 8,40.' },
        ],
      },
      {
        // O microfone do Carlos começou a gravar 10 s depois do início da sessão.
        identidade: 'c-1',
        nome: 'Carlos',
        deslocamentoMs: 10_000,
        trechos: [{ inicioMs: 1000, fimMs: 4000, texto: 'Fazemos uns 600 pedidos por mês.' }],
      },
    ]);
    expect(falas).toEqual([
      { identidade: 'u-1', nome: 'Rafael', inicioMs: 1000, fimMs: 5000, texto: 'Bom dia. Vamos começar?' },
      {
        identidade: 'c-1',
        nome: 'Carlos',
        inicioMs: 11_000,
        fimMs: 14_000,
        texto: 'Fazemos uns 600 pedidos por mês.',
      },
      {
        identidade: 'u-1',
        nome: 'Rafael',
        inicioMs: 20_000,
        fimMs: 22_000,
        texto: 'Nessa faixa fica R$ 8,40.',
      },
    ]);
  });

  it('manda o link do áudio para a Groq (sem baixar o arquivo)', async () => {
    let corpo: FormData | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        corpo = init.body as FormData;
        return json({ segments: [{ start: 1, end: 2, text: 'Oi' }] });
      }),
    );
    const r = await transcreverAudio(
      { baseUrl: 'https://api.groq.com/openai/v1', chave: 'gsk_x', modelo: 'whisper-large-v3-turbo' },
      'https://r2.exemplo/audio.ogg?assinado=1',
    );
    expect(r).toEqual([{ inicioMs: 1000, fimMs: 2000, texto: 'Oi' }]);
    expect(corpo!.get('url')).toBe('https://r2.exemplo/audio.ogg?assinado=1');
    expect(corpo!.get('file')).toBeNull();
    expect(corpo!.get('response_format')).toBe('verbose_json');
    expect(corpo!.get('language')).toBe('pt');
  });
});

describe('reuniões: resumo da IA', () => {
  const entrada = {
    empresa: 'Nova Rota',
    lead: 'Autopeças Ladeira Nova',
    etapa: 'Reunião',
    titulo: 'Apresentação',
    duracaoSegundos: 3120,
    participantes: [
      { nome: 'Rafael Lima', doTime: true },
      { nome: 'Carlos Menezes', doTime: false },
    ],
    falas: [
      { segundo: 631, nome: 'Carlos Menezes', texto: 'Fazemos uns 600 pedidos por mês.' },
      { segundo: 1575, nome: 'Carlos Menezes', texto: 'Contrato de 12 meses não dá.' },
    ],
    chat: ['Rafael Lima: Segue a proposta.'],
  };

  it('monta a transcrição com o minuto de cada fala e corta o meio se for longa', () => {
    expect(transcricaoParaIa(entrada.falas)).toBe(
      '[10:31] Carlos Menezes: Fazemos uns 600 pedidos por mês.\n[26:15] Carlos Menezes: Contrato de 12 meses não dá.',
    );
    const muitas = Array.from({ length: 400 }, (_, i) => ({
      segundo: i * 10,
      nome: 'A',
      texto: 'x'.repeat(80),
    }));
    const cortada = transcricaoParaIa(muitas, 5000);
    expect(cortada.length).toBeLessThan(5200);
    expect(cortada).toContain('trecho do meio cortado');
    expect(cortada.startsWith('[0:00] A:')).toBe(true);
  });

  it('pede só o que foi dito e mostra quem é do time', () => {
    const p = promptResumoReuniao(entrada);
    expect(p).toContain('Não invente');
    expect(p).toContain('Do time (Nova Rota): Rafael Lima');
    expect(p).toContain('Convidados: Carlos Menezes');
    expect(p).toContain('Chat da sala:');
  });

  it('valida a resposta e descarta marcação fora da reunião', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  resumo: 'Carlos quer terceirizar as entregas.',
                  interesse: 'altíssimo',
                  destaques: [
                    { tipo: 'volume', texto: '~600 pedidos/mês', segundo: 631 },
                    { tipo: 'objecao', texto: 'Não quer 12 meses', segundo: 99_999 },
                  ],
                  proximosPassos: [{ texto: 'Mandar proposta de 6 meses', quem: 'Rafael', prazo: 'amanhã' }],
                  momentos: [
                    { segundo: 1575, titulo: 'Objeção do prazo', tipo: 'objecao' },
                    { segundo: 9000, titulo: 'Fora', tipo: 'outro' },
                  ],
                  sugestaoEtapa: 'proposta',
                  motivoSugestao: 'Ficou de mandar proposta.',
                }),
              },
            },
          ],
        }),
      ),
    );
    const r = await resumirReuniao({ provedor: 'deepseek', apiKey: 'sk', modelo: 'deepseek-flash' }, entrada);
    expect(r).toMatchObject({
      resumo: 'Carlos quer terceirizar as entregas.',
      interesse: 'indefinido',
      destaques: [
        { tipo: 'volume', segundo: 631 },
        { tipo: 'objecao', segundo: null },
      ],
      proximosPassos: [{ texto: 'Mandar proposta de 6 meses', quem: 'Rafael', prazo: 'amanhã' }],
      momentos: [{ segundo: 1575, titulo: 'Objeção do prazo', tipo: 'objecao' }],
      sugestaoEtapa: 'proposta',
    });
  });
});
