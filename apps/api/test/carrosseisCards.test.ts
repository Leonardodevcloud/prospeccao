import { criarPool, migrar, type Pool } from '@prospeccao/db';
import { bancoDeTeste } from '@prospeccao/db/teste';
import { type ClienteClaude, USO_ZERO } from '@prospeccao/integrations/carrosseis';
import { criarLogger } from '@prospeccao/shared';
import bcrypt from 'bcryptjs';
import { unzipSync } from 'fflate';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../src/app.js';
import { type CarrosseisIa, medidorClaude, rodarUmPedido } from '../src/modulos/carrosseis/time.js';
import type { ServicosConta } from '../src/servicos.js';

const URL_TESTE = process.env.TEST_DATABASE_URL;
const ORIGEM = 'http://localhost:5173';

const notas = (n: number) => ({
  gancho: n,
  umaIdeia: n,
  clareza: n,
  especifico: n,
  tamanho: n,
  chamada: n,
  tom: n,
  portugues: n,
});

/** O que o Claude de mentira responde para cada agente (e o que cada um recebeu). */
const recebidos: { agente: string; mensagem: string }[] = [];
const RESPOSTAS: Record<string, Record<string, unknown>> = {
  cerebro: {
    nicho: 'Autopeças para oficinas em Salvador',
    publico: 'Mecânicos e donos de oficina da região',
    oQueVende: 'Peças de freio, suspensão e filtros, com entrega no mesmo dia',
    diferenciais: ['Entrega no mesmo dia'],
    provas: [{ texto: 'Garantia de 6 meses em pastilhas', fonte: 'Configuração da IA' }],
    perguntas: [{ texto: 'Quando trocar a pastilha?', vezes: 4, fonte: 'Conversas' }],
    tom: 'Direto, de quem entende de carro',
    pilares: ['Freios', 'Manutenção', 'Promoções'],
  },
  plano_cards: {
    titulo: 'Promoções da semana',
    cards: [
      {
        titulo: 'Pastilha',
        ideia: 'A pastilha com preço bom',
        variacoes: [
          { modelo: 'numero', abordagem: 'O preço grande' },
          { modelo: 'capa', abordagem: 'O chiado como gancho' },
        ],
      },
      {
        titulo: 'Óleo',
        ideia: 'O óleo certo',
        variacoes: [
          { modelo: 'chamada', abordagem: 'Ação direta' },
          { modelo: 'inventado', abordagem: 'Modelo que não existe vira o padrão' },
        ],
      },
    ],
  },
  cards: {
    cards: [
      {
        variacoes: [
          {
            modelo: 'numero',
            destaque: 'R$ 139,90',
            titulo: 'Pastilha com instalação',
            texto: 'Só até sexta.',
          },
          { modelo: 'capa', sobretitulo: 'Freios', titulo: 'Freio chiando? Hora da pastilha' },
        ],
        legenda: 'Pastilha com instalação por R$ 139,90.',
        hashtags: ['freios'],
      },
      {
        variacoes: [
          { modelo: 'chamada', titulo: 'Óleo 5W30 na troca', botao: 'Chame no WhatsApp' },
          { modelo: 'numero', destaque: 'R$ 42', titulo: 'Óleo 5W30' },
        ],
        legenda: 'Troque o óleo com a gente.',
        hashtags: ['oleo'],
      },
    ],
  },
  revisao: {
    notas: notas(5),
    ajustes: [
      {
        slide: 2,
        campo: 'titulo',
        tipo: 'tom',
        problema: 'Pode ser mais direto',
        sugestao: 'Chiou? Troque.',
      },
    ],
    fatos: [],
  },
};
const falharTudo = false;

function iaFalsa(): CarrosseisIa {
  return {
    modelo: 'claude-sonnet-5-5',
    testar: async () => 'ok (claude-sonnet-5-5)',
    cliente(db, contaId): ClienteClaude {
      const medidor = medidorClaude(db, contaId);
      return {
        modelo: 'claude-sonnet-5-5',
        async pedir(p) {
          recebidos.push({ agente: p.agente, mensagem: p.mensagem });
          if (falharTudo) {
            await medidor.depois(USO_ZERO, 0, false);
            throw new Error('falha de teste');
          }
          const uso = { ...USO_ZERO, entrada: 3000, saida: 800 };
          await medidor.depois(uso, 0.014, true);
          const chave = ['plano_cards', 'cards', 'revisao'].includes(p.ferramenta.nome)
            ? p.ferramenta.nome
            : p.agente;
          return { dados: RESPOSTAS[chave] ?? {}, uso, custoUsd: 0.014 };
        },
      };
    },
  };
}

