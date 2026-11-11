import { createHmac } from 'node:crypto';
import { criarPool, migrar, type Pool } from '@prospeccao/db';
import { bancoDeTeste } from '@prospeccao/db/teste';
import type { Armazenamento } from '@prospeccao/integrations/reuniao';
import { criarLogger } from '@prospeccao/shared';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../src/app.js';
import {
  type ClienteMeta,
  clienteMeta,
  ErroMeta,
  type PublicacaoMeta,
} from '../src/modulos/instagram/meta.js';
import { publicarOsAgendados } from '../src/modulos/instagram/publicar.js';
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

describe.skipIf(!URL_TESTE)('v133: publicar e agendar pelo CRM (com Postgres)', () => {
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
  const feed: string[] = ['OUTRO'];

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
    // v133: publicar (a permissão aprovada e a plataforma ligada).
    publicarLigado: false,
    escopos: async () => (permissao ? ['instagram_basic', 'instagram_content_publish'] : ['instagram_basic']),
    criarMidia: async (
      _ig: string,
      _t: string,
      m: { tipo: string; imagem?: string; video?: string; filhos?: string[]; legenda?: string },
    ) => {
      if (falharMeta) throw new ErroMeta('Imagem com proporção inválida.', 400, 36003, null);
      criadas.push(m);
      return `C${criadas.length}`;
    },
    situacaoMidia: async () => situacoes.shift() ?? 'FINISHED',
    publicarMidia: async (_ig: string, container: string) => {
      publicadas.push(container);
      const id = `NOVO${publicadas.length}`;
      posts[id] = {
        id,
        legenda: 'publicado pelo CRM',
        tipo: 'CAROUSEL_ALBUM',
        link: `https://ig/p/${id}`,
        imagem: null,
        em: agora(),
        comentarios: 0,
      };
      return id;
    },
    limitePublicacao: async () => ({ usadas: publicadas.length, limite: 100 }),
  } as unknown as ClienteMeta & { publicarLigado: boolean };
  let permissao = false;
  let falharMeta = false;
  const situacoes: string[] = [];
  const criadas: { tipo: string; imagem?: string; video?: string; filhos?: string[]; legenda?: string }[] =
    [];
  const publicadas: string[] = [];

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
    pool = criarPool({
      url: await bancoDeTeste(URL_TESTE!, 'publicar'),
      aplicacao: 'teste-publicar',
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
      videos: { imagensGeradas: false, musicaLiberada: () => false },
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

  const deps = () => ({ pool, log, filas: null as never, armazenamento });
  let carrosselId = 0;
  let videoId = 0;

  it('conecta o Instagram e prepara um carrossel pronto com "Comente FREIO" e um vídeo pronto', async () => {
    const r = await enviar('post', '/instagram/conexao');
    const estado = new URL(r.body.url).searchParams.get('state')!;
    expect((await request(app).get(`/meta/retorno?code=X&state=${encodeURIComponent(estado)}`)).status).toBe(
      302,
    );
    const c = await enviar('post', '/carrosseis', { titulo: 'Freio chiando' });
    carrosselId = c.body.id;
    const atual = await ler(`/carrosseis/${carrosselId}`);
    const slides = atual.body.conteudo.map((s: { modelo: string }, i: number, todos: unknown[]) =>
      i === todos.length - 1 ? { ...s, botao: 'Comente FREIO' } : s,
    );
    const salvo = await enviar('put', `/carrosseis/${carrosselId}`, {
      titulo: atual.body.titulo,
      estilo: atual.body.estilo,
      slides,
      legenda: 'Freio chiando de manhã? Veja os sinais.\n\nComente FREIO que a gente manda o checklist.',
      situacao: 'pronto',
      versao: atual.body.versao,
    });
    expect(salvo.status).toBe(200);
    expect((await ler(`/carrosseis/${carrosselId}/publicacao`)).body.regra.palavras).toEqual(['FREIO']);
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO comercial.videos (conta_id, titulo, situacao, opcoes, original_chave, original_nome, original_tipo,
                                     original_bytes, final_chave, capa_chave, texto_post, hashtags, pronto_em, criado_por)
       VALUES ($1, 'Óleo na hora certa', 'pronto', '{}', 'v/o.mp4', 'o.mp4', 'video/mp4', 1, 'v/final.mp4', 'v/capa.jpg',
               'Trocar o óleo na hora certa.', '{oleo}', now(), (SELECT id FROM cadastro.usuarios WHERE conta_id = $1 ORDER BY id LIMIT 1))
       RETURNING id::int`,
      [contaId],
    );
    videoId = rows[0]!.id;
  });

  it('antes da aprovação da Meta: a tela diz "em breve" e agendar é recusado', async () => {
    const s = await ler(`/carrosseis/${carrosselId}/publicar`);
    expect(s.body.situacao).toMatchObject({ ligado: false });
    const r = await enviar('post', `/carrosseis/${carrosselId}/publicar`, { para: null });
    expect(r.status).toBe(422);
    meta.publicarLigado = true;
    const sem = await ler(`/carrosseis/${carrosselId}/publicar`);
    expect(sem.body.situacao).toMatchObject({ ligado: true, conectado: true, permissao: false });
    expect((await enviar('post', `/carrosseis/${carrosselId}/publicar`, { para: null })).status).toBe(422);
    permissao = true;
  });

  it('agenda, troca o horário e cancela; o calendário mostra o agendado', async () => {
    const amanha = new Date(Date.now() + 86_400_000);
    const r = await enviar('post', `/carrosseis/${carrosselId}/publicar`, { para: amanha.toISOString() });
    expect(r.status).toBe(201);
    expect(r.body.agendamento).toMatchObject({ situacao: 'agendado', comente: true });
    expect((await ler(`/carrosseis/${carrosselId}`)).body.situacao).toBe('agendado');
    // A regra continua esperando o post (a aba Publicação não vira rascunho).
    expect((await ler(`/carrosseis/${carrosselId}/publicacao`)).body.situacao).toBe('esperando');
    const depois = new Date(Date.now() + 2 * 86_400_000);
    const troca = await enviar('post', `/carrosseis/${carrosselId}/publicar`, { para: depois.toISOString() });
    expect(troca.body.agendamento.id).toBe(r.body.agendamento.id);
    const mes = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
    })
      .format(depois)
      .slice(0, 7);
    const cal = await ler(`/carrosseis/calendario?mes=${mes}`);
    expect(cal.body.itens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tipo: 'carrossel', id: carrosselId, situacao: 'agendado' }),
      ]),
    );
    expect(
      (await enviar('post', `/carrosseis/${carrosselId}/publicar`, { para: '2020-01-01T10:00:00Z' })).status,
    ).toBe(422);
    const c = await enviar('delete', `/carrosseis/${carrosselId}/publicar`);
    expect(c.status).toBe(200);
    expect(c.body.agendamento.situacao).toBe('cancelado');
    expect((await ler(`/carrosseis/${carrosselId}`)).body.situacao).toBe('pronto');
  });

  it('publicar agora: a rotina desenha os slides, publica e liga o Comente e receba no post', async () => {
    const r = await enviar('post', `/carrosseis/${carrosselId}/publicar`, {
      para: null,
      legenda: 'Legenda nova. Comente FREIO.',
    });
    expect(r.status).toBe(201);
    expect(await publicarOsAgendados(deps())).toBe(1);
    const itens = criadas.filter((x) => x.tipo === 'item');
    const total = (await ler(`/carrosseis/${carrosselId}`)).body.conteudo.length;
    expect(itens).toHaveLength(total);
    expect(itens[0]!.imagem).toMatch(/^https:\/\/arm\/b\/carrosseis\/\d+\/publicar\//);
    expect(criadas.find((x) => x.tipo === 'carrossel')).toMatchObject({
      legenda: 'Legenda nova. Comente FREIO.',
    });
    const c = (await ler(`/carrosseis/${carrosselId}`)).body;
    expect(c.situacao).toBe('publicado');
    const p = (await ler(`/carrosseis/${carrosselId}/publicacao`)).body;
    expect(p.situacao).toBe('publicado');
    expect(p.post.midiaId).toBe('NOVO1');
    // O comentário no post publicado já é atendido (a regra ligou direto, sem reconhecer pela legenda).
    await comentario('PUB1', 'FREIO', 'P1', 'NOVO1');
    expect(privadas).toHaveLength(1);
    const dna = await pool.query<{ dna: Record<string, unknown> }>(
      'SELECT dna FROM comercial.instagram_agendamentos WHERE carrossel_id = $1 AND situacao = $2',
      [carrosselId, 'publicado'],
    );
    expect(dna.rows[0]!.dna).toMatchObject({ tipo: 'carrossel', chamada: 'comentar', slides: total });
  });

  it('o Reels espera a Meta processar o vídeo e publica na volta seguinte', async () => {
    const r = await enviar('post', `/videos/${videoId}/publicar`, { para: null });
    expect(r.status).toBe(201);
    situacoes.push('IN_PROGRESS');
    expect(await publicarOsAgendados(deps())).toBe(0);
    expect((await ler(`/videos/${videoId}/publicar`)).body.agendamento.situacao).toBe('publicando');
    const reels = criadas.find((x) => x.tipo === 'reels')!;
    expect(reels).toMatchObject({
      video: 'https://arm/b/v/final.mp4',
      legenda: 'Trocar o óleo na hora certa.\n\n#oleo',
    });
    expect(await publicarOsAgendados(deps())).toBe(1);
    const v = (await ler(`/videos/${videoId}`)).body;
    expect(v.publicadoEm).toBeTruthy();
    expect((await enviar('post', `/videos/${videoId}/publicar`, { para: null })).status).toBe(409);
  });

  it('a Meta recusa: avisa e a peça volta para Pronto', async () => {
    const c = await enviar('post', '/carrosseis', { titulo: 'Outro' });
    const atual = await ler(`/carrosseis/${c.body.id}`);
    await enviar('put', `/carrosseis/${c.body.id}`, {
      titulo: 'Outro',
      estilo: atual.body.estilo,
      slides: atual.body.conteudo,
      legenda: 'Uma legenda qualquer para o post de teste.',
      situacao: 'pronto',
      versao: atual.body.versao,
    });
    await enviar('post', `/carrosseis/${c.body.id}/publicar`, { para: null });
    falharMeta = true;
    expect(await publicarOsAgendados(deps())).toBe(0);
    falharMeta = false;
    const a = (await ler(`/carrosseis/${c.body.id}/publicar`)).body.agendamento;
    expect(a).toMatchObject({ situacao: 'falhou' });
    expect(a.erro).toContain('proporção');
    expect((await ler(`/carrosseis/${c.body.id}`)).body.situacao).toBe('pronto');
    const { rows } = await pool.query(
      `SELECT 1 FROM comercial.notificacoes WHERE titulo = 'A Meta não publicou o post'`,
    );
    expect(rows).toHaveLength(1);
  });
});
