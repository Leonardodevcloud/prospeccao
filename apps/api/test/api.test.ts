import { criarPool, migrar, type Pool } from '@prospeccao/db';
import { bancoDeTeste } from '@prospeccao/db/teste';
import type { ContextoAgente } from '@prospeccao/integrations/agente';
import type { NomeJob } from '@prospeccao/queue';
import { criarLogger } from '@prospeccao/shared';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../src/app.js';
import { comConta } from '../src/contexto.js';
import * as chipsRepo from '../src/modulos/agente/chips.js';
import * as funilRepo from '../src/modulos/funil/repositorio.js';
import type { ServicosConta } from '../src/servicos.js';

const URL_TESTE = process.env.TEST_DATABASE_URL;
const ORIGEM = 'http://localhost:5173';

/** Conta sem nada configurado (cada teste liga o que precisa). */
const semServicos = (contaId: number): ServicosConta => ({
  contaId,
  whatsapp: null,
  ia: null,
  classificarEmail: null,
  personalizarAbertura: null,
  email: null,
  assistente: null,
  geocodificar: null,
  origem: { places: null, ors: null, resend: null, whatsapp: null, ia: null },
  iaDescricao: null,
  erro: null,
});
const CREDENCIAIS = {
  chave: 'chave-de-teste-das-credenciais-com-32-ou-mais',
  ambiente: {},
  invalidar() {},
};
/** Motores e rotinas rodam dentro de uma conta (a 1 é a principal, onde está tudo dos testes antigos). */
const naConta = <T>(fn: () => Promise<T>, conta = 1) => comConta(conta, fn);

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
      servicos: async (conta) => ({
        ...semServicos(conta),
        geocodificar: async () => ({ lat: -12.97, lng: -38.51 }),
      }),
      credenciais: CREDENCIAIS,
    });
    // Número de WhatsApp conectado da conta principal (os testes antigos mandam por ele).
    await pool.query(`DELETE FROM comercial.chips`);
    await pool.query(
      `INSERT INTO comercial.chips (conta_id, nome, instancia, token_cifrado, limite_dia, aquecer)
       VALUES (1, 'Principal', 'principal', 'x', 1000, false)`,
    );
  });

  /** Número já conectado (o fluxo do QR Code tem o seu próprio teste). */
  const novoChip = async (d: { nome: string; instancia: string; limiteDia?: number; diasDeUso?: number }) => {
    const id = await naConta(() => chipsRepo.criar(pool, { ...d, limiteDia: d.limiteDia ?? 40 }));
    await pool.query(`UPDATE comercial.chips SET token_cifrado = 'x' WHERE id = $1`, [id]);
    return { id, chips: (await ler('/agente/chips')).body.chips };
  };

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
      `INSERT INTO descoberta.campanha_empresas (campanha_id, empresa_id, origem, dentro_do_raio, liberado_em) VALUES (2, 1, 'ambos', true, now()), (2, 2, 'maps', true, now())`,
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

    const comCnpj = await ler('/empresas?comCnpj=true');
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

    expect((await ler('/campanhas/2/reenriquecer')).body).toEqual({
      ab: 1,
      semDecisor: 1,
      incompletos: 0,
      todos: 2,
    });
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
    expect(await naConta(() => encerrarSemResposta(pool))).toBe(1);
    d = (await ler('/funil/2')).body;
    expect(d.oportunidade).toMatchObject({
      etapa: 'perdido',
      motivo: 'Sem resposta após 3 mensagens',
      proximaAcao: null,
    });
    expect(d.atividades[0]).toMatchObject({ tipo: 'etapa', paraEtapa: 'perdido', autor: 'sistema' });
    expect(await naConta(() => encerrarSemResposta(pool))).toBe(0);

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
      `INSERT INTO descoberta.uso_places (conta_id, mes, paga, custo_usd)
       SELECT 1, descoberta.mes_places(), false, 0 FROM generate_series(1, 90)`,
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
      `INSERT INTO descoberta.campanha_empresas (campanha_id, empresa_id, origem, liberado_em) VALUES (2, 77, 'maps', now()) ON CONFLICT DO NOTHING`,
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
    expect(tela.body.status).toMatchObject({ whatsapp: false, ia: false });
    expect(tela.body.webhook).toMatch(/\/webhooks\/whatsapp\/[0-9a-f]{32}$/);
    const token = tela.body.webhook.split('/').at(-1);
    // Ligar pela tela pede o perfil da IA conferido e a prova (testado em assistente.test.ts);
    // aqui o motor é o assunto, então a IA já vem ligada.
    await pool.query('UPDATE comercial.config_agente SET ligado = true WHERE conta_id = 1');
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
    const cfg = await naConta(() => repoAgente.obterConfig(pool));

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
    // O 1º passo da cadência vence às 9h de hoje: adianta para o teste não depender da hora.
    await pool.query(
      `UPDATE comercial.oportunidades SET proxima_acao_em = now() - interval '1 minute' WHERE empresa_id = 77`,
    );
    expect(await naConta(() => motor.gerarAbordagens(deps, cfg))).toBe(1);
    expect(await naConta(() => motor.gerarAbordagens(deps, cfg))).toBe(0); // não duplica enquanto há rascunho
    const [rascunho] = (await ler('/agente')).body.rascunhos;
    expect(rascunho).toMatchObject({ empresaId: 77, origem: 'cadencia' });
    expect((await enviar('post', `/agente/rascunhos/${rascunho.id}/aprovar`, {})).status).toBe(200);
    expect(await naConta(() => motor.enviarProxima(deps, cfg))).toBe(true);
    expect(enviados[0]?.tel).toBe('71988776655');
    expect((await ler('/funil/77')).body.oportunidade.etapa).toBe('abordado');
    expect(await naConta(() => motor.enviarProxima(deps, cfg))).toBe(false); // nada aprovado (e respeita o intervalo)

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
    expect(await naConta(() => motor.gerarRespostas(deps, cfg))).toBe(0);
    await envelhecer();
    decisoes.push({
      acao: 'responder',
      resposta: 'Depende do volume. Podemos falar 15 min amanhã às 10h?',
      reuniaoEm: null,
      motivo: 'Pediu preço',
    });
    expect(await naConta(() => motor.gerarRespostas(deps, cfg))).toBe(1);
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
    await naConta(() => motor.gerarRespostas(deps, cfg));
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
    await naConta(() => motor.gerarRespostas(deps, cfg));
    expect((await ler('/funil/77')).body.oportunidade).toMatchObject({ etapa: 'descartado', agente: false });
    expect(decisoes).toHaveLength(0);
    await enviar('put', '/agente/config', { ...tela.body.config, ligado: false });
    await pool.query('DELETE FROM comercial.oportunidades WHERE empresa_id = 77');
    await pool.query('DELETE FROM comercial.mensagens WHERE empresa_id = 77');
    await pool.query('DELETE FROM enriquecimento.contatos WHERE empresa_id = 77');
    await pool.query('DELETE FROM descoberta.empresas WHERE id = 77');
  });

  it('agente v2: base de conhecimento, verificações, resumo da passagem, aprendizado, radar e aquecimento', async () => {
    const motor = await import('../src/modulos/agente/motor.js');
    const atendimento = await import('../src/modulos/agente/atendimento.js');
    const repoAgente = await import('../src/modulos/agente/repositorio.js');

    // 1) Base: texto, pergunta e resposta, arquivo; a busca acha o trecho certo.
    expect(
      (
        await enviar('post', '/agente/conhecimento', {
          tipo: 'texto',
          titulo: 'Planos',
          conteudo: 'O plano mensal custa R$ 890 e inclui até 300 entregas em Salvador e Lauro de Freitas.',
        })
      ).status,
    ).toBe(201);
    expect(
      (await enviar('post', '/agente/conhecimento', { tipo: 'faq', titulo: 'x', conteudo: 'Sem pergunta' }))
        .status,
    ).toBe(422);
    await enviar('post', '/agente/conhecimento', {
      tipo: 'faq',
      titulo: 'Cidades',
      pergunta: 'Vocês atendem Feira de Santana?',
      conteudo: 'Atendemos Feira de Santana às terças e quintas.',
    });
    const arquivo = await enviar('post', '/agente/conhecimento/arquivo', {
      nome: 'politica.txt',
      mime: 'text/plain',
      base64: Buffer.from('Política de troca: a coleta de devolução é grátis em até 7 dias.').toString(
        'base64',
      ),
    });
    expect(arquivo.status).toBe(201);
    let tela = (await ler('/agente/conhecimento')).body;
    expect(tela.itens).toHaveLength(3);
    expect(tela.numeros).toMatchObject({ ativos: 3, sugeridos: 0, lacunas: 0 });
    const achados = (
      await enviar('post', '/agente/conhecimento/testar', { pergunta: 'Vcs atendem em feira?' })
    ).body;
    expect(achados[0]).toMatchObject({ titulo: 'Cidades' });

    // Lead com a IA ligada, que escreveu e parou de digitar.
    await pool.query(
      `INSERT INTO descoberta.empresas (id, nome, cidade, uf) VALUES (78, 'Peças Lima', 'FEIRA DE SANTANA', 'BA')
       ON CONFLICT (id) DO NOTHING`,
    );
    await pool.query(
      `INSERT INTO descoberta.campanha_empresas (campanha_id, empresa_id, origem, liberado_em) VALUES (2, 78, 'maps', now()) ON CONFLICT DO NOTHING`,
    );
    await pool.query(
      `INSERT INTO enriquecimento.contatos (empresa_id, canal, valor, fonte, fontes, status, whatsapp, principal)
       VALUES (78, 'whatsapp', '75988112233', 'site', '{site}', 'verificado', true, true)`,
    );
    await enviar('post', '/funil', { empresaIds: [78], forcar: true });
    await enviar('patch', '/funil/78', { agente: true });
    const config = (await ler('/agente')).body.config;
    await pool.query('UPDATE comercial.config_agente SET ligado = true WHERE conta_id = 1');
    await enviar('put', '/agente/config', {
      ...config,
      ligado: true,
      revisarAntes: false,
      horaInicio: 0,
      horaFim: 24,
      diasSemana: [0, 1, 2, 3, 4, 5, 6],
      sobreEmpresa: 'Somos a Rota Norte: entregas para autopeças na Bahia.',
    });
    const cfg = await naConta(() => repoAgente.obterConfig(pool));
    const leadEscreve = async (texto: string) => {
      await naConta(() =>
        funilRepo.registrarAtividade(pool, 78, { tipo: 'whatsapp', direcao: 'recebida', texto }, 'lead'),
      );
      await pool.query(
        `UPDATE comercial.atividades SET criado_em = criado_em - interval '2 minutes' WHERE empresa_id = 78`,
      );
    };

    const contextos: ContextoAgente[] = [];
    const decisoes: object[] = [];
    const enviados: { texto: string; digitando?: number }[] = [];
    const deps = {
      pool,
      log: criarLogger('teste', 'silent'),
      whatsapp: {
        async enviar(_tel: string, texto: string, _inst?: string, op?: { digitandoMs?: number }) {
          enviados.push({ texto, digitando: op?.digitandoMs });
          return { idExterno: `v2-${enviados.length}` };
        },
      },
      ia: {
        async decidir(c: ContextoAgente) {
          contextos.push(c);
          return decisoes.shift() as never;
        },
        async resumir() {
          return {
            situacao: 'Quer saber prazo de pagamento antes de fechar.',
            combinado: [],
            objecoes: ['Prazo de pagamento'],
            perguntasEmAberto: ['Qual o prazo de pagamento?'],
            interesse: 'alto' as const,
            proximoPasso: 'Responder o prazo e propor reunião',
          };
        },
        async aprender(e: { pergunta: string; respostaDoTime: string }) {
          return { titulo: 'Prazo de pagamento', pergunta: e.pergunta, resposta: 'Boleto em 28 dias.' };
        },
      },
    };

    // 2) A IA recebe o trecho da base; preço inventado é barrado e ela reescreve.
    await leadEscreve('Vocês atendem Feira de Santana? Quanto fica?');
    decisoes.push(
      { acao: 'responder', resposta: 'Atendemos sim! Fica R$ 450 por mês.', motivo: 'Cidade e preço' },
      {
        acao: 'responder',
        resposta:
          'Atendemos sim, às terças e quintas.\n\nO plano mensal é R$ 890. Posso te ligar amanhã às 10h?',
        motivo: 'Cidade e preço da base',
        memoria: ['Fica em Feira de Santana'],
      },
    );
    expect(await naConta(() => motor.gerarRespostas(deps, cfg))).toBe(1);
    expect(contextos[0]?.conhecimento?.map((t) => t.titulo)).toContain('Cidades');
    expect(contextos[0]?.correcao).toBeUndefined();
    expect(contextos[1]?.correcao?.problemas[0]).toMatch(/R\$ 450/);
    const { rows: verif } = await pool.query(
      `SELECT resultado FROM comercial.verificacoes_ia WHERE empresa_id = 78`,
    );
    expect(verif).toEqual([{ resultado: 'reescrita' }]);

    // Resposta sai primeiro, em bolhas, com "digitando".
    expect(await naConta(() => motor.enviarProxima(deps, cfg))).toBe(true);
    expect(enviados.map((e) => e.texto)).toEqual([
      'Atendemos sim, às terças e quintas.',
      'O plano mensal é R$ 890. Posso te ligar amanhã às 10h?',
    ]);
    expect(enviados[0]?.digitando).toBeGreaterThanOrEqual(1200);
    expect((await ler('/conversas/78')).body.agenteMemoria).toEqual(['Fica em Feira de Santana']);

    // 3) Pergunta fora da base: a IA promete retorno sem passar; reescrita também falha → vai para o time,
    // com o resumo, e a pergunta vira lacuna.
    await leadEscreve('Qual o prazo de pagamento?');
    const semPrazo = {
      acao: 'responder',
      resposta: 'Vou verificar com o financeiro e te retorno já já.',
      motivo: 'Prazo',
      semResposta: 'Qual o prazo de pagamento?',
    };
    decisoes.push(semPrazo, semPrazo);
    await naConta(() => motor.gerarRespostas(deps, cfg));
    const pausado = (await ler('/agente')).body.pausados.find(
      (p: { empresaId: number }) => p.empresaId === 78,
    );
    expect(pausado.motivo).toMatch(/retorno_sem_passar/);
    expect(pausado.resumo).toMatchObject({ interesse: 'alto', objecoes: ['Prazo de pagamento'] });
    expect((await ler('/conversas/78')).body.agenteResumo.proximoPasso).toBe(
      'Responder o prazo e propor reunião',
    );
    tela = (await ler('/agente/conhecimento')).body;
    expect(tela.lacunas).toEqual([
      expect.objectContaining({ pergunta: 'Qual o prazo de pagamento?', sugestaoId: null }),
    ]);
    expect(tela.verificacoes[0]).toMatchObject({ resultado: 'bloqueada' });

    // 4) O vendedor responde: 10 min depois vira sugestão; aprovada, entra na base e a lacuna some.
    await pool.query(
      `INSERT INTO comercial.mensagens (conta_id, empresa_id, direcao, texto, telefone, status, origem, criado_em)
       VALUES (1, 78, 'enviada', 'Oi Marcos, é boleto em 28 dias.', '75988112233', 'enviada', 'humano', now() - interval '20 minutes')`,
    );
    await pool.query(
      `UPDATE comercial.lacunas_ia SET criado_em = now() - interval '1 hour' WHERE empresa_id = 78`,
    );
    expect(await naConta(() => atendimento.aprenderComEquipe(deps))).toBe(1);
    expect(await naConta(() => atendimento.aprenderComEquipe(deps))).toBe(0); // uma tentativa só
    tela = (await ler('/agente/conhecimento')).body;
    const sugestao = tela.itens.find((i: { status: string }) => i.status === 'sugerido');
    expect(sugestao).toMatchObject({
      origem: 'conversa',
      pergunta: 'Qual o prazo de pagamento?',
      empresaNome: 'Peças Lima',
    });
    expect(
      (await enviar('post', '/agente/conhecimento/testar', { pergunta: 'prazo de pagamento' })).body,
    ).toHaveLength(0); // sugestão não vale antes de aprovar
    await enviar('patch', `/agente/conhecimento/${sugestao.id}`, { aprovar: true });
    tela = (await ler('/agente/conhecimento')).body;
    expect(tela.lacunas).toHaveLength(0);
    expect(tela.numeros).toMatchObject({ ativos: 4, sugeridos: 0 });
    expect(
      (await enviar('post', '/agente/conhecimento/testar', { pergunta: 'prazo de pagamento' })).body[0].texto,
    ).toMatch(/28 dias/);

    // 5) Pediu uma pessoa: vai direto para o time, sem chamar a IA. (O aviso da passagem anterior já saiu.)
    await pool.query(
      `UPDATE comercial.mensagens SET status = 'enviada' WHERE empresa_id = 78 AND status = 'aprovada'`,
    );
    await enviar('patch', '/funil/78', { devolverParaIa: true });
    expect((await ler('/conversas/78')).body.agenteResumo).toBeNull();
    await leadEscreve('Prefiro falar com um atendente');
    const chamadas = contextos.length;
    await naConta(() => motor.gerarRespostas(deps, cfg));
    expect(contextos.length).toBe(chamadas);
    expect(
      (await ler('/agente')).body.pausados.find((p: { empresaId: number }) => p.empresaId === 78).motivo,
    ).toBe('O lead pediu para falar com uma pessoa.');

    // 6) Radar: o lead escreveu há 30 h e ninguém respondeu → crítico.
    await pool.query(
      `UPDATE comercial.atividades SET criado_em = criado_em - interval '30 hours' WHERE empresa_id = 78`,
    );
    const radar = (await ler('/funil/radar')).body;
    expect(radar.itens.find((i: { empresaId: number }) => i.empresaId === 78)).toMatchObject({
      nivel: 'critico',
      motivo: expect.stringMatching(/^O lead escreveu há 30 h/),
    });
    expect(radar.contagem.critico).toBeGreaterThanOrEqual(1);

    // 7) Chip novo aquece (teto baixo nos primeiros dias); número antigo não.
    const novo = { body: await novoChip({ nome: 'Novo', instancia: 'novo-v2' }) };
    const antigo = { body: await novoChip({ nome: 'Antigo', instancia: 'antigo-v2', diasDeUso: 90 }) };
    const lista = antigo.body.chips as {
      instancia: string;
      tetoAquecimento: number | null;
      diasDeUso: number;
    }[];
    expect(lista.find((c) => c.instancia === 'novo-v2')).toMatchObject({ tetoAquecimento: 10, diasDeUso: 0 });
    expect(lista.find((c) => c.instancia === 'antigo-v2')).toMatchObject({
      tetoAquecimento: null,
      diasDeUso: 90,
    });
    await enviar('delete', `/agente/chips/${novo.body.id}`);
    await enviar('delete', `/agente/chips/${antigo.body.id}`);

    // 8) Aviso ao lead: quando a IA passou para o time, ele recebeu "vou chamar alguém" (uma vez só).
    const { rows: avisos } = await pool.query(
      `SELECT texto FROM comercial.mensagens WHERE empresa_id = 78 AND nota = 'Aviso ao lead: a IA passou para o time'`,
    );
    expect(avisos).toHaveLength(1);

    // 9) Retorno combinado: "me chama semana que vem" → a cadência espera; na data, a IA retoma com o contexto.
    await enviar('patch', '/funil/78', { devolverParaIa: true });
    await pool.query(
      `UPDATE comercial.mensagens SET status = 'enviada' WHERE empresa_id = 78 AND status = 'aprovada'`,
    );
    await naConta(() =>
      funilRepo.registrarAtividade(
        pool,
        78,
        { tipo: 'whatsapp', direcao: 'enviada', texto: 'Oi! Aqui é a Ana, do time. Como posso ajudar?' },
        'Ana',
      ),
    );
    await leadEscreve('Agora não consigo, me chama semana que vem');
    const semana = new Date(Date.now() + 7 * 86_400_000).toISOString();
    decisoes.push({
      acao: 'agendar_retorno',
      resposta: 'Combinado, te chamo semana que vem!',
      retornoEm: semana,
      motivo: 'Pediu para falar semana que vem',
    });
    await naConta(() => motor.gerarRespostas(deps, cfg));
    let op78 = (await ler('/funil/78')).body.oportunidade;
    expect(op78).toMatchObject({ proximaAcao: 'Retomar (combinado com o lead)' });
    expect(new Date(op78.proximaAcaoEm).toISOString()).toBe(semana);
    await pool.query(
      `UPDATE comercial.mensagens SET status = 'enviada' WHERE empresa_id = 78 AND status = 'aprovada'`,
    );
    // Venceu: a IA retoma (a cadência não manda a mensagem dela por cima).
    await pool.query(
      `UPDATE comercial.oportunidades SET agente_retorno_em = now() - interval '1 minute', proxima_acao_em = now() - interval '1 minute'
        WHERE empresa_id = 78`,
    );
    expect(await naConta(() => motor.gerarAbordagens(deps, cfg))).toBe(0);
    decisoes.push({
      acao: 'responder',
      resposta: 'Oi! Como combinamos, passando para retomar. Podemos falar hoje?',
      motivo: 'Retomada',
    });
    const cfgSempre = { ...cfg, horaInicio: 0, horaFim: 24, diasSemana: [0, 1, 2, 3, 4, 5, 6] };
    expect(await naConta(() => atendimento.retomarCombinados(deps, cfgSempre))).toBe(1);
    expect(contextos.at(-1)?.retomada).toBe('Pediu para falar semana que vem');
    op78 = (await ler('/funil/78')).body.oportunidade;
    const { rows: retomada } = await pool.query(
      `SELECT texto FROM comercial.mensagens WHERE empresa_id = 78 AND status = 'aprovada'`,
    );
    expect(retomada[0]?.texto).toMatch(/Como combinamos/);
    expect(await naConta(() => atendimento.retomarCombinados(deps, cfgSempre))).toBe(0);

    // 10) Simulador: regra fixa responde sem IA; sem IA configurada, avisa.
    const sim = await enviar('post', '/agente/simular', {
      conversa: [{ de: 'lead', texto: 'Quero falar com um atendente' }],
    });
    expect(sim.body).toMatchObject({ regraFixa: { tipo: 'pediu_pessoa' }, aviso: expect.any(String) });
    expect(
      (await enviar('post', '/agente/simular', { conversa: [{ de: 'lead', texto: 'Atende Feira?' }] }))
        .status,
    ).toBe(422);

    // 11) Desempenho: passagens contadas por tipo, verificações, lacunas ensinadas.
    const desemp = (await ler('/agente/desempenho?dias=7')).body;
    expect(desemp.numeros).toMatchObject({ corrigidas: 1, barradas: 1, ensinadas: 1 });
    expect(desemp.passagensPorTipo).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tipo: 'verificacao', n: 1 }),
        expect.objectContaining({ tipo: 'pediu_pessoa', n: 1 }),
      ]),
    );

    // 12) Saúde do chip: 3 falhas em 30 min pausam o chip por 1 hora (e abre alerta); reativar tira a pausa.
    const chipFalho = { body: await novoChip({ nome: 'Falho', instancia: 'falho-v3' }) };
    const chipsMod = await import('../src/modulos/agente/chips.js');
    await pool.query(
      `INSERT INTO comercial.mensagens (conta_id, empresa_id, direcao, texto, telefone, status, origem, chip_id, erro, tentado_em)
       SELECT 1, 78, 'enviada', 'x', '75988112233', 'erro', 'cadencia', $1, 'Connection Closed', now() FROM generate_series(1, 3)`,
      [chipFalho.body.id],
    );
    const falho = { id: chipFalho.body.id, nome: 'Falho', instancia: 'falho-v3', limiteDia: 40 };
    expect(await naConta(() => chipsMod.conferirSaude(pool, falho))).toBe(true);
    const telaChips = (await ler('/agente/chips')).body.chips.find(
      (c: { id: number }) => c.id === chipFalho.body.id,
    );
    expect(telaChips.pausadoAte).toBeTruthy();
    expect(telaChips.pausaMotivo).toMatch(/3 falhas/);
    expect((await naConta(() => chipsMod.emUso(pool, null))).some((c) => c.id === chipFalho.body.id)).toBe(
      false,
    );
    await enviar('patch', `/agente/chips/${chipFalho.body.id}`, { ativo: true });
    expect((await naConta(() => chipsMod.emUso(pool, null))).some((c) => c.id === chipFalho.body.id)).toBe(
      true,
    );
    await enviar('delete', `/agente/chips/${chipFalho.body.id}`);

    await enviar('put', '/agente/config', { ...config, ligado: false });
    await pool.query('DELETE FROM comercial.oportunidades WHERE empresa_id = 78');
    await pool.query('DELETE FROM comercial.mensagens WHERE empresa_id = 78');
    await pool.query('DELETE FROM enriquecimento.contatos WHERE empresa_id = 78');
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
    await pool.query(
      `INSERT INTO descoberta.campanha_empresas (campanha_id, empresa_id, origem, liberado_em) VALUES (2, 88, 'maps', now()) ON CONFLICT DO NOTHING`,
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
    await pool.query(
      `INSERT INTO descoberta.campanha_empresas (campanha_id, empresa_id, origem, liberado_em)
       VALUES (2, 91, 'maps', now()), (2, 92, 'maps', now()) ON CONFLICT DO NOTHING`,
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
      credenciais: CREDENCIAIS,
      servicos: async (conta) => ({
        ...semServicos(conta),
        whatsapp: {
          async enviar(tel: string, texto: string) {
            enviados.push({ tel, texto });
            return { idExterno: `z-${enviados.length}` };
          },
          async enviarMidia(tel: string, m: { tipo: string }) {
            enviados.push({ tel, tipo: m.tipo });
            return { idExterno: `zm-${enviados.length}` };
          },
        },
      }),
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
      /WhatsApp ainda não está ativo/,
    );
  });

  it('indicações: número desconhecido, vincular, cadeia até o decisor, enviar para e sugestão', async () => {
    const enviados: { tel: string; texto?: string }[] = [];
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
      credenciais: CREDENCIAIS,
      servicos: async (conta) => ({
        ...semServicos(conta),
        whatsapp: {
          async enviar(tel: string, texto: string) {
            enviados.push({ tel, texto });
            return { idExterno: `ind-${enviados.length}` };
          },
        },
      }),
    });
    const z = {
      ler: (rota: string) => request(appZap).get(rota).set('Cookie', cookie),
      enviar: (metodo: 'post' | 'patch' | 'put' | 'delete', rota: string, corpo?: object) =>
        request(appZap)[metodo](rota).set('Origin', ORIGEM).set('Cookie', cookie).send(corpo),
    };
    const token = (await ler('/agente')).body.webhook.split('/').at(-1);
    const chega = (tel: string, texto: string, id: string, extra: object = {}) =>
      request(appZap)
        .post(`/webhooks/evolution/${token}`)
        .send({
          event: 'messages.upsert',
          data: {
            key: { remoteJid: `55${tel}@s.whatsapp.net`, fromMe: false, id },
            pushName: 'Carlos',
            message: { conversation: texto, ...extra },
          },
        });

    // 1. A atendente (número da empresa) indica o comprador: vira sugestão, nada entra sozinho.
    await chega('7130002222', 'Quem compra é o Carlos das compras, fala com ele no (71) 99876-5432', 'ind-a');
    let c = (await z.ler('/conversas/92')).body;
    const sugestao = c.contatos.find((x: { status: string }) => x.status === 'sugerido');
    expect(sugestao).toMatchObject({
      nome: 'Carlos',
      cargo: 'Compras',
      telefone: '71998765432',
      origem: 'ia',
    });
    expect(c.opcoesEnvio.some((o: { telefone: string }) => o.telefone === '71998765432')).toBe(false);

    // 2. O Carlos escreve antes de alguém confirmar: número fora dos leads, nada se perde.
    await chega('71998765432', 'Oi, a Joana me passou seu contato', 'ind-b');
    const soltos = (await z.ler('/conversas/nao-identificados')).body;
    expect(soltos[0]).toMatchObject({ telefone: '71998765432', nome: 'Carlos', quantidade: 1 });
    // Já tinha sido indicado na conversa da loja: a tela sugere vincular a ela.
    expect(soltos[0].indicadoEm).toMatchObject({ empresaId: 92, contatoNome: 'Carlos' });
    expect((await z.ler('/conversas/leads?busca=Agenda')).body[0]).toMatchObject({ empresaId: 92 });
    expect(
      (await ler('/notificacoes')).body.itens.some(
        (a: { link: string }) => a.link === '/conversas?filtro=nao_identificados',
      ),
    ).toBe(true);

    // 3. Vincular ao lead: a sugestão vira o contato, indicado pela atendente; a conversa segue com ele.
    const atendente = await z.enviar('post', '/conversas/92/contatos', {
      nome: 'Joana',
      cargo: 'Atendente',
      telefone: '7130002222',
    });
    expect(atendente.status).toBe(201);
    const joanaId = atendente.body.contatos.find((x: { nome: string }) => x.nome === 'Joana').id;
    const v = await z.enviar('post', '/conversas/nao-identificados/71998765432/vincular', {
      empresaId: 92,
      nome: 'Carlos Lima',
      cargo: 'Compras',
      indicadoPorId: joanaId,
    });
    expect(v.status).toBe(201);
    c = v.body;
    const carlos = c.contatos.find((x: { telefone: string }) => x.telefone === '71998765432');
    expect(carlos).toMatchObject({ nome: 'Carlos Lima', status: 'confirmado', indicadoPorNome: 'Joana' });
    expect(c.contatos.filter((x: { telefone: string }) => x.telefone === '71998765432')).toHaveLength(1);
    expect(c.telefone).toBe('71998765432');
    expect(c.mensagens.at(-1)).toMatchObject({
      texto: 'Oi, a Joana me passou seu contato',
      contatoNome: 'Carlos Lima',
    });
    expect((await z.ler('/conversas/nao-identificados')).body).toHaveLength(0);

    // 4. Responder pela tela vai para o Carlos (mesmo card, mesma conversa).
    await z.enviar('post', '/conversas/92/mensagens', { texto: 'Oi Carlos, tudo bem?' });
    expect(enviados.at(-1)).toEqual({ tel: '71998765432', texto: 'Oi Carlos, tudo bem?' });

    // 5. O Carlos manda o cartão do sócio: sugestão já indicada por ele; confirmar e marcar decisor.
    await chega('71998765432', '', 'ind-c', {
      conversation: undefined,
      contactMessage: {
        displayName: 'Manoel Sócio',
        vcard: 'BEGIN:VCARD\nFN:Manoel Andrade\nitem1.TEL;waid=5571991112233:+55 71 99111-2233\nEND:VCARD',
      },
    });
    c = (await z.ler('/conversas/92')).body;
    expect(c.mensagens.at(-1)).toMatchObject({ contatoNome: 'Carlos Lima' });
    const manoel = c.contatos.find((x: { telefone: string }) => x.telefone === '71991112233');
    expect(manoel).toMatchObject({
      status: 'sugerido',
      nome: 'Manoel Sócio',
      indicadoPorNome: 'Carlos Lima',
    });
    c = (
      await z.enviar('patch', `/conversas/92/contatos/${manoel.id}`, {
        confirmar: true,
        cargo: 'Sócio',
        decisor: true,
        conversarCom: true,
      })
    ).body;
    expect(c.contatos.find((x: { id: number }) => x.id === manoel.id)).toMatchObject({
      status: 'confirmado',
      decisor: true,
    });
    expect(c.telefone).toBe('71991112233');
    // Mensagem que já veio do número dele passa a mostrar o nome (o próprio cartão veio do Carlos).
    await z.enviar('post', '/conversas/92/mensagens', { texto: 'Olá, Manoel!' });
    expect(enviados.at(-1)?.tel).toBe('71991112233');

    // 6. Enviar para: só números do lead; voltar para a empresa.
    expect((await z.enviar('put', '/conversas/92/destino', { telefone: '71900000000' })).status).toBe(422);
    c = (await z.enviar('put', '/conversas/92/destino', { telefone: '7130002222' })).body;
    expect(c.telefone).toBe('7130002222');
    // Um card só: continua um lead no funil, com os três contatos.
    expect(c.contatos.filter((x: { status: string }) => x.status === 'confirmado')).toHaveLength(3);
    const lista = (await z.ler('/conversas?busca=Manoel')).body;
    expect(lista.map((x: { empresaId: number }) => x.empresaId)).toEqual([92]);

    // Indicado por ele mesmo não pode; número repetido não pode.
    expect(
      (await z.enviar('patch', `/conversas/92/contatos/${joanaId}`, { indicadoPorId: joanaId })).status,
    ).toBe(422);
    expect(
      (await z.enviar('post', '/conversas/92/contatos', { nome: 'Outro', telefone: '(71) 99876-5432' }))
        .status,
    ).toBe(422);
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
      servicos: async (conta: number) => ({
        ...semServicos(conta),
        whatsapp: {
          async enviar(tel: string, texto: string) {
            enviados.push({ tel, texto });
            return { idExterno: `l-${enviados.length}` };
          },
        },
      }),
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
      `INSERT INTO cadastro.campanhas (id, conta_id, nome, nicho_id, cidades) VALUES
         (95, 1, 'Campanha e-mail', (SELECT id FROM cadastro.nichos ORDER BY id LIMIT 1), '[{"nome":"Salvador","uf":"BA"}]')
       ON CONFLICT (id) DO NOTHING`,
    );
    await pool.query(
      `INSERT INTO descoberta.empresas (id, nome, cidade, uf) VALUES
         (95, 'AUTO PECAS EMAIL', 'SALVADOR', 'BA'), (96, 'Peças do Contador', 'SALVADOR', 'BA'),
         (97, 'Descartada Peças', 'SALVADOR', 'BA'), (98, 'Sem Email Peças', 'SALVADOR', 'BA')
       ON CONFLICT (id) DO NOTHING`,
    );
    await pool.query(
      `INSERT INTO descoberta.campanha_empresas (campanha_id, empresa_id, origem, liberado_em) SELECT 95, x, 'maps', now() FROM unnest(ARRAY[95,96,97,98]) x ON CONFLICT DO NOTHING`,
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
      // A abertura que a IA escreve para cada lead entra logo depois da saudação.
      corpo: modelos[0].corpo.replace('{saudacao}\n\n', '{saudacao}\n\n{abertura}\n\n'),
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

    // Identidade visual da conta (white label): imagem pública, cores e estilo.
    const marcas = (await ler('/email/marcas')).body;
    expect(marcas).toHaveLength(1);
    expect(marcas[0]).toMatchObject({ nome: 'Tutts', remetenteNome: 'Tutts', estilo: 'cartao' });
    const png = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c40000000049454e44ae426082',
      'hex',
    ).toString('base64');
    const logo = await enviar('post', '/email/imagens', { nome: 'logo.png', mime: 'image/png', base64: png });
    expect(logo.status).toBe(201);
    expect(logo.body.url).toMatch(/\/e\/i\/[\w-]{20,}$/);
    expect(
      (await enviar('post', '/email/imagens', { nome: 'x.svg', mime: 'image/svg+xml', base64: png })).status,
    ).toBe(422);
    const imagem = await request(app).get(`/e/i/${logo.body.url.split('/').at(-1)}`);
    expect(imagem.headers['content-type']).toBe('image/png');
    const marca = await enviar('put', `/email/marcas/${marcas[0].id}`, {
      ...marcas[0],
      corPrimaria: '#e11d48',
      corCabecalho: '#0f172a',
      logoId: logo.body.id,
      rodape: 'Tutts Entregas Rápidas',
    });
    expect(marca.status).toBe(200);
    expect(marca.body.marcas[0]).toMatchObject({ corPrimaria: '#e11d48', logoUrl: logo.body.url });

    // Prévia real com a marca e a abertura escrita pela IA para o lead.
    const pedidosIa: { instrucoes: string; lead: { empresa: string } }[] = [];
    const appIa = criarApp({
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
      credenciais: CREDENCIAIS,
      servicos: async (conta) => ({
        ...semServicos(conta),
        async personalizarAbertura(e: { instrucoes: string; lead: { empresa: string } }) {
          pedidosIa.push(e);
          return `Vi que a ${e.lead.empresa} entrega em Salvador.`;
        },
      }),
    });
    const previaIa = await request(appIa)
      .post('/email/previa')
      .set('Origin', ORIGEM)
      .set('Cookie', cookie)
      .send({
        assunto: 'Oi {empresa}',
        corpo: '{saudacao}\n\n{abertura}\n\n[[Ver proposta|https://tutts.com.br/proposta]]',
        empresaId: 95,
        marcaId: marcas[0].id,
        personalizarIa: true,
        instrucoesIa: 'Fale de venda perdida por demora.',
      });
    expect(previaIa.status).toBe(200);
    expect(previaIa.body.abertura).toBe('Vi que a Auto Pecas Email entrega em Salvador.');
    expect(previaIa.body.html).toContain('Vi que a Auto Pecas Email entrega em Salvador.');
    expect(previaIa.body.html).toContain(`src="${logo.body.url}"`);
    expect(previaIa.body.html).toContain('background:#e11d48');
    expect(previaIa.body.de).toMatchObject({ nome: 'Tutts' });
    expect(pedidosIa[0]?.instrucoes).toBe('Fale de venda perdida por demora.');
    // Sem IA na conta: a prévia avisa e a linha some.
    const semIa = await enviar('post', '/email/previa', {
      assunto: 'x',
      corpo: '{saudacao}\n\n{abertura}\n\nFim',
      empresaId: 95,
      personalizarIa: true,
    });
    expect(semIa.body.aviso).toMatch(/IA não está configurada/);
    expect(semIa.body.texto).toMatch(/^Olá, Joao!\n\nFim/);

    // Campanha em sequência: 1º e-mail (com anexo) e follow-up 3 dias depois sem resposta.
    expect(
      (
        await enviar('post', '/email/campanhas', {
          nome: 'Sem marca',
          campanhaId: 95,
          passos: [{ modeloId: modelos[0].id, dias: 0 }],
        })
      ).status,
    ).toBe(422);
    const camp = await enviar('post', '/email/campanhas', {
      nome: 'Teste',
      campanhaId: 95,
      incluirContador: true,
      marcaId: marcas[0].id,
      personalizarIa: true,
      instrucoesIa: 'Fale de venda perdida por demora.',
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

    // Resend falso: guarda o que foi enviado e devolve as respostas "recebidas".
    const SEGREDO = `whsec_${Buffer.from('segredo-de-teste-do-webhook').toString('base64')}`;
    const enviados: {
      para: string;
      assunto: string;
      html: string;
      anexos?: unknown[];
      emRespostaA?: string | null;
      responderPara?: string | null;
      descadastro?: string | null;
      etiquetas?: Record<string, string>;
    }[] = [];
    const recebidos = new Map<string, unknown>();
    const email = {
      remetente: 'comercial@tutts.com.br',
      dominioRespostas: 'respostas.tutts.com.br',
      segredoWebhook: SEGREDO,
      async enviar(e: (typeof enviados)[number]) {
        enviados.push(e);
        return { id: `re-${enviados.length}` };
      },
      async buscarRecebido(id: string) {
        return recebidos.get(id) as never;
      },
    };
    const deps = {
      pool,
      log: criarLogger('teste', 'silent'),
      origens: [ORIGEM],
      classificarEmail: null,
      personalizarAbertura: async (e: { lead: { empresa: string } }) => `Abertura para ${e.lead.empresa}.`,
      email,
    };
    const appResend = criarApp({
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
      credenciais: CREDENCIAIS,
      servicos: async (conta) => ({ ...semServicos(conta), email: email as never }),
    });
    const { createHmac } = await import('node:crypto');
    const aviso = (evento: object, segredo = SEGREDO) => {
      const corpo = JSON.stringify(evento);
      const id = `msg_${Math.random().toString(36).slice(2)}`;
      const ts = String(Math.floor(Date.now() / 1000));
      const assinatura = createHmac('sha256', Buffer.from(segredo.replace(/^whsec_/, ''), 'base64'))
        .update(`${id}.${ts}.${corpo}`)
        .digest('base64');
      return request(appResend)
        .post('/e/resend')
        .set('content-type', 'application/json')
        .set('svix-id', id)
        .set('svix-timestamp', ts)
        .set('svix-signature', `v1,${assinatura}`)
        .send(corpo);
    };

    const repoEmail = await import('../src/modulos/email/repositorio.js');
    const conf = await naConta(() => repoEmail.obterConfig(pool));
    const agora = Date.now();
    expect(await naConta(() => motor.enviarProximo(deps as never, conf, new Date(agora)))).toBe(true);
    expect(await naConta(() => motor.enviarProximo(deps as never, conf, new Date(agora + 1000)))).toBe(false); // intervalo
    expect(await naConta(() => motor.enviarProximo(deps as never, conf, new Date(agora + 20_000)))).toBe(
      true,
    );
    const primeiro = enviados.find((e) => e.para === 'compras@autopecasemail.com.br')!;
    expect(primeiro.assunto).toBe('Entregas mais rápidas para a Auto Pecas Email');
    expect(primeiro.html).toMatch(/Olá, Joao!/);
    // Abertura da IA no e-mail de verdade, guardada no envio; a marca vai junto.
    expect(primeiro.html).toContain('Abertura para Auto Pecas Email.');
    expect(primeiro.html).toContain(`src="${logo.body.url}"`);
    expect((primeiro as unknown as { de: { nome: string } }).de).toEqual({
      nome: 'Tutts',
      email: 'comercial@tutts.com.br',
    });
    expect(primeiro.html).toMatch(/<ul[^>]*><li[^>]*>Motoboy dedicado/);
    expect(primeiro.anexos).toHaveLength(1);
    expect(primeiro.descadastro).toMatch(/\/e\/sair\/[0-9a-f]{32}$/);
    const {
      rows: [envio95],
    } = await pool.query(`SELECT * FROM comercial.envios_email WHERE empresa_id = 95`);
    expect(envio95).toMatchObject({
      status: 'enviado',
      resend_id: expect.stringMatching(/^re-/),
      personalizacao: 'Abertura para Auto Pecas Email.',
    });
    expect(primeiro.html).toContain(`/e/a/${envio95.token}.gif`);
    // A resposta do lead vai para um endereço só deste envio, no domínio de recebimento do Resend.
    expect(primeiro.responderPara).toMatch(new RegExp(`<r-${envio95.token}@respostas\\.tutts\\.com\\.br>$`));
    expect(primeiro.etiquetas).toEqual({ envio: String(envio95.id) });

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

    // Webhook do Resend: só com assinatura válida.
    const entregue = {
      type: 'email.delivered',
      created_at: new Date().toISOString(),
      data: {
        email_id: envio95.resend_id,
        message_id: '<msg-1@resend>',
        tags: { envio: String(envio95.id) },
      },
    };
    expect((await aviso(entregue, `whsec_${Buffer.from('outro').toString('base64')}`)).status).toBe(401);
    const r1 = await aviso(entregue);
    expect(r1.body).toEqual({ ok: true, feito: 'entregue' });
    const {
      rows: [entregue95],
    } = await pool.query(`SELECT message_id, entregue_em FROM comercial.envios_email WHERE id = $1`, [
      envio95.id,
    ]);
    expect(entregue95.message_id).toBe('<msg-1@resend>');
    expect(entregue95.entregue_em).not.toBeNull();

    // E-mail do contador voltou: endereço inválido, não recebe follow-up.
    const {
      rows: [envio96],
    } = await pool.query(`SELECT id, resend_id FROM comercial.envios_email WHERE empresa_id = 96`);
    expect(
      (
        await aviso({
          type: 'email.bounced',
          data: { email_id: envio96.resend_id, bounce: { type: 'Permanent', message: 'Address not found' } },
        })
      ).body.feito,
    ).toBe('devolvido');
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
    expect(await naConta(() => motor.agendarSeguimentos(deps as never))).toBe(1);
    expect(await naConta(() => motor.enviarProximo(deps as never, conf, new Date(agora + 60_000)))).toBe(
      true,
    );
    expect(enviados.at(-1)).toMatchObject({
      para: 'compras@autopecasemail.com.br',
      emRespostaA: '<msg-1@resend>',
    });

    // Resposta com interesse chega pelo Resend: entra no SDR em "Respondeu", com próximo passo e aviso.
    recebidos.set('in-1', {
      id: 'in-1',
      messageId: '<resp-1@cliente>',
      emRespostaA: null,
      referencias: [],
      de: 'compras@autopecasemail.com.br',
      deNome: 'João',
      para: [`r-${envio95.token}@respostas.tutts.com.br`],
      assunto: 'Re: Entregas',
      texto: 'Oi! Tenho interesse sim, quanto fica para 30 entregas por dia?',
      data: new Date().toISOString(),
      automatica: false,
      devolucao: false,
    });
    expect((await aviso({ type: 'email.received', data: { email_id: 'in-1' } })).body.feito).toBe('resposta');
    expect((await aviso({ type: 'email.received', data: { email_id: 'in-1' } })).body.feito).toBe('repetido');
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
    expect((await ler('/email/lead/95')).body.respostas).toHaveLength(1);
    expect((await ler('/email')).body.status).toMatchObject({
      webhookUrl: expect.stringMatching(/\/e\/resend\/[0-9a-f]{32}$/),
    });

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

  it('master: cria a conta da parceira, guarda as credenciais cifradas e uma conta não vê nada da outra', async () => {
    // Só o master chega ao painel.
    const conta = await enviar('post', '/master/contas', {
      nome: 'Fiix Peças',
      admin: { nome: 'Bia Fiix', email: 'bia@fiix.com.br' },
    });
    expect(conta.status).toBe(201);
    expect(conta.body.convite).toMatch(/\/convite\//);
    const id = conta.body.id as number;
    expect(
      (
        await enviar('post', '/master/contas', {
          nome: 'fiix peças',
          admin: { nome: 'Xis', email: 'x@x.com' },
        })
      ).status,
    ).toBe(409);
    const lista = (await ler('/master/contas')).body as { id: number; nome: string; principal: boolean }[];
    expect(lista.map((c) => c.nome)).toEqual(['Tutts', 'Fiix Peças']);

    // Credenciais: o segredo vai cifrado para o banco; a tela só vê o final.
    const cred = await enviar('put', `/master/contas/${id}/credenciais`, {
      emailRemetente: 'comercial@fiix.com.br',
      resendDominioRespostas: 'respostas.fiix.com.br',
      iaProvedor: 'deepseek',
      segredos: {
        placesKey: 'AIza-chave-places-1234',
        resendKey: 're_chave_resend_9876',
        iaKey: 'sk-deepseek-5555',
      },
    });
    expect(cred.status).toBe(200);
    expect(cred.body.segredos).toMatchObject({
      placesKey: '…1234',
      resendKey: '…9876',
      iaKey: '…5555',
      evolutionKey: null,
    });
    expect(cred.body.emUso).toMatchObject({ places: 'conta', resend: 'conta', ia: 'conta', whatsapp: null });
    const { rows: bruto } = await pool.query(
      'SELECT segredos FROM cadastro.credenciais_conta WHERE conta_id = $1',
      [id],
    );
    expect(bruto[0].segredos).toMatch(/^v1:/);
    expect(bruto[0].segredos).not.toContain('AIza-chave-places');
    expect(
      (await enviar('put', `/master/contas/${id}/credenciais`, { segredos: { resendKey: 'chave-errada' } }))
        .status,
    ).toBe(422);
    // Apagar um segredo: '' tira; o resto fica.
    const sem = await enviar('put', `/master/contas/${id}/credenciais`, { segredos: { placesKey: '' } });
    expect(sem.body.segredos).toMatchObject({ placesKey: null, resendKey: '…9876' });
    const detalhe = (await ler(`/master/contas/${id}`)).body;
    expect(detalhe.webhooks.resend).toMatch(/\/e\/resend\/[0-9a-f]{32}$/);
    expect(detalhe.webhooks.whatsapp).toMatch(/\/webhooks\/whatsapp\/[0-9a-f]{32}$/);
    expect(detalhe.usuarios).toEqual([
      expect.objectContaining({ email: 'bia@fiix.com.br', papel: 'admin', convitePendente: true }),
    ]);

    // A administradora da parceira entra pelo convite e vê a conta dela vazia, com tudo pronto para usar.
    const token = conta.body.convite.split('/').at(-1);
    expect((await request(app).get(`/auth/convite/${token}`)).body).toMatchObject({ conta: 'Fiix Peças' });
    const entrou = await request(app)
      .post(`/auth/convite/${token}`)
      .set('Origin', ORIGEM)
      .send({ senha: 'senha-da-bia-1' });
    const cookieBia = (entrou.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    const bia = {
      ler: (rota: string) => request(app).get(rota).set('Cookie', cookieBia),
      enviar: (metodo: 'post' | 'put' | 'patch' | 'delete', rota: string, corpo?: object) =>
        request(app)[metodo](rota).set('Origin', ORIGEM).set('Cookie', cookieBia).send(corpo),
    };
    expect((await bia.ler('/auth/eu')).body).toMatchObject({
      conta: { id, nome: 'Fiix Peças' },
      master: false,
      papel: 'admin',
    });
    expect((await bia.ler('/master/contas')).status).toBe(403);

    // Nada da Tutts aparece para ela (empresas, funil, campanhas, nichos, equipe, relatórios...).
    expect((await bia.ler('/empresas?situacao=todos')).body.total).toBe(0);
    expect((await bia.ler('/empresas/1')).status).toBe(404);
    expect((await bia.ler('/funil/1')).body.oportunidade).toBeNull();
    expect((await bia.ler('/funil')).body.cards).toEqual([]);
    expect((await bia.ler('/campanhas')).body).toEqual([]);
    expect((await bia.ler('/campanhas/2')).status).toBe(404);
    expect((await bia.ler('/nichos')).body).toEqual([]);
    expect((await bia.ler('/equipe')).body.usuarios.map((u: { email: string }) => u.email)).toEqual([
      'bia@fiix.com.br',
    ]);
    expect((await bia.ler('/conversas')).body).toEqual([]);
    expect((await bia.ler('/email/campanhas')).body).toEqual([]);
    expect((await bia.ler('/email/marcas')).body.map((m: { nome: string }) => m.nome)).toEqual([
      'Fiix Peças',
    ]);
    expect((await bia.ler('/relatorios?dias=0')).body.kpis).toMatchObject({
      encontrados: 0,
      entraramNoFunil: 0,
    });
    expect((await bia.ler('/funil/pipelines')).body.map((p: { nome: string }) => p.nome)).toEqual([
      'SDR',
      'Closer',
    ]);
    // Tentar puxar uma empresa da outra conta para o funil não funciona.
    const puxar = await bia.enviar('post', '/funil', { empresaIds: [1], forcar: true });
    expect(puxar.body).toMatchObject({ adicionadas: 0, naoEncontradas: 1 });
    expect((await bia.enviar('post', '/funil/1/atividades', { tipo: 'nota', texto: 'x' })).status).toBe(404);
    expect((await bia.enviar('patch', '/campanhas/2', { nome: 'roubada' })).status).toBe(404);
    expect(
      (await bia.enviar('post', '/empresas/1/feedback', { tipo: 'nao_decisor', valor: 'Maria Souza' }))
        .status,
    ).toBe(404);
    // Base da Receita é da plataforma: só o master importa.
    expect((await bia.enviar('post', '/importacoes/cnpj', {})).status).toBe(403);
    // O mesmo nome de nicho pode existir em contas diferentes.
    const nicho = await bia.enviar('post', '/nichos', {
      nome: 'Autopeças varejo',
      cnaes: ['4530703'],
      termosMaps: ['autopeças'],
    });
    expect(nicho.status).toBe(201);
    // E a Tutts não vê o nicho da parceira.
    expect((await ler('/nichos')).body.map((n: { nome: string }) => n.nome)).toEqual(['Autopeças varejo']);
    expect((await ler(`/nichos/${nicho.body.id}`)).status).toBe(404);
    // A equipe da parceira é dela: convidar com o e-mail de alguém da Tutts não passa.
    expect(
      (await bia.enviar('post', '/equipe', { nome: 'Ops', email: 'ops@exemplo.com', papel: 'sdr' })).status,
    ).toBe(409);
    const sdrFiix = await bia.enviar('post', '/equipe', {
      nome: 'Davi',
      email: 'davi@fiix.com.br',
      papel: 'sdr',
    });
    expect(sdrFiix.status).toBe(201);
    expect(
      (await ler('/equipe')).body.usuarios.some((u: { email: string }) => u.email === 'davi@fiix.com.br'),
    ).toBe(false);

    // O master entra na conta da parceira (vira admin dela) e volta.
    const dentro = await enviar('post', `/master/contas/${id}/entrar`);
    const cookieDentro = (dentro.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    const eu = (await request(app).get('/auth/eu').set('Cookie', cookieDentro)).body;
    expect(eu).toMatchObject({
      conta: { id, nome: 'Fiix Peças' },
      master: true,
      foraDaPropria: true,
      papel: 'admin',
    });
    expect(
      (await request(app).get('/nichos').set('Cookie', cookieDentro)).body.map((n: { id: number }) => n.id),
    ).toEqual([nicho.body.id]);
    const fora = await request(app).post('/master/sair').set('Origin', ORIGEM).set('Cookie', cookieDentro);
    const cookieFora = (fora.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    expect((await request(app).get('/auth/eu').set('Cookie', cookieFora)).body).toMatchObject({
      conta: { id: 1 },
      foraDaPropria: false,
    });

    // Desativar a conta corta o acesso de quem é dela (o master continua).
    expect((await enviar('patch', '/master/contas/1', { ativa: false })).status).toBe(422);
    await enviar('patch', `/master/contas/${id}`, { ativa: false });
    expect((await bia.ler('/funil')).status).toBe(401);
    const login = await request(app)
      .post('/auth/login')
      .set('Origin', ORIGEM)
      .send({ email: 'bia@fiix.com.br', senha: 'senha-da-bia-1' });
    expect(login.status).toBe(403);
    expect(login.body.erro.codigo).toBe('conta_desativada');
    await enviar('patch', `/master/contas/${id}`, { ativa: true });
    expect((await bia.ler('/funil')).status).toBe(200);
  });

  it('sequência multicanal: e-mail, WhatsApp pelos chips em rodízio e ligação; para quando o lead responde em qualquer canal', async () => {
    const motor = await import('../src/modulos/email/motor.js');
    const agente = await import('../src/modulos/agente/motor.js');
    const repoEmail = await import('../src/modulos/email/repositorio.js');
    const repoAgente = await import('../src/modulos/agente/repositorio.js');
    const sequencia = await import('../src/modulos/email/sequencia.js');
    await pool.query(
      `INSERT INTO cadastro.campanhas (id, conta_id, nome, nicho_id, cidades) VALUES
         (120, 1, 'Campanha multicanal', (SELECT id FROM cadastro.nichos ORDER BY id LIMIT 1), '[{"nome":"Salvador","uf":"BA"}]')
       ON CONFLICT (id) DO NOTHING`,
    );
    await pool.query(
      `INSERT INTO descoberta.empresas (id, nome, cidade, uf) VALUES
         (120, 'Peças Dois Canais', 'SALVADOR', 'BA'), (121, 'Peças Só Zap', 'SALVADOR', 'BA'),
         (122, 'Peças Só Email', 'SALVADOR', 'BA')
       ON CONFLICT (id) DO NOTHING`,
    );
    await pool.query(
      `INSERT INTO descoberta.campanha_empresas (campanha_id, empresa_id, origem, liberado_em)
       SELECT 120, x, 'maps', now() FROM unnest(ARRAY[120, 121, 122]) x ON CONFLICT DO NOTHING`,
    );
    await pool.query(
      `INSERT INTO enriquecimento.contatos (empresa_id, canal, valor, fonte, fontes, status, whatsapp, principal) VALUES
         (120, 'email', 'compras@doiscanais.com.br', 'site', '{site}', 'nao_verificado', false, true),
         (120, 'whatsapp', '71999990120', 'site', '{site}', 'verificado', true, true),
         (121, 'whatsapp', '71999990121', 'site', '{site}', 'verificado', true, true),
         (122, 'email', 'loja@soemail.com.br', 'site', '{site}', 'nao_verificado', false, true)`,
    );

    // Dois chips: o 1º só manda uma automática por dia.
    await pool.query(`DELETE FROM comercial.chips WHERE instancia = 'principal'`);
    await novoChip({ nome: 'Chip 1', instancia: 'chip1', limiteDia: 1 });
    const c2 = { body: await novoChip({ nome: 'Chip 2', instancia: 'chip2', limiteDia: 5 }) };
    expect(c2.body.chips).toHaveLength(2);
    await expect(
      naConta(() => chipsRepo.criar(pool, { nome: 'Repetido', instancia: 'CHIP1', limiteDia: 1 })),
    ).rejects.toThrow(/já está cadastrada/);

    // Quem pode entrar depende dos canais da sequência.
    const soEmail = await enviar('post', '/email/campanhas/estimar', { campanhaId: 120 });
    expect(soEmail.body).toMatchObject({ leads: 3, comEmail: 2, comWhatsapp: 2, elegiveis: 2 });
    const comZap = await enviar('post', '/email/campanhas/estimar', {
      campanhaId: 120,
      canais: ['email', 'whatsapp'],
    });
    expect(comZap.body.elegiveis).toBe(3);

    const modelos = (await ler('/email/modelos')).body;
    const marcas = (await ler('/email/marcas')).body;
    // Passo de WhatsApp precisa da mensagem.
    expect(
      (
        await enviar('post', '/email/campanhas', {
          nome: 'x',
          campanhaId: 120,
          marcaId: marcas[0].id,
          passos: [{ canal: 'whatsapp', dias: 0 }],
        })
      ).status,
    ).toBe(422);
    const camp = await enviar('post', '/email/campanhas', {
      nome: 'Multicanal',
      campanhaId: 120,
      marcaId: marcas[0].id,
      passos: [
        { canal: 'email', modeloId: modelos[0].id, dias: 0 },
        {
          canal: 'whatsapp',
          texto: '{saudacao} Aqui é da Tutts: viu o e-mail sobre entregas na {empresa}?',
          dias: 2,
        },
        { canal: 'ligacao', texto: 'Pergunte quantas entregas a {empresa} faz por dia.', dias: 2 },
      ],
    });
    expect(camp.status).toBe(201);
    expect((await enviar('post', `/email/campanhas/${camp.body.id}/iniciar`)).body).toEqual({ naFila: 3 });
    const cfgEmail = (await ler('/email')).body.config;
    await enviar('put', '/email/config', {
      ...cfgEmail,
      ligado: true,
      horaInicio: 0,
      horaFim: 24,
      diasSemana: [0, 1, 2, 3, 4, 5, 6],
      intervaloSeg: 10,
    });
    const conf = await naConta(() => repoEmail.obterConfig(pool));

    // 1º passo (e-mail): quem não tem e-mail pula para o próximo passo.
    const enviadosEmail: { para: string; assunto: string }[] = [];
    const email = {
      remetente: 'comercial@tutts.com.br',
      dominioRespostas: null,
      segredoWebhook: null,
      async enviar(e: { para: string; assunto: string }) {
        enviadosEmail.push(e);
        return { id: `re-mc-${enviadosEmail.length}` };
      },
    };
    const depsEmail = {
      pool,
      log: criarLogger('teste', 'silent'),
      origens: [ORIGEM],
      classificarEmail: null,
      personalizarAbertura: null,
      email,
    };
    let t = Date.now();
    for (let i = 0; i < 5; i++) {
      await naConta(() => motor.enviarProximo(depsEmail as never, conf, new Date(t)));
      t += 20_000;
    }
    expect(enviadosEmail.map((e) => e.para).sort()).toEqual([
      'compras@doiscanais.com.br',
      'loja@soemail.com.br',
    ]);
    const { rows: passo1 } = await pool.query(
      `SELECT empresa_id::int, status, erro FROM comercial.envios_email WHERE campanha_email_id = $1 ORDER BY empresa_id`,
      [camp.body.id],
    );
    expect(passo1.map((r) => r.status)).toEqual(['enviado', 'pulado', 'enviado']);
    expect(passo1[1].erro).toBe('Sem e-mail');

    // 2º passo (WhatsApp) depois de 2 dias: entra no funil e vai para a fila do WhatsApp; sem WhatsApp, pula.
    await pool.query(
      `UPDATE comercial.envios_email SET enviado_em = now() - interval '3 days' WHERE campanha_email_id = $1`,
      [camp.body.id],
    );
    expect(await naConta(() => motor.agendarSeguimentos(depsEmail as never))).toBe(3);
    expect(await naConta(() => motor.processarOutrosCanais(depsEmail as never, conf))).toBe(2);
    const { rows: msgs } = await pool.query(
      `SELECT empresa_id::int, texto, status, origem FROM comercial.mensagens WHERE empresa_id IN (120, 121) ORDER BY empresa_id`,
    );
    expect(msgs).toEqual([
      expect.objectContaining({
        empresa_id: 120,
        status: 'aprovada',
        origem: 'sequencia',
        texto: expect.stringMatching(
          /^Olá! Aqui é da Tutts: viu o e-mail sobre entregas na Peças Dois Canais\?/,
        ),
      }),
      expect.objectContaining({ empresa_id: 121, status: 'aprovada', origem: 'sequencia' }),
    ]);
    // No funil, o follow-up espera a sequência (nada de dois toques no mesmo lead).
    const op120 = (await ler('/funil/120')).body.oportunidade;
    expect(op120).toMatchObject({
      etapa: 'a_abordar',
      proximaAcao: 'Na sequência automática',
      proximaAcaoEm: null,
    });

    // O WhatsApp da sequência sai mesmo com o agente desligado, em rodízio entre os chips.
    const tela = await ler('/agente');
    await enviar('put', '/agente/config', {
      ...tela.body.config,
      ligado: false,
      horaInicio: 0,
      horaFim: 24,
      diasSemana: [0, 1, 2, 3, 4, 5, 6],
      intervaloSeg: 30,
    });
    const cfgAgente = await naConta(() => repoAgente.obterConfig(pool));
    const zaps: { tel: string; instancia?: string }[] = [];
    const depsZap = {
      pool,
      log: criarLogger('teste', 'silent'),
      ia: null,
      whatsapp: {
        instancia: 'padrao',
        async enviar(tel: string, _texto: string, instancia?: string) {
          zaps.push({ tel, instancia });
          return { idExterno: `mc-${zaps.length}` };
        },
      },
    };
    const agora = new Date();
    expect(await naConta(() => agente.enviarProxima(depsZap, cfgAgente, agora, { soSequencia: true }))).toBe(
      true,
    );
    // Mesmo minuto: o chip 1 está no intervalo, então o outro lead sai pelo chip 2.
    expect(await naConta(() => agente.enviarProxima(depsZap, cfgAgente, agora, { soSequencia: true }))).toBe(
      true,
    );
    expect(zaps.map((z) => z.instancia).sort()).toEqual(['chip1', 'chip2']);
    expect(await naConta(() => agente.enviarProxima(depsZap, cfgAgente, agora, { soSequencia: true }))).toBe(
      false,
    );
    const { rows: chipsDosLeads } = await pool.query(
      `SELECT o.empresa_id::int, c.instancia FROM comercial.oportunidades o JOIN comercial.chips c ON c.id = o.chip_id
        WHERE o.empresa_id IN (120, 121) ORDER BY o.empresa_id`,
    );
    expect(chipsDosLeads).toHaveLength(2);
    const chipDo120 = chipsDosLeads.find((c) => c.empresa_id === 120)!.instancia;

    // O lead 120 responde no WhatsApp: a sequência para para ele (sem ligação depois).
    const token = tela.body.webhook.split('/').at(-1);
    await request(app)
      .post(`/webhooks/evolution/${token}`)
      .send({
        event: 'messages.upsert',
        instance: chipDo120,
        data: {
          key: { remoteJid: '5571999990120@s.whatsapp.net', fromMe: false, id: 'mc-in-1' },
          message: { conversation: 'Vi sim, me liga amanhã' },
          pushName: 'Ana',
        },
      });
    expect(await naConta(() => sequencia.estaEmSequencia(pool, 120))).toBe(false);
    const { rows: parado } = await pool.query(
      `SELECT DISTINCT parado_motivo FROM comercial.envios_email WHERE empresa_id = 120 AND parado_motivo IS NOT NULL`,
    );
    expect(parado.map((p) => p.parado_motivo)).toContain('Respondeu no WhatsApp');
    expect((await ler('/funil/120')).body.oportunidade.etapa).toBe('respondeu');

    // 3º passo (ligação) para quem não respondeu: tarefa de hoje com o roteiro e o telefone.
    await pool.query(
      `UPDATE comercial.envios_email SET enviado_em = now() - interval '3 days' WHERE campanha_email_id = $1`,
      [camp.body.id],
    );
    expect(await naConta(() => motor.agendarSeguimentos(depsEmail as never))).toBe(2);
    expect(await naConta(() => motor.processarOutrosCanais(depsEmail as never, conf))).toBe(2);
    const { rows: ligacoes } = await pool.query(
      `SELECT empresa_id::int, titulo, descricao FROM comercial.tarefas WHERE tipo = 'ligacao' AND empresa_id IN (120, 121, 122)
        ORDER BY empresa_id`,
    );
    expect(ligacoes.map((l) => l.empresa_id)).toEqual([121, 122]);
    expect(ligacoes[0]).toMatchObject({ titulo: 'Ligar para Peças Só Zap' });
    expect(ligacoes[0].descricao).toMatch(/Telefone: 71999990121/);
    expect(ligacoes[0].descricao).toMatch(
      /Pergunte quantas entregas a Pecas So Zap faz por dia\.|Pergunte quantas entregas a Peças Só Zap faz por dia\./,
    );

    // Números da sequência por canal.
    const linha = (await ler('/email/campanhas')).body.find((c: { id: number }) => c.id === camp.body.id);
    expect(linha).toMatchObject({
      enviadosEmail: 2,
      enviadosWhatsapp: 2,
      ligacoes: 2,
      pulados: 2,
      responderam: 1,
      responderamWhatsapp: 1,
    });
    // Prévia de um passo de WhatsApp: o texto pronto para o lead.
    const previaZap = await enviar('post', `/email/campanhas/${camp.body.id}/previa`, {
      passo: 2,
      empresaId: 121,
    });
    expect(previaZap.body).toMatchObject({
      canal: 'whatsapp',
      texto: expect.stringMatching(/^Olá! Aqui é da Tutts/),
    });

    // Conversas: e-mail e WhatsApp do lead no mesmo lugar.
    const conversa = (await ler('/conversas/120')).body;
    expect(conversa.mensagens.map((m: { canal: string }) => m.canal)).toEqual(
      expect.arrayContaining(['email', 'whatsapp']),
    );
    expect(conversa.email).toBe('compras@doiscanais.com.br');

    // Resposta por e-mail do 122 também para (e aparece na conversa como não lida).
    await naConta(() =>
      motor.processarRecebido(
        depsEmail as never,
        {
          id: 'mc-r1',
          messageId: '<mc-r1@cliente>',
          emRespostaA: null,
          referencias: [],
          de: 'loja@soemail.com.br',
          deNome: null,
          para: ['comercial@tutts.com.br'],
          assunto: 'Re: entregas',
          texto: 'Pode me mandar a proposta?',
          data: new Date().toISOString(),
          automatica: false,
          devolucao: false,
        } as never,
      ),
    );
    expect(await naConta(() => sequencia.estaEmSequencia(pool, 122))).toBe(false);
    const lista = (await ler('/conversas?filtro=nao_lidas')).body;
    expect(lista.find((c: { empresaId: number }) => c.empresaId === 122)).toMatchObject({
      ultimoCanal: 'email',
    });

    // Responder pela conversa vai por e-mail, na mesma conversa.
    const enviadosConversa: { para: string; assunto: string; emRespostaA?: string | null }[] = [];
    const appEmail = criarApp({
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
      credenciais: CREDENCIAIS,
      servicos: async (conta) => ({
        ...semServicos(conta),
        email: {
          remetente: 'comercial@tutts.com.br',
          dominioRespostas: null,
          segredoWebhook: null,
          async enviar(e: { para: string; assunto: string; emRespostaA?: string | null }) {
            enviadosConversa.push(e);
            return { id: 're-conv' };
          },
        } as never,
      }),
    });
    const resp = await request(appEmail)
      .post('/conversas/122/email')
      .set('Origin', ORIGEM)
      .set('Cookie', cookie)
      .send({ texto: 'Mando sim, segue em anexo amanhã.' });
    expect(resp.status).toBe(201);
    expect(enviadosConversa[0]).toMatchObject({
      para: 'loja@soemail.com.br',
      assunto: 'Re: Re: entregas'.replace('Re: Re:', 'Re:'),
      emRespostaA: '<mc-r1@cliente>',
    });
    expect(resp.body.mensagens.at(-1)).toMatchObject({ canal: 'email', direcao: 'enviada' });

    // Limpa.
    await pool.query('DELETE FROM comercial.campanhas_email');
    await pool.query('DELETE FROM comercial.respostas_email WHERE empresa_id IN (120, 121, 122)');
    await pool.query('DELETE FROM comercial.mensagens WHERE empresa_id IN (120, 121, 122)');
    await pool.query('DELETE FROM comercial.oportunidades WHERE empresa_id IN (120, 121, 122)');
    await pool.query('DELETE FROM comercial.chips');
    await pool.query('DELETE FROM enriquecimento.contatos WHERE empresa_id IN (120, 121, 122)');
    await pool.query('DELETE FROM descoberta.empresas WHERE id IN (120, 121, 122)');
    await pool.query('DELETE FROM cadastro.campanhas WHERE id = 120');
  });

  it('operação: consumo e tetos, senha esquecida pelo Resend, auditoria, alertas, exportação e celular', async () => {
    const { medidorDeIa } = await import('@prospeccao/db');
    // Consumo da IA da plataforma com teto de 2 chamadas no mês.
    expect((await enviar('put', '/master/contas/1/limites', { iaMes: 2, emailsMes: 0 })).status).toBe(200);
    const m = medidorDeIa(pool, 1, 'plataforma');
    await m.antes();
    await m.depois({ tokensEntrada: 1000, tokensSaida: 200 }, true);
    await m.antes();
    await m.depois({ tokensEntrada: 500, tokensSaida: 100 }, false);
    await expect(m.antes()).rejects.toMatchObject({ codigo: 'limite_ia' });
    // A chave da própria conta não tem teto.
    await medidorDeIa(pool, 1, 'conta').antes();
    const consumo = (await ler('/master/contas/1/consumo')).body;
    expect(consumo.ia.plataforma).toMatchObject({
      chamadas: 2,
      tokensEntrada: 1500,
      tokensSaida: 300,
      erros: 1,
      bloqueadas: 1,
    });
    expect(consumo.limites).toMatchObject({ iaMes: 2, emailsMes: 0, usaIaPlataforma: true });
    const { limiteDoMes } = await import('../src/modulos/consumo/repositorio.js');
    expect((await naConta(() => limiteDoMes(pool, 'emails'))).esgotado).toBe(true);
    expect((await ler('/master/contas')).body.find((c: { id: number }) => c.id === 1)).toMatchObject({
      iaPlataformaMes: 2,
      limiteIaMes: 2,
    });
    await enviar('put', '/master/contas/1/limites', { iaMes: null, emailsMes: null });

    // Senha esquecida: o link vai pelo Resend da conta principal; a senha antiga vale até trocar.
    const bcrypt = (await import('bcryptjs')).default;
    await pool.query(
      `INSERT INTO cadastro.usuarios (nome, email, papel, ativo, conta_id, senha_hash)
       VALUES ('Carla Senha', 'carla@exemplo.com', 'sdr', true, 1, $1)`,
      [await bcrypt.hash('senha-antiga-123', 4)],
    );
    const emailsSistema: { para: string; html: string; texto: string }[] = [];
    const appSenha = (comEmail: boolean) =>
      criarApp({
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
        credenciais: CREDENCIAIS,
        servicos: async (conta) => ({
          ...semServicos(conta),
          email: comEmail
            ? ({
                remetente: 'sistema@tutts.com.br',
                dominioRespostas: null,
                segredoWebhook: null,
                async enviar(e: { para: string; html: string; texto: string }) {
                  emailsSistema.push(e);
                  return { id: 're-senha' };
                },
              } as never)
            : null,
        }),
      });
    const pedir = (a: ReturnType<typeof criarApp>, email: string) =>
      request(a).post('/auth/esqueci').set('Origin', ORIGEM).send({ email });
    expect((await pedir(appSenha(false), 'carla@exemplo.com')).status).toBe(503);
    const comEmail = appSenha(true);
    expect((await pedir(comEmail, 'ninguem@exemplo.com')).body).toEqual({ ok: true });
    expect(emailsSistema).toHaveLength(0);
    expect((await pedir(comEmail, 'CARLA@exemplo.com')).body).toEqual({ ok: true });
    expect(emailsSistema[0]?.para).toBe('carla@exemplo.com');
    const link = emailsSistema[0]!.texto.match(/\/redefinir\/([\w-]+)/)!;
    const loginCarla = (senha: string) =>
      request(comEmail).post('/auth/login').set('Origin', ORIGEM).send({ email: 'carla@exemplo.com', senha });
    expect((await loginCarla('senha-antiga-123')).status).toBe(200);
    expect((await request(comEmail).get(`/auth/redefinir/${link[1]}`)).body).toMatchObject({
      nome: 'Carla Senha',
    });
    const nova = await request(comEmail)
      .post(`/auth/redefinir/${link[1]}`)
      .set('Origin', ORIGEM)
      .send({ senha: 'senha-nova-456' });
    expect(nova.status).toBe(200);
    expect((await request(comEmail).get(`/auth/redefinir/${link[1]}`)).status).toBe(404); // só uma vez
    expect((await loginCarla('senha-antiga-123')).status).toBe(401);
    expect((await loginCarla('senha-nova-456')).status).toBe(200);

    // Auditoria: alterações pela tela, logins e a troca de senha, com quem e quando.
    await new Promise((ok) => setTimeout(ok, 100));
    const aud = (await ler('/auditoria')).body;
    const descricoes = aud.itens.map((i: { descricao: string }) => i.descricao);
    expect(descricoes).toEqual(
      expect.arrayContaining([
        'Entrou no sistema',
        'Criou uma senha nova pelo link do e-mail',
        'Tentativa de login com senha errada',
        expect.stringMatching(/^Criou a sequência “Multicanal”/),
      ]),
    );
    expect(JSON.stringify(aud.itens)).not.toMatch(/senha-nova-456|senha-antiga-123/);
    expect((await ler('/auditoria?busca=sequência')).body.itens.length).toBeGreaterThan(0);
    expect((await ler('/master/contas/1/auditoria')).body.length).toBeGreaterThan(0);

    // Alertas: chip caído abre o alerta e avisa o administrador uma vez; voltou, fecha.
    const { verificarSaude } = await import('../src/modulos/alertas/rotina.js');
    await pool.query(
      `INSERT INTO comercial.chips (conta_id, nome, instancia, token_cifrado) VALUES (1, 'Chip Loja', 'loja1', 'x')`,
    );
    let estado = 'desconectado: leia o QR Code para conectar';
    const depsSaude = {
      pool,
      log: criarLogger('teste', 'silent'),
      servicos: async (conta: number) => ({
        ...semServicos(conta),
        whatsapp: {
          enviar: async () => ({ idExterno: null }),
          estado: async () => estado,
        },
      }),
    };
    await verificarSaude(depsSaude as never);
    await verificarSaude(depsSaude as never);
    const alertas = (await ler('/alertas')).body;
    expect(alertas).toEqual([
      expect.objectContaining({ chave: 'chip:loja1', titulo: 'O chip “Chip Loja” está desconectado' }),
    ]);
    const { rows: avisos } = await pool.query(
      `SELECT count(*)::int AS n FROM comercial.notificacoes WHERE titulo = 'O chip “Chip Loja” está desconectado'`,
    );
    expect(avisos[0].n).toBeGreaterThanOrEqual(1);
    const antes = avisos[0].n;
    await verificarSaude(depsSaude as never);
    const { rows: depois } = await pool.query(
      `SELECT count(*)::int AS n FROM comercial.notificacoes WHERE titulo = 'O chip “Chip Loja” está desconectado'`,
    );
    expect(depois[0].n).toBe(antes);
    estado = 'ok (WhatsApp conectado)';
    await verificarSaude(depsSaude as never);
    expect((await ler('/alertas')).body).toEqual([]);
    // Worker sem sinal de vida: alerta da plataforma (o master vê).
    await pool.query(
      `INSERT INTO cadastro.servicos_vivos (nome, visto_em) VALUES ('worker-descoberta', now() - interval '1 hour')
       ON CONFLICT (nome) DO UPDATE SET visto_em = EXCLUDED.visto_em`,
    );
    await verificarSaude(depsSaude as never);
    expect((await ler('/alertas')).body.map((a: { chave: string }) => a.chave)).toContain(
      'servico:worker-descoberta',
    );
    await pool.query(`DELETE FROM cadastro.servicos_vivos`);
    await pool.query(`DELETE FROM comercial.chips`);
    await verificarSaude(depsSaude as never);

    // Exportação para o Excel (só o administrador; fica na auditoria).
    for (const rota of ['/exportar/leads', '/exportar/funil', '/exportar/relatorio']) {
      const x = await ler(rota)
        .buffer(true)
        .parse((res, cb) => {
          const partes: Buffer[] = [];
          res.on('data', (p: Buffer) => partes.push(p));
          res.on('end', () => cb(null, Buffer.concat(partes)));
        });
      expect(x.status).toBe(200);
      expect(x.headers['content-type']).toMatch(/spreadsheetml/);
      expect((x.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    }
    await new Promise((ok) => setTimeout(ok, 100));
    expect((await ler('/auditoria?acao=exportação')).body.itens.length).toBe(3);

    // Notificação no celular: as chaves são geradas pelo sistema; o aparelho se inscreve e cancela.
    const push = await import('../src/modulos/push/servico.js');
    await push.iniciarPush(pool, criarLogger('teste', 'silent'), CREDENCIAIS.chave, 'ops@exemplo.com');
    const chave = (await ler('/notificacoes/push')).body.chave;
    expect(chave).toMatch(/^[\w-]{80,}$/);
    await push.iniciarPush(pool, criarLogger('teste', 'silent'), CREDENCIAIS.chave, 'ops@exemplo.com');
    expect((await ler('/notificacoes/push')).body.chave).toBe(chave); // mesma chave depois de reiniciar
    const inscricao = {
      endpoint: 'https://push.exemplo.com/abc123',
      keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) },
      aparelho: 'Android · Chrome',
    };
    expect((await enviar('post', '/notificacoes/push', inscricao)).body.aparelhos).toHaveLength(1);
    expect(
      (await enviar('delete', '/notificacoes/push', { endpoint: inscricao.endpoint })).body.aparelhos,
    ).toHaveLength(0);
    await pool.query(`DELETE FROM cadastro.usuarios WHERE email = 'carla@exemplo.com'`);
  });

  it('número de WhatsApp: o cliente conecta pelo QR Code, a plataforma assina e cancela na Z-API', async () => {
    const chamadas: string[] = [];
    let conectado = false;
    const appQr = criarApp({
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
      credenciais: CREDENCIAIS,
      servicos: async (conta) => ({
        ...semServicos(conta),
        whatsapp: {
          enviar: async () => ({ idExterno: null }),
          async criar(nome: string, webhook: string) {
            chamadas.push(`criar ${nome} ${webhook.replace(/[0-9a-f]{32}$/, 'TOKEN')}`);
            return { instancia: 'INST-QR', token: 'tok-secreto' };
          },
          async qr(instancia: string) {
            chamadas.push(`qr ${instancia}`);
            return conectado
              ? { conectado: true, imagem: null }
              : { conectado: false, imagem: 'data:image/png;base64,AAA' };
          },
          async assinar(instancia: string) {
            chamadas.push(`assinar ${instancia}`);
          },
          async cancelar(instancia: string) {
            chamadas.push(`cancelar ${instancia}`);
          },
          async desconectar(instancia: string) {
            chamadas.push(`desconectar ${instancia}`);
          },
        },
      }),
    });
    const q = (metodo: 'get' | 'post' | 'delete', rota: string, corpo?: object) =>
      request(appQr)[metodo](rota).set('Origin', ORIGEM).set('Cookie', cookie).send(corpo);
    await pool.query(`UPDATE cadastro.contas SET limite_chips = 2 WHERE id = 1`);

    const antes = (await q('get', '/agente/chips')).body;
    expect(antes).toMatchObject({ conectado: true, limite: 2 });
    const criado = await q('post', '/agente/chips', { nome: 'Loja Centro' });
    expect(criado.status).toBe(201);
    expect(chamadas[0]).toMatch(/^criar Loja Centro · conta 1 http.+\/webhooks\/whatsapp\/TOKEN$/);
    const { rows: guardado } = await pool.query(`SELECT token_cifrado FROM comercial.chips WHERE id = $1`, [
      criado.body.id,
    ]);
    expect(guardado[0].token_cifrado).toMatch(/^v1:/); // o token da instância fica cifrado
    // Ainda não leu o QR: não entra no rodízio de envio.
    expect((await naConta(() => chipsRepo.emUso(pool))).some((c) => c.id === criado.body.id)).toBe(false);
    // Limite do plano.
    const usados = (await q('get', '/agente/chips')).body.usados;
    if (usados >= 2) expect((await q('post', '/agente/chips', { nome: 'Outro' })).status).toBe(422);

    // A tela pede o QR; depois de ler, conecta e a instância é assinada uma vez só.
    expect((await q('get', `/agente/chips/${criado.body.id}/qr`)).body).toMatchObject({ conectado: false });
    conectado = true;
    expect((await q('get', `/agente/chips/${criado.body.id}/qr`)).body).toMatchObject({ conectado: true });
    await q('get', `/agente/chips/${criado.body.id}/qr`);
    expect(chamadas.filter((c) => c.startsWith('assinar'))).toEqual(['assinar INST-QR']);
    expect((await naConta(() => chipsRepo.emUso(pool))).some((c) => c.id === criado.body.id)).toBe(true);

    // Webhook de desconexão: avisa os administradores; reconectou com o número, guarda o número.
    const token = (await ler('/agente')).body.webhook.split('/').at(-1);
    await request(appQr)
      .post(`/webhooks/whatsapp/${token}`)
      .send({ type: 'DisconnectedCallback', instanceId: 'INST-QR' });
    const lista1 = (await q('get', '/agente/chips')).body.chips;
    expect(lista1.find((c: { id: number }) => c.id === criado.body.id).estado).toMatch(/^desconectado/);
    const { rows: aviso } = await pool.query(
      `SELECT count(*)::int AS n FROM comercial.notificacoes WHERE titulo = 'O WhatsApp "Loja Centro" desconectou'`,
    );
    expect(aviso[0].n).toBeGreaterThanOrEqual(1);
    await request(appQr)
      .post(`/webhooks/whatsapp/${token}`)
      .send({ type: 'ConnectedCallback', instanceId: 'INST-QR', phone: '5571999998888' });
    const lista2 = (await q('get', '/agente/chips')).body.chips;
    expect(lista2.find((c: { id: number }) => c.id === criado.body.id)).toMatchObject({
      numero: '5571999998888',
      estado: 'ok (WhatsApp conectado)',
    });

    // Remover: cancela na Z-API (para de cobrar) e apaga.
    expect((await q('delete', `/agente/chips/${criado.body.id}`)).status).toBe(200);
    expect(chamadas.at(-1)).toBe('cancelar INST-QR');
    await pool.query(`UPDATE cadastro.contas SET limite_chips = NULL WHERE id = 1`);
  });

  it('domínio de e-mail: o cliente cadastra, vê o DNS, confere, escolhe o remetente e envia pela plataforma', async () => {
    const chamadas: string[] = [];
    let situacao: 'pendente' | 'verificado' = 'pendente';
    const dominioResend = () => ({
      id: 'dom-1',
      nome: 'lojateste.com.br',
      situacao,
      registros: [
        {
          finalidade: 'Assinatura (DKIM)',
          tipo: 'TXT',
          nome: 'resend._domainkey.lojateste.com.br',
          valor: 'p=MIG',
          prioridade: null,
          ttl: 'Auto',
          situacao,
        },
        {
          finalidade: 'Envio (SPF)',
          tipo: 'TXT',
          nome: 'send',
          valor: 'v=spf1 include:amazonses.com ~all',
          prioridade: null,
          ttl: 'Auto',
          situacao,
        },
      ],
    });
    const appDom = criarApp({
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
      credenciais: CREDENCIAIS,
      servicos: async (conta) => semServicos(conta),
      dominiosEmail: {
        async criar(nome) {
          chamadas.push(`criar ${nome}`);
          return dominioResend();
        },
        async ler() {
          return dominioResend();
        },
        async verificar(id) {
          chamadas.push(`verificar ${id}`);
        },
        async apagar(id) {
          chamadas.push(`apagar ${id}`);
        },
      },
    });
    const q = (metodo: 'get' | 'post' | 'put' | 'delete', rota: string, corpo?: object) =>
      request(appDom)[metodo](rota).set('Origin', ORIGEM).set('Cookie', cookie).send(corpo);

    expect((await q('get', '/email/dominio')).body).toMatchObject({ dominio: null, disponivel: true });
    expect((await q('post', '/email/dominio', { dominio: 'gmail.com' })).status).toBe(422);
    const criado = await q('post', '/email/dominio', { dominio: 'https://www.LojaTeste.com.br/' });
    expect(criado.status).toBe(201);
    expect(chamadas).toEqual(['criar lojateste.com.br']);
    expect(criado.body.dominio).toMatchObject({
      dominio: 'lojateste.com.br',
      situacao: 'pendente',
      remetente: 'comercial@lojateste.com.br',
    });
    // Nomes como se digita no painel do DNS, e o DMARC recomendado junto.
    expect(criado.body.dominio.registros.map((r: { nome: string }) => r.nome)).toEqual([
      'resend._domainkey',
      'send',
      '_dmarc',
    ]);
    expect((await q('post', '/email/dominio', { dominio: 'outra.com.br' })).status).toBe(409);
    expect((await q('put', '/email/dominio/remetente', { remetente: 'ana@gmail.com' })).status).toBe(422);
    expect(
      (await q('put', '/email/dominio/remetente', { remetente: 'Vendas@lojateste.com.br' })).body.dominio
        .remetente,
    ).toBe('vendas@lojateste.com.br');

    // Configurou o DNS: confere e passa a enviar pelo Resend da plataforma com o remetente dele.
    situacao = 'verificado';
    const conferido = await q('post', '/email/dominio/verificar');
    expect(chamadas).toContain('verificar dom-1');
    expect(conferido.body).toMatchObject({ emUso: true, dominio: { situacao: 'verificado' } });
    const { lerCredenciais, resolverCredenciais } = await import('@prospeccao/db');
    const cred = resolverCredenciais(
      await lerCredenciais(pool, 1, CREDENCIAIS.chave),
      { resendKey: 're_plataforma', emailRemetente: null },
      1,
    );
    expect(cred.resend).toMatchObject({ apiKey: 're_plataforma', remetente: 'vendas@lojateste.com.br' });

    expect((await q('delete', '/email/dominio')).body.dominio).toBeNull();
    expect(chamadas.at(-1)).toBe('apagar dom-1');
  });

  it('importa os leads do cliente: lê o Excel, reconhece as colunas, grava, põe no funil e não mostra para outra conta', async () => {
    const { gerarXlsx } = await import('../src/modulos/exportar/planilha.js');
    const xlsx = await gerarXlsx([
      {
        nome: 'Clientes',
        colunas: [
          { titulo: 'Razão Social' },
          { titulo: 'Responsável' },
          { titulo: 'Celular' },
          { titulo: 'E-mail' },
          { titulo: 'Município' },
          { titulo: 'Obs' },
        ],
        linhas: [
          [
            'AUTO PEÇAS IMPORTADA LTDA',
            'Marcos Teixeira',
            71987654321,
            'marcos@importada.com.br',
            'Salvador/BA',
            'Compra toda semana',
          ],
          ['Peças Sem Cidade', '', '71 3333-4444', '', '', ''],
          ['', '', '', '', '', 'linha só com observação'],
        ],
      },
    ]);
    expect(
      (await enviar('post', '/importacoes-leads/analisar', { nome: 'clientes.xls', base64: 'AAAA' })).status,
    ).toBe(422); // .xls antigo: pede para salvar como .xlsx
    const an = await enviar('post', '/importacoes-leads/analisar', {
      nome: 'clientes.xlsx',
      mime: '',
      base64: xlsx.toString('base64'),
    });
    expect(an.status).toBe(201);
    const mapa = an.body.colunas.map((c: { campo: string }) => c.campo);
    expect(mapa).toEqual(['empresa', 'contato', 'telefone', 'email', 'cidade', 'observacao']);
    expect(an.body.colunas[2]).toMatchObject({
      cabecalho: 'Celular',
      exemplos: ['71987654321', '71 3333-4444'],
    });
    expect(an.body).toMatchObject({ leitura: 'regras', cabecalho: 0, linhasDoArquivo: 3 });

    const id = an.body.id;
    const previa = (await enviar('post', `/importacoes-leads/${id}/previa`, { mapa })).body;
    expect(previa).toMatchObject({
      leads: 2,
      semNome: 1,
      semCidade: 1,
      comTelefone: 2,
      comEmail: 1,
      comContato: 1,
    });
    expect(previa.amostra[0]).toMatchObject({
      empresa: 'Auto Peças Importada LTDA',
      cidade: 'Salvador',
      uf: 'BA',
    });

    const { rows: nicho } = await pool.query(
      `SELECT id FROM cadastro.nichos WHERE conta_id = 1 AND ativo ORDER BY id LIMIT 1`,
    );
    const antes = publicados.length;
    const imp = await enviar('post', `/importacoes-leads/${id}/importar`, {
      mapa,
      cidadePadrao: 'Lauro de Freitas',
      ufPadrao: 'BA',
      destino: { nova: { nome: 'Clientes antigos', nichoId: nicho[0].id } },
      enriquecer: false,
      funil: { responsavelId: null },
    });
    expect(imp.status).toBe(202);
    expect(publicados.slice(antes)).toEqual([{ nome: 'leads.importar', payload: { importacaoId: id } }]);
    expect(
      (
        await enviar('post', `/importacoes-leads/${id}/importar`, {
          mapa,
          destino: { campanhaId: imp.body.campanha.id },
        })
      ).status,
    ).toBe(409); // não importa duas vezes
    const campanha = (await ler(`/campanhas/${imp.body.campanha.id}`)).body;
    expect(campanha).toMatchObject({ nome: 'Clientes antigos', tipo: 'importacao', status: 'ativa' });

    // O worker grava (o mesmo código do worker-descoberta) e a api põe no funil.
    const { importarLeads } = await import('../../worker-descoberta/src/importacao.js');
    await importarLeads(
      { pool, log: criarLogger('teste', 'silent'), filas: { publicar: async () => 'x' } } as never,
      id,
    );
    const { porNoFunil } = await import('../src/modulos/importacao-leads/rotina.js');
    expect(await porNoFunil(pool, criarLogger('teste', 'silent'))).toBe(1);
    const fim = (await ler(`/importacoes-leads/${id}`)).body;
    expect(fim).toMatchObject({ status: 'concluida', total: 2, gravados: 2 });
    expect(fim.resultado).toMatchObject({ novas: 2, funil: { adicionadas: 2 } });
    expect((await ler('/importacoes-leads')).body[0]).toMatchObject({ id, status: 'concluida' });

    const { rows: emp } = await pool.query(
      `SELECT e.id::int, e.nome, e.cidade FROM descoberta.campanha_empresas ce JOIN descoberta.empresas e ON e.id = ce.empresa_id
        WHERE ce.campanha_id = $1 ORDER BY e.id`,
      [imp.body.campanha.id],
    );
    expect(emp.map((e: { cidade: string }) => e.cidade)).toEqual(['SALVADOR', 'LAURO DE FREITAS']);
    const ficha = (await ler(`/empresas/${emp[0].id}`)).body;
    expect(ficha.contatos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ canal: 'telefone', valor: '71987654321', fonte: 'importacao' }),
        expect.objectContaining({ canal: 'email', valor: 'marcos@importada.com.br' }),
      ]),
    );
    expect(ficha.pessoas[0]).toMatchObject({ nome: 'Marcos Teixeira', decisor: true });
    const funil = (await ler(`/funil/${emp[0].id}`)).body;
    expect(funil.oportunidade.etapa).toBe('a_abordar');
    expect(JSON.stringify(funil.atividades)).toMatch(/Compra toda semana/);

    // Outra conta nunca vê os contatos que esta conta importou.
    const { visivel } = await import('../src/visibilidade.js');
    const contar = (conta: number) =>
      naConta(
        () =>
          pool
            .query(
              `SELECT count(*)::int AS n FROM enriquecimento.contatos c WHERE c.empresa_id = $1 AND ${visivel('c')}`,
              [emp[0].id],
            )
            .then((r) => r.rows[0].n as number),
        conta,
      );
    expect(await contar(1)).toBe(2);
    expect(await contar(2)).toBe(0);
    await pool.query(`DELETE FROM comercial.oportunidades WHERE empresa_id = ANY($1::bigint[])`, [
      emp.map((e: { id: number }) => e.id),
    ]);
  });

  it('lead à mão, conversa nova no WhatsApp e a IA que para quando a equipe responde pelo celular', async () => {
    const token = (await ler('/agente')).body.webhook.split('/').at(-1);
    const zap = (d: { phone: string; fromMe?: boolean; id: string; texto: string; nome?: string }) =>
      request(app)
        .post(`/webhooks/whatsapp/${token}`)
        .send({
          type: 'ReceivedCallback',
          phone: `55${d.phone}`,
          fromMe: !!d.fromMe,
          messageId: d.id,
          momment: Date.now(),
          senderName: d.nome ?? null,
          chatName: d.nome ?? null,
          text: { message: d.texto },
        });

    // 1) Lead à mão no quadro: entra no funil, com o contato só da conta e a observação como nota.
    const novo = await enviar('post', '/funil/leads', {
      empresa: 'Auto Peças Manual',
      contato: 'Carla Dias',
      telefone: '(71) 98877-1100',
      email: 'carla@manual.com.br',
      cidade: 'Salvador',
      agente: true,
      observacao: 'Indicado pelo Pedro',
    });
    expect(novo.status).toBe(201);
    const id = novo.body.empresaId;
    const op = (await ler(`/funil/${id}`)).body;
    expect(op.oportunidade).toMatchObject({ etapa: 'a_abordar', agente: true });
    expect(JSON.stringify(op.atividades)).toMatch(/Indicado pelo Pedro/);
    const ficha = (await ler(`/empresas/${id}`)).body;
    expect(ficha.uf).toBe('BA');
    expect(ficha.contatos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ canal: 'whatsapp', valor: '71988771100', fonte: 'manual' }),
      ]),
    );
    expect(ficha.pessoas[0]).toMatchObject({ nome: 'Carla Dias', decisor: true });
    const dup = await enviar('post', '/funil/leads', { empresa: 'Outro nome', telefone: '71 8877-1100' });
    expect(dup.status).toBe(409);
    expect(dup.body.erro.detalhes).toEqual({ empresaId: id });
    expect((await ler('/campanhas')).body.some((c: { tipo: string }) => c.tipo === 'manual')).toBe(true);

    // 2) A IA tinha preparado uma resposta. O eco de uma mensagem do sistema (mesmo texto, há pouco)
    // não conta como a equipe; a mensagem escrita no celular pausa a IA e descarta o rascunho.
    await pool.query(
      `INSERT INTO comercial.mensagens (conta_id, empresa_id, direcao, texto, telefone, status, origem)
       VALUES (1, $1, 'enviada', 'Rascunho da IA', '71988771100', 'rascunho', 'agente')`,
      [id],
    );
    await pool.query(
      `INSERT INTO comercial.mensagens (conta_id, empresa_id, direcao, texto, telefone, status, origem, enviado_em)
       VALUES (1, $1, 'enviada', 'Oi, Carla! Tudo bem?', '71988771100', 'enviada', 'cadencia', now())`,
      [id],
    );
    expect(
      (await zap({ phone: '71988771100', fromMe: true, id: 'eco-1', texto: 'Oi, Carla! Tudo bem?' })).status,
    ).toBe(200);
    expect((await ler(`/funil/${id}`)).body.oportunidade.agentePausa).toBeNull();
    await zap({
      phone: '71988771100',
      fromMe: true,
      id: 'cel-1',
      texto: 'Carla, aqui é a Ana. Te ligo às 15h?',
    });
    expect((await ler(`/funil/${id}`)).body.oportunidade.agentePausa).toBe('Você respondeu pelo celular.');
    const { rows: msgs } = await pool.query(
      `SELECT texto, status, origem, id_externo FROM comercial.mensagens WHERE empresa_id = $1 ORDER BY id`,
      [id],
    );
    expect(msgs).toEqual([
      expect.objectContaining({ texto: 'Rascunho da IA', status: 'descartada' }),
      expect.objectContaining({ texto: 'Oi, Carla! Tudo bem?', id_externo: 'eco-1' }),
      expect.objectContaining({
        texto: 'Carla, aqui é a Ana. Te ligo às 15h?',
        origem: 'humano',
        status: 'enviada',
      }),
    ]);

    // 3) Número que não é lead escreve: espera em Não identificados; "Criar lead" traz a conversa.
    expect((await ler('/conversas/conversa-nova')).body).toEqual({ modo: 'perguntar' });
    await zap({
      phone: '75991112222',
      id: 'desc-1',
      texto: 'Boa tarde, vocês entregam em Feira?',
      nome: 'Rogério',
    });
    const naoId = () => ler('/conversas/nao-identificados').then((r) => r.body as { telefone: string }[]);
    expect((await naoId()).some((n) => n.telefone === '75991112222')).toBe(true);
    const criado = await enviar('post', '/funil/leads', {
      empresa: 'Rogério Peças',
      contato: 'Rogério',
      telefone: '75991112222',
      telefoneConversa: '75991112222',
    });
    expect(criado.status).toBe(201);
    expect((await naoId()).some((n) => n.telefone === '75991112222')).toBe(false);
    expect(JSON.stringify((await ler(`/conversas/${criado.body.empresaId}`)).body)).toMatch(
      /vocês entregam em Feira/,
    );
    expect((await ler(`/funil/${criado.body.empresaId}`)).body.oportunidade.etapa).toBe('respondeu');

    // 4) A conta escolheu: conversa nova no WhatsApp já vira lead (o estado vem do DDD).
    expect((await enviar('put', '/conversas/conversa-nova', { modo: 'criar_lead' })).body).toEqual({
      modo: 'criar_lead',
    });
    await zap({ phone: '11955554444', id: 'novo-1', texto: 'Quero uma cotação', nome: 'Marta Lima' });
    const { rows: marta } = await pool.query(
      `SELECT e.id::int, e.uf, o.etapa, o.agente FROM descoberta.empresas e
         JOIN comercial.oportunidades o ON o.empresa_id = e.id AND o.conta_id = 1
        WHERE e.nome = 'Marta Lima'`,
    );
    expect(marta[0]).toMatchObject({ uf: 'SP', etapa: 'respondeu', agente: false });
    await enviar('put', '/conversas/conversa-nova', { modo: 'perguntar' });

    await pool.query(`DELETE FROM comercial.oportunidades WHERE empresa_id = ANY($1::bigint[])`, [
      [id, criado.body.empresaId, marta[0].id],
    ]);
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
  it('planos: plano e módulos por conta, vaga de usuário, limite de leads e serviços travados', async () => {
    // Cliente novo já com o plano Start (2 usuários, 5 mil leads) e só o módulo de e-mail.
    const criada = await enviar('post', '/master/contas', {
      nome: 'Cliente Plano Teste',
      admin: { nome: 'Ana Admin', email: 'ana@clienteplano.com.br' },
      plano: { plano: 'start', modulos: ['email'] },
    });
    expect(criada.status).toBe(201);
    const contaId = criada.body.id as number;
    let p = (await ler(`/master/contas/${contaId}/plano`)).body;
    expect(p).toMatchObject({
      plano: 'start',
      usuarios: 2,
      leadsMes: 2000,
      modulos: ['email'],
      // Start R$ 497 + e-mail R$ 200 (no Start o e-mail é à parte).
      mensalidade: 697,
      uso: { usuarios: 1, leadsMes: 0 },
    });
    // A lista do master traz o plano de cada cliente.
    const lista = (await ler('/master/contas')).body;
    expect(lista.find((c: { id: number }) => c.id === contaId).plano.mensalidade).toBe(697);

    // Vaga de usuário: o 2º entra, o 3º não (até o master aumentar).
    expect(
      (
        await enviar('post', `/master/contas/${contaId}/usuarios`, {
          nome: 'Bia',
          email: 'bia@clienteplano.com.br',
          papel: 'sdr',
        })
      ).status,
    ).toBe(201);
    const terceiro = await enviar('post', `/master/contas/${contaId}/usuarios`, {
      nome: 'Caio',
      email: 'caio@clienteplano.com.br',
      papel: 'sdr',
    });
    expect(terceiro.status).toBe(422);
    expect(terceiro.body.erro.mensagem).toMatch(/permite 2 usuários/);

    // Personaliza: 3 usuários (1 adicional), 8 mil leads, WhatsApp + IA, mensalidade com desconto.
    expect(
      (
        await enviar('put', `/master/contas/${contaId}/plano`, {
          plano: 'start',
          limiteUsuarios: 3,
          limiteLeadsMes: 8000,
          modulos: ['agente_ia'],
        })
      ).status,
    ).toBe(422); // IA sem WhatsApp
    p = (
      await enviar('put', `/master/contas/${contaId}/plano`, {
        plano: 'start',
        limiteUsuarios: 3,
        limiteLeadsMes: 8000,
        modulos: ['whatsapp', 'agente_ia'],
        mensalidadeManual: 650,
      })
    ).body;
    expect(p).toMatchObject({
      usuarios: 3,
      leadsMes: 8000,
      // WhatsApp + Agente de IA saem pelo combo.
      mensalidadeCalculada: 497 + 59 + 6 * 20 + 999,
      mensalidade: 650,
    });
    expect(
      (
        await enviar('post', `/master/contas/${contaId}/usuarios`, {
          nome: 'Caio',
          email: 'caio@clienteplano.com.br',
          papel: 'sdr',
        })
      ).status,
    ).toBe(201);

    // Master gerencia os usuários do cliente: desativa e reativa (reativar respeita a vaga).
    const usuarios = (await ler(`/master/contas/${contaId}`)).body.usuarios as {
      id: number;
      email: string;
    }[];
    const caio = usuarios.find((u) => u.email === 'caio@clienteplano.com.br')!;
    expect((await enviar('patch', `/master/usuarios/${caio.id}`, { ativo: false })).status).toBe(200);
    expect(
      (await enviar('patch', `/master/usuarios/${caio.id}`, { papel: 'closer', ativo: true })).status,
    ).toBe(200);
    expect(
      (
        await enviar('post', `/master/contas/${contaId}/usuarios`, {
          nome: 'Davi',
          email: 'davi@clienteplano.com.br',
          papel: 'sdr',
        })
      ).status,
    ).toBe(422);

    // Limite de leads: leads que esperaram voltam para a fila quando há vaga.
    await pool.query(
      `INSERT INTO cadastro.campanhas (id, nome, nicho_id, cidades, conta_id)
       SELECT 9901, 'Campanha plano', nicho_id, cidades, $1 FROM cadastro.campanhas LIMIT 1
       ON CONFLICT (id) DO NOTHING`,
      [contaId],
    );
    await pool.query(
      `INSERT INTO descoberta.empresas (id, nome, cidade, uf) VALUES (9901, 'Lead Esperando', 'SALVADOR', 'BA') ON CONFLICT (id) DO NOTHING`,
    );
    await pool.query(
      `INSERT INTO enriquecimento.leads (empresa_id, campanha_id, status) VALUES (9901, 9901, 'limite')
       ON CONFLICT (empresa_id) DO UPDATE SET status = 'limite', campanha_id = 9901`,
    );
    expect((await ler(`/master/contas/${contaId}/plano`)).body.uso.leadsEsperando).toBe(1);
    const { conferirLimitesDeLeads } = await import('../src/modulos/plano/rotina.js');
    const antes = publicados.length;
    const fila = {
      publicar: async () => 'x',
      publicarVarios: async (nome: NomeJob, payloads: unknown[]) => {
        for (const payload of payloads) publicados.push({ nome, payload });
        return payloads.length;
      },
      cancelarPendentes: async () => 0,
      tamanhos: async () => ({}),
    };
    expect(
      await conferirLimitesDeLeads({ pool, log: criarLogger('teste', 'silent'), filas: fila as never }),
    ).toBe(1);
    expect(publicados.slice(antes)).toEqual([
      { nome: 'enriquecimento.solicitar', payload: { empresaId: 9901, campanhaId: 9901 } },
    ]);

    // Serviços: o que não está no plano fica desligado.
    const { servicosDe } = await import('../src/servicos.js');
    const cred = {
      contaId,
      places: null,
      ors: null,
      resend: { apiKey: 're_x', remetente: 'a@b.com', dominioRespostas: null, webhookSegredo: null },
      whatsapp: { parceiroToken: 'p', clientToken: null },
      ia: { provedor: 'deepseek', apiKey: 'sk-x', modelo: null, baseUrl: null },
      origem: { places: null, ors: null, resend: 'conta', whatsapp: 'plataforma', ia: 'conta' },
      erro: null,
    } as const;
    const semEmail = servicosDe({ ...cred, modulos: ['whatsapp', 'agente_ia'] } as never);
    expect([!!semEmail.email, !!semEmail.whatsapp, !!semEmail.ia]).toEqual([false, true, true]);
    const soEmail = servicosDe({ ...cred, modulos: ['email'] } as never);
    expect([!!soEmail.email, !!soEmail.whatsapp, !!soEmail.ia]).toEqual([true, false, false]);
    const semPlano = servicosDe({ ...cred, modulos: null } as never);
    expect([!!semPlano.email, !!semPlano.whatsapp, !!semPlano.ia]).toEqual([true, true, true]);

    await enviar('patch', `/master/contas/${contaId}`, { ativa: false });
  });
  it('nichos prontos: lista, aplica os escolhidos e não duplica', async () => {
    const lista = (await ler('/nichos/prontos')).body as { id: string; nome: string; jaTem: boolean }[];
    expect(lista.length).toBeGreaterThan(10);
    const r = await enviar('post', '/nichos/prontos', { ids: ['farmacias', 'oticas'] });
    expect(r.status).toBe(201);
    expect(r.body.criados).toBe(2);
    expect((await enviar('post', '/nichos/prontos', { ids: ['farmacias'] })).body.criados).toBe(0);
    const depois = (await ler('/nichos/prontos')).body as { id: string; jaTem: boolean }[];
    expect(depois.find((n) => n.id === 'farmacias')?.jaTem).toBe(true);
    const nichos = (await ler('/nichos')).body as { id: number; nome: string; cnaes: string[] }[];
    const farmacia = nichos.find((n) => n.nome === 'Farmácias e drogarias')!;
    expect(farmacia.cnaes).toContain('4771701');
    for (const n of nichos.filter((x) => ['Farmácias e drogarias', 'Óticas'].includes(x.nome)))
      await enviar('delete', `/nichos/${n.id}`);
  });
  it('site: pedido de demonstração cai no quadro de vendas do master (não no CRM)', async () => {
    expect(
      (await enviar('put', '/master/site/config', { whatsapp: '(71) 99955-7040', email: '' })).body,
    ).toEqual({ whatsapp: '5571999557040', email: null });
    expect((await request(app).get('/site/contato')).body).toEqual({
      whatsapp: '5571999557040',
      email: null,
    });

    const funilAntes = (await ler('/funil')).body;
    const ruim = await request(app)
      .post('/site/demonstracao')
      .set('Origin', 'https://site-qualquer.example')
      .send({ nome: 'Ana', empresa: 'Loja', whatsapp: '123' });
    expect(ruim.status).toBe(422);
    const pedir = (origem?: string) =>
      request(app)
        .post('/site/demonstracao')
        .set('Origin', 'https://site-qualquer.example')
        .send({
          ...(origem ? { origem } : {}),
          nome: 'Ana Souza',
          empresa: 'Autopeças Demonstração',
          whatsapp: '(71) 98888-1212',
          nicho: 'oficinas em Salvador',
          plano: 'Time',
          canal: 'whatsapp',
          site: '',
        });
    expect((await pedir()).status).toBe(200);
    // Pedir de novo com o mesmo número (agora pelo botão da apresentação) não cria outro card:
    // anota no que está aberto, dizendo de onde veio.
    expect((await pedir('apresentacao')).status).toBe(200);
    // Robô (campo-isca preenchido): responde ok e não grava.
    await request(app)
      .post('/site/demonstracao')
      .send({ nome: 'Robo', empresa: 'Spam', whatsapp: '71988881313', site: 'http://spam' });

    const painel = (await ler('/master/site')).body as {
      pedidos: { id: number; empresa: string; etapa: string; plano: string }[];
    };
    expect(painel.pedidos.map((p) => p.empresa)).toEqual(['Autopeças Demonstração']);
    const pedido = painel.pedidos[0]!;
    expect(pedido).toMatchObject({ plano: 'Time', etapa: 'novo' });
    expect((await ler('/master/site/novos')).body).toEqual({ novos: 1 });
    expect(JSON.stringify((await ler(`/master/site/pedidos/${pedido.id}`)).body)).toContain(
      'Pediu demonstração de novo pela apresentação comercial.',
    );
    // O funil da conta principal não mudou.
    expect((await ler('/funil')).body).toEqual(funilAntes);

    // Andar no quadro: etapa, demonstração e histórico.
    const demo = await enviar('patch', `/master/site/pedidos/${pedido.id}`, {
      etapa: 'demonstracao',
      demonstracaoEm: '2026-11-03T14:00:00-03:00',
    });
    expect(demo.status).toBe(200);
    expect(demo.body.etapa).toBe('demonstracao');
    await enviar('post', `/master/site/pedidos/${pedido.id}/notas`, { texto: 'Ligou e confirmou.' });
    const detalhe = (await ler(`/master/site/pedidos/${pedido.id}`)).body as {
      historico: { texto: string }[];
    };
    expect(detalhe.historico.map((h) => h.texto)).toEqual([
      'Ligou e confirmou.',
      expect.stringContaining('Novo pedido → Demonstração marcada'),
      expect.stringContaining('Pediu demonstração de novo'),
      expect.stringContaining('Pedido pelo site'),
    ]);
    // Virou cliente: liga à conta criada.
    const conta = (await ler('/master/contas')).body.find((c: { principal: boolean }) => !c.principal);
    const fechado = await enviar('patch', `/master/site/pedidos/${pedido.id}`, {
      etapa: 'cliente',
      contaId: conta.id,
    });
    expect(fechado.body).toMatchObject({ etapa: 'cliente', contaId: conta.id });
    expect((await ler('/master/site/novos')).body).toEqual({ novos: 0 });

    // Pedido à mão.
    const mao = await enviar('post', '/master/site/pedidos', {
      nome: 'João',
      empresa: 'Indicação Peças',
      whatsapp: '71 98888-3434',
      plano: 'Escala',
    });
    expect(mao.status).toBe(201);
    expect((await enviar('delete', `/master/site/pedidos/${mao.body.id}`)).status).toBe(204);
  });

  it('painel da plataforma: visão geral, consumo e custo por cliente, custos unitários e operação', async () => {
    const visao = await ler('/master/plataforma/visao');
    expect(visao.status).toBe(200);
    expect(visao.body.receita).toMatchObject({ mrr: expect.any(Number), clientesAtivos: expect.any(Number) });
    expect(visao.body.vendas.porEtapa.cliente).toBeGreaterThanOrEqual(1);

    const clientes = (await ler('/master/plataforma/clientes')).body as {
      clientes: { id: number; principal: boolean; custo: { total: number; infra: number }; saude: string }[];
    };
    expect(clientes.clientes.find((c) => c.principal)?.custo.infra).toBe(0);

    const custos = (await ler('/master/plataforma/custos')).body;
    expect(custos.serperMil).toBeGreaterThan(0);
    const salvo = await enviar('put', '/master/plataforma/custos', { ...custos, infraMes: 0, serperMil: 10 });
    expect(salvo.body).toMatchObject({ infraMes: 0, serperMil: 10 });
    expect((await enviar('put', '/master/plataforma/custos', { ...custos, dolar: -1 })).status).toBe(422);

    const op = await ler('/master/plataforma/operacao');
    expect(op.status).toBe(200);
    expect(op.body.enriquecimentoPorDia).toHaveLength(14);
  });
  it('organização: gestor com várias unidades, cota de leads, pessoas, leitura e uma empresa por unidade', async () => {
    const criada = await enviar('post', '/master/contas', {
      nome: 'Rede Nacional Teste',
      unidade: 'Bahia',
      primeiroAcesso: 'gestor',
      admin: { nome: 'Gil Gestor', email: 'gil@redenacional.com.br' },
      plano: { plano: 'escala', modulos: ['email'] },
    });
    expect(criada.status).toBe(201);
    const bahia = criada.body.id as number;
    const orgId = criada.body.organizacaoId as number;

    const entrarPorConvite = async (convite: string, senha: string) => {
      const r = await request(app)
        .post(`/auth/convite/${convite.split('/').at(-1)}`)
        .set('Origin', ORIGEM)
        // Outro endereço: o limite de tentativas de login é por IP.
        .set('X-Forwarded-For', `10.9.0.${senha.length}`)
        .send({ senha });
      expect(r.status).toBe(200);
      const pessoa = { cookie: (r.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]! };
      const trocar = <T extends { headers: Record<string, unknown> }>(res: T): T => {
        const c = res.headers['set-cookie'] as string[] | undefined;
        if (c?.[0]) pessoa.cookie = c[0].split(';')[0]!;
        return res;
      };
      return {
        ler: (rota: string) => request(app).get(rota).set('Cookie', pessoa.cookie),
        enviar: async (metodo: 'post' | 'put' | 'patch' | 'delete', rota: string, corpo?: object) =>
          trocar(
            await request(app)[metodo](rota).set('Origin', ORIGEM).set('Cookie', pessoa.cookie).send(corpo),
          ),
      };
    };
    const gil = await entrarPorConvite(criada.body.convite, 'senha-do-gil-1');
    expect((await gil.ler('/auth/eu')).body).toMatchObject({
      papel: 'admin',
      papelOrganizacao: 'gestor',
      organizacao: { id: orgId, nome: 'Rede Nacional Teste', unidades: 1 },
    });

    // Unidades e cotas (somadas não passam do plano: Escala = 10 mil leads).
    const pe = await gil.enviar('post', '/organizacao/unidades', { nome: 'Pernambuco', cotaLeadsMes: 4000 });
    expect(pe.status).toBe(201);
    const demais = await gil.enviar('post', '/organizacao/unidades', { nome: 'Ceará', cotaLeadsMes: 7000 });
    expect(demais.status).toBe(422);
    expect(demais.body.erro.mensagem).toMatch(/cotas somadas/);
    const org = (await gil.ler('/organizacao')).body;
    expect(org.plano).toMatchObject({ plano: 'escala', leadsMes: 10000, uso: { usuarios: 1 } });
    expect(org.unidades.map((u: { nome: string }) => u.nome)).toEqual(['Bahia', 'Pernambuco']);

    // Pessoas: SDR em Pernambuco e um acesso só de leitura (diretoria).
    const sdr = await gil.enviar('post', '/organizacao/pessoas', {
      nome: 'Sara SDR',
      email: 'sara@redenacional.com.br',
      papel: 'sdr',
      unidadeId: pe.body.id,
    });
    expect(sdr.status).toBe(201);
    const dir = await gil.enviar('post', '/organizacao/pessoas', {
      nome: 'Diana Diretoria',
      email: 'diana@redenacional.com.br',
      papel: 'leitura',
      unidadeId: bahia,
    });
    expect(dir.status).toBe(201);
    // Ninguém de fora da organização.
    expect(
      (
        await gil.enviar('post', '/organizacao/pessoas', {
          nome: 'Intruso',
          email: 'x@y.com.br',
          papel: 'sdr',
          unidadeId: 1,
        })
      ).status,
    ).toBe(404);

    // Uma empresa, uma unidade: a Bahia cadastra; Pernambuco não consegue a mesma.
    await gil.enviar('post', '/nichos/prontos', { ids: ['farmacias'] });
    const lead = await gil.enviar('post', '/funil/leads', {
      empresa: 'Farmácia Única Teste',
      cnpj: '11.222.333/0001-81',
    });
    expect(lead.status).toBe(201);
    expect((await gil.enviar('post', `/organizacao/unidades/${pe.body.id}/entrar`)).status).toBe(200);
    expect((await gil.ler('/auth/eu')).body.conta).toMatchObject({ id: pe.body.id, nome: 'Pernambuco' });
    await gil.enviar('post', '/nichos/prontos', { ids: ['farmacias'] });
    const repetido = await gil.enviar('post', '/funil/leads', {
      empresa: 'Farmácia Única Teste',
      cnpj: '11222333000181',
    });
    expect(repetido.status).toBe(409);
    expect(repetido.body.erro.mensagem).toMatch(/unidade Bahia/);
    // Fora da organização, não entra.
    expect((await gil.enviar('post', '/organizacao/unidades/1/entrar')).status).toBe(404);
    await gil.enviar('post', '/organizacao/voltar');
    expect((await gil.ler('/auth/eu')).body.conta.id).toBe(bahia);

    // Leitura: vê tudo, não muda nada (mas troca de unidade).
    const diana = await entrarPorConvite(dir.body.convite, 'senha-da-diana-1');
    expect((await diana.ler('/organizacao')).status).toBe(200);
    expect((await diana.ler('/funil')).status).toBe(200);
    const bloqueado = await diana.enviar('post', '/funil/leads', { empresa: 'Qualquer' });
    expect(bloqueado.status).toBe(403);
    expect(bloqueado.body.erro.codigo).toBe('somente_leitura');
    expect((await diana.enviar('post', `/organizacao/unidades/${pe.body.id}/entrar`)).status).toBe(200);

    // O gestor não se desativa; move a SDR para a Bahia.
    const eu = (await gil.ler('/auth/eu')).body.id;
    expect((await gil.enviar('patch', `/organizacao/pessoas/${eu}`, { ativo: false })).status).toBe(422);
    expect(
      (await gil.enviar('patch', `/organizacao/pessoas/${sdr.body.id}`, { unidadeId: bahia })).status,
    ).toBe(200);
    const depois = (await gil.ler('/organizacao')).body;
    expect(depois.pessoas.find((p: { id: number }) => p.id === sdr.body.id).unidadeNome).toBe('Bahia');
    // A equipe da unidade não mostra gestor nem leitura.
    expect((await gil.ler('/equipe')).body.usuarios.map((u: { papel: string }) => u.papel).sort()).toEqual([
      'sdr',
    ]);

    // Painel do gestor e o relatório em PDF.
    const painel = (await gil.ler('/organizacao/painel?dias=30')).body;
    expect(painel.periodo.rotulo).toBe('Últimos 30 dias');
    expect(painel.unidades.map((u: { nome: string }) => u.nome)).toEqual(['Bahia', 'Pernambuco']);
    expect(painel.totais).toMatchObject({ noFunil: 1, leads: 0 });
    expect(painel.pessoas.map((p: { nome: string }) => p.nome)).toContain('Sara SDR');
    expect((await gil.ler('/organizacao/painel?mes=2026-01')).body.periodo.rotulo).toBe('Janeiro de 2026');
    const pdf = await gil.ler('/organizacao/relatorio.pdf?dias=30');
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toMatch(/relatorio-rede-nacional-teste-ultimos-30-dias\.pdf/);
    expect((await diana.ler('/organizacao/relatorio.pdf')).status).toBe(200);

    // O master vê o cliente com as duas unidades e o plano vale para elas.
    const orgs = (await ler('/master/organizacoes')).body as { id: number; unidades: { nome: string }[] }[];
    expect(orgs.find((o) => o.id === orgId)?.unidades.map((u) => u.nome)).toEqual(['Bahia', 'Pernambuco']);
    expect((await ler(`/master/contas/${pe.body.id}/plano`)).body).toMatchObject({
      plano: 'escala',
      unidade: { cota: 4000 },
    });
    await enviar('patch', `/master/organizacoes/${orgId}`, { ativa: false });
    expect((await gil.ler('/auth/eu')).status).toBe(401);
  });
  it('segurança: duas etapas, sessões, termos, marca do cliente e LGPD (exportar e esquecer)', async () => {
    const { codigo, decifrarSegredo } = await import('../src/totp.js');
    const criada = await enviar('post', '/master/contas', {
      nome: 'Cliente Seguro Teste',
      primeiroAcesso: 'gestor',
      admin: { nome: 'Sol Gestora', email: 'sol@clienteseguro.com.br' },
      // Escala: duas etapas obrigatória e marca própria são deste plano.
      plano: { plano: 'escala', modulos: [] },
    });
    const tokenConvite = criada.body.convite.split('/').at(-1);
    const ip = '10.9.1.1';
    const aceite = await request(app)
      .post(`/auth/convite/${tokenConvite}`)
      .set('Origin', ORIGEM)
      .set('X-Forwarded-For', ip)
      .send({ senha: 'senha-da-sol-1' });
    let ck = (aceite.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    const sol = {
      ler: (rota: string) => request(app).get(rota).set('Cookie', ck),
      enviar: (metodo: 'post' | 'put' | 'patch' | 'delete', rota: string, corpo?: object) =>
        request(app)[metodo](rota).set('Origin', ORIGEM).set('Cookie', ck).send(corpo),
    };
    const eu = (await sol.ler('/auth/eu')).body;
    expect(eu.termos).toEqual({ versao: '2026-10', aceitos: false });
    expect(eu.duasEtapas).toEqual({ ativo: false, exigido: false });
    expect((await sol.enviar('post', '/auth/termos', { versao: '2026-10' })).status).toBe(200);
    expect((await sol.ler('/auth/eu')).body.termos.aceitos).toBe(true);

    // Sessões: a do convite aparece como a atual.
    const sessoes = (await sol.ler('/auth/sessoes')).body as { id: string; atual: boolean }[];
    expect(sessoes).toHaveLength(1);
    expect(sessoes[0]!.atual).toBe(true);

    // Exigir duas etapas sem ter ligado na própria conta: não deixa.
    expect((await sol.enviar('put', '/organizacao/seguranca', { exigirDuasEtapas: true })).status).toBe(422);

    // Liga as duas etapas.
    const ini = (await sol.enviar('post', '/auth/duas-etapas/iniciar')).body;
    expect(ini.endereco).toMatch(/^otpauth:\/\/totp\//);
    expect(ini.qr).toMatch(/<svg/);
    expect((await sol.enviar('post', '/auth/duas-etapas/ativar', { codigo: '000000' })).status).toBe(422);
    const ativou = await sol.enviar('post', '/auth/duas-etapas/ativar', { codigo: codigo(ini.segredo) });
    expect(ativou.status).toBe(200);
    expect(ativou.body.codigos).toHaveLength(8);
    // O segredo fica cifrado no banco.
    const guardado = await pool.query<{ totp_segredo: string }>(
      `SELECT totp_segredo FROM cadastro.usuarios WHERE email = 'sol@clienteseguro.com.br'`,
    );
    expect(guardado.rows[0]!.totp_segredo).not.toContain(ini.segredo);
    expect(decifrarSegredo('x'.repeat(40), guardado.rows[0]!.totp_segredo).length).toBeGreaterThan(0);
    expect((await sol.enviar('put', '/organizacao/seguranca', { exigirDuasEtapas: true })).status).toBe(200);

    // Login agora pede o código.
    const login = await request(app)
      .post('/auth/login')
      .set('Origin', ORIGEM)
      .set('X-Forwarded-For', '10.9.1.2')
      .send({ email: 'sol@clienteseguro.com.br', senha: 'senha-da-sol-1' });
    expect(login.body.duasEtapas).toBe(true);
    expect(login.headers['set-cookie']).toBeUndefined();
    const errado = await request(app)
      .post('/auth/login/duas-etapas')
      .set('Origin', ORIGEM)
      .set('X-Forwarded-For', '10.9.1.2')
      .send({ desafio: login.body.desafio, codigo: '123456' });
    expect(errado.status).toBe(401);
    // Código de recuperação vale uma vez só.
    const rec = await request(app)
      .post('/auth/login/duas-etapas')
      .set('Origin', ORIGEM)
      .set('X-Forwarded-For', '10.9.1.2')
      .send({ desafio: login.body.desafio, codigo: ativou.body.codigos[0] });
    expect(rec.status).toBe(200);
    const ck2 = (rec.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    const deNovo = await request(app)
      .post('/auth/login/duas-etapas')
      .set('Origin', ORIGEM)
      .set('X-Forwarded-For', '10.9.1.3')
      .send({ desafio: login.body.desafio, codigo: ativou.body.codigos[0] });
    expect(deNovo.status).toBe(401);
    expect((await sol.ler('/auth/sessoes')).body).toHaveLength(2);
    // Encerrar as outras derruba o segundo aparelho na hora.
    expect((await sol.enviar('post', '/auth/sessoes/encerrar-outras')).body.encerradas).toBe(1);
    expect((await request(app).get('/auth/eu').set('Cookie', ck2)).status).toBe(401);

    // Pessoa nova numa organização que exige duas etapas: só a conta funciona até configurar.
    const pessoa = await sol.enviar('post', '/organizacao/pessoas', {
      nome: 'Rui SDR',
      email: 'rui@clienteseguro.com.br',
      papel: 'sdr',
      unidadeId: criada.body.id,
    });
    const rui = await request(app)
      .post(`/auth/convite/${pessoa.body.convite.split('/').at(-1)}`)
      .set('Origin', ORIGEM)
      .set('X-Forwarded-For', '10.9.1.4')
      .send({ senha: 'senha-do-rui-1' });
    const ckRui = (rui.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    const bloqueado = await request(app).get('/funil').set('Cookie', ckRui);
    expect(bloqueado.status).toBe(403);
    expect(bloqueado.body.erro.codigo).toBe('configurar_duas_etapas');
    expect((await request(app).get('/auth/eu').set('Cookie', ckRui)).status).toBe(200);
    // O gestor zera as duas etapas de alguém (celular perdido).
    expect(
      (await sol.enviar('post', `/organizacao/pessoas/${pessoa.body.id}/zerar-duas-etapas`)).status,
    ).toBe(200);

    // Marca do cliente.
    expect((await sol.enviar('put', '/organizacao/marca', { cor: '#f5f5a0' })).status).toBe(422);
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    expect(
      (await sol.enviar('put', '/organizacao/marca', { logo: 'data:image/png;base64,PHN2Zz4=' })).status,
    ).toBe(422);
    const marcou = await sol.enviar('put', '/organizacao/marca', {
      nome: 'Seguro Peças',
      cor: '#1d4ed8',
      logo: `data:image/png;base64,${png.toString('base64')}`,
    });
    expect(marcou.status).toBe(200);
    const comMarca = (await sol.ler('/auth/eu')).body.marca;
    expect(comMarca).toMatchObject({ nome: 'Seguro Peças', cor: '#1d4ed8' });
    const logo = await sol.ler('/organizacao/marca/logo');
    expect(logo.headers['content-type']).toBe('image/png');
    const pdf = await sol.ler('/organizacao/relatorio.pdf');
    expect(pdf.status).toBe(200);

    // LGPD: exportar e esquecer.
    await sol.enviar('post', '/nichos/prontos', { ids: ['farmacias'] });
    const lead = await sol.enviar('post', '/funil/leads', {
      empresa: 'Farmácia Titular Teste',
      telefone: '71 98888-4545',
    });
    expect(lead.status).toBe(201);
    const exp = await sol.ler('/lgpd/exportar');
    expect(exp.status).toBe(200);
    expect(exp.headers['content-disposition']).toMatch(/dados-unidade-/);
    const dados = JSON.parse(exp.text);
    expect(dados.negociacoes).toHaveLength(1);
    expect(
      (
        await sol.enviar('post', '/lgpd/esquecer', {
          empresaId: lead.body.empresaId,
          pedidoPor: 'e-mail do titular',
        })
      ).status,
    ).toBe(200);
    expect((await sol.ler(`/funil/${lead.body.empresaId}`)).body.oportunidade).toBeNull();
    expect((await sol.ler('/lgpd/supressoes')).body).toEqual([
      expect.objectContaining({ empresaId: lead.body.empresaId, pedidoPor: 'e-mail do titular' }),
    ]);
    // Não volta à mão.
    const volta = await sol.enviar('post', '/funil/leads', {
      empresa: 'Farmácia Titular Teste',
      telefone: '71 98888-4545',
    });
    expect(volta.status).toBe(409);

    // Logout encerra a sessão no servidor.
    await sol.enviar('post', '/auth/logout');
    expect((await sol.ler('/auth/eu')).status).toBe(401);
    ck = '';
  });

  it('número de uso diário: conversa de antes fica só no celular; quem é novo segue a regra do número', async () => {
    const { rows: cfg } = await pool.query(
      'SELECT webhook_token FROM comercial.config_agente WHERE conta_id = 1',
    );
    const token = cfg[0].webhook_token;
    const { rows: ch } = await pool.query(
      `INSERT INTO comercial.chips (conta_id, nome, instancia, uso_diario, contato_novo)
       VALUES (1, 'Dia a dia', 'inst-dia-a-dia', true, 'ignorar') RETURNING id`,
    );
    const chipId = ch[0].id;
    await pool.query(
      `INSERT INTO comercial.contatos_antigos (conta_id, chip_id, telefone, nome, origem) VALUES (1, $1, '5571977770001', 'Cliente antigo', 'conversa')`,
      [chipId],
    );
    const zap = (phone: string, id: string, texto: string, fromMe = false) =>
      request(app)
        .post(`/webhooks/whatsapp/${token}`)
        .send({
          type: 'ReceivedCallback',
          instanceId: 'inst-dia-a-dia',
          phone: `55${phone}`,
          fromMe,
          messageId: id,
          momment: Date.now(),
          senderName: 'Fulano',
          text: { message: texto },
        });
    const naoIdent = async (fone: string) =>
      (
        await pool.query(
          `SELECT count(*)::int AS n FROM comercial.nao_identificadas WHERE conta_id = 1 AND right(telefone, 8) = $1`,
          [fone.slice(-8)],
        )
      ).rows[0].n;
    try {
      // Conversa de antes (com e sem o 9 a mais): nada entra no CRM.
      expect((await zap('71977770001', 'antigo-1', 'Oi, tudo certo para amanhã?')).status).toBe(200);
      expect(await naoIdent('71977770001')).toBe(0);
      // Contato novo, regra "ignorar": não entra e vira "de antes".
      await zap('71966660002', 'novo-1', 'Boa tarde');
      expect(await naoIdent('71966660002')).toBe(0);
      const { rows: ign } = await pool.query(
        `SELECT origem FROM comercial.contatos_antigos WHERE chip_id = $1 AND telefone LIKE '%66660002'`,
        [chipId],
      );
      expect(ign[0]?.origem).toBe('ignorado');
      // A equipe puxou conversa pelo celular com alguém que não é lead: também fica só no celular.
      await zap('71955550003', 'eu-1', 'Fala, João! Passo aí amanhã', true);
      expect(await naoIdent('71955550003')).toBe(0);
      // Trazido para o CRM: segue o fluxo normal (regra do número agora "Sem lead").
      await pool.query(`UPDATE comercial.chips SET contato_novo = 'sem_lead' WHERE id = $1`, [chipId]);
      await pool.query(
        `UPDATE comercial.contatos_antigos SET trazido_em = now() WHERE chip_id = $1 AND telefone = '5571977770001'`,
        [chipId],
      );
      await zap('71977770001', 'antigo-2', 'Pode me mandar o catálogo?');
      expect(await naoIdent('71977770001')).toBe(1);
      // Número que não é de uso diário: regra da conta (conversa nova cai em "Sem lead").
      await pool.query(`UPDATE comercial.chips SET uso_diario = false WHERE id = $1`, [chipId]);
      await zap('71944440004', 'novo-2', 'Quero saber de vocês');
      expect(await naoIdent('71944440004')).toBe(1);
    } finally {
      await pool.query('DELETE FROM comercial.nao_identificadas WHERE conta_id = 1 AND chip_id = $1', [
        chipId,
      ]);
      await pool.query('DELETE FROM comercial.chips WHERE id = $1', [chipId]);
    }
  });
});
