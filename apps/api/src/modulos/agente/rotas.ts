import type { Executor } from '@prospeccao/db';
import { interpretarWebhook } from '@prospeccao/integrations/whatsapp';
import {
  AppError,
  aprovarRascunho,
  chipAtualizar,
  chipEntrada,
  configAgenteEntrada,
  indicacoesNoTexto,
} from '@prospeccao/shared';
import { type Request, Router } from 'express';
import { z } from 'zod';
import { comConta, conta, contaSql } from '../../contexto.js';
import type { DepsApi, WhatsappConta } from '../../dependencias.js';
import { corpo, idDaRota } from '../../middlewares/http.js';
import { exigirAdmin } from '../../middlewares/seguranca.js';
import * as contatos from '../contatos/repositorio.js';
import { guardarMidia } from '../conversas/repositorio.js';
import { pararSequencia, RESPONDEU_WHATSAPP } from '../email/sequencia.js';
import * as funil from '../funil/repositorio.js';
import { notificar, notificarDono } from '../notificacoes/repositorio.js';
import * as chips from './chips.js';
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
export function rotasAgente({ pool, log, servicos }: DepsApi): Router {
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
      // Endereço para colar na Evolution (Webhook → MESSAGES_UPSERT).
      webhook: `${enderecoPublico(req)}/webhooks/evolution/${webhookToken}`,
      status: {
        whatsapp: !!whatsapp,
        ia: !!ia,
        iaDescricao,
        origem: { whatsapp: origem.evolution, ia: origem.ia },
      },
      resumo,
      rascunhos,
      pausados,
    });
  });

  /* Chips de WhatsApp (instâncias da Evolution da conta) */
  r.get('/chips', async (_req, res) => {
    const { whatsapp } = await servicos(conta());
    res.json({ chips: await chips.listar(pool), padrao: whatsapp?.instancia ?? null, conectado: !!whatsapp });
  });
  r.post('/chips', exigirAdmin, async (req, res) => {
    const id = await chips.criar(pool, corpo(req, chipEntrada));
    res.status(201).json({ id, chips: await chips.listar(pool) });
  });
  r.patch('/chips/:id', exigirAdmin, async (req, res) => {
    await chips.atualizar(pool, idDaRota(req), corpo(req, chipAtualizar));
    res.json(await chips.listar(pool));
  });
  r.delete('/chips/:id', exigirAdmin, async (req, res) => {
    await chips.apagar(pool, idDaRota(req));
    res.json(await chips.listar(pool));
  });
  /** Lê na Evolution se o chip está conectado (e guarda para a tela e os alertas). */
  r.post('/chips/:id/testar', async (req, res) => {
    const chip = await chips.obter(pool, idDaRota(req));
    const { whatsapp } = await servicos(conta());
    if (!whatsapp?.estado)
      throw AppError.invalido(
        'O WhatsApp desta conta não está configurado (endereço e chave da Evolution no painel master).',
      );
    let resultado: string;
    try {
      resultado = await whatsapp.estado(chip.instancia);
    } catch (erro) {
      resultado = erro instanceof Error ? erro.message : String(erro);
    }
    await chips.guardarEstado(pool, chip.id, resultado);
    res.json({ ok: resultado.startsWith('ok'), resultado: resultado.slice(0, 300) });
  });

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
export function rotasWebhook({ pool, log, servicos }: DepsApi): Router {
  const r = Router();
  r.post('/evolution/:token', async (req, res) => {
    // O token diz de qual conta é o chip (cada conta tem o seu endereço de webhook).
    const { rows } = await pool.query<{ conta_id: number }>(
      `SELECT a.conta_id FROM comercial.config_agente a JOIN cadastro.contas c ON c.id = a.conta_id
        WHERE a.webhook_token = $1 AND c.ativa`,
      [req.params.token],
    );
    const contaId = rows[0]?.conta_id;
    if (!contaId) throw AppError.naoEncontrado('Webhook');
    const m = interpretarWebhook(req.body);
    // Grava antes de responder (é rápido). Falha fica no log; responde 200 para a Evolution não repetir sem fim.
    if (m)
      await comConta(contaId, async () => {
        const { whatsapp } = await servicos(contaId);
        await registrarRecebida(m, whatsapp);
      }).catch((erro) =>
        log.error({ err: erro, conta: contaId }, 'webhook da Evolution: falha ao registrar'),
      );
    res.json({ ok: true });
  });

  type Recebida = NonNullable<ReturnType<typeof interpretarWebhook>>;

  /** Primeira mensagem de um número desconhecido: avisa os administradores (uma vez por número). */
  async function avisarNaoIdentificado(m: Recebida) {
    const { rows } = await pool.query<{ id: number }>(
      `SELECT id FROM cadastro.usuarios WHERE conta_id = ${contaSql()} AND papel = 'admin' AND ativo`,
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
    if (!whatsapp?.baixarMidia || !m.idExterno) return;
    const id = m.idExterno;
    void whatsapp
      .baixarMidia(id, m.instancia ?? undefined)
      // Em segundo plano: a conta precisa ir junto (o contexto da requisição já terminou).
      .then((r) => (r ? comConta(contaId, () => salvar(r.base64, r.mime)) : undefined))
      .catch((erro) =>
        log.warn({ err: erro, mensagem: mensagemId }, 'webhook: não consegui baixar o arquivo'),
      );
  }

  async function registrarRecebida(m: Recebida, whatsapp: WhatsappConta | null) {
    const chipId = await chips.porInstancia(pool, m.instancia);
    const achado = await repo.leadPorTelefone(pool, m.telefone);
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
      if (primeira && !m.deMim) await avisarNaoIdentificado(m);
      return;
    }
    const { empresaId, contatoId } = achado;
    // Por qual chip chegou: o lead passa a conversar sempre por ele.
    if (chipId) await chips.fixarChip(pool, empresaId, chipId);
    if (m.deMim) {
      // Mensagem que você mandou pelo celular: entra no histórico (as do sistema já estão lá).
      if (m.idExterno) {
        const { rows } = await pool.query(
          `SELECT 1 FROM comercial.mensagens WHERE conta_id = ${contaSql()} AND id_externo = $1`,
          [m.idExterno],
        );
        if (rows.length) return;
      }
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
      if (id)
        await funil.registrarAtividade(
          pool,
          empresaId,
          { tipo: 'whatsapp', direcao: 'enviada', texto: m.texto, contato: m.telefone },
          'você (celular)',
        );
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
