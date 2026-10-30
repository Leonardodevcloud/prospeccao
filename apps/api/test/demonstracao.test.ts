import { comTransacao, criarPool, migrar, type Pool } from '@prospeccao/db';
import { bancoDeTeste } from '@prospeccao/db/teste';
import { criarLogger } from '@prospeccao/shared';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../src/app.js';
import { gerarDados } from '../src/modulos/demonstracao/dados.js';
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
  it('cliente: mudar e-mail e senha, desativar (não entra) e excluir com tudo o que é dele', async () => {
    const criado = await enviar('/master/contas', {
      nome: 'Cliente Para Excluir',
      admin: { nome: 'Rui', email: 'rui@excluir.com.br' },
      plano: { plano: 'escala', modulos: ['whatsapp', 'agente_ia'] },
    });
    expect(criado.status).toBe(201);
    const { id: contaId, organizacaoId } = criado.body as { id: number; organizacaoId: number };
    // Enche a conta: campanhas, funil, conversas, reuniões, roteiro (o mesmo gerador da demonstração).
    const demo = (await ler('/master/plataforma/servicos')).body.demonstracao.contaId as number;
    await comTransacao(pool, async (tx) => {
      // Os vendedores fictícios têm os mesmos e-mails da demonstração: troca enquanto gera.
      await tx.query(`UPDATE cadastro.usuarios SET email = 'demo-' || email WHERE conta_id = $1`, [demo]);
      await tx.query('SELECT cadastro.preparar_conta($1)', [contaId]);
      await gerarDados(tx, contaId);
      await tx.query(
        `UPDATE cadastro.usuarios SET email = 'cliente-' || email WHERE conta_id = $1 AND email NOT LIKE 'rui@%'`,
        [contaId],
      );
      await tx.query(`UPDATE cadastro.usuarios SET email = substr(email, 6) WHERE conta_id = $1`, [demo]);
    });
    const contarDemo = async () =>
      (await pool.query('SELECT count(*)::int AS n FROM comercial.oportunidades WHERE conta_id = $1', [demo]))
        .rows[0].n as number;
    const oportunidadesDemo = await contarDemo();

    const conta = (await ler(`/master/contas/${contaId}`)).body as {
      usuarios: { id: number; email: string }[];
    };
    const rui = conta.usuarios.find((u) => u.email === 'rui@excluir.com.br')!;
    // Senha fraca, e-mail de outra pessoa e o próprio master: recusados.
    expect(
      (
        await request(app)
          .patch(`/master/usuarios/${rui.id}/acesso`)
          .set('Origin', ORIGEM)
          .set('Cookie', cookie)
          .send({ senha: '123' })
      ).status,
    ).toBe(422);
    expect(
      (
        await request(app)
          .patch(`/master/usuarios/${rui.id}/acesso`)
          .set('Origin', ORIGEM)
          .set('Cookie', cookie)
          .send({ email: 'bia@financeiro.com.br' })
      ).status,
    ).toBe(409);
    const ok = await request(app)
      .patch(`/master/usuarios/${rui.id}/acesso`)
      .set('Origin', ORIGEM)
      .set('Cookie', cookie)
      .send({ email: 'Rui.Novo@Excluir.com.br', senha: 'nova-senha-123' });
    expect(ok.status).toBe(200);
    expect((ok.body as { email: string }[]).some((u) => u.email === 'rui.novo@excluir.com.br')).toBe(true);
    const entrar = () =>
      request(app)
        .post('/auth/login')
        .set('Origin', ORIGEM)
        .send({ email: 'rui.novo@excluir.com.br', senha: 'nova-senha-123' });
    expect((await entrar()).status).toBe(200);
    const { rows: aud } = await pool.query(
      `SELECT descricao FROM cadastro.auditoria WHERE conta_id = $1 AND acao = 'acesso' AND como_master`,
      [contaId],
    );
    expect(aud[0]?.descricao).toContain('senha nova');

    // Ativo não exclui; desativado não entra; nome errado não exclui.
    expect(
      (await enviar(`/master/organizacoes/${organizacaoId}/excluir`, { confirmacao: 'Cliente Para Excluir' }))
        .status,
    ).toBe(422);
    const desativar = await request(app)
      .patch(`/master/organizacoes/${organizacaoId}`)
      .set('Origin', ORIGEM)
      .set('Cookie', cookie)
      .send({ ativa: false });
    expect(desativar.status).toBe(200);
    expect((await entrar()).status).not.toBe(200);
    expect(
      (await enviar(`/master/organizacoes/${organizacaoId}/excluir`, { confirmacao: 'Outro nome' })).status,
    ).toBe(422);
    // A sua organização e a demonstração não se excluem.
    expect((await enviar('/master/organizacoes/1/excluir', { confirmacao: 'x' })).status).toBe(422);

    const excluiu = await enviar(`/master/organizacoes/${organizacaoId}/excluir`, {
      confirmacao: '  cliente para   excluir ',
    });
    expect(excluiu.status).toBe(200);
    const { rows } = await pool.query(
      `SELECT (SELECT count(*) FROM cadastro.organizacoes WHERE id = $1)::int AS org,
              (SELECT count(*) FROM cadastro.contas WHERE id = $2)::int AS contas,
              (SELECT count(*) FROM cadastro.usuarios WHERE conta_id = $2)::int AS usuarios,
              (SELECT count(*) FROM comercial.oportunidades WHERE conta_id = $2)::int AS oportunidades,
              (SELECT count(*) FROM comercial.sala_sessoes WHERE conta_id = $2)::int AS reunioes,
              (SELECT count(*) FROM cadastro.campanhas WHERE conta_id = $2)::int AS campanhas`,
      [organizacaoId, contaId],
    );
    expect(rows[0]).toEqual({ org: 0, contas: 0, usuarios: 0, oportunidades: 0, reunioes: 0, campanhas: 0 });
    // O que é dos outros fica: a demonstração continua inteira.
    expect(await contarDemo()).toBe(oportunidadesDemo);
    expect(
      (await ler('/master/plataforma/clientes')).body.clientes.some(
        (c: { id: number }) => c.id === organizacaoId,
      ),
    ).toBe(false);
    const { rows: aud2 } = await pool.query(
      `SELECT 1 FROM cadastro.auditoria WHERE acao = 'excluir_cliente' AND descricao LIKE '%Cliente Para Excluir%'`,
    );
    expect(aud2.length).toBe(1);
  });
  it('administradores da plataforma: convidar outro master, que entra no painel; desativar e tirar o acesso', async () => {
    const criado = await enviar('/master/administradores', {
      nome: 'Carla Souza',
      email: 'Carla@Plataforma.com.br',
    });
    expect(criado.status).toBe(201);
    const { id, convite } = criado.body as { id: number; convite: string };
    expect(convite).toContain('/convite/');
    // E-mail de alguém de um cliente não vira master; o mesmo master de novo também não.
    expect(
      (await enviar('/master/administradores', { nome: 'Xavier', email: 'bia@financeiro.com.br' })).status,
    ).toBe(409);
    expect(
      (await enviar('/master/administradores', { nome: 'Carla', email: 'carla@plataforma.com.br' })).status,
    ).toBe(409);

    // Aceita o convite e entra: é master (vê o painel).
    const token = convite.split('/convite/')[1]!;
    const aceitou = await request(app)
      .post(`/auth/convite/${token}`)
      .set('Origin', ORIGEM)
      .send({ senha: 'carla-senha-1' });
    expect(aceitou.status).toBe(200);
    const login = await request(app)
      .post('/auth/login')
      .set('Origin', ORIGEM)
      .send({ email: 'carla@plataforma.com.br', senha: 'carla-senha-1' });
    expect(login.status).toBe(200);
    const daCarla = (login.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    expect((await ler('/auth/eu', daCarla)).body.master).toBe(true);
    expect((await ler('/master/plataforma/clientes', daCarla)).status).toBe(200);

    // A lista mostra quem é quem; ninguém mexe no próprio nem no do ADMIN_EMAIL.
    const lista = (await ler('/master/administradores', daCarla)).body as {
      id: number;
      voce: boolean;
      doAmbiente: boolean;
    }[];
    expect(lista.find((a) => a.id === id)?.voce).toBe(true);
    const ambiente = lista.find((a) => a.doAmbiente)!;
    const patch = (alvo: number, corpo: object, c = cookie) =>
      request(app)
        .patch(`/master/administradores/${alvo}`)
        .set('Origin', ORIGEM)
        .set('Cookie', c)
        .send(corpo);
    expect((await patch(ambiente.id, { ativo: false }, daCarla)).status).toBe(422);
    expect((await patch(id, { ativo: false }, daCarla)).status).toBe(422);

    // Desativado: a sessão cai e o login não passa. Reativado: volta.
    expect((await patch(id, { ativo: false })).status).toBe(200);
    expect((await ler('/master/plataforma/clientes', daCarla)).status).toBe(401);
    expect((await patch(id, { ativo: true })).status).toBe(200);
    // Sem o acesso master: continua na equipe da conta principal, mas o painel fica fechado.
    expect((await patch(id, { master: false })).status).toBe(200);
    const deNovo = await request(app)
      .post('/auth/login')
      .set('Origin', ORIGEM)
      .send({ email: 'carla@plataforma.com.br', senha: 'carla-senha-1' });
    const c2 = (deNovo.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    expect((await ler('/auth/eu', c2)).body.master).toBe(false);
    expect((await ler('/master/plataforma/clientes', c2)).status).toBe(403);
    // E volta a ser master (já tem senha: sem link novo).
    const volta = await enviar('/master/administradores', {
      nome: 'Carla Souza',
      email: 'carla@plataforma.com.br',
    });
    expect(volta.status).toBe(201);
    expect(volta.body.convite).toBeNull();
    const { rows: aud } = await pool.query(
      `SELECT count(*)::int AS n FROM cadastro.auditoria WHERE acao = 'administradores'`,
    );
    expect(aud[0].n).toBeGreaterThanOrEqual(4);
  });
  it('conta da plataforma: zerar o uso antigo como CRM, sem perder administradores nem chaves', async () => {
    const demo = (await ler('/master/plataforma/servicos')).body.demonstracao.contaId as number;
    // A conta principal ganha o uso de um CRM inteiro (campanhas, funil, conversas, reuniões…).
    await comTransacao(pool, async (tx) => {
      await tx.query(`UPDATE cadastro.usuarios SET email = 'demo-' || email WHERE conta_id = $1`, [demo]);
      await gerarDados(tx, 1);
      await tx.query(`UPDATE cadastro.usuarios SET email = 'p-' || email WHERE conta_id = 1 AND NOT master`);
      await tx.query(`UPDATE cadastro.usuarios SET email = substr(email, 6) WHERE conta_id = $1`, [demo]);
      await tx.query(
        `INSERT INTO comercial.notificacoes (conta_id, usuario_id, tipo, titulo)
         SELECT 1, id, 'tarefa', 'Aviso antigo' FROM cadastro.usuarios WHERE master LIMIT 1`,
      );
    });
    const antes = (await ler('/master/plataforma/conta-principal')).body;
    expect(antes.temDados).toBe(true);
    expect(antes.dados.noFunil).toBeGreaterThan(50);
    const demoAntes = (
      await pool.query('SELECT count(*)::int AS n FROM comercial.oportunidades WHERE conta_id = $1', [demo])
    ).rows[0].n;
    const { rows: chave } = await pool.query(
      `SELECT count(*)::int AS n FROM cadastro.usuarios WHERE conta_id = 1`,
    );

    expect((await enviar('/master/plataforma/conta-principal/zerar', { confirmacao: 'sim' })).status).toBe(
      422,
    );
    const zerou = await enviar('/master/plataforma/conta-principal/zerar', { confirmacao: 'zerar' });
    expect(zerou.status).toBe(200);
    expect(zerou.body).toMatchObject({
      nome: 'Prospect Team',
      temDados: false,
      dados: { campanhas: 0, noFunil: 0, mensagens: 0, tarefas: 0, reunioes: 0, avisos: 0 },
    });
    // Ficam: os usuários (os administradores entram normalmente), as etapas do funil e a demonstração.
    const { rows } = await pool.query(
      `SELECT (SELECT count(*) FROM cadastro.usuarios WHERE conta_id = 1)::int AS usuarios,
              (SELECT count(*) FROM comercial.etapas WHERE conta_id = 1)::int AS etapas,
              (SELECT count(*) FROM comercial.oportunidades WHERE conta_id = $1)::int AS demo,
              (SELECT o.nome FROM cadastro.organizacoes o JOIN cadastro.contas c ON c.organizacao_id = o.id WHERE c.id = 1) AS org`,
      [demo],
    );
    expect(rows[0]).toMatchObject({ usuarios: chave[0].n, demo: demoAntes, org: 'Prospect Team' });
    expect(rows[0].etapas).toBeGreaterThan(0);
    expect((await ler('/auth/eu')).body.master).toBe(true);
    const { rows: aud } = await pool.query(
      `SELECT 1 FROM cadastro.auditoria WHERE acao = 'zerar_conta_principal'`,
    );
    expect(aud.length).toBe(1);
  });
});