describe.skipIf(!URL_TESTE)('carrosséis: os cards avulsos (com Postgres)', () => {
  let pool: Pool;
  let app: ReturnType<typeof criarApp>;
  let master = '';
  let rui = { contaId: 0, cookie: '' };
  const ia = iaFalsa();
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
      url: await bancoDeTeste(URL_TESTE!, 'carrosseis_cards'),
      aplicacao: 'teste-time',
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
    await pool?.end();
  });

  it('confere o cérebro da marca (antes, os cards não podem ser pedidos)', async () => {
    const antes = await mandar('post', '/carrosseis/cards', { assunto: 'Promoção da semana' });
    expect(antes.status).toBe(409);
    expect(antes.body.erro.codigo).toBe('cerebro');
    await mandar('post', '/carrosseis/cerebro/gerar');
    expect(await rodarUmPedido(pool, ia, log)).toBe(true);
    const c = (await ler('/carrosseis/cerebro')).body;
    const ok = await mandar('put', '/carrosseis/cerebro', { dossie: c.dossie, conferir: true });
    expect(ok.status).toBe(200);
  });

  it('o pedido confere a quantidade de peças e a palavra do comente', async () => {
    const muitas = await mandar('post', '/carrosseis/cards', {
      assunto: 'Promo',
      quantidade: 10,
      variacoes: 3,
    });
    expect(muitas.status).toBe(422);
    const semPalavra = await mandar('post', '/carrosseis/cards', { assunto: 'Promo', chamada: 'comentar' });
    expect(semPalavra.status).toBe(422);
    const semFoto = await mandar('post', '/carrosseis/cards', { assunto: 'Promo', fotos: [{ fotoId: 999 }] });
    expect(semFoto.status).toBe(422);
  });

  let lote = 0;
  it('pede 2 cards × 2 variações em story: cada variação vira uma peça de um slide', async () => {
    recebidos.length = 0;
    const p = await mandar('post', '/carrosseis/cards', {
      assunto: 'Promoção da pastilha e do óleo',
      objetivo: 'promocao',
      quantidade: 2,
      variacoes: 2,
      formato: 'story',
    });
    expect(p.status).toBe(201);
    expect(p.body).toMatchObject({ tipo: 'cards', situacao: 'fila' });
    lote = p.body.id;
    expect(await rodarUmPedido(pool, ia, log)).toBe(true);

    const est = recebidos.find((r) => r.agente === 'estrategista')!.mensagem;
    expect(est).toContain('exatamente 2 cards, cada um com 2 variações');
    expect(est).toContain('Story 9:16');

    const l = (await ler('/carrosseis/cards')).body.lotes;
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({
      pedidoId: lote,
      situacao: 'pronto',
      titulo: 'Promoções da semana',
      formato: 'story',
    });
    expect(l[0].cards.map((c: { card: number }) => c.card)).toEqual([1, 2]);
    const [v1, v2] = l[0].cards[0].variacoes;
    expect(v1).toMatchObject({ variacao: 1, escolhido: true });
    expect(v1.slide).toMatchObject({ modelo: 'numero', destaque: 'R$ 139,90' });
    expect(v2).toMatchObject({ variacao: 2, escolhido: false });
    // O modelo que não existe vira o padrão do objetivo (promoção: número).
    expect(l[0].cards[1].variacoes[1].slide.modelo).toBe('numero');

    // A peça é um "carrossel" de um slide, no formato story, fora da lista de carrosséis.
    const peca = (await ler(`/carrosseis/${v1.id}`)).body;
    expect(peca).toMatchObject({
      tipo: 'card',
      formato: 'story',
      pedidoId: lote,
      card: 1,
      variacao: 1,
      slides: 1,
    });
    expect(peca.legenda).toContain('#freios');
    expect((await ler('/carrosseis')).body.carrosseis).toHaveLength(0);
    // O ajuste do revisor (peça 2) foi para a variação 2 do card 1, como aviso do slide dela.
    const outraPeca = (await ler(`/carrosseis/${v2.id}`)).body;
    expect(outraPeca.relatorio.avisos).toHaveLength(1);
    expect(outraPeca.relatorio.avisos[0]).toMatchObject({
      tipo: 'tom',
      sugestao: { campo: 'titulo', valor: 'Chiou? Troque.' },
    });
    expect(peca.relatorio.avisos).toHaveLength(0);
    expect((await ler('/carrosseis/cards')).body.franquia.usados).toBe(1);
  });

  it('a imagem da peça em story sai em 1080 × 1920', async () => {
    const l = (await ler('/carrosseis/cards')).body.lotes[0];
    const img = await ler(`/carrosseis/${l.cards[0].variacoes[0].id}/slides/0`).buffer(true);
    expect(img.status).toBe(200);
    const { prepararImagem } = await import('@prospeccao/integrations/slides');
    const m = await prepararImagem(new Uint8Array(img.body as Buffer), { maxLado: 4000 });
    expect([m.largura, m.altura]).toEqual([1080, 1920]);
  });

  it('escolher outra variação, pedir mais uma e baixar as escolhidas', async () => {
    let l = (await ler('/carrosseis/cards')).body.lotes[0];
    const v2 = l.cards[0].variacoes[1];
    expect((await mandar('post', `/carrosseis/cards/escolher/${v2.id}`)).status).toBe(200);
    l = (await ler('/carrosseis/cards')).body.lotes[0];
    expect(l.cards[0].variacoes.map((v: { escolhido: boolean }) => v.escolhido)).toEqual([false, true]);

    recebidos.length = 0;
    const outra = await mandar('post', `/carrosseis/cards/${lote}/1/outra`, {
      pedido: 'Com foto de oficina',
    });
    expect(outra.status).toBe(201);
    expect((await ler('/carrosseis/cards')).body.lotes[0].trabalhando).toEqual([1]);
    expect(await rodarUmPedido(pool, ia, log)).toBe(true);
    const est = recebidos.find((r) => r.agente === 'estrategista')!.mensagem;
    expect(est).toContain('É UMA VARIAÇÃO NOVA');
    expect(est).toContain('Com foto de oficina');
    l = (await ler('/carrosseis/cards')).body.lotes;
    expect(l).toHaveLength(1);
    expect(l[0].cards[0].variacoes.map((v: { variacao: number }) => v.variacao)).toEqual([1, 2, 3]);
    expect(l[0].cards[0].variacoes[2].escolhido).toBe(false);
    expect(l[0].trabalhando).toEqual([]);
    // A outra variação não conta na franquia.
    expect((await ler('/carrosseis/cards')).body.franquia.usados).toBe(1);

    const zip = await ler(`/carrosseis/cards/${lote}/imagens.zip`)
      .buffer(true)
      .parse((res, cb) => {
        const partes: Buffer[] = [];
        res.on('data', (d: Buffer) => partes.push(d));
        res.on('end', () => cb(null, Buffer.concat(partes)));
      });
    expect(zip.status).toBe(200);
    const arquivos = unzipSync(new Uint8Array(zip.body as Buffer));
    expect(Object.keys(arquivos).sort()).toEqual(['card-01.jpg', 'card-02.jpg', 'legendas.txt']);
    expect(new TextDecoder().decode(arquivos['legendas.txt'])).toContain('CARD-01');
  });

  it('apagar o lote tira as peças (a franquia do mês continua contada)', async () => {
    expect((await mandar('delete', `/carrosseis/cards/${lote}`)).status).toBe(200);
    expect((await ler('/carrosseis/cards')).body.lotes).toHaveLength(0);
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM comercial.carrosseis WHERE tipo = 'card'`,
    );
    expect(rows[0]!.n).toBe(0);
    expect((await ler('/carrosseis/cards')).body.franquia.usados).toBe(1);
  });
});
