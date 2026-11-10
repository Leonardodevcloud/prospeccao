import { createHmac } from 'node:crypto';
import { criarPool, migrar, type Pool } from '@prospeccao/db';
import { bancoDeTeste } from '@prospeccao/db/teste';
import type { Armazenamento } from '@prospeccao/integrations/reuniao';
import { criarLogger } from '@prospeccao/shared';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../src/app.js';
import { comConta } from '../src/contexto.js';
import { type ClienteMeta, clienteMeta, type PublicacaoMeta } from '../src/modulos/instagram/meta.js';
import { reconhecerPostsDosCarrosseis } from '../src/modulos/instagram/servico.js';
import type { ServicosConta } from '../src/servicos.js';

const URL_TESTE = process.env.TEST_DATABASE_URL;
const ORIGEM = 'http://localhost:5173';
const SEGREDO = 's'.repeat(32);
const IG = '17841400000000009';
const PAGINA = '100000000000009';

const LEGENDA =
  'Barulho de metal, pedal baixo, carro puxando de lado… Seu freio avisa antes de falhar. Arraste e veja os 5 sinais que pedem revisão.\n\nComente FREIO que a gente manda o checklist no seu direct.\n\n#freios #autopecas';

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

describe.skipIf(!URL_TESTE)('carrossel até o Comente e receba (com Postgres)', () => {
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
      legenda: LEGENDA.replace('#freios #autopecas', ''),
      tipo: 'CAROUSEL_ALBUM',
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

  let carrosselId = 0;

  beforeAll(async () => {
    pool = criarPool({ url: await bancoDeTeste(URL_TESTE!, 'publicacao'), aplicacao: 'teste-pub', max: 4 });
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

  it('sem o Instagram conectado, a regra nasce do "Comente" do último slide e fica parada', async () => {
    const c = await enviar('post', '/carrosseis', { titulo: '5 sinais de que o freio pede revisão' });
    expect(c.status).toBe(201);
    carrosselId = c.body.id;
    const p = await ler(`/carrosseis/${carrosselId}/publicacao`);
    expect(p.status).toBe(200);
    expect(p.body.situacao).toBe('sem_instagram');
    expect(p.body.regra).toMatchObject({ palavras: ['QUERO'], entrega: 'conversa' });
    expect(p.body.palavraDoSlide).toBe('QUERO');
  });

  it('conecta o Instagram; rascunho espera até ficar pronto', async () => {
    const r = await enviar('post', '/instagram/conexao');
    const estado = new URL(r.body.url).searchParams.get('state')!;
    const volta = await request(app).get(`/meta/retorno?code=X&state=${encodeURIComponent(estado)}`);
    expect(volta.status).toBe(302);
    const atual = await ler(`/carrosseis/${carrosselId}`);
    const slides = atual.body.conteudo.map((s: { modelo: string }, i: number, todos: unknown[]) =>
      i === todos.length - 1 ? { ...s, botao: 'Comente FREIO' } : s,
    );
    const salvo = await enviar('put', `/carrosseis/${carrosselId}`, {
      titulo: atual.body.titulo,
      estilo: atual.body.estilo,
      slides,
      legenda: LEGENDA,
      situacao: 'rascunho',
      versao: atual.body.versao,
    });
    expect(salvo.status).toBe(200);
    expect((await ler(`/carrosseis/${carrosselId}/publicacao`)).body.situacao).toBe('rascunho');
  });

  it('salva a regra: link exige o endereço, promoção exige a promoção e o WhatsApp', async () => {
    const base = { palavras: ['freio'], mensagem: 'Oi, {nome}! Aqui está o checklist dos 5 sinais.' };
    expect(
      (await enviar('put', `/carrosseis/${carrosselId}/publicacao`, { ...base, entrega: 'link' })).status,
    ).toBe(422);
    expect(
      (
        await enviar('put', `/carrosseis/${carrosselId}/publicacao`, {
          ...base,
          entrega: 'promocao',
          divulgarId: 999,
          whatsapp: '71998124410',
        })
      ).status,
    ).toBe(422);
    const ok = await enviar('put', `/carrosseis/${carrosselId}/publicacao`, {
      ...base,
      entrega: 'link',
      link: 'autopecashorizonte.com.br/freio',
      botaoTexto: 'Ver o checklist',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.regra).toMatchObject({
      palavras: ['FREIO'],
      entrega: 'link',
      link: 'https://autopecashorizonte.com.br/freio',
    });
    // A regra aparece em Comente e receba marcada com o carrossel, e lá não dá para editar.
    const lista = await ler('/instagram/regras');
    const regra = lista.body.regras.find((x: { id: number }) => x.id === ok.body.regra.id);
    expect(regra).toMatchObject({
      alvo: 'carrossel',
      carrosselId,
      carrosselTitulo: '5 sinais de que o freio pede revisão',
    });
    const editar = await enviar('put', `/instagram/regras/${regra.id}`, {
      alvo: 'todas',
      palavras: ['x1'],
      mensagem: 'Mensagem qualquer',
    });
    expect(editar.status).toBe(409);
  });

  it('pronto: espera o post; comentário em outro post não dispara nada', async () => {
    const atual = await ler(`/carrosseis/${carrosselId}`);
    await enviar('put', `/carrosseis/${carrosselId}`, {
      titulo: atual.body.titulo,
      estilo: atual.body.estilo,
      slides: atual.body.conteudo,
      legenda: atual.body.legenda,
      situacao: 'pronto',
      versao: atual.body.versao,
    });
    expect((await ler(`/carrosseis/${carrosselId}/publicacao`)).body.situacao).toBe('esperando');
    await comentario('K1', 'FREIO', 'P1', 'OUTRO');
    expect(privadas).toHaveLength(0);
  });

  it('escolher o post à mão: liga, e quem já tinha comentado recebe o direct com o link contado', async () => {
    // Comentário no post antes de ligar (a legenda foi trocada demais: não reconhece sozinho).
    await comentario('K2', 'quero o freio!', 'P2', 'MANUAL');
    expect(privadas).toHaveLength(0);
    const r = await enviar('post', `/carrosseis/${carrosselId}/publicacao/post`, { midiaId: 'MANUAL' });
    expect(r.status).toBe(200);
    expect(r.body.situacao).toBe('publicado');
    expect(privadas).toHaveLength(1);
    expect(privadas[0]).toMatchObject({
      comentarioId: 'K2',
      texto: 'Oi, Joel! Aqui está o checklist dos 5 sinais.',
    });
    expect(privadas[0]!.botao?.texto).toBe('Ver o checklist');
    expect(privadas[0]!.botao?.link).toMatch(/^http:\/\/localhost:5173\/api\/l\/[A-Za-z0-9]{12}$/);
    // O carrossel ficou Publicado (só leitura).
    expect((await ler(`/carrosseis/${carrosselId}`)).body.situacao).toBe('publicado');

    // Tocou no botão: vai para o link e conta como "abriu" (uma vez).
    const codigo = codigoDo(privadas[0]!.botao!.link);
    const abre = await request(app).get(`/l/${codigo}`);
    expect(abre.status).toBe(302);
    expect(abre.headers.location).toBe('https://autopecashorizonte.com.br/freio');
    await request(app).get(`/l/${codigo}`);
    const p = await ler(`/carrosseis/${carrosselId}/publicacao`);
    expect(p.body.numeros).toMatchObject({ comentaram: 1, receberam: 1, abriram: 1 });
    expect((await request(app).get('/l/naoexiste123')).status).toBe(404);
  });

  it('"não é este post": volta a esperar, e a rotina reconhece o post certo pela legenda', async () => {
    const r = await enviar('delete', `/carrosseis/${carrosselId}/publicacao/post`);
    expect(r.status).toBe(200);
    expect(r.body.situacao).toBe('esperando');
    expect((await ler(`/carrosseis/${carrosselId}`)).body.situacao).toBe('pronto');
    // Postado agora (depois do carrossel); um post de antes do carrossel não conta.
    posts.CERTO = { ...posts.CERTO!, em: agora() };
    posts.OUTRO = { ...posts.OUTRO!, legenda: LEGENDA };
    feed = ['MANUAL', 'OUTRO', 'CERTO'];
    const ligadas = await reconhecerPostsDosCarrosseis({ pool, log, filas: null as never });
    expect(ligadas).toBe(1);
    const p = await ler(`/carrosseis/${carrosselId}/publicacao`);
    expect(p.body.situacao).toBe('publicado');
    expect(p.body.post).toMatchObject({ midiaId: 'CERTO', link: 'https://ig/p/certo' });
    // Comentário novo no post certo: direct na hora; no post recusado, nada.
    await comentario('K3', 'Freio', 'P3', 'CERTO');
    expect(privadas.map((x) => x.comentarioId)).toContain('K3');
    await comentario('K4', 'freio', 'P4', 'MANUAL');
    expect(privadas.map((x) => x.comentarioId)).not.toContain('K4');
    // O sino avisou quem criou.
    const { rows } = await pool.query(
      `SELECT titulo FROM comercial.notificacoes WHERE conta_id = $1 AND titulo = 'O carrossel está no Instagram'`,
      [contaId],
    );
    expect(rows.length).toBeGreaterThan(0);
    // O cartão da lista mostra a regra.
    const lista = await ler('/carrosseis');
    expect(lista.body.carrosseis ?? lista.body).toBeDefined();
  });

  it('webhook reconhece o post pela legenda sozinho; arquivo e promoção abrem o destino certo', async () => {
    const c = await enviar('post', '/carrosseis', { titulo: 'Pastilha em promoção' });
    const id = c.body.id;
    const atual = await ler(`/carrosseis/${id}`);
    const legenda =
      'Pastilha Cobreq para Onix com preço especial nesta semana na loja. Comente PASTILHA para receber.';
    await enviar('put', `/carrosseis/${id}`, {
      titulo: atual.body.titulo,
      estilo: atual.body.estilo,
      slides: atual.body.conteudo.map((s: object, i: number, t: unknown[]) =>
        i === t.length - 1 ? { ...s, botao: 'Comente PASTILHA' } : s,
      ),
      legenda,
      situacao: 'pronto',
      versao: atual.body.versao,
    });
    // Arquivo: envia o PDF e o botão abre o arquivo guardado.
    await ler(`/carrosseis/${id}/publicacao`);
    const up = await request(app)
      .post(`/carrosseis/${id}/publicacao/arquivo`)
      .set('Origin', ORIGEM)
      .set('Cookie', cookie)
      .set('Content-Type', 'application/pdf')
      .set('X-Nome-Arquivo', encodeURIComponent('tabela-pastilhas.pdf'))
      .send(Buffer.from('%PDF-1.4 teste'));
    expect(up.status).toBe(200);
    expect(up.body.regra).toMatchObject({
      entrega: 'arquivo',
      arquivo: { nome: 'tabela-pastilhas.pdf', tipo: 'application/pdf' },
    });
    expect(
      (
        await request(app)
          .post(`/carrosseis/${id}/publicacao/arquivo`)
          .set('Origin', ORIGEM)
          .set('Cookie', cookie)
          .set('Content-Type', 'text/plain')
          .send('x')
      ).status,
    ).not.toBe(200);
    posts.PASTILHA = {
      id: 'PASTILHA',
      legenda,
      tipo: 'CAROUSEL_ALBUM',
      link: 'https://ig/p/pastilha',
      imagem: null,
      em: agora(),
      comentarios: 0,
    };
    const antes = privadas.length;
    await comentario('K5', 'PASTILHA', 'P5', 'PASTILHA');
    expect(privadas.length).toBe(antes + 1);
    const abre = await request(app).get(`/l/${codigoDo(privadas.at(-1)!.botao!.link)}`);
    expect(abre.status).toBe(302);
    expect(abre.headers.location).toMatch(/^https:\/\/arm\/b\/instagram\/\d+\/arquivos\/.+\.pdf$/);

    // Promoção: o botão abre o WhatsApp com o pedido pronto.
    const promo = await enviar('post', '/carrosseis/divulgar', {
      tipo: 'promocao',
      titulo: 'Pastilha Cobreq Onix',
      precoDe: 'R$ 162,00',
      precoPor: 'R$ 139,90',
      validade: 'até sábado',
    });
    expect(promo.status).toBe(201);
    const regra = (await ler(`/carrosseis/${id}/publicacao`)).body.regra;
    const salvo = await enviar('put', `/carrosseis/${id}/publicacao`, {
      palavras: regra.palavras,
      entrega: 'promocao',
      divulgarId: promo.body.id,
      whatsapp: '(71) 99812-4410',
      mensagem: 'Oi, {nome}! A pastilha está de R$ 162,00 por R$ 139,90 até sábado.',
    });
    expect(salvo.status).toBe(200);
    await comentario('K6', 'pastilha', 'P6', 'PASTILHA');
    const wa = await request(app).get(`/l/${codigoDo(privadas.at(-1)!.botao!.link)}`);
    expect(wa.headers.location).toBe(
      `https://wa.me/5571998124410?text=${encodeURIComponent('Oi! Vi no Instagram e quero a promoção: Pastilha Cobreq Onix')}`,
    );
  });

  it('apagar o carrossel que ainda espera leva a regra junto', async () => {
    const c = await enviar('post', '/carrosseis', { titulo: 'Bateria: quando trocar' });
    await ler(`/carrosseis/${c.body.id}/publicacao`);
    const { rows } = await comConta(contaId, () =>
      pool.query('SELECT 1 FROM comercial.instagram_regras WHERE carrossel_id = $1', [c.body.id]),
    );
    expect(rows).toHaveLength(1);
    expect((await enviar('delete', `/carrosseis/${c.body.id}`)).status).toBe(200);
    const depois = await pool.query('SELECT 1 FROM comercial.instagram_regras WHERE carrossel_id = $1', [
      c.body.id,
    ]);
    expect(depois.rows).toHaveLength(0);
  });
});
