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

const ESTRATEGIA = {
  titulo: 'Quando trocar a pastilha',
  angulo: 'O chiado é o aviso',
  ganchos: ['Freio chiando? É a pastilha', 'A pastilha avisa uma vez', 'O chiado some'],
  escolhido: 0,
  porque: 'Os clientes perguntam quando trocar a pastilha.',
  fontes: ['Perguntas dos clientes'],
  slides: [
    { modelo: 'capa', ideia: 'gancho' },
    { modelo: 'texto', ideia: 'o sinal' },
    { modelo: 'texto', ideia: 'o risco' },
    { modelo: 'chamada', ideia: 'chama' },
  ],
};

const REDACAO = {
  slides: [
    { modelo: 'capa', sobretitulo: 'Freios', titulo: 'Freio chiando? É a pastilha' },
    { modelo: 'texto', titulo: 'O chiado é o aviso', texto: 'A pastilha gasta faz barulho.' },
    { modelo: 'texto', titulo: 'Não espere o disco', texto: 'Depois do chiado, o disco sofre.' },
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

const IDEIAS = {
  ideias: [
    {
      titulo: 'Os 3 sinais de que a pastilha acabou',
      gancho: 'Seu freio já avisou 3 vezes',
      formato: 'Lista · 5 slides',
      objetivo: 'ensinar',
      slides: 5,
      chamada: 'salvar',
      teste: false,
      fontes: [{ rotulo: 'CONVERSAS', texto: '"Quando trocar a pastilha?" chegou 14 vezes' }],
    },
    {
      // A evidência inventa um número que não está na fonte: a ideia sai.
      titulo: 'A pergunta que mais chega',
      gancho: 'Todo mundo pergunta isso',
      formato: 'Pergunta e resposta',
      objetivo: 'ensinar',
      slides: 6,
      chamada: 'salvar',
      teste: false,
      fontes: [{ rotulo: 'CONVERSAS', texto: 'Chegou 99 vezes no WhatsApp' }],
    },
    {
      titulo: 'Antes e depois do disco riscado',
      gancho: 'O disco que custou o dobro',
      formato: 'Comparação · 6 slides',
      objetivo: 'vender',
      slides: 6,
      chamada: 'whatsapp',
      teste: true,
      fontes: [],
    },
  ],
};

const pedidos: { agente: string; ferramenta: string; mensagem: string }[] = [];

function iaFalsa(): CarrosseisIa {
  return {
    modelo: 'claude-sonnet-5-5',
    testar: async () => 'ok',
    imagem: null,
    armazenamento: null,
    cliente(db, contaId): ClienteClaude {
      const medidor = medidorClaude(db, contaId);
      return {
        modelo: 'claude-sonnet-5-5',
        async pedir(p) {
          pedidos.push({ agente: p.agente, ferramenta: p.ferramenta.nome, mensagem: p.mensagem });
          await medidor.depois(USO_ZERO, 0.001, true);
          const dados: Record<string, unknown> =
            p.ferramenta.nome === 'ideias'
              ? IDEIAS
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

describe.skipIf(!URL_TESTE)('v134: o time aprende com os posts (com Postgres)', () => {
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
      url: await bancoDeTeste(URL_TESTE!, 'carrosseis_aprender'),
      aplicacao: 'teste-aprender',
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

  it('prepara: o cérebro conferido e os posts com números (4 listas do CRM e 4 posts de fora)', async () => {
    await pool.query(
      `INSERT INTO comercial.carrossel_cerebro (conta_id, dados, conferido_em) VALUES ($1, $2, now())`,
      [
        rui.contaId,
        JSON.stringify({
          nicho: 'Autopeças',
          publico: 'Oficinas',
          tom: 'Direto',
          perguntas: [{ texto: 'Quando trocar a pastilha?', vezes: 14, fonte: 'WhatsApp' }],
          objecoes: [{ diz: 'Está caro', resposta: 'Dura o dobro' }],
        }),
      ],
    );
    const lista = (titulo: string) => [
      { modelo: 'capa', titulo },
      { modelo: 'lista', titulo: 'Os sinais', itens: ['a', 'b'] },
      { modelo: 'texto', titulo: 'Um', texto: 'x' },
      { modelo: 'texto', titulo: 'Dois', texto: 'y' },
      { modelo: 'chamada', titulo: 'Fale com a gente', botao: 'Chame no WhatsApp' },
    ];
    for (let i = 0; i < 4; i++) {
      const finais = lista(`Lista ${i}`);
      // O time entregou títulos longos; quem publica encurtou (o time aprende com a edição).
      const doTime = finais.map((s) => ({
        ...s,
        titulo: `${s.titulo} — explicado com muito mais palavras do que precisa`,
      }));
      await pool.query(
        `INSERT INTO comercial.carrosseis (conta_id, titulo, estilo, situacao, slides, slides_do_time, origem, midia_id, criado_em)
         VALUES ($1, $2, 'editorial', 'publicado', $3, $4, 'ia', $5, now() - interval '60 days')`,
        [rui.contaId, `Lista ${i}`, JSON.stringify(finais), JSON.stringify(doTime), `m-lista-${i}`],
      );
    }
    for (let i = 0; i < 8; i++)
      await pool.query(
        `INSERT INTO comercial.instagram_midias (conta_id, midia_id, legenda, tipo, publicado_em, alcance, salvos, compartilhamentos, interacoes)
         VALUES ($1, $2, $3, 'CAROUSEL_ALBUM', now() - ($4 || ' days')::interval, 1000, $5, 5, 50)`,
        [rui.contaId, i < 4 ? `m-lista-${i}` : `m-fora-${i}`, `Post ${i}`, String(i + 2), i < 4 ? 100 : 20],
      );
  });

  it('mostra o que o time aprendeu: a lista rende mais salvos e quem publica encurta os títulos', async () => {
    const r = await ler('/carrosseis/aprendizados');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ posts: 8, doCrm: 4 });
    const lista = (
      r.body.aprendizados as { id: string; metrica: string; vezes: number; linha: string }[]
    ).find((a) => a.id === 'lista')!;
    expect(lista).toMatchObject({ metrica: 'salvos', confianca: 'media', evita: false });
    expect(lista.vezes).toBeGreaterThan(1.5);
    expect(lista.linha).toContain('Lista e passo a passo');
    expect(r.body.preferencias[0].texto).toContain('encurtar os títulos');
    expect(r.body.melhorHorario).toBeTruthy();
  });

  it('busca ideias: cada uma com a fonte; número inventado sai; o teste vem marcado', async () => {
    const b = await mandar('post', '/carrosseis/ideias/buscar', {});
    expect(b.status).toBe(202);
    // Pedir de novo enquanto busca devolve o mesmo pedido.
    expect((await mandar('post', '/carrosseis/ideias/buscar', {})).body.id).toBe(b.body.id);
    expect((await ler('/carrosseis/ideias')).body.buscando).toBe(true);
    expect(await rodarUmPedido(pool, ia, log)).toBe(true);
    const r = (await ler('/carrosseis/ideias')).body;
    expect(r.buscando).toBe(false);
    expect(r.ideias.map((i: { titulo: string }) => i.titulo).sort()).toEqual([
      'Antes e depois do disco riscado',
      'Os 3 sinais de que a pastilha acabou',
    ]);
    const teste = r.ideias.find((i: { teste: boolean }) => i.teste);
    expect(teste.fontes[0].rotulo).toBe('TESTE');
    // O estrategista recebeu as fontes de verdade (conversas, Instagram e o que o time aprendeu).
    const m = pedidos.find((p) => p.ferramenta === 'ideias')!.mensagem;
    expect(m).toContain('[CONVERSAS]');
    expect(m).toContain('(14 vezes)');
    expect(m).toContain('[APRENDIDO]');
    expect(m).toContain('Lista e passo a passo');
    // A busca de ideias não aparece na lista de carrosséis sendo feitos.
    expect((await ler('/carrosseis/time')).body.pedidos).toHaveLength(0);
  });

  it('a ideia vira carrossel: o time leva o aprendido, guarda os slides do time e marca a ideia', async () => {
    const ideias = (await ler('/carrosseis/ideias')).body.ideias as { id: number; teste: boolean }[];
    const ideia = ideias.find((i) => !i.teste)!;
    pedidos.length = 0;
    const p = await mandar('post', '/carrosseis/time', {
      assunto: 'Os 3 sinais de que a pastilha acabou',
      ideiaId: ideia.id,
    });
    expect(p.status).toBe(201);
    expect(await rodarUmPedido(pool, ia, log)).toBe(true);
    const pedido = (await ler(`/carrosseis/time/${p.body.id}`)).body;
    expect(pedido.situacao).toBe('pronto');
    const estrategista = pedidos.find((x) => x.agente === 'estrategista')!.mensagem;
    expect(estrategista).toContain('O QUE O TIME APRENDEU');
    expect(estrategista).toContain('Lista e passo a passo');
    const redator = pedidos.find((x) => x.agente === 'redator')!.mensagem;
    expect(redator).toContain('encurtar os títulos');
    const { rows } = await pool.query<{ slides_do_time: unknown[] | null; slides: unknown[] }>(
      'SELECT slides_do_time, slides FROM comercial.carrosseis WHERE id = $1',
      [pedido.carrosselId],
    );
    expect(rows[0]!.slides_do_time).toEqual(rows[0]!.slides);
    const depois = (await ler('/carrosseis/ideias')).body.ideias as {
      id: number;
      usadaEm: string | null;
      carrosselId: number | null;
    }[];
    expect(depois.find((i) => i.id === ideia.id)).toMatchObject({ carrosselId: pedido.carrosselId });
    expect(depois.find((i) => i.id === ideia.id)!.usadaEm).toBeTruthy();
  });

  it('descarta ideia', async () => {
    const ideias = (await ler('/carrosseis/ideias')).body.ideias as { id: number; teste: boolean }[];
    const teste = ideias.find((i) => i.teste)!;
    expect((await mandar('post', `/carrosseis/ideias/${teste.id}/descartar`, {})).status).toBe(200);
    expect((await ler('/carrosseis/ideias')).body.ideias).toHaveLength(1);
  });

  it('contas de referência: o @ é conferido; sem o Instagram conectado, fica o aviso', async () => {
    expect((await mandar('post', '/carrosseis/referencias-contas', { usuario: 'não vale!' })).status).toBe(
      422,
    );
    const r = await mandar('post', '/carrosseis/referencias-contas', {
      usuario: 'https://www.instagram.com/AutoPecasDoBairro/',
    });
    expect(r.status).toBe(201);
    expect(r.body.contas[0]).toMatchObject({ usuario: 'autopecasdobairro', lidoEm: null });
    expect(r.body.contas[0].erro).toContain('Conecte o Instagram');
    const l = (await ler('/carrosseis/referencias-contas')).body;
    expect(l.max).toBe(5);
    expect((await mandar('delete', `/carrosseis/referencias-contas/${l.contas[0].id}`)).status).toBe(200);
    expect((await ler('/carrosseis/referencias-contas')).body.contas).toHaveLength(0);
  });

  it('o Argos lê os carrosséis pela view do cérebro', async () => {
    const { rows } = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM cerebro.carrosseis');
    expect(rows[0]!.n).toBeGreaterThanOrEqual(0);
  });
});
