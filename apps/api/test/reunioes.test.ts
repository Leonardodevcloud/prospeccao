import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarPool, migrar, type Pool } from '@prospeccao/db';
import { bancoDeTeste } from '@prospeccao/db/teste';
import type {
  Armazenamento,
  AvisoGravacao,
  AvisoVideo,
  EstadoDaSala,
  ServicoVideo,
} from '@prospeccao/integrations/reuniao';
import { criarLogger, type ResumoReuniao } from '@prospeccao/shared';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { criarApp } from '../src/app.js';
import { comLink } from '../src/modulos/agenda/lembretes.js';
import { rodarAcompanhamento, rodarProcessamento } from '../src/modulos/reunioes/processar.js';
import {
  assinarArquivo,
  conferirArquivo,
  emitirCredencial,
  lerCredencial,
} from '../src/modulos/reunioes/servico.js';
import type { ServicosConta } from '../src/servicos.js';

const URL_TESTE = process.env.TEST_DATABASE_URL;
const ORIGEM = 'http://localhost:5173';
const SEGREDO = 'y'.repeat(40);

describe('reuniões: peças sem banco', () => {
  it('põe o link da reunião no lembrete do lead', () => {
    expect(comLink('Até amanhã!', 'https://app.x/r/abcd-efgh')).toBe(
      'Até amanhã!\n\nLink para entrar: https://app.x/r/abcd-efgh',
    );
    expect(comLink('Entre por {link} até lá', 'https://meet.google.com/x')).toBe(
      'Entre por https://meet.google.com/x até lá',
    );
    // Endereço de visita não é link.
    expect(comLink('Até amanhã!', 'Rua A, 10')).toBe('Até amanhã!');
  });

  it('credencial da sala e link de arquivo assinados (e vencidos não valem)', () => {
    const c = {
      salaId: 3,
      contaId: 1,
      participanteId: '0f0e0d0c-0b0a-4908-8706-050403020100',
      identidade: 'c-0f0e0d0c0b0a4908',
      nome: 'Carlos',
      papel: 'convidado' as const,
    };
    expect(lerCredencial(emitirCredencial(c, SEGREDO), SEGREDO)).toEqual(c);
    expect(lerCredencial(emitirCredencial(c, SEGREDO), 'outro'.repeat(10))).toBeNull();
    expect(lerCredencial('lixo', SEGREDO)).toBeNull();
    const t = assinarArquivo(9, SEGREDO, Date.UTC(2026, 9, 30));
    expect(conferirArquivo(9, t, SEGREDO, Date.UTC(2026, 9, 30, 10))).toBe(true);
    expect(conferirArquivo(10, t, SEGREDO, Date.UTC(2026, 9, 30, 10))).toBe(false);
    expect(conferirArquivo(9, t, SEGREDO, Date.UTC(2026, 9, 31, 10))).toBe(false);
  });
});

/** LiveKit de mentira: guarda o que foi pedido; os avisos chegam como JSON com a assinatura "ok". */
function videoFalso() {
  const chamadas = {
    salas: [] as string[],
    gravacoesSala: [] as { sala: string; chave: string }[],
    audios: [] as { sala: string; trilhaId: string; chave: string }[],
    enviados: [] as { sala: string; topico: string; dados: unknown }[],
    maos: [] as string[],
    encerradas: [] as string[],
    /** O que o LiveKit responde quando a api confere a sala (sem webhook). */
    estados: new Map<string, EstadoDaSala>(),
    situacoes: new Map<string, AvisoGravacao>(),
  };
  let n = 0;
  const video: ServicoVideo = {
    urlCliente: 'wss://teste.livekit.cloud',
    gravaArquivos: true,
    async acesso(p) {
      return `token:${p.sala}:${p.identidade}:${p.atributos?.papel}`;
    },
    async abrirSala(p) {
      chamadas.salas.push(p.sala);
    },
    async gravarSala(p) {
      chamadas.gravacoesSala.push(p);
      return `EG_sala_${++n}`;
    },
    async gravarAudio(p) {
      chamadas.audios.push(p);
      return `EG_audio_${++n}`;
    },
    async enviar(sala, topico, dados) {
      chamadas.enviados.push({ sala, topico, dados });
    },
    async silenciar() {
      return true;
    },
    async baixarMao(_sala, identidade) {
      chamadas.maos.push(identidade);
    },
    async remover() {},
    async encerrar(sala) {
      chamadas.encerradas.push(sala);
    },
    async presentes() {
      return [];
    },
    async estado(sala) {
      return chamadas.estados.get(sala) ?? null;
    },
    async gravacao(id) {
      return chamadas.situacoes.get(id) ?? null;
    },
    async lerAviso(corpo, autorizacao) {
      if (autorizacao !== 'ok') throw new Error('assinatura');
      return JSON.parse(corpo, (k, v) =>
        ['em', 'inicio', 'fim'].includes(k) && typeof v === 'string' ? new Date(v) : v,
      ) as AvisoVideo;
    },
    async testar() {
      return 'ok';
    },
  };
  return { video, chamadas };
}

