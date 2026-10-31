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
  const asaas = { clientes: [] as unknown[], cobrancas: [] as CobrancaAsaas[], apagadas: [] as string[] };
  let seq = 0;
  const cobranca: ServicoCobranca = {
    sandbox: true,
    criarCliente: async (c) => {
      asaas.clientes.push(c);
      return `cus_${++seq}`;
    },
    atualizarCliente: async () => undefined,
    criarCobranca: async (c) => {
      const b: CobrancaAsaas = {
        id: `pay_${++seq}`,
        valor: c.valor,
        vencimento: c.vencimento,
        situacao: 'pendente',
        forma: 'UNDEFINED',
        link: `https://sandbox.asaas.com/i/${seq}`,
        pagoEm: null,
        descricao: c.descricao,
        referencia: c.referencia,
      };
      asaas.cobrancas.push(b);
      return { ...b };
    },
    cancelarCobranca: async (id) => {
      asaas.apagadas.push(id);
    },
    cobranca: async (id) => ({ ...asaas.cobrancas.find((c) => c.id === id)! }),
    pix: async () => ({ imagem: 'iVBORw0KGgo=', copiaECola: '00020126580014br.gov.bcb.pix', expiraEm: null }),
    testar: async () => 'ok (sandbox)',
  };
  /** O Asaas avisa que a cobrança foi paga (com o token). */
  let evento = 0;
  const pagar = async (id: string, forma = 'PIX') => {
    const b = asaas.cobrancas.find((c) => c.id === id)!;
    b.situacao = 'paga';
    b.forma = forma;
    return request(app)
      .post('/asaas/webhook')
      .set('asaas-access-token', TOKEN_ASAAS)
      .send({
        id: `evt_${++evento}`,
        event: 'PAYMENT_RECEIVED',
        payment: {
          id,
          value: b.valor,
          dueDate: b.vencimento,
          status: 'RECEIVED',
          billingType: forma,
          paymentDate: b.vencimento,
        },
      });
  };
  const ultima = () => asaas.cobrancas[asaas.cobrancas.length - 1]!;
  const rodada = () => rodadaAssinaturas({ pool, log, servicos, cobranca }, ORIGEM);
  const dados = {
    documento: '11.222.333/0001-81',
    nome: 'Nexo Sistemas Ltda',
    email: 'financeiro@nexo.com.br',
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

  it('assinar: mensalidade avulsa (Pix na tela) e o plano vale quando o pagamento cai', async () => {
    const resumo = (await diego.get('/assinatura')).body;
    expect(resumo).toMatchObject({ disponivel: true, sandbox: true, situacao: { situacao: 'teste' } });
    // Agente de IA sem WhatsApp: recusado.
    const sem = await diego
      .post('/assinatura/assinar')
      .set('Origin', ORIGEM)
      .send({ plano: 'time', usuarios: 5, modulos: ['agente_ia'], ...dados });
    expect(sem.status).toBe(422);
    const r = await diego
      .post('/assinatura/assinar')
      .set('Origin', ORIGEM)
      .send({ plano: 'time', usuarios: 5, modulos: ['whatsapp', 'agente_ia'], ...dados });
    expect(r.status).toBe(201);
    // Time 1.300 + 1 usuário (59) + WhatsApp e IA (999), uma cobrança só (sem recorrência).
    expect(r.body).toMatchObject({
      valor: 2358,
      tipo: 'mensalidade',
      cobranca: { situacao: 'pendente', tipo: 'mensalidade' },
    });
    const pagarTela = (await diego.get('/assinatura/pagar')).body;
    expect(pagarTela.cobranca).toMatchObject({
      valor: 2358,
      pix: { copiaECola: expect.stringContaining('br.gov.bcb.pix') },
    });
    // Ainda é teste até pagar.
    expect((await diego.get('/auth/eu')).body.assinatura).toMatchObject({
      situacao: 'teste',
      esperandoPagamento: true,
    });

    // Aviso do Asaas: sem o token, recusado; com o token, pagamento confirmado.
    expect(
      (await request(app).post('/asaas/webhook').send({ id: 'x', event: 'PAYMENT_RECEIVED' })).status,
    ).toBe(401);
    expect((await pagar(ultima().id)).status).toBe(200);
    // O mesmo aviso de novo não faz nada.
    const repetido = await request(app)
      .post('/asaas/webhook')
      .set('asaas-access-token', TOKEN_ASAAS)
      .send({
        id: `evt_${evento}`,
        event: 'PAYMENT_RECEIVED',
        payment: { id: ultima().id, value: 2358, dueDate: '2026-01-01', status: 'RECEIVED' },
      });
    expect(repetido.status).toBe(200);
    esquecerRecursos();
    const eu = (await diego.get('/auth/eu')).body;
    expect(eu.assinatura).toMatchObject({
      situacao: 'ativa',
      esperandoPagamento: false,
      jaPagou: true,
      renovar: true,
    });
    expect(new Date(eu.assinatura.acessoAte).getTime() - Date.now()).toBeGreaterThan(27 * 86_400_000);
    expect(eu.conta.modulos).toEqual(expect.arrayContaining(['whatsapp', 'agente_ia']));
    expect((await diego.get('/equipe/plano')).body).toMatchObject({ plano: 'time', usuarios: 5 });
    const { rows } = await pool.query(
      `SELECT etapa, plano FROM cadastro.pedidos_site WHERE email = 'diego@nexosistemas.com.br'`,
    );
    expect(rows[0]).toEqual({ etapa: 'cliente', plano: 'Time' });
    const cobrancas = (await diego.get('/assinatura')).body.cobrancas;
    expect(cobrancas[0]).toMatchObject({ situacao: 'paga', valor: 2358, forma: 'PIX' });
  });

  it('mudar de plano: para mais paga a diferença proporcional; para menos vale na renovação', async () => {
    // Escala + WhatsApp e IA = 3.499; faltam ~30 dias: paga a diferença inteira.
    const sobe = await diego
      .post('/assinatura/assinar')
      .set('Origin', ORIGEM)
      .send({ plano: 'escala', usuarios: 6, modulos: ['whatsapp', 'agente_ia'], ...dados });
    expect(sobe.body).toMatchObject({
      valor: 3499,
      tipo: 'diferenca',
      cobranca: { tipo: 'diferenca', valor: 1141 },
    });
    esquecerRecursos();
    expect((await diego.get('/equipe/plano')).body.plano).toBe('time');
    await pagar(ultima().id);
    esquecerRecursos();
    expect((await diego.get('/equipe/plano')).body.plano).toBe('escala');
    expect((await diego.get('/assinatura')).body.valor).toBe(3499);

    // Para menos: fica marcado para a próxima renovação; o plano de hoje continua.
    const desce = await diego
      .post('/assinatura/assinar')
      .set('Origin', ORIGEM)
      .send({ plano: 'time', usuarios: 5, modulos: ['whatsapp', 'agente_ia', 'ligacoes'], ...dados });
    expect(desce.body).toMatchObject({ valor: 2857, tipo: 'proximo', cobranca: null });
    const r = (await diego.get('/assinatura')).body;
    expect(r.proximo).toMatchObject({ plano: 'time', valor: 2857 });
    esquecerRecursos();
    expect((await diego.get('/equipe/plano')).body.plano).toBe('escala');
  });

  it('renovação: a mensalidade aparece 7 dias antes; venceu, 3 dias normais e depois só leitura até pagar', async () => {
    const org = (await pool.query(`SELECT id FROM cadastro.organizacoes WHERE nome = 'Nexo Sistemas'`))
      .rows[0].id;
    organizacaoId = org;
    // Faltam 5 dias: a mensalidade seguinte é gerada (com a mudança marcada) e o aviso sai.
    await pool.query(
      `UPDATE cadastro.organizacoes SET acesso_ate = now() + interval '5 days' WHERE id = $1`,
      [org],
    );
    await rodada();
    await rodada();
    const abertas = (await diego.get('/assinatura/pagar')).body.abertas;
    expect(abertas).toHaveLength(1);
    expect(abertas[0]).toMatchObject({ tipo: 'mensalidade', valor: 2857 });
    expect(emails.some((e) => e.para === 'diego@nexosistemas.com.br' && /vence em/.test(e.assunto))).toBe(
      true,
    );
    expect((await diego.get('/auth/eu')).body.assinatura).toMatchObject({
      situacao: 'ativa',
      esperandoPagamento: true,
    });

    // Venceu sem pagar: atrasada (tudo funciona), com e-mail.
    const mover = (intervalo: string) =>
      pool.query(
        `UPDATE cadastro.organizacoes SET acesso_ate = now() + $2::interval WHERE id = $1;`.replace(';', ''),
        [org, intervalo],
      );
    const acompanhar = () =>
      pool.query(
        `UPDATE cadastro.cobrancas b SET periodo_de = (o.acesso_ate AT TIME ZONE 'America/Sao_Paulo')::date
           FROM cadastro.organizacoes o WHERE o.id = b.organizacao_id AND b.organizacao_id = $1 AND b.situacao = 'pendente'`,
        [org],
      );
    await mover('-1 hour');
    await acompanhar();
    await rodada();
    expect((await diego.get('/auth/eu')).body.assinatura.situacao).toBe('atrasada');
    expect(
      emails.some(
        (e) => e.para === 'diego@nexosistemas.com.br' && e.assunto === 'O plano do Prospect Team venceu',
      ),
    ).toBe(true);
    // Não gerou outra mensalidade para o mesmo mês.
    expect((await diego.get('/assinatura/pagar')).body.abertas).toHaveLength(1);

    // Passou dos 3 dias: só leitura. Vê e exporta os contatos; não mexe; pagar continua valendo.
    await mover('-4 days');
    await acompanhar();
    await rodada();
    expect((await diego.get('/auth/eu')).body.assinatura).toMatchObject({
      situacao: 'so_leitura',
      soLeituraAte: null,
    });
    expect((await diego.get('/funil')).status).toBe(200);
    expect((await diego.get('/exportar/leads')).status).toBe(200);
    const mexer = await diego
      .post('/nichos')
      .set('Origin', ORIGEM)
      .send({ nome: 'Saúde', cnaes: ['8630-5/04'], termosMaps: ['clínica'] });
    expect(mexer.status).toBe(403);
    expect(mexer.body.erro.codigo).toBe('conta_so_leitura');
    // Quem já pagou não é arquivado.
    await pool.query(
      `UPDATE cadastro.organizacoes SET so_leitura_desde = now() - interval '40 days' WHERE id = $1`,
      [org],
    );
    await rodada();
    expect((await diego.get('/auth/eu')).body.assinatura.situacao).toBe('so_leitura');

    // Pagou ("Já paguei"): volta na hora, com o plano marcado, e o mês conta de hoje.
    const aberta = (await diego.get('/assinatura/pagar')).body.cobranca;
    asaas.cobrancas.find((c) => c.id === aberta.asaasId)!.situacao = 'paga';
    await diego.post('/assinatura/conferir').set('Origin', ORIGEM);
    esquecerRecursos();
    const eu = (await diego.get('/auth/eu')).body;
    expect(eu.assinatura.situacao).toBe('ativa');
    expect(new Date(eu.assinatura.acessoAte).getTime() - Date.now()).toBeGreaterThan(27 * 86_400_000);
    expect((await diego.get('/equipe/plano')).body.plano).toBe('time');
    expect(eu.conta.modulos).toContain('ligacoes');
  });

  it('minutos de ligação: pacote avulso, saldo que não vence e as ligações param quando acaba', async () => {
    const r = await diego.post('/assinatura/minutos').set('Origin', ORIGEM).send({ pacotes: 1 });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ tipo: 'minutos', valor: 149, minutos: 500 });
    await pagar(ultima().id);
    let s = (await diego.get('/ligacoes/situacao')).body;
    expect(s.minutos).toMatchObject({ franquia: 2000, pacote: 500, compraPacote: true });
    // Usou 2.400 minutos neste mês: ainda dá (2.000 + 500).
    const conta = (
      await pool.query(`SELECT id FROM cadastro.contas WHERE organizacao_id = $1`, [organizacaoId])
    ).rows[0].id;
    await pool.query(
      `INSERT INTO comercial.ligacoes (conta_id, telefone, sala, situacao, atendida_em, duracao_segundos)
       VALUES ($1, '71999990000', 'lig-teste-1', 'encerrada', now(), $2)`,
      [conta, 2400 * 60],
    );
    const ligar = () =>
      diego.post('/ligacoes').set('Origin', ORIGEM).send({ empresaId: null, telefone: '71988887777' });
    expect((await ligar()).body.erro?.codigo).not.toBe('sem_minutos');
    // Mais 100: acabou. Para até comprar outro pacote.
    await pool.query(
      `INSERT INTO comercial.ligacoes (conta_id, telefone, sala, situacao, atendida_em, duracao_segundos)
       VALUES ($1, '71999990000', 'lig-teste-2', 'encerrada', now(), $2)`,
      [conta, 100 * 60],
    );
    const parou = await ligar();
    expect(parou.status).toBe(403);
    expect(parou.body.erro.codigo).toBe('sem_minutos');
    // Virou o mês: o que passou da franquia (500) sai do saldo; sobra 0. Com 300 de excedente, sobrariam 200.
    await pool.query(
      `UPDATE comercial.ligacoes SET duracao_segundos = 1150 * 60 WHERE sala IN ('lig-teste-1', 'lig-teste-2')`,
    );
    await pool.query(
      `UPDATE comercial.ligacoes SET iniciada_em = date_trunc('month', now()) - interval '10 days' WHERE sala IN ('lig-teste-1', 'lig-teste-2')`,
    );
    const mesPassado = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15)
      .toISOString()
      .slice(0, 7);
    await pool.query(`UPDATE cadastro.organizacoes SET minutos_saldo_mes = $2 WHERE id = $1`, [
      organizacaoId,
      mesPassado,
    ]);
    await rodada();
    s = (await diego.get('/ligacoes/situacao')).body;
    expect(s.minutos).toMatchObject({ usados: 0, pacote: 200 });
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
    expect(r.numeros).toMatchObject({ ativas: 1, testes30: 2, viraram30: 1, mrr: 2857 });
    const nexo = r.pedidos.find((p: { email: string }) => p.email === 'diego@nexosistemas.com.br');
    expect(nexo.assinatura).toMatchObject({ situacao: 'ativa', plano: 'time', forma: 'PIX' });
  });
});
