import { criarPool, migrar, type Pool } from '@prospeccao/db';
import { bancoDeTeste } from '@prospeccao/db/teste';
import { type ClienteClaude, USO_ZERO } from '@prospeccao/integrations/carrosseis';
import { criarLogger } from '@prospeccao/shared';
import bcrypt from 'bcryptjs';
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
  estrategista: {
    titulo: 'Pastilha em promoção',
    angulo: 'O chiado é o aviso',
    ganchos: [
      'Freio chiando? É a pastilha pedindo troca',
      'A pastilha avisa uma vez',
      'R$ 139,90 e o chiado some',
    ],
    escolhido: 0,
    porque: 'Os clientes perguntam quando trocar a pastilha.',
    fontes: ['O que divulgar', 'Perguntas dos clientes'],
    slides: [
      { modelo: 'capa', ideia: 'gancho' },
      { modelo: 'texto', ideia: 'o sinal' },
      { modelo: 'numero', ideia: 'o preço' },
      { modelo: 'chamada', ideia: 'comente' },
    ],
  },
  redator: {
    slides: [
      { modelo: 'capa', sobretitulo: 'Freios', titulo: 'Freio chiando? É a pastilha pedindo troca' },
      {
        modelo: 'texto',
        titulo: 'O chiado é o aviso',
        texto: 'A pastilha gasta faz barulho antes de frear mal.',
      },
      { modelo: 'numero', destaque: 'R$ 139,90', titulo: 'Pastilha com instalação', texto: 'Até 30/11.' },
      { modelo: 'chamada', titulo: 'Quer a sua?', botao: 'x', texto: 'Respondemos no direct.' },
    ],
    legenda: 'Freio chiando? Não espere.',
    hashtags: ['freios', 'salvador'],
    // O pedido num slide só usa este campo.
    slide: { modelo: 'texto', titulo: 'Chiou, trocou', texto: 'Simples.' },
  },
  revisor: {
    notas: notas(5),
    ajustes: [
      { slide: 2, campo: 'texto', tipo: 'tom', problema: 'Pode ser mais direto', sugestao: 'Chiou? Troque.' },
    ],
    fatos: [],
  },
};
let falharTudo = false;

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
          return { dados: RESPOSTAS[p.agente] ?? {}, uso, custoUsd: 0.014 };
        },
      };
    },
  };
}

