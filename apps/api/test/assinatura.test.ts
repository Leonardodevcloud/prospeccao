import { criarPool, migrar, type Pool } from '@prospeccao/db';
import { bancoDeTeste } from '@prospeccao/db/teste';
import type { CobrancaAsaas, ServicoCobranca } from '@prospeccao/integrations/cobranca';
import { criarLogger } from '@prospeccao/shared';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../src/app.js';
import { rodadaAssinaturas } from '../src/modulos/assinatura/servico.js';
import { esquecerRecursos } from '../src/recursos.js';
import type { ServicosConta } from '../src/servicos.js';

const URL_TESTE = process.env.TEST_DATABASE_URL;
const ORIGEM = 'http://localhost:5173';
const TOKEN_ASAAS = 'token-do-aviso-asaas-123';

describe.skipIf(!URL_TESTE)('Teste grátis e assinatura pelo sistema', () => {
  let pool: Pool;
  let app: ReturnType<typeof criarApp>;
  const log = criarLogger('teste', (process.env.LOG_TESTE as 'error') ?? 'silent');

  // E-mails do sistema e o Asaas de mentira.
  const emails: { para: string; assunto: string; html: string }[] = [];
  const asaas = {
    clientes: [] as unknown[],
    assinaturas: new Map<string, { valor: number; forma: string; cancelada: boolean }>(),
    cobrancas: [] as CobrancaAsaas[],
  };
  let seq = 0;
  const cobranca: ServicoCobranca = {
    sandbox: true,
    criarCliente: async (c) => {
      asaas.clientes.push(c);
      return `cus_${++seq}`;
    },
    atualizarCliente: async () => undefined,
    criarAssinatura: async (a) => {
      const id = `sub_${++seq}`;
      asaas.assinaturas.set(id, { valor: a.valor, forma: a.forma, cancelada: false });
      asaas.cobrancas.push({
        id: `pay_${++seq}`,
        assinatura: id,
        valor: a.valor,
        vencimento: a.vencimento,
        situacao: 'pendente',
        forma: a.forma,
        link: `https://sandbox.asaas.com/i/${seq}`,
        pagoEm: null,
        descricao: a.descricao,
        referencia: a.referencia,
      });
      return id;
    },
    atualizarAssinatura: async (id, a) => {
      const x = asaas.assinaturas.get(id)!;
      if (a.valor != null) x.valor = a.valor;
    },
    cancelarAssinatura: async (id) => {
      asaas.assinaturas.get(id)!.cancelada = true;
    },
    cobrancasDaAssinatura: async (id) => asaas.cobrancas.filter((c) => c.assinatura === id),
    cobranca: async (id) => asaas.cobrancas.find((c) => c.id === id)!,
    pix: async () => ({ imagem: 'iVBORw0KGgo=', copiaECola: '00020126580014br.gov.bcb.pix', expiraEm: null }),
    testar: async () => 'ok (sandbox)',
  };

  const servicos = async (contaId: number): Promise<ServicosConta> => ({
    contaId,
    whatsapp: null,
    ia: null,
    classificarEmail: null,
    personalizarAbertura: null,
    email: {
      remetente: 'ola@prospectteam.com.br',
      dominioRespostas: null,
      segredoWebhook: null,
      enviar: async (e) => {
        emails.push({ para: e.para, assunto: e.assunto, html: e.html });
        return { id: `email-${emails.length}` };
      },
    },
    assistente: null,
    geocodificar: async () => null,
    rotas: null,
    origem: { places: null, ors: null, resend: null, whatsapp: null, ia: null },
    iaDescricao: null,
    erro: null,
  });

  const novoAgente = () => request.agent(app);
  const linkDoEmail = (para: string) => {
    const e = [...emails].reverse().find((x) => x.para === para)!;
    return /\/teste\/confirmar\/([\w-]+)/.exec(e.html)![1]!;
  };
  const cadastro = (extra: Record<string, unknown> = {}) => ({
    nome: 'Diego Martins',
    empresa: 'Nexo Sistemas',
    email: 'diego@nexosistemas.com.br',
    whatsapp: '(71) 99876-5432',
    senha: 'senha-bem-forte-1',
    aceite: true,
    ...extra,
  });

  beforeAll(async () => {
    pool = criarPool({ url: await bancoDeTeste(URL_TESTE!, 'assinatura'), aplicacao: 'teste-ass', max: 4 });
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
      meta: null,
      cobranca,
      asaasTokenWebhook: TOKEN_ASAAS,
      captcha: null,
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  let diego: ReturnType<typeof novoAgente>;
  let organizacaoId = 0;

  it('cadastro do teste: antiabuso, e-mail de confirmação e a conta nasce no Time de teste', async () => {
    const descartavel = await request(app)
      .post('/teste')
      .set('Origin', ORIGEM)
      .send(cadastro({ email: 'x@mailinator.com' }));
    expect(descartavel.status).toBe(422);
    expect(
      (
        await request(app)
          .post('/teste')
          .set('Origin', ORIGEM)
          .send(cadastro({ aceite: false }))
      ).status,
    ).toBe(422);

    const r = await request(app).post('/teste').set('Origin', ORIGEM).send(cadastro());
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ email: 'diego@nexosistemas.com.br', emailEnviado: true });
    expect(emails[0]!.assunto).toMatch(/Confirme o seu e-mail/);
    // Pedir de novo troca o link (o anterior deixa de valer).
    const primeiro = linkDoEmail('diego@nexosistemas.com.br');
    await request(app)
      .post('/teste/reenviar')
      .set('Origin', ORIGEM)
      .send({ email: 'diego@nexosistemas.com.br' });
    const token = linkDoEmail('diego@nexosistemas.com.br');
    expect(token).not.toBe(primeiro);
    expect((await request(app).post(`/teste/confirmar/${primeiro}`).set('Origin', ORIGEM)).status).toBe(404);

    diego = novoAgente();
    const ok = await diego.post(`/teste/confirmar/${token}`).set('Origin', ORIGEM);
    expect(ok.status).toBe(200);
    const eu = (await diego.get('/auth/eu')).body;
    expect(eu).toMatchObject({
      nome: 'Diego Martins',
      papel: 'admin',
      termos: { aceitos: true },
      conta: { nome: 'Nexo Sistemas', plano: 'time' },
      assinatura: { situacao: 'teste', leadsLimite: 100, esperandoPagamento: false },
    });
    expect(eu.conta.modulos).not.toContain('whatsapp');
    expect(new Date(eu.assinatura.testeAte).getTime() - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    // O link vale uma vez só; a mesma empresa não testa de novo.
    expect((await request(app).post(`/teste/confirmar/${token}`).set('Origin', ORIGEM)).status).toBe(409);
    const deNovo = await request(app)
      .post('/teste')
      .set('Origin', ORIGEM)
      .send(cadastro({ email: 'outro@nexosistemas.com.br' }));
    expect(deNovo.status).toBe(409);
    expect(deNovo.body.erro.mensagem).toMatch(/já usou o teste/);
    const jaTem = await request(app)
      .post('/teste')
      .set('Origin', ORIGEM)
      .send(cadastro({ whatsapp: '71 98888-1111' }));
    expect(jaTem.body.erro.mensagem).toMatch(/já tem conta/);

    // Entrou no quadro de vendas do master, na coluna Testando.
    const { rows } = await pool.query(
      `SELECT p.etapa, p.canal, o.id AS org FROM cadastro.pedidos_site p JOIN cadastro.contas c ON c.id = p.conta_id
         JOIN cadastro.organizacoes o ON o.id = c.organizacao_id WHERE p.email = 'diego@nexosistemas.com.br'`,
    );
    expect(rows[0]).toMatchObject({ etapa: 'teste', canal: 'teste' });
    organizacaoId = rows[0].org;
    // O teste vale para 2 pessoas.
    const ana = await diego
      .post('/equipe')
      .set('Origin', ORIGEM)
      .send({ nome: 'Ana', email: 'ana@nexo.com.br', papel: 'sdr' });
    expect(ana.status).toBe(201);
    const terceiro = await diego
      .post('/equipe')
      .set('Origin', ORIGEM)
      .send({ nome: 'Bia', email: 'bia@nexo.com.br', papel: 'sdr' });
    expect(terceiro.status).toBeGreaterThanOrEqual(400);
  });

  it('assinar: preço pela tabela, cobrança no Asaas com Pix e o plano vale quando o pagamento cai', async () => {
    const resumo = (await diego.get('/assinatura')).body;
    expect(resumo).toMatchObject({ disponivel: true, sandbox: true, situacao: { situacao: 'teste' } });
    // Agente de IA sem WhatsApp: recusado.
    expect(
      (
        await diego
          .post('/assinatura/assinar')
          .set('Origin', ORIGEM)
          .send({
            plano: 'time',
            usuarios: 5,
            modulos: ['agente_ia'],
            forma: 'PIX',
            documento: '11.222.333/0001-81',
            nome: 'Nexo Sistemas Ltda',
            email: 'financeiro@nexo.com.br',
          })
      ).status,
    ).toBe(422);
    const r = await diego
      .post('/assinatura/assinar')
      .set('Origin', ORIGEM)
      .send({
        plano: 'time',
        usuarios: 5,
        modulos: ['whatsapp', 'agente_ia'],
        forma: 'PIX',
        documento: '11.222.333/0001-81',
        nome: 'Nexo Sistemas Ltda',
        email: 'financeiro@nexo.com.br',
      });
    expect(r.status).toBe(201);
    // Time 1.300 + 1 usuário (59) + WhatsApp e IA (999).
    expect(r.body.valor).toBe(2358);
    expect(r.body.cobranca).toMatchObject({ situacao: 'pendente', forma: 'PIX' });
    const pagar = (await diego.get('/assinatura/pagar')).body.cobranca;
    expect(pagar).toMatchObject({
      valor: 2358,
      pix: { copiaECola: expect.stringContaining('br.gov.bcb.pix') },
    });
    // Ainda é teste até pagar.
    expect((await diego.get('/auth/eu')).body.assinatura).toMatchObject({
      situacao: 'teste',
      esperandoPagamento: true,
    });

    // Aviso do Asaas: sem o token, recusado; com o token, pagamento confirmado.
    const pago = { ...asaas.cobrancas[0]!, situacao: 'paga' as const };
    const corpoAviso = {
      id: 'evt_1',
      event: 'PAYMENT_CONFIRMED',
      payment: {
        id: pago.id,
        subscription: pago.assinatura,
        value: pago.valor,
        dueDate: pago.vencimento,
        status: 'CONFIRMED',
        billingType: 'PIX',
        invoiceUrl: pago.link,
        paymentDate: pago.vencimento,
      },
    };
    expect((await request(app).post('/asaas/webhook').send(corpoAviso)).status).toBe(401);
    const aviso = await request(app)
      .post('/asaas/webhook')
      .set('asaas-access-token', TOKEN_ASAAS)
      .send(corpoAviso);
    expect(aviso.status).toBe(200);
    // O mesmo aviso de novo não faz nada.
    expect(
      (await request(app).post('/asaas/webhook').set('asaas-access-token', TOKEN_ASAAS).send(corpoAviso))
        .status,
    ).toBe(200);
    esquecerRecursos();
    const eu = (await diego.get('/auth/eu')).body;
    expect(eu.assinatura).toMatchObject({ situacao: 'ativa', esperandoPagamento: false });
    expect(eu.conta.modulos).toEqual(expect.arrayContaining(['whatsapp', 'agente_ia']));
    const plano = (await diego.get('/equipe/plano')).body;
    expect(plano).toMatchObject({ plano: 'time', usuarios: 5 });
    const { rows } = await pool.query(
      `SELECT p.etapa FROM cadastro.pedidos_site p WHERE p.email = 'diego@nexosistemas.com.br'`,
    );
    expect(rows[0].etapa).toBe('cliente');
    const cobrancas = (await diego.get('/assinatura')).body.cobrancas;
    expect(cobrancas[0]).toMatchObject({ situacao: 'paga', valor: 2358 });
  });

  it('mudar com a assinatura ativa vale na hora; atrasou: tolerância e depois só leitura', async () => {
    const r = await diego.post('/assinatura/assinar').set('Origin', ORIGEM).send({
      plano: 'escala',
      usuarios: 6,
      modulos: [],
      forma: 'BOLETO',
      documento: '11.222.333/0001-81',
      nome: 'Nexo Sistemas Ltda',
      email: 'financeiro@nexo.com.br',
    });
    expect(r.body).toMatchObject({ valor: 2500, mudouNaHora: true });
    esquecerRecursos();
    expect((await diego.get('/equipe/plano')).body.plano).toBe('escala');

    // A mensalidade seguinte venceu há 10 dias e não foi paga.
    const sub = [...asaas.assinaturas.keys()][0]!;
    const venc = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    asaas.cobrancas.push({
      id: 'pay_atrasada',
      assinatura: sub,
      valor: 2500,
      vencimento: venc,
      situacao: 'atrasada',
      forma: 'BOLETO',
      link: null,
      pagoEm: null,
      descricao: null,
      referencia: null,
    });
    await request(app)
      .post('/asaas/webhook')
      .set('asaas-access-token', TOKEN_ASAAS)
      .send({
        id: 'evt_2',
        event: 'PAYMENT_OVERDUE',
        payment: { id: 'pay_atrasada', subscription: sub, value: 2500, dueDate: venc, status: 'OVERDUE' },
      });
    expect((await diego.get('/auth/eu')).body.assinatura.situacao).toBe('atrasada');
    await rodadaAssinaturas({ pool, log, servicos, cobranca }, ORIGEM);
    expect((await diego.get('/auth/eu')).body.assinatura.situacao).toBe('so_leitura');
    // Só leitura: vê, não mexe; assinar continua valendo.
    expect((await diego.get('/funil')).status).toBe(200);
    const mexer = await diego
      .post('/nichos')
      .set('Origin', ORIGEM)
      .send({ nome: 'Saúde', cnaes: ['8630-5/04'], termosMaps: ['clínica'] });
    expect(mexer.status).toBe(403);
    expect(mexer.body.erro.codigo).toBe('conta_so_leitura');
    expect((await diego.get('/assinatura/pagar')).body.cobranca).toMatchObject({ asaas_id: 'pay_atrasada' });
    // Pagou: volta a valer.
    asaas.cobrancas.find((c) => c.id === 'pay_atrasada')!.situacao = 'paga';
    await diego.post('/assinatura/conferir').set('Origin', ORIGEM);
    expect((await diego.get('/auth/eu')).body.assinatura.situacao).toBe('ativa');
  });

  it('teste que vence: avisos, só leitura e, 15 dias depois, arquivada', async () => {
    const r = await request(app)
      .post('/teste')
      .set('Origin', ORIGEM)
      .send(
        cadastro({
          email: 'paula@bemestar.com.br',
          empresa: 'Instituto Bem Estar',
          whatsapp: '71 99222-0033',
          nome: 'Paula',
        }),
      );
    expect(r.status).toBe(201);
    const paula = novoAgente();
    await paula.post(`/teste/confirmar/${linkDoEmail('paula@bemestar.com.br')}`).set('Origin', ORIGEM);
    const { rows } = await pool.query(
      `SELECT id FROM cadastro.organizacoes WHERE nome = 'Instituto Bem Estar'`,
    );
    const org = rows[0].id;
    // Faltam 30 horas: aviso de 2 dias; faltam 20 horas: termina amanhã.
    await pool.query(
      `UPDATE cadastro.organizacoes SET teste_ate = now() + interval '30 hours' WHERE id = $1`,
      [org],
    );
    await rodadaAssinaturas({ pool, log, servicos, cobranca }, ORIGEM);
    await pool.query(
      `UPDATE cadastro.organizacoes SET teste_ate = now() + interval '20 hours' WHERE id = $1`,
      [org],
    );
    await rodadaAssinaturas({ pool, log, servicos, cobranca }, ORIGEM);
    await rodadaAssinaturas({ pool, log, servicos, cobranca }, ORIGEM);
    const assuntos = emails.filter((e) => e.para === 'paula@bemestar.com.br').map((e) => e.assunto);
    expect(assuntos).toEqual(
      expect.arrayContaining(['Faltam 2 dias do seu teste', 'O seu teste termina amanhã']),
    );
    expect(assuntos.filter((a) => a === 'O seu teste termina amanhã')).toHaveLength(1);
    // Venceu.
    await pool.query(
      `UPDATE cadastro.organizacoes SET teste_ate = now() - interval '1 minute' WHERE id = $1`,
      [org],
    );
    await rodadaAssinaturas({ pool, log, servicos, cobranca }, ORIGEM);
    const eu = (await paula.get('/auth/eu')).body;
    expect(eu.assinatura.situacao).toBe('so_leitura');
    expect(eu.assinatura.soLeituraAte).toBeTruthy();
    expect(emails.some((e) => e.para === 'paula@bemestar.com.br' && /acabou/.test(e.assunto))).toBe(true);
    // 15 dias depois: arquivada (desativada; a sessão cai).
    await pool.query(
      `UPDATE cadastro.organizacoes SET so_leitura_desde = now() - interval '16 days' WHERE id = $1`,
      [org],
    );
    await rodadaAssinaturas({ pool, log, servicos, cobranca }, ORIGEM);
    expect((await paula.get('/auth/eu')).status).toBe(401);
    const { rows: o } = await pool.query(
      `SELECT assinatura, ativa FROM cadastro.organizacoes WHERE id = $1`,
      [org],
    );
    expect(o[0]).toEqual({ assinatura: 'arquivada', ativa: false });
    expect(organizacaoId).toBeGreaterThan(0);
  });

  it('o master vê os testes e as assinaturas no quadro de vendas', async () => {
    const master = novoAgente();
    await master
      .post('/auth/login')
      .set('Origin', ORIGEM)
      .send({ email: 'dona@exemplo.com', senha: 'senha-forte-123' });
    const r = (await master.get('/master/site')).body;
    expect(r.numeros).toMatchObject({ ativas: 1, testes30: 2, viraram30: 1 });
    const nexo = r.pedidos.find((p: { email: string }) => p.email === 'diego@nexosistemas.com.br');
    expect(nexo.assinatura).toMatchObject({ situacao: 'ativa', plano: 'escala' });
  });
});
