import { createHmac } from 'node:crypto';
import { criarPool, migrar, type Pool } from '@prospeccao/db';
import { bancoDeTeste } from '@prospeccao/db/teste';
import type { Armazenamento } from '@prospeccao/integrations/reuniao';
import { criarLogger } from '@prospeccao/shared';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../src/app.js';
import { type ClienteMeta, clienteMeta, type PublicacaoMeta } from '../src/modulos/instagram/meta.js';
import { reconhecerPostsDosCarrosseis } from '../src/modulos/instagram/servico.js';
import type { ServicosConta } from '../src/servicos.js';

const URL_TESTE = process.env.TEST_DATABASE_URL;
const ORIGEM = 'http://localhost:5173';
const SEGREDO = 's'.repeat(32);
const IG = '17841400000000009';
const PAGINA = '100000000000009';

const TEXTO =
  'Freio chiando de manhã não é frescura: é a pastilha avisando. Veja o que fazer antes que vire disco riscado.\n\nComente FREIO que a gente te manda o checklist no direct.';

const arquivos = new Map<string, Uint8Array>();
const armazenamento = {
  destino: { endpoint: 'https://arm', regiao: 'auto', bucket: 'b', chave: 'k', segredo: 's'.repeat(10) },
  async urlAssinada(chave: string) {
    return `https://arm/b/${chave}`;
  },
  async apagar(chaves: string[]) {
    for (const k of chaves) arquivos.delete(k);
  },
  async enviar(chave: string, corpo: Uint8Array) {
    arquivos.set(chave, new Uint8Array(corpo));
  },
} as unknown as Armazenamento;

