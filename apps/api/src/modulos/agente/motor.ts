import type { Pool } from '@prospeccao/db';
import { pediuParaParar } from '@prospeccao/integrations/agente';
import type { Logger } from '@prospeccao/shared';
import type { DepsApi } from '../../dependencias.js';
import { obterConfig as configCadencia, mensagemDoLead } from '../funil/cadencia.js';
import * as funil from '../funil/repositorio.js';
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

type DepsMotor = Pick<DepsApi, 'pool' | 'log' | 'whatsapp' | 'ia'>;

function agoraSP(agora = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      weekday: 'short',
      hour: 'numeric',
      hourCycle: 'h23',
    })
      .formatToParts(agora)
      .map((x) => [x.type, x.value]),
  );
  const dias: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { dia: dias[p.weekday as string] ?? 0, hora: Number(p.hour) };
}

export function dentroDoHorario(
  c: Pick<repo.ConfigAgente, 'horaInicio' | 'horaFim' | 'diasSemana'>,
  agora = new Date(),
): boolean {
  const { dia, hora } = agoraSP(agora);
  return c.diasSemana.includes(dia) && hora >= c.horaInicio && hora < c.horaFim;
}

/** 1. Follow-ups vencidos dos leads com IA viram mensagem (rascunho ou aprovada). */
export async function gerarAbordagens(deps: DepsMotor, cfg: repo.ConfigAgente, limite = 20): Promise<number> {
  const { rows } = await deps.pool.query<{ empresa_id: number }>(
    `SELECT o.empresa_id::int FROM comercial.oportunidades o
      WHERE o.agente AND o.agente_pausa IS NULL
        AND o.etapa IN ('a_abordar', 'abordado', 'respondeu', 'proposta')
        AND o.proxima_acao_em <= now() AND o.encerrar_em IS NULL
        AND NOT EXISTS (SELECT 1 FROM comercial.mensagens m
                         WHERE m.empresa_id = o.empresa_id AND m.status IN ('rascunho', 'aprovada'))
        -- quem escreveu por último foi o lead: isso é resposta, não abordagem
        AND coalesce((SELECT a.direcao FROM comercial.atividades a
                       WHERE a.empresa_id = o.empresa_id AND a.direcao IS NOT NULL
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
      WHERE o.agente AND o.agente_pausa IS NULL AND o.etapa NOT IN ('ganho', 'perdido', 'descartado')
        AND NOT EXISTS (SELECT 1 FROM comercial.mensagens m
                         WHERE m.empresa_id = o.empresa_id AND m.status IN ('rascunho', 'aprovada'))
        AND EXISTS (SELECT 1 FROM (
              SELECT a.direcao, a.criado_em FROM comercial.atividades a
               WHERE a.empresa_id = o.empresa_id AND a.direcao IS NOT NULL
               ORDER BY a.criado_em DESC, a.id DESC LIMIT 1) ult
             WHERE ult.direcao = 'recebida' AND ult.criado_em < now() - interval '40 seconds')
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

async function pausar(pool: Pool, empresaId: number, motivo: string) {
  await pool.query('UPDATE comercial.oportunidades SET agente_pausa = $2 WHERE empresa_id = $1', [
    empresaId,
    motivo.slice(0, 300),
  ]);
  await funil.atualizar(
    pool,
    empresaId,
    { proximaAcao: 'Responder: a IA passou para você', proximaAcaoEm: new Date().toISOString() },
    AUTOR,
  );
}

async function responderLead(deps: DepsMotor, cfg: repo.ConfigAgente, empresaId: number, etapa: string) {
  const { pool } = deps;
  const { rows: conversa } = await pool.query<{ direcao: string; texto: string; em: string }>(
    `SELECT direcao, texto, criado_em AS em FROM comercial.atividades
      WHERE empresa_id = $1 AND direcao IS NOT NULL AND texto IS NOT NULL
      ORDER BY criado_em DESC, id DESC LIMIT 20`,
    [empresaId],
  );
  conversa.reverse();
  const ultima = conversa.at(-1)?.texto ?? '';

  if (pediuParaParar(ultima)) {
    await pool.query('UPDATE comercial.oportunidades SET agente = false WHERE empresa_id = $1', [empresaId]);
    await funil.atualizar(
      pool,
      empresaId,
      { etapa: 'descartado', motivo: 'Pediu para não receber mensagens' },
      AUTOR,
    );
    return;
  }
  const { rows: hoje } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM comercial.mensagens
      WHERE empresa_id = $1 AND origem = 'agente' AND criado_em >= ${repo.HOJE_SP}`,
    [empresaId],
  );
  if ((hoje[0]?.n ?? 0) >= cfg.respostasDiaLead) {
    await pausar(pool, empresaId, `A IA já respondeu ${cfg.respostasDiaLead} vezes hoje: continue você.`);
    return;
  }
  if (!deps.ia) {
    await pausar(pool, empresaId, 'O lead respondeu e a IA não está configurada (GEMINI_API_KEY na API).');
    return;
  }

  const m = await mensagemDoLead(pool, empresaId);
  const { rows: lead } = await pool.query<{ nome: string; cidade: string | null; decisor: string | null }>(
    `SELECT e.nome, e.cidade,
            (SELECT p.nome FROM enriquecimento.pessoas p WHERE p.empresa_id = e.id AND p.decisor LIMIT 1) AS decisor
       FROM descoberta.empresas e WHERE e.id = $1`,
    [empresaId],
  );
  const cad = await configCadencia(pool);
  let decisao: Awaited<ReturnType<NonNullable<DepsApi['ia']>['decidir']>>;
  try {
    decisao = await deps.ia.decidir({
      sobreEmpresa: cfg.sobreEmpresa,
      regras: cfg.regras,
      horariosReuniao: cfg.horariosReuniao,
      remetente: cad.remetente,
      agora: new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        dateStyle: 'full',
        timeStyle: 'short',
      }).format(new Date()),
      lead: {
        empresa: lead[0]?.nome ?? '',
        cidade: lead[0]?.cidade ?? null,
        contato: lead[0]?.decisor ?? null,
        etapa,
      },
      conversa: conversa.map((c) => ({
        de: c.direcao === 'enviada' ? 'nos' : 'lead',
        texto: c.texto,
        em: c.em,
      })),
    });
  } catch (erro) {
    deps.log.warn({ err: erro, empresaId }, 'agente: a IA falhou');
    await pausar(pool, empresaId, 'A IA falhou ao responder: responda você.');
    return;
  }

  const nova = (texto: string) =>
    repo.criarMensagem(pool, {
      empresaId,
      direcao: 'enviada',
      texto,
      telefone: m.telefone,
      status: cfg.revisarAntes ? 'rascunho' : 'aprovada',
      origem: 'agente',
      nota: decisao.motivo,
    });

  switch (decisao.acao) {
    case 'responder':
      await nova(decisao.resposta);
      break;
    case 'marcar_reuniao':
      await funil.registrarAtividade(
        pool,
        empresaId,
        {
          tipo: 'reuniao',
          direcao: null,
          texto: `Reunião combinada pela IA: ${decisao.motivo}`,
          proximaAcao: 'Reunião com o lead',
          proximaAcaoEm: decisao.reuniaoEm,
        },
        AUTOR,
      );
      if (decisao.resposta) await nova(decisao.resposta);
      break;
    case 'encerrar_sem_interesse':
      if (decisao.resposta) await nova(decisao.resposta);
      await pool.query('UPDATE comercial.oportunidades SET agente = false WHERE empresa_id = $1', [
        empresaId,
      ]);
      await funil.atualizar(
        pool,
        empresaId,
        { etapa: 'perdido', motivo: `Sem interesse: ${decisao.motivo}` },
        AUTOR,
      );
      break;
    case 'optout':
      await pool.query('UPDATE comercial.oportunidades SET agente = false WHERE empresa_id = $1', [
        empresaId,
      ]);
      await funil.atualizar(
        pool,
        empresaId,
        { etapa: 'descartado', motivo: 'Pediu para não receber mensagens' },
        AUTOR,
      );
      break;
    default:
      await pausar(pool, empresaId, decisao.motivo || 'A IA preferiu que você responda.');
      if (decisao.resposta) await nova(decisao.resposta);
  }
}

