import { cifrarTokenChip, type Executor } from '@prospeccao/db';
import { avisoDePassagem, emBolhas } from '@prospeccao/integrations/agente';
import { eventoDeConexao, interpretarWebhook } from '@prospeccao/integrations/whatsapp';
import {
  AppError,
  aprovarRascunho,
  chipAtualizar,
  configAgenteEntrada,
  conhecimentoArquivo,
  conhecimentoAtualizar,
  conhecimentoEntrada,
  ensinarLacuna,
  indicacoesNoTexto,
} from '@prospeccao/shared';
import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { comConta, conta, contaSql } from '../../contexto.js';
import type { DepsApi, WhatsappConta } from '../../dependencias.js';
import { corpo, idDaRota } from '../../middlewares/http.js';
import { exigirAdmin } from '../../middlewares/seguranca.js';
import * as contatos from '../contatos/repositorio.js';
import { guardarMidia } from '../conversas/repositorio.js';
import { pararSequencia, RESPONDEU_WHATSAPP } from '../email/sequencia.js';
import { obterConfig as configCadencia } from '../funil/cadencia.js';
import { criarLeadManual, nomeDaConversa } from '../funil/novoLead.js';
import * as funil from '../funil/repositorio.js';
import { notificar, notificarDono } from '../notificacoes/repositorio.js';
import { pensar, regraFixa } from './atendimento.js';
import * as chips from './chips.js';
import * as base from './conhecimento.js';
import { desempenho } from './desempenho.js';
import { dentroDoHorario, proximaAbertura } from './horario.js';
import * as repo from './repositorio.js';

/**
 * Endereço público da API (para a Evolution chamar): API_URL_PUBLICA, ou o domínio que o Railway
 * informa (RAILWAY_PUBLIC_DOMAIN), ou o da própria requisição.
 */
function enderecoPublico(req: Request): string {
  const env = process.env.API_URL_PUBLICA?.replace(/\/$/, '');
  if (env) return env;
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return `${req.protocol}://${req.get('host')}`;
}