/** Bucket de mentira na memória (guarda os pedaços e monta os envios em partes). */
const arquivos = new Map<string, Uint8Array>();
const emPartes = new Map<string, Map<number, Uint8Array>>();
const armazenamentoFalso: Armazenamento = {
  destino: { endpoint: 'https://arm', regiao: 'auto', bucket: 'b', chave: 'k', segredo: 's'.repeat(10) },
  async urlAssinada(chave, o) {
    return `https://arm/b/${chave}${o?.baixarComo ? '?baixar' : ''}`;
  },
  async apagar(chaves) {
    for (const k of chaves) arquivos.delete(k);
  },
  async testar() {
    return 'ok';
  },
  async enviar(chave, corpo) {
    arquivos.set(chave, new Uint8Array(corpo));
  },
  async ler(chave) {
    const a = arquivos.get(chave);
    if (!a) throw new Error(`sem ${chave}`);
    return a;
  },
  async iniciarEmPartes(chave) {
    emPartes.set(chave, new Map());
    return `envio-${chave}`;
  },
  async enviarParte(chave, _id, numero, corpo) {
    emPartes.get(chave)!.set(numero, new Uint8Array(corpo));
    return `"etag-${numero}"`;
  },
  async concluirEmPartes(chave, _id, partes) {
    const p = emPartes.get(chave)!;
    arquivos.set(chave, Buffer.concat(partes.map((x) => p.get(x.numero)!)));
  },
  async cancelarEmPartes(chave) {
    emPartes.delete(chave);
  },
};

const RESUMO: ResumoReuniao = {
  resumo: 'Carlos quer terceirizar as entregas a partir de dezembro.',
  interesse: 'alto',
  destaques: [{ tipo: 'volume', texto: '~600 pedidos/mês', segundo: 5 }],
  proximosPassos: [{ texto: 'Mandar proposta de 6 meses', quem: 'Rafael', prazo: 'amanhã' }],
  momentos: [{ segundo: 5, titulo: 'Volume', tipo: 'outro' }],
  sugestaoEtapa: 'proposta',
  motivoSugestao: 'Pediu proposta.',
};