/** 3. Envia a mensagem aprovada mais antiga, se o horário, o limite e o intervalo deixarem. */
export async function enviarProxima(
  deps: DepsMotor,
  cfg: repo.ConfigAgente,
  agora = new Date(),
): Promise<boolean> {
  if (!deps.whatsapp || !dentroDoHorario(cfg, agora)) return false;
  const { rows: uso } = await deps.pool.query<{ hoje: number; ultima: string | null }>(
    `SELECT count(*) FILTER (WHERE enviado_em >= ${repo.HOJE_SP})::int AS hoje, max(enviado_em) AS ultima
       FROM comercial.mensagens WHERE status = 'enviada' AND origem IN ('agente', 'cadencia')`,
  );
  if ((uso[0]?.hoje ?? 0) >= cfg.limiteDia) return false;
  const ultima = uso[0]?.ultima ? new Date(uso[0].ultima).getTime() : 0;
  if (agora.getTime() - ultima < cfg.intervaloSeg * 1000) return false;

  const { rows } = await deps.pool.query<{
    id: number;
    empresa_id: number;
    texto: string;
    telefone: string | null;
  }>(
    `UPDATE comercial.mensagens SET status = 'enviada', enviado_em = now()
      WHERE id = (SELECT id FROM comercial.mensagens WHERE status = 'aprovada' ORDER BY criado_em, id
                   LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id, empresa_id::int, texto, telefone`,
  );
  const msg = rows[0];
  if (!msg) return false;
  if (!msg.telefone) {
    await deps.pool.query(
      `UPDATE comercial.mensagens SET status = 'erro', erro = 'Sem telefone' WHERE id = $1`,
      [msg.id],
    );
    return false;
  }
  try {
    const r = await deps.whatsapp.enviar(msg.telefone, msg.texto);
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
    return true;
  } catch (erro) {
    const texto = erro instanceof Error ? erro.message : String(erro);
    await deps.pool.query(
      `UPDATE comercial.mensagens SET status = 'erro', erro = $2, enviado_em = NULL WHERE id = $1`,
      [msg.id, texto.slice(0, 300)],
    );
    deps.log.warn({ err: erro, mensagem: msg.id }, 'agente: falha ao enviar no WhatsApp');
    return false;
  }
}

export async function rodarAgente(deps: DepsMotor): Promise<void> {
  const cliente = await deps.pool.connect();
  try {
    const { rows } = await cliente.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [LOCK]);
    if (!rows[0]?.ok) return;
    try {
      const cfg = await repo.obterConfig(deps.pool);
      if (!cfg.ligado) return;
      await gerarRespostas(deps, cfg);
      if (dentroDoHorario(cfg)) await gerarAbordagens(deps, cfg);
      await enviarProxima(deps, cfg);
    } finally {
      await cliente.query('SELECT pg_advisory_unlock($1)', [LOCK]);
    }
  } catch (erro) {
    deps.log.error({ err: erro }, 'agente: rodada falhou');
  } finally {
    cliente.release();
  }
}

export function iniciarAgente(deps: DepsMotor, log: Logger): () => void {
  const t = setInterval(() => void rodarAgente(deps), 30_000);
  t.unref();
  log.info(
    { whatsapp: !!deps.whatsapp, ia: !!deps.ia },
    'agente de abordagem pronto (liga e desliga na tela)',
  );
  return () => clearInterval(t);
}
