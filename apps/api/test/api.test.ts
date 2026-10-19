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
  /** Simula a fila exclusiva ocupada: o pg-boss devolve null ao publicar. */
  let filaOcupada = false;

  const enviar = (metodo: 'post' | 'patch' | 'delete', rota: string, corpo?: object) =>
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
    expect(eu.body).toEqual({ email: 'ops@exemplo.com' });
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

    const todos = await enviar('post', '/campanhas/2/reenriquecer');
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
    expect((await enviar('post', '/campanhas/2/reenriquecer')).body).toEqual({ quantidade: 1 });
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
    expect(r.body.filas).toEqual({ 'maps.coletar': 1 });
  });

  it('rota inexistente devolve 404 no formato padrão', async () => {
    const r = await ler('/nao-existe');
    expect(r.status).toBe(404);
    expect(r.body.erro.codigo).toBe('rota_inexistente');
  });
});
