import type { Executor } from '@prospeccao/db';
import { AppError } from '@prospeccao/shared';
import { contaSql } from '../../contexto.js';
import type { WhatsappConta } from '../../dependencias.js';
import { HOJE_SP } from './repositorio.js';

/**
 * Chips de WhatsApp da conta (instâncias da Evolution dela). Cada chip tem o seu limite de mensagens
 * automáticas por dia e o seu intervalo; o lead novo vai para o chip menos usado hoje e, depois,
 * conversa sempre pelo mesmo (é o número que ele conhece). Sem chip cadastrado, vale a instância
 * das credenciais (um chip só, com o limite do agente).
 */

export interface Chip {
  /** null: o chip das credenciais (sem cadastro). */
  id: number | null;
  nome: string;
  instancia: string;
  /** null: usa o limite do dia do agente. */
  limiteDia: number | null;
}

/** Mensagens automáticas (IA, cadência, sequência): as que contam no limite do chip. */
export const ORIGENS_AUTOMATICAS = `('agente', 'cadencia', 'sequencia')`;

export async function listar(db: Executor) {
  const C = contaSql();
  const { rows } = await db.query(
    `SELECT c.id, c.nome, c.instancia, c.ativo, c.limite_dia AS "limiteDia", c.estado, c.estado_em AS "estadoEm",
            (SELECT count(*)::int FROM comercial.mensagens m
              WHERE m.chip_id = c.id AND m.status = 'enviada' AND m.origem IN ${ORIGENS_AUTOMATICAS}
                AND m.enviado_em >= ${HOJE_SP}) AS "enviadosHoje",
            (SELECT count(*)::int FROM comercial.oportunidades o WHERE o.conta_id = c.conta_id AND o.chip_id = c.id) AS leads
       FROM comercial.chips c WHERE c.conta_id = ${C} ORDER BY c.id`,
  );
  return rows;
}

/** Chips em uso: os cadastrados e ativos ou, sem cadastro, o das credenciais. */
export async function emUso(
  db: Executor,
  whatsapp: Pick<WhatsappConta, 'instancia'> | null,
): Promise<Chip[]> {
  const { rows } = await db.query<{
    id: number;
    nome: string;
    instancia: string;
    limite_dia: number;
    ativo: boolean;
  }>(
    `SELECT id, nome, instancia, limite_dia, ativo FROM comercial.chips WHERE conta_id = ${contaSql()} ORDER BY id`,
  );
  if (rows.length)
    return rows
      .filter((r) => r.ativo)
      .map((r) => ({ id: r.id, nome: r.nome, instancia: r.instancia, limiteDia: r.limite_dia }));
  return whatsapp?.instancia
    ? [{ id: null, nome: 'Chip principal', instancia: whatsapp.instancia, limiteDia: null }]
    : [];
}

/** Chip pela instância que mandou o webhook (com vários chips, diz por qual número o lead escreveu). */
export async function porInstancia(db: Executor, instancia: string | null): Promise<number | null> {
  if (!instancia) return null;
  const { rows } = await db.query<{ id: number }>(
    `SELECT id FROM comercial.chips WHERE conta_id = ${contaSql()} AND lower(instancia) = lower($1)`,
    [instancia],
  );
  return rows[0]?.id ?? null;
}

/** Uso de hoje de cada chip: quantas automáticas saíram e quando foi a última. */
async function usoDeHoje(db: Executor) {
  const { rows } = await db.query<{ chip_id: number | null; hoje: number; ultima: string | null }>(
    `SELECT chip_id, count(*) FILTER (WHERE enviado_em >= ${HOJE_SP})::int AS hoje, max(enviado_em) AS ultima
       FROM comercial.mensagens
      WHERE conta_id = ${contaSql()} AND status = 'enviada' AND origem IN ${ORIGENS_AUTOMATICAS}
        AND enviado_em > now() - interval '2 days'
      GROUP BY chip_id`,
  );
  return new Map(
    rows.map((r) => [r.chip_id ?? 0, { hoje: r.hoje, ultima: r.ultima ? new Date(r.ultima).getTime() : 0 }]),
  );
}

/**
 * Chip para mandar uma mensagem automática a este lead agora, ou null se não dá (o chip dele
 * chegou no limite de hoje ou ainda está no intervalo). Lead sem chip ganha o menos usado hoje.
 */