describe.skipIf(!URL_TESTE)('reuniões por vídeo (com Postgres)', () => {
  let pool: Pool;
  let app: ReturnType<typeof criarApp>;
  let cookie = '';
  const { video, chamadas } = videoFalso();
  let entradaResumo: unknown = null;
  const servicos = async (contaId: number): Promise<ServicosConta> => ({
    contaId,
    whatsapp: null,
    ia: null,
    classificarEmail: null,
    personalizarAbertura: null,
    email: null,
    assistente: null,
    geocodificar: null,
    reuniao: {
      async resumir(e) {
        entradaResumo = e;
        return RESUMO;
      },
    },
    origem: { places: null, ors: null, resend: null, whatsapp: null, ia: null },
    iaDescricao: null,
    erro: null,
  });
  const reunioes = {
    video,
    armazenamento: armazenamentoFalso,
    transcricao: { baseUrl: 'https://api.groq.com/openai/v1', chave: 'gsk_teste', modelo: 'whisper' },
    // Os primeiros testes usam a gravação do LiveKit; o da gravação pelo navegador desliga.
    gravacaoNaNuvem: true,
  };
  const log = criarLogger('teste', (process.env.LOG_TESTE as 'error') ?? 'silent');

  const enviar = (
    metodo: 'post' | 'patch' | 'delete',
    rota: string,
    corpo?: object,
    extra: Record<string, string> = {},
  ) => {
    let r = request(app)[metodo](rota).set('Origin', ORIGEM);
    for (const [k, v] of Object.entries(extra)) r = r.set(k, v);
    return r.send(corpo);
  };
  const comCookie = (metodo: 'post' | 'patch' | 'delete', rota: string, corpo?: object) =>
    enviar(metodo, rota, corpo, { Cookie: cookie });
  const ler = (rota: string, extra: Record<string, string> = {}) => {
    let r = request(app).get(rota);
    for (const [k, v] of Object.entries(extra)) r = r.set(k, v);
    return r;
  };
  const aviso = (a: object) =>
    request(app)
      .post('/livekit')
      .set('Authorization', 'ok')
      .set('Content-Type', 'application/webhook+json')
      .send(JSON.stringify(a));

  beforeAll(async () => {
    pool = criarPool({
      url: await bancoDeTeste(URL_TESTE!, 'reunioes'),
      aplicacao: 'teste-reunioes',
      max: 4,
    });
    await migrar(pool, log);
    app = criarApp({
      pool,
      log,
      filas: {
        async publicar() {
          return 'job';
        },
        async publicarVarios(_n, p) {
          return p.length;
        },
        async cancelarPendentes() {
          return 0;
        },
        async tamanhos() {
          return {};
        },
      },
      auth: {
        jwtSegredo: SEGREDO,
        adminEmail: 'dona@exemplo.com',
        adminSenhaHash: await bcrypt.hash('senha-forte-123', 4),
        sessaoHoras: 1,
        cookieSeguro: false,
      },
      origens: [ORIGEM],
      servicos,
      credenciais: { chave: null, ambiente: {}, invalidar() {} },
      reunioes,
    });
    const ok = await request(app)
      .post('/auth/login')
      .set('Origin', ORIGEM)
      .send({ email: 'dona@exemplo.com', senha: 'senha-forte-123' });
    cookie = (ok.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    eu = (await request(app).get('/auth/eu').set('Cookie', cookie)).body.id;
    // Um lead no funil da conta principal.
    await pool.query(
      `INSERT INTO descoberta.empresas (id, nome, cidade, uf) VALUES (501, 'Autopeças Ladeira Nova', 'SALVADOR', 'BA')`,
    );
    await pool.query(
      `INSERT INTO comercial.oportunidades (conta_id, empresa_id, etapa) VALUES (1, 501, 'respondeu')`,
    );
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await pool?.end();
  });

  let eu = 0;
  let codigo = '';
  let tarefaId = 0;
  let sessaoId = 0;
  let credTime = '';
  let credConvidado = '';
  let convidado = { participanteId: '', segredo: '' };

  it('marca a reunião na sala do sistema: o link vira o local', async () => {
    const estado = await ler('/reunioes/estado', { Cookie: cookie });
    expect(estado.body).toEqual({ video: true, gravacao: true, transcricao: true });

    const r = await comCookie('post', '/agenda', {
      tipo: 'reuniao',
      titulo: 'Apresentação — Ladeira Nova',
      empresaId: 501,
      inicio: new Date(Date.now() + 2 * 3600_000).toISOString(),
      sala: { entrada: 'livre', gravar: true, transcrever: true, abreMinutosAntes: 10 },
    });
    expect(r.status).toBe(201);
    expect(r.body.sala).toMatchObject({
      status: 'marcada',
      entrada: 'livre',
      gravar: true,
      abreMinutosAntes: 10,
    });
    codigo = r.body.sala.codigo;
    tarefaId = r.body.id;
    expect(codigo).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(r.body.local).toBe(`${ORIGEM}/r/${codigo}`);
  });

  it('o convidado vê a sala, mas só entra a partir de 10 min antes', async () => {
    const info = await ler(`/salas/${codigo}`);
    expect(info.status).toBe(200);
    expect(info.body).toMatchObject({
      titulo: 'Apresentação — Ladeira Nova',
      situacao: 'antes',
      gravar: true,
      transcrever: true,
      voce: null,
      videoConfigurado: true,
      presentes: [],
    });
    const fechada = await enviar('post', `/salas/${codigo}/entrar`, {
      nome: 'Carlos Menezes',
      aceitouGravacao: true,
    });
    expect(fechada.status).toBe(409);
    expect(fechada.body.erro.codigo).toBe('sala_fechada');
    expect((await ler('/salas/zzzz-1111')).status).toBe(404);
  });

  it('quem é do time entra a qualquer hora, como anfitrião', async () => {
    expect((await ler(`/salas/${codigo}`, { Cookie: cookie })).body.voce).toMatchObject({ doTime: true });
    // Fundos da empresa só para quem é do time (o convidado usa só o desfoque e os cenários sem logo).
    expect((await ler(`/salas/${codigo}`, { Cookie: cookie })).body.fundos).toMatchObject({
      comLogo: false,
      logo: null,
      config: { simples: true, travar: false, padrao: null },
      fotos: [],
    });
    expect((await ler(`/salas/${codigo}`)).body.fundos).toBeNull();
    const r = await comCookie('post', `/salas/${codigo}/entrar`, { nome: 'ignorado' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      estado: 'liberado',
      papel: 'anfitriao',
      url: 'wss://teste.livekit.cloud',
      gravando: true,
    });
    expect(r.body.token).toMatch(/^token:pt-1-\d+-1:u-\d+:anfitriao$/);
    expect(chamadas.salas).toHaveLength(1);
    credTime = r.body.credencial;
    sessaoId = r.body.sessaoId;
    // Entrar de novo não abre outra sala.
    await comCookie('post', `/salas/${codigo}/entrar`, {});
    expect(chamadas.salas).toHaveLength(1);
  });

  it('a reunião remarcada para agora libera o convidado, que confirma o aviso de gravação', async () => {
    await comCookie('patch', `/agenda/${tarefaId}`, {
      inicio: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    const sem = await enviar('post', `/salas/${codigo}/entrar`, { nome: 'Carlos Menezes' });
    expect(sem.status).toBe(422);
    const r = await enviar('post', `/salas/${codigo}/entrar`, {
      nome: 'Carlos Menezes',
      aceitouGravacao: true,
    });
    expect(r.body).toMatchObject({ estado: 'liberado', papel: 'convidado', nome: 'Carlos Menezes' });
    credConvidado = r.body.credencial;
    convidado = { participanteId: r.body.participanteId, segredo: r.body.segredo };
    // Recarregou a página: a mesma identidade.
    const de_novo = await enviar('post', `/salas/${codigo}/entrar`, {
      nome: 'Carlos M.',
      aceitouGravacao: true,
      ...convidado,
    });
    expect(de_novo.body.participanteId).toBe(convidado.participanteId);
  });

  it('avisos do LiveKit: liga a gravação na primeira entrada e o áudio de cada microfone', async () => {
    const salaVideo = chamadas.salas[0]!;
    const { rows } = await pool.query<{ identidade: string }>(
      `SELECT identidade FROM comercial.sala_participantes WHERE id = $1`,
      [convidado.participanteId],
    );
    const idConvidado = rows[0]!.identidade;
    expect((await request(app).post('/livekit').set('Authorization', 'falso').send('{}')).status).toBe(401);

    const agora = Date.now();
    await aviso({
      tipo: 'entrou',
      id: 'a1',
      sala: salaVideo,
      identidade: `u-${eu}`,
      nome: 'Dona',
      em: new Date(agora),
    });
    await aviso({
      tipo: 'entrou',
      id: 'a2',
      sala: salaVideo,
      identidade: idConvidado,
      nome: 'Carlos',
      em: new Date(agora),
    });
    expect(chamadas.gravacoesSala).toHaveLength(1);
    expect(chamadas.gravacoesSala[0]!.chave).toMatch(/^conta-1\/sala-\d+\/sessao-\d+\/reuniao\.mp4$/);
    expect((await ler(`/salas/${codigo}`)).body.presentes.sort()).toEqual(['Carlos M.', 'dona'].sort());

    await aviso({
      tipo: 'microfone',
      id: 'a3',
      sala: salaVideo,
      identidade: idConvidado,
      nome: 'Carlos',
      trilhaId: 'TR_C',
      em: new Date(),
    });
    await aviso({
      tipo: 'microfone',
      id: 'a3',
      sala: salaVideo,
      identidade: idConvidado,
      nome: 'Carlos',
      trilhaId: 'TR_C',
      em: new Date(),
    });
    await aviso({
      tipo: 'microfone',
      id: 'a4',
      sala: salaVideo,
      identidade: `u-${eu}`,
      nome: 'Dona',
      trilhaId: 'TR_U',
      em: new Date(),
    });
    // Aviso repetido não grava duas vezes.
    expect(chamadas.audios.map((a) => a.trilhaId)).toEqual(['TR_C', 'TR_U']);

    const inicioSessao = new Date(agora - 10 * 60_000);
    await pool.query('UPDATE comercial.sala_sessoes SET iniciada_em = $2 WHERE id = $1', [
      sessaoId,
      inicioSessao,
    ]);
    const pronta = (id: string, chave: string, deslocamentoS: number) => ({
      tipo: 'gravacao',
      id: `g-${id}`,
      sala: salaVideo,
      gravacaoId: id,
      de: 'audio',
      trilhaId: null,
      situacao: 'pronta',
      inicio: new Date(inicioSessao.getTime() + deslocamentoS * 1000),
      arquivo: {
        chave,
        bytes: 1000,
        segundos: 60,
        inicio: new Date(inicioSessao.getTime() + deslocamentoS * 1000),
        fim: null,
      },
      erro: null,
      em: new Date(),
    });
    await aviso(pronta('EG_sala_1', chamadas.gravacoesSala[0]!.chave, 0));
    for (const [i, a] of chamadas.audios.entries())
      await aviso(pronta(`EG_audio_${i + 2}`, a.chave, a.trilhaId === 'TR_C' ? 30 : 0));
  });

  it('chat com arquivo: guarda, manda para a sala e o link do arquivo vence', async () => {
    const semCred = await enviar('post', `/salas/${codigo}/mensagens`, { texto: 'oi' });
    expect(semCred.status).toBe(401);
    const m = await enviar(
      'post',
      `/salas/${codigo}/mensagens`,
      { texto: 'Consegue mandar a tabela?' },
      {
        'x-credencial-sala': credConvidado,
      },
    );
    expect(m.status).toBe(201);
    expect(m.body).toMatchObject({
      autor: 'Carlos Menezes',
      texto: 'Consegue mandar a tabela?',
      arquivo: null,
    });
    expect(chamadas.enviados.at(-1)).toMatchObject({ topico: 'chat', dados: { tipo: 'mensagem' } });

    const pdf = Buffer.from('%PDF-1.4 proposta');
    const a = await enviar(
      'post',
      `/salas/${codigo}/arquivos`,
      { nome: 'Proposta.pdf', mime: 'application/pdf', base64: pdf.toString('base64'), texto: 'Segue' },
      { 'x-credencial-sala': credTime },
    );
    expect(a.status).toBe(201);
    expect(a.body.arquivo).toMatchObject({ nome: 'Proposta.pdf', tamanho: pdf.length });
    const baixado = await ler(a.body.arquivo.url.replace('/api', ''));
    expect(baixado.status).toBe(200);
    expect(baixado.headers['content-disposition']).toContain('Proposta.pdf');
    expect((await ler(`/salas/${codigo}/arquivos/${a.body.arquivo.id}?t=123.abc`)).status).toBe(401);

    const lista = await ler(`/salas/${codigo}/mensagens`, { 'x-credencial-sala': credConvidado });
    expect(lista.body.map((x: { texto: string }) => x.texto)).toEqual(['Consegue mandar a tabela?', 'Segue']);
  });

  it('moderação só para o time; sala de espera quando o anfitrião aprova cada pessoa', async () => {
    const naoPode = await enviar(
      'post',
      `/salas/${codigo}/silenciar-todos`,
      {},
      { 'x-credencial-sala': credConvidado },
    );
    expect(naoPode.status).toBe(403);
    const { rows } = await pool.query<{ identidade: string }>(
      `SELECT identidade FROM comercial.sala_participantes WHERE id = $1`,
      [convidado.participanteId],
    );
    const mao = await enviar(
      'post',
      `/salas/${codigo}/pessoas/${rows[0]!.identidade}/baixar-mao`,
      {},
      {
        'x-credencial-sala': credTime,
      },
    );
    expect(mao.status).toBe(200);
    expect(chamadas.maos).toEqual([rows[0]!.identidade]);

    const mudou = await comCookie('patch', `/agenda/${tarefaId}`, {
      sala: { entrada: 'aprovacao', gravar: true, transcrever: true, abreMinutosAntes: 10 },
    });
    expect(mudou.body.sala, JSON.stringify(mudou.body)).toMatchObject({ entrada: 'aprovacao' });
    const pedido = await enviar('post', `/salas/${codigo}/entrar`, {
      nome: 'Ana Souza',
      aceitouGravacao: true,
    });
    expect(pedido.body).toMatchObject({ estado: 'aguardando' });
    expect(chamadas.enviados.at(-1)).toMatchObject({
      topico: 'sala',
      dados: { tipo: 'espera', nome: 'Ana Souza' },
    });
    const pergunta = () =>
      ler(`/salas/${codigo}/espera/${pedido.body.participanteId}?segredo=${pedido.body.segredo}`);
    expect((await pergunta()).body.estado).toBe('aguardando');
    expect(
      (await ler(`/salas/${codigo}/espera/${pedido.body.participanteId}?segredo=${'x'.repeat(30)}`)).status,
    ).toBe(404);

    const espera = await ler(`/salas/${codigo}/espera`, { 'x-credencial-sala': credTime });
    expect(espera.body).toEqual([expect.objectContaining({ nome: 'Ana Souza' })]);
    await enviar(
      'post',
      `/salas/${codigo}/espera/${pedido.body.participanteId}`,
      { decisao: 'deixar_entrar' },
      {
        'x-credencial-sala': credTime,
      },
    );
    expect((await pergunta()).body).toMatchObject({ estado: 'liberado', nome: 'Ana Souza' });
  });

  it('encerrar para todos fecha o link para o convidado e registra no histórico do lead', async () => {
    const r = await enviar('post', `/salas/${codigo}/encerrar`, {}, { 'x-credencial-sala': credTime });
    expect(r.status).toBe(200);
    expect(chamadas.encerradas).toHaveLength(1);
    expect((await ler(`/salas/${codigo}`)).body.situacao).toBe('encerrada');
    const tarde = await enviar('post', `/salas/${codigo}/entrar`, { nome: 'Carlos', aceitouGravacao: true });
    expect(tarde.status).toBe(410);
    const { rows } = await pool.query(
      `SELECT texto FROM comercial.atividades WHERE empresa_id = 501 AND tipo = 'reuniao' ORDER BY id DESC LIMIT 1`,
    );
    expect(rows[0]?.texto).toMatch(/^Reunião por vídeo de \d+ min com .*Carlos M\..*\(gravada\)\.$/);
    const { rows: t } = await pool.query('SELECT concluida_em FROM comercial.tarefas WHERE id = $1', [
      tarefaId,
    ]);
    expect(t[0]?.concluida_em).not.toBeNull();
  });

  it('depois: transcreve cada pessoa, junta as falas, resume e mostra tudo na ficha', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const url = (init.body as FormData).get('url') as string;
        const deCarlos = url.includes('TR_C');
        return new Response(
          JSON.stringify({
            segments: deCarlos
              ? [{ start: 2, end: 5, text: 'Fazemos uns 600 pedidos por mês.' }]
              : [{ start: 1, end: 3, text: 'Bom dia, Carlos.' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );
    await pool.query('UPDATE comercial.sala_sessoes SET processar_em = now() WHERE id = $1', [sessaoId]);
    await rodarProcessamento({
      pool,
      log,
      servicos,
      reunioes,
      jwtSegredo: SEGREDO,
      aoEncerrar: () => undefined,
    });
    vi.unstubAllGlobals();

    const d = (await ler(`/reunioes/${sessaoId}`, { Cookie: cookie })).body;
    expect(d).toMatchObject({
      situacao: 'pronta',
      transcricao: 'pronta',
      temVideo: true,
      videoUrl: `/api/reunioes/${sessaoId}/video`,
      resumo: { resumo: RESUMO.resumo, sugestaoEtapa: 'proposta' },
      empresaNome: 'Autopeças Ladeira Nova',
    });
    expect(
      d.falas.map((f: { nome: string; inicioMs: number; texto: string }) => [f.nome, f.inicioMs, f.texto]),
    ).toEqual([
      ['Dona', 1000, 'Bom dia, Carlos.'],
      ['Carlos', 32_000, 'Fazemos uns 600 pedidos por mês.'],
    ]);
    expect(d.participantes.find((p: { tipo: string }) => p.tipo === 'convidado')?.parteDaFala).toBe(60);
    expect(d.mensagens).toHaveLength(2);
    expect(entradaResumo).toMatchObject({
      lead: 'Autopeças Ladeira Nova',
      titulo: 'Apresentação — Ladeira Nova',
    });

    const video302 = await ler(`/reunioes/${sessaoId}/video`, { Cookie: cookie });
    expect(video302.status).toBe(302);
    expect(video302.headers.location).toMatch(/^https:\/\/arm\/b\/conta-1\//);

    const lista = (await ler('/reunioes?quais=realizadas', { Cookie: cookie })).body;
    expect(lista[0]).toMatchObject({
      id: sessaoId,
      situacao: 'pronta',
      resumo: RESUMO.resumo,
      link: `${ORIGEM}/r/${codigo}`,
    });
    expect((await ler('/reunioes/lead/501', { Cookie: cookie })).body).toHaveLength(1);
    const { rows } = await pool.query(
      `SELECT texto FROM comercial.atividades WHERE empresa_id = 501 AND tipo = 'nota' ORDER BY id DESC LIMIT 1`,
    );
    expect(rows[0]?.texto).toBe(`Resumo da reunião: ${RESUMO.resumo}`);
  });

  it('próximos passos viram tarefas; quem é do time reabre a sala em outra sessão', async () => {
    const r = await comCookie('post', `/reunioes/${sessaoId}/tarefas`, {
      passos: [
        { texto: 'Mandar proposta de 6 meses', inicio: new Date(Date.now() + 86_400_000).toISOString() },
      ],
    });
    expect(r.body).toEqual({ criadas: 1 });
    const agenda = (await ler('/agenda/lead/501', { Cookie: cookie })).body;
    expect(agenda.some((t: { titulo: string }) => t.titulo === 'Mandar proposta de 6 meses')).toBe(true);

    const de_novo = await comCookie('post', `/salas/${codigo}/entrar`, {});
    expect(de_novo.body.estado, JSON.stringify(de_novo.body)).toBe('liberado');
    expect(de_novo.body.sessaoId).not.toBe(sessaoId);
    expect(chamadas.salas).toHaveLength(2);
    await enviar('post', `/salas/${codigo}/encerrar`, {}, { 'x-credencial-sala': de_novo.body.credencial });
  });

  it('sem o webhook: a api confere a sala, grava, conta quem entrou e saiu e acompanha a gravação', async () => {
    const r = await comCookie('post', '/agenda', {
      tipo: 'reuniao',
      titulo: 'Reunião rápida',
      inicio: new Date().toISOString(),
      sala: { entrada: 'livre', gravar: true, transcrever: true, abreMinutosAntes: 10 },
    });
    const cod = r.body.sala.codigo as string;
    const entrada = await comCookie('post', `/salas/${cod}/entrar`, {});
    const sala = chamadas.salas.at(-1)!;
    const salaCount = chamadas.gravacoesSala.length;
    const audioCount = chamadas.audios.length;
    const eu = `u-${(await ler('/auth/eu', { Cookie: cookie })).body.id}`;
    const rodar = () =>
      rodarAcompanhamento({
        pool,
        log,
        servicos,
        reunioes,
        jwtSegredo: SEGREDO,
        aoEncerrar: () => undefined,
      });

    chamadas.estados.set(sala, { pessoas: [{ identidade: eu, nome: 'Dona', microfones: ['TR_SEM_AVISO'] }] });
    await rodar();
    await rodar(); // a segunda conferência não grava de novo
    expect(chamadas.gravacoesSala.length).toBe(salaCount + 1);
    expect(chamadas.audios.length).toBe(audioCount + 1);
    expect(chamadas.audios.at(-1)).toMatchObject({ sala, trilhaId: 'TR_SEM_AVISO' });
    const presenca = async () =>
      (
        await pool.query<{ presente: boolean; entrou: boolean }>(
          `SELECT presente_desde IS NOT NULL AS presente, entrou_em IS NOT NULL AS entrou
             FROM comercial.sala_participantes WHERE identidade = $1 AND sala_id = (SELECT id FROM comercial.salas WHERE codigo = $2)`,
          [eu, cod],
        )
      ).rows[0];
    expect(await presenca()).toEqual({ presente: true, entrou: true });

    // A gravação terminou e o aviso não veio: a conferência pega o arquivo.
    const { rows } = await pool.query<{ gravacaoId: string }>(
      `SELECT gravacao_id AS "gravacaoId" FROM comercial.sala_gravacoes WHERE sessao_id = $1 AND tipo = 'sala'`,
      [entrada.body.sessaoId],
    );
    expect(rows[0]?.gravacaoId).toMatch(/^EG_sala_/);
    chamadas.situacoes.set(rows[0]!.gravacaoId, {
      tipo: 'gravacao',
      id: 'x',
      sala,
      gravacaoId: rows[0]!.gravacaoId,
      de: 'sala',
      trilhaId: null,
      situacao: 'pronta',
      inicio: new Date(),
      arquivo: { chave: 'v.mp4', bytes: 1000, segundos: 60, inicio: new Date(), fim: new Date() },
      erro: null,
      em: new Date(),
    });
    chamadas.estados.set(sala, { pessoas: [] });
    await rodar();
    expect(await presenca()).toEqual({ presente: false, entrou: true });
    const g = await pool.query<{ situacao: string; segundos: number }>(
      'SELECT situacao, segundos FROM comercial.sala_gravacoes WHERE gravacao_id = $1',
      [rows[0]!.gravacaoId],
    );
    expect(g.rows[0]).toEqual({ situacao: 'pronta', segundos: 60 });
    await enviar('post', `/salas/${cod}/encerrar`, {}, { 'x-credencial-sala': entrada.body.credencial });
  });

  it('gravação pelo navegador: só um do time grava, pedaços chegam, a api monta o vídeo e transcreve', async () => {
    reunioes.gravacaoNaNuvem = false;
    const temFfmpeg = (() => {
      try {
        execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    })();
    // Um vídeo de 3 s como o Chrome grava (H.264 + Opus em WebM/Matroska) e o áudio de uma pessoa.
    const pasta = mkdtempSync(join(tmpdir(), 'teste-gravacao-'));
    const gerar = (args: string[], nome: string) => {
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args, join(pasta, nome)]);
      return readFileSync(join(pasta, nome));
    };
    const videoBytes = temFfmpeg
      ? gerar(
          [
            '-f',
            'lavfi',
            '-i',
            'testsrc=size=320x240:rate=15',
            '-f',
            'lavfi',
            '-i',
            'sine=frequency=440',
            '-t',
            '3',
            '-c:v',
            'libx264',
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'libopus',
            '-f',
            'matroska',
          ],
          'video.webm',
        )
      : Buffer.from('video-sem-ffmpeg'.repeat(1000));
    const audioBytes = temFfmpeg
      ? gerar(
          ['-f', 'lavfi', '-i', 'sine=frequency=300', '-t', '3', '-c:a', 'libopus', '-f', 'webm'],
          'audio.webm',
        )
      : Buffer.from('audio-sem-ffmpeg'.repeat(100));

    const r = await comCookie('post', '/agenda', {
      tipo: 'reuniao',
      titulo: 'Reunião gravada no navegador',
      inicio: new Date().toISOString(),
      sala: { entrada: 'livre', gravar: true, transcrever: true, abreMinutosAntes: 10 },
    });
    const cod = r.body.sala.codigo as string;
    const entrada = await comCookie('post', `/salas/${cod}/entrar`, {});
    expect(entrada.body).toMatchObject({ gravacao: 'navegador', transcrever: true });
    const cred = { 'x-credencial-sala': entrada.body.credencial as string };
    const egressAntes = chamadas.gravacoesSala.length;

    const v = await enviar(
      'post',
      `/salas/${cod}/gravacoes`,
      { tipo: 'sala', mime: 'video/webm;codecs=h264,opus', desdeMs: 300 },
      cred,
    );
    expect(v.status, JSON.stringify(v.body)).toBe(201);
    const a = await enviar(
      'post',
      `/salas/${cod}/gravacoes`,
      {
        tipo: 'audio',
        identidade: 'c-abc123',
        nome: 'Carla Souza',
        trilhaId: 'TR_NAV',
        mime: 'audio/webm;codecs=opus',
      },
      cred,
    );
    expect(a.status).toBe(201);

    // Outra pessoa do time não grava junto; convidado não grava.
    const sala = await pool.query<{ id: number; conta_id: number }>(
      'SELECT id::int, conta_id FROM comercial.salas WHERE codigo = $1',
      [cod],
    );
    const outro = emitirCredencial(
      {
        salaId: sala.rows[0]!.id,
        contaId: sala.rows[0]!.conta_id,
        participanteId: '0f0e0d0c-0b0a-4908-8706-050403020101',
        identidade: 'u-999',
        nome: 'Bruno',
        papel: 'equipe',
      },
      SEGREDO,
    );
    const dupla = await enviar(
      'post',
      `/salas/${cod}/gravacoes`,
      { tipo: 'sala', mime: 'video/webm' },
      { 'x-credencial-sala': outro },
    );
    expect(dupla.status).toBe(409);
    expect(dupla.body.erro.codigo).toBe('outra_pessoa_gravando');
    const convidadoCred = emitirCredencial(
      {
        salaId: sala.rows[0]!.id,
        contaId: sala.rows[0]!.conta_id,
        participanteId: '0f0e0d0c-0b0a-4908-8706-050403020102',
        identidade: 'c-123',
        nome: 'Carla',
        papel: 'convidado',
      },
      SEGREDO,
    );
    expect(
      (
        await enviar(
          'post',
          `/salas/${cod}/gravacoes`,
          { tipo: 'sala', mime: 'video/webm' },
          { 'x-credencial-sala': convidadoCred },
        )
      ).status,
    ).toBe(403);

    // Pedaços na ordem (um repetido, como numa nova tentativa depois de falha de internet).
    const mandar = (id: string, bytes: Buffer, partes: number) => {
      const tam = Math.ceil(bytes.length / partes);
      return Array.from({ length: partes }, (_, n) => bytes.subarray(n * tam, (n + 1) * tam)).map((b, n) =>
        request(app)
          .put(`/salas/${cod}/gravacoes/${id}/pedacos/${n}`)
          .set('Origin', ORIGEM)
          .set('x-credencial-sala', cred['x-credencial-sala'])
          .set('Content-Type', 'application/octet-stream')
          .send(b),
      );
    };
    for (const p of mandar(v.body.id, videoBytes, 4)) expect((await p).status).toBe(200);
    for (const p of mandar(v.body.id, videoBytes, 4).slice(1, 2)) expect((await p).status).toBe(200);
    for (const p of mandar(a.body.id, audioBytes, 2)) expect((await p).status).toBe(200);
    // Pedaço da gravação de outra pessoa: recusado.
    expect(
      (
        await request(app)
          .put(`/salas/${cod}/gravacoes/${v.body.id}/pedacos/9`)
          .set('Origin', ORIGEM)
          .set('x-credencial-sala', outro)
          .set('Content-Type', 'application/octet-stream')
          .send(Buffer.from('x'))
      ).status,
    ).toBe(403);
    // O LiveKit não grava nada neste modo.
    expect(chamadas.gravacoesSala.length).toBe(egressAntes);

    await enviar('post', `/salas/${cod}/gravacoes/${v.body.id}/concluir`, { pedacos: 4 }, cred);
    await enviar('post', `/salas/${cod}/gravacoes/${a.body.id}/concluir`, { pedacos: 2 }, cred);
    await enviar('post', `/salas/${cod}/encerrar`, {}, cred);

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ segments: [{ start: 1, end: 2.5, text: 'Quero a proposta até sexta.' }] }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          ),
      ),
    );
    const sessao = entrada.body.sessaoId as number;
    await pool.query(
      `UPDATE comercial.sala_sessoes SET situacao = 'processando', processar_em = now(),
              encerrada_em = coalesce(encerrada_em, now()) WHERE id = $1`,
      [sessao],
    );
    await rodarProcessamento({
      pool,
      log,
      servicos,
      reunioes,
      jwtSegredo: SEGREDO,
      aoEncerrar: () => undefined,
    });
    vi.unstubAllGlobals();

    const g = await pool.query<{
      tipo: string;
      situacao: string;
      chave: string;
      segundos: number | null;
      erro: string | null;
    }>(
      `SELECT tipo, situacao, chave, segundos, erro FROM comercial.sala_gravacoes WHERE sessao_id = $1 ORDER BY id`,
      [sessao],
    );
    expect(g.rows.map((x) => [x.tipo, x.situacao, x.erro])).toEqual([
      ['sala', 'pronta', null],
      ['audio', 'pronta', null],
    ]);
    expect(g.rows[0]!.chave).toMatch(temFfmpeg ? /\.mp4$/ : /\.webm$/);
    if (temFfmpeg) expect(g.rows[0]!.segundos).toBe(3);
    // O arquivo final está no bucket e os pedaços foram apagados.
    expect(arquivos.has(g.rows[0]!.chave)).toBe(true);
    expect([...arquivos.keys()].some((k) => k.includes('/p/'))).toBe(false);
    if (temFfmpeg) {
      writeFileSync(join(pasta, 'final.mp4'), arquivos.get(g.rows[0]!.chave)!);
      const info = execFileSync('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_name',
        '-of',
        'csv=p=0',
        join(pasta, 'final.mp4'),
      ]).toString();
      expect(info).toContain('h264');
      expect(info).toContain('aac');
    }
    const s2 = await pool.query<{ video: string | null; transcricao: string; situacao: string }>(
      'SELECT video_chave AS video, transcricao, situacao FROM comercial.sala_sessoes WHERE id = $1',
      [sessao],
    );
    expect(s2.rows[0]).toEqual({ video: g.rows[0]!.chave, transcricao: 'pronta', situacao: 'pronta' });
    const falas = await pool.query<{ nome: string; texto: string }>(
      'SELECT nome, texto FROM comercial.sala_falas WHERE sessao_id = $1',
      [sessao],
    );
    expect(falas.rows).toEqual([{ nome: 'Carla Souza', texto: 'Quero a proposta até sexta.' }]);
    rmSync(pasta, { recursive: true, force: true });
    reunioes.gravacaoNaNuvem = true;
  });

  it('tirar a sala da reunião cancela o link', async () => {
    await comCookie('patch', `/agenda/${tarefaId}`, { sala: null, local: 'https://meet.google.com/abc' });
    const t = (await ler('/agenda/lead/501', { Cookie: cookie })).body.find(
      (x: { id: number }) => x.id === tarefaId,
    );
    expect(t.sala).toBeNull();
  });
});