describe.skipIf(!URL_TESTE)('v131: o vídeo no Instagram e no Comente e receba (com Postgres)', () => {
  let pool: Pool;
  let app: ReturnType<typeof criarApp>;
  let cookie = '';
  let contaId = 0;
  const log = criarLogger('teste', (process.env.LOG_TESTE as 'error') ?? 'silent');
  const privadas: { comentarioId: string; texto: string; botao: { texto: string; link: string } | null }[] =
    [];

  const agora = () => new Date().toISOString();
  const posts: Record<string, PublicacaoMeta> = {
    OUTRO: {
      id: 'OUTRO',
      legenda: 'Chegou óleo 5W30 para a linha GM, corre!',
      tipo: 'IMAGE',
      link: null,
      imagem: null,
      em: agora(),
      comentarios: 0,
    },
    MANUAL: {
      id: 'MANUAL',
      legenda: 'Freio em dia: veja os sinais',
      tipo: 'CAROUSEL_ALBUM',
      link: 'https://ig/p/manual',
      imagem: null,
      em: agora(),
      comentarios: 1,
    },
    CERTO: {
      id: 'CERTO',
      legenda: `${TEXTO}\n\n#freios #autopecas`,
      tipo: 'REELS',
      link: 'https://ig/p/certo',
      imagem: null,
      em: agora(),
      comentarios: 0,
    },
  };
  let feed: string[] = ['OUTRO'];

  const assinatura = clienteMeta({ appId: '123456', appSecret: SEGREDO });
  const meta = {
    tokenVerificacao: 'senha',
    urlDeLogin: (redirect: string, estado: string) =>
      `https://facebook.test/login?redirect=${encodeURIComponent(redirect)}&state=${estado}`,
    trocarCodigo: async () => 'token-da-pessoa',
    paginas: async () => [
      {
        id: PAGINA,
        nome: 'Auto Peças Horizonte',
        token: 'token-da-pagina',
        instagram: {
          id: IG,
          usuario: 'autopecashorizonte',
          nome: 'Auto Peças Horizonte',
          seguidores: 900,
          foto: null,
        },
      },
    ],
    assinarPagina: async () => undefined,
    desassinarPagina: async () => undefined,
    conferirAssinatura: (corpo: Buffer, a: string | undefined) => assinatura.conferirAssinatura(corpo, a),
    contaInstagram: async (id: string) => ({
      id,
      usuario: 'autopecashorizonte',
      nome: 'Auto Peças Horizonte',
      seguidores: 900,
      foto: null,
    }),
    publicacoes: async () => feed.map((id) => posts[id]!),
    publicacao: async (id: string) => posts[id] ?? null,
    respostaPrivada: async (
      _p: string,
      comentarioId: string,
      m: { texto: string; botao: { texto: string; link: string } | null },
    ) => {
      privadas.push({ comentarioId, ...m });
      return `mid-${comentarioId}`;
    },
    responderComentario: async () => undefined,
    perfil: async () => ({ nome: 'Joel Santos', usuario: 'joel.oficina' }),
    enviarDirect: async () => 'mid',
  } as unknown as ClienteMeta;

  const servicos = async (id: number): Promise<ServicosConta> => ({
    contaId: id,
    whatsapp: null,
    ia: null,
    classificarEmail: null,
    personalizarAbertura: null,
    email: null,
    assistente: null,
    geocodificar: async () => null,
    rotas: null,
    origem: { places: null, ors: null, resend: null, whatsapp: null, ia: null },
    iaDescricao: null,
    erro: null,
  });

  const ler = (rota: string) => request(app).get(rota).set('Cookie', cookie);
  const enviar = (metodo: 'post' | 'put' | 'patch' | 'delete', rota: string, corpo?: object) =>
    request(app)[metodo](rota).set('Origin', ORIGEM).set('Cookie', cookie).send(corpo);
  const comentario = (id: string, texto: string, de: string, midia: string) => {
    const cru = JSON.stringify({
      object: 'instagram',
      entry: [
        {
          id: IG,
          time: Math.floor(Date.now() / 1000),
          changes: [
            {
              field: 'comments',
              value: { id, text: texto, from: { id: de, username: `u_${de}` }, media: { id: midia } },
            },
          ],
        },
      ],
    });
    return request(app)
      .post('/meta/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', `sha256=${createHmac('sha256', SEGREDO).update(cru).digest('hex')}`)
      .send(cru);
  };
  const codigoDo = (link: string) => link.split('/l/')[1]!;

  beforeAll(async () => {
    pool = criarPool({ url: await bancoDeTeste(URL_TESTE!, 'videos_pub'), aplicacao: 'teste-vpub', max: 4 });
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
        jwtSegredo: 'j'.repeat(40),
        adminEmail: 'dona@exemplo.com',
        adminSenhaHash: await bcrypt.hash('senha-forte-123', 4),
        sessaoHoras: 1,
        cookieSeguro: false,
      },
      origens: [ORIGEM],
      servicos,
      credenciais: { chave: 'c'.repeat(32), ambiente: {}, invalidar() {} },
      meta,
      reunioes: { armazenamento } as never,
      videos: { imagensGeradas: false },
    });
    const ok = await request(app)
      .post('/auth/login')
      .set('Origin', ORIGEM)
      .send({ email: 'dona@exemplo.com', senha: 'senha-forte-123' });
    cookie = (ok.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    contaId = (await pool.query<{ id: number }>('SELECT id FROM cadastro.contas ORDER BY id LIMIT 1'))
      .rows[0]!.id;
  });

  afterAll(async () => {
    await pool?.end();
  });

  let videoId = 0;
  const palavras = ['Freio', 'chiando', 'de', 'manhã?', 'É', 'a', 'pastilha.', 'Comente', 'FREIO.'].map(
    (t, k) => ({ t, i: k * 0.5, f: k * 0.5 + 0.4 }),
  );
  const novoVideo = async (titulo: string, palavra: string) => {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO comercial.videos (conta_id, titulo, situacao, opcoes, original_chave, original_nome, original_tipo,
                                     original_bytes, duracao_original, duracao_final, palavras, analise, final_chave,
                                     pronto_em, criado_por)
       VALUES ($1, $2, 'pronto', $3, 'videos/o.mp4', 'o.mp4', 'video/mp4', 1000, 5, 4.5, $4, '{"duracao":5}',
               'videos/final.mp4', now(), (SELECT id FROM cadastro.usuarios WHERE conta_id = $1 ORDER BY id LIMIT 1))
       RETURNING id::int`,
      [
        contaId,
        titulo,
        JSON.stringify({ assunto: 'Pastilha de freio', chamada: { tipo: 'comente', palavra, texto: '' } }),
        JSON.stringify(palavras),
      ],
    );
    return rows[0]!.id;
  };

  it('a música segue o plano: toda conta com o módulo tem, quando o worker-videos tem a chave', async () => {
    await pool.query("DELETE FROM cadastro.servicos_vivos WHERE nome = 'worker-videos'");
    expect((await ler('/videos/situacao')).body.recursos.musica).toBe(false);
    await pool.query(
      `INSERT INTO cadastro.servicos_vivos (nome, visto_em, iniciado_em, info)
       VALUES ('worker-videos', now(), now(), '{"musica": true}')`,
    );
    expect((await ler('/videos/situacao')).body.recursos.musica).toBe(true);
  });

  it('v136: o detalhe traz o andamento e a prévia do mapa', async () => {
    const id = await novoVideo('Prévia', 'FREIO');
    await pool.query(
      `UPDATE comercial.videos SET andamento = '{"ouvindo": {"palavras": 12}}', previa_chave = 'videos/1/1/previa.jpg' WHERE id = $1`,
      [id],
    );
    const d = (await ler(`/videos/${id}`)).body;
    expect(d).toMatchObject({ andamento: { ouvindo: { palavras: 12 } }, temPrevia: true });
  });

  it('conecta o Instagram', async () => {
    const r = await enviar('post', '/instagram/conexao');
    const estado = new URL(r.body.url).searchParams.get('state')!;
    const volta = await request(app).get(`/meta/retorno?code=X&state=${encodeURIComponent(estado)}`);
    expect(volta.status).toBe(302);
  });

  it('o vídeo pronto que pede "Comente FREIO" ganha a regra sozinho, esperando o Reels', async () => {
    videoId = await novoVideo('Pastilha chiando', 'freio');
    const p = await ler(`/videos/${videoId}/publicacao`);
    expect(p.status).toBe(200);
    expect(p.body.situacao).toBe('esperando');
    expect(p.body.palavraDoSlide).toBe('FREIO');
    expect(p.body.regra).toMatchObject({ palavras: ['FREIO'], entrega: 'conversa' });
    // Uma regra só, mesmo abrindo a aba de novo.
    await ler(`/videos/${videoId}/publicacao`);
    const { rows } = await pool.query('SELECT 1 FROM comercial.instagram_regras WHERE video_id = $1', [
      videoId,
    ]);
    expect(rows).toHaveLength(1);
    // Em Instagram › Comente e receba, marcada com o vídeo e sem editar por lá.
    const lista = await ler('/instagram/regras');
    const regra = lista.body.regras.find((x: { videoId: number | null }) => x.videoId === videoId);
    expect(regra).toMatchObject({ alvo: 'video', videoTitulo: 'Pastilha chiando' });
    const editar = await enviar('put', `/instagram/regras/${regra.id}`, {
      alvo: 'todas',
      palavras: ['x1'],
      mensagem: 'Mensagem qualquer',
    });
    expect(editar.status).toBe(409);
    expect(editar.body.erro.mensagem).toContain('vídeo');
  });

  it('o texto do post: sem a redatora, o padrão com a chamada; depois, o que a pessoa escreveu', async () => {
    const padrao = await enviar('post', `/videos/${videoId}/publicacao/texto`);
    expect(padrao.status).toBe(200);
    expect(padrao.body.daRedatora).toBe(false);
    expect(padrao.body.textoPost).toContain('Comente FREIO');
    const salvo = await enviar('put', `/videos/${videoId}/publicacao/texto`, {
      texto: TEXTO,
      hashtags: ['#freios', 'autopecas', '#'],
    });
    expect(salvo.status).toBe(422);
    const ok = await enviar('put', `/videos/${videoId}/publicacao/texto`, {
      texto: TEXTO,
      hashtags: ['#freios', 'auto peças!'],
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      textoPost: TEXTO,
      hashtags: ['freios', 'autopeças'],
      textoDaRedatora: false,
    });
    expect((await ler(`/videos/${videoId}/publicacao`)).body.podeReconhecer).toBe(true);
  });

  it('baixar o vídeo marca o passo; a regra salva pela aba do vídeo', async () => {
    const b = await ler(`/videos/${videoId}/arquivo?tipo=final&baixar=sim`);
    expect(b.status).toBe(200);
    const salvo = await enviar('put', `/videos/${videoId}/publicacao`, {
      palavras: ['freio'],
      mensagem: 'Oi, {nome}! Segue o checklist do freio.',
      entrega: 'link',
      link: 'autopecashorizonte.com.br/freio',
      botaoTexto: 'Ver o checklist',
    });
    expect(salvo.status).toBe(200);
    expect(salvo.body.baixadoEm).toBeTruthy();
    expect(salvo.body.regra).toMatchObject({ entrega: 'link', botaoTexto: 'Ver o checklist' });
  });

  it('o Reels com o texto do post aparece: o comentário liga a regra e a pessoa recebe o direct', async () => {
    feed = ['OUTRO', 'CERTO'];
    posts.CERTO = { ...posts.CERTO!, em: agora() };
    await comentario('V1', 'FREIO', 'P9', 'OUTRO');
    expect(privadas).toHaveLength(0);
    await comentario('V2', 'freio por favor', 'P9', 'CERTO');
    expect(privadas).toHaveLength(1);
    expect(privadas[0]).toMatchObject({ comentarioId: 'V2', texto: 'Oi, Joel! Segue o checklist do freio.' });
    const p = await ler(`/videos/${videoId}/publicacao`);
    expect(p.body.situacao).toBe('publicado');
    expect(p.body.post).toMatchObject({ midiaId: 'CERTO', tipo: 'REELS' });
    expect(p.body.numeros).toMatchObject({ comentaram: 1, receberam: 1 });
    const v = await ler(`/videos/${videoId}`);
    expect(v.body.publicadoEm).toBeTruthy();
    expect(v.body.midiaLink).toBe('https://ig/p/certo');
    // O aviso no sino leva para a aba Publicação do vídeo.
    const { rows } = await pool.query<{ link: string }>(
      `SELECT link FROM comercial.notificacoes WHERE titulo = 'O vídeo está no Instagram'`,
    );
    expect(rows[0]?.link).toBe(`/videos/${videoId}?aba=publicacao`);
  });

  it('"não é este post" volta a esperar; a rotina reconhece de novo e não liga no recusado', async () => {
    const r = await enviar('delete', `/videos/${videoId}/publicacao/post`);
    expect(r.status).toBe(200);
    expect(r.body.situacao).toBe('esperando');
    expect((await ler(`/videos/${videoId}`)).body.publicadoEm).toBeNull();
    // O mesmo post foi recusado: a rotina não liga nele.
    expect(await reconhecerPostsDosCarrosseis({ pool, log, filas: null as never })).toBe(0);
    // Escolher à mão liga de novo.
    const e = await enviar('post', `/videos/${videoId}/publicacao/post`, { midiaId: 'CERTO' });
    expect(e.body.situacao).toBe('publicado');
  });

  it('a rotina reconhece o Reels de outro vídeo sozinha', async () => {
    const outro = await novoVideo('Óleo na hora certa', 'oleo');
    await ler(`/videos/${outro}/publicacao`);
    const texto =
      'Trocar o óleo na hora certa evita dor de cabeça no motor. Comente OLEO que a gente te manda a tabela de trocas.';
    await enviar('put', `/videos/${outro}/publicacao/texto`, { texto, hashtags: [] });
    posts.OLEO = {
      id: 'OLEO',
      legenda: texto,
      tipo: 'REELS',
      link: 'https://ig/p/oleo',
      imagem: null,
      em: agora(),
      comentarios: 0,
    };
    feed = ['OLEO', 'OUTRO'];
    expect(await reconhecerPostsDosCarrosseis({ pool, log, filas: null as never })).toBe(1);
    expect((await ler(`/videos/${outro}/publicacao`)).body.situacao).toBe('publicado');
  });

  it('o Argos tem a view dos vídeos e apagar o vídeo que espera o post leva a regra junto', async () => {
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'cerebro' AND table_name = 'videos'`,
    );
    expect(rows.map((r: { column_name: string }) => r.column_name)).toEqual(
      expect.arrayContaining(['titulo', 'palavra_da_chamada', 'comentaram', 'viraram_lead']),
    );
    const terceiro = await novoVideo('Bateria fraca', 'bateria');
    await ler(`/videos/${terceiro}/publicacao`);
    expect((await enviar('delete', `/videos/${terceiro}`)).status).toBe(200);
    const sobra = await pool.query('SELECT 1 FROM comercial.instagram_regras WHERE video_id = $1', [
      terceiro,
    ]);
    expect(sobra.rows).toHaveLength(0);
    // A regra do vídeo publicado continua valendo.
    const vale = await pool.query(`SELECT alvo FROM comercial.instagram_regras WHERE video_id = $1`, [
      videoId,
    ]);
    expect(vale.rows[0]).toMatchObject({ alvo: 'publicacao' });
  });
});
