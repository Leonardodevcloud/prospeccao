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
const SEGREDO = 's'.repeat(40);

describe.skipIf(!URL_TESTE)('carteira com fila e grupos de atendimento', () => {
  let pool: Pool;
  let app: ReturnType<typeof criarApp>;
  let master = '';
  let contaId = 0;
  let ip = 0;
  const log = criarLogger('teste', 'silent');
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
  // Cada tentativa de um endereço diferente: o teste é da trava por pessoa, não do limite por endereço.
  const deOutroLugar = () => `10.77.${Math.floor(++ip / 250)}.${ip % 250}`;
  const cookieDe = (r: request.Response) =>
    ((r.headers['set-cookie'] as unknown as string[] | undefined) ?? [])[0]?.split(';')[0] ?? '';
  const entrar = (email: string, senha: string) =>
    request(app)
      .post('/auth/login')
      .set('Origin', ORIGEM)
      .set('X-Forwarded-For', deOutroLugar())
      .send({ email, senha });
  const comoMaster = (metodo: 'post' | 'patch', rota: string, corpo?: object) =>
    request(app)[metodo](rota).set('Origin', ORIGEM).set('Cookie', master).send(corpo);
  const comSenha = async (usuarioId: number, senha: string) =>
    expect((await comoMaster('patch', `/master/usuarios/${usuarioId}/acesso`, { senha })).status).toBe(200);

  beforeAll(async () => {
    pool = criarPool({
      url: await bancoDeTeste(URL_TESTE!, 'carteira'),
      aplicacao: 'teste-carteira',
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
        async publicarVarios(_n: string, p: unknown[]) {
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
    } as never);
    master = cookieDe(await entrar('dona@exemplo.com', 'senha-forte-123'));
    const r = await comoMaster('post', '/master/contas', {
      nome: 'Autopeças Carteira',
      primeiroAcesso: 'admin',
      admin: { nome: 'Ana Admin', email: 'ana@carteira.com.br' },
      plano: { plano: 'escala', modulos: [] },
    });
    expect(r.status).toBe(201);
    contaId = r.body.id;
  });

  afterAll(async () => {
    await pool?.end();
  });

  const idDe = async (email: string) =>
    (await pool.query<{ id: number }>('SELECT id FROM cadastro.usuarios WHERE email = $1', [email])).rows[0]!
      .id;
  const como = (cookie: string) => ({
    get: (rota: string) => request(app).get(rota).set('Cookie', cookie),
    enviar: (metodo: 'post' | 'put' | 'patch' | 'delete', rota: string, corpo?: object) =>
      request(app)[metodo](rota).set('Origin', ORIGEM).set('Cookie', cookie).send(corpo),
  });
  let ana: ReturnType<typeof como>;
  let bia: ReturnType<typeof como>;
  let caio: ReturnType<typeof como>;
  let lead = 0;

  it('lead sem dono: na fila, quem vê só a própria base vê e puxa; depois some para o colega', async () => {
    for (const [nome, email] of [
      ['Bia Vendas', 'bia@carteira.com.br'],
      ['Caio Vendas', 'caio@carteira.com.br'],
    ] as const) {
      const r = await comoMaster('post', `/master/contas/${contaId}/usuarios`, {
        nome,
        email,
        papel: 'sdr',
        alcance: 'proprios',
      });
      expect(r.status).toBe(201);
      await comSenha(await idDe(email), 'Senha-forte-1');
    }
    await comSenha(await idDe('ana@carteira.com.br'), 'Senha-forte-1');
    ana = como(cookieDe(await entrar('ana@carteira.com.br', 'Senha-forte-1')));
    expect(
      (
        await ana.enviar('post', '/nichos', {
          nome: 'Autopeças varejo',
          cnaes: ['4530-7/03'],
          termosMaps: ['autopeças'],
        })
      ).status,
    ).toBe(201);
    const criado = await ana.enviar('post', '/funil/leads', {
      empresa: 'Oficina do Zé',
      telefone: '71999990001',
    });
    expect(criado.status).toBe(201);
    lead = criado.body.empresaId;
    expect((await ana.enviar('patch', `/funil/${lead}`, { responsavelId: null })).status).toBe(200);

    // Sem a fila, o vendedor que vê só a própria base não enxerga o lead sem dono.
    bia = como(cookieDe(await entrar('bia@carteira.com.br', 'Senha-forte-1')));
    expect((await bia.get(`/funil/${lead}`)).status).toBe(404);

    expect((await ana.enviar('put', '/equipe/distribuicao', { sdr: 'fila', closer: 'mesmo' })).status).toBe(
      200,
    );
    bia = como(cookieDe(await entrar('bia@carteira.com.br', 'Senha-forte-1')));
    caio = como(cookieDe(await entrar('caio@carteira.com.br', 'Senha-forte-1')));
    expect((await bia.get('/auth/eu')).body.filaSemDono).toBe(true);
    expect((await bia.get(`/funil/${lead}`)).status).toBe(200);
    expect((await caio.get(`/funil/${lead}`)).status).toBe(200);

    const puxou = await bia.enviar('post', `/funil/${lead}/puxar`);
    expect(puxou.status).toBe(200);
    // Já é da Bia: some da fila do Caio.
    const tarde = await caio.enviar('post', `/funil/${lead}/puxar`);
    expect(tarde.status).toBe(404);
    // Puxar de novo o que já é seu não dá erro.
    expect((await bia.enviar('post', `/funil/${lead}/puxar`)).status).toBe(200);
    const { rows } = await pool.query(
      'SELECT responsavel_id FROM comercial.oportunidades WHERE empresa_id = $1',
      [lead],
    );
    expect(rows[0]?.responsavel_id).toBe(await idDe('bia@carteira.com.br'));
  });

  it('grupos de atendimento: só administrador cria; membros só da equipe; nome único', async () => {
    const bia_id = await idDe('bia@carteira.com.br');
    const caio_id = await idDe('caio@carteira.com.br');
    expect((await bia.enviar('post', '/equipe/grupos', { nome: 'Loja Centro', membros: [] })).status).toBe(
      403,
    );
    const r = await ana.enviar('post', '/equipe/grupos', { nome: 'Loja Centro', membros: [bia_id, caio_id] });
    expect(r.status).toBe(201);
    expect(r.body.grupos[0]).toMatchObject({ nome: 'Loja Centro' });
    expect(r.body.grupos[0].membros.map((m: { nome: string }) => m.nome)).toEqual([
      'Bia Vendas',
      'Caio Vendas',
    ]);
    expect((await ana.enviar('post', '/equipe/grupos', { nome: 'loja centro' })).status).toBe(409);
    // Alguém de fora da conta (o master) não entra no grupo.
    const fora = await ana.enviar('put', `/equipe/grupos/${r.body.id}`, {
      nome: 'Loja Centro',
      membros: [1],
    });
    expect(fora.status).toBe(422);
    const editado = await ana.enviar('put', `/equipe/grupos/${r.body.id}`, {
      nome: 'Loja Norte',
      membros: [caio_id],
    });
    expect(editado.body).toEqual([
      { id: r.body.id, nome: 'Loja Norte', membros: [{ id: caio_id, nome: 'Caio Vendas' }] },
    ]);
    expect((await ana.enviar('delete', `/equipe/grupos/${r.body.id}`)).body).toEqual([]);
  });
});
