import { criarPool, migrar, type Pool } from '@prospeccao/db';
import { bancoDeTeste } from '@prospeccao/db/teste';
import { criarLogger } from '@prospeccao/shared';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../src/app.js';
import type { ServicosConta } from '../src/servicos.js';

const URL_TESTE = process.env.TEST_DATABASE_URL;
const ORIGEM = 'http://localhost:5173';

describe.skipIf(!URL_TESTE)('painel master: financeiro, configurações e CRM de demonstração', () => {
  let pool: Pool;
  let app: ReturnType<typeof criarApp>;
  let cookie = '';
  const log = criarLogger('teste', (process.env.LOG_TESTE as 'error') ?? 'silent');

  const servicos = async (contaId: number): Promise<ServicosConta> => ({
    contaId,
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

  const ler = (rota: string, c = cookie) => request(app).get(rota).set('Cookie', c);
  const enviar = (rota: string, corpo?: object, c = cookie) =>
    request(app).post(rota).set('Origin', ORIGEM).set('Cookie', c).send(corpo);

  beforeAll(async () => {
    pool = criarPool({
      url: await bancoDeTeste(URL_TESTE!, 'demonstracao'),
      aplicacao: 'teste-demo',
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
        jwtSegredo: 'd'.repeat(40),
        adminEmail: 'dona@exemplo.com',
        adminSenhaHash: await bcrypt.hash('senha-forte-123', 4),
        sessaoHoras: 1,
        cookieSeguro: false,
      },
      origens: [ORIGEM],
      servicos,
      credenciais: {
        chave: null,
        ambiente: { iaKey: 'x'.repeat(20), iaProvedor: 'deepseek' },
        invalidar() {},
      },
    });
    const ok = await request(app)
      .post('/auth/login')
      .set('Origin', ORIGEM)
      .send({ email: 'dona@exemplo.com', senha: 'senha-forte-123' });
    expect(ok.status).toBe(200);
    cookie = (ok.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('recria o CRM de demonstração (duas vezes, sem sobrar nada) e ele fica fora do financeiro', async () => {
    const r1 = await enviar('/master/plataforma/demonstracao/recriar');
    expect(r1.status).toBe(200);
    const contaId = r1.body.contaId as number;
    const contar = async () => {
      const { rows } = await pool.query(
        `SELECT (SELECT count(*) FROM descoberta.empresas WHERE demonstracao)::int AS empresas,
                (SELECT count(*) FROM comercial.oportunidades WHERE conta_id = $1)::int AS oportunidades,
                (SELECT count(*) FROM comercial.mensagens WHERE conta_id = $1)::int AS mensagens,
                (SELECT count(*) FROM comercial.sala_sessoes WHERE conta_id = $1 AND resumo IS NOT NULL)::int AS reunioes,
                (SELECT count(*) FROM comercial.roteiro_paradas WHERE conta_id = $1)::int AS paradas,
                (SELECT count(*) FROM cadastro.usuarios WHERE conta_id = $1)::int AS usuarios,
                (SELECT count(*) FROM enriquecimento.leads l JOIN cadastro.campanhas c ON c.id = l.campanha_id WHERE c.conta_id = $1)::int AS leads`,
        [contaId],
      );
      return rows[0];
    };
    const antes = await contar();
    expect(antes).toMatchObject({ empresas: 150, oportunidades: 99, usuarios: 5, leads: 150, paradas: 7 });
    expect(antes.mensagens).toBeGreaterThan(30);
    expect(antes.reunioes).toBeGreaterThan(5);

    // Recriar de novo: mesma conta, mesmos números (nada duplica).
    const r2 = await enviar('/master/plataforma/demonstracao/recriar');
    expect(r2.body.contaId).toBe(contaId);
    expect(await contar()).toEqual(antes);

    // Fora da lista de clientes e do financeiro.
    expect(((await ler('/master/contas')).body as { id: number }[]).some((c) => c.id === contaId)).toBe(
      false,
    );
    const fin = (await ler('/master/plataforma/clientes')).body.clientes as { unidades: { id: number }[] }[];
    expect(fin.some((c) => c.unidades.some((u) => u.id === contaId))).toBe(false);

    // As campanhas de demonstração não aparecem para a busca de empresas.
    const { rows: vistas } = await pool.query(
      'SELECT count(*)::int AS n FROM cadastro.v_campanhas_descoberta WHERE conta_id = $1',
      [contaId],
    );
    expect(vistas[0].n).toBe(0);

    // Entrar: a sessão passa para a conta de demonstração e a tela sabe disso.
    const entrou = await enviar('/master/plataforma/demonstracao/entrar');
    expect(entrou.status).toBe(200);
    const novo = (entrou.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    const eu = (await ler('/auth/eu', novo)).body;
    expect(eu.conta).toMatchObject({ id: contaId, demonstracao: true });
    expect(eu.foraDaPropria).toBe(true);
    // O funil e as conversas têm dados.
    expect((await ler('/funil', novo)).status).toBe(200);
    expect((await ler('/conversas', novo)).body.length).toBeGreaterThan(5);
    expect((await ler('/reunioes?quais=realizadas', novo)).body.length).toBeGreaterThan(5);
    await enviar('/master/sair', {}, novo);
  });

  it('financeiro: o que o cliente contratou, franquias e configuração', async () => {
    const criado = await enviar('/master/contas', {
      nome: 'Clínica Teste Financeiro',
      admin: { nome: 'Bia', email: 'bia@financeiro.com.br' },
      plano: { plano: 'time', modulos: ['whatsapp', 'agente_ia'], numerosExtras: 1 },
    });
    expect(criado.status).toBe(201);
    const fin = (await ler('/master/plataforma/clientes')).body.clientes as {
      nome: string;
      mensalidade: number;
      contratado: {
        modulos: string[];
        numerosExtras: number;
        itens: { rotulo: string; valor: number; grupo: string }[];
      };
      franquias: Record<string, { uso: number; limite: number | null }>;
      configuracao: { item: string; estado: string }[];
      custo: { reunioes: number };
    }[];
    const c = fin.find((x) => x.nome === 'Clínica Teste Financeiro')!;
    expect(c.mensalidade).toBe(1300 + 999 + 110);
    expect(c.contratado.modulos).toEqual(['whatsapp', 'agente_ia', 'email']);
    expect(c.contratado.itens.map((i) => i.grupo)).toEqual(['plano', 'whatsapp_ia', 'incluso', 'numeros']);
    expect(c.franquias.horasReuniao).toEqual({ uso: 0, limite: 30 });
    expect(c.franquias.numeros).toEqual({ uso: 0, limite: 4 });
    expect(c.franquias.conversasIa?.limite).toBeNull();
    expect(Object.fromEntries(c.configuracao.map((i) => [i.item, i.estado]))).toEqual({
      whatsapp: 'pendente',
      email: 'pendente',
      ia: 'pendente',
      equipe: 'pendente',
      campanha: 'pendente',
    });
    expect(c.custo.reunioes).toBe(0);
  });

  it('configurações da plataforma: o que está ligado e o que falta', async () => {
    const r = (await ler('/master/plataforma/servicos')).body as {
      servicos: { id: string; estado: string }[];
      contaPrincipalId: number;
      demonstracao: { contaId: number } | null;
    };
    const estado = Object.fromEntries(r.servicos.map((s) => [s.id, s.estado]));
    expect(estado).toMatchObject({
      whatsapp: 'falta',
      email: 'falta',
      ia: 'ok',
      livekit: 'falta',
      groq: 'falta',
    });
    expect(r.contaPrincipalId).toBe(1);
    expect(r.demonstracao?.contaId).toBeGreaterThan(1);
  });
});
