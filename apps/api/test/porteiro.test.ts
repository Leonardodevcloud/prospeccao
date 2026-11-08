import { criarPool, migrar, type Pool } from '@prospeccao/db';
import { bancoDeTeste } from '@prospeccao/db/teste';
import { criarLogger } from '@prospeccao/shared';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../src/app.js';
import { comConta } from '../src/contexto.js';
import { chipParaAutomatica, emUso } from '../src/modulos/agente/chips.js';
import { rodadaRisco } from '../src/modulos/porteiro/risco.js';
import type { ServicosConta } from '../src/servicos.js';

const URL_TESTE = process.env.TEST_DATABASE_URL;
const ORIGEM = 'http://localhost:5173';

describe.skipIf(!URL_TESTE)('porteiro do WhatsApp', () => {
  let pool: Pool;
  let app: ReturnType<typeof criarApp>;
  let master = '';
  let contaId = 0;
  let chipId = 0;
  const log = criarLogger('teste', 'silent');
  const enviados: { tel: string; texto: string }[] = [];
  let variacao: string | null = null;
  const servicos = async (id: number): Promise<ServicosConta> => ({
    contaId: id,
    whatsapp: {
      async enviar(tel: string, texto: string) {
        enviados.push({ tel, texto });
        return { idExterno: `ext-${enviados.length}` };
      },
    } as never,
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
    porteiro: { variar: async () => variacao },
  });
  const cookieDe = (r: request.Response) =>
    ((r.headers['set-cookie'] as unknown as string[] | undefined) ?? [])[0]?.split(';')[0] ?? '';
  let ip = 0;
  const entrar = (email: string, senha: string) =>
    request(app)
      .post('/auth/login')
      .set('Origin', ORIGEM)
      .set('X-Forwarded-For', `10.79.0.${++ip}`)
      .send({ email, senha });
  let ana: {
    get: (r: string) => request.Test;
    enviar: (m: 'post' | 'put', r: string, c?: object) => request.Test;
  };
  const leads: number[] = [];
  const mandar = (lead: number, texto: string, mesmoAssim?: boolean) =>
    ana.enviar('post', `/conversas/${lead}/mensagens`, { texto, mesmoAssim });
  const config = {
    ativo: true,
    repetidasContatos: 3,
    repetidasJanelaMin: 60,
    repetidasAcao: 'segurar',
    novosDia: 4,
    novosIntervaloSeg: 0,
    pausarRisco: true,
  };

  beforeAll(async () => {
    pool = criarPool({
      url: await bancoDeTeste(URL_TESTE!, 'porteiro'),
      aplicacao: 'teste-porteiro',
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
        jwtSegredo: 'p'.repeat(40),
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
    const M = (m: 'post' | 'patch', r: string, c?: object) =>
      request(app)[m](r).set('Origin', ORIGEM).set('Cookie', master).send(c);
    const r = await M('post', '/master/contas', {
      nome: 'Autopeças Porteiro',
      primeiroAcesso: 'admin',
      admin: { nome: 'Ana Admin', email: 'ana@porteiro.com.br' },
      plano: { plano: 'escala', modulos: [] },
    });
    contaId = r.body.id;
    const anaId = (
      await pool.query('SELECT id FROM cadastro.usuarios WHERE email = $1', ['ana@porteiro.com.br'])
    ).rows[0].id;
    await M('patch', `/master/usuarios/${anaId}/acesso`, { senha: 'Senha-forte-1' });
    const ck = cookieDe(await entrar('ana@porteiro.com.br', 'Senha-forte-1'));
    ana = {
      get: (rota) => request(app).get(rota).set('Cookie', ck),
      enviar: (m, rota, c) => request(app)[m](rota).set('Origin', ORIGEM).set('Cookie', ck).send(c),
    };
    chipId = (
      await pool.query(
        `INSERT INTO comercial.chips (conta_id, nome, instancia, token_cifrado, aquecer)
         VALUES ($1, 'Loja Centro', 'loja-centro', 'x', false) RETURNING id`,
        [contaId],
      )
    ).rows[0].id;
    await ana.enviar('post', '/nichos', { nome: 'Oficinas', cnaes: ['4520-0/01'], termosMaps: ['oficina'] });
    for (let i = 0; i < 8; i++) {
      const l = await ana.enviar('post', '/funil/leads', {
        empresa: `Oficina ${i + 1}`,
        telefone: `7199999010${i}`,
      });
      expect(l.status).toBe(201);
      leads.push(l.body.empresaId);
    }
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('desligado, não segura nada; ligado só pelo administrador', async () => {
    expect((await ana.get('/porteiro')).body.config.ativo).toBe(false);
    for (const l of leads.slice(0, 3))
      expect(
        (await mandar(l, 'Bom dia! Temos pastilha de freio do Gol com 20% de desconto hoje')).status,
      ).toBe(201);
    const r = await ana.enviar('put', '/porteiro', config);
    expect(r.status).toBe(200);
    expect(r.body.numeros[0]).toMatchObject({ nome: 'Loja Centro', novosHoje: 3, limiteHoje: 4 });
    await pool.query('DELETE FROM comercial.mensagens WHERE conta_id = $1', [contaId]);
    enviados.length = 0;
  });

  it('o mesmo texto para muitos contatos é segurado; a IA varia e passa', async () => {
    const texto = 'Bom dia! Temos pastilha de freio do Gol com 20% de desconto hoje';
    expect((await mandar(leads[0]!, texto)).status).toBe(201);
    // Quase igual (outro número, outro nome) também conta.
    expect(
      (await mandar(leads[1]!, 'Boa tarde! Temos pastilha de freio do Gol com 15% de desconto hoje')).status,
    ).toBe(201);
    const r = await mandar(leads[2]!, texto);
    expect(r.status).toBe(409);
    expect(r.body.erro.codigo).toBe('porteiro_repetida');
    expect(r.body.erro.detalhes).toMatchObject({
      porteiro: true,
      contatos: 2,
      janelaMin: 60,
      podeForcar: false,
    });
    expect(enviados).toHaveLength(2);
    // No modo "segurar", "mandar mesmo assim" não passa.
    expect((await mandar(leads[2]!, texto, true)).status).toBe(409);
    // Mensagem curta se repete naturalmente: não conta.
    for (const l of leads.slice(0, 3)) await mandar(l, 'Ok, obrigado!');
    // A IA reescreve; a versão nova passa.
    variacao =
      'Oi! Hoje a pastilha de freio do Gol está com 20% de desconto aqui na loja, quer que eu separe?';
    const v = await ana.enviar('post', `/conversas/${leads[2]}/variar`, { texto });
    expect(v.body.texto).toBe(variacao);
    expect((await mandar(leads[2]!, variacao)).status).toBe(201);
  });

  it('modo avisar: pergunta e deixa mandar mesmo assim (fica registrado)', async () => {
    await ana.enviar('put', '/porteiro', { ...config, repetidasAcao: 'avisar' });
    const texto = 'Bom dia! Temos pastilha de freio do Gol com 20% de desconto hoje';
    const r = await mandar(leads[3]!, texto);
    expect(r.status).toBe(409);
    expect(r.body.erro.detalhes.podeForcar).toBe(true);
    expect((await mandar(leads[3]!, texto, true)).status).toBe(201);
    const p = await ana.get('/porteiro');
    expect(p.body.hoje).toMatchObject({ repetida: 3, mesmo_assim: 1, variou: 1 });
    expect(p.body.eventos[0]).toMatchObject({
      tipo: 'mesmo_assim',
      lead: 'Oficina 4',
      usuario: 'Ana Admin',
      numero: 'Loja Centro',
    });
  });

  it('contatos novos: limite do dia e espera entre um e outro; responder quem conversa passa', async () => {
    // Já foram 4 contatos novos hoje (o limite).
    const r = await mandar(leads[4]!, 'Olá, tudo bem?');
    expect(r.status).toBe(409);
    expect(r.body.erro.codigo).toBe('porteiro_limite');
    // Quem já conversa continua recebendo.
    expect((await mandar(leads[0]!, 'Separei a peça para você.')).status).toBe(201);
    // Espera: com limite folgado e 60 s entre um contato novo e outro.
    await ana.enviar('put', '/porteiro', { ...config, novosDia: 50, novosIntervaloSeg: 60 });
    const e = await mandar(leads[4]!, 'Olá, tudo bem?');
    expect(e.body.erro.codigo).toBe('porteiro_espera');
    expect(e.body.erro.detalhes.segundos).toBeGreaterThan(0);
    await pool.query(
      `UPDATE comercial.mensagens SET enviado_em = enviado_em - interval '2 minutes', criado_em = criado_em - interval '2 minutes'
        WHERE conta_id = $1`,
      [contaId],
    );
    expect((await mandar(leads[4]!, 'Olá, tudo bem?')).status).toBe(201);
  });

  it('pedidos para parar pausam os contatos novos do número (equipe e automáticos) e o administrador libera', async () => {
    await ana.enviar('put', '/porteiro', { ...config, novosDia: 50 });
    for (const l of leads.slice(0, 3))
      await pool.query(
        `INSERT INTO comercial.mensagens (conta_id, empresa_id, direcao, texto, status, origem, chip_id)
         VALUES ($1, $2, 'recebida', 'Para de me mandar mensagem, vou denunciar', 'recebida', 'lead', $3)`,
        [contaId, l, chipId],
      );
    expect(await rodadaRisco(pool, log)).toBe(1);
    const p = (await ana.get('/porteiro')).body;
    expect(p.numeros[0].friosAte).not.toBeNull();
    expect(p.numeros[0].friosMotivo).toMatch(/3 contatos pediram para parar/);
    const { rows: alerta } = await pool.query(
      `SELECT titulo FROM comercial.alertas WHERE conta_id = $1 AND chave = $2 AND ativo`,
      [contaId, `porteiro:${chipId}`],
    );
    expect(alerta[0].titulo).toMatch(/parou de abordar contatos novos/);
    const r = await mandar(leads[5]!, 'Olá, tudo bem?');
    expect(r.body.erro.codigo).toBe('porteiro_pausado');
    expect((await mandar(leads[1]!, 'Combinado, até amanhã.')).status).toBe(201);
    // O automático também não aborda contato novo por este número (responder continua).
    await comConta(contaId, async () => {
      const chips = await emUso(pool);
      expect(await chipParaAutomatica(pool, leads[6]!, chips, { limiteDia: 40, intervaloSeg: 0 })).toBeNull();
      expect(
        await chipParaAutomatica(pool, leads[6]!, chips, { limiteDia: 40, intervaloSeg: 0 }, Date.now(), {
          resposta: true,
        }),
      ).not.toBeNull();
    });
    // Não pausa de novo pelos mesmos pedidos.
    const liberado = await ana.enviar('post', `/porteiro/numeros/${chipId}/liberar`);
    expect(liberado.body.numeros[0].friosAte).toBeNull();
    expect(await rodadaRisco(pool, log)).toBe(0);
    expect((await mandar(leads[5]!, 'Olá, tudo bem?')).status).toBe(201);
  });
});
