import { criarPool, migrar, type Pool } from '@prospeccao/db';
import { bancoDeTeste } from '@prospeccao/db/teste';
import type { NomeJob } from '@prospeccao/queue';
import { criarLogger } from '@prospeccao/shared';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../src/app.js';

const URL_TESTE = process.env.TEST_DATABASE_URL;
const ORIGEM = 'http://localhost:5173';

describe.skipIf(!URL_TESTE)('API (com Postgres)', () => {
  let pool: Pool;
  let app: ReturnType<typeof criarApp>;
  let cookie = '';
  const publicados: { nome: NomeJob; payload: unknown }[] = [];
  const cancelados: { nome: NomeJob; filtro: unknown }[] = [];
  /** Simula a fila exclusiva ocupada: o pg-boss devolve null ao publicar. */
  let filaOcupada = false;

  const enviar = (metodo: 'post' | 'put' | 'patch' | 'delete', rota: string, corpo?: object) =>
    request(app)[metodo](rota).set('Origin', ORIGEM).set('Cookie', cookie).send(corpo);
  const ler = (rota: string) => request(app).get(rota).set('Cookie', cookie);

  beforeAll(async () => {
    pool = criarPool({ url: await bancoDeTeste(URL_TESTE!, 'api'), aplicacao: 'teste-api', max: 4 });
    const log = criarLogger('teste', 'silent');
    await migrar(pool, log);
    await pool.query('TRUNCATE cadastro.campanhas, cadastro.nichos, cadastro.bases RESTART IDENTITY CASCADE');
    await pool.query('TRUNCATE descoberta.empresas, descoberta.buscas_maps RESTART IDENTITY CASCADE');
    await pool.query('TRUNCATE base_cnpj.importacoes, base_cnpj.socios RESTART IDENTITY CASCADE');
    await pool.query(
      'TRUNCATE enriquecimento.leads, enriquecimento.pessoas, enriquecimento.contatos, enriquecimento.etapas RESTART IDENTITY CASCADE',
    );
    await pool.query('TRUNCATE comercial.oportunidades CASCADE');
    app = criarApp({
      pool,
      log,
      filas: {
        async publicar(nome, payload) {
          if (filaOcupada) return null;
          publicados.push({ nome, payload });
          return 'job-1';
        },
        async cancelarPendentes(nome, filtro) {
          cancelados.push({ nome, filtro });
          return 3;
        },
        async publicarVarios(nome, payloads) {
          for (const payload of payloads) publicados.push({ nome, payload });
          return payloads.length;
        },
        async tamanhos() {
          return { 'maps.coletar': 1 };
        },
      },
      auth: {
        jwtSegredo: 'x'.repeat(40),
        adminEmail: 'ops@exemplo.com',
        adminSenhaHash: await bcrypt.hash('senha-forte-123', 4),
        sessaoHoras: 1,
        cookieSeguro: false,
      },
      origens: [ORIGEM],
      geocodificar: async () => ({ lat: -12.97, lng: -38.51 }),
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('saúde pública responde sem login', async () => {
    const r = await request(app).get('/saude');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
  });

  it('bloqueia rotas sem sessão', async () => {
    const r = await request(app).get('/nichos');
    expect(r.status).toBe(401);
    expect(r.body.erro.codigo).toBe('nao_autorizado');
  });

  it('recusa login errado e aceita o certo, com cookie httpOnly', async () => {
    const errado = await request(app)
      .post('/auth/login')
      .set('Origin', ORIGEM)
      .send({ email: 'ops@exemplo.com', senha: 'x' });
    expect(errado.status).toBe(401);

    const ok = await request(app)
      .post('/auth/login')
      .set('Origin', ORIGEM)
      .send({ email: 'OPS@exemplo.com', senha: 'senha-forte-123' });
    expect(ok.status).toBe(200);
    const setCookie = ok.headers['set-cookie'] as unknown as string[];
    expect(setCookie[0]).toMatch(/HttpOnly/);
    expect(setCookie[0]).toMatch(/SameSite=Strict/);
    cookie = setCookie[0]!.split(';')[0]!;

    const eu = await ler('/auth/eu');
    // O login do ambiente vira o primeiro administrador.
    expect(eu.body).toMatchObject({ email: 'ops@exemplo.com', papel: 'admin' });
  });

  it('recusa escrita de origem desconhecida (CSRF)', async () => {
    const r = await request(app)
      .post('/nichos')
      .set('Origin', 'https://site-malicioso.com')
      .set('Cookie', cookie)
      .send({});
    expect(r.status).toBe(403);
  });

  it('valida e cria nicho, normalizando CNAE', async () => {
    const invalido = await enviar('post', '/nichos', { nome: 'Pet', cnaes: ['123'], termosMaps: [] });
    expect(invalido.status).toBe(422);
    expect(invalido.body.erro.detalhes.length).toBeGreaterThan(0);

    const r = await enviar('post', '/nichos', {
      nome: 'Autopeças varejo',
      cnaes: ['4530-7/03', '4530-7/04'],
      termosMaps: ['autopeças', 'moto peças'],
      palavrasNegativas: ['oficina'],
      cargosAlvo: ['sócio-administrador'],
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      id: 1,
      cnaes: ['4530703', '4530704'],
      ativo: true,
      campanhasEmAndamento: 0,
    });

    const duplicado = await enviar('post', '/nichos', {
      nome: 'autopeças VAREJO',
      cnaes: ['4530703'],
      termosMaps: ['x'],
    });
    expect(duplicado.status).toBe(409);
  });

  it('cria base pelo endereço (geocodificado)', async () => {
    const r = await enviar('post', '/bases', {
      nome: 'Base Centro',
      endereco: 'Av. Sete de Setembro, Salvador',
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ nome: 'Base Centro', lat: -12.97, lng: -38.51, ativa: true });
  });

  it('cria, inicia, pausa e encerra campanha com transições válidas', async () => {
    const criada = await enviar('post', '/campanhas', {
      nome: 'Autopeças Salvador',
      nichoId: 1,
      cidades: [
        { cidade: 'Salvador', uf: 'ba' },
        { cidade: 'Lauro de Freitas', uf: 'BA' },
      ],
    });
    expect(criada.status).toBe(201);
    expect(criada.body).toMatchObject({
      id: 1,
      status: 'rascunho',
      nichoNome: 'Autopeças varejo',
      raioKm: null, // nacional por padrão
      metaDiaria: 40,
    });
    expect(criada.body.progresso).toMatchObject({ empresas: 0, buscasPendentes: 0 });

    // Edição parcial mexe só no que veio: renomear não volta raio nem meta ao padrão.
    const comRaio = await enviar('patch', '/campanhas/1', { raioKm: 20, metaDiaria: 60 });
    expect(comRaio.body).toMatchObject({ raioKm: 20, metaDiaria: 60 });
    const renomeada = await enviar('patch', '/campanhas/1', { nome: 'Autopeças RMS' });
    expect(renomeada.body).toMatchObject({ nome: 'Autopeças RMS', raioKm: 20, metaDiaria: 60 });

    const iniciada = await enviar('post', '/campanhas/1/iniciar');
    expect(iniciada.status).toBe(202);
    expect(iniciada.body.campanha.status).toBe('ativa');
    expect(iniciada.body.avisos[0]).toMatch(/base de CNPJ/);
    expect(publicados).toContainEqual({ nome: 'campanha.iniciar', payload: { campanhaId: 1 } });

    expect((await enviar('post', '/campanhas/1/pausar')).body.status).toBe('pausada');
    expect((await enviar('post', '/campanhas/1/encerrar')).body.status).toBe('encerrada');
    const reabrir = await enviar('post', '/campanhas/1/iniciar');
    expect(reabrir.status).toBe(409);
  });

  it('não desativa nicho com campanha em andamento', async () => {
    await enviar('post', '/campanhas', {
      nome: 'Outra',
      nichoId: 1,
      cidades: [{ cidade: 'Salvador', uf: 'BA' }],
    });
    await enviar('post', '/campanhas/2/iniciar');
    const r = await enviar('delete', '/nichos/1');
    expect(r.status).toBe(409);
  });

  it('lista e detalha empresas descobertas com filtros e sócios', async () => {
    await pool.query(
      `INSERT INTO descoberta.empresas (cnpj, cnpj_basico, nome, razao_social, cidade, uf, maps_avaliacoes, sinal_entrega, place_id, distancia_base_km)
       VALUES ('11222333000181', '11222333', 'Autopeças Ladeira Nova', 'LADEIRA NOVA LTDA', 'SALVADOR', 'BA', 412, true, 'p1', 4.2),
              (NULL, NULL, 'Moto Peças Nova Era', NULL, 'SALVADOR', 'BA', 30, NULL, 'p3', 6.0)`,
    );
    await pool.query(
      `INSERT INTO descoberta.campanha_empresas (campanha_id, empresa_id, origem, dentro_do_raio) VALUES (2, 1, 'ambos', true), (2, 2, 'maps', true)`,
    );
    await pool.query(
      `INSERT INTO base_cnpj.qualificacoes VALUES ('49', 'Sócio-Administrador') ON CONFLICT DO NOTHING`,
    );
    await pool.query(
      `INSERT INTO base_cnpj.socios (cnpj_basico, tipo, nome, qualificacao_codigo) VALUES ('11222333', 'pf', 'CARLOS MENEZES', '49')`,
    );

    const todas = await ler('/empresas?campanhaId=2');
    expect(todas.body.total).toBe(2);
    expect(todas.body.itens[0]).toMatchObject({
      nome: 'Autopeças Ladeira Nova',
      origem: 'ambos',
      noMaps: true,
    });

    const comCnpj = await ler('/empresas?comCnpj=true&entrega=true');
    expect(comCnpj.body.itens.map((e: { nome: string }) => e.nome)).toEqual(['Autopeças Ladeira Nova']);

    const busca = await ler('/empresas?busca=nova%20era');
    expect(busca.body.total).toBe(1);

    const detalhe = await ler('/empresas/1');
    expect(detalhe.body.socios).toEqual([
      expect.objectContaining({ nome: 'CARLOS MENEZES', qualificacao: 'Sócio-Administrador', prioridade: 1 }),
    ]);
    expect(detalhe.body.campanhas[0]).toMatchObject({ id: 2, nome: 'Outra', origem: 'ambos' });

    expect((await ler('/empresas/999')).status).toBe(404);
    expect((await ler('/empresas/abc')).status).toBe(400);
  });

  it('mostra nota, decisor e contatos do enriquecimento; filtra por faixa e WhatsApp', async () => {
    await pool.query(
      `INSERT INTO enriquecimento.leads (empresa_id, campanha_id, status, faixa, score, motivo, concluido_em)
       VALUES (1, 2, 'concluido', 'A', 84, 'Faz entrega, 412 avaliações', now())`,
    );
    await pool.query(
      `INSERT INTO enriquecimento.pessoas (empresa_id, nome, cargo, papel, decisor, prioridade, fontes)
       VALUES (1, 'Maria Souza', 'Compradora', 'compras', true, 1, '{linkedin}'),
              (1, 'CARLOS MENEZES', 'Sócio-Administrador', 'socio', false, 2, '{receita}')`,
    );
    await pool.query(
      `INSERT INTO enriquecimento.contatos (empresa_id, canal, valor, fonte, fontes, status, whatsapp, principal)
       VALUES (1, 'whatsapp', '71998124410', 'site', '{site,maps}', 'verificado', true, true),
              (1, 'email', 'compras@ladeira.com.br', 'site', '{site}', 'nao_verificado', NULL, false)`,
    );
    await pool.query(
      `INSERT INTO enriquecimento.etapas (empresa_id, ordem, etapa, status, detalhe) VALUES (1, 1, 'receita', 'encontrado', '1 sócio')`,
    );

    const lista = await ler('/empresas?campanhaId=2');
    expect(lista.body.itens[0]).toMatchObject({
      nome: 'Autopeças Ladeira Nova',
      faixa: 'A',
      score: 84,
      decisorNome: 'Maria Souza',
      contatoCanal: 'whatsapp',
      contatoStatus: 'verificado',
    });
    expect(lista.body.itens[1]).toMatchObject({
      nome: 'Moto Peças Nova Era',
      faixa: null,
      enriqStatus: null,
    });

    expect((await ler('/empresas?faixa=A')).body.total).toBe(1);
    expect((await ler('/empresas?faixa=pendente')).body.itens.map((e: { nome: string }) => e.nome)).toEqual([
      'Moto Peças Nova Era',
    ]);
    expect((await ler('/empresas?comWhatsapp=true')).body.total).toBe(1);

    const d = await ler('/empresas/1');
    expect(d.body.enriquecimento).toMatchObject({ status: 'concluido', faixa: 'A' });
    expect(d.body.pessoas.map((p: { nome: string }) => p.nome)).toEqual(['Maria Souza', 'CARLOS MENEZES']);
    expect(d.body.contatos[0]).toMatchObject({
      canal: 'whatsapp',
      principal: true,
      fontes: ['site', 'maps'],
    });
    expect(d.body.etapas).toEqual([expect.objectContaining({ etapa: 'receita', status: 'encontrado' })]);

    expect((await ler('/campanhas/2/reenriquecer')).body).toEqual({ ab: 1, semDecisor: 1, todos: 2 });
    expect((await enviar('post', '/campanhas/2/reenriquecer', { escopo: 'ab' })).body).toEqual({
      quantidade: 1,
    });
    const todos = await enviar('post', '/campanhas/2/reenriquecer', { escopo: 'todos' });
    expect(todos.status).toBe(202);
    expect(todos.body).toEqual({ quantidade: 2 });
    expect(publicados).toContainEqual({
      nome: 'enriquecimento.solicitar',
      payload: { empresaId: 2, campanhaId: 2, forcar: true },
    });

    const r = await enviar('post', '/empresas/1/enriquecer');
    expect(r.status).toBe(202);
    expect(publicados).toContainEqual({
      nome: 'enriquecimento.solicitar',
      payload: { empresaId: 1, campanhaId: 2, forcar: true },
    });
  });

  it('seu retorno: número errado sai de principal, "não é quem decide" tira o decisor, e dá para desfazer', async () => {
    const errado = await enviar('post', '/empresas/1/feedback', {
      tipo: 'numero_errado',
      valor: '71998124410',
    });
    expect(errado.status).toBe(200);
    const zap = errado.body.contatos.find((c: { valor: string }) => c.valor === '71998124410');
    expect(zap).toMatchObject({ status: 'invalido', principal: false, marcadoErrado: true });
    expect(errado.body.contatos.find((c: { principal: boolean }) => c.principal)?.valor).toBe(
      'compras@ladeira.com.br',
    );
    // A lista e o funil já usam o próximo contato.
    expect((await ler('/empresas?campanhaId=2')).body.itens[0]).toMatchObject({
      contatoValor: 'compras@ladeira.com.br',
    });

    const naoDecide = await enviar('post', '/empresas/1/feedback', {
      tipo: 'nao_decisor',
      valor: 'Maria Souza',
    });
    expect(naoDecide.body.pessoas.find((p: { nome: string }) => p.nome === 'Maria Souza')).toMatchObject({
      decisor: false,
      naoDecisor: true,
    });
    expect((await ler('/empresas?campanhaId=2')).body.itens[0].decisorNome).toBeNull();

    const rel = await ler('/relatorios?dias=0');
    expect(rel.body.errosPorFonte).toEqual(
      expect.arrayContaining([expect.objectContaining({ fonte: 'site', erros: 1 })]),
    );
    expect(rel.body.naoDecisores).toBe(1);
    expect(rel.body.custos).toMatchObject({ basePagaBrl: 0, basePagaConsultas: 0 });

    // Desfaz os dois: tudo volta como estava.
    await enviar('delete', '/empresas/1/feedback', { tipo: 'numero_errado', valor: '71998124410' });
    const volta = await enviar('delete', '/empresas/1/feedback', {
      tipo: 'nao_decisor',
      valor: 'Maria Souza',
    });
    expect(volta.body.contatos.find((c: { principal: boolean }) => c.principal)?.valor).toBe('71998124410');
    expect(volta.body.pessoas[0]).toMatchObject({ nome: 'Maria Souza', decisor: true });
    expect((await enviar('post', '/empresas/1/feedback', { tipo: 'outro', valor: 'x' })).status).toBe(422);
  });

  it('funil: entra sem duplicar, barra telefone repetido, avança etapas e alimenta os relatórios', async () => {
    const add = await enviar('post', '/funil', { empresaIds: [1] });
    expect(add.status).toBe(200);
    expect(add.body).toMatchObject({ adicionadas: 1, jaNoFunil: 0, duplicadas: [] });
    // Rodar de novo (ou outra campanha achar a mesma loja) não cria um segundo card.
    expect((await enviar('post', '/funil', { empresaIds: [1] })).body).toMatchObject({
      adicionadas: 0,
      jaNoFunil: 1,
    });

    // Outra empresa com o mesmo WhatsApp: fica de fora, com o aviso de quem já tem o número.
    await pool.query(
      `INSERT INTO enriquecimento.contatos (empresa_id, canal, valor, fonte, fontes, status, principal)
       VALUES (2, 'whatsapp', '71998124410', 'instagram', '{instagram}', 'nao_verificado', true)`,
    );
    const dup = await enviar('post', '/funil', { empresaIds: [2] });
    expect(dup.body.adicionadas).toBe(0);
    expect(dup.body.duplicadas).toEqual([
      expect.objectContaining({
        empresaId: 2,
        outraEmpresaId: 1,
        outraEtapa: 'a_abordar',
        telefone: '71998124410',
      }),
    ]);
    expect((await ler('/funil/2')).body.duplicada).toMatchObject({ outraEmpresaId: 1 });
    expect((await enviar('post', '/funil', { empresaIds: [2], forcar: true })).body.adicionadas).toBe(1);
    expect((await enviar('delete', '/funil/2')).status).toBe(204);
    expect((await ler('/empresas?situacao=novos')).body.itens.map((e: { id: number }) => e.id)).toEqual([2]);
    expect((await ler('/empresas?situacao=no_funil')).body.itens[0]).toMatchObject({
      id: 1,
      funilEtapa: 'a_abordar',
    });

    // Mandou mensagem → abordado; ele respondeu → respondeu. Próximo passo vencido aparece como pendente.
    const msg = await enviar('post', '/funil/1/atividades', {
      tipo: 'whatsapp',
      direcao: 'enviada',
      texto: 'Oi Maria, aqui é da Tutts',
      proximaAcao: 'Cobrar resposta',
      proximaAcaoEm: '2020-01-01',
    });
    expect(msg.status).toBe(201);
    expect(msg.body.oportunidade).toMatchObject({
      etapa: 'abordado',
      proximaAcao: 'Cobrar resposta',
      pendente: true,
    });
    const quadro = await ler('/funil');
    expect(quadro.body.pendentes).toBe(1);
    expect(quadro.body.cards[0]).toMatchObject({ empresaId: 1, etapa: 'abordado', faixa: 'A', contatos: 1 });
    expect((await ler('/funil?pendentes=true')).body.cards).toHaveLength(1);

    const resp = await enviar('post', '/funil/1/atividades', {
      tipo: 'whatsapp',
      direcao: 'recebida',
      texto: 'Quanto custa?',
    });
    expect(resp.body.oportunidade.etapa).toBe('respondeu');
    // Nota não mexe na etapa.
    expect(
      (await enviar('post', '/funil/1/atividades', { tipo: 'nota', texto: 'Ligar à tarde' })).body
        .oportunidade.etapa,
    ).toBe('respondeu');

    const semMotivo = await enviar('patch', '/funil/1', { etapa: 'perdido' });
    expect(semMotivo.status).toBeGreaterThanOrEqual(400);
    const ganho = await enviar('patch', '/funil/1', { etapa: 'ganho', valorMensal: 1800 });
    expect(ganho.body.oportunidade).toMatchObject({ etapa: 'ganho', valorMensal: 1800, proximaAcao: null });
    expect(
      ganho.body.atividades
        .filter((a: { tipo: string }) => a.tipo === 'etapa')
        .map((a: { paraEtapa: string }) => a.paraEtapa),
    ).toEqual(['ganho', 'respondeu', 'abordado', 'a_abordar']);

    // Descartado: sai dos "novos", não volta a ser enriquecido pela campanha.
    const desc = await enviar('post', '/funil', {
      empresaIds: [2],
      etapa: 'descartado',
      motivo: 'Atacadista',
    });
    expect(desc.body.adicionadas).toBe(1);
    expect((await ler('/empresas?situacao=descartados')).body.total).toBe(1);
    expect((await ler('/empresas?situacao=novos')).body.total).toBe(0);
    expect((await enviar('post', '/campanhas/2/reenriquecer', { escopo: 'todos' })).body).toEqual({
      quantidade: 1,
    });
    const camp = await ler('/campanhas/2');
    expect(camp.body.progresso).toMatchObject({ novos: 0, noFunil: 1, descartados: 1 });

    const rel = await ler('/relatorios?dias=0');
    expect(rel.status).toBe(200);
    expect(rel.body.kpis).toMatchObject({
      encontrados: 2,
      faixaA: 1,
      comDecisor: 1,
      entraramNoFunil: 1,
      abordados: 1,
      responderam: 1,
      ganhos: 1,
      valorGanho: 1800,
    });
    // Funil cumulativo: quem fechou conta como tendo passado pelas etapas do meio.
    expect(rel.body.funil).toMatchObject({ a_abordar: 1, abordado: 1, respondeu: 1, reuniao: 1, ganho: 1 });
    expect(rel.body.faixas).toEqual([expect.objectContaining({ faixa: 'A', noFunil: 1, ganhos: 1 })]);
    expect(rel.body.motivos).toEqual([{ etapa: 'descartado', motivo: 'Atacadista', quantidade: 1 }]);
    expect(rel.body.campanhas[0]).toMatchObject({ id: 2, encontrados: 2, ganhos: 1, descartados: 1 });
    expect(rel.body.diario.at(-1)).toMatchObject({ contatos: 1, respostas: 1 });
    expect((await ler('/relatorios?dias=7&campanhaId=2')).status).toBe(200);
  });

  it('funil: cadência marca o follow-up sozinho, monta a mensagem e encerra quem não responde', async () => {
    // Quem mexer na cadência pela tela muda tudo daqui para a frente.
    const cfg = await ler('/funil/cadencia');
    expect(cfg.body).toMatchObject({ diasFollowup: [2, 3, 5], encerrarSemResposta: true });
    const salvo = await enviar('put', '/funil/cadencia', {
      ...cfg.body,
      diasFollowup: [2, 3],
      remetente: 'Leo',
    });
    expect(salvo.status).toBe(200);
    expect(salvo.body).toMatchObject({ diasFollowup: [2, 3], remetente: 'Leo' });
    expect((await enviar('put', '/funil/cadencia', { ...cfg.body, diasEncerrar: 0 })).status).toBe(422);

    // Volta do descarte: entra com "Primeira abordagem" para hoje.
    const volta = await enviar('post', '/funil', { empresaIds: [2], forcar: true });
    expect(volta.body.adicionadas).toBe(1);
    let d = (await ler('/funil/2')).body;
    expect(d.oportunidade).toMatchObject({
      etapa: 'a_abordar',
      proximaAcao: 'Primeira abordagem',
      pendente: true,
    });

    const msg = await ler('/funil/2/mensagem');
    expect(msg.body).toMatchObject({
      modelo: 'primeira',
      tentativa: 1,
      totalTentativas: 3,
      telefone: '71998124410',
    });
    expect(msg.body.texto).toContain('Aqui é Leo da Tutts');

    // 1ª mensagem → Abordado, follow-up 1 em 2 dias úteis (não pendente hoje).
    const enviar1 = () =>
      enviar('post', '/funil/2/atividades', { tipo: 'whatsapp', direcao: 'enviada', texto: 'oi' });
    d = (await enviar1()).body;
    expect(d.oportunidade).toMatchObject({
      etapa: 'abordado',
      proximaAcao: 'Follow-up 1',
      tentativas: 1,
      pendente: false,
    });
    expect((await ler('/funil/2/mensagem')).body.modelo).toBe('followup1');
    d = (await enviar1()).body;
    expect(d.oportunidade).toMatchObject({ proximaAcao: 'Follow-up 2', tentativas: 2 });
    expect((await ler('/funil/2/mensagem')).body.modelo).toBe('ultima');
    d = (await enviar1()).body;
    expect(d.oportunidade).toMatchObject({ proximaAcao: 'Sem resposta: encerrar', tentativas: 3 });
    expect(d.oportunidade.encerrarEm).toBeTruthy();

    // Prazo passou sem resposta: a automação leva para Perdido com o motivo.
    await pool.query(
      "UPDATE comercial.oportunidades SET encerrar_em = now() - interval '1 minute' WHERE empresa_id = 2",
    );
    const { encerrarSemResposta } = await import('../src/modulos/funil/repositorio.js');
    expect(await encerrarSemResposta(pool)).toBe(1);
    d = (await ler('/funil/2')).body;
    expect(d.oportunidade).toMatchObject({
      etapa: 'perdido',
      motivo: 'Sem resposta após 3 mensagens',
      proximaAcao: null,
    });
    expect(d.atividades[0]).toMatchObject({ tipo: 'etapa', paraEtapa: 'perdido', autor: 'sistema' });
    expect(await encerrarSemResposta(pool)).toBe(0);

    // Arrastar de volta para Abordado conta como 1ª mensagem; resposta zera e pede retorno hoje.
    d = (await enviar('patch', '/funil/2', { etapa: 'abordado' })).body;
    expect(d.oportunidade).toMatchObject({ etapa: 'abordado', tentativas: 1, proximaAcao: 'Follow-up 1' });
    d = (
      await enviar('post', '/funil/2/atividades', { tipo: 'whatsapp', direcao: 'recebida', texto: 'quanto?' })
    ).body;
    expect(d.oportunidade).toMatchObject({
      etapa: 'respondeu',
      tentativas: 0,
      pendente: true,
      encerrarEm: null,
    });
    expect((await ler('/funil')).body.totalTentativas).toBe(3);
    await enviar('put', '/funil/cadencia', cfg.body);
  });

  it('planilha do Maps vai para o worker-descoberta em lotes, sem escrever no schema dele', async () => {
    const itens = Array.from({ length: 501 }, (_, i) => ({ nome: `Loja ${i}`, telefone: '(71) 3333-0000' }));
    const r = await enviar('post', '/importacoes/planilha-maps', {
      campanhaId: 2,
      cidade: 'Salvador',
      uf: 'ba',
      itens,
    });
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ linhas: 501, lotes: 2 });
    const lotes = publicados.filter((p) => p.nome === 'maps.importar_planilha');
    expect(lotes.map((l) => (l.payload as { itens: unknown[] }).itens.length)).toEqual([500, 1]);
    expect(lotes[0]?.payload).toMatchObject({ campanhaId: 2, uf: 'BA' });
    expect(
      (
        await enviar('post', '/importacoes/planilha-maps', {
          campanhaId: 2,
          cidade: 'Salvador',
          uf: 'BA',
          itens: [],
        })
      ).status,
    ).toBe(422);
  });

  it('pede importação da base de CNPJ pela fila, sem escrever no schema do worker', async () => {
    const r = await enviar('post', '/importacoes/cnpj', { mes: '2026-09' });
    expect(r.status).toBe(202);
    expect(publicados).toContainEqual({
      nome: 'cnpj.importar',
      payload: { mes: '2026-09', motivo: 'manual' },
    });
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM base_cnpj.importacoes');
    expect(rows[0].n).toBe(0);
  });

  it('importação com nova tentativa agendada explica quando roda', async () => {
    // Tabela do pg-boss com as colunas que a leitura usa (a real tem mais).
    await pool.query(`CREATE SCHEMA IF NOT EXISTS fila`);
    await pool.query(`DROP TABLE IF EXISTS fila.job`);
    await pool.query(
      `CREATE TABLE fila.job (name text, state text, retry_count int, retry_limit int,
         start_after timestamptz, started_on timestamptz, created_on timestamptz DEFAULT now(), data jsonb)`,
    );
    await pool.query(
      `INSERT INTO fila.job (name, state, retry_count, retry_limit, start_after)
       VALUES ('cnpj.importar', 'retry', 0, 2, '2026-10-19T02:56:00Z')`,
    );
    filaOcupada = true;
    try {
      const r = await enviar('post', '/importacoes/cnpj', {});
      expect(r.status).toBe(409);
      // 02:56 UTC = 23:56 em São Paulo
      expect(r.body.erro.mensagem).toMatch(/tenta de novo sozinha às 23:56 \(tentativa 2 de 3\)/);
    } finally {
      filaOcupada = false;
    }

    const atividade = await ler('/atividade');
    expect(atividade.body.importacaoAgendada).toMatchObject({ estado: 'nova_tentativa', falhas: 1 });
  });

  it('atividade mostra buscas em andamento primeiro, com o nome da campanha', async () => {
    await pool.query(
      `INSERT INTO descoberta.buscas_maps (campanha_id, cidade, uf, termo, status, itens, concluido_em)
       VALUES (1, 'Salvador', 'BA', 'autopeças', 'concluida', 87, now() - interval '1 hour'),
              (1, 'Feira de Santana', 'BA', 'autopeças', 'rodando', NULL, NULL)`,
    );
    const r = await ler('/atividade');
    expect(r.status).toBe(200);
    expect(r.body.buscasEmAndamento).toBe(1);
    expect(r.body.buscas[0]).toMatchObject({
      cidade: 'Feira de Santana',
      status: 'rodando',
      campanha: 'Autopeças RMS',
    });
    expect(r.body.buscas[1]).toMatchObject({ cidade: 'Salvador', itens: 87 });
    // Contagem direta na tabela da fila (o job de importação com nova tentativa do teste anterior).
    expect(r.body.filas).toEqual({ 'cnpj.importar': 1 });
  });

  it('MEI fica fora da lista de leads, a menos que peça para ver', async () => {
    const antes = (await ler('/empresas?situacao=todos')).body.total;
    await pool.query('UPDATE descoberta.empresas SET mei = true WHERE id = 2');
    expect((await ler('/empresas?situacao=todos')).body.total).toBe(antes - 1);
    const com = await ler('/empresas?situacao=todos&incluirMei=true');
    expect(com.body.itens.find((e: { id: number }) => e.id === 2)).toMatchObject({ mei: true });
    await pool.query('UPDATE descoberta.empresas SET mei = false WHERE id = 2');
  });

  it('Google Places: painel do mês, estimativa antes de rodar e teto da campanha', async () => {
    const cfg = await enviar('put', '/places/config', {
      franquiaMensal: 100,
      precoMilUsd: 35,
      cotacaoBrl: 5.5,
      tetoMensalUsd: '',
      maxBairros: 150,
    });
    expect(cfg.status).toBe(200);
    expect(cfg.body).toMatchObject({ franquiaMensal: 100, precoMilUsd: 35, tetoMensalUsd: null });
    expect((await enviar('put', '/places/config', { franquiaMensal: -1 })).status).toBe(422);

    await pool.query(
      `INSERT INTO descoberta.uso_places (mes, paga, custo_usd)
       SELECT descoberta.mes_places(), false, 0 FROM generate_series(1, 90)`,
    );
    const uso = await ler('/places/uso');
    expect(uso.body).toMatchObject({ franquia: 100, usados: 90, gratisRestantes: 10, pagos: 0, gastoUsd: 0 });
    expect(uso.body.precoPorPedidoUsd).toBeCloseTo(0.035);
    expect(uso.body.renovaEm > uso.body.mes).toBe(true);

    const criada = await enviar('post', '/campanhas', {
      nome: 'Places Feira',
      nichoId: 1,
      cidades: [{ cidade: 'Feira de Santana', uf: 'BA' }],
    });
    const id = criada.body.id as number;
    const est = await ler(`/campanhas/${id}/estimativa-places`);
    expect(est.status).toBe(200);
    expect(est.body).toMatchObject({ paginasPorBusca: 3, divideBairro: true, gratisRestantes: 10 });
    expect(est.body.pedidosMax).toBeGreaterThanOrEqual(3);
    expect(est.body.gratis).toBe(Math.min(est.body.pedidosMax, 10));
    expect(est.body.custoUsd).toBeCloseTo((est.body.pedidosMax - est.body.gratis) * 0.035, 2);

    const iniciada = await enviar('post', `/campanhas/${id}/iniciar`, { tetoPlacesUsd: 0 });
    expect(iniciada.status).toBe(202);
    expect(iniciada.body.campanha.tetoPlacesUsd).toBe(0);
    const teto = await enviar('put', `/campanhas/${id}/teto-places`, { tetoPlacesUsd: 12.5 });
    expect(teto.body.tetoPlacesUsd).toBe(12.5);
    expect((await enviar('put', `/campanhas/${id}/teto-places`, { tetoPlacesUsd: -3 })).status).toBe(422);

    await pool.query(
      `INSERT INTO descoberta.uso_places (mes, campanha_id, paga, custo_usd)
       VALUES (descoberta.mes_places(), $1, true, 0.035), (descoberta.mes_places(), $1, true, 0.035)`,
      [id],
    );
    const card = await ler(`/campanhas/${id}`);
    expect(card.body.progresso).toMatchObject({ pedidosPlaces: 2, pagosPlaces: 2 });
    expect(card.body.progresso.gastoPlacesUsd).toBeCloseTo(0.07);
    await enviar('post', `/campanhas/${id}/encerrar`);
  });

  it('agente: aborda, recebe a resposta pelo webhook, responde com IA, marca reunião e respeita "pare"', async () => {
    const motor = await import('../src/modulos/agente/motor.js');
    const repoAgente = await import('../src/modulos/agente/repositorio.js');
    await pool.query(
      `INSERT INTO descoberta.empresas (id, nome, cidade, uf, maps_telefone) VALUES (77, 'Diesel Norte', 'SALVADOR', 'BA', '7132449744')
       ON CONFLICT (id) DO NOTHING`,
    );
    await pool.query(
      `INSERT INTO enriquecimento.contatos (empresa_id, canal, valor, fonte, fontes, status, whatsapp, principal)
       VALUES (77, 'whatsapp', '71988776655', 'site', '{site}', 'verificado', true, true)`,
    );
    expect((await enviar('post', '/funil', { empresaIds: [77], forcar: true })).body.adicionadas).toBe(1);
    expect((await enviar('patch', '/funil/77', { agente: true })).body.oportunidade).toMatchObject({
      agente: true,
    });

    const tela = await ler('/agente');
    expect(tela.body.status).toEqual({ whatsapp: false, ia: false });
    expect(tela.body.webhook).toMatch(/\/webhooks\/evolution\/[0-9a-f]{32}$/);
    const token = tela.body.webhook.split('/').at(-1);
    const salvo = await enviar('put', '/agente/config', {
      ...tela.body.config,
      ligado: true,
      revisarAntes: true,
      horaInicio: 0,
      horaFim: 24,
      diasSemana: [0, 1, 2, 3, 4, 5, 6],
      intervaloSeg: 20,
    });
    expect(salvo.status).toBe(200);
    const cfg = await repoAgente.obterConfig(pool);

    const enviados: { tel: string; texto: string }[] = [];
    const decisoes: object[] = [];
    const deps = {
      pool,
      log: criarLogger('teste', 'silent'),
      whatsapp: {
        async enviar(tel: string, texto: string) {
          enviados.push({ tel, texto });
          return { idExterno: `ext-${enviados.length}` };
        },
      },
      ia: {
        async decidir() {
          return decisoes.shift() as never;
        },
      },
    };

    // 1) Abordagem da cadência vira rascunho; você aprova; o motor envia e o lead vai para "Abordado".
    expect(await motor.gerarAbordagens(deps, cfg)).toBe(1);
    expect(await motor.gerarAbordagens(deps, cfg)).toBe(0); // não duplica enquanto há rascunho
    const [rascunho] = (await ler('/agente')).body.rascunhos;
    expect(rascunho).toMatchObject({ empresaId: 77, origem: 'cadencia' });
    expect((await enviar('post', `/agente/rascunhos/${rascunho.id}/aprovar`, {})).status).toBe(200);
    expect(await motor.enviarProxima(deps, cfg)).toBe(true);
    expect(enviados[0]?.tel).toBe('71988776655');
    expect((await ler('/funil/77')).body.oportunidade.etapa).toBe('abordado');
    expect(await motor.enviarProxima(deps, cfg)).toBe(false); // nada aprovado (e respeita o intervalo)

    // 2) O lead responde (sem o 9 no número): webhook acha o lead, registra e move para "Respondeu".
    const webhook = (texto: string, id: string) =>
      request(app)
        .post(`/webhooks/evolution/${token}`)
        .send({
          event: 'messages.upsert',
          data: {
            key: { remoteJid: '557188776655@s.whatsapp.net', fromMe: false, id },
            message: { conversation: texto },
            pushName: 'Marcos',
          },
        });
    expect((await webhook('Quanto custa?', 'in-1')).status).toBe(200);
    expect((await webhook('Quanto custa?', 'in-1')).status).toBe(200); // repetido não duplica
    expect((await ler('/funil/77')).body.oportunidade.etapa).toBe('respondeu');
    expect((await request(app).post('/webhooks/evolution/errado').send({})).status).toBe(404);

    // 3) A IA responde depois que o lead para de digitar (40 s).
    const envelhecer = () =>
      pool.query(
        `UPDATE comercial.atividades SET criado_em = criado_em - interval '2 minutes' WHERE empresa_id = 77`,
      );
    expect(await motor.gerarRespostas(deps, cfg)).toBe(0);
    await envelhecer();
    decisoes.push({
      acao: 'responder',
      resposta: 'Depende do volume. Podemos falar 15 min amanhã às 10h?',
      reuniaoEm: null,
      motivo: 'Pediu preço',
    });
    expect(await motor.gerarRespostas(deps, cfg)).toBe(1);
    const resp = (await ler('/agente')).body.rascunhos[0];
    expect(resp).toMatchObject({ origem: 'agente', nota: 'Pediu preço', ultimaDoLead: 'Quanto custa?' });

    // Descartar a resposta da IA passa o lead para você; "devolver" volta para a IA.
    await enviar('post', `/agente/rascunhos/${resp.id}/descartar`, {});
    expect((await ler('/agente')).body.pausados).toEqual([expect.objectContaining({ empresaId: 77 })]);
    await enviar('patch', '/funil/77', { devolverParaIa: true });

    // 4) Lead confirma horário: reunião marcada no funil e confirmação na fila.
    await webhook('Pode ser amanhã às 10h', 'in-2');
    await envelhecer();
    const amanha = new Date(Date.now() + 86_400_000).toISOString();
    decisoes.push({
      acao: 'marcar_reuniao',
      resposta: 'Combinado, amanhã às 10h!',
      reuniaoEm: amanha,
      motivo: 'Confirmou horário',
    });
    await motor.gerarRespostas(deps, cfg);
    const op = (await ler('/funil/77')).body.oportunidade;
    // A reunião entra na agenda e vira o próximo passo do card, com data e hora.
    expect(op).toMatchObject({ etapa: 'reuniao', proximaAcao: 'Reunião' });
    expect(new Date(op.proximaAcaoEm).toISOString()).toBe(amanha);
    const agendaLead = (await ler('/agenda/lead/77')).body;
    expect(agendaLead).toHaveLength(1);
    expect(agendaLead[0]).toMatchObject({ tipo: 'reuniao', titulo: expect.stringMatching(/^Reunião com /) });

    // 5) "Pare de mandar": sai do funil como descartado, sem passar pela IA.
    await pool.query(
      `UPDATE comercial.mensagens SET status = 'descartada' WHERE empresa_id = 77 AND status = 'rascunho'`,
    );
    await webhook('Por favor pare de mandar mensagem', 'in-3');
    await envelhecer();
    await motor.gerarRespostas(deps, cfg);
    expect((await ler('/funil/77')).body.oportunidade).toMatchObject({ etapa: 'descartado', agente: false });
    expect(decisoes).toHaveLength(0);
    await enviar('put', '/agente/config', { ...tela.body.config, ligado: false });
    await pool.query('DELETE FROM comercial.oportunidades WHERE empresa_id = 77');
    await pool.query('DELETE FROM comercial.mensagens WHERE empresa_id = 77');
    await pool.query('DELETE FROM enriquecimento.contatos WHERE empresa_id = 77');
    await pool.query('DELETE FROM descoberta.empresas WHERE id = 77');
  });

  it('pipelines: SDR passa para o Closer na reunião, etapas com o mesmo papel, etiquetas e edição', async () => {
    const pips = (await ler('/funil/pipelines')).body;
    expect(pips.map((x: { nome: string }) => x.nome)).toEqual(['SDR', 'Closer']);
    const [sdr, closer] = pips;
    const etapa = (pip: { etapas: { id: number; nome: string }[] }, nome: string) =>
      pip.etapas.find((x) => x.nome === nome)!.id;

    await pool.query(
      `INSERT INTO descoberta.empresas (id, nome, cidade, uf) VALUES (88, 'Pipe Peças', 'SALVADOR', 'BA') ON CONFLICT (id) DO NOTHING`,
    );
    await enviar('post', '/funil', { empresaIds: [88], forcar: true });
    let q = (await ler(`/funil?pipelineId=${sdr.id}`)).body;
    expect(q.cards.find((c: { empresaId: number }) => c.empresaId === 88)).toMatchObject({
      etapaId: etapa(sdr, 'A abordar'),
    });

    // Reunião marcada: o lead sai do SDR e entra no Closer, em "Reunião agendada".
    await enviar('post', '/funil/88/atividades', { tipo: 'reuniao', texto: 'Amanhã 10h' });
    let d = (await ler('/funil/88')).body;
    expect(d.oportunidade).toMatchObject({
      etapa: 'reuniao',
      etapaNome: 'Reunião agendada',
      pipelineNome: 'Closer',
    });
    expect(
      (await ler(`/funil?pipelineId=${sdr.id}`)).body.cards.some(
        (c: { empresaId: number }) => c.empresaId === 88,
      ),
    ).toBe(false);

    // Arrastar para "Negociação" (papel proposta) e depois "Contrato enviado" (mesmo papel: cadência segue).
    d = (await enviar('patch', '/funil/88', { etapaId: etapa(closer, 'Negociação') })).body;
    expect(d.oportunidade).toMatchObject({ etapa: 'proposta', etapaNome: 'Negociação' });
    const passo = d.oportunidade.proximaAcao;
    d = (
      await enviar('patch', '/funil/88', {
        etapaId: etapa(closer, 'Contrato enviado'),
        etiquetas: ['Indicação', 'Farma', 'Farma'],
      })
    ).body;
    expect(d.oportunidade).toMatchObject({
      etapa: 'proposta',
      etapaNome: 'Contrato enviado',
      etiquetas: ['Indicação', 'Farma'],
      proximaAcao: passo,
    });
    expect(d.atividades[0]).toMatchObject({
      tipo: 'etapa',
      deNome: 'Negociação',
      paraNome: 'Contrato enviado',
    });

    q = (await ler(`/funil?pipelineId=${closer.id}&etiqueta=Farma&ordem=recentes`)).body;
    expect(q.cards.map((c: { empresaId: number }) => c.empresaId)).toEqual([88]);
    expect(q.etiquetas).toEqual(expect.arrayContaining(['Farma', 'Indicação']));

    // Editar etapas: renomear, recolorir, reordenar; não apaga etapa com lead nem o último papel.
    const editado = (
      await enviar('patch', `/funil/etapas/${etapa(closer, 'Diagnóstico')}`, {
        nome: 'Diagnóstico técnico',
        cor: '#123456',
        ordem: 1,
      })
    ).body;
    expect(editado[1].etapas[0]).toMatchObject({ nome: 'Diagnóstico técnico', cor: '#123456' });
    expect((await enviar('delete', `/funil/etapas/${etapa(closer, 'Contrato enviado')}`)).status).toBe(422);
    expect((await enviar('delete', `/funil/etapas/${etapa(closer, 'Ganho')}`)).status).toBe(422);
    const nova = await enviar('post', `/funil/pipelines/${closer.id}/etapas`, {
      nome: 'Teste',
      cor: '#000000',
      papel: 'proposta',
    });
    expect(nova.status).toBe(201);
    expect((await enviar('delete', `/funil/etapas/${nova.body.id}`)).status).toBe(204);

    await pool.query('DELETE FROM comercial.oportunidades WHERE empresa_id = 88');
    await pool.query('DELETE FROM descoberta.empresas WHERE id = 88');
  });

  it('rota inexistente devolve 404 no formato padrão', async () => {
    const r = await ler('/nao-existe');
    expect(r.status).toBe(404);
    expect(r.body.erro.codigo).toBe('rota_inexistente');
  });

  it('equipe: convite, papéis, rodízio SDR → closer, autor no histórico, desempenho e acesso cortado', async () => {
    // Admin convida um SDR e um closer; cada um cria a senha pelo link.
    const sdr = await enviar('post', '/equipe', { nome: 'Ana SDR', email: 'ana@exemplo.com', papel: 'sdr' });
    expect(sdr.status).toBe(201);
    expect(sdr.body.convite).toMatch(/^http:\/\/localhost:5173\/convite\/[\w-]{20,}$/);
    const closer = await enviar('post', '/equipe', {
      nome: 'Caio Closer',
      email: 'caio@exemplo.com',
      papel: 'closer',
    });
    expect(
      (await enviar('post', '/equipe', { nome: 'Xis', email: 'ANA@exemplo.com', papel: 'sdr' })).status,
    ).toBe(409);

    const entrar = async (convite: string, senha: string) => {
      const token = convite.split('/').at(-1)!;
      expect((await request(app).get(`/auth/convite/${token}`)).body).toHaveProperty('email');
      expect(
        (await request(app).post(`/auth/convite/${token}`).set('Origin', ORIGEM).send({ senha: '123' }))
          .status,
      ).toBe(422);
      const r = await request(app).post(`/auth/convite/${token}`).set('Origin', ORIGEM).send({ senha });
      expect(r.status).toBe(200);
      // Link usado não vale de novo.
      expect((await request(app).get(`/auth/convite/${token}`)).status).toBe(404);
      return (r.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    };
    const cookieAna = await entrar(sdr.body.convite, 'senha-da-ana-1');
    const cookieCaio = await entrar(closer.body.convite, 'senha-do-caio-1');
    const como = (c: string) => ({
      ler: (rota: string) => request(app).get(rota).set('Cookie', c),
      enviar: (metodo: 'post' | 'put' | 'patch' | 'delete', rota: string, corpo?: object) =>
        request(app)[metodo](rota).set('Origin', ORIGEM).set('Cookie', c).send(corpo),
    });
    const ana = como(cookieAna);
    const caio = como(cookieCaio);
    expect((await ana.ler('/auth/eu')).body).toMatchObject({ nome: 'Ana SDR', papel: 'sdr' });
    // Login normal com a senha criada.
    expect(
      (
        await request(app)
          .post('/auth/login')
          .set('Origin', ORIGEM)
          .send({ email: 'ana@exemplo.com', senha: 'senha-da-ana-1' })
      ).status,
    ).toBe(200);

    // SDR não mexe em configuração.
    expect((await ana.enviar('put', '/funil/cadencia', {})).status).toBe(403);
    expect((await ana.enviar('post', '/nichos', {})).status).toBe(403);
    expect(
      (await ana.enviar('post', '/equipe', { nome: 'Y', email: 'y@exemplo.com', papel: 'sdr' })).status,
    ).toBe(403);
    expect((await ana.ler('/nichos')).status).toBe(200);

    // Rodízio: lead novo vai para a SDR (única que recebe), com aviso para ela.
    await pool.query(
      `INSERT INTO descoberta.empresas (id, nome, cidade, uf, maps_telefone) VALUES
         (91, 'Auto Peças Rodízio', 'SALVADOR', 'BA', '7130001111'),
         (92, 'Peças Agenda', 'SALVADOR', 'BA', '7130002222')
       ON CONFLICT (id) DO NOTHING`,
    );
    expect((await enviar('post', '/funil', { empresaIds: [91, 92], forcar: true })).body.adicionadas).toBe(2);
    const d91 = (await ler('/funil/91')).body;
    expect(d91.oportunidade).toMatchObject({ responsavelId: sdr.body.id, responsavelNome: 'Ana SDR' });
    expect((await ana.ler('/notificacoes')).body.naoLidas).toBe(2);
    expect(
      (
        await ler(`/funil?responsavel=${sdr.body.id}&pipelineId=${(await ler('/funil')).body.pipelineId}`)
      ).body.cards.map((c: { empresaId: number }) => c.empresaId),
    ).toEqual(expect.arrayContaining([91, 92]));

    // A SDR registra contato (autor = ela) e marca a reunião pela tela: vai para o closer e para a agenda.
    await ana.enviar('post', '/funil/91/atividades', {
      tipo: 'ligacao',
      direcao: 'enviada',
      texto: 'Liguei',
    });
    const quando = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const reuniao = await ana.enviar('patch', '/funil/91', {
      etapa: 'reuniao',
      reuniao: { inicio: quando, local: 'https://meet.google.com/abc' },
    });
    expect(reuniao.status).toBe(200);
    expect(reuniao.body.oportunidade).toMatchObject({
      etapa: 'reuniao',
      responsavelNome: 'Caio Closer',
      proximaAcao: 'Reunião',
    });
    const hist = reuniao.body.atividades as { tipo: string; autor: string; texto: string | null }[];
    expect(hist.find((a) => a.tipo === 'ligacao')?.autor).toBe('Ana SDR');
    expect(hist.some((a) => a.tipo === 'nota' && a.texto?.startsWith('Responsável: Caio Closer'))).toBe(true);
    const agendaCaio = (
      await caio.ler(
        `/agenda?de=${new Date().toISOString()}&ate=${new Date(Date.now() + 7 * 86_400_000).toISOString()}`,
      )
    ).body;
    expect(agendaCaio).toHaveLength(1);
    expect(agendaCaio[0]).toMatchObject({
      tipo: 'reuniao',
      empresaId: 91,
      local: 'https://meet.google.com/abc',
    });
    expect((await caio.ler('/notificacoes')).body.itens[0].titulo).toMatch(/Auto Peças Rodízio/);

    // Desempenho: a reunião conta para quem marcou (a SDR); metas por pessoa.
    const desempenho = (await ler('/equipe/desempenho?dias=30')).body as {
      nome: string;
      contatos: number;
      reunioes: number;
    }[];
    expect(desempenho.find((u) => u.nome === 'Ana SDR')).toMatchObject({ contatos: 1, reunioes: 1 });
    const metas = await enviar('patch', `/equipe/${sdr.body.id}`, {
      metas: { abordagensDia: 50, reunioesMes: 8, ganhosMes: 0 },
    });
    expect(metas.body.usuarios.find((u: { id: number }) => u.id === sdr.body.id).metas).toEqual({
      abordagensDia: 50,
      reunioesMes: 8,
      ganhosMes: 0,
    });

    // Trocar o dono à mão; filtro "sem dono"; distribuir os sem dono.
    await enviar('patch', '/funil/92', { responsavelId: null });
    expect((await ler('/equipe')).body.semDono).toBe(1);
    expect((await enviar('post', '/equipe/distribuir')).body.distribuidos).toBe(1);
    expect((await ler('/funil/92')).body.oportunidade.responsavelId).toBe(sdr.body.id);

    // Último administrador não perde o papel; desativar corta a sessão na hora e libera os leads.
    const eu = (await ler('/auth/eu')).body;
    expect((await enviar('patch', `/equipe/${eu.id}`, { papel: 'sdr' })).status).toBe(422);
    await enviar('patch', `/equipe/${sdr.body.id}`, { ativo: false });
    expect((await ana.ler('/funil')).status).toBe(401);
    expect((await ler('/funil/92')).body.oportunidade.responsavelId).toBeNull();
    // Novo link (senha esquecida) reativa o acesso.
    await enviar('patch', `/equipe/${sdr.body.id}`, { ativo: true });
    const novo = await enviar('post', `/equipe/${sdr.body.id}/convite`);
    expect(novo.body.convite).toMatch(/\/convite\//);
    expect(
      (
        await request(app)
          .post('/auth/login')
          .set('Origin', ORIGEM)
          .send({ email: 'ana@exemplo.com', senha: 'senha-da-ana-1' })
      ).status,
    ).toBe(401);
  });

  it('conversas: webhook com foto, não lidas, aviso para o dono, responder pela tela e arquivo seguro', async () => {
    const enviados: { tel: string; texto?: string; tipo?: string }[] = [];
    const appZap = criarApp({
      pool,
      log: criarLogger('teste', 'silent'),
      filas: {
        publicar: async () => 'x',
        publicarVarios: async () => 0,
        cancelarPendentes: async () => 0,
        tamanhos: async () => ({}),
      },
      auth: {
        jwtSegredo: 'x'.repeat(40),
        adminEmail: 'ops@exemplo.com',
        adminSenhaHash: 'x',
        sessaoHoras: 1,
        cookieSeguro: false,
      },
      origens: [ORIGEM],
      whatsapp: {
        async enviar(tel, texto) {
          enviados.push({ tel, texto });
          return { idExterno: `z-${enviados.length}` };
        },
        async enviarMidia(tel, m) {
          enviados.push({ tel, tipo: m.tipo });
          return { idExterno: `zm-${enviados.length}` };
        },
      },
    });
    const z = {
      ler: (rota: string) => request(appZap).get(rota).set('Cookie', cookie),
      enviar: (metodo: 'post' | 'patch', rota: string, corpo?: object) =>
        request(appZap)[metodo](rota).set('Origin', ORIGEM).set('Cookie', cookie).send(corpo),
    };
    const token = (await ler('/agente')).body.webhook.split('/').at(-1);
    const png = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c40000000049454e44ae426082',
      'hex',
    ).toString('base64');
    const r = await request(appZap)
      .post(`/webhooks/evolution/${token}`)
      .send({
        event: 'messages.upsert',
        data: {
          key: { remoteJid: '557130002222@s.whatsapp.net', fromMe: false, id: 'foto-1' },
          message: { imageMessage: { caption: 'Olha nossa loja', mimetype: 'image/png' }, base64: png },
        },
      });
    expect(r.status).toBe(200);

    const lista = (await z.ler('/conversas')).body as {
      empresaId: number;
      naoLidas: number;
      ultima: string;
    }[];
    expect(lista[0]).toMatchObject({ empresaId: 92, naoLidas: 1, ultima: 'Olha nossa loja' });
    expect((await z.ler('/conversas/resumo')).body.naoLidas).toBeGreaterThanOrEqual(1);
    expect(
      (await z.ler('/conversas?filtro=nao_lidas')).body.map((c: { empresaId: number }) => c.empresaId),
    ).toContain(92);
    // Sem dono (a SDR foi desativada no teste anterior): avisa os administradores.
    const avisos = (await z.ler('/notificacoes')).body.itens as { tipo: string; empresaId: number }[];
    expect(avisos.some((a) => a.tipo === 'mensagem' && a.empresaId === 92)).toBe(true);

    // Abrir a conversa: mensagem com a foto, lida, aviso some.
    const conversa = (await z.ler('/conversas/92')).body;
    const foto = conversa.mensagens.find((m: { midiaTipo: string | null }) => m.midiaTipo === 'imagem');
    expect(foto).toMatchObject({ direcao: 'recebida', texto: 'Olha nossa loja' });
    const arquivo = await z.ler(`/conversas/midia/${foto.midiaId}`);
    expect(arquivo.headers['content-type']).toBe('image/png');
    expect(
      (await z.ler('/conversas?filtro=nao_lidas')).body.map((c: { empresaId: number }) => c.empresaId),
    ).not.toContain(92);

    // Responder pela tela: vai pelo WhatsApp, entra no histórico com o seu nome e a etapa avança.
    const resposta = await z.enviar('post', '/conversas/92/mensagens', {
      texto: 'Que loja bonita! Posso te ligar?',
    });
    expect(resposta.status).toBe(201);
    expect(enviados.at(-1)).toEqual({ tel: '7130002222', texto: 'Que loja bonita! Posso te ligar?' });
    expect(resposta.body.mensagens.at(-1)).toMatchObject({
      direcao: 'enviada',
      autor: 'ops',
      status: 'enviada',
    });
    expect(
      resposta.body.mensagens.filter(
        (m: { texto: string }) => m.texto === 'Que loja bonita! Posso te ligar?',
      ),
    ).toHaveLength(1);

    // Anexo: PDF abre na tela; HTML vira download (não roda com a origem do sistema).
    const pdf = await z.enviar('post', '/conversas/92/midia', {
      tipo: 'documento',
      mime: 'application/pdf',
      nome: 'proposta.pdf',
      base64: Buffer.from('%PDF-1.4').toString('base64'),
    });
    expect(pdf.status).toBe(201);
    expect(enviados.at(-1)).toEqual({ tel: '7130002222', tipo: 'documento' });
    const html = await z.enviar('post', '/conversas/92/midia', {
      tipo: 'documento',
      mime: 'text/html',
      nome: 'x.html',
      base64: Buffer.from('<script>alert(1)</script>').toString('base64'),
    });
    const idHtml = html.body.mensagens.at(-1).midiaId;
    const baixado = await z.ler(`/conversas/midia/${idHtml}`);
    expect(baixado.headers['content-type']).toBe('application/octet-stream');
    expect(baixado.headers['content-disposition']).toMatch(/^attachment/);

    // Respostas rápidas.
    expect((await z.ler('/conversas/respostas')).body.length).toBeGreaterThanOrEqual(4);
    expect(
      (await z.enviar('post', '/conversas/respostas', { atalho: 'tabela', texto: 'Segue a tabela, {nome}.' }))
        .status,
    ).toBe(201);
    expect(
      (await z.enviar('post', '/conversas/respostas', { atalho: 'com espaço', texto: 'x' })).status,
    ).toBe(422);

    // Sem WhatsApp configurado, a tela explica.
    expect((await enviar('post', '/conversas/92/mensagens', { texto: 'oi' })).body.erro.mensagem).toMatch(
      /Evolution/,
    );
  });

  it('agenda: tarefas, meu dia, calendário para o Google e lembretes da reunião', async () => {
    const diaAmanha = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
      new Date(Date.now() + 86_400_000),
    );
    const amanha10 = new Date(`${diaAmanha}T10:00:00-03:00`);
    const tarefa = await enviar('post', '/agenda', {
      tipo: 'ligacao',
      titulo: 'Ligar para o gerente',
      empresaId: 92,
      inicio: new Date(Date.now() - 3600_000).toISOString(),
    });
    expect(tarefa.status).toBe(201);
    const dia = (await ler('/agenda/meu-dia?usuario=todos')).body;
    expect(dia.tarefas.some((t: { titulo: string }) => t.titulo === 'Ligar para o gerente')).toBe(true);
    expect(dia.proximas.some((t: { empresaId: number }) => t.empresaId === 91)).toBe(true);
    // Concluir tira do dia.
    await enviar('patch', `/agenda/${tarefa.body.id}`, { concluida: true });
    expect(
      (await ler('/agenda/meu-dia?usuario=todos')).body.tarefas.some(
        (t: { id: number }) => t.id === tarefa.body.id,
      ),
    ).toBe(false);
    expect((await enviar('post', '/agenda', { titulo: '', inicio: 'ontem' })).status).toBe(422);

    // Calendário por link secreto (sem login).
    const { rows: caio } = await pool.query<{ agenda_token: string }>(
      `SELECT agenda_token FROM cadastro.usuarios WHERE email = 'caio@exemplo.com'`,
    );
    const ics = await request(app).get(`/calendario/${caio[0]!.agenda_token}.ics`);
    expect(ics.headers['content-type']).toMatch(/text\/calendar/);
    expect(ics.text).toMatch(/BEGIN:VCALENDAR/);
    expect(ics.text).toMatch(/SUMMARY:Reunião com Auto Peças Rodízio/);
    expect(ics.text).toMatch(/LOCATION:https:\/\/meet.google.com\/abc/);
    expect((await request(app).get('/calendario/token-errado.ics')).status).toBe(404);

    // Lembrete: reunião marcada com antecedência, dentro da janela → WhatsApp para o lead e aviso para o dono.
    const { rodarLembretes, quando } = await import('../src/modulos/agenda/lembretes.js');
    expect(quando(amanha10)).toBe('amanhã às 10h');
    await pool.query(
      `UPDATE comercial.tarefas SET inicio = now() + interval '20 minutes', criado_em = now() - interval '1 day'
        WHERE empresa_id = 91 AND tipo = 'reuniao'`,
    );
    const enviados: { tel: string; texto: string }[] = [];
    const deps = {
      pool,
      log: criarLogger('teste', 'silent'),
      whatsapp: {
        async enviar(tel: string, texto: string) {
          enviados.push({ tel, texto });
          return { idExterno: `l-${enviados.length}` };
        },
      },
    };
    await rodarLembretes(deps);
    expect(enviados).toHaveLength(1);
    expect(enviados[0]?.tel).toBe('7130001111');
    expect(enviados[0]?.texto).toMatch(/confirmar nossa conversa (hoje|amanhã) às/);
    await rodarLembretes(deps); // não repete
    expect(enviados).toHaveLength(1);
    const { rows: aviso } = await pool.query(
      `SELECT n.titulo FROM comercial.notificacoes n JOIN cadastro.usuarios u ON u.id = n.usuario_id
        WHERE u.email = 'caio@exemplo.com' AND n.tipo = 'reuniao'`,
    );
    expect(aviso).toHaveLength(1);

    // Limpa para o próximo teste (que conta o funil).
    await pool.query('DELETE FROM comercial.oportunidades WHERE empresa_id IN (91, 92)');
    await pool.query('DELETE FROM descoberta.empresas WHERE id IN (91, 92)');
    await pool.query(
      `UPDATE cadastro.usuarios SET ativo = false WHERE email IN ('ana@exemplo.com', 'caio@exemplo.com')`,
    );
  });

  it('e-mail: quem recebe, modelo com anexo e prévia, envio rastreado, follow-up, resposta com interesse vai para o SDR', async () => {
    const motor = await import('../src/modulos/email/motor.js');
    await pool.query(
      `INSERT INTO cadastro.campanhas (id, nome, nicho_id, cidades) VALUES
         (95, 'Campanha e-mail', (SELECT id FROM cadastro.nichos ORDER BY id LIMIT 1), '[{"nome":"Salvador","uf":"BA"}]')
       ON CONFLICT (id) DO NOTHING`,
    );
    await pool.query(
      `INSERT INTO descoberta.empresas (id, nome, cidade, uf) VALUES
         (95, 'AUTO PECAS EMAIL', 'SALVADOR', 'BA'), (96, 'Peças do Contador', 'SALVADOR', 'BA'),
         (97, 'Descartada Peças', 'SALVADOR', 'BA'), (98, 'Sem Email Peças', 'SALVADOR', 'BA')
       ON CONFLICT (id) DO NOTHING`,
    );
    await pool.query(
      `INSERT INTO descoberta.campanha_empresas (campanha_id, empresa_id, origem) SELECT 95, x, 'maps' FROM unnest(ARRAY[95,96,97,98]) x ON CONFLICT DO NOTHING`,
    );
    await pool.query(
      `INSERT INTO enriquecimento.contatos (empresa_id, canal, valor, fonte, fontes, status, rotulo) VALUES
         (95, 'email', 'compras@autopecasemail.com.br', 'site', '{site}', 'nao_verificado', null),
         (96, 'email', 'fiscal@contabilidadex.com.br', 'receita', '{receita}', 'atencao', 'Pode ser do contador'),
         (97, 'email', 'loja@descartada.com.br', 'site', '{site}', 'nao_verificado', null)`,
    );
    await pool.query(
      `INSERT INTO enriquecimento.pessoas (empresa_id, nome, cargo, decisor, papel, fontes) VALUES (95, 'JOAO CARLOS', 'Sócio', true, 'socio', '{receita}')`,
    );
    await enviar('post', '/funil', { empresaIds: [97], etapa: 'descartado', motivo: 'teste' });

    // Quem recebe: só quem tem e-mail, sem o do contador e sem o descartado.
    const est = await enviar('post', '/email/campanhas/estimar', { campanhaId: 95 });
    expect(est.body).toMatchObject({ leads: 4, comEmail: 3, elegiveis: 1 });
    expect(
      (await enviar('post', '/email/campanhas/estimar', { campanhaId: 95, incluirContador: true })).body
        .elegiveis,
    ).toBe(2);

    // Modelo com a proposta em anexo e prévia com um lead de verdade.
    const modelos = (await ler('/email/modelos')).body;
    expect(modelos.length).toBeGreaterThanOrEqual(2);
    const anexo = await enviar('post', '/email/anexos', {
      nome: 'proposta.pdf',
      mime: 'application/pdf',
      base64: Buffer.from('%PDF-1.4 proposta').toString('base64'),
    });
    expect(anexo.status).toBe(201);
    const salvo = await enviar('put', `/email/modelos/${modelos[0].id}`, {
      ...modelos[0],
      anexos: [anexo.body.id],
    });
    expect(salvo.body.modelos[0].arquivos[0]).toMatchObject({
      nome: 'proposta.pdf',
      mime: 'application/pdf',
    });
    const previa = await enviar('post', '/email/previa', {
      assunto: 'Oi {empresa}',
      corpo: '{saudacao}\n\nVeja www.tutts.com.br',
      empresaId: 95,
    });
    expect(previa.body.assunto).toBe('Oi Auto Pecas Email');
    expect(previa.body.html).toMatch(/href="https:\/\/www\.tutts\.com\.br"/);

    // Campanha em sequência: 1º e-mail (com anexo) e follow-up 3 dias depois sem resposta.
    const camp = await enviar('post', '/email/campanhas', {
      nome: 'Teste',
      campanhaId: 95,
      incluirContador: true,
      passos: [
        { modeloId: modelos[0].id, dias: 0 },
        { modeloId: modelos[1].id, dias: 3 },
      ],
    });
    expect(camp.status).toBe(201);
    expect((await enviar('post', `/email/campanhas/${camp.body.id}/iniciar`)).body).toEqual({ naFila: 2 });
    const cfg = (await ler('/email')).body.config;
    expect(
      (
        await enviar('put', '/email/config', {
          ...cfg,
          ligado: true,
          horaInicio: 0,
          horaFim: 24,
          diasSemana: [0, 1, 2, 3, 4, 5, 6],
          intervaloSeg: 10,
        })
      ).status,
    ).toBe(200);

    const enviados: {
      para: string;
      assunto: string;
      html: string;
      anexos?: unknown[];
      emRespostaA?: string | null;
      descadastro?: string | null;
    }[] = [];
    const deps = {
      pool,
      log: criarLogger('teste', 'silent'),
      origens: [ORIGEM],
      classificarEmail: null,
      email: {
        remetente: 'comercial@tutts.com.br',
        async enviar(e: (typeof enviados)[number]) {
          enviados.push(e);
          return { messageId: `<msg-${enviados.length}@tutts>` };
        },
      },
    };
    const conf = await (await import('../src/modulos/email/repositorio.js')).obterConfig(pool);
    const agora = Date.now();
    const ok1 = await motor.enviarProximo(deps as never, conf, new Date(agora));
    expect(ok1).toBe(true);
    expect(await motor.enviarProximo(deps as never, conf, new Date(agora + 1000))).toBe(false); // intervalo
    expect(await motor.enviarProximo(deps as never, conf, new Date(agora + 20_000))).toBe(true);
    const primeiro = enviados.find((e) => e.para === 'compras@autopecasemail.com.br')!;
    expect(primeiro.assunto).toBe('Entregas mais rápidas para a Auto Pecas Email');
    expect(primeiro.html).toMatch(/Olá, Joao!/);
    expect(primeiro.html).toMatch(/<ul[^>]*><li[^>]*>Motoboy dedicado/);
    expect(primeiro.anexos).toHaveLength(1);
    expect(primeiro.descadastro).toMatch(/\/e\/sair\/[0-9a-f]{32}$/);
    const {
      rows: [envio95],
    } = await pool.query(`SELECT * FROM comercial.envios_email WHERE empresa_id = 95`);
    expect(envio95).toMatchObject({ status: 'enviado', message_id: '<msg-1@tutts>' });
    expect(primeiro.html).toContain(`/e/a/${envio95.token}.gif`);

    // Abertura (imagem) e clique (só para o link que estava no e-mail).
    const gif = await request(app).get(`/e/a/${envio95.token}.gif`);
    expect(gif.headers['content-type']).toBe('image/gif');
    const clique = await request(app).get(`/e/c/${envio95.token}/0`);
    expect(clique.status).toBe(302);
    expect(clique.headers.location).toMatch(/^https:\/\//);
    expect((await request(app).get(`/e/c/${envio95.token}/99`)).status).toBe(404);
    const {
      rows: [aberto],
    } = await pool.query(`SELECT aberturas, cliques, aberto_em FROM comercial.envios_email WHERE id = $1`, [
      envio95.id,
    ]);
    expect(aberto).toMatchObject({ aberturas: 1, cliques: 1 });

    // E-mail do contador voltou: endereço inválido, não recebe follow-up.
    expect(
      await motor.processarRecebido(deps as never, {
        uid: 1,
        messageId: '<bounce@x>',
        emRespostaA: null,
        referencias: [],
        de: 'mailer-daemon@googlemail.com',
        deNome: null,
        assunto: 'Delivery Status Notification (Failure)',
        texto: 'Address not found: fiscal@contabilidadex.com.br',
        data: new Date().toISOString(),
        automatica: false,
        devolucao: true,
      }),
    ).toBe('devolucao');
    const {
      rows: [contador],
    } = await pool.query(
      `SELECT status FROM enriquecimento.contatos WHERE empresa_id = 96 AND canal = 'email'`,
    );
    expect(contador.status).toBe('invalido');

    // Follow-up: 3 dias sem resposta → 2º e-mail na mesma conversa.
    await pool.query(
      `UPDATE comercial.envios_email SET enviado_em = now() - interval '4 days' WHERE campanha_email_id = $1`,
      [camp.body.id],
    );
    expect(await motor.agendarSeguimentos(deps as never)).toBe(1);
    expect(await motor.enviarProximo(deps as never, conf, new Date(agora + 60_000))).toBe(true);
    expect(enviados.at(-1)).toMatchObject({
      para: 'compras@autopecasemail.com.br',
      emRespostaA: '<msg-1@tutts>',
    });

    // Resposta com interesse: entra no SDR em "Respondeu", com próximo passo e aviso.
    expect(
      await motor.processarRecebido(deps as never, {
        uid: 2,
        messageId: '<resp-1@cliente>',
        emRespostaA: '<msg-3@tutts>',
        referencias: ['<msg-1@tutts>'],
        de: 'compras@autopecasemail.com.br',
        deNome: 'João',
        assunto: 'Re: Entregas',
        texto: 'Oi! Tenho interesse sim, quanto fica para 30 entregas por dia?',
        data: new Date().toISOString(),
        automatica: false,
        devolucao: false,
      }),
    ).toBe('resposta');
    const op = (await ler('/funil/95')).body.oportunidade;
    expect(op).toMatchObject({ etapa: 'respondeu', proximaAcao: 'Responder o e-mail', pipelineNome: 'SDR' });
    const resps = (await ler('/email/respostas')).body;
    expect(resps[0]).toMatchObject({ empresaId: 95, classe: 'interessado', classificadoPor: 'regra' });
    expect(
      (await ler('/email/envios?filtro=responderam')).body.map((e: { empresaId: number }) => e.empresaId),
    ).toContain(95);
    const camps = (await ler('/email/campanhas')).body;
    expect(camps.find((c: { id: number }) => c.id === camp.body.id)).toMatchObject({
      enviados: 2,
      abriram: 1,
      clicaram: 1,
      responderam: 1,
      interessados: 1,
    });
    // Mesma mensagem lida de novo: ignora.
    expect(
      await motor.processarRecebido(deps as never, {
        uid: 2,
        messageId: '<resp-1@cliente>',
        emRespostaA: '<msg-3@tutts>',
        referencias: [],
        de: 'compras@autopecasemail.com.br',
        deNome: null,
        assunto: 'Re',
        texto: 'x',
        data: new Date().toISOString(),
        automatica: false,
        devolucao: false,
      }),
    ).toBe('ignorado');
    expect((await ler('/email/lead/95')).body.respostas).toHaveLength(1);

    // Sair da lista pelo link do e-mail: GET só pergunta, POST tira.
    expect((await request(app).get(`/e/sair/${envio95.token}`)).text).toMatch(/me tire da lista/);
    expect((await request(app).post(`/e/sair/${envio95.token}`)).text).toMatch(/você saiu da lista/);
    expect(
      (await enviar('post', '/email/campanhas/estimar', { campanhaId: 95, pularNoFunil: false })).body
        .elegiveis,
    ).toBe(0);

    // Corrigir a classificação: descadastro também tira da lista.
    expect(
      (await enviar('post', `/email/respostas/${resps[0].id}/classe`, { classe: 'sem_interesse' })).status,
    ).toBe(200);
    expect((await ler('/email/respostas?classe=sem_interesse')).body).toHaveLength(1);

    // Limpa (o próximo teste conta o funil).
    await pool.query('DELETE FROM comercial.campanhas_email');
    await pool.query('DELETE FROM comercial.oportunidades WHERE empresa_id IN (95, 96, 97, 98)');
    await pool.query('DELETE FROM descoberta.empresas WHERE id IN (95, 96, 97, 98)');
    await pool.query('DELETE FROM enriquecimento.pessoas WHERE empresa_id IN (95, 96, 97, 98)');
    await pool.query('DELETE FROM enriquecimento.contatos WHERE empresa_id IN (95, 96, 97, 98)');
    await pool.query('DELETE FROM cadastro.campanhas WHERE id = 95');
  });

  it('para o enriquecimento e apaga a campanha com os leads só dela (base de CNPJ fica)', async () => {
    const parar = await enviar('post', '/campanhas/2/parar-enriquecimento');
    expect(parar.body).toEqual({ cancelados: 3 });
    expect(cancelados).toContainEqual({
      nome: 'enriquecimento.solicitar',
      filtro: { campo: 'campanhaId', valores: [2] },
    });

    const errado = await enviar('delete', '/campanhas/2', { confirmarNome: 'outra coisa' });
    expect(errado.status).toBeGreaterThanOrEqual(400);

    const { rows: antes } = await pool.query('SELECT count(*)::int AS n FROM base_cnpj.socios');
    const nome = (await ler('/campanhas/2')).body.nome;
    const apagar = await enviar('delete', '/campanhas/2', { confirmarNome: nome.toUpperCase() });
    expect(apagar.status).toBe(200);
    expect(apagar.body.leadsApagados).toBeGreaterThan(0);
    expect((await ler('/campanhas/2')).status).toBe(404);
    const { rows } = await pool.query(
      `SELECT (SELECT count(*) FROM descoberta.campanha_empresas WHERE campanha_id = 2)::int AS vinculos,
              (SELECT count(*) FROM comercial.oportunidades)::int AS funil,
              (SELECT count(*) FROM enriquecimento.leads)::int AS leads,
              (SELECT count(*) FROM base_cnpj.socios)::int AS socios`,
    );
    expect(rows[0]).toEqual({ vinculos: 0, funil: 0, leads: 0, socios: antes[0].n });
  });
});