/** Tela do Agente: configuração, mensagens para revisar e leads que a IA passou para você. */
export function rotasAgente({ pool, log, servicos, credenciais }: DepsApi): Router {
  const r = Router();

  r.get('/', async (req: Request, res) => {
    const { whatsapp, ia, iaDescricao, origem } = await servicos(conta());
    const [config, resumo, rascunhos, pausados] = await Promise.all([
      repo.obterConfig(pool),
      repo.resumo(pool),
      repo.rascunhos(pool),
      repo.pausados(pool),
    ]);
    const { webhookToken, ...resto } = config;
    res.json({
      config: resto,
      // Endereço do webhook (a plataforma configura sozinha em cada número; aqui só para o master conferir).
      webhook: req.usuario?.master ? `${enderecoPublico(req)}/webhooks/whatsapp/${webhookToken}` : '',
      status: {
        // Tem WhatsApp de verdade: a Z-API da plataforma e ao menos um número conectado da conta.
        whatsapp: !!whatsapp && (await chips.emUso(pool)).length > 0,
        ia: !!ia,
        iaDescricao: req.usuario?.master ? iaDescricao : null,
        origem: { whatsapp: origem.whatsapp, ia: origem.ia },
      },
      resumo,
      rascunhos,
      pausados,
    });
  });

  /* Números de WhatsApp: o próprio cliente conecta, lendo o QR Code (instâncias da Z-API). */
  r.get('/chips', async (_req, res) => {
    const { whatsapp } = await servicos(conta());
    const [lista, limite] = await Promise.all([chips.listar(pool), chips.limiteDeNumeros(pool)]);
    res.json({
      chips: lista,
      // A plataforma tem a Z-API e a conta tem o módulo de WhatsApp.
      conectado: !!whatsapp?.criar,
      limite: limite.limite,
      usados: limite.usados,
    });
  });

  /** Número novo: cria a instância na Z-API (teste de 2 dias) com o webhook do sistema; o QR vem em seguida. */
  r.post('/chips', exigirAdmin, async (req, res) => {
    const { nome } = corpo(req, z.object({ nome: z.string().trim().min(2).max(60) }));
    const { whatsapp } = await servicos(conta());
    if (!whatsapp?.criar)
      throw AppError.invalido('O WhatsApp não está no seu plano. Fale com o suporte do Prospect Team.');
    const { limite, usados } = await chips.limiteDeNumeros(pool);
    if (limite != null && usados >= limite)
      throw AppError.invalido(
        `Seu plano permite ${limite} ${limite === 1 ? 'número' : 'números'} de WhatsApp. Para conectar mais, fale com o suporte do Prospect Team.`,
      );
    if (!credenciais.chave)
      throw AppError.invalido(
        'Conexão de números indisponível no momento. Fale com o suporte do Prospect Team.',
      );
    const { webhookToken } = await repo.obterConfig(pool);
    const nova = await whatsapp.criar(
      `${nome} · conta ${conta()}`,
      `${enderecoPublico(req)}/webhooks/whatsapp/${webhookToken}`,
    );
    const id = await chips.criarNumero(pool, {
      nome,
      instancia: nova.instancia,
      tokenCifrado: cifrarTokenChip(credenciais.chave, nova.token),
    });
    log.info({ chip: id }, 'agente: número novo criado na Z-API');
    res.status(201).json({ id, chips: await chips.listar(pool) });
  });

  /**
   * QR Code do número (a tela pede de novo a cada poucos segundos até conectar). Conectado: guarda o
   * número e assina a instância na primeira vez.
   */
  r.get('/chips/:id/qr', exigirAdmin, async (req, res) => {
    const chip = await chips.obter(pool, idDaRota(req));
    const { whatsapp } = await servicos(conta());
    if (!chip.zapi || !whatsapp?.qr)
      throw AppError.invalido('Este número é do sistema antigo: remova e conecte de novo.');
    const qr = await whatsapp.qr(chip.instancia);
    if (qr.conectado) await aoConectar(chip.id, whatsapp);
    res.json(qr);
  });

  /** Desconecta o número (para trocar de celular ou de número); a instância continua da conta. */
  r.post('/chips/:id/desconectar', exigirAdmin, async (req, res) => {
    const chip = await chips.obter(pool, idDaRota(req));
    const { whatsapp } = await servicos(conta());
    if (chip.zapi && whatsapp?.desconectar) await whatsapp.desconectar(chip.instancia);
    await chips.marcarConexao(pool, { id: chip.id }, false);
    res.json(await chips.listar(pool));
  });

  r.patch('/chips/:id', exigirAdmin, async (req, res) => {
    await chips.atualizar(pool, idDaRota(req), corpo(req, chipAtualizar));
    res.json(await chips.listar(pool));
  });

  /** Remove o número: cancela a instância na Z-API (para de cobrar) e apaga o chip. */
  r.delete('/chips/:id', exigirAdmin, async (req, res) => {
    const chip = await chips.obter(pool, idDaRota(req));
    const { whatsapp } = await servicos(conta());
    if (chip.zapi && whatsapp?.cancelar)
      await whatsapp.cancelar(chip.instancia).catch((erro) => {
        log.warn({ err: erro, chip: chip.id }, 'agente: não consegui cancelar a instância na Z-API');
      });
    await chips.apagar(pool, chip.id);
    res.json(await chips.listar(pool));
  });

  /** Confere se o número está conectado (e guarda para a tela e os alertas). */
  r.post('/chips/:id/testar', exigirAdmin, async (req, res) => {
    const chip = await chips.obter(pool, idDaRota(req));
    const { whatsapp } = await servicos(conta());
    if (!whatsapp?.estado || !chip.zapi)
      throw AppError.invalido('Este número é do sistema antigo: remova e conecte de novo.');
    let resultado: string;
    try {
      resultado = await whatsapp.estado(chip.instancia);
    } catch (erro) {
      resultado = erro instanceof Error ? erro.message : String(erro);
    }
    await chips.guardarEstado(pool, chip.id, resultado);
    if (resultado.startsWith('ok')) await aoConectar(chip.id, whatsapp);
    res.json({ ok: resultado.startsWith('ok'), resultado: resultado.slice(0, 300) });
  });

  /** Conectou: guarda e, na primeira vez, assina a instância (sai do teste de 2 dias). */
  async function aoConectar(chipId: number, whatsapp: WhatsappConta) {
    const m = await chips.marcarConexao(pool, { id: chipId }, true);
    if (m?.assinar && whatsapp.assinar) {
      try {
        await whatsapp.assinar(m.instancia);
        await chips.marcarAssinado(pool, m.id);
        log.info({ chip: m.id }, 'agente: instância assinada na Z-API');
      } catch (erro) {
        log.error({ err: erro, chip: m.id }, 'agente: não consegui assinar a instância na Z-API');
      }
    }
  }

  r.put('/config', exigirAdmin, async (req, res) => {
    const dados = corpo(req, configAgenteEntrada);
    await repo.salvarConfig(pool, dados);
    log.info({ ligado: dados.ligado, revisarAntes: dados.revisarAntes }, 'agente: configuração salva');
    res.json({ ok: true });
  });

  r.post('/rascunhos/:id/aprovar', async (req, res) => {
    const { texto } = corpo(req, aprovarRascunho);
    if (!(await repo.aprovar(pool, idDaRota(req), texto))) throw AppError.naoEncontrado('Rascunho');
    res.json({ ok: true });
  });

  r.post('/rascunhos/:id/descartar', async (req, res) => {
    if (!(await repo.descartar(pool, idDaRota(req)))) throw AppError.naoEncontrado('Rascunho');
    res.json({ ok: true });
  });

  r.get('/conversa/:empresaId', async (req, res) => {
    res.json(await repo.conversa(pool, idDaRota(req, 'empresaId')));
  });

  /* Base de conhecimento: o que a IA sabe, o que ela aprendeu e o que falta ensinar */
  r.get('/conhecimento', async (_req, res) => {
    const [itens, lacunas, numeros, verificacoes] = await Promise.all([
      base.listar(pool),
      base.lacunas(pool),
      base.numeros(pool),
      base.verificacoes(pool),
    ]);
    res.json({ itens, lacunas, numeros, verificacoes });
  });
  r.post('/conhecimento', exigirAdmin, async (req, res) => {
    const d = corpo(req, conhecimentoEntrada);
    const id = await base.criar(pool, { ...d, pergunta: d.tipo === 'faq' ? d.pergunta : null });
    res.status(201).json({ id });
  });
  /** PDF, TXT, Markdown ou CSV: o texto entra na base (o arquivo em si não é guardado). */
  r.post('/conhecimento/arquivo', exigirAdmin, async (req, res) => {
    const d = corpo(req, conhecimentoArquivo);
    const texto = await base.textoDoArquivo(d);
    const id = await base.criar(pool, {
      tipo: 'arquivo',
      titulo: d.titulo || d.nome.replace(/\.[a-z0-9]+$/i, ''),
      conteudo: texto.slice(0, 400_000),
      origem: 'arquivo',
    });
    res.status(201).json({ id, caracteres: texto.length });
  });
  r.patch('/conhecimento/:id', exigirAdmin, async (req, res) => {
    await base.atualizar(pool, idDaRota(req), corpo(req, conhecimentoAtualizar));
    res.json({ ok: true });
  });
  r.delete('/conhecimento/:id', exigirAdmin, async (req, res) => {
    await base.arquivar(pool, idDaRota(req));
    res.json({ ok: true });
  });
  /** Simula: o que a IA receberia da base se o lead escrevesse isto. */
  r.post('/conhecimento/testar', async (req, res) => {
    const { pergunta } = corpo(req, z.object({ pergunta: z.string().trim().min(2).max(1000) }));
    res.json(await base.buscarTrechos(pool, pergunta));
  });
  /** Responde uma pergunta que a IA não soube: vira pergunta e resposta da base, já valendo. */
  r.post('/lacunas/:id/ensinar', exigirAdmin, async (req, res) => {
    const d = corpo(req, ensinarLacuna);
    const lacuna = (await base.lacunas(pool)).find((l) => l.id === idDaRota(req));
    if (!lacuna) throw AppError.naoEncontrado('Pergunta');
    const pergunta = d.pergunta || String(lacuna.pergunta);
    const id = await base.criar(pool, {
      tipo: 'faq',
      titulo: pergunta.slice(0, 120),
      pergunta,
      conteudo: d.resposta,
    });
    await base.resolverLacuna(pool, lacuna.id, id);
    res.status(201).json({ id });
  });
  r.post('/lacunas/:id/dispensar', exigirAdmin, async (req, res) => {
    await base.resolverLacuna(pool, idDaRota(req), null);
    res.json({ ok: true });
  });

  /**
   * Simulador: conversa de teste com a IA, pelo mesmo caminho do atendimento de verdade (regras
   * fixas, base de conhecimento, verificações, reescrita), sem lead, sem WhatsApp e sem gravar nada.
   */
  r.post('/simular', async (req, res) => {
    const d = corpo(
      req,
      z.object({
        conversa: z
          .array(z.object({ de: z.enum(['lead', 'nos']), texto: z.string().trim().min(1).max(2000) }))
          .min(1)
          .max(40),
        memoria: z.array(z.string().max(200)).max(20).default([]),
        etapa: z.enum(['abordado', 'respondeu', 'reuniao', 'proposta']).default('respondeu'),
      }),
    );
    const cfg = await repo.obterConfig(pool);
    const aviso = (tipo: 'pediu_pessoa' | 'sensivel' | 'outro') =>
      cfg.avisoPassagem
        ? avisoDePassagem(
            { dentroDoHorario: dentroDoHorario(cfg), volta: proximaAbertura(cfg), motivo: tipo },
            0,
          )
        : null;
    const ultimas: string[] = [];
    for (let i = d.conversa.length - 1; i >= 0 && d.conversa[i]!.de === 'lead'; i--)
      ultimas.unshift(d.conversa[i]!.texto);
    const fixa = ultimas.length ? regraFixa(ultimas.join('\n')) : null;
    if (fixa)
      return res.json({
        regraFixa: fixa,
        aviso: fixa.tipo === 'parar' ? null : aviso(fixa.tipo),
      });
    const { ia } = await servicos(conta());
    if (!ia)
      throw AppError.invalido('A IA ainda não está ativa nesta conta. Fale com o suporte do Prospect Team.');
    const { rows } = await pool.query<{ nome: string }>(
      `SELECT nome FROM cadastro.contas WHERE id = ${contaSql()}`,
    );
    const agora = new Date().toISOString();
    const p = await pensar(pool, ia, cfg, {
      empresaNome: rows[0]?.nome ?? 'nossa empresa',
      remetente: (await configCadencia(pool)).remetente,
      lead: { empresa: 'Empresa de teste', cidade: null, contato: null, etapa: d.etapa },
      conversa: d.conversa.map((m) => ({ ...m, em: agora })),
      memoria: d.memoria,
      ficha: [],
    });
    const { decisao } = p;
    const passa = p.barrada.length > 0 || decisao.acao === 'passar_para_humano';
    res.json({
      decisao,
      bolhas: !p.barrada.length && decisao.resposta ? emBolhas(decisao.resposta) : [],
      trechos: p.trechos,
      primeiraResposta: p.primeiraResposta,
      problemasIniciais: p.problemasIniciais,
      barrada: p.barrada,
      aviso: passa && (p.barrada.length || !decisao.resposta) ? aviso('outro') : null,
    });
  });

  /** Números da IA no período (padrão: 30 dias). */
  r.get('/desempenho', async (req, res) => {
    const dias = Math.min(365, Math.max(1, Number(req.query.dias) || 30));
    res.json(await desempenho(pool, dias));
  });

  /** Liga a IA em todos os leads abertos das etapas escolhidas. */
  r.post('/ligar-em-massa', exigirAdmin, async (req, res) => {
    const { etapas } = corpo(
      req,
      z.object({ etapas: z.array(z.enum(['a_abordar', 'abordado', 'respondeu', 'proposta'])).min(1) }),
    );
    res.json({ ligados: await repo.ligarEmMassa(pool, etapas) });
  });

  return r;
}

