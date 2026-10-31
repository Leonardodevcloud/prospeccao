import { criarPool, migrar, type Pool } from '@prospeccao/db';
import { bancoDeTeste } from '@prospeccao/db/teste';
import type { Armazenamento } from '@prospeccao/integrations/reuniao';
import type { ServicoTelefonia } from '@prospeccao/integrations/telefonia';
import { criarLogger, type ResumoLigacao } from '@prospeccao/shared';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { criarApp } from '../src/app.js';
import { comConta } from '../src/contexto.js';
import {
  type DepsProcessarLigacoes,
  processarLigacao,
  rodarLigacoes,
} from '../src/modulos/ligacoes/processar.js';
import { esquecerRecursos } from '../src/recursos.js';
import type { ServicosConta } from '../src/servicos.js';

const URL_TESTE = process.env.TEST_DATABASE_URL;
const ORIGEM = 'http://localhost:5173';

describe.skipIf(!URL_TESTE)('Ligações: ligar, gravar, resumo da IA e o "Como foi?"', () => {
  let pool: Pool;
  let app: ReturnType<typeof criarApp>;
  let cookie = '';
  let empresaId = 0;
  const log = criarLogger('teste', (process.env.LOG_TESTE as 'error') ?? 'silent');

  // A telefonia e o armazenamento de verdade ficam de fora.
  const chamadas: { tipo: string; dados: unknown }[] = [];
  const arquivos = new Map<string, Uint8Array>();
  let estadoLead: 'discando' | 'tocando' | 'atendida' | 'encerrada' | null = 'atendida';
  const telefonia: ServicoTelefonia = {
    urlCliente: 'wss://teste.livekit.cloud',
    acesso: async (p) => `token-${p.identidade}-${p.sala}`,
    abrirSala: async (sala) => {
      chamadas.push({ tipo: 'sala', dados: sala });
    },
    discar: async (p) => {
      chamadas.push({ tipo: 'discar', dados: p });
    },
    encerrar: async (sala) => {
      chamadas.push({ tipo: 'encerrar', dados: sala });
    },
    estado: async () => estadoLead,
    testar: async () => 'ok (tronco teste)',
  };
  const armazenamento = {
    urlAssinada: async (chave: string) => `https://arquivos.test/${chave}`,
    enviar: async (chave: string, corpo: Uint8Array) => {
      arquivos.set(chave, corpo);
    },
    apagar: async (chaves: string[]) => {
      for (const c of chaves) arquivos.delete(c);
    },
  } as unknown as Armazenamento;
  let resumoFalso: ResumoLigacao | null = null;

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
    ligacao: {
      resumir: async (e) => {
        chamadas.push({ tipo: 'resumir', dados: e });
        return resumoFalso;
      },
    },
  });

  const ler = (rota: string) => request(app).get(rota).set('Cookie', cookie);
  const enviar = (metodo: 'post' | 'put' | 'patch' | 'delete', rota: string, corpo?: object) =>
    request(app)[metodo](rota).set('Origin', ORIGEM).set('Cookie', cookie).send(corpo);
  const audio = (id: number, quem: string, texto: string) =>
    request(app)
      .post(`/ligacoes/${id}/audios/${quem}?deslocamento=0`)
      .set('Origin', ORIGEM)
      .set('Cookie', cookie)
      .set('Content-Type', 'audio/webm')
      .send(Buffer.from(texto));
  // Para rodar o processamento direto (o mesmo que o motor faz a cada 15 s).
  const deps: DepsProcessarLigacoes = {
    pool: null as unknown as Pool,
    log,
    servicos,
    telefonia: {
      servico: telefonia,
      armazenamento,
      transcricao: { baseUrl: 'https://api.groq.com/openai/v1', chave: 'x', modelo: 'whisper' },
      fala: null,
    },
  };

  beforeAll(async () => {
    pool = criarPool({ url: await bancoDeTeste(URL_TESTE!, 'ligacoes'), aplicacao: 'teste-lig', max: 4 });
    await migrar(pool, log);
    deps.pool = pool;
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
      telefonia: {
        servico: telefonia,
        armazenamento,
        // A transcrição de verdade é trocada pelo fetch simulado abaixo.
        transcricao: { baseUrl: 'https://api.groq.com/openai/v1', chave: 'x', modelo: 'whisper' },
        fala: { falar: async (t) => new TextEncoder().encode(`mp3:${t}`) },
      },
    });
    const ok = await request(app)
      .post('/auth/login')
      .set('Origin', ORIGEM)
      .send({ email: 'dona@exemplo.com', senha: 'senha-forte-123' });
    expect(ok.status).toBe(200);
    cookie = (ok.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    expect(
      (await enviar('post', '/nichos', { nome: 'Saúde', cnaes: ['8630-5/04'], termosMaps: ['clínica'] }))
        .status,
    ).toBe(201);
    const lead = await enviar('post', '/funil/leads', {
      empresa: 'Clínica Sorriso Pleno',
      contato: 'Fernanda Rocha',
      telefone: '(71) 99876-5432',
      cidade: 'Salvador',
      uf: 'BA',
    });
    expect(lead.status).toBe(201);
    empresaId = lead.body.empresaId;
    // Outros números do lead: o fixo da Receita e o do Google.
    await pool.query(
      `UPDATE descoberta.empresas SET maps_telefone = '7132458800', telefones_receita = '{7130124455}' WHERE id = $1`,
      [empresaId],
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('sem número da empresa não liga e explica; o master cadastra o número', async () => {
    const s = await ler('/ligacoes/situacao');
    expect(s.body).toMatchObject({ modulo: true, disponivel: false, motivo: 'sem_numero', gravacao: true });
    const r = await enviar('post', '/ligacoes', { empresaId, telefone: '71998765432' });
    expect(r.status).toBe(422);
    expect(r.body.erro.mensagem).toMatch(/não tem número/);
    const n = await enviar('post', '/master/contas/1/telefonia/numeros', {
      numero: '(71) 3333-0400',
      rotulo: 'Salvador',
    });
    expect(n.status).toBe(201);
    await enviar('post', '/master/contas/1/telefonia/numeros', {
      numero: '11 4003-2210',
      rotulo: 'São Paulo',
    });
    const m = await ler('/master/contas/1/telefonia');
    expect(
      m.body.numeros.map((x: { numero: string; principal: boolean }) => [x.numero, x.principal]),
    ).toEqual([
      ['7133330400', true],
      ['1140032210', false],
    ]);
    expect(m.body.telefonia).toBe('ok (tronco teste)');
    expect((await ler('/ligacoes/situacao')).body.disponivel).toBe(true);
  });

  it('os números do lead vêm de todas as fontes, na ordem de ligar', async () => {
    const r = await ler(`/ligacoes/lead/${empresaId}`);
    expect(r.status).toBe(200);
    expect(r.body.telefones.map((t: { numero: string; ordem: number }) => [t.numero, t.ordem])).toEqual([
      ['71998765432', 1],
      ['7132458800', 2],
      ['7130124455', 3],
    ]);
  });

  it('liga: prepara a sala, disca com o número do mesmo DDD, atende, desliga, grava e resume', async () => {
    const r = await enviar('post', '/ligacoes', { empresaId, telefone: '71998765432' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      numeroEmpresa: '7133330400',
      lead: 'Clínica Sorriso Pleno',
      gravar: true,
      aviso: { falado: true },
    });
    expect(r.body.token).toMatch(/^token-u\d+-lig-1-/);
    const id = r.body.id as number;
    expect((await enviar('post', `/ligacoes/${id}/discar`)).status).toBe(200);
    expect(chamadas.find((c) => c.tipo === 'discar')?.dados).toMatchObject({
      numero: '71998765432',
      de: '7133330400',
      toqueSegundos: 25,
    });
    await enviar('post', `/ligacoes/${id}/estado`, { evento: 'tocando' });
    await enviar('post', `/ligacoes/${id}/estado`, { evento: 'atendeu' });
    // Passaram 2 minutos e 10 segundos de conversa.
    await pool.query(
      `UPDATE comercial.ligacoes SET atendida_em = now() - interval '130 seconds' WHERE id = $1`,
      [id],
    );
    await enviar('post', `/ligacoes/${id}/estado`, { evento: 'encerrou', motivo: 'desligou' });
    const fim = await ler(`/ligacoes/${id}`);
    expect(fim.body).toMatchObject({ situacao: 'encerrada', processamento: 'aguardando' });
    expect(fim.body.duracaoSegundos).toBeGreaterThanOrEqual(129);
    expect(chamadas.some((c) => c.tipo === 'encerrar')).toBe(true);

    // O navegador manda os dois lados e a conversa junta.
    expect((await audio(id, 'voce', 'voz-do-comercial')).status).toBe(200);
    expect((await audio(id, 'lead', 'voz-do-lead')).status).toBe(200);
    expect((await audio(id, 'conversa', 'conversa')).status).toBe(200);
    expect([...arquivos.keys()].sort()).toEqual([
      `ligacoes/1/${id}/conversa.webm`,
      `ligacoes/1/${id}/lead.webm`,
      `ligacoes/1/${id}/voce.webm`,
    ]);

    // Transcrição (Whisper) simulada: cada lado fala.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: FormData }) => {
        const quem = String(init.body.get('url'));
        const segments = quem.includes('voce')
          ? [{ start: 0.5, end: 3, text: 'Oi, Fernanda! Aqui é da Nexo, tudo bem?' }]
          : [{ start: 3.5, end: 7, text: 'Tudo. Pode ser quinta às nove, com o meu sócio Dr. Paulo.' }];
        return new Response(JSON.stringify({ segments }), { status: 200 });
      }),
    );
    resumoFalso = {
      resumo: 'Fernanda topou uma demonstração na quinta às 9h com o sócio.',
      conversou: true,
      caixaPostal: false,
      clima: 'positivo',
      sentimento: 'Receptiva e curiosa',
      interesse: 'alto',
      destaques: [{ tipo: 'decisor', texto: 'Decide com o sócio, Dr. Paulo' }],
      proximoPasso: 'Mandar o convite da demonstração para os dois',
      sugestaoEtapa: 'reuniao',
      reuniao: { inicio: new Date(Date.now() + 3 * 86_400_000).toISOString(), texto: 'quinta às 9h' },
      contatos: [{ nome: 'Dr. Paulo', cargo: 'Sócio', telefone: null, decisor: true }],
      numeroCerto: true,
    };
    await rodarLigacoes(deps);
    const pronta = await ler(`/ligacoes/${id}`);
    expect(pronta.body).toMatchObject({ processamento: 'pronto', transcricao: 'pronta', clima: 'positivo' });
    expect(pronta.body.falas.map((f: { quem: string }) => f.quem)).toEqual(['voce', 'lead']);
    expect(pronta.body.audio).toBe(`https://arquivos.test/ligacoes/1/${id}/conversa.webm`);
    const pedido = chamadas.find((c) => c.tipo === 'resumir')?.dados as {
      falas: { quem: string }[];
      lead: string;
    };
    expect(pedido.lead).toBe('Clínica Sorriso Pleno');

    // "Como foi?": conversou, vai para Reunião com a reunião marcada e o contato novo.
    const { rows: etapas } = await pool.query<{ id: number }>(
      `SELECT id::int FROM comercial.etapas WHERE papel = 'reuniao' ORDER BY id LIMIT 1`,
    );
    const salvo = await enviar('post', `/ligacoes/${id}/resultado`, {
      resultado: 'conversou',
      etapaId: etapas[0]!.id,
      reuniao: { inicio: resumoFalso.reuniao!.inicio, sala: true },
      contatos: [{ nome: 'Dr. Paulo', cargo: 'Sócio', decisor: true }],
    });
    expect(salvo.status).toBe(200);
    expect(salvo.body.resultado).toBe('conversou');
    const ficha = await ler(`/funil/${empresaId}`);
    expect(ficha.body.oportunidade.etapa).toBe('reuniao');
    const historico = ficha.body.atividades.find((a: { tipo: string }) => a.tipo === 'ligacao');
    expect(historico.texto).toContain('demonstração na quinta');
    const { rows: tarefa } = await pool.query(
      `SELECT tipo, local FROM comercial.tarefas WHERE empresa_id = $1 AND tipo = 'reuniao'`,
      [empresaId],
    );
    expect(tarefa[0].local).toMatch(/\/r\//);
    const { rows: c } = await pool.query(
      `SELECT nome, decisor FROM comercial.contatos_lead WHERE empresa_id = $1 AND nome = 'Dr. Paulo'`,
      [empresaId],
    );
    expect(c[0]).toMatchObject({ decisor: true });
    // O número que atendeu fica confirmado (primeiro da lista).
    const tel = await ler(`/ligacoes/lead/${empresaId}`);
    expect(tel.body.telefones[0]).toMatchObject({ numero: '71998765432', confirmado: true });
    expect(tel.body.ligacoes[0]).toMatchObject({ resultado: 'conversou', clima: 'positivo' });
  });

  it('não atendeu: o número vai para o fim da fila; número errado sai da lista; "não ligar" bloqueia', async () => {
    const tentar = async (telefone: string, resultado: string, atender = false) => {
      const r = await enviar('post', '/ligacoes', { empresaId, telefone });
      const id = r.body.id as number;
      await enviar('post', `/ligacoes/${id}/discar`);
      if (atender) await enviar('post', `/ligacoes/${id}/estado`, { evento: 'atendeu' });
      await enviar('post', `/ligacoes/${id}/estado`, { evento: 'encerrou' });
      const s = await enviar('post', `/ligacoes/${id}/resultado`, { resultado });
      expect(s.status).toBe(200);
      return id;
    };
    const id = await tentar('7132458800', 'nao_atendeu');
    expect((await ler(`/ligacoes/${id}`)).body.processamento).toBe('sem_gravacao');
    await tentar('7130124455', 'numero_errado', true);
    const t = await ler(`/ligacoes/lead/${empresaId}`);
    const lista = t.body.telefones.map((x: { numero: string; ordem: number | null }) => [x.numero, x.ordem]);
    expect(lista).toEqual([
      ['71998765432', 1],
      ['7132458800', 2],
      ['7130124455', null],
    ]);
    await tentar('71998765432', 'nao_ligar', true);
    const bloqueado = await enviar('post', '/ligacoes', { empresaId, telefone: '71998765432' });
    expect(bloqueado.status).toBe(409);
    expect(bloqueado.body.erro.mensagem).toMatch(/não receber ligações/);
    await pool.query('UPDATE comercial.oportunidades SET nao_ligar_em = NULL WHERE empresa_id = $1', [
      empresaId,
    ]);
  });

  it('histórico, minutos do mês, configuração e o aviso falado', async () => {
    const h = await ler('/ligacoes?usuario=todos');
    expect(h.body.totais).toMatchObject({ feitas: 4, conversas: 1 });
    const s = await ler('/ligacoes/situacao');
    // 2 min 10 s arredonda para 3 minutos (+1 de cada atendida curta).
    expect(s.body.minutos.usados).toBeGreaterThanOrEqual(3);
    const cfg = await enviar('put', '/ligacoes/config', {
      gravar: true,
      avisoGravacao: 'Esta ligação é gravada para a sua segurança.',
      avisoFalado: true,
      transcrever: true,
      toqueSegundos: 30,
      mesmoDdd: true,
      guardarMeses: 6,
    });
    expect(cfg.status).toBe(200);
    expect(cfg.body.config.toqueSegundos).toBe(30);
    const aviso = await ler('/ligacoes/aviso');
    expect(aviso.headers['content-type']).toMatch(/audio\/mpeg/);
    expect(Buffer.from(aviso.body).toString()).toBe('mp3:Esta ligação é gravada para a sua segurança.');
  });

  it('a sala que fecha (aviso do LiveKit ou esquecida) encerra a ligação', async () => {
    const r = await enviar('post', '/ligacoes', { empresaId, telefone: '71998765432' });
    const id = r.body.id as number;
    await enviar('post', `/ligacoes/${id}/discar`);
    await enviar('post', `/ligacoes/${id}/estado`, { evento: 'atendeu' });
    estadoLead = null; // o LiveKit não tem mais a sala
    await pool.query(
      `UPDATE comercial.ligacoes SET iniciada_em = now() - interval '1 minute' WHERE id = $1`,
      [id],
    );
    await rodarLigacoes(deps);
    expect((await ler(`/ligacoes/${id}`)).body.situacao).toBe('encerrada');
    estadoLead = 'atendida';
    // Sem os arquivos 10 minutos depois: fica sem gravação, sem erro.
    await pool.query(
      `UPDATE comercial.ligacoes SET encerrada_em = now() - interval '11 minutes', processar_em = now() WHERE id = $1`,
      [id],
    );
    await comConta(1, () =>
      processarLigacao(deps, {
        id,
        contaId: 1,
        empresaId,
        usuarioId: null,
        encerradaEm: new Date(Date.now() - 11 * 60_000),
        duracaoSegundos: 30,
        tentativas: 0,
      }),
    );
    expect((await ler(`/ligacoes/${id}`)).body).toMatchObject({
      processamento: 'pronto',
      transcricao: 'sem_audio',
    });
  });

  it('é um módulo à parte: sem ele, não liga (o histórico continua visível)', async () => {
    await pool.query(`UPDATE cadastro.organizacoes SET plano = 'time', modulos = '{}'`);
    esquecerRecursos();
    const r = await enviar('post', '/ligacoes', { empresaId, telefone: '71998765432' });
    expect(r.status).toBe(403);
    expect(r.body.erro.mensagem).toMatch(/módulo à parte/);
    expect((await ler('/ligacoes?usuario=todos')).status).toBe(200);
    expect((await ler('/ligacoes/situacao')).body).toMatchObject({ modulo: false, motivo: 'fora_do_plano' });
    await pool.query(`UPDATE cadastro.organizacoes SET modulos = '{ligacoes}'`);
    esquecerRecursos();
    expect((await ler('/ligacoes/situacao')).body.minutos.franquia).toBe(2000);
    await pool.query(`UPDATE cadastro.organizacoes SET plano = NULL, modulos = '{}'`);
    esquecerRecursos();
  });
});
