import { emBolhas, tempoDigitando } from '@prospeccao/integrations/agente';
import type { Logger } from '@prospeccao/shared';
import { contaSql } from '../../contexto.js';
import type { DepsApi } from '../../dependencias.js';
import { agenteNoLimite } from '../../recursos.js';
import { paraCadaConta } from '../../rotinas.js';
import { limiteDoMes } from '../consumo/repositorio.js';
import { emSequenciaSql } from '../email/sequencia.js';
import { mensagemDoLead } from '../funil/cadencia.js';
import * as funil from '../funil/repositorio.js';
import { enviarDirectsPendentes } from '../instagram/servico.js';
import { aprenderComEquipe, type DepsAtendimento, responderLead, retomarCombinados } from './atendimento.js';
import * as chips from './chips.js';
import { dentroDoHorario } from './horario.js';
import * as repo from './repositorio.js';

/**
 * Motor do agente: roda a cada 30 s (uma instância por vez, com lock).
 *  1. Abordagens: leads com a IA ligada e follow-up vencido ganham a mensagem da cadência.
 *  2. Respostas: lead que escreveu (e parou de digitar há 40 s) recebe a resposta da IA, ou é
 *     passado para você quando a IA não deve responder.
 *  3. Envio: uma mensagem aprovada por vez, dentro do horário, do limite do dia e do intervalo.
 * Com "revisar antes de enviar" ligado, 1 e 2 viram rascunhos que você aprova na tela do Agente.
 */

const AUTOR = 'agente';
const LOCK = 7_301_023;

/** O motor de uma conta: banco, log e o WhatsApp e a IA dela. */
type DepsMotor = DepsAtendimento;

export { dentroDoHorario };

/** 1. Follow-ups vencidos dos leads com IA viram mensagem (rascunho ou aprovada). */
export async function gerarAbordagens(deps: DepsMotor, cfg: repo.ConfigAgente, limite = 20): Promise<number> {
  const { rows } = await deps.pool.query<{ empresa_id: number }>(
    `SELECT o.empresa_id::int FROM comercial.oportunidades o
      WHERE o.conta_id = ${contaSql()} AND o.agente AND o.agente_pausa IS NULL
        AND o.etapa IN ('a_abordar', 'abordado', 'respondeu', 'proposta')
        AND o.proxima_acao_em <= now() AND o.encerrar_em IS NULL
        -- retorno combinado com o lead: quem retoma é a IA, com o contexto (não a mensagem da cadência)
        AND o.agente_retorno_em IS NULL
        -- quem está numa sequência recebe os toques dela (nada de dois toques no mesmo lead)
        AND NOT ${emSequenciaSql('o.conta_id', 'o.empresa_id')}
        AND NOT EXISTS (SELECT 1 FROM comercial.mensagens m
                         WHERE m.conta_id = o.conta_id AND m.empresa_id = o.empresa_id
                           AND m.status IN ('rascunho', 'aprovada'))
        -- quem escreveu por último foi o lead: isso é resposta, não abordagem
        AND coalesce((SELECT a.direcao FROM comercial.atividades a
                       WHERE a.conta_id = o.conta_id AND a.empresa_id = o.empresa_id AND a.direcao IS NOT NULL
                       ORDER BY a.criado_em DESC, a.id DESC LIMIT 1), 'enviada') = 'enviada'
      ORDER BY o.proxima_acao_em
      LIMIT $1`,
    [limite],
  );
  let n = 0;
  for (const { empresa_id } of rows) {
    const m = await mensagemDoLead(deps.pool, empresa_id);
    if (!m.modelo || !m.telefone || !m.texto) continue;
    await repo.criarMensagem(deps.pool, {
      empresaId: empresa_id,
      direcao: 'enviada',
      texto: m.texto,
      telefone: m.telefone,
      status: cfg.revisarAntes ? 'rascunho' : 'aprovada',
      origem: 'cadencia',
      nota: `${m.rotulo}${m.tentativa ? ` (mensagem ${m.tentativa} de ${m.totalTentativas})` : ''}`,
    });
    n++;
  }
  return n;
}

