import { criarPool, migrar, type Pool } from '@prospeccao/db';
import { bancoDeTeste } from '@prospeccao/db/teste';
import type { AvaliacaoAtendimento, EntradaAtendimento } from '@prospeccao/integrations/atendimento';
import { criarLogger } from '@prospeccao/shared';
import { inicioDaSemana } from '@prospeccao/shared/atendimento';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../src/app.js';
import { rodadaAtendimento } from '../src/modulos/atendimento/avaliacao.js';
import type { ServicosConta } from '../src/servicos.js';

const URL_TESTE = process.env.TEST_DATABASE_URL;
const ORIGEM = 'http://localhost:5173';

/** Um dia útil recente (ontem ou anteontem, nunca domingo) às 10h de Brasília. */
function diaUtilRecente(): Date {
  let d = new Date(Date.now() - 86_400_000);
  const domingo = () =>
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(d) === 'Sun';
  if (domingo()) d = new Date(d.getTime() - 86_400_000);
  const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
  return new Date(`${dia}T10:00:00-03:00`);
}

describe.skipIf(!URL_TESTE)('qualidade do atendimento (com Postgres)', () => {
  let pool: Pool;
  let app: ReturnType<typeof criarApp>;
  let master = '';
  let contaId = 0;
  let ip = 0;
  const log = criarLogger('teste', 'silent');
  const avaliados: EntradaAtendimento[] = [];
  const AVALIACAO: AvaliacaoAtendimento = {
    respondeu: { nota: 9, comentario: 'Deu as marcas e o preço', trecho: 'R$ 139,90', sugestao: null },
    conduziu: {
      nota: 8,
      comentario: 'Perguntou a preferência',
      trecho: 'Qual você prefere?',
      sugestao: null,
    },
    proximo_passo: {
      nota: 3,
      comentario: 'Terminou sem combinar nada',
      trecho: 'Combinado!',
      sugestao: 'Quer que eu já separe a Cobreq para o motoboy das 14h?',
    },
    tom: { nota: 9, comentario: 'Cordial', trecho: null, sugestao: null },
  };
  const servicos = async (id: number): Promise<ServicosConta> =>
    ({
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
      iaDescricao: 'DeepSeek · deepseek-flash',
      erro: null,
      atendimento: {
        avaliar: async (e: EntradaAtendimento) => {
          avaliados.push(e);
          return AVALIACAO;
        },
      },
    }) as ServicosConta;
  const cookieDe = (r: request.Response) =>
    ((r.headers['set-cookie'] as unknown as string[] | undefined) ?? [])[0]?.split(';')[0] ?? '';
  const entrar = (email: string, senha: string) =>
    request(app)
      .post('/auth/login')
      .set('Origin', ORIGEM)
      .set('X-Forwarded-For', `10.91.${Math.floor(++ip / 250)}.${ip % 250}`)
      .send({ email, senha });
  const comoMaster = (metodo: 'post' | 'patch' | 'put', rota: string, corpo?: object) =>
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
  let biaId = 0;
  let caioId = 0;
  let leadBia = 0;
  let leadCaio = 0;
  const base = diaUtilRecente();
  const semana = inicioDaSemana(base);
  const em = (min: number) => new Date(base.getTime() + min * 60_000);
  const mensagem = (
    empresaId: number,
    direcao: 'enviada' | 'recebida',
    texto: string,
    quando: Date,
    d: { origem?: string; usuarioId?: number | null } = {},
  ) =>
    pool.query(
      `INSERT INTO comercial.mensagens (conta_id, empresa_id, direcao, texto, status, origem, usuario_id, criado_em)
       VALUES ($1, $2, $3, $4, $3, $5, $6, $7)`,
      [
        contaId,
        empresaId,
        direcao,
        texto,
        d.origem ?? (direcao === 'recebida' ? 'lead' : 'humano'),
        d.usuarioId ?? null,
        quando,
      ],
    );

  beforeAll(async () => {
    pool = criarPool({
      url: await bancoDeTeste(URL_TESTE!, 'atendimento'),
      aplicacao: 'teste-atendimento',
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
        jwtSegredo: 'a'.repeat(40),
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
      nome: 'Auto Peças Horizonte',
      primeiroAcesso: 'admin',
      admin: { nome: 'Ana Admin', email: 'ana@horizonte.com.br' },
      plano: { plano: 'time', modulos: [] },
    });
    expect(r.status).toBe(201);
    contaId = r.body.id;
    for (const [nome, email] of [
      ['Bia Rocha', 'bia@horizonte.com.br'],
      ['Caio Lopes', 'caio@horizonte.com.br'],
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
          await comoMaster('patch', `/master/usuarios/${await idDe(`${e}@horizonte.com.br`)}/acesso`, {
            senha: 'Senha-forte-1',
          })
        ).status,
      ).toBe(200);
    ana = como(cookieDe(await entrar('ana@horizonte.com.br', 'Senha-forte-1')));
    bia = como(cookieDe(await entrar('bia@horizonte.com.br', 'Senha-forte-1')));
    caio = como(cookieDe(await entrar('caio@horizonte.com.br', 'Senha-forte-1')));
    biaId = await idDe('bia@horizonte.com.br');
    caioId = await idDe('caio@horizonte.com.br');
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
      ['Oficina do Joel', biaId, '71999990011'],
      ['Mecânica Rápida', caioId, '71999990012'],
    ] as const) {
      const l = await ana.enviar('post', '/funil/leads', { empresa: nome, telefone });
      expect(l.status).toBe(201);
      await ana.enviar('patch', `/funil/${l.body.empresaId}`, { responsavelId: dono });
      if (dono === biaId) leadBia = l.body.empresaId;
      else leadCaio = l.body.empresaId;
    }
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  it('conversa parada há 2 horas vira nota: quem mais escreveu é avaliado, a IA do WhatsApp não conta', async () => {
    await mensagem(leadBia, 'recebida', 'Bom dia, tem pastilha de freio pro Onix 2019?', em(0));
    await mensagem(leadBia, 'enviada', 'Tenho sim, da Cobreq e da Fras-le. Qual você prefere?', em(4), {
      usuarioId: biaId,
    });
    await mensagem(leadBia, 'recebida', 'Qual a diferença de preço?', em(6));
    await mensagem(leadBia, 'enviada', 'Cobreq R$ 139,90 e Fras-le R$ 162,00.', em(10), { usuarioId: biaId });
    await mensagem(leadBia, 'enviada', 'Lembrete automático', em(11), { origem: 'agente' });
    await mensagem(leadBia, 'recebida', 'Vou ver aqui e te falo', em(15));
    await mensagem(leadBia, 'enviada', 'Combinado!', em(16), { usuarioId: biaId });
    // Só 2 mensagens do Caio: não vira nota.
    await mensagem(leadCaio, 'recebida', 'Tem amortecedor?', em(0));
    await mensagem(leadCaio, 'enviada', 'Tenho', em(5), { usuarioId: caioId });
    await mensagem(leadCaio, 'enviada', 'Quer?', em(6), { usuarioId: caioId });

    expect(await rodadaAtendimento(pool, servicos, log)).toBe(2);
    expect(avaliados).toHaveLength(1);
    expect(avaliados[0]).toMatchObject({ tipo: 'conversa', vendedor: 'Bia Rocha', lead: 'Oficina do Joel' });
    expect(avaliados[0]!.falas.map((f) => f.quem)).toEqual([
      'lead',
      'equipe',
      'lead',
      'equipe',
      'outro',
      'lead',
      'equipe',
    ]);
    const { rows } = await pool.query(
      'SELECT tipo, usuario_id, nota_ia::float AS nota, primeira_resposta_min, media_resposta_min, criterios FROM comercial.atendimento_notas',
    );
    expect(rows).toHaveLength(1);
    // Tempo: esperas de 4, 4 e 1 minuto (média 3) → 10; IA: 9, 8, 3, 9 → média 7,8.
    expect(rows[0]).toMatchObject({
      tipo: 'conversa',
      usuario_id: biaId,
      nota: 7.8,
      primeira_resposta_min: 4,
      media_resposta_min: 3,
    });
    expect(rows[0].criterios.tempo).toMatchObject({
      nota: 10,
      comentario: 'Primeira resposta em 4 min; média de 3 min.',
    });
    // A mesma conversa não é avaliada de novo.
    expect(await rodadaAtendimento(pool, servicos, log)).toBe(0);
  });

  it('conversa ainda acontecendo (menos de 2 horas parada) espera', async () => {
    await mensagem(leadBia, 'recebida', 'Pode separar a Cobreq', new Date(Date.now() - 30 * 60_000));
    expect(await rodadaAtendimento(pool, servicos, log)).toBe(0);
    expect(avaliados).toHaveLength(1);
  });

  it('o painel da equipe é do gestor; cada um vê o próprio resumo', async () => {
    const p = await ana.get(`/atendimento/painel?semana=${semana}`);
    expect(p.status).toBe(200);
    expect(p.body.equipe).toMatchObject({
      nota: 7.8,
      atendimentos: 1,
      conversas: 1,
      primeiraRespostaMin: 4,
      proximoPassoPct: 0,
    });
    expect(p.body.pesou).toEqual([
      { criterio: 'proximo_passo', texto: 'Terminou sem próximo passo combinado', quantos: 1 },
    ]);
    expect(p.body.vendedores).toHaveLength(1);
    expect(p.body.vendedores[0]).toMatchObject({
      nome: 'Bia Rocha',
      treinar: { criterio: 'proximo_passo', abaixo: 1, exemplo: { trecho: 'Combinado!' } },
      forte: { criterio: 'tempo' },
    });
    expect((await bia.get(`/atendimento/painel?semana=${semana}`)).status).toBe(403);
    const eu = await bia.get(`/atendimento/eu?semana=${semana}`);
    expect(eu.status).toBe(200);
    expect(eu.body.resumo).toMatchObject({ nome: 'Bia Rocha', atendimentos: 1, nota: 7.8 });
    expect(eu.body.semanas).toHaveLength(4);
    expect(eu.body.semanas.at(-1)).toEqual({ semana, nota: 7.8 });
    expect((await bia.get(`/atendimento/vendedor/${caioId}`)).status).toBe(403);
    expect((await ana.get(`/atendimento/vendedor/${biaId}?semana=${semana}`)).body.resumo.atendimentos).toBe(
      1,
    );
  });

  it('as notas do lead: o gestor vê todas, o vendedor só as próprias; a lista de conversas mostra a nota', async () => {
    expect((await ana.get(`/atendimento/lead/${leadBia}`)).body.notas).toHaveLength(1);
    expect((await bia.get(`/atendimento/lead/${leadBia}`)).body.notas).toHaveLength(1);
    expect((await caio.get(`/atendimento/lead/${leadBia}`)).body.notas ?? []).toHaveLength(0);
    const lista = await ana.get('/conversas');
    expect(lista.body.find((c: { empresaId: number }) => c.empresaId === leadBia).nota).toBe(7.8);
    expect(lista.body.find((c: { empresaId: number }) => c.empresaId === leadCaio).nota).toBeNull();
  });

  it('o gestor corrige a nota (com motivo) e manda o resumo; o vendedor não corrige', async () => {
    const id = (await ana.get(`/atendimento/lead/${leadBia}`)).body.notas[0].id;
    expect(
      (await bia.enviar('post', `/atendimento/notas/${id}/corrigir`, { nota: 10, motivo: 'Eu achei ótimo' }))
        .status,
    ).toBe(403);
    expect(
      (await ana.enviar('post', `/atendimento/notas/${id}/corrigir`, { nota: 8, motivo: 'x' })).status,
    ).toBe(422);
    const c = await ana.enviar('post', `/atendimento/notas/${id}/corrigir`, {
      nota: 8.5,
      motivo: 'O cliente já tinha combinado a entrega por telefone',
    });
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ nota: 8.5, notaIa: 7.8, correcao: { nota: 8.5, por: 'Ana Admin' } });
    expect((await ana.get(`/atendimento/painel?semana=${semana}`)).body.equipe.nota).toBe(8.5);

    expect(
      (await ana.enviar('post', `/atendimento/vendedor/${caioId}/enviar?semana=${semana}`, {})).status,
    ).toBe(422);
    expect(
      (await ana.enviar('post', `/atendimento/vendedor/${biaId}/enviar?semana=${semana}`, {})).status,
    ).toBe(200);
    const { rows } = await pool.query(
      'SELECT titulo, link FROM comercial.notificacoes WHERE usuario_id = $1',
      [biaId],
    );
    expect(rows).toContainEqual({
      titulo: 'Seu resumo de atendimento da semana',
      link: `/qualidade?semana=${semana}`,
    });
  });

  it('ligação transcrita vira nota (sem tempo de resposta)', async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO comercial.ligacoes (conta_id, empresa_id, usuario_id, telefone, sala, situacao, iniciada_em, atendida_em,
                                       encerrada_em, processamento, transcricao)
       VALUES ($1, $2, $3, '71999990012', 'sala-teste-atendimento', 'encerrada', now() - interval '2 hours',
               now() - interval '2 hours', now() - interval '110 minutes', 'pronto', 'pronta') RETURNING id`,
      [contaId, leadCaio, caioId],
    );
    const ligacao = rows[0]!.id;
    for (const [i, quem, texto] of [
      [0, 'voce', 'Bom dia, aqui é o Caio da Horizonte'],
      [4000, 'lead', 'Oi, Caio'],
      [8000, 'voce', 'Vi que você procurou amortecedor'],
      [12000, 'lead', 'Isso, pro Gol'],
      [16000, 'voce', 'Tenho o Cofap, te mando o preço'],
    ] as const)
      await pool.query(
        `INSERT INTO comercial.ligacao_falas (ligacao_id, conta_id, quem, nome, inicio_ms, fim_ms, texto)
         VALUES ($1, $2, $3, $4, $5, $5 + 3000, $6)`,
        [ligacao, contaId, quem, quem === 'voce' ? 'Caio' : 'Lead', i, texto],
      );
    avaliados.length = 0;
    expect(await rodadaAtendimento(pool, servicos, log)).toBe(1);
    expect(avaliados[0]).toMatchObject({ tipo: 'ligacao', vendedor: 'Caio Lopes' });
    expect(avaliados[0]!.falas.map((f) => f.quem)).toEqual(['equipe', 'lead', 'equipe', 'lead', 'equipe']);
    const n = await pool.query(
      `SELECT tipo, usuario_id, criterios ? 'tempo' AS com_tempo FROM comercial.atendimento_notas WHERE ligacao_id = $1`,
      [ligacao],
    );
    expect(n.rows[0]).toEqual({ tipo: 'ligacao', usuario_id: caioId, com_tempo: false });
    expect(await rodadaAtendimento(pool, servicos, log)).toBe(0);
  });

  it('plano sem o recurso: a tela avisa e a rotina não avalia', async () => {
    expect(
      (await comoMaster('put', `/master/contas/${contaId}/plano`, { plano: 'start', modulos: [] })).status,
    ).toBe(200);
    const r = await ana.get(`/atendimento/painel?semana=${semana}`);
    expect(r.status).toBe(403);
    expect(r.body.erro.codigo).toBe('fora_do_plano');
    expect(
      (await ana.get('/conversas')).body.find((c: { empresaId: number }) => c.empresaId === leadBia).nota,
    ).toBeNull();
    const antes = (await pool.query('SELECT count(*)::int AS n FROM comercial.atendimento_notas')).rows[0].n;
    await mensagem(leadCaio, 'recebida', 'Tem disco de freio?', em(30));
    for (const [i, t] of ['Tenho', 'Do Gol?', 'Te mando o preço'].entries())
      await mensagem(leadCaio, 'enviada', t, em(31 + i), { usuarioId: caioId });
    avaliados.length = 0;
    await rodadaAtendimento(pool, servicos, log);
    expect(avaliados).toHaveLength(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM comercial.atendimento_notas')).rows[0].n).toBe(
      antes,
    );
  });
});
