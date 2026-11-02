import { criarPool, migrar, type Pool } from '@prospeccao/db';
import { bancoDeTeste } from '@prospeccao/db/teste';
import { criarLogger } from '@prospeccao/shared';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../src/app.js';
import { caminhoParaLog } from '../src/middlewares/logs.js';
import { validarSql } from '../src/modulos/assistente/acesso.js';
import type { ServicosConta } from '../src/servicos.js';

const URL_TESTE = process.env.TEST_DATABASE_URL;
const ORIGEM = 'http://localhost:5173';
const SEGREDO = 's'.repeat(40);

describe('segurança: o que vai para o log e o SQL do Argos', () => {
  it('tokens do caminho e a busca não vão para o log', () => {
    expect(caminhoParaLog('/auth/convite/abc123XYZ')).toBe('/auth/convite/…');
    expect(caminhoParaLog('/api/auth/redefinir/tok?x=1')).toBe('/api/auth/redefinir/…');
    expect(caminhoParaLog('/webhooks/whatsapp/0123abcd')).toBe('/webhooks/whatsapp/…');
    expect(caminhoParaLog('/calendario/segredo.ics')).toBe('/calendario/…');
    expect(caminhoParaLog('/e/c/tok/2')).toBe('/e/c/…/2');
    expect(caminhoParaLog('/conversas/nao-identificados/71999998888/vincular')).toBe(
      '/conversas/nao-identificados/…/vincular',
    );
    expect(caminhoParaLog('/empresas?q=Joana%20Silva')).toBe('/empresas');
    expect(caminhoParaLog('/campanhas/12')).toBe('/campanhas/12');
  });

  it('o Argos não chega ao catálogo do banco por nome entre aspas', () => {
    expect(() => validarSql(`SELECT query FROM "pg_stat_activity" WHERE 'leads' <> ''`)).toThrow();
    expect(() => validarSql('SELECT * FROM "cadastro"."usuarios"')).toThrow();
    expect(() => validarSql('SELECT * FROM U&"\\0070g_stat_activity"')).toThrow();
    expect(validarSql('SELECT nome AS "Nome do lead" FROM leads')).toContain('Nome do lead');
  });
});