/** 2. Lead escreveu e parou: a IA decide a resposta (ou passa para você). */
export async function gerarRespostas(deps: DepsMotor, cfg: repo.ConfigAgente, limite = 5): Promise<number> {
  const { rows } = await deps.pool.query<{ empresa_id: number; etapa: string }>(
    `SELECT o.empresa_id::int, o.etapa FROM comercial.oportunidades o
      WHERE o.conta_id = ${contaSql()} AND o.agente AND o.agente_pausa IS NULL
        AND o.etapa NOT IN ('ganho', 'perdido', 'descartado')
        AND NOT EXISTS (SELECT 1 FROM comercial.mensagens m
                         WHERE m.conta_id = o.conta_id AND m.empresa_id = o.empresa_id
                           AND m.status IN ('rascunho', 'aprovada'))
        AND EXISTS (SELECT 1 FROM (
              SELECT a.direcao, a.tipo, a.criado_em FROM comercial.atividades a
               WHERE a.conta_id = o.conta_id AND a.empresa_id = o.empresa_id AND a.direcao IS NOT NULL
               ORDER BY a.criado_em DESC, a.id DESC LIMIT 1) ult
             -- só responde quem escreveu no WhatsApp ou no direct (resposta de e-mail é com a equipe)
             WHERE ult.direcao = 'recebida' AND ult.tipo IN ('whatsapp', 'instagram')
               AND ult.criado_em < now() - interval '40 seconds')
      ORDER BY o.atualizado_em
      LIMIT $1`,
    [limite],
  );
  let n = 0;
  for (const { empresa_id, etapa } of rows) {
    await responderLead(deps, cfg, empresa_id, etapa);
    n++;
  }
  return n;
}

/**
 * 3. Envia a próxima mensagem aprovada, pelo chip do lead (ou o menos usado hoje, para quem ainda
 * não tem), se o horário e o teto do mês deixarem. Respostas a quem escreveu saem primeiro e na
 * hora, com "digitando…" e em bolhas, como uma pessoa; as frias respeitam o limite do chip (com o
 * aquecimento do número) e o intervalo com variação. Com o agente desligado, só saem as mensagens
 * das sequências (que têm o próprio liga/desliga).
 */
export async function enviarProxima(
  deps: DepsMotor,
  cfg: repo.ConfigAgente,
  agora = new Date(),
  opcoes: { soSequencia?: boolean } = {},
): Promise<boolean> {
  if (!deps.whatsapp || !dentroDoHorario(cfg, agora)) return false;
  const whatsapp = deps.whatsapp;
  const C = contaSql();
  if ((await limiteDoMes(deps.pool, 'whatsapp')).esgotado) return false;
  const disponiveis = await chips.emUso(deps.pool, whatsapp);
  if (!disponiveis.length) return false;

  const { rows: fila } = await deps.pool.query<{ id: number; empresa_id: number; origem: string }>(
    `SELECT id::int, empresa_id::int, origem FROM comercial.mensagens
      WHERE conta_id = ${C} AND status = 'aprovada' AND canal = 'whatsapp'
        ${opcoes.soSequencia ? `AND origem IN ('sequencia', 'automatico')` : ''}
      ORDER BY (origem = 'agente') DESC, criado_em, id LIMIT 30`,
  );
  for (const candidata of fila) {
    const resposta = candidata.origem === 'agente';
    const chip = await chips.chipParaAutomatica(
      deps.pool,
      candidata.empresa_id,
      disponiveis,
      cfg,
      agora.getTime(),
      { resposta },
    );
    if (!chip) continue; // o chip deste lead está no limite ou no intervalo: tenta o próximo lead
    const { rows } = await deps.pool.query<{
      id: number;
      empresa_id: number;
      texto: string;
      telefone: string | null;
    }>(
      `UPDATE comercial.mensagens SET status = 'enviada', enviado_em = now(), tentado_em = now(), chip_id = $2
        WHERE id = $1 AND conta_id = ${C} AND status = 'aprovada'
        RETURNING id, empresa_id::int, texto, telefone`,
      [candidata.id, chip.id],
    );
    const msg = rows[0];
    if (!msg) continue;
    if (!msg.telefone) {
      await deps.pool.query(
        `UPDATE comercial.mensagens SET status = 'erro', erro = 'Sem telefone' WHERE id = $1`,
        [msg.id],
      );
      continue;
    }
    try {
      // Resposta da IA: em bolhas (cada parágrafo), cada uma com "digitando…" antes.
      const partes = resposta ? emBolhas(msg.texto) : [msg.texto];
      let r: { idExterno: string | null } = { idExterno: null };
      for (const parte of partes)
        r = await whatsapp.enviar(
          msg.telefone,
          parte,
          chip.instancia,
          resposta ? { digitandoMs: tempoDigitando(parte) } : undefined,
        );
      await deps.pool.query('UPDATE comercial.mensagens SET id_externo = $2 WHERE id = $1', [
        msg.id,
        r.idExterno,
      ]);
      await funil.registrarAtividade(
        deps.pool,
        msg.empresa_id,
        { tipo: 'whatsapp', direcao: 'enviada', texto: msg.texto, contato: msg.telefone },
        AUTOR,
      );
      await chips.envioOk(deps.pool, chip);
      return true;
    } catch (erro) {
      const texto = erro instanceof Error ? erro.message : String(erro);
      await deps.pool.query(
        `UPDATE comercial.mensagens SET status = 'erro', erro = $2, enviado_em = NULL WHERE id = $1`,
        [msg.id, texto.slice(0, 300)],
      );
      deps.log.warn({ err: erro, mensagem: msg.id, chip: chip.nome }, 'agente: falha ao enviar no WhatsApp');
      // Chip falhando em sequência: pausa sozinho por 1 hora (e avisa), para não queimar o número.
      await chips
        .conferirSaude(deps.pool, chip)
        .catch((e) =>
          deps.log.warn({ err: e, chip: chip.nome }, 'agente: não consegui conferir a saúde do chip'),
        );
      return false;
    }
  }
  return false;
}

