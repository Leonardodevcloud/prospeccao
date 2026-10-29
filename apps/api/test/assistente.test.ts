import { criarPool, migrar, type Pool } from '@prospeccao/db';
import { bancoDeTeste } from '@prospeccao/db/teste';
import type { PedidoConversa } from '@prospeccao/integrations/ia';
import { criarLogger } from '@prospeccao/shared';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../src/app.js';
import {
  assinarEscopo,
  consultar,
  criarPoolLeitura,
  lerChave,
  senhaLeitura,
  sincronizarAcesso,
  validarSql,
} from '../src/modulos/assistente/acesso.js';
import { mascarar, restaurar } from '../src/modulos/assistente/mascara.js';
import type { ServicosConta } from '../src/servicos.js';

const URL_TESTE = process.env.TEST_DATABASE_URL;
const ORIGEM = 'http://localhost:5173';
const SEGREDO = 'segredo-de-teste-do-argos-'.padEnd(40, 'x');

/**
 * O Argos lê o banco com SQL escrito pela IA. Estes testes garantem a regra que mais importa:
 * cada pessoa só enxerga o próprio escopo (a unidade, a organização ou — o master — tudo), mesmo
 * com SQL malicioso, assinatura falsa ou escopo vencido.
 */
describe.skipIf(!URL_TESTE)('Argos: acesso aos dados por escopo', () => {
  let pool: Pool;
  let leitura: Pool;
  let chave: string;
  let app: ReturnType<typeof criarApp>;
  const ids = {} as Record<
    'alfa' | 'beta' | 'a1' | 'a2' | 'b1' | 'sdrA1' | 'gestorAlfa' | 'leituraAlfa' | 'adminB1',
    number
  >;
  /** O "roteiro" da IA falsa: devolve estas respostas em ordem. */
  let roteiro: ((p: PedidoConversa) => string)[] = [];
  const pedidosIa: PedidoConversa[] = [];

  const escopo = (tudo: boolean, contas: number[], validade = 60) =>
    assinarEscopo(chave, { tudo, contas }, validade);
  const contar = async (assinado: string, sql: string) =>
    Number((await consultar(leitura, assinado, sql)).linhas[0]?.n ?? 0);

  beforeAll(async () => {
    const urlBanco = await bancoDeTeste(URL_TESTE!, 'assistente');
    pool = criarPool({ url: urlBanco, aplicacao: 'teste-argos', max: 4 });
    const log = criarLogger('teste', 'silent');
    await migrar(pool, log);
    const senha = senhaLeitura(SEGREDO);
    await sincronizarAcesso(pool, senha);
    chave = await lerChave(pool);
    leitura = criarPoolLeitura(urlBanco, senha);

    // Duas organizações: Alfa (duas unidades) e Beta (uma).
    const org = async (nome: string) =>
      (
        await pool.query<{ id: number }>(
          `INSERT INTO cadastro.organizacoes (nome) VALUES ($1) RETURNING id`,
          [nome],
        )
      ).rows[0]!.id;
    const conta = async (nome: string, organizacao: number) =>
      (
        await pool.query<{ id: number }>(
          `INSERT INTO cadastro.contas (nome, organizacao_id) VALUES ($1, $2) RETURNING id`,
          [nome, organizacao],
        )
      ).rows[0]!.id;
    ids.alfa = await org('Alfa Distribuidora');
    ids.beta = await org('Beta Serviços');
    ids.a1 = await conta('Alfa Bahia', ids.alfa);
    ids.a2 = await conta('Alfa Recife', ids.alfa);
    ids.b1 = await conta('Beta Matriz', ids.beta);

    const hash = await bcrypt.hash('senhaForte123', 4);
    const pessoa = async (nome: string, email: string, papel: string, contaId: number) =>
      (
        await pool.query<{ id: number }>(
          `INSERT INTO cadastro.usuarios (nome, email, senha_hash, papel, conta_id, termos_versao, termos_aceitos_em)
           VALUES ($1, $2, $3, $4, $5, '2026-10', now()) RETURNING id`,
          [nome, email, hash, papel, contaId],
        )
      ).rows[0]!.id;
    ids.sdrA1 = await pessoa('Sara Bahia', 'sara@alfa.com', 'sdr', ids.a1);
    ids.gestorAlfa = await pessoa('Gil Gestor', 'gil@alfa.com', 'gestor', ids.a1);
    ids.leituraAlfa = await pessoa('Dora Diretora', 'dora@alfa.com', 'leitura', ids.a1);
    ids.adminB1 = await pessoa('Beto Beta', 'beto@beta.com', 'admin', ids.b1);

    // Negociações: 2 na Alfa Bahia, 3 na Alfa Recife, 4 na Beta.
    let n = 0;
    for (const [contaId, qtd] of [
      [ids.a1, 2],
      [ids.a2, 3],
      [ids.b1, 4],
    ] as const) {
      for (let i = 0; i < qtd; i++) {
        n++;
        const { rows } = await pool.query<{ id: number }>(
          `INSERT INTO descoberta.empresas (nome, cidade, uf) VALUES ($1, 'SALVADOR', 'BA') RETURNING id`,
          [`Empresa ${n}`],
        );
        await pool.query(
          `INSERT INTO comercial.oportunidades (empresa_id, conta_id, etapa, valor_mensal) VALUES ($1, $2, 'abordado', 1000)`,
          [rows[0]!.id, contaId],
        );
      }
    }

    app = criarApp({
      pool,
      log,
      filas: {
        publicar: async () => 'job',
        publicarVarios: async (_n, p) => p.length,
        cancelarPendentes: async () => 0,
        tamanhos: async () => ({}),
      },
      auth: {
        jwtSegredo: SEGREDO,
        adminEmail: 'dono@plataforma.com',
        adminSenhaHash: await bcrypt.hash('senha-forte-123', 4),
        sessaoHoras: 1,
        cookieSeguro: false,
      },
      origens: [ORIGEM],
      servicos: async (contaId) =>
        ({
          contaId,
          whatsapp: null,
          ia: null,
          classificarEmail: null,
          personalizarAbertura: null,
          email: null,
          geocodificar: null,
          assistente: async (p: PedidoConversa) => {
            pedidosIa.push(p);
            const proximo = roteiro.shift();
            if (!proximo) throw new Error('roteiro da IA acabou');
            return proximo(p);
          },
          origem: { places: null, ors: null, resend: null, whatsapp: null, ia: null },
          iaDescricao: null,
          erro: null,
        }) as ServicosConta,
      credenciais: { chave: null, ambiente: {}, invalidar() {} },
      assistente: { leitura, chave, voz: null, fala: null, raciocinio: 'desligado', erro: null },
    });
  });

  afterAll(async () => {
    await leitura?.end();
    await pool?.end();
  });

  it('cada escopo enxerga só as próprias linhas', async () => {
    const sql = 'SELECT count(*) AS n FROM funil';
    expect(await contar(escopo(false, [ids.a1]), sql)).toBe(2);
    expect(await contar(escopo(false, [ids.a2]), sql)).toBe(3);
    expect(await contar(escopo(false, [ids.a1, ids.a2]), sql)).toBe(5);
    expect(await contar(escopo(false, [ids.b1]), sql)).toBe(4);
    expect(await contar(escopo(true, []), sql)).toBe(9);
    // Unidades e equipe também.
    expect(await contar(escopo(false, [ids.b1]), 'SELECT count(*) AS n FROM unidades')).toBe(1);
    expect(await contar(escopo(false, [ids.a1]), 'SELECT count(*) AS n FROM equipe')).toBe(3);
  });

  it('views da plataforma só para o master', async () => {
    const sql = 'SELECT count(*) AS n FROM plataforma_organizacoes';
    expect(await contar(escopo(false, [ids.a1, ids.a2]), sql)).toBe(0);
    expect(await contar(escopo(true, []), sql)).toBeGreaterThanOrEqual(3);
  });

  it('sem assinatura válida, ou vencida, nada aparece', async () => {
    const sql = 'SELECT count(*) AS n FROM funil';
    const bom = escopo(true, []);
    const falsificado = `${bom.slice(0, -64)}${'0'.repeat(64)}`;
    expect(await contar(falsificado, sql)).toBe(0);
    // Trocar as unidades sem refazer a assinatura não vale.
    const trocado = escopo(false, [ids.a1]).replace(`;${ids.a1};`, `;${ids.a1},${ids.b1};`);
    expect(await contar(trocado, sql)).toBe(0);
    expect(await contar(escopo(true, [], -5), sql)).toBe(0);
    expect(await contar('', sql)).toBe(0);
  });

  it('SQL malicioso não escapa do escopo nem das views', async () => {
    const a1 = escopo(false, [ids.a1]);
    // Trocar o escopo de dentro da consulta (o validador barra; o banco também não deixa ver mais).
    expect(() => validarSql("SELECT set_config('cerebro.escopo', 'v1;1;;9999999999;x', true)")).toThrow();
    const r = await consultar(
      leitura,
      a1,
      "SELECT set_config('cerebro.escopo', 'v1;1;;9999999999;x', true) AS s, (SELECT count(*) FROM funil) AS n",
    );
    expect(Number(r.linhas[0]?.n)).toBe(0);
    // Tabelas de verdade, a chave e outros schemas: sem permissão.
    await expect(consultar(leitura, a1, 'SELECT count(*) FROM comercial.oportunidades')).rejects.toThrow(
      /permission denied/,
    );
    await expect(consultar(leitura, a1, 'SELECT segredo FROM cerebro_priv.chave')).rejects.toThrow(
      /permission denied/,
    );
    await expect(consultar(leitura, a1, 'SELECT count(*) FROM cadastro.usuarios')).rejects.toThrow(
      /permission denied/,
    );
    // Escrita: nem pela view.
    await expect(
      consultar(leitura, a1, 'WITH x AS (DELETE FROM funil RETURNING 1) SELECT count(*) FROM x'),
    ).rejects.toThrow();
    expect(() => validarSql('DELETE FROM funil')).toThrow();
    expect(() => validarSql('SELECT 1; DROP TABLE funil')).toThrow();
    expect(() => validarSql('SELECT * FROM cadastro.usuarios')).toThrow();
    expect(() => validarSql('SELECT pg_sleep(30)')).toThrow();
    // Texto com palavras proibidas dentro de aspas não atrapalha.
    expect(
      validarSql(`SELECT 'pedido cancelado, delete' AS x, etapa AS "valor do mês" FROM funil`),
    ).toContain('pedido cancelado');
  });

  it('a máscara esconde e devolve nomes, e-mails e telefones', () => {
    const { texto, mapa } = mascarar('Falar com Ana Souza, ana@x.com.br, (71) 99999-1234', {
      nomes: ['Ana Souza'],
    });
    expect(texto).not.toMatch(/Ana|ana@|99999/);
    expect(restaurar(texto, mapa)).toBe('Falar com Ana Souza, ana@x.com.br, (71) 99999-1234');
  });

  /** Login de uma pessoa (IP diferente por login, por causa do limite de tentativas). */
  let ipN = 0;
  const entrar = async (email: string, senha = 'senhaForte123') => {
    const r = await request(app)
      .post('/auth/login')
      .set('Origin', ORIGEM)
      .set('X-Forwarded-For', `10.77.0.${++ipN}`)
      .send({ email, senha });
    expect(r.status).toBe(200);
    return (r.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
  };
  const perguntar = (cookie: string, texto: string) =>
    request(app).post('/assistente').set('Origin', ORIGEM).set('Cookie', cookie).send({ texto });

  /** A IA falsa: consulta o total do funil e responde com o número que voltou. */
  const roteiroContar = () => {
    roteiro = [
      () => JSON.stringify({ acao: 'sql', sql: 'SELECT count(*) AS n FROM funil', titulo: 'Total' }),
      (p) => {
        const n = /"n":"?(\d+)/.exec(p.mensagens.at(-1)?.conteudo ?? '')?.[1];
        return JSON.stringify({ acao: 'responder', fala: `São ${n} negociações.`, mostrar: 'r1' });
      },
    ];
  };

  it('pela api, cada pessoa recebe a resposta do próprio escopo', async () => {
    const casos: [string, string][] = [
      ['sara@alfa.com', 'São 2 negociações.'],
      ['gil@alfa.com', 'São 5 negociações.'],
      ['dora@alfa.com', 'São 5 negociações.'],
      ['beto@beta.com', 'São 4 negociações.'],
      ['dono@plataforma.com', 'São 9 negociações.'],
    ];
    for (const [email, esperado] of casos) {
      const cookie = await entrar(
        email,
        email === 'dono@plataforma.com' ? 'senha-forte-123' : 'senhaForte123',
      );
      roteiroContar();
      const r = await perguntar(cookie, 'me diz o total que tenho');
      expect(r.status, email).toBe(200);
      expect(r.body.fala, email).toBe(esperado);
      expect(r.body.dados.linhas).toHaveLength(1);
    }
  });

  it('o catálogo da plataforma não aparece para quem não é master, e nomes vão mascarados', async () => {
    const cookie = await entrar('sara@alfa.com');
    pedidosIa.length = 0;
    roteiro = [() => JSON.stringify({ acao: 'responder', fala: 'Oi, Sara!' })];
    const r = await perguntar(cookie, 'oi, tudo bem? aqui é a Sara Bahia');
    expect(r.status).toBe(200);
    expect(r.body.fala).toBe('Oi, Sara!');
    const enviado = JSON.stringify(pedidosIa[0]);
    expect(enviado).not.toContain('plataforma_organizacoes');
    expect(enviado).toContain('funil');
    // O nome completo de quem pergunta não sai para a IA (só o primeiro nome, no contexto).
    expect(pedidosIa[0]!.mensagens.at(-1)!.conteudo).not.toContain('Sara Bahia');
  });

  it('a diretoria (só leitura) pergunta, mas não cria tarefa pelo Argos', async () => {
    const cookie = await entrar('dora@alfa.com');
    roteiro = [
      () =>
        JSON.stringify({
          acao: 'criar_tarefa',
          titulo: 'Ligar para o cliente',
          tipo: 'ligacao',
          inicio: null,
        }),
      (p) => {
        expect(p.mensagens.at(-1)?.conteudo).toMatch(/só de leitura/);
        return JSON.stringify({ acao: 'responder', fala: 'Seu acesso é só de leitura.' });
      },
    ];
    const r = await perguntar(cookie, 'anota uma tarefa para eu ligar amanhã');
    expect(r.status).toBe(200);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM comercial.tarefas');
    expect(rows[0].n).toBe(0);
  });

  it('quem pode, cria a tarefa uma vez na própria agenda', async () => {
    const cookie = await entrar('sara@alfa.com');
    roteiro = [
      () =>
        JSON.stringify({
          acao: 'criar_tarefa',
          titulo: 'Ligar para a Empresa 1',
          tipo: 'ligacao',
          inicio: '2030-01-10T15:00',
        }),
      () => JSON.stringify({ acao: 'criar_tarefa', titulo: 'De novo', tipo: 'ligacao' }),
      () => JSON.stringify({ acao: 'responder', fala: 'Anotado para 10 de janeiro às 15h.' }),
    ];
    const r = await perguntar(cookie, 'anota pra eu ligar pra Empresa 1 dia 10 de janeiro às 15h');
    expect(r.status).toBe(200);
    const { rows } = await pool.query(
      'SELECT conta_id, usuario_id, tipo, inicio FROM comercial.tarefas ORDER BY id',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ conta_id: ids.a1, usuario_id: ids.sdrA1, tipo: 'ligacao' });
    expect(new Date(rows[0].inicio).toISOString()).toBe('2030-01-10T18:00:00.000Z');
  });

  it('o histórico é guardado e só a própria pessoa vê, continua ou apaga', async () => {
    // As perguntas dos testes anteriores também ficaram guardadas: começa limpo.
    await pool.query('DELETE FROM comercial.argos_conversas');
    const sara = await entrar('sara@alfa.com');
    const gil = await entrar('gil@alfa.com');
    const pedir = (cookie: string, corpo: object) =>
      request(app).post('/assistente').set('Origin', ORIGEM).set('Cookie', cookie).send(corpo);

    roteiro = [() => JSON.stringify({ acao: 'responder', fala: 'Primeira resposta.' })];
    const r1 = await pedir(sara, { texto: 'Quais campanhas estão ativas?' });
    expect(r1.status).toBe(200);
    const conversaId = r1.body.conversaId as number;
    expect(conversaId).toBeGreaterThan(0);

    // Continuando: o contexto vem do banco (a pergunta anterior volta para a IA).
    roteiro = [
      (p) => {
        expect(JSON.stringify(p.mensagens)).toContain('Primeira resposta.');
        return JSON.stringify({ acao: 'responder', fala: 'Segunda resposta.' });
      },
    ];
    const r2 = await pedir(sara, { texto: 'E as pausadas?', conversaId, via: 'voz' });
    expect(r2.status).toBe(200);
    expect(r2.body.conversaId).toBe(conversaId);

    const lista = await request(app).get('/assistente/conversas').set('Cookie', sara);
    expect(lista.body).toHaveLength(1);
    expect(lista.body[0]).toMatchObject({
      id: conversaId,
      titulo: 'Quais campanhas estão ativas?',
      trocas: 2,
    });
    const aberta = await request(app).get(`/assistente/conversas/${conversaId}`).set('Cookie', sara);
    expect(aberta.body.trocas.map((t: { via: string }) => t.via)).toEqual(['texto', 'voz']);
    expect(aberta.body.trocas[1].resposta.fala).toBe('Segunda resposta.');

    // O gestor (mesmo da mesma organização) não vê, não continua e não apaga a conversa da Sara.
    expect((await request(app).get('/assistente/conversas').set('Cookie', gil)).body).toHaveLength(0);
    expect((await request(app).get(`/assistente/conversas/${conversaId}`).set('Cookie', gil)).status).toBe(
      404,
    );
    roteiro = [() => JSON.stringify({ acao: 'responder', fala: 'x' })];
    expect((await pedir(gil, { texto: 'continuar a da Sara', conversaId })).status).toBe(404);
    const apagarGil = await request(app)
      .delete(`/assistente/conversas/${conversaId}`)
      .set('Origin', ORIGEM)
      .set('Cookie', gil);
    expect(apagarGil.status).toBe(404);

    // A própria pessoa renomeia e apaga.
    const renomear = await request(app)
      .patch(`/assistente/conversas/${conversaId}`)
      .set('Origin', ORIGEM)
      .set('Cookie', sara)
      .send({ titulo: 'Campanhas' });
    expect(renomear.status).toBe(204);
    const apagar = await request(app)
      .delete(`/assistente/conversas/${conversaId}`)
      .set('Origin', ORIGEM)
      .set('Cookie', sara);
    expect(apagar.status).toBe(204);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM comercial.argos_trocas');
    expect(rows[0].n).toBe(0);
  });

  it('a diretoria também guarda e apaga o próprio histórico', async () => {
    const dora = await entrar('dora@alfa.com');
    roteiro = [() => JSON.stringify({ acao: 'responder', fala: 'Oi!' })];
    const r = await perguntar(dora, 'oi');
    expect(r.status).toBe(200);
    const apagar = await request(app)
      .delete(`/assistente/conversas/${r.body.conversaId}`)
      .set('Origin', ORIGEM)
      .set('Cookie', dora);
    expect(apagar.status).toBe(204);
  });

  it('o mapa do conhecimento respeita o escopo', async () => {
    const empresas = (b: { nos: { categoria: string }[] }) =>
      b.nos.filter((n) => n.categoria === 'registro').length;
    const sara = await request(app)
      .get('/assistente/mapa')
      .set('Cookie', await entrar('sara@alfa.com'));
    expect(sara.status).toBe(200);
    expect(empresas(sara.body)).toBe(2);
    expect(sara.body.unidades).toEqual([{ id: ids.a1, nome: 'Alfa Bahia' }]);
    const gil = await request(app)
      .get('/assistente/mapa')
      .set('Cookie', await entrar('gil@alfa.com'));
    expect(empresas(gil.body)).toBe(5);
    // Filtrar por uma unidade de fora do escopo não mostra nada.
    const fora = await request(app)
      .get(`/assistente/mapa?unidade=${ids.b1}`)
      .set('Cookie', await entrar('gil@alfa.com'));
    expect(empresas(fora.body)).toBe(0);
    const beto = await request(app)
      .get('/assistente/mapa')
      .set('Cookie', await entrar('beto@beta.com'));
    expect(empresas(beto.body)).toBe(4);
    // A etapa vira aglomerado e cada empresa se liga a ela.
    expect(gil.body.nos.find((n: { id: string }) => n.id === 'etapa:abordado')).toMatchObject({
      categoria: 'area',
    });
    expect(gil.body.ligacoes.filter((l: { tipo: string }) => l.tipo === 'area')).toHaveLength(5);
  });

  it('quem vê só a própria base não enxerga o resto da unidade', async () => {
    // Uma das 2 negociações da Alfa Bahia fica com a Sara; a outra, sem dono.
    const { rows } = await pool.query<{ empresa_id: number }>(
      'SELECT empresa_id FROM comercial.oportunidades WHERE conta_id = $1 ORDER BY empresa_id LIMIT 1',
      [ids.a1],
    );
    const minha = rows[0]!.empresa_id;
    await pool.query(
      'UPDATE comercial.oportunidades SET responsavel_id = $1 WHERE conta_id = $2 AND empresa_id = $3',
      [ids.sdrA1, ids.a1, minha],
    );
    try {
      const base = assinarEscopo(chave, { tudo: false, contas: [ids.a1], dono: ids.sdrA1 }, 60);
      expect(await contar(base, 'SELECT count(*) AS n FROM funil')).toBe(1);
      expect(await contar(base, 'SELECT count(*) AS n FROM equipe')).toBe(1);
      expect(await contar(base, 'SELECT count(*) AS n FROM consumo_ia')).toBe(0);
      expect(await contar(base, 'SELECT count(*) AS n FROM unidades')).toBe(1);
      // Tirar o recorte sem refazer a assinatura não vale.
      expect(await contar(base.replace(`;${ids.sdrA1};`, ';0;'), 'SELECT count(*) AS n FROM funil')).toBe(0);
      // O master não tem recorte, mesmo que venha um dono.
      expect(
        await contar(
          assinarEscopo(chave, { tudo: true, contas: [], dono: ids.sdrA1 }),
          'SELECT count(*) AS n FROM funil',
        ),
      ).toBe(9);

      // Pela api: com "unidade toda" a Sara vê 2; com "só a própria base", 1.
      const cookie = await entrar('sara@alfa.com');
      roteiroContar();
      expect((await perguntar(cookie, 'Quantas negociações?')).body.fala).toBe('São 2 negociações.');
      await pool.query(`UPDATE cadastro.usuarios SET alcance = 'proprios' WHERE id = $1`, [ids.sdrA1]);
      roteiroContar();
      expect((await perguntar(cookie, 'Quantas negociações?')).body.fala).toBe('São 1 negociações.');
      const mapa = await request(app).get('/assistente/mapa').set('Cookie', cookie);
      expect(mapa.body.soPropriaBase).toBe(true);
      expect(mapa.body.nos.filter((n: { categoria: string }) => n.categoria === 'registro')).toHaveLength(1);
    } finally {
      await pool.query(`UPDATE cadastro.usuarios SET alcance = 'unidade' WHERE id = $1`, [ids.sdrA1]);
      await pool.query('UPDATE comercial.oportunidades SET responsavel_id = NULL WHERE conta_id = $1', [
        ids.a1,
      ]);
    }
  });

  it('o administrador escolhe a visão de cada pessoa (e administrador vê tudo)', async () => {
    const cookie = await entrar('beto@beta.com');
    const criado = await request(app)
      .post('/equipe')
      .set('Origin', ORIGEM)
      .set('Cookie', cookie)
      .send({ nome: 'Caio Closer', email: 'caio@beta.com', papel: 'closer', alcance: 'proprios' });
    expect(criado.status).toBe(201);
    const alcance = async () =>
      (
        await pool.query<{ alcance: string }>('SELECT alcance FROM cadastro.usuarios WHERE id = $1', [
          criado.body.id,
        ])
      ).rows[0]?.alcance;
    expect(await alcance()).toBe('proprios');
    const lista = await request(app).get('/equipe').set('Cookie', cookie);
    expect(lista.body.usuarios.find((u: { id: number }) => u.id === criado.body.id)?.alcance).toBe(
      'proprios',
    );
    // Virou administrador: passa a ver a unidade toda.
    const virou = await request(app)
      .patch(`/equipe/${criado.body.id}`)
      .set('Origin', ORIGEM)
      .set('Cookie', cookie)
      .send({ papel: 'admin' });
    expect(virou.status).toBe(200);
    expect(await alcance()).toBe('unidade');
  });

  it('só a própria base vale nas telas: funil, conversas e números sem lead', async () => {
    const { rows } = await pool.query<{ empresa_id: number }>(
      'SELECT empresa_id::int FROM comercial.oportunidades WHERE conta_id = $1 ORDER BY empresa_id',
      [ids.a1],
    );
    const [minha, deColega] = [rows[0]!.empresa_id, rows[1]!.empresa_id];
    const colega = await pool.query<{ id: number }>(
      `INSERT INTO cadastro.usuarios (nome, email, papel, conta_id) VALUES ('Cid Colega', 'cid@alfa.com', 'sdr', $1) RETURNING id`,
      [ids.a1],
    );
    const cid = colega.rows[0]!.id;
    await pool.query(
      'UPDATE comercial.oportunidades SET responsavel_id = $1 WHERE conta_id = $2 AND empresa_id = $3',
      [ids.sdrA1, ids.a1, minha],
    );
    await pool.query(
      'UPDATE comercial.oportunidades SET responsavel_id = $1 WHERE conta_id = $2 AND empresa_id = $3',
      [cid, ids.a1, deColega],
    );
    for (const e of [minha, deColega])
      await pool.query(
        `INSERT INTO comercial.mensagens (conta_id, empresa_id, direcao, texto, status, origem) VALUES ($1, $2, 'recebida', 'Oi', 'recebida', 'lead')`,
        [ids.a1, e],
      );
    // Dois números: o da Sara e o da equipe; cada um recebeu de um número fora dos leads.
    const chip = await pool.query<{ id: number }>(
      `INSERT INTO comercial.chips (conta_id, nome, instancia, usuario_id) VALUES ($1, 'Sara', 'inst-sara', $2) RETURNING id`,
      [ids.a1, ids.sdrA1],
    );
    await pool.query(
      `INSERT INTO comercial.nao_identificadas (conta_id, telefone, direcao, texto, chip_id)
       VALUES ($1, '71999990001', 'recebida', 'No número da Sara', $2), ($1, '71999990002', 'recebida', 'No número da equipe', NULL)`,
      [ids.a1, chip.rows[0]!.id],
    );
    try {
      const cookie = await entrar('sara@alfa.com');
      const conversas = async () =>
        (await request(app).get('/conversas').set('Cookie', cookie)).body.map(
          (c: { empresaId: number }) => c.empresaId,
        );
      const soltos = async () =>
        (await request(app).get('/conversas/nao-identificados').set('Cookie', cookie)).body.map(
          (n: { telefone: string }) => n.telefone,
        );
      // Unidade toda: vê tudo.
      expect((await conversas()).sort()).toEqual([minha, deColega].sort());
      expect(await soltos()).toHaveLength(2);
      expect((await request(app).get(`/funil/${deColega}`).set('Cookie', cookie)).status).toBe(200);

      await pool.query(`UPDATE cadastro.usuarios SET alcance = 'proprios' WHERE id = $1`, [ids.sdrA1]);
      expect((await request(app).get('/auth/eu').set('Cookie', cookie)).body.soPropriaBase).toBe(true);
      expect(await conversas()).toEqual([minha]);
      expect(await soltos()).toEqual(['71999990001']);
      // O lead do colega não abre nem muda, por nenhuma porta.
      expect((await request(app).get(`/funil/${minha}`).set('Cookie', cookie)).status).toBe(200);
      expect((await request(app).get(`/funil/${deColega}`).set('Cookie', cookie)).status).toBe(404);
      expect((await request(app).get(`/conversas/${deColega}`).set('Cookie', cookie)).status).toBe(404);
      expect((await request(app).get(`/empresas/${deColega}`).set('Cookie', cookie)).status).toBe(404);
      const mexer = await request(app)
        .patch(`/funil/${deColega}`)
        .set('Origin', ORIGEM)
        .set('Cookie', cookie)
        .send({ valorMensal: 1 });
      expect(mexer.status).toBe(404);
      // Nem passar o próprio lead para outra pessoa.
      const passar = await request(app)
        .patch(`/funil/${minha}`)
        .set('Origin', ORIGEM)
        .set('Cookie', cookie)
        .send({ responsavelId: cid });
      expect(passar.status).toBe(422);
      // Administrador (Beto, de outra organização) não é afetado; e a escolha não vale para admin.
      await pool.query(`UPDATE cadastro.usuarios SET alcance = 'proprios' WHERE id = $1`, [ids.adminB1]);
      expect(
        (
          await request(app)
            .get('/auth/eu')
            .set('Cookie', await entrar('beto@beta.com'))
        ).body.soPropriaBase,
      ).toBe(false);
    } finally {
      await pool.query(`UPDATE cadastro.usuarios SET alcance = 'unidade' WHERE id IN ($1, $2)`, [
        ids.sdrA1,
        ids.adminB1,
      ]);
      await pool.query('UPDATE comercial.oportunidades SET responsavel_id = NULL WHERE conta_id = $1', [
        ids.a1,
      ]);
      await pool.query('DELETE FROM comercial.mensagens WHERE conta_id = $1', [ids.a1]);
      await pool.query('DELETE FROM comercial.nao_identificadas WHERE conta_id = $1', [ids.a1]);
      await pool.query('DELETE FROM comercial.chips WHERE conta_id = $1', [ids.a1]);
      await pool.query('DELETE FROM cadastro.usuarios WHERE id = $1', [cid]);
    }
  });
});
