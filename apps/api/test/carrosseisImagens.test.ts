import { criarPool, migrar, type Pool } from '@prospeccao/db';
import { bancoDeTeste } from '@prospeccao/db/teste';
import { type ClienteClaude, USO_ZERO } from '@prospeccao/integrations/carrosseis';
import type { Armazenamento } from '@prospeccao/integrations/reuniao';
import { criarLogger } from '@prospeccao/shared';
import bcrypt from 'bcryptjs';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { criarApp } from '../src/app.js';
import { type CarrosseisIa, medidorClaude, rodarUmPedido } from '../src/modulos/carrosseis/time.js';
import type { ServicosConta } from '../src/servicos.js';

const URL_TESTE = process.env.TEST_DATABASE_URL;
const ORIGEM = 'http://localhost:5173';

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
  async ler(chave: string) {
    const a = arquivos.get(chave);
    if (!a) throw new Error(`sem o arquivo ${chave}`);
    return a;
  },
} as unknown as Armazenamento;

const ESTRATEGIA = {
  titulo: 'Pastilha em promoção',
  angulo: 'O chiado é o aviso',
  ganchos: ['Freio chiando? É a pastilha', 'A pastilha avisa uma vez', 'O chiado some'],
  escolhido: 0,
  porque: 'Os clientes perguntam quando trocar a pastilha.',
  fontes: ['Perguntas dos clientes'],
  slides: [
    { modelo: 'capa', ideia: 'gancho', fotoId: null, gerar: 'uma oficina qualquer' },
    {
      modelo: 'foto',
      ideia: 'a oficina',
      fotoId: null,
      gerar: 'mecânico conferindo o freio de um carro popular',
    },
    { modelo: 'foto', ideia: 'sem imagem', fotoId: null, gerar: '' },
    { modelo: 'texto', ideia: 'o sinal' },
    { modelo: 'chamada', ideia: 'chama' },
  ],
};

const REDACAO = {
  slides: [
    { modelo: 'capa', sobretitulo: 'Freios', titulo: 'Freio chiando? É a pastilha' },
    { modelo: 'foto', titulo: 'Confira antes de frear mal' },
    { modelo: 'texto', titulo: 'Sem foto', texto: 'Este vira texto.' },
    { modelo: 'texto', titulo: 'O chiado é o aviso', texto: 'A pastilha gasta faz barulho.' },
    { modelo: 'chamada', titulo: 'Quer a sua?', botao: 'Chame no WhatsApp', texto: 'Respondemos já.' },
  ],
  legenda: 'Freio chiando? Não espere.',
  hashtags: ['freios'],
};

const notas = (n: number) =>
  Object.fromEntries(
    ['gancho', 'umaIdeia', 'clareza', 'especifico', 'tamanho', 'chamada', 'tom', 'portugues'].map((c) => [
      c,
      n,
    ]),
  );

/** v150: os cards (1 card, 2 variações) e o que o revisor de arte leu na imagem. */
const PLANO_CARDS = {
  titulo: 'Pastilha em promoção',
  cards: [
    {
      titulo: 'Pastilha',
      ideia: 'O preço da pastilha',
      variacoes: [
        { modelo: 'numero', abordagem: 'O preço grande' },
        { modelo: 'capa', abordagem: 'O chiado' },
      ],
    },
  ],
};
const CARDS = {
  cards: [
    {
      variacoes: [
        {
          modelo: 'numero',
          sobretitulo: 'Só esta semana',
          destaque: 'R$ 139,90',
          titulo: 'Pastilha *com instalação*',
          texto: 'Na oficina do bairro.',
          botao: 'Chame no WhatsApp',
        },
        {
          modelo: 'capa',
          sobretitulo: 'Freios',
          titulo: 'Freio chiando? Hora da pastilha',
          botao: 'Chame no WhatsApp',
        },
      ],
      legenda: 'Pastilha com instalação por R$ 139,90.',
      hashtags: ['freios'],
    },
  ],
};
const DIRECAO = {
  ideia: 'Brake pad floating over a burst of brand color',
  cena: 'Deep brand-color gradient with a soft glow',
  assunto: 'A 3D brake pad, large on the right',
  composicao: 'Price huge top-left, headline under it, button bottom-left, pad on the right',
  elementos: ['speed lines'],
  tipografia: 'Extra-bold sans',
  luz_e_cor: 'Studio light',
  canto_da_logo: 'base-direita',
};
let arteErrada = false;
const ARTE_LIDA = () => ({
  textos: arteErrada
    ? ['SÓ ESTA SEMANA', 'R$ 129,90', 'Pastilha com instalação']
    : [
        'SÓ ESTA SEMANA',
        'R$ 139,90',
        'Pastilha com',
        'instalação',
        'Na oficina do bairro.',
        'Chame no WhatsApp',
      ],
  logo_da_marca: true,
  outra_marca: false,
  defeito: false,
  legivel: true,
  nota: 4,
  problemas: [],
});