/**
 * Webhook da Evolution (público; a "senha" é o token no endereço). Guarda a mensagem do lead e
 * registra no funil (o lead vai para "Respondeu"); quem responde é o motor do agente, alguns
 * segundos depois, para juntar mensagens em sequência.
 */
export function rotasWebhook({ pool, log, servicos, filas }: DepsApi): Router {
  const r = Router();
  /** Webhook dos números (Z-API): mensagens recebidas e conexão/desconexão. `/evolution` fica por compatibilidade. */
  const webhookWhatsapp = async (req: Request, res: Response) => {
    // O token diz de qual conta é o número (cada conta tem o seu endereço de webhook).
    const { rows } = await pool.query<{ conta_id: number }>(
      `SELECT a.conta_id FROM comercial.config_agente a JOIN cadastro.contas c ON c.id = a.conta_id
        WHERE a.webhook_token = $1 AND c.ativa`,
      [req.params.token],
    );
    const contaId = rows[0]?.conta_id;
    if (!contaId) throw AppError.naoEncontrado('Webhook');
    const conexao = eventoDeConexao(req.body);
    const m = conexao ? null : interpretarWebhook(req.body);
    // Grava antes de responder (é rápido). Falha fica no log; responde 200 para o provedor não repetir sem fim.
    await comConta(contaId, async () => {
      const { whatsapp } = await servicos(contaId);
      if (conexao) {
        const fone = String((req.body as { phone?: unknown })?.phone ?? '').replace(/\D/g, '') || null;
        const marcado = await chips.marcarConexao(
          pool,
          { instancia: conexao.instancia },
          conexao.conectado,
          fone,
        );
        if (marcado?.assinar && whatsapp?.assinar) {
          await whatsapp.assinar(marcado.instancia);
          await chips.marcarAssinado(pool, marcado.id);
        }
        if (marcado && !conexao.conectado) await avisarDesconectado(marcado.id);
      } else if (m) await registrarRecebida(m, whatsapp);
    }).catch((erro) => log.error({ err: erro, conta: contaId }, 'webhook do WhatsApp: falha ao registrar'));
    res.json({ ok: true });
  };
  r.post('/whatsapp/:token', webhookWhatsapp);
  r.post('/evolution/:token', webhookWhatsapp);

  /** O número caiu (celular desligado, WhatsApp saiu): avisa os administradores para ler o QR de novo. */
  async function avisarDesconectado(chipId: number) {
    const { rows } = await pool.query<{ id: number; nome: string }>(
      `SELECT u.id, ch.nome FROM cadastro.usuarios u JOIN comercial.chips ch ON ch.id = $1
        WHERE u.conta_id = ${contaSql()} AND u.papel = 'admin' AND u.ativo`,
      [chipId],
    );
    for (const u of rows)
      await notificar(pool, u.id, {
        tipo: 'sistema',
        titulo: `O WhatsApp "${u.nome}" desconectou`,
        texto: 'Abra Agente → Números de WhatsApp e leia o QR Code de novo para voltar a enviar.',
        link: '/agente?aba=chips',
      });
  }

  type Recebida = NonNullable<ReturnType<typeof interpretarWebhook>>;

  /** Primeira mensagem de um número desconhecido: avisa os administradores (uma vez por número). */
  async function avisarNaoIdentificado(m: Recebida, chipId: number | null) {
    // Os administradores e, se o número tem dono, o comercial dono dele.
    const { rows } = await pool.query<{ id: number }>(
      `SELECT id FROM cadastro.usuarios WHERE conta_id = ${contaSql()} AND ativo
          AND (papel = 'admin' OR id = (SELECT usuario_id FROM comercial.chips WHERE id = $1 AND conta_id = ${contaSql()}))`,
      [chipId],
    );
    const tel = m.telefone.replace(/^(\d{2})(\d+)(\d{4})$/, '($1) $2-$3');
    for (const u of rows)
      await notificar(pool, u.id, {
        tipo: 'sistema',
        titulo: `Mensagem de um número fora dos leads: ${m.nome ? `${m.nome} · ` : ''}${tel}`,
        texto: m.texto,
        link: '/conversas?filtro=nao_identificados',
      });
  }

  /** Guarda o arquivo da mensagem: o que veio no webhook, ou baixa da Evolution (em segundo plano). */
  async function anexar(db: Executor, mensagemId: number, m: Recebida, whatsapp: WhatsappConta | null) {
    if (!m.midia) return;
    const C = contaSql();
    const contaId = conta();
    const salvar = async (base64: string, mime: string | null) => {
      const id = await guardarMidia(db, {
        mime: (mime ?? m.midia?.mime ?? 'application/octet-stream').split(';')[0]!.trim(),
        nome: m.midia?.nome,
        base64,
      });
      await db.query(
        `UPDATE comercial.mensagens SET midia_tipo = $2, midia_id = $3 WHERE id = $1 AND conta_id = ${C}`,
        [mensagemId, m.midia?.tipo, id],
      );
    };
    if (m.midia.base64) return salvar(m.midia.base64, m.midia.mime);
    await db.query(`UPDATE comercial.mensagens SET midia_tipo = $2 WHERE id = $1 AND conta_id = ${C}`, [
      mensagemId,
      m.midia.tipo,
    ]);
    if (!whatsapp?.baixarMidia || !m.midia.url) return;
    void whatsapp
      .baixarMidia(m.midia.url)
      // Em segundo plano: a conta precisa ir junto (o contexto da requisição já terminou).
      .then((r) => (r ? comConta(contaId, () => salvar(r.base64, r.mime)) : undefined))
      .catch((erro) =>
        log.warn({ err: erro, mensagem: mensagemId }, 'webhook: não consegui baixar o arquivo'),
      );
  }

  async function registrarRecebida(m: Recebida, whatsapp: WhatsappConta | null) {
    const chipId = await chips.porInstancia(pool, m.instancia);
    let achado = await repo.leadPorTelefone(pool, m.telefone);
    if (!achado) {
      // É de um lead da conta que ainda não estava no funil (só na lista de leads): entra no funil.
      const daConta = await repo.leadDaContaPorTelefone(pool, m.telefone);
      if (daConta) {
        await funil.adicionar(pool, { empresaIds: [daConta], etapa: 'a_abordar', forcar: true }, 'WhatsApp');
        achado = await repo.leadPorTelefone(pool, m.telefone);
        if (achado) await chips.entregarAoDonoDoNumero(pool, achado.empresaId, chipId);
      }
    }
    if (!achado && (await repo.obterConfig(pool)).conversaNova === 'criar_lead') {
      // A conta escolheu: conversa nova no WhatsApp já vira lead no funil (a IA não entra sozinha).
      try {
        const { empresaId } = await criarLeadManual(
          { pool, filas },
          {
            empresa: nomeDaConversa(m.deMim ? null : m.nome, m.telefone),
            contato: !m.deMim && m.nome && /\p{L}/u.test(m.nome) ? m.nome : null,
            telefone: m.telefone,
            whatsapp: true,
            agente: false,
            enriquecer: false,
          },
          'WhatsApp',
        );
        log.info({ empresaId }, 'agente: conversa nova no WhatsApp virou lead');
        achado = await repo.leadPorTelefone(pool, m.telefone);
        await chips.entregarAoDonoDoNumero(pool, empresaId, chipId);
      } catch (erro) {
        log.warn(
          { err: erro },
          'agente: não consegui criar o lead da conversa nova; fica em Não identificados',
        );
      }
    }
    if (!achado) {
      // Número que não é de nenhum lead (a pessoa indicada que escreveu primeiro, por exemplo):
      // fica guardado em "Não identificados" até alguém vincular a um lead.
      const { primeira } = await contatos.guardarNaoIdentificada(pool, {
        telefone: m.telefone,
        nome: m.nome,
        deMim: m.deMim,
        texto: m.texto,
        midiaTipo: m.midia?.tipo ?? null,
        idExterno: m.idExterno,
        chipId,
        em: m.em,
      });
      if (primeira && !m.deMim) await avisarNaoIdentificado(m, chipId);
      return;
    }
    const { empresaId, contatoId } = achado;
    // Por qual chip chegou: o lead passa a conversar sempre por ele.
    if (chipId) await chips.fixarChip(pool, empresaId, chipId);
    if (m.deMim) {
      // Saiu deste número: se foi o sistema (IA, cadência, sequência, tela), já está no histórico.
      if (await repo.foiDoSistema(pool, empresaId, m.texto, m.idExterno)) return;
      // Foi alguém da equipe pelo celular: entra no histórico e a IA para de responder este lead.
      const id = await repo.criarMensagem(pool, {
        empresaId,
        direcao: 'enviada',
        texto: m.texto,
        telefone: m.telefone,
        status: 'enviada',
        origem: 'humano',
        idExterno: m.idExterno,
        chipId,
      });
      if (id) await anexar(pool, id, m, whatsapp);
      // Você escreveu para este número pelo celular: a conversa segue com ele.
      if (id) await contatos.definirDestino(pool, empresaId, m.telefone);
      if (id) {
        await funil.registrarAtividade(
          pool,
          empresaId,
          { tipo: 'whatsapp', direcao: 'enviada', texto: m.texto, contato: m.telefone },
          'você (celular)',
        );
        // A pessoa assumiu: a IA para (devolve na conversa) e a sequência automática também.
        if (await repo.humanoAssumiu(pool, empresaId, 'Você respondeu pelo celular.'))
          log.info({ empresaId }, 'agente: a equipe respondeu pelo celular; IA pausada neste lead');
        await pararSequencia(pool, empresaId, 'Você conversou pelo celular');
      }
      return;
    }
    const id = await repo.criarMensagem(pool, {
      empresaId,
      direcao: 'recebida',
      texto: m.texto,
      telefone: m.telefone,
      status: 'recebida',
      origem: 'lead',
      idExterno: m.idExterno,
      chipId,
    });
    if (!id) return; // a Evolution mandou a mesma mensagem duas vezes
    await anexar(pool, id, m, whatsapp);
    // A resposta vai para quem escreveu por último (a empresa ou a pessoa indicada).
    await contatos.definirDestino(pool, empresaId, m.telefone);
    // Indicação: cartão de contato ou telefone no texto vira sugestão de contato (alguém confirma).
    const achadas = [
      ...m.contatos.flatMap((x) =>
        x.telefones.map((telefone) => ({
          nome: x.nome,
          cargo: null,
          telefone,
          evidencia: `Cartão de contato: ${x.nome ?? telefone}`,
        })),
      ),
      ...indicacoesNoTexto(m.contatos.length ? '' : m.texto, m.telefone),
    ];
    const sugeridas = achadas.length ? await contatos.sugerir(pool, empresaId, achadas, id, contatoId) : 0;
    // Respondeu: a sequência automática para (nenhum e-mail ou WhatsApp a mais).
    await pararSequencia(pool, empresaId, RESPONDEU_WHATSAPP);
    await funil.registrarAtividade(
      pool,
      empresaId,
      { tipo: 'whatsapp', direcao: 'recebida', texto: m.texto, contato: m.telefone },
      m.nome ?? 'lead',
    );
    const { rows } = await pool.query<{ nome: string; ia: boolean }>(
      `SELECT e.nome, (o.agente AND o.agente_pausa IS NULL) AS ia
         FROM descoberta.empresas e JOIN comercial.oportunidades o ON o.conta_id = ${contaSql()} AND o.empresa_id = e.id
        WHERE e.id = $1`,
      [empresaId],
    );
    await notificarDono(pool, empresaId, {
      tipo: 'mensagem',
      titulo: sugeridas
        ? `${rows[0]?.nome ?? 'Lead'} indicou ${sugeridas === 1 ? 'um contato' : `${sugeridas} contatos`}`
        : `${rows[0]?.nome ?? 'Lead'} mandou mensagem${rows[0]?.ia ? ' (a IA está respondendo)' : ''}`,
      texto: m.texto,
    });
    log.info({ empresaId }, 'agente: lead respondeu no WhatsApp');
  }
  return r;
}
