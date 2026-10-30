import { criarPool, migrar, type Pool } from '@prospeccao/db';
import { bancoDeTeste } from '@prospeccao/db/teste';
import type { Armazenamento } from '@prospeccao/integrations/reuniao';
import { criarLogger, diaEmSaoPaulo, matrizEstimada } from '@prospeccao/shared';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../src/app.js';
import type { ServicosConta } from '../src/servicos.js';

const URL_TESTE = process.env.TEST_DATABASE_URL;
const ORIGEM = 'http://localhost:5173';
const SEGREDO = 'r'.repeat(40);

/** Escritório no centro de Salvador e seis clínicas por perto (uma sem localização). */
const ESCRITORIO = { rotulo: 'Escritório', lat: -12.9777, lng: -38.5016 };
const CLINICAS = [
  { id: 701, nome: 'Clínica Sorriso Atlântico', lat: -12.9871, lng: -38.4743, faixa: 'A', score: 88 },
  { id: 702, nome: 'OdontoPrime Itaigara', lat: -12.9872, lng: -38.4567, faixa: 'A', score: 81 },
  { id: 703, nome: 'Instituto Dental das Árvores', lat: -12.9952, lng: -38.4497, faixa: 'B', score: 64 },
  { id: 704, nome: 'Clínica Bem Sorrir', lat: -13.0019, lng: -38.4559, faixa: 'B', score: 61 },
  { id: 705, nome: 'Dentalis Imbuí', lat: -12.9725, lng: -38.4339, faixa: 'C', score: 30 },
  { id: 706, nome: 'Odonto Sem Mapa', lat: null, lng: null, faixa: 'A', score: 90 },
] as const;