let reprovar = false;
const pedidos: { agente: string; ferramenta: string; imagens: number }[] = [];
const chamadasImagem: { url: string; edicao: boolean; prompt: string }[] = [];

function iaComImagens(): CarrosseisIa {
  return {
    modelo: 'claude-sonnet-5-5',
    testar: async () => 'ok',
    imagem: {
      config: {
        chave: 'k',
        modelo: 'gpt-image-2',
        url: 'https://img.test/gen',
        urlEdicao: 'https://img.test/edit',
      },
      custoUsd: 0.05,
    },
    armazenamento,
    cliente(db, contaId): ClienteClaude {
      const medidor = medidorClaude(db, contaId);
      return {
        modelo: 'claude-sonnet-5-5',
        async pedir(p) {
          pedidos.push({ agente: p.agente, ferramenta: p.ferramenta.nome, imagens: p.imagens?.length ?? 0 });
          await medidor.depois(USO_ZERO, 0.001, true);
          const dados: Record<string, unknown> =
            p.ferramenta.nome === 'plano_cards'
              ? PLANO_CARDS
              : p.ferramenta.nome === 'cards'
                ? CARDS
                : p.ferramenta.nome === 'conferir_arte'
                  ? ARTE_LIDA()
                  : p.ferramenta.nome === 'direcao_de_arte'
                    ? DIRECAO
                    : p.ferramenta.nome === 'estilo_da_referencia'
                      ? { estilo: 'Foto de produto centralizada, fundo escuro, luz lateral, texto embaixo.' }
                      : p.ferramenta.nome === 'conferir_cenario'
                        ? {
                            produto_igual: !reprovar,
                            texto_novo: false,
                            marca_estranha: false,
                            defeito: false,
                            combina: true,
                            problemas: [],
                          }
                        : p.ferramenta.nome === 'conferir_imagem'
                          ? {
                              tem_texto: false,
                              tem_marca: false,
                              rosto_em_destaque: false,
                              defeito: false,
                              combina: true,
                              problemas: [],
                            }
                          : p.agente === 'estrategista'
                            ? ESTRATEGIA
                            : p.agente === 'redator'
                              ? REDACAO
                              : p.agente === 'revisor'
                                ? { notas: notas(5), ajustes: [], fatos: [] }
                                : {};
          return { dados, uso: USO_ZERO, custoUsd: 0.001 };
        },
      };
    },
  };
}