export async function chipParaAutomatica(
  db: Executor,
  empresaId: number,
  chips: Chip[],
  limites: { limiteDia: number; intervaloSeg: number },
  agora = Date.now(),
): Promise<Chip | null> {
  if (!chips.length) return null;
  const uso = await usoDeHoje(db);
  const livre = (c: Chip) => {
    const u = uso.get(c.id ?? 0) ?? { hoje: 0, ultima: 0 };
    return u.hoje < (c.limiteDia ?? limites.limiteDia) && agora - u.ultima >= limites.intervaloSeg * 1000;
  };
  const doLead = await chipDoLead(db, empresaId);
  const dele = doLead != null ? chips.find((c) => c.id === doLead) : undefined;
  if (dele) return livre(dele) ? dele : null;
  const opcoes = chips
    .filter(livre)
    .sort((a, b) => (uso.get(a.id ?? 0)?.hoje ?? 0) - (uso.get(b.id ?? 0)?.hoje ?? 0));
  const escolhido = opcoes[0] ?? null;
  if (escolhido?.id) await fixarChip(db, empresaId, escolhido.id);
  return escolhido;
}

/** Chip para a equipe mandar à mão (sem limite): o do lead ou o primeiro em uso. */
export async function chipParaEquipe(db: Executor, empresaId: number, chips: Chip[]): Promise<Chip | null> {
  const doLead = await chipDoLead(db, empresaId);
  const dele = doLead != null ? chips.find((c) => c.id === doLead) : undefined;
  if (dele) return dele;
  const primeiro = chips[0] ?? null;
  if (primeiro?.id) await fixarChip(db, empresaId, primeiro.id);
  return primeiro;
}

async function chipDoLead(db: Executor, empresaId: number): Promise<number | null> {
  const { rows } = await db.query<{ chip_id: number | null }>(
    `SELECT chip_id FROM comercial.oportunidades WHERE conta_id = ${contaSql()} AND empresa_id = $1`,
    [empresaId],
  );
  return rows[0]?.chip_id ?? null;
}

export async function fixarChip(db: Executor, empresaId: number, chipId: number): Promise<void> {
  await db.query(
    `UPDATE comercial.oportunidades SET chip_id = $2
      WHERE conta_id = ${contaSql()} AND empresa_id = $1 AND chip_id IS NULL`,
    [empresaId, chipId],
  );
}

/* ───────────── Cadastro ───────────── */

export async function criar(
  db: Executor,
  d: { nome: string; instancia: string; limiteDia: number },
): Promise<number> {
  try {
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO comercial.chips (conta_id, nome, instancia, limite_dia) VALUES (${contaSql()}, $1, $2, $3)
       RETURNING id`,
      [d.nome, d.instancia, d.limiteDia],
    );
    return rows[0]!.id;
  } catch (erro) {
    if ((erro as { code?: string }).code === '23505')
      throw AppError.conflito('Esta instância já está cadastrada como chip desta conta.');
    throw erro;
  }
}

export async function atualizar(
  db: Executor,
  id: number,
  d: { nome?: string; ativo?: boolean; limiteDia?: number },
): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE comercial.chips SET nome = coalesce($2, nome), ativo = coalesce($3, ativo), limite_dia = coalesce($4, limite_dia)
      WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id, d.nome ?? null, d.ativo ?? null, d.limiteDia ?? null],
  );
  if (!rowCount) throw AppError.naoEncontrado('Chip');
}

/** Apaga o chip: os leads dele passam para o próximo chip que mandar mensagem. */
export async function apagar(db: Executor, id: number): Promise<void> {
  const { rowCount } = await db.query(
    `DELETE FROM comercial.chips WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id],
  );
  if (!rowCount) throw AppError.naoEncontrado('Chip');
}

export async function obter(db: Executor, id: number): Promise<{ id: number; instancia: string }> {
  const { rows } = await db.query<{ id: number; instancia: string }>(
    `SELECT id, instancia FROM comercial.chips WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Chip');
  return rows[0];
}

export async function guardarEstado(db: Executor, id: number, estado: string): Promise<void> {
  await db.query(`UPDATE comercial.chips SET estado = $2, estado_em = now() WHERE id = $1`, [
    id,
    estado.slice(0, 200),
  ]);
}