/** Uma rodada do agente numa conta (já dentro do contexto dela). */
export async function rodarAgenteDaConta(
  deps: DepsMotor,
  opcoes: { semAgente?: boolean } = {},
): Promise<void> {
  const cfg = await repo.obterConfig(deps.pool);
  // Módulo Agente de IA fora do plano: funciona como agente desligado (só as sequências saem).
  if (opcoes.semAgente) {
    await enviarProxima(deps, cfg, new Date(), { soSequencia: true });
    return;
  }
  // O que o time respondeu no lugar da IA vira sugestão para a base (com ou sem o agente ligado).
  await aprenderComEquipe(deps).catch((erro) => deps.log.warn({ err: erro }, 'agente: aprendizado falhou'));
  // Agente desligado: a IA não aborda nem responde, mas o WhatsApp das sequências continua saindo.
  if (!cfg.ligado) {
    await enviarProxima(deps, cfg, new Date(), { soSequencia: true });
    return;
  }
  await gerarRespostas(deps, cfg);
  await retomarCombinados(deps, cfg);
  if (dentroDoHorario(cfg)) await gerarAbordagens(deps, cfg);
  // Respostas pelo direct do Instagram (dentro do horário; a janela de 24 h é conferida lá).
  if (dentroDoHorario(cfg))
    await enviarDirectsPendentes(deps.pool, deps.log).catch((erro) =>
      deps.log.warn({ err: erro }, 'agente: falha no envio pelo Instagram'),
    );
  await enviarProxima(deps, cfg);
}

type DepsRodada = Pick<DepsApi, 'pool' | 'log' | 'servicos'>;

export async function rodarAgente(deps: DepsRodada): Promise<void> {
  const cliente = await deps.pool.connect();
  try {
    const { rows } = await cliente.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [LOCK]);
    if (!rows[0]?.ok) return;
    try {
      await paraCadaConta(deps.pool, deps.log, 'agente', async (conta) => {
        const { whatsapp, ia, modulos } = await deps.servicos(conta);
        // Sem o módulo, ou com as conversas do mês esgotadas: a IA não responde (o time responde).
        const semAgente =
          (!!modulos && !modulos.includes('agente_ia')) || (await agenteNoLimite(deps.pool, conta));
        await rodarAgenteDaConta({ pool: deps.pool, log: deps.log, whatsapp, ia }, { semAgente });
      });
    } finally {
      await cliente.query('SELECT pg_advisory_unlock($1)', [LOCK]);
    }
  } catch (erro) {
    deps.log.error({ err: erro }, 'agente: rodada falhou');
  } finally {
    cliente.release();
  }
}

export function iniciarAgente(deps: DepsRodada, log: Logger): () => void {
  const t = setInterval(() => void rodarAgente(deps), 30_000);
  t.unref();
  log.info('agente de abordagem pronto (liga e desliga na tela de cada conta)');
  return () => clearInterval(t);
}