describe.skipIf(!URL_TESTE)('v132: imagens nos carrosséis (com Postgres)', () => {
  let pool: Pool;
  let app: ReturnType<typeof criarApp>;
  let master = '';
  let rui = { contaId: 0, cookie: '' };
  const ia = iaComImagens();
  const log = criarLogger('teste', (process.env.LOG_TESTE as 'error') ?? 'silent');
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
  const cookieDe = (r: request.Response) =>
    (r.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
  const ler = (rota: string, c = rui.cookie) => request(app).get(rota).set('Cookie', c);
  const mandar = (metodo: 'post' | 'put' | 'delete', rota: string, corpo?: object, c = rui.cookie) =>
    request(app)[metodo](rota).set('Origin', ORIGEM).set('Cookie', c).send(corpo);
  const entrar = (email: string, senha: string) =>
    request(app).post('/auth/login').set('Origin', ORIGEM).send({ email, senha });

  beforeAll(async () => {
    pool = criarPool({
      url: await bancoDeTeste(URL_TESTE!, 'carrosseis_img'),
      aplicacao: 'teste-img',
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
        jwtSegredo: 't'.repeat(40),
        adminEmail: 'dona@exemplo.com',
        adminSenhaHash: await bcrypt.hash('senha-forte-123', 4),
        sessaoHoras: 1,
        cookieSeguro: false,
      },
      origens: [ORIGEM],
      servicos,
      credenciais: { chave: null, ambiente: {}, invalidar() {} },
      carrosseisIa: ia,
      reunioes: { armazenamento } as never,
    });
    master = cookieDe(await entrar('dona@exemplo.com', 'senha-forte-123'));
    const r = await mandar(
      'post',
      '/master/contas',
      {
        nome: 'Auto Peças Horizonte',
        admin: { nome: 'Rui', email: 'rui@horizonte.com.br' },
        plano: { plano: 'escala', modulos: ['carrosseis'] },
      },
      master,
    );
    expect(r.status).toBe(201);
    const conta = (await ler(`/master/contas/${r.body.id}`, master)).body as { usuarios: { id: number }[] };
    await request(app)
      .patch(`/master/usuarios/${conta.usuarios[0]!.id}/acesso`)
      .set('Origin', ORIGEM)
      .set('Cookie', master)
      .send({ senha: 'senha-forte-1' });
    rui = { contaId: r.body.id, cookie: cookieDe(await entrar('rui@horizonte.com.br', 'senha-forte-1')) };
  }, 60_000);

  afterAll(async () => {
    vi.unstubAllGlobals();
    await pool?.end();
  });

  let jpeg: Uint8Array;
  let produtoId = 0;

  it('prepara: o cérebro conferido, a foto do produto e a IA de imagem falsa', async () => {
    await pool.query(
      `INSERT INTO comercial.carrossel_cerebro (conta_id, dados, conferido_em)
       VALUES ($1, $2, now())`,
      [rui.contaId, JSON.stringify({ nicho: 'Autopeças', publico: 'Oficinas', tom: 'Direto' })],
    );
    jpeg = new Uint8Array(
      await sharp({ create: { width: 900, height: 900, channels: 3, background: '#a33' } })
        .jpeg()
        .toBuffer(),
    );
    const b64 = Buffer.from(
      await sharp({ create: { width: 1088, height: 1360, channels: 3, background: '#334' } })
        .jpeg()
        .toBuffer(),
    ).toString('base64');
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      if (!String(url).startsWith('https://img.test/')) throw new Error(`fetch inesperado: ${url}`);
      const corpo = init.body;
      chamadasImagem.push({
        url: String(url),
        edicao: corpo instanceof FormData,
        prompt:
          corpo instanceof FormData
            ? String(corpo.get('prompt'))
            : String(JSON.parse(String(corpo)).prompt ?? ''),
      });
      return new Response(JSON.stringify({ data: [{ b64_json: b64 }] }), { status: 200 });
    });
    const f = await request(app)
      .post('/carrosseis/fotos?nome=pastilha.jpg')
      .set('Origin', ORIGEM)
      .set('Cookie', rui.cookie)
      .set('Content-Type', 'image/jpeg')
      .send(Buffer.from(jpeg));
    expect(f.status).toBe(201);
    produtoId = f.body.id;
    expect(f.body.origem).toBe('enviada');
    expect((await ler('/carrosseis/situacao')).body.ia.imagens).toBe(true);
  });

  let referenciaId = 0;
  it('a referência de estilo é lida pelo modelo de visão e não aparece entre as fotos', async () => {
    const r = await request(app)
      .post('/carrosseis/referencias?nome=post-que-gostei.jpg')
      .set('Origin', ORIGEM)
      .set('Cookie', rui.cookie)
      .set('Content-Type', 'image/jpeg')
      .send(Buffer.from(jpeg));
    expect(r.status).toBe(201);
    expect(r.body.estilo).toContain('fundo escuro');
    referenciaId = r.body.id;
    const fotos = (await ler('/carrosseis/fotos')).body.fotos as { id: number }[];
    expect(fotos.map((x) => x.id)).toEqual([produtoId]);
  });

  it('o time faz o cenário da capa e a imagem do slide; o que não deu vira texto', async () => {
    chamadasImagem.length = 0;
    const p = await mandar('post', '/carrosseis/time', {
      assunto: 'Pastilha chiando',
      gerarImagens: true,
      fotoProdutoId: produtoId,
      referenciaId,
      usarFotos: true,
    });
    expect(p.status).toBe(201);
    expect(await rodarUmPedido(pool, ia, log)).toBe(true);
    const pedido = (await ler(`/carrosseis/time/${p.body.id}`)).body;
    expect(pedido.situacao).toBe('pronto');
    const c = (await ler(`/carrosseis/${pedido.carrosselId}`)).body;
    // A capa: o produto num cenário (edição com a foto). O slide 2: imagem gerada. O 3: virou texto.
    expect(chamadasImagem.filter((x) => x.edicao)).toHaveLength(1);
    expect(chamadasImagem.filter((x) => !x.edicao)).toHaveLength(1);
    const { rows } = await pool.query<{
      id: number;
      origem: string;
      base_foto_id: number | null;
      carrossel_id: number | null;
    }>(
      `SELECT id, origem, base_foto_id, carrossel_id FROM comercial.carrossel_fotos WHERE origem IN ('gerada', 'cenario') ORDER BY id`,
    );
    const cenario = rows.find((x) => x.origem === 'cenario')!;
    const gerada = rows.find((x) => x.origem === 'gerada')!;
    expect(cenario).toMatchObject({ base_foto_id: produtoId, carrossel_id: pedido.carrosselId });
    expect(c.conteudo[0].fotoId).toBe(cenario.id);
    expect(c.conteudo[1]).toMatchObject({ modelo: 'foto', fotoId: gerada.id });
    expect(c.conteudo[2].modelo).toBe('texto');
    // O estrategista soube da foto do produto e da referência.
    const consumo = await pool.query<{ imagens: number; imagens_usd: string }>(
      'SELECT sum(imagens)::int AS imagens, sum(imagens_usd) AS imagens_usd FROM cadastro.consumo_carrosseis WHERE conta_id = $1',
      [rui.contaId],
    );
    expect(consumo.rows[0]).toMatchObject({ imagens: 2 });
    expect(Number(consumo.rows[0]!.imagens_usd)).toBeCloseTo(0.1, 6);
    expect(pedidos.filter((x) => x.ferramenta === 'conferir_cenario')[0]!.imagens).toBe(2);
  });

  it('cenários para o produto no editor: três conferidos; reprovados são descartados', async () => {
    const r = await mandar('post', `/carrosseis/fotos/${produtoId}/cenarios`, {});
    expect(r.status).toBe(200);
    expect(r.body.feitos).toHaveLength(3);
    expect(r.body.reprovados).toBe(0);
    expect(
      (await ler(`/carrosseis/fotos/${produtoId}/cenarios`)).body.cenarios.length,
    ).toBeGreaterThanOrEqual(4);
    reprovar = true;
    const ruins = await mandar('post', `/carrosseis/fotos/${produtoId}/cenarios`, {});
    expect(ruins.body).toMatchObject({ feitos: [], reprovados: 3 });
    reprovar = false;
    // Cenário de um cenário não vale: só da foto enviada.
    const um = r.body.feitos[0].id;
    expect((await mandar('post', `/carrosseis/fotos/${um}/cenarios`, {})).status).toBe(422);
    // As imagens feitas pela IA não tiram vaga das fotos enviadas.
    expect((await ler('/carrosseis/fotos')).body.fotos.length).toBeGreaterThan(1);
  });

  it('v150: cada card ganha a variação desenhada pela IA, conferida letra por letra', async () => {
    chamadasImagem.length = 0;
    const p = await mandar('post', '/carrosseis/cards', {
      assunto: 'Promoção da pastilha com instalação',
      quantidade: 1,
      variacoes: 2,
    });
    expect(p.status).toBe(201);
    expect(await rodarUmPedido(pool, ia, log)).toBe(true);
    const lote = (await ler('/carrosseis/cards')).body.lotes.find(
      (x: { pedidoId: number }) => x.pedidoId === p.body.id,
    );
    const vs = lote.cards[0].variacoes as {
      id: number;
      slide: { modelo: string; fotoId: number; titulo: string };
    }[];
    expect(vs.map((v) => v.slide.modelo)).toEqual(['numero', 'capa', 'arte']);
    const arte = vs[2]!;
    expect(arte.slide.titulo).toBe('Pastilha *com instalação*');
    // Uma imagem só (aprovada na 1ª), sem foto de referência: o pedido vai para a geração, com a
    // direção de arte planejada antes e o canto livre para a logo (que o código põe depois).
    expect(chamadasImagem).toHaveLength(1);
    expect(chamadasImagem[0]!.prompt).toContain('BIG IDEA: Brake pad floating');
    expect(chamadasImagem[0]!.prompt).toContain('bottom-right corner');
    expect(chamadasImagem[0]!.prompt).toContain('"R$ 139,90"');
    const { rows } = await pool.query<{ origem: string; carrossel_id: number }>(
      'SELECT origem, carrossel_id FROM comercial.carrossel_fotos WHERE id = $1',
      [arte.slide.fotoId],
    );
    expect(rows[0]).toEqual({ origem: 'arte', carrossel_id: arte.id });
    // A arte não entra na biblioteca de fotos e a peça sai como a imagem inteira.
    expect((await ler('/carrosseis/fotos')).body.fotos.map((f: { id: number }) => f.id)).not.toContain(
      arte.slide.fotoId,
    );
    expect((await ler(`/carrosseis/${arte.id}/slides/0?largura=320`)).status).toBe(200);

    // Desenhar de novo: troca a imagem da mesma variação.
    const de = await mandar('post', `/carrosseis/${arte.id}/arte`);
    expect(de.status).toBe(200);
    expect(de.body.carrosselId).toBe(arte.id);
    const depois = (await ler(`/carrosseis/${arte.id}`)).body;
    expect(depois.conteudo[0].modelo).toBe('arte');
    expect(depois.conteudo[0].fotoId).not.toBe(arte.slide.fotoId);

    // A IA errou o preço duas vezes: nada muda e a tela recebe o aviso.
    arteErrada = true;
    chamadasImagem.length = 0;
    const errou = await mandar('post', `/carrosseis/${vs[0]!.id}/arte`);
    expect(errou.status).toBe(422);
    expect(errou.body.erro.mensagem).toContain('duas tentativas');
    expect(chamadasImagem).toHaveLength(2);
    arteErrada = false;
    // Num molde, "Arte da IA" cria mais uma variação desenhada do mesmo card.
    const nova = await mandar('post', `/carrosseis/${vs[0]!.id}/arte`);
    expect(nova.status).toBe(200);
    const lote2 = (await ler('/carrosseis/cards')).body.lotes.find(
      (x: { pedidoId: number }) => x.pedidoId === p.body.id,
    );
    expect(lote2.cards[0].variacoes.map((v: { slide: { modelo: string } }) => v.slide.modelo)).toEqual([
      'numero',
      'capa',
      'arte',
      'arte',
    ]);
  });

  it('v150: sem a arte pedida, o card fica só nos moldes', async () => {
    chamadasImagem.length = 0;
    const p = await mandar('post', '/carrosseis/cards', {
      assunto: 'Promoção da pastilha com instalação',
      quantidade: 1,
      variacoes: 2,
      arteIa: false,
    });
    expect(await rodarUmPedido(pool, ia, log)).toBe(true);
    const lote = (await ler('/carrosseis/cards')).body.lotes.find(
      (x: { pedidoId: number }) => x.pedidoId === p.body.id,
    );
    expect(lote.cards[0].variacoes.map((v: { slide: { modelo: string } }) => v.slide.modelo)).toEqual([
      'numero',
      'capa',
    ]);
    expect(chamadasImagem).toHaveLength(0);
  });
});
