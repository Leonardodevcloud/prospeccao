import { criarPool, migrar, type Pool } from '@prospeccao/db';
import { bancoDeTeste } from '@prospeccao/db/teste';
import type { EntradaGatilhos, MovimentoConferido } from '@prospeccao/integrations/quadros';
import { criarLogger } from '@prospeccao/shared';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../src/app.js';
import { rodadaQuadros } from '../src/modulos/quadros/leitura.js';
import type { ServicosConta } from '../src/servicos.js';

const URL_TESTE = process.env.TEST_DATABASE_URL;
const ORIGEM = 'http://localhost:5173';
const SEGREDO = 'q'.repeat(40);

describe.skipIf(!URL_TESTE)('quadros com gatilhos da IA', () => {
  let pool: Pool;
  let app: ReturnType<typeof criarApp>;
  let master = '';
  let contaId = 0;
  let ip = 0;
  const log = criarLogger('teste', 'silent');
  // A IA de mentira: o teste diz o que ela responde e vê o que ela recebeu.
  const lidas: EntradaGatilhos[] = [];
  let resposta: (e: EntradaGatilhos) => MovimentoConferido[] = () => [];
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
    quadros: {
      ler: async (e) => {
        lidas.push(e);
        return resposta(e);
      },
    },
  });
  const deOutroLugar = () => `10.78.${Math.floor(++ip / 250)}.${ip % 250}`;
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
  const como = (cookie: string) => ({
    get: (rota: string) => request(app).get(rota).set('Cookie', cookie),
    enviar: (metodo: 'post' | 'put' | 'patch' | 'delete', rota: string, corpo?: object) =>
      request(app)[metodo](rota).set('Origin', ORIGEM).set('Cookie', cookie).send(corpo),
  });
  const idDe = async (email: string) =>
    (await pool.query<{ id: number }>('SELECT id FROM cadastro.usuarios WHERE email = $1', [email])).rows[0]!
      .id;
  let ana: ReturnType<typeof como>;
  let bia: ReturnType<typeof como>;
  let caio: ReturnType<typeof como>;
  let leadBia = 0;
  let leadCaio = 0;
  let quadro: { id: number; colunas: { id: number; nome: string; gatilho: string | null }[] };
  const coluna = (nome: string) => quadro.colunas.find((c) => c.nome === nome)!.id;
  const mensagem = (
    empresaId: number,
    direcao: 'enviada' | 'recebida',
    texto: string,
    minutosAtras: number,
  ) =>
    pool
      .query<{ id: string }>(
        `INSERT INTO comercial.mensagens (conta_id, empresa_id, direcao, texto, status, origem, criado_em)
         VALUES ($1, $2, $3, $4, $3, $5, now() - make_interval(mins => $6)) RETURNING id`,
        [contaId, empresaId, direcao, texto, direcao === 'recebida' ? 'lead' : 'humano', minutosAtras],
      )
      .then((r) => Number(r.rows[0]!.id));

  beforeAll(async () => {
    pool = criarPool({ url: await bancoDeTeste(URL_TESTE!, 'quadros'), aplicacao: 'teste-quadros', max: 4 });
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
      nome: 'Autopeças Quadros',
      primeiroAcesso: 'admin',
      admin: { nome: 'Ana Admin', email: 'ana@quadros.com.br' },
      plano: { plano: 'escala', modulos: [] },
    });
    expect(r.status).toBe(201);
    contaId = r.body.id;
    for (const [nome, email] of [
      ['Bia Vendas', 'bia@quadros.com.br'],
      ['Caio Vendas', 'caio@quadros.com.br'],
    ] as const)
      expect(
        (
          await comoMaster('post', `/master/contas/${contaId}/usuarios`, {
            nome,
            email,
            papel: 'sdr',
            alcance: 'proprios',
          })
        ).status,
      ).toBe(201);
    for (const e of ['ana', 'bia', 'caio'])
      expect(
        (
          await comoMaster('patch', `/master/usuarios/${await idDe(`${e}@quadros.com.br`)}/acesso`, {
            senha: 'Senha-forte-1',
          })
        ).status,
      ).toBe(200);
    ana = como(cookieDe(await entrar('ana@quadros.com.br', 'Senha-forte-1')));
    bia = como(cookieDe(await entrar('bia@quadros.com.br', 'Senha-forte-1')));
    caio = como(cookieDe(await entrar('caio@quadros.com.br', 'Senha-forte-1')));
    expect(
      (
        await ana.enviar('post', '/nichos', {
          nome: 'Oficinas',
          cnaes: ['4520-0/01'],
          termosMaps: ['oficina'],
        })
      ).status,
    ).toBe(201);
    for (const [nome, dono, telefone] of [
      ['Oficina do Zé', 'bia', '71999990001'],
      ['Mecânica Rápida', 'caio', '71999990002'],
    ] as const) {
      const l = await ana.enviar('post', '/funil/leads', { empresa: nome, telefone });
      expect(l.status).toBe(201);
      await ana.enviar('patch', `/funil/${l.body.empresaId}`, {
        responsavelId: await idDe(`${dono}@quadros.com.br`),
      });
      if (dono === 'bia') leadBia = l.body.empresaId;
      else leadCaio = l.body.empresaId;
    }
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('o administrador monta o quadro; vendedor não', async () => {
    const corpo = {
      nome: 'Objeções',
      colunas: [
        { nome: 'Achou caro', gatilho: 'o cliente disse que o preço está caro', cor: 'laranja' },
        { nome: 'Sem estoque', gatilho: 'faltou a peça que o cliente pediu', cor: 'vermelho' },
        { nome: 'Resolvido' },
      ],
    };
    expect((await bia.enviar('post', '/quadros', corpo)).status).toBe(403);
    const r = await ana.enviar('post', '/quadros', corpo);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ nome: 'Objeções', ia: true, confirmar: true, sugestoes: 0 });
    expect(r.body.colunas.map((c: { nome: string }) => c.nome)).toEqual([
      'Achou caro',
      'Sem estoque',
      'Resolvido',
    ]);
    quadro = r.body;
    expect((await ana.enviar('post', '/quadros', { ...corpo, nome: 'objeções' })).status).toBe(409);
    const repetida = await ana.enviar('post', '/quadros', {
      nome: 'Outro',
      colunas: [{ nome: 'A' }, { nome: 'a' }],
    });
    expect(repetida.status).toBe(422);
    expect((await bia.get('/quadros')).body).toHaveLength(1);
  });

  it('a IA lê a conversa parada, sugere a coluna e o dono confirma', async () => {
    await mensagem(leadBia, 'enviada', 'Segue o orçamento do kit de embreagem: R$ 890', 20);
    const nova = await mensagem(leadBia, 'recebida', 'Nossa, achei caro demais. Vou pesquisar.', 5);
    // Conversa ainda andando (mensagem de agora): espera parar.
    await mensagem(leadCaio, 'recebida', 'Tem pastilha de freio do Gol?', 0);
    resposta = (e) => [
      {
        quadroId: e.quadros[0]!.id,
        colunaId: coluna('Achou caro'),
        trecho: 'achei caro demais',
        motivo: 'O cliente achou o orçamento caro.',
        mensagemId: nova,
      },
    ];
    expect(await rodadaQuadros(pool, servicos, log)).toBe(1);
    expect(lidas).toHaveLength(1);
    const e = lidas[0]!;
    expect(e).toMatchObject({ lead: 'Oficina do Zé', empresa: 'Autopeças Quadros' });
    expect(e.mensagens.map((m) => [m.quem, m.nova])).toEqual([
      ['empresa', true],
      ['lead', true],
    ]);
    // A coluna sem gatilho não vai para a IA.
    expect(e.quadros[0]!.colunas.map((c) => c.nome)).toEqual(['Achou caro', 'Sem estoque']);

    const ver = await bia.get(`/quadros/${quadro.id}/cartoes`);
    expect(ver.body).toHaveLength(1);
    expect(ver.body[0]).toMatchObject({
      empresaId: leadBia,
      colunaId: null,
      sugeridaId: coluna('Achou caro'),
      origem: 'ia',
      trecho: 'achei caro demais',
    });
    expect((await bia.get('/quadros')).body[0].sugestoes).toBe(1);
    // O colega (só a própria base) não vê nem mexe no lead da Bia.
    expect((await caio.get(`/quadros/${quadro.id}/cartoes`)).body).toHaveLength(0);
    expect((await caio.enviar('post', `/quadros/${quadro.id}/cartoes/${leadBia}/confirmar`)).status).toBe(
      404,
    );
    const { rows: aviso } = await pool.query(
      `SELECT titulo FROM comercial.notificacoes WHERE usuario_id = $1 ORDER BY id DESC LIMIT 1`,
      [await idDe('bia@quadros.com.br')],
    );
    expect(aviso[0].titulo).toBe('Oficina do Zé: Achou caro?');

    expect((await bia.enviar('post', `/quadros/${quadro.id}/cartoes/${leadBia}/confirmar`)).status).toBe(200);
    expect((await bia.enviar('post', `/quadros/${quadro.id}/cartoes/${leadBia}/confirmar`)).status).toBe(409);
    const depois = (await bia.get(`/quadros/${quadro.id}/cartoes`)).body[0];
    expect(depois).toMatchObject({
      colunaId: coluna('Achou caro'),
      sugeridaId: null,
      movidoPor: 'Bia Vendas',
    });
    const { rows: nota } = await pool.query(
      `SELECT texto FROM comercial.atividades WHERE empresa_id = $1 ORDER BY id DESC LIMIT 1`,
      [leadBia],
    );
    expect(nota[0].texto).toMatch(/Quadro Objeções: em "Achou caro" \(sugestão da IA confirmada/);

    // Sem mensagem nova, não lê de novo.
    expect(await rodadaQuadros(pool, servicos, log)).toBe(0);
  });

  it('quadro que já move sozinho, mover à mão, pôr e tirar leads', async () => {
    const r = await ana.enviar('put', `/quadros/${quadro.id}`, {
      nome: 'Objeções',
      confirmar: false,
      colunas: quadro.colunas,
    });
    expect(r.status).toBe(200);
    expect(r.body.colunas.map((c: { id: number }) => c.id)).toEqual(quadro.colunas.map((c) => c.id));
    const nova = await mensagem(leadBia, 'recebida', 'E a peça chegou? Disseram que estava em falta', 4);
    resposta = (e) => [
      {
        quadroId: e.quadros[0]!.id,
        colunaId: coluna('Sem estoque'),
        trecho: 'estava em falta',
        motivo: 'A peça estava em falta.',
        mensagemId: nova,
      },
    ];
    // A conversa do Caio também parou: as duas são lidas.
    await pool.query(
      `UPDATE comercial.mensagens SET criado_em = now() - interval '4 minutes' WHERE empresa_id = $1`,
      [leadCaio],
    );
    resposta = (e) =>
      e.lead === 'Oficina do Zé'
        ? [
            {
              quadroId: e.quadros[0]!.id,
              colunaId: coluna('Sem estoque'),
              trecho: 'estava em falta',
              motivo: 'A peça estava em falta.',
              mensagemId: nova,
            },
          ]
        : [];
    expect(await rodadaQuadros(pool, servicos, log)).toBe(2);
    // A IA soube onde o lead estava; só a mensagem nova conta.
    const daBia = lidas.at(-1)!.lead === 'Oficina do Zé' ? lidas.at(-1)! : lidas.at(-2)!;
    expect(daBia.quadros[0]!.colunaAtual).toBe('Achou caro');
    expect(daBia.mensagens.filter((m) => m.nova).map((m) => m.texto)).toEqual([
      'E a peça chegou? Disseram que estava em falta',
    ]);
    expect((await bia.get(`/quadros/${quadro.id}/cartoes`)).body[0]).toMatchObject({
      colunaId: coluna('Sem estoque'),
      sugeridaId: null,
      origem: 'ia',
      movidoPor: null,
    });

    // À mão: vai para "Resolvido".
    expect(
      (
        await bia.enviar('patch', `/quadros/${quadro.id}/cartoes/${leadBia}`, {
          colunaId: coluna('Resolvido'),
        })
      ).status,
    ).toBe(200);
    expect((await bia.get(`/quadros/${quadro.id}/cartoes`)).body[0]).toMatchObject({
      colunaId: coluna('Resolvido'),
      origem: 'pessoa',
      trecho: null,
    });
    // Coluna de outro quadro não serve.
    expect(
      (await bia.enviar('patch', `/quadros/${quadro.id}/cartoes/${leadBia}`, { colunaId: 999_999 })).status,
    ).toBe(422);

    // Pôr o lead à mão: o Caio põe o dele; a Bia não põe o do Caio.
    expect(
      (
        await bia.enviar('post', `/quadros/${quadro.id}/cartoes`, {
          empresaId: leadCaio,
          colunaId: coluna('Achou caro'),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await caio.enviar('post', `/quadros/${quadro.id}/cartoes`, {
          empresaId: leadCaio,
          colunaId: coluna('Achou caro'),
        })
      ).status,
    ).toBe(201);
    expect((await caio.get('/quadros/leads?busca=mecân')).body.map((l: { nome: string }) => l.nome)).toEqual([
      'Mecânica Rápida',
    ]);
    // A administradora vê os dois; filtra pelos da Bia.
    expect((await ana.get(`/quadros/${quadro.id}/cartoes`)).body).toHaveLength(2);
    const daBiaSo = await ana.get(
      `/quadros/${quadro.id}/cartoes?responsavel=${await idDe('bia@quadros.com.br')}`,
    );
    expect(daBiaSo.body.map((c: { empresaId: number }) => c.empresaId)).toEqual([leadBia]);
    expect((await caio.enviar('delete', `/quadros/${quadro.id}/cartoes/${leadCaio}`)).status).toBe(200);
    expect((await caio.get(`/quadros/${quadro.id}/cartoes`)).body).toHaveLength(0);
  });

  it('coluna que sai leva os cartões; IA fora do ar tenta de novo depois; descartar a sugestão', async () => {
    const semResolvido = quadro.colunas.filter((c) => c.nome !== 'Resolvido');
    const r = await ana.enviar('put', `/quadros/${quadro.id}`, {
      nome: 'Objeções',
      confirmar: true,
      colunas: [...semResolvido, { nome: 'Vai pensar', gatilho: 'o cliente disse que vai pensar' }],
    });
    expect(r.body.colunas.map((c: { nome: string }) => c.nome)).toEqual([
      'Achou caro',
      'Sem estoque',
      'Vai pensar',
    ]);
    quadro = r.body;
    expect((await bia.get(`/quadros/${quadro.id}/cartoes`)).body).toHaveLength(0);

    const nova = await mensagem(leadBia, 'recebida', 'Vou pensar e te falo amanhã', 4);
    resposta = () => {
      throw new Error('IA fora do ar');
    };
    await rodadaQuadros(pool, servicos, log);
    const { rows: l } = await pool.query(
      'SELECT tentado_em IS NOT NULL AS falhou FROM comercial.quadro_leituras WHERE empresa_id = $1',
      [leadBia],
    );
    expect(l[0].falhou).toBe(true);
    const antes = lidas.length;
    // Falhou há pouco: não tenta a cada minuto.
    await rodadaQuadros(pool, servicos, log);
    expect(lidas.length).toBe(antes);
    await pool.query(
      `UPDATE comercial.quadro_leituras SET tentado_em = now() - interval '20 minutes' WHERE empresa_id = $1`,
      [leadBia],
    );
    resposta = (e) => [
      {
        quadroId: e.quadros[0]!.id,
        colunaId: coluna('Vai pensar'),
        trecho: 'Vou pensar',
        motivo: 'Ficou de pensar.',
        mensagemId: nova,
      },
    ];
    await rodadaQuadros(pool, servicos, log);
    expect((await bia.get(`/quadros/${quadro.id}/cartoes`)).body[0]).toMatchObject({
      colunaId: null,
      sugeridaId: coluna('Vai pensar'),
    });
    // Descartou: como ainda não estava no quadro, sai.
    expect((await bia.enviar('post', `/quadros/${quadro.id}/cartoes/${leadBia}/descartar`)).status).toBe(200);
    expect((await bia.get(`/quadros/${quadro.id}/cartoes`)).body).toHaveLength(0);

    // Quadro sem IA: a conversa nova não vai para a IA.
    await ana.enviar('put', `/quadros/${quadro.id}`, {
      nome: 'Objeções',
      ia: false,
      colunas: quadro.colunas,
    });
    await mensagem(leadBia, 'recebida', 'Achei caro de novo', 4);
    const n = lidas.length;
    expect(await rodadaQuadros(pool, servicos, log)).toBe(0);
    expect(lidas.length).toBe(n);
    expect((await ana.enviar('delete', `/quadros/${quadro.id}`)).body).toEqual([]);
  });
});
