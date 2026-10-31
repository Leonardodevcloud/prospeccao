import { createHmac } from 'node:crypto';
import { criarPool, migrar, type Pool } from '@prospeccao/db';
import { bancoDeTeste } from '@prospeccao/db/teste';
import { criarLogger } from '@prospeccao/shared';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../src/app.js';
import { type ClienteMeta, clienteMeta } from '../src/modulos/instagram/meta.js';
import { esquecerRecursos } from '../src/recursos.js';
import type { ServicosConta } from '../src/servicos.js';

const URL_TESTE = process.env.TEST_DATABASE_URL;
const ORIGEM = 'http://localhost:5173';
const SEGREDO = 's'.repeat(32);
const IG = '17841400000000001';
const PAGINA = '100000000000001';

describe.skipIf(!URL_TESTE)('Instagram: conexão, comente e receba, direct e formulários', () => {
  let pool: Pool;
  let app: ReturnType<typeof criarApp>;
  let cookie = '';
  const log = criarLogger('teste', (process.env.LOG_TESTE as 'error') ?? 'silent');

  // O que o sistema pediu à Meta (a Meta de verdade fica de fora).
  const chamadas: { tipo: string; dados: unknown }[] = [];
  const assinatura = clienteMeta({ appId: '123456', appSecret: SEGREDO });
  const meta: ClienteMeta = {
    tokenVerificacao: 'senha-do-webhook',
    urlDeLogin: (redirect, estado) =>
      `https://facebook.test/login?redirect=${encodeURIComponent(redirect)}&state=${estado}`,
    trocarCodigo: async (codigo) => {
      chamadas.push({ tipo: 'codigo', dados: codigo });
      return 'token-da-pessoa';
    },
    paginas: async () => [
      {
        id: PAGINA,
        nome: 'Nexo Sistemas',
        token: 'token-da-pagina',
        instagram: { id: IG, usuario: 'nexosistemas', nome: 'Nexo', seguidores: 18400, foto: null },
      },
      { id: '200', nome: 'Página sem Instagram', token: 'x', instagram: null },
    ],
    assinarPagina: async (id) => {
      chamadas.push({ tipo: 'assinar', dados: id });
    },
    desassinarPagina: async () => undefined,
    conferirAssinatura: (corpo, a) => assinatura.conferirAssinatura(corpo, a),
    contaInstagram: async (id) => ({
      id,
      usuario: 'nexosistemas',
      nome: 'Nexo',
      seguidores: 18500,
      foto: null,
    }),
    publicacoes: async () => [
      {
        id: 'M1',
        legenda: 'Checklist de prospecção B2B',
        tipo: 'REELS',
        link: 'https://ig/p/1',
        imagem: null,
        em: '2026-10-25T10:00:00Z',
        comentarios: 3,
      },
    ],
    publicacao: async (id) =>
      id === 'M2'
        ? {
            id: 'M2',
            legenda: 'Post novo',
            tipo: 'IMAGE',
            link: null,
            imagem: null,
            em: new Date().toISOString(),
            comentarios: 0,
          }
        : {
            id,
            legenda: 'Checklist de prospecção B2B',
            tipo: 'REELS',
            link: 'https://ig/p/1',
            imagem: null,
            em: '2026-10-25T10:00:00Z',
            comentarios: 3,
          },
    responderComentario: async (comentarioId, texto) => {
      chamadas.push({ tipo: 'comentario', dados: { comentarioId, texto } });
    },
    respostaPrivada: async (_pagina, comentarioId, m) => {
      chamadas.push({ tipo: 'privada', dados: { comentarioId, ...m } });
      return `mid-privada-${comentarioId}`;
    },
    enviarDirect: async (_pagina, pessoa, texto) => {
      chamadas.push({ tipo: 'direct', dados: { pessoa, texto } });
      return `mid-${chamadas.length}`;
    },
    perfil: async (id) => (id === 'P1' ? { nome: 'Marina Souza', usuario: 'marinasouza.vendas' } : null),
    formularios: async () => [{ id: 'F1', nome: 'Diagnóstico gratuito', status: 'ACTIVE' }],
    perguntas: async () => ({
      nome: 'Diagnóstico gratuito',
      perguntas: [
        { chave: 'full_name', rotulo: 'Nome completo', tipo: 'FULL_NAME' },
        { chave: 'phone_number', rotulo: 'Telefone', tipo: 'PHONE' },
        { chave: 'company_name', rotulo: 'Empresa', tipo: 'COMPANY_NAME' },
        { chave: 'vendedores', rotulo: 'Quantos vendedores?', tipo: 'CUSTOM' },
      ],
    }),
    cadastro: async (id) => ({
      id,
      formId: 'F1',
      anuncio: 'Sua equipe prospecta no escuro?',
      campanha: 'Diagnóstico',
      plataforma: 'ig',
      em: new Date().toISOString(),
      respostas: [
        { chave: 'full_name', valores: ['Fernanda Rocha'] },
        { chave: 'phone_number', valores: ['+55 71 98812-4410'] },
        { chave: 'company_name', valores: ['Clínica Sorriso Pleno'] },
        { chave: 'vendedores', valores: ['3 a 5'] },
      ],
    }),
  };

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

  const ler = (rota: string) => request(app).get(rota).set('Cookie', cookie);
  const enviar = (metodo: 'post' | 'put' | 'patch' | 'delete', rota: string, corpo?: object) =>
    request(app)[metodo](rota).set('Origin', ORIGEM).set('Cookie', cookie).send(corpo);
  const aviso = (corpo: object, segredo = SEGREDO) => {
    const cru = JSON.stringify(corpo);
    return request(app)
      .post('/meta/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', `sha256=${createHmac('sha256', segredo).update(cru).digest('hex')}`)
      .send(cru);
  };
  const comentario = (id: string, texto: string, de: string, midia = 'M1') =>
    aviso({
      object: 'instagram',
      entry: [
        {
          id: IG,
          time: Math.floor(Date.now() / 1000),
          changes: [
            {
              field: 'comments',
              value: { id, text: texto, from: { id: de, username: `user_${de}` }, media: { id: midia } },
            },
          ],
        },
      ],
    });
  const direct = (de: string, texto: string, mid: string) =>
    aviso({
      object: 'instagram',
      entry: [
        {
          id: IG,
          time: Date.now(),
          messaging: [
            {
              sender: { id: de },
              recipient: { id: IG },
              timestamp: Date.now(),
              message: { mid, text: texto },
            },
          ],
        },
      ],
    });

  beforeAll(async () => {
    pool = criarPool({ url: await bancoDeTeste(URL_TESTE!, 'instagram'), aplicacao: 'teste-ig', max: 4 });
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
      meta,
    });
    const ok = await request(app)
      .post('/auth/login')
      .set('Origin', ORIGEM)
      .send({ email: 'dona@exemplo.com', senha: 'senha-forte-123' });
    expect(ok.status).toBe(200);
    cookie = (ok.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    // Lead à mão precisa de um nicho (ele guia a nota e a IA).
    const n = await enviar('post', '/nichos', {
      nome: 'Serviços',
      cnaes: ['8630-5/04'],
      termosMaps: ['clínica'],
    });
    expect(n.status).toBe(201);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('webhook: confere a senha do cadastro e a assinatura de cada aviso', async () => {
    const ok = await request(app).get(
      '/meta/webhook?hub.mode=subscribe&hub.verify_token=senha-do-webhook&hub.challenge=abc123',
    );
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('abc123');
    expect(
      (await request(app).get('/meta/webhook?hub.mode=subscribe&hub.verify_token=errada&hub.challenge=x'))
        .status,
    ).toBe(403);
    expect((await aviso({ object: 'instagram', entry: [] }, 'outro-segredo-qualquer')).status).toBe(401);
  });

  it('conecta pelo login da Meta e liga os avisos da página', async () => {
    expect((await ler('/instagram')).body).toMatchObject({ configurado: true, conexao: null });
    const r = await enviar('post', '/instagram/conexao');
    expect(r.status).toBe(200);
    const estado = new URL(r.body.url).searchParams.get('state')!;
    expect(new URL(r.body.url).searchParams.get('redirect')).toBe(`${ORIGEM}/api/meta/retorno`);
    const volta = await request(app).get(`/meta/retorno?code=CODIGO&state=${encodeURIComponent(estado)}`);
    expect(volta.status).toBe(302);
    expect(volta.headers.location).toBe(`${ORIGEM}/instagram?aba=conexao&conectado=1`);
    expect(chamadas).toContainEqual({ tipo: 'assinar', dados: PAGINA });
    const s = await ler('/instagram');
    expect(s.body.conexao).toMatchObject({
      usuario: 'nexosistemas',
      paginaNome: 'Nexo Sistemas',
      mensagensBloqueadas: false,
    });
    // O token nunca vai para a tela.
    expect(JSON.stringify(s.body)).not.toContain('token');
    // Estado adulterado: não conecta.
    expect((await request(app).get('/meta/retorno?code=X&state=falso')).status).toBe(400);
  });

  it('comente e receba: quem comenta a palavra recebe o direct (uma vez) e a resposta no comentário', async () => {
    const regra = await enviar('post', '/instagram/regras', {
      alvo: 'publicacao',
      midiaId: 'M1',
      palavras: ['PROSPECÇÃO', 'quero'],
      respostas: ['Te mandei no direct, {nome}! 📩'],
      mensagem: 'Oi, {nome}! Aqui está o checklist. Me passa seu WhatsApp?',
      botaoTexto: 'Baixar o checklist',
      botaoLink: 'nexo.com.br/checklist',
      iaContinua: false,
      etiquetas: ['instagram', 'checklist-b2b'],
    });
    expect(regra.status).toBe(201);
    expect(regra.body).toMatchObject({
      midiaLegenda: 'Checklist de prospecção B2B',
      botaoLink: 'https://nexo.com.br/checklist',
    });

    expect((await comentario('C1', 'Prospecção 🙋‍♀️', 'P1')).status).toBe(200);
    expect(chamadas).toContainEqual({
      tipo: 'privada',
      dados: {
        comentarioId: 'C1',
        texto: 'Oi, Marina! Aqui está o checklist. Me passa seu WhatsApp?',
        botao: { texto: 'Baixar o checklist', link: 'https://nexo.com.br/checklist' },
      },
    });
    expect(chamadas).toContainEqual({
      tipo: 'comentario',
      dados: { comentarioId: 'C1', texto: 'Te mandei no direct, Marina! 📩' },
    });
    // Sem a palavra, ou a mesma pessoa de novo: não manda.
    await comentario('C2', 'que legal esse vídeo', 'P2');
    await comentario('C3', 'quero!!', 'P1');
    // O mesmo aviso repetido pela Meta: não duplica.
    await comentario('C1', 'Prospecção 🙋‍♀️', 'P1');
    expect(chamadas.filter((c) => c.tipo === 'privada')).toHaveLength(1);
    const aberta = await ler(`/instagram/regras/${regra.body.id}`);
    expect(aberta.body.pessoas.map((p: { direct: string }) => p.direct).sort()).toEqual([
      'enviado',
      'repetido',
    ]);
  });

  it('a resposta no direct vira lead (com o WhatsApp do texto) e a conversa já tem o direct automático', async () => {
    expect((await direct('P1', 'quero sim! 71 99876-5432', 'mid-r1')).status).toBe(200);
    const { rows } = await pool.query(
      `SELECT o.empresa_id::int, o.instagram_usuario, o.etiquetas, o.origem_instagram, e.nome
         FROM comercial.oportunidades o JOIN descoberta.empresas e ON e.id = o.empresa_id WHERE o.instagram_id = 'P1'`,
    );
    expect(rows[0]).toMatchObject({
      nome: 'Marina Souza',
      instagram_usuario: 'marinasouza.vendas',
      etiquetas: ['instagram', 'checklist-b2b'],
      origem_instagram: { tipo: 'comentario', comentario: 'Prospecção 🙋‍♀️' },
    });
    const empresaId = rows[0].empresa_id as number;
    // Lead do Instagram não vai para o enriquecimento.
    const { rows: enr } = await pool.query(
      'SELECT enriquecimento_solicitado_em FROM descoberta.campanha_empresas WHERE empresa_id = $1',
      [empresaId],
    );
    expect(enr[0].enriquecimento_solicitado_em).toBeNull();
    const conversa = await ler(`/conversas/${empresaId}`);
    expect(conversa.body.telefone).toBe('71998765432');
    expect(conversa.body.instagramUsuario).toBe('marinasouza.vendas');
    expect(conversa.body.instagramAte).not.toBeNull();
    const ig = conversa.body.mensagens.filter((m: { canal: string }) => m.canal === 'instagram');
    expect(ig.map((m: { autor: string | null; texto: string }) => [m.autor, m.texto])).toEqual([
      ['Automático', 'Oi, Marina! Aqui está o checklist. Me passa seu WhatsApp?'],
      [null, 'quero sim! 71 99876-5432'],
    ]);
    // Na lista, com o filtro do canal.
    const lista = await ler('/conversas?canal=instagram');
    expect(lista.body.map((c: { empresaId: number }) => c.empresaId)).toEqual([empresaId]);
    // Mensagem repetida pela Meta: uma só.
    await direct('P1', 'quero sim! 71 99876-5432', 'mid-r1');
    const { rows: n } = await pool.query(
      `SELECT count(*)::int AS n FROM comercial.mensagens WHERE empresa_id = $1 AND direcao = 'recebida'`,
      [empresaId],
    );
    expect(n[0].n).toBe(1);

    // Responder pelo direct na conversa (dentro das 24 h).
    const r = await enviar('post', `/conversas/${empresaId}/instagram`, {
      texto: 'Te chamei no WhatsApp agora 👍',
    });
    expect(r.status).toBe(201);
    expect(chamadas).toContainEqual({
      tipo: 'direct',
      dados: { pessoa: 'P1', texto: 'Te chamei no WhatsApp agora 👍' },
    });
    // Fora da janela: avisa para seguir pelo WhatsApp.
    await pool.query(
      `UPDATE comercial.mensagens SET criado_em = now() - interval '2 days' WHERE empresa_id = $1`,
      [empresaId],
    );
    const fora = await enviar('post', `/conversas/${empresaId}/instagram`, { texto: 'Oi?' });
    expect(fora.status).toBe(422);
    expect(fora.body.erro.mensagem).toMatch(/24 horas/);

    const numeros = await ler('/instagram/regras');
    expect(numeros.body.total).toMatchObject({
      comentaram: 2,
      receberam: 1,
      responderam: 2,
      leads: 1,
      whatsapp: 1,
    });
  });

  it('"a próxima que eu postar" fica sendo a primeira publicação nova', async () => {
    const r = await enviar('post', '/instagram/regras', {
      alvo: 'proxima',
      palavras: ['demo'],
      mensagem: 'Oi! Segue o link da demonstração.',
    });
    expect(r.status).toBe(201);
    await comentario('C9', 'DEMO', 'P9', 'M2');
    const { rows } = await pool.query('SELECT alvo, midia_id FROM comercial.instagram_regras WHERE id = $1', [
      r.body.id,
    ]);
    expect(rows[0]).toEqual({ alvo: 'publicacao', midia_id: 'M2' });
    expect(chamadas.filter((c) => c.tipo === 'privada')).toHaveLength(2);
    // Quem não respondeu: "Criar lead" na lista da publicação.
    const pub = await ler(`/instagram/regras/${r.body.id}`);
    const criado = await enviar('post', `/instagram/interacoes/${pub.body.pessoas[0].id}/lead`);
    expect(criado.status).toBe(201);
    const { rows: o } = await pool.query(
      'SELECT instagram_id FROM comercial.oportunidades WHERE empresa_id = $1',
      [criado.body.empresaId],
    );
    expect(o[0].instagram_id).toBe('P9');
  });

  it('cadastro do formulário do anúncio cai no funil com o mapa de campos', async () => {
    const sinc = await enviar('post', '/instagram/formularios/sincronizar');
    expect(sinc.status).toBe(200);
    expect(sinc.body.formularios[0].perguntas.map((p: { campo: string }) => p.campo)).toEqual([
      'contato',
      'telefone',
      'empresa',
      'anotacao',
    ]);
    const f = sinc.body.formularios[0];
    const salvo = await enviar('put', `/instagram/formularios/${f.id}`, {
      ligado: true,
      perguntas: f.perguntas,
      etiquetas: ['instagram', 'diagnostico'],
      boasVindas: 'Oi, {nome}! Recebemos seu pedido de diagnóstico.',
      avisar: true,
    });
    expect(salvo.status).toBe(200);
    const r = await aviso({
      object: 'page',
      entry: [
        {
          id: PAGINA,
          time: Math.floor(Date.now() / 1000),
          changes: [{ field: 'leadgen', value: { leadgen_id: 'L1', form_id: 'F1', page_id: PAGINA } }],
        },
      ],
    });
    expect(r.status).toBe(200);
    const { rows } = await pool.query(
      `SELECT e.nome, o.etiquetas, o.origem_instagram, c.empresa_id::int
         FROM comercial.instagram_cadastros c JOIN descoberta.empresas e ON e.id = c.empresa_id
         JOIN comercial.oportunidades o ON o.empresa_id = c.empresa_id WHERE c.leadgen_id = 'L1'`,
    );
    expect(rows[0]).toMatchObject({
      nome: 'Clínica Sorriso Pleno',
      etiquetas: ['instagram', 'diagnostico'],
      origem_instagram: { tipo: 'formulario', anuncio: 'Sua equipe prospecta no escuro?', plataforma: 'ig' },
    });
    // Boas-vindas na fila do WhatsApp (sai pelo motor) e a anotação com a pergunta extra.
    const { rows: m } = await pool.query(
      `SELECT texto, origem, status, telefone FROM comercial.mensagens WHERE empresa_id = $1`,
      [rows[0].empresa_id],
    );
    expect(m[0]).toMatchObject({
      texto: 'Oi, Fernanda! Recebemos seu pedido de diagnóstico.',
      origem: 'automatico',
      status: 'aprovada',
      telefone: '71988124410',
    });
    const { rows: nota } = await pool.query(
      `SELECT texto FROM comercial.atividades WHERE empresa_id = $1 AND tipo = 'nota'`,
      [rows[0].empresa_id],
    );
    expect(nota.map((x) => x.texto).join('\n')).toContain('Quantos vendedores?: 3 a 5');
    // Repetido: um lead só.
    await aviso({
      object: 'page',
      entry: [{ id: PAGINA, changes: [{ field: 'leadgen', value: { leadgen_id: 'L1', form_id: 'F1' } }] }],
    });
    const { rows: n } = await pool.query(`SELECT count(*)::int AS n FROM comercial.instagram_cadastros`);
    expect(n[0].n).toBe(1);
    const lista = await ler('/instagram/formularios');
    expect(lista.body[0]).toMatchObject({ cadastros: 1, leads: 1, ultimoNome: 'Clínica Sorriso Pleno' });
  });

  it('é do plano Time em diante: no Start a tela mostra o cadeado e os avisos não fazem nada', async () => {
    await pool.query(`UPDATE cadastro.organizacoes SET plano = 'start'`);
    esquecerRecursos();
    expect((await ler('/instagram')).status).toBe(200);
    const r = await ler('/instagram/regras');
    expect(r.status).toBe(403);
    expect(r.body.erro.mensagem).toMatch(/plano Time/);
    const antes = chamadas.filter((c) => c.tipo === 'privada').length;
    await comentario('C50', 'quero', 'P50');
    expect(chamadas.filter((c) => c.tipo === 'privada')).toHaveLength(antes);
    await pool.query(`UPDATE cadastro.organizacoes SET plano = 'time'`);
    esquecerRecursos();
    expect((await ler('/instagram/regras')).status).toBe(200);
    await pool.query(`UPDATE cadastro.organizacoes SET plano = NULL`);
    esquecerRecursos();
  });

  it('desconectar apaga a conexão (as regras ficam)', async () => {
    const r = await enviar('delete', '/instagram/conexao');
    expect(r.body.conexao).toBeNull();
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM comercial.instagram_regras');
    expect(rows[0].n).toBe(2);
  });
});