describe.skipIf(!URL_TESTE)('vendas na rua (com Postgres)', () => {
  let pool: Pool;
  let app: ReturnType<typeof criarApp>;
  let cookieDona = '';
  let cookieAna = '';
  let ana = 0;
  const arquivos = new Map<string, Uint8Array>();
  let rotasLigadas = false;
  let pedidosRotas = 0;
  let respostaIa = '';

  const servicos = async (contaId: number): Promise<ServicosConta> => ({
    contaId,
    whatsapp: null,
    ia: null,
    classificarEmail: null,
    personalizarAbertura: null,
    email: null,
    assistente: respostaIa ? async () => respostaIa : null,
    geocodificar: async (e) => (e.includes('Pituba') ? { lat: -13.0, lng: -38.46 } : null),
    rotas: rotasLigadas
      ? {
          async matriz(pontos) {
            pedidosRotas++;
            const m = matrizEstimada(pontos);
            // "Pelas ruas": um pouco mais que a estimativa; um par sem caminho.
            const minutos = m.minutos.map((l) => l.map((v) => v * 1.1)) as (number | null)[][];
            minutos[0]![1] = null;
            return { minutos, km: m.km };
          },
          async tracado(pontos) {
            return { linha: pontos.map((p) => [p.lat, p.lng] as [number, number]), km: 1, minutos: 1 };
          },
        }
      : null,
    origem: { places: null, ors: null, resend: null, whatsapp: null, ia: null },
    iaDescricao: null,
    erro: null,
  });

  const armazenamento = {
    destino: { endpoint: 'https://arm', regiao: 'auto', bucket: 'b', chave: 'k', segredo: 's'.repeat(10) },
    async urlAssinada(chave: string) {
      return `https://arm/b/${chave}`;
    },
    async apagar(chaves: string[]) {
      for (const k of chaves) arquivos.delete(k);
    },
    async enviar(chave: string, corpo: Uint8Array) {
      arquivos.set(chave, corpo);
    },
  } as unknown as Armazenamento;

  const log = criarLogger('teste', (process.env.LOG_TESTE as 'error') ?? 'silent');
  const hoje = diaEmSaoPaulo();

  const enviar = (cookie: string, metodo: 'post' | 'put' | 'delete', rota: string, corpo?: object) =>
    request(app)[metodo](rota).set('Origin', ORIGEM).set('Cookie', cookie).send(corpo);
  const ler = (cookie: string, rota: string) => request(app).get(rota).set('Cookie', cookie);

  const config = (extra: object = {}) => ({
    dia: hoje,
    campanhaId: 700,
    faixas: ['A', 'B'],
    situacoes: ['nunca', 'negociacao'],
    partida: ESCRITORIO,
    inicio: '08:30',
    fim: '17:30',
    minutosVisita: 30,
    almoco: { inicio: '12:00', minutos: 60 },
    raioKm: 15,
    ...extra,
  });

  async function entrar(email: string, senha: string) {
    const ok = await request(app).post('/auth/login').set('Origin', ORIGEM).send({ email, senha });
    expect(ok.status).toBe(200);
    return (ok.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
  }

  beforeAll(async () => {
    pool = criarPool({ url: await bancoDeTeste(URL_TESTE!, 'rua'), aplicacao: 'teste-rua', max: 4 });
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
        jwtSegredo: SEGREDO,
        adminEmail: 'dona@exemplo.com',
        adminSenhaHash: await bcrypt.hash('senha-forte-123', 4),
        sessaoHoras: 1,
        cookieSeguro: false,
      },
      origens: [ORIGEM],
      servicos,
      credenciais: { chave: null, ambiente: {}, invalidar() {} },
      reunioes: { video: null, armazenamento, transcricao: null },
    });
    cookieDona = await entrar('dona@exemplo.com', 'senha-forte-123');
    ana = (
      await pool.query<{ id: number }>(
        `INSERT INTO cadastro.usuarios (nome, email, senha_hash, papel, conta_id, termos_versao, termos_aceitos_em)
         VALUES ('Ana Paula Rocha', 'ana@exemplo.com', $1, 'sdr', 1, '2026-10', now()) RETURNING id`,
        [await bcrypt.hash('senha-da-ana-123', 4)],
      )
    ).rows[0]!.id;
    cookieAna = await entrar('ana@exemplo.com', 'senha-da-ana-123');

    const nicho = await pool.query<{ id: number }>(
      `INSERT INTO cadastro.nichos (conta_id, nome, cnaes, termos_maps) VALUES (1, 'Clínicas odontológicas', '{8630504}', '{dentista}')
       RETURNING id`,
    );
    await pool.query(
      `INSERT INTO cadastro.campanhas (id, conta_id, nome, nicho_id, cidades)
       VALUES (700, 1, 'Clínicas odontológicas · Salvador', $1, '[{"nome":"Salvador","uf":"BA"}]')`,
      [nicho.rows[0]!.id],
    );
    for (const c of CLINICAS) {
      await pool.query(
        `INSERT INTO descoberta.empresas (id, nome, cidade, uf, lat, lng, logradouro, numero, bairro, maps_telefone)
         VALUES ($1, $2, 'SALVADOR', 'BA', $3, $4, 'Rua das Hortênsias', '220', 'Stiep', '7133330000')`,
        [c.id, c.nome, c.lat, c.lng],
      );
      await pool.query(
        `INSERT INTO descoberta.campanha_empresas (campanha_id, empresa_id, origem, liberado_em) VALUES (700, $1, 'maps', now())`,
        [c.id],
      );
      await pool.query(
        `INSERT INTO enriquecimento.leads (empresa_id, campanha_id, status, faixa, score, motivo, concluido_em)
         VALUES ($1, 700, 'concluido', $2, $3, 'teste', now())`,
        [c.id, c.faixa, c.score],
      );
    }
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('mostra o que está ligado e os leads da campanha no mapa', async () => {
    const e = await ler(cookieDona, '/rua/estado');
    expect(e.body).toMatchObject({ rotas: false, enderecos: true, fotos: true, voz: false, ia: false });

    const p = await ler(cookieDona, '/rua/pontos?campanhaId=700');
    expect(p.status).toBe(200);
    expect(p.body.semLocalizacao).toBe(1);
    expect(p.body.leads).toHaveLength(5);
    expect(p.body.leads[0]).toMatchObject({
      empresaId: 701,
      faixa: 'A',
      situacao: 'nunca',
      cidade: 'SALVADOR',
    });
    expect(p.body.leads[0].endereco).toBe('Rua das Hortênsias 220, Stiep');

    const end = await enviar(cookieDona, 'post', '/rua/endereco', { endereco: 'Av. Paulo VI, Pituba' });
    expect(end.body).toMatchObject({ rotulo: 'Av. Paulo VI, Pituba', lat: -13.0 });
    expect((await enviar(cookieDona, 'post', '/rua/endereco', { endereco: 'Lugar Nenhum' })).status).toBe(
      422,
    );
  });

  it('sugere o dia com as notas escolhidas, em ordem e com horários', async () => {
    const r = await enviar(cookieDona, 'post', '/rua/sugerir', config({ vendedorId: ana }));
    expect(r.status).toBe(200);
    expect(r.body.calculo).toBe('estimado');
    // Só A e B (a C e a sem mapa ficam de fora).
    const ids = r.body.paradas.map((p: { empresaId: number }) => p.empresaId).sort();
    expect(ids).toEqual([701, 702, 703, 704]);
    expect(r.body.paradas[0]).toMatchObject({ ordem: 1, almocoAntes: false });
    expect(r.body.paradas[0].chegada).toMatch(/^08:[3-5]\d$/);
    expect(r.body.km).toBeGreaterThan(3);
    expect(r.body.tracado).toHaveLength(5);
    expect(r.body).toMatchObject({ candidatos: 4, foraDoDia: 0, passouDoHorario: false });

    // Com o serviço de rotas, o cálculo é pelas ruas (o par sem caminho usa a estimativa).
    rotasLigadas = true;
    const ruas = await enviar(cookieDona, 'post', '/rua/sugerir', config({ faixas: ['A', 'B', 'C'] }));
    expect(ruas.body.calculo).toBe('ruas');
    expect(ruas.body.paradas).toHaveLength(5);
    expect(pedidosRotas).toBe(1);
    rotasLigadas = false;
  });

  it('quem não é administrador só planeja o próprio dia', async () => {
    const r = await enviar(cookieAna, 'post', '/rua/sugerir', config({ vendedorId: 1 }));
    expect(r.status).toBe(403);
    expect((await enviar(cookieAna, 'post', '/rua/sugerir', config())).status).toBe(200);
  });

  it('salva o roteiro montado, avisa o vendedor e o celular dele abre o dia', async () => {
    const r = await enviar(cookieDona, 'put', '/rua/roteiros', {
      config: config({ vendedorId: ana }),
      empresaIds: [704, 701, 703, 702],
      otimizar: true,
      enviar: true,
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      vendedorId: ana,
      vendedorNome: 'Ana Paula Rocha',
      campanhaNome: 'Clínicas odontológicas · Salvador',
    });
    expect(r.body.enviadoEm).toBeTruthy();
    // Otimizado: a ordem começa pelo mais perto do escritório.
    expect(r.body.paradas.map((p: { empresaId: number }) => p.empresaId)[0]).toBe(701);
    expect(r.body.paradas[0]).toMatchObject({ situacao: 'pendente', telefone: '7133330000' });

    const aviso = await pool.query(`SELECT titulo, link FROM comercial.notificacoes WHERE usuario_id = $1`, [
      ana,
    ]);
    expect(aviso.rows[0]).toMatchObject({ link: '/rua' });
    expect(aviso.rows[0].titulo).toContain('4 visitas');

    const meu = await ler(cookieAna, '/rua/hoje');
    expect(meu.body.paradas).toHaveLength(4);
    // O líder vê o roteiro salvo; e o lead já reservado não aparece para outro vendedor no mesmo dia.
    const outro = await ler(cookieDona, `/rua/pontos?campanhaId=700&dia=${hoje}`);
    expect(outro.body.leads.find((l: { empresaId: number }) => l.empresaId === 701).emOutroRoteiro).toBe(
      'Ana Paula Rocha',
    );
    const sugerido = await enviar(cookieDona, 'post', '/rua/sugerir', config());
    expect(sugerido.body.paradas).toHaveLength(0);
  });

  it('check-in, foto e conclusão: a visita vai para o histórico e o funil anda', async () => {
    const meu = (await ler(cookieAna, '/rua/hoje')).body;
    const primeira = meu.paradas[0];
    const ch = await enviar(cookieAna, 'post', `/rua/paradas/${primeira.id}/chegada`, {
      lat: primeira.lat + 0.0005,
      lng: primeira.lng,
      precisao: 12,
    });
    expect(ch.body.noEndereco).toBe(true);
    expect(ch.body.distanciaM).toBeGreaterThan(40);

    const foto = await request(app)
      .post(`/rua/paradas/${primeira.id}/foto`)
      .set('Origin', ORIGEM)
      .set('Cookie', cookieAna)
      .set('Content-Type', 'image/jpeg')
      .send(Buffer.alloc(2000, 1));
    expect(foto.status).toBe(201);
    expect([...arquivos.keys()][0]).toMatch(/^rua\/1\/\d+-\d+\.jpg$/);
    expect((await ler(cookieAna, `/rua/paradas/${primeira.id}/foto`)).body.url).toContain(
      'https://arm/b/rua/1/',
    );

    const fim = await enviar(cookieAna, 'post', `/rua/paradas/${primeira.id}/concluir`, {
      resultado: 'proposta',
      anotacao: 'Quer começar só na unidade da Pituba.',
      proximoPasso: 'Mandar proposta ajustada',
      proximoPassoEm: '2026-11-06',
    });
    expect(fim.body).toEqual({ etapa: 'proposta' });
    const op = await pool.query(
      `SELECT etapa, proxima_acao, proxima_acao_em FROM comercial.oportunidades WHERE conta_id = 1 AND empresa_id = $1`,
      [primeira.empresaId],
    );
    expect(op.rows[0]).toMatchObject({ etapa: 'proposta', proxima_acao: 'Mandar proposta ajustada' });
    expect(new Date(op.rows[0].proxima_acao_em).toISOString()).toBe('2026-11-06T12:00:00.000Z');
    const at = await pool.query(
      `SELECT texto, autor FROM comercial.atividades WHERE conta_id = 1 AND empresa_id = $1 AND tipo = 'visita'`,
      [primeira.empresaId],
    );
    expect(at.rows[0]).toMatchObject({ autor: 'Ana Paula Rocha' });
    expect(at.rows[0].texto).toBe('Visita: Pediu proposta.\nQuer começar só na unidade da Pituba.');

    // Concluída não aceita check-in de novo; e a dona não move a visita de outra unidade.
    expect((await enviar(cookieAna, 'post', `/rua/paradas/${primeira.id}/chegada`, {})).status).toBe(409);

    // Não estava: fica no funil como abordado. Sem interesse: perdido com o motivo.
    const [, segunda, terceira, quarta] = meu.paradas;
    await enviar(cookieAna, 'post', `/rua/paradas/${segunda.id}/concluir`, { resultado: 'nao_estava' });
    const sem = await enviar(cookieAna, 'post', `/rua/paradas/${terceira.id}/concluir`, {
      resultado: 'sem_interesse',
      proximoPasso: 'nada',
    });
    expect(sem.body.etapa).toBe('perdido');
    const etapas = await pool.query<{
      empresa_id: string;
      etapa: string;
      motivo: string | null;
      proxima_acao: string | null;
    }>(
      `SELECT empresa_id, etapa, motivo, proxima_acao FROM comercial.oportunidades WHERE conta_id = 1 AND empresa_id = ANY($1::bigint[])`,
      [[segunda.empresaId, terceira.empresaId]],
    );
    const porId = Object.fromEntries(etapas.rows.map((x) => [Number(x.empresa_id), x]));
    expect(porId[segunda.empresaId]).toMatchObject({ etapa: 'abordado' });
    expect(porId[terceira.empresaId]).toMatchObject({
      etapa: 'perdido',
      motivo: 'Sem interesse (visita)',
      proxima_acao: null,
    });

    // Pular e voltar.
    expect((await enviar(cookieAna, 'post', `/rua/paradas/${quarta.id}/pular`)).status).toBe(204);
    expect((await enviar(cookieAna, 'post', `/rua/paradas/${quarta.id}/reabrir`)).status).toBe(204);
    await enviar(cookieAna, 'post', `/rua/paradas/${quarta.id}/chegada`, {});
    const depois = (await ler(cookieAna, '/rua/hoje')).body;
    expect(depois.paradas.map((p: { situacao: string }) => p.situacao)).toEqual([
      'feita',
      'feita',
      'feita',
      'em_visita',
    ]);
    expect(depois.paradas[0]).toMatchObject({
      resultado: 'proposta',
      temFoto: true,
      proximoPassoEm: '2026-11-06',
    });
    expect(depois.paradas[0].historico[0].tipo).toBeTruthy();
  });

  it('replanejar mantém as visitas feitas; o roteiro com visitas não é apagado', async () => {
    const meu = (await ler(cookieAna, '/rua/hoje')).body;
    const r = await enviar(cookieDona, 'put', '/rua/roteiros', {
      config: config({ vendedorId: ana, faixas: ['A', 'B', 'C'] }),
      empresaIds: [704, 705],
    });
    expect(r.status).toBe(200);
    const situacoes = r.body.paradas.map(
      (p: { empresaId: number; situacao: string }) => `${p.empresaId}:${p.situacao}`,
    );
    expect(situacoes).toEqual(['704:em_visita', '705:pendente', '701:feita', '702:feita', '703:feita']);
    expect(r.body.paradas.map((p: { ordem: number }) => p.ordem)).toEqual([1, 2, 3, 4, 5]);
    expect((await enviar(cookieDona, 'delete', `/rua/roteiros/${meu.id}`)).status).toBe(409);
  });

  it('o gestor acompanha a equipe; o vendedor vê só os próprios números', async () => {
    const g = await ler(cookieDona, '/rua/equipe?periodo=hoje');
    expect(g.status).toBe(200);
    expect(g.body.numeros).toMatchObject({
      planejadas: 5,
      feitas: 3,
      comConversa: 2,
      propostasReunioes: 1,
      fechados: 0,
    });
    expect(g.body.vendedores[0]).toMatchObject({
      nome: 'Ana Paula Rocha',
      campanhas: ['Clínicas odontológicas · Salvador'],
      feitas: 3,
      total: 5,
      resultados: { proposta: 1, nao_estava: 1, sem_interesse: 1 },
    });
    expect(g.body.vendedores[0].agora).toMatchObject({
      tipo: 'em_visita',
      ordem: 1,
      empresa: 'Clínica Bem Sorrir',
    });
    expect(g.body.ultimas).toHaveLength(3);
    expect(g.body.ultimas.map((u: { resultado: string }) => u.resultado)).toContain('proposta');

    const dela = await ler(cookieAna, '/rua/equipe?periodo=semana');
    expect(dela.body.vendedores).toHaveLength(1);
  });

  it('sugere o próximo passo: padrão pelo resultado, ou lido da anotação pela IA', async () => {
    const p = await enviar(cookieAna, 'post', '/rua/sugestao-passo', { resultado: 'nao_estava' });
    expect(p.body).toMatchObject({ texto: 'Voltar para falar com quem decide', fonte: 'padrao' });
    expect(
      (await enviar(cookieAna, 'post', '/rua/sugestao-passo', { resultado: 'sem_interesse' })).body,
    ).toBeNull();

    respostaIa = '{"texto": "Mandar proposta ajustada", "dias_uteis": 2}';
    const ia = await enviar(cookieAna, 'post', '/rua/sugestao-passo', {
      resultado: 'proposta',
      anotacao: 'Gostou, mas quer o valor ajustado até sexta.',
    });
    expect(ia.body).toMatchObject({ texto: 'Mandar proposta ajustada', fonte: 'ia' });
    expect(ia.body.dia).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    respostaIa = 'não sei';
    const falhou = await enviar(cookieAna, 'post', '/rua/sugestao-passo', {
      resultado: 'proposta',
      anotacao: 'Gostou, mas quer o valor ajustado até sexta.',
    });
    expect(falhou.body.fonte).toBe('padrao');
    respostaIa = '';
  });

  it('planos: o que o plano não libera fica travado, e liberar à parte destrava', async () => {
    const { esquecerRecursos } = await import('../src/recursos.js');
    const org = `(SELECT organizacao_id FROM cadastro.contas WHERE id = 1)`;
    await pool.query(
      `UPDATE cadastro.organizacoes SET plano = 'start', modulos = '{whatsapp}' WHERE id = ${org}`,
    );
    esquecerRecursos();

    const eu = (await ler(cookieDona, '/auth/eu')).body;
    expect(eu.conta.recursos).toEqual([]);
    expect(eu.conta.modulos).toEqual(['whatsapp']);

    // Vendas na rua e reuniões novas não estão no Start (a resposta diz o plano que libera).
    const rua = await ler(cookieDona, '/rua/estado');
    expect(rua.status).toBe(403);
    expect(rua.body.erro).toMatchObject({ codigo: 'fora_do_plano' });
    expect(rua.body.erro.mensagem).toContain('plano Time');
    expect((await ler(cookieDona, '/reunioes?quais=realizadas')).status).toBe(200);
    const sala = await enviar(cookieDona, 'post', '/agenda', {
      tipo: 'reuniao',
      titulo: 'Reunião',
      inicio: new Date(Date.now() + 3600_000).toISOString(),
      sala: { entrada: 'livre', gravar: false, transcrever: false, abreMinutosAntes: 10 },
    });
    expect(sala.status).toBe(403);
    expect((await enviar(cookieDona, 'post', '/funil/pipelines', { nome: 'Pós-venda' })).status).toBe(403);
    expect((await ler(cookieDona, '/funil/radar')).status).toBe(403);
    expect((await ler(cookieDona, '/assistente/mapa')).status).toBe(403);
    expect((await ler(cookieDona, '/auditoria')).status).toBe(403);

    // WhatsApp: 3 números inclusos; com os três conectados, não cabe outro.
    expect((await ler(cookieDona, '/agente/chips')).body).toMatchObject({ limite: 3, usados: 0 });
    await pool.query(
      `INSERT INTO comercial.chips (conta_id, nome, instancia, token_cifrado) VALUES (1, 'A', 'i-a', 'x'), (1, 'B', 'i-b', 'y'), (1, 'C', 'i-c', 'z')`,
    );
    expect((await ler(cookieDona, '/agente/chips')).body).toMatchObject({ limite: 3, usados: 3 });
    // Um número extra contratado: cabe mais um.
    await pool.query(`UPDATE cadastro.organizacoes SET numeros_extras = 1 WHERE id = ${org}`);
    esquecerRecursos();
    expect((await ler(cookieDona, '/agente/chips')).body).toMatchObject({ limite: 4, usados: 3 });

    // Liberado à parte (sem mudar o plano): Vendas na rua volta a abrir.
    await pool.query(`UPDATE cadastro.organizacoes SET recursos_extras = '{rua}' WHERE id = ${org}`);
    esquecerRecursos();
    expect((await ler(cookieDona, '/rua/estado')).status).toBe(200);

    // O meu plano mostra as franquias.
    const meu = (await ler(cookieDona, '/equipe/plano')).body;
    expect(meu.recursos).toEqual(['rua']);
    expect(meu.consumo.numerosWhatsapp).toEqual({ usados: 3, limite: 4 });
    expect(meu.consumo.horasReuniao).toMatchObject({ limite: 0 });

    await pool.query(
      `UPDATE cadastro.organizacoes SET plano = NULL, modulos = '{}', recursos_extras = '{}', numeros_extras = 0 WHERE id = ${org}`,
    );
    await pool.query(`DELETE FROM comercial.chips WHERE conta_id = 1`);
    esquecerRecursos();
  });
});
