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
import { rodadaEntrada } from '../src/modulos/ligacoes/entrada.js';
import { relogio } from '../src/modulos/ligacoes/lista.js';
import {
  type DepsProcessarLigacoes,
  processarLigacao,
  rodarLigacoes,
} from '../src/modulos/ligacoes/processar.js';
import { tratarAvisoLigacao } from '../src/modulos/ligacoes/rotas.js';
import { avisarFranquia } from '../src/modulos/ligacoes/servico.js';
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
  // Ligações recebidas: quem ligou e para qual número, por sala.
  const chamadores = new Map<string, { de: string; para: string }>();
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
    chamador: async (sala) => chamadores.get(sala) ?? null,
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

  const appDeps = () =>
    ({ pool, log, telefonia: deps.telefonia }) as unknown as Parameters<typeof tratarAvisoLigacao>[0];
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
      receber: true,
      toqueDono: 20,
      toqueEntrada: 40,
      sigaMe: true,
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

  it('lista de ligação: monta, reserva o próximo, paralelo sem derrubar as outras linhas e tenta o próximo número', async () => {
    // Segunda-feira, 10h (a lista só disca no horário de ligar).
    relogio.agora = () => new Date('2026-11-02T10:00:00-03:00');
    try {
      const outro = await enviar('post', '/funil/leads', {
        empresa: 'Odonto Vida Center',
        telefone: '(71) 99123-0011',
        cidade: 'Salvador',
        uf: 'BA',
      });
      const outroId = outro.body.empresaId as number;
      const cand = await ler('/ligacoes/listas/candidatos?responsavel=todos');
      expect(cand.body.map((c: { empresaId: number }) => c.empresaId)).toEqual(
        expect.arrayContaining([empresaId, outroId]),
      );
      const criada = await enviar('post', '/ligacoes/listas', {
        empresaIds: [empresaId, outroId, 999999],
        linhas: 2,
        tentarProximo: true,
        pausaSegundos: 5,
      });
      expect(criada.status).toBe(201);
      expect(criada.body).toMatchObject({ entraram: 2, ficaramFora: 1 });
      const listaId = criada.body.listaId as number;
      expect(criada.body.lista.itens.map((i: { telefone: string }) => i.telefone)).toEqual([
        '71998765432',
        '71991230011',
      ]);

      // Duas linhas ao mesmo tempo: as duas ligações ficam abertas.
      const a = (await enviar('post', `/ligacoes/listas/${listaId}/proximo`)).body.item;
      const b = (await enviar('post', `/ligacoes/listas/${listaId}/proximo`)).body.item;
      expect([a.empresaId, b.empresaId]).toEqual([empresaId, outroId]);
      const la = await enviar('post', '/ligacoes', { empresaId, telefone: a.telefone, listaItemId: a.id });
      const lb = await enviar('post', '/ligacoes', {
        empresaId: outroId,
        telefone: b.telefone,
        listaItemId: b.id,
      });
      expect(la.status).toBe(201);
      expect(lb.status).toBe(201);
      expect((await ler(`/ligacoes/${la.body.id}`)).body.situacao).toBe('preparando');
      // O mesmo item não liga duas vezes.
      expect(
        (await enviar('post', '/ligacoes', { empresaId, telefone: a.telefone, listaItemId: a.id })).status,
      ).toBe(409);

      // A primeira atendeu: a outra linha é desligada e o item volta para o fim da fila.
      await enviar('post', `/ligacoes/${la.body.id}/estado`, { evento: 'atendeu' });
      await enviar('post', `/ligacoes/${lb.body.id}/desligar`);
      await enviar('post', `/ligacoes/listas/itens/${b.id}/devolver`);
      await enviar('post', `/ligacoes/${la.body.id}/estado`, { evento: 'encerrou' });
      await enviar('post', `/ligacoes/${la.body.id}/resultado`, { resultado: 'conversou' });

      // O lead da linha desligada volta; não atendeu: entra de novo com o próximo número.
      const c = (await enviar('post', `/ligacoes/listas/${listaId}/proximo`)).body.item;
      expect(c.empresaId).toBe(outroId);
      const lc = await enviar('post', '/ligacoes', {
        empresaId: outroId,
        telefone: c.telefone,
        listaItemId: c.id,
      });
      await enviar('post', `/ligacoes/${lc.body.id}/estado`, { evento: 'encerrou' });
      await enviar('post', `/ligacoes/${lc.body.id}/resultado`, { resultado: 'nao_atendeu' });
      const atual = await ler('/ligacoes/listas/atual');
      const naFila = atual.body.itens.filter((i: { situacao: string }) => i.situacao === 'na_fila');
      // O Odonto só tem um número: não volta. A lista acabou.
      expect(naFila).toHaveLength(0);
      expect((await enviar('post', `/ligacoes/listas/${listaId}/proximo`)).body.item).toBeNull();

      // Atendeu junto com outra linha e ouviu o recado: volta primeiro.
      const nova = await enviar('post', '/ligacoes/listas', { empresaIds: [outroId, empresaId], linhas: 3 });
      const l2 = nova.body.listaId as number;
      const x = (await enviar('post', `/ligacoes/listas/${l2}/proximo`)).body.item;
      const lx = await enviar('post', '/ligacoes', {
        empresaId: x.empresaId,
        telefone: x.telefone,
        listaItemId: x.id,
      });
      await enviar('post', `/ligacoes/${lx.body.id}/estado`, { evento: 'atendeu' });
      expect((await enviar('post', `/ligacoes/${lx.body.id}/retorno`)).status).toBe(200);
      const y = (await enviar('post', `/ligacoes/listas/${l2}/proximo`)).body.item;
      expect(y.empresaId).toBe(x.empresaId);
      // Fora do horário (domingo), a lista não anda.
      relogio.agora = () => new Date('2026-11-08T10:00:00-03:00');
      const fora = await enviar('post', `/ligacoes/listas/${l2}/proximo`);
      expect(fora.status).toBe(409);
      expect(fora.body.erro.mensagem).toMatch(/Fora do horário/);
      expect((await enviar('post', `/ligacoes/listas/${l2}/encerrar`)).body).toBeNull();
      await pool.query(`UPDATE comercial.ligacoes SET situacao = 'encerrada' WHERE situacao <> 'encerrada'`);
    } finally {
      relogio.agora = () => new Date();
    }
  });

  it('recebida: reconhece o lead, toca para o dono, depois para o time; o primeiro que atende leva', async () => {
    const { rows: u } = await pool.query<{ id: number }>(
      `SELECT id FROM cadastro.usuarios WHERE email = 'dona@exemplo.com'`,
    );
    const eu = u[0]!.id;
    await pool.query('UPDATE comercial.oportunidades SET responsavel_id = $1 WHERE empresa_id = $2', [
      eu,
      empresaId,
    ]);
    chamadores.set('lig-in-a', { de: '+5571998765432', para: '+557133330400' });
    await tratarAvisoLigacao(appDeps(), {
      tipo: 'entrou',
      id: 'x1',
      sala: 'lig-in-a',
      identidade: 'sip_+5571998765432',
      nome: 'Fernanda',
      em: new Date(),
    });
    const entrando = await ler('/ligacoes/entrando');
    expect(entrando.body[0]).toMatchObject({ empresaId, lead: 'Clínica Sorriso Pleno', meu: true });
    const id = entrando.body[0].id as number;
    const at = await enviar('post', `/ligacoes/${id}/atender`);
    expect(at.status).toBe(200);
    expect(at.body).toMatchObject({ sala: 'lig-in-a', direcao: 'entrada', empresaId });
    expect((await enviar('post', `/ligacoes/${id}/atender`)).status).toBe(409);
    expect((await ler('/ligacoes/entrando')).body).toHaveLength(0);
    await enviar('post', `/ligacoes/${id}/estado`, { evento: 'encerrou' });
    expect((await ler('/ligacoes?ver=recebidas&usuario=todos')).body.ligacoes[0]).toMatchObject({
      direcao: 'entrada',
    });

    // Número que não é lead: toca para o time na hora.
    chamadores.set('lig-in-b', { de: '+5571988401212', para: '+557133330400' });
    await tratarAvisoLigacao(appDeps(), {
      tipo: 'entrou',
      id: 'x2',
      sala: 'lig-in-b',
      identidade: 'sip_+5571988401212',
      nome: '',
      em: new Date(),
    });
    const desconhecido = (await ler('/ligacoes/entrando')).body[0];
    expect(desconhecido).toMatchObject({ empresaId: null, telefone: '71988401212', meu: false });
    // Ninguém atendeu em 40 s e o dono não tem celular: perdida (aviso + sem tarefa, não é lead).
    await pool.query(
      `UPDATE comercial.ligacoes SET iniciada_em = now() - interval '45 seconds' WHERE sala = 'lig-in-b'`,
    );
    await rodadaEntrada(pool, appDeps().telefonia!, log);
    const perdida = (await ler('/ligacoes?ver=perdidas&usuario=todos')).body.ligacoes;
    expect(perdida[0]).toMatchObject({ telefone: '71988401212' });
    // Quem ligou desligou antes: perdida também, com tarefa de retorno para o dono.
    chamadores.set('lig-in-c', { de: '+5571998765432', para: '+557133330400' });
    await tratarAvisoLigacao(appDeps(), {
      tipo: 'entrou',
      id: 'x3',
      sala: 'lig-in-c',
      identidade: 'sip_+5571998765432',
      nome: '',
      em: new Date(),
    });
    await tratarAvisoLigacao(appDeps(), {
      tipo: 'saiu',
      id: 'x4',
      sala: 'lig-in-c',
      identidade: 'sip_+5571998765432',
      em: new Date(),
    });
    const { rows: t } = await pool.query(
      `SELECT titulo FROM comercial.tarefas WHERE empresa_id = $1 AND tipo = 'ligacao' AND titulo LIKE 'Retornar%'`,
      [empresaId],
    );
    expect(t[0].titulo).toBe('Retornar a ligação de Clínica Sorriso Pleno');
    const { rows: n } = await pool.query(
      `SELECT titulo FROM comercial.notificacoes WHERE titulo LIKE 'Ligação perdida%'`,
    );
    expect(n.length).toBeGreaterThanOrEqual(2);

    // Siga-me: o dono tem celular na Equipe; ninguém atendeu no CRM, toca no celular dele.
    await pool.query(`UPDATE cadastro.usuarios SET telefone = '71999990000' WHERE id = $1`, [eu]);
    chamadores.set('lig-in-d', { de: '+5571998765432', para: '+557133330400' });
    await tratarAvisoLigacao(appDeps(), {
      tipo: 'entrou',
      id: 'x5',
      sala: 'lig-in-d',
      identidade: 'sip_+5571998765432',
      nome: '',
      em: new Date(),
    });
    await pool.query(
      `UPDATE comercial.ligacoes SET iniciada_em = now() - interval '45 seconds' WHERE sala = 'lig-in-d'`,
    );
    await rodadaEntrada(pool, appDeps().telefonia!, log);
    expect(chamadas.filter((c) => c.tipo === 'discar').at(-1)?.dados).toMatchObject({
      sala: 'lig-in-d',
      numero: '71999990000',
      identidade: 'siga-me',
    });
    estadoLead = 'atendida';
    await rodadaEntrada(pool, appDeps().telefonia!, log);
    estadoLead = null;
    await rodadaEntrada(pool, appDeps().telefonia!, log);
    const { rows: sm } = await pool.query(
      `SELECT situacao, siga_me, atendida_em IS NOT NULL AS atendida, perdida FROM comercial.ligacoes WHERE sala = 'lig-in-d'`,
    );
    expect(sm[0]).toMatchObject({
      situacao: 'encerrada',
      siga_me: '71999990000',
      atendida: true,
      perdida: false,
    });
    estadoLead = 'atendida';
  });

  it('relatório de ligações e o aviso de 80% da franquia', async () => {
    const r = await ler('/ligacoes/relatorio?dias=30');
    expect(r.status).toBe(200);
    expect(r.body.totais.feitas).toBeGreaterThanOrEqual(4);
    expect(r.body.totais.recebidas).toBeGreaterThanOrEqual(1);
    expect(r.body.porPessoa[0]).toMatchObject({ nome: expect.any(String) });
    expect(r.body.mapa.length).toBeGreaterThan(0);
    await pool.query(
      `UPDATE cadastro.organizacoes SET plano = 'time', modulos = '{ligacoes}', limite_minutos_ligacao = 3`,
    );
    esquecerRecursos();
    await comConta(1, () => avisarFranquia(pool));
    await comConta(1, () => avisarFranquia(pool));
    const { rows } = await pool.query(
      `SELECT titulo FROM comercial.notificacoes WHERE titulo LIKE 'Os minutos de ligação%'`,
    );
    expect(rows).toHaveLength(1);
    await pool.query(
      `UPDATE cadastro.organizacoes SET plano = NULL, modulos = '{}', limite_minutos_ligacao = NULL`,
    );
    esquecerRecursos();
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