/** Sessão, duas etapas, travas de login e convites. */
describe.skipIf(!URL_TESTE)('segurança: login e convites', () => {
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
    pool = criarPool({ url: await bancoDeTeste(URL_TESTE!, 'seguranca'), aplicacao: 'teste-seg', max: 4 });
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
      nome: 'Loja Segura',
      primeiroAcesso: 'gestor',
      admin: { nome: 'Gil Gestor', email: 'gil@lojasegura.com.br' },
      plano: { plano: 'escala', modulos: [] },
    });
    expect(r.status).toBe(201);
    contaId = r.body.id;
  });

  afterAll(async () => {
    await pool?.end();
  });

  const usuario = async (email: string) =>
    (
      await pool.query<{ id: number; convite_token: string | null }>(
        'SELECT id, convite_token FROM cadastro.usuarios WHERE email = $1',
        [email],
      )
    ).rows[0]!;

  it('o banco guarda só o hash do convite; o link continua valendo', async () => {
    const r = await comoMaster('post', `/master/contas/${contaId}/usuarios`, {
      nome: 'Ana Admin',
      email: 'ana@lojasegura.com.br',
      papel: 'admin',
    });
    expect(r.status).toBe(201);
    const token = String(r.body.convite).split('/').at(-1)!;
    const u = await usuario('ana@lojasegura.com.br');
    expect(u.convite_token).toMatch(/^[0-9a-f]{64}$/);
    expect(u.convite_token).not.toBe(token);
    expect((await request(app).get(`/auth/convite/${token}`)).status).toBe(200);
    expect((await request(app).get(`/auth/convite/${u.convite_token}`)).status).toBe(404);
  });

  it('o desafio das duas etapas e um token sem sessão registrada não abrem nada', async () => {
    const gil = await usuario('gil@lojasegura.com.br');
    const desafio = jwt.sign({ d: 1 }, SEGREDO, {
      algorithm: 'HS256',
      subject: String(gil.id),
      audience: 'duas-etapas',
      expiresIn: '5m',
    });
    expect((await request(app).get('/auth/eu').set('Cookie', `sessao=${desafio}`)).status).toBe(401);
    // Mesmo sem o "aud": token sem o id da sessão registrada (cookie antigo ou forjado) não vale.
    const semSessao = jwt.sign({ d: 1 }, SEGREDO, { algorithm: 'HS256', subject: String(gil.id) });
    expect((await request(app).get('/auth/eu').set('Cookie', `sessao=${semSessao}`)).status).toBe(401);
    const antigo = jwt.sign({}, SEGREDO, { algorithm: 'HS256', subject: String(gil.id), expiresIn: '1h' });
    expect((await request(app).get('/auth/eu').set('Cookie', `sessao=${antigo}`)).status).toBe(401);
  });

  it('5 senhas erradas travam o acesso da pessoa (até a certa); a senha nova destrava', async () => {
    const gil = await usuario('gil@lojasegura.com.br');
    await comSenha(gil.id, 'Senha-do-gil-1');
    for (let i = 0; i < 5; i++) expect((await entrar('gil@lojasegura.com.br', 'errada')).status).toBe(401);
    const travado = await entrar('gil@lojasegura.com.br', 'Senha-do-gil-1');
    expect(travado.status).toBe(429);
    expect(travado.body.erro.codigo).toBe('acesso_travado');
    // O master define uma senha nova: a trava sai e as sessões antigas caem.
    await pool.query('UPDATE cadastro.usuarios SET falhas_login = 0, bloqueado_ate = NULL WHERE id = $1', [
      gil.id,
    ]);
    expect((await entrar('gil@lojasegura.com.br', 'Senha-do-gil-1')).status).toBe(200);
  });

  it('administrador da unidade não gera link de senha para o gestor (nem para o master)', async () => {
    const ana = await usuario('ana@lojasegura.com.br');
    await comSenha(ana.id, 'Senha-da-ana-1');
    const ck = cookieDe(await entrar('ana@lojasegura.com.br', 'Senha-da-ana-1'));
    expect(ck).not.toBe('');
    const gil = await usuario('gil@lojasegura.com.br');
    const r = await request(app).post(`/equipe/${gil.id}/convite`).set('Origin', ORIGEM).set('Cookie', ck);
    expect(r.status).toBe(404);
    // O gestor continua entrando com a senha dele.
    expect((await entrar('gil@lojasegura.com.br', 'Senha-do-gil-1')).status).toBe(200);
  });

  it('link novo de senha derruba as sessões abertas da pessoa', async () => {
    const r = await comoMaster('post', `/master/contas/${contaId}/usuarios`, {
      nome: 'Rui SDR',
      email: 'rui@lojasegura.com.br',
      papel: 'sdr',
    });
    const rui = await usuario('rui@lojasegura.com.br');
    expect(r.status).toBe(201);
    await comSenha(rui.id, 'Senha-do-rui-1');
    const ck = cookieDe(await entrar('rui@lojasegura.com.br', 'Senha-do-rui-1'));
    expect((await request(app).get('/auth/eu').set('Cookie', ck)).status).toBe(200);
    expect((await comoMaster('post', `/master/usuarios/${rui.id}/convite`)).status).toBe(200);
    expect((await request(app).get('/auth/eu').set('Cookie', ck)).status).toBe(401);
  });

  it('corpo grande sem login nem é lido', async () => {
    const r = await request(app)
      .post('/marca')
      .set('Origin', ORIGEM)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ logo: 'x'.repeat(3_000_000) }));
    expect(r.status).toBe(401);
    // Webhook do WhatsApp com token que não existe: 404 antes de ler o corpo.
    const w = await request(app)
      .post(`/webhooks/whatsapp/${'a'.repeat(32)}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ x: 'y'.repeat(2_000_000) }));
    expect(w.status).toBe(404);
  });
});