describe.skipIf(!URL_TESTE)('carrosséis: o time de IA (com Postgres)', () => {
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
      url: await bancoDeTeste(URL_TESTE!, 'carrosseis_time'),
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

  it('a situação diz que o time está ligado e o cérebro ainda não foi conferido', async () => {
    const s = await ler('/carrosseis/situacao');
    expect(s.body).toMatchObject({ modulo: true, ia: { ligada: true, cerebroConferido: false } });
    const p = await mandar('post', '/carrosseis/time', { assunto: 'Freio chiando' });
    expect(p.status).toBe(409);
    expect(p.body.erro.codigo).toBe('cerebro');
  });

  it('o cérebro da marca: a IA monta o rascunho, a pessoa corrige e confere', async () => {
    const g = await mandar('post', '/carrosseis/cerebro/gerar');
    expect(g.status).toBe(202);
    // Pedir de novo com um na fila devolve o mesmo.
    expect((await mandar('post', '/carrosseis/cerebro/gerar')).body.id).toBe(g.body.id);
    expect(await rodarUmPedido(pool, ia, log)).toBe(true);
    const c = (await ler('/carrosseis/cerebro')).body;
    expect(c).toMatchObject({ conferidoEm: null, faltando: [], pedido: null });
    expect(c.dossie).toMatchObject({
      nicho: 'Autopeças para oficinas em Salvador',
      pilares: ['Freios', 'Manutenção', 'Promoções'],
    });
    expect(c.fontes.find((f: { rotulo: string }) => f.rotulo === 'Posts do Instagram')).toMatchObject({
      quantos: 0,
    });
    // Conferir sem o mínimo: recusa. Com o mínimo: vale.
    const vazio = await mandar('put', '/carrosseis/cerebro', {
      dossie: { ...c.dossie, tom: '' },
      conferir: true,
    });
    expect(vazio.status).toBe(422);
    const ok = await mandar('put', '/carrosseis/cerebro', {
      dossie: { ...c.dossie, nuncaDizer: ['o mais barato da cidade'] },
      conferir: true,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.conferidoEm).toBeTruthy();
    expect(ok.body.conferidoPor).toBe('Rui');
  });

  let divulgarId = 0;
  it('o que divulgar: a promoção, com o que vale até a data', async () => {
    const r = await mandar('post', '/carrosseis/divulgar', {
      tipo: 'promocao',
      titulo: 'Pastilha com instalação grátis',
      produto: 'Pastilha dianteira',
      precoPor: 'R$ 139,90',
      validade: 'até 30/11',
      ate: '2099-12-31',
    });
    expect(r.status).toBe(201);
    divulgarId = r.body.id;
    await mandar('post', '/carrosseis/divulgar', {
      tipo: 'data',
      titulo: 'Dia do Mecânico',
      ate: '2020-12-20',
    });
    expect((await ler('/carrosseis/divulgar')).body.itens).toHaveLength(1);
    expect((await ler('/carrosseis/divulgar?antigos=sim')).body.itens).toHaveLength(2);
  });

  let carrosselId = 0;
  it('pede, o time trabalha, o carrossel nasce com o relatório e o aviso chega', async () => {
    recebidos.length = 0;
    const p = await mandar('post', '/carrosseis/time', {
      assunto: 'Promoção da pastilha',
      divulgarId,
      objetivo: 'vender',
      chamada: 'comentar',
      palavra: 'freio',
    });
    expect(p.status).toBe(201);
    expect(p.body).toMatchObject({ situacao: 'fila', tipo: 'carrossel' });
    expect((await ler('/carrosseis')).body.pedidos).toHaveLength(1);

    expect(await rodarUmPedido(pool, ia, log)).toBe(true);
    const pronto = (await ler(`/carrosseis/time/${p.body.id}`)).body;
    expect(pronto.situacao).toBe('pronto');
    expect(pronto.detalhes.estrategista).toContain('Freio chiando?');
    carrosselId = pronto.carrosselId;

    // O estrategista leu o cérebro conferido e a promoção.
    const est = recebidos.find((r) => r.agente === 'estrategista')!.mensagem;
    expect(est).toContain('Preço por (exato): R$ 139,90');

    const c = (await ler(`/carrosseis/${carrosselId}`)).body;
    expect(c).toMatchObject({ origem: 'ia', titulo: 'Pastilha em promoção', avisosAbertos: 1 });
    expect(c.conteudo.at(-1).botao).toBe('Comente FREIO');
    expect(c.legenda).toContain('#freios #salvador');
    expect(c.relatorio).toMatchObject({
      divulgarId,
      gancho: 'Freio chiando? É a pastilha pedindo troca',
      aprovado: true,
    });
    expect(c.relatorio.avisos[0]).toMatchObject({ slideId: 's2', tipo: 'tom', resolvido: null });

    // Quem pediu recebe o aviso; o consumo do Claude ficou registrado na conta.
    const avisos = (await ler('/notificacoes')).body;
    expect(JSON.stringify(avisos)).toContain('Seu carrossel ficou pronto');
    const { rows } = await pool.query<{ chamadas: number; custo: number }>(
      'SELECT chamadas, custo_usd::float8 AS custo FROM cadastro.consumo_carrosseis WHERE conta_id = $1',
      [rui.contaId],
    );
    expect(rows[0]!.chamadas).toBeGreaterThanOrEqual(4);
    expect(rows[0]!.custo).toBeGreaterThan(0);
    expect((await ler('/carrosseis')).body.pedidos).toHaveLength(0);
    expect((await ler('/carrosseis/divulgar')).body.itens[0].usado).toBe(1);
  });

  it('o revisor: usar a sugestão ou manter marca o aviso como decidido', async () => {
    const c = (await ler(`/carrosseis/${carrosselId}`)).body;
    const r = await mandar('post', `/carrosseis/${carrosselId}/avisos/${c.relatorio.avisos[0].id}`, {
      acao: 'usar',
    });
    expect(r.status).toBe(200);
    expect(r.body.relatorio.avisos[0].resolvido).toBe('usou');
    const depois = (await ler(`/carrosseis/${carrosselId}`)).body;
    expect(depois.avisosAbertos).toBe(0);
    // Decidir o aviso não muda a versão (o editor aberto continua salvando).
    expect(depois.versao).toBe(c.versao);
    expect(
      (await mandar('post', `/carrosseis/${carrosselId}/avisos/nao-existe`, { acao: 'manter' })).status,
    ).toBe(404);
  });

  it('pedido ao redator num slide devolve o slide novo sem salvar', async () => {
    const c = (await ler(`/carrosseis/${carrosselId}`)).body;
    recebidos.length = 0;
    const r = await mandar('post', `/carrosseis/${carrosselId}/slides/1/pedir`, {
      pedido: { rapido: 'curto' },
      slides: c.conteudo,
      estilo: c.estilo,
    });
    expect(r.status).toBe(200);
    expect(r.body.slide).toMatchObject({ id: 's2', modelo: 'texto', titulo: 'Chiou, trocou' });
    expect(recebidos[0]!.mensagem).toContain('Deixe o slide bem mais curto');
    expect((await ler(`/carrosseis/${carrosselId}`)).body.conteudo[1].titulo).toBe(c.conteudo[1].titulo);
    expect(
      (
        await mandar('post', `/carrosseis/${carrosselId}/slides/9/pedir`, {
          pedido: { rapido: 'curto' },
          slides: c.conteudo,
          estilo: c.estilo,
        })
      ).status,
    ).toBe(404);
  });

  it('falhou: não conta na franquia, avisa e diz o que fazer', async () => {
    falharTudo = true;
    const antes = (await ler('/carrosseis/situacao')).body.franquia.usados;
    const p = await mandar('post', '/carrosseis/time', { assunto: 'Suspensão' });
    expect((await ler('/carrosseis/situacao')).body.franquia.usados).toBe(antes + 1);
    await rodarUmPedido(pool, ia, log);
    falharTudo = false;
    const f = (await ler(`/carrosseis/time/${p.body.id}`)).body;
    expect(f.situacao).toBe('falhou');
    expect(f.erro).toMatch(/Peça de novo/);
    expect((await ler('/carrosseis/situacao')).body.franquia.usados).toBe(antes);
  });

  it('franquia do mês: no limite, o time recusa e o administrador é avisado', async () => {
    const plano = await mandar(
      'put',
      `/master/contas/${rui.contaId}/plano`,
      { plano: 'escala', modulos: ['carrosseis'], carrosseisMes: 2 },
      master,
    );
    expect(plano.status).toBe(200);
    const p = await mandar('post', '/carrosseis/time', { assunto: 'Filtro de óleo' });
    expect(p.status).toBe(201);
    const recusado = await mandar('post', '/carrosseis/time', { assunto: 'Mais um' });
    expect(recusado.status).toBe(403);
    expect(recusado.body.erro.codigo).toBe('franquia');
    expect(JSON.stringify((await ler('/notificacoes')).body)).toContain(
      'Você usou os 2 carrosséis do time de IA',
    );
    // Na fila, dá para cancelar (e a vaga volta).
    expect((await mandar('post', `/carrosseis/time/${p.body.id}/cancelar`)).status).toBe(200);
    expect((await ler('/carrosseis/situacao')).body.franquia).toMatchObject({ usados: 1, limite: 2 });
  });

  it('a plataforma: o serviço do Claude aparece nas configurações e o custo vai para o cliente', async () => {
    const cfg = (await ler('/master/plataforma/servicos', master)).body;
    const claude = cfg.servicos.find((s: { id: string }) => s.id === 'claude');
    expect(claude).toMatchObject({ estado: 'ok', testavel: true });
    expect((await mandar('post', '/master/plataforma/servicos/claude/testar', {}, master)).body).toEqual({
      ok: true,
      resultado: 'ok (claude-sonnet-5-5)',
    });
    const fin = (await ler('/master/plataforma/clientes', master)).body;
    const cli = fin.clientes.find((c: { nome: string }) => c.nome === 'Auto Peças Horizonte');
    expect(cli.custo.carrosseis).toBeGreaterThan(0);
  });
});
