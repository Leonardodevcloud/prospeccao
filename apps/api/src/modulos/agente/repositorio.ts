import type { Executor } from '@prospeccao/db';
import type { ConfigAgenteEntrada } from '@prospeccao/shared';
import { contaSql } from '../../contexto.js';

/** Agente de abordagem (schema comercial, só a API escreve). */

export interface ConfigAgente extends ConfigAgenteEntrada {
  webhookToken: string;
}

export async function obterConfig(db: Executor): Promise<ConfigAgente> {
  const { rows } = await db.query<ConfigAgente>(
    `SELECT ligado, revisar_antes AS "revisarAntes", hora_inicio AS "horaInicio", hora_fim AS "horaFim",
            dias_semana AS "diasSemana", limite_dia AS "limiteDia", intervalo_seg AS "intervaloSeg",
            respostas_dia_lead AS "respostasDiaLead", sobre_empresa AS "sobreEmpresa", regras,
            horarios_reuniao AS "horariosReuniao", webhook_token AS "webhookToken"
       FROM comercial.config_agente WHERE conta_id = ${contaSql()}`,
  );
  const c = rows[0];
  if (!c) throw new Error('config_agente vazia: a migration 023 não rodou');
  return c;
}

export async function salvarConfig(db: Executor, c: ConfigAgenteEntrada): Promise<void> {
  await db.query(
    `UPDATE comercial.config_agente
        SET ligado = $1, revisar_antes = $2, hora_inicio = $3, hora_fim = $4, dias_semana = $5,
            limite_dia = $6, intervalo_seg = $7, respostas_dia_lead = $8, sobre_empresa = $9, regras = $10,
            horarios_reuniao = $11, atualizado_em = now()
      WHERE conta_id = ${contaSql()}`,
    [
      c.ligado,
      c.revisarAntes,
      c.horaInicio,
      c.horaFim,
      c.diasSemana,
      c.limiteDia,
      c.intervaloSeg,
      c.respostasDiaLead,
      c.sobreEmpresa,
      c.regras,
      c.horariosReuniao,
    ],
  );
}

/** Início do dia de hoje em São Paulo. */
export const HOJE_SP = `(date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')`;

export async function resumo(db: Executor) {
  const C = contaSql();
  const { rows } = await db.query<{
    rascunhos: number;
    enviadasHoje: number;
    recebidasHoje: number;
    leadsComIa: number;
    pausados: number;
  }>(
    `SELECT (SELECT count(*) FROM comercial.mensagens WHERE conta_id = ${C} AND status = 'rascunho')::int AS rascunhos,
            (SELECT count(*) FROM comercial.mensagens WHERE conta_id = ${C} AND status = 'enviada'
               AND origem IN ('agente', 'cadencia') AND enviado_em >= ${HOJE_SP})::int AS "enviadasHoje",
            (SELECT count(*) FROM comercial.mensagens WHERE conta_id = ${C} AND direcao = 'recebida'
               AND criado_em >= ${HOJE_SP})::int AS "recebidasHoje",
            (SELECT count(*) FROM comercial.oportunidades WHERE conta_id = ${C} AND agente AND agente_pausa IS NULL
               AND etapa NOT IN ('ganho', 'perdido', 'descartado'))::int AS "leadsComIa",
            (SELECT count(*) FROM comercial.oportunidades WHERE conta_id = ${C} AND agente AND agente_pausa IS NOT NULL
               AND etapa NOT IN ('ganho', 'perdido', 'descartado'))::int AS pausados`,
  );
  return rows[0]!;
}

/** Mensagens esperando sua revisão, com o lead e o motivo da IA. */
export async function rascunhos(db: Executor) {
  const C = contaSql();
  const { rows } = await db.query(
    `SELECT m.id, m.empresa_id::int AS "empresaId", e.nome, e.cidade, m.texto, m.telefone, m.origem, m.nota,
            m.criado_em AS "criadoEm", o.etapa,
            (SELECT a.texto FROM comercial.atividades a
              WHERE a.conta_id = ${C} AND a.empresa_id = m.empresa_id AND a.direcao = 'recebida'
                AND a.texto IS NOT NULL
              ORDER BY a.criado_em DESC LIMIT 1) AS "ultimaDoLead"
       FROM comercial.mensagens m
       JOIN descoberta.empresas e ON e.id = m.empresa_id
       LEFT JOIN comercial.oportunidades o ON o.conta_id = m.conta_id AND o.empresa_id = m.empresa_id
      WHERE m.conta_id = ${C} AND m.status = 'rascunho'
      ORDER BY m.criado_em
      LIMIT 200`,
  );
  return rows;
}

/** Leads que a IA passou para você, com o motivo. */
export async function pausados(db: Executor) {
  const { rows } = await db.query(
    `SELECT o.empresa_id::int AS "empresaId", e.nome, e.cidade, o.agente_pausa AS motivo, o.etapa,
            o.atualizado_em AS "em"
       FROM comercial.oportunidades o JOIN descoberta.empresas e ON e.id = o.empresa_id
      WHERE o.conta_id = ${contaSql()} AND o.agente AND o.agente_pausa IS NOT NULL
        AND o.etapa NOT IN ('ganho', 'perdido', 'descartado')
      ORDER BY o.atualizado_em DESC LIMIT 200`,
  );
  return rows;
}

export async function conversa(db: Executor, empresaId: number) {
  const { rows } = await db.query(
    `SELECT id, direcao, texto, status, origem, nota, erro, criado_em AS "criadoEm", enviado_em AS "enviadoEm"
       FROM comercial.mensagens WHERE conta_id = ${contaSql()} AND empresa_id = $1 ORDER BY criado_em, id`,
    [empresaId],
  );
  return rows;
}

export async function criarMensagem(
  db: Executor,
  m: {
    empresaId: number;
    direcao: 'enviada' | 'recebida';
    texto: string;
    telefone: string | null;
    status: 'rascunho' | 'aprovada' | 'enviada' | 'recebida';
    origem: 'agente' | 'cadencia' | 'humano' | 'lead';
    idExterno?: string | null;
    nota?: string | null;
    usuarioId?: number | null;
    midiaTipo?: 'imagem' | 'audio' | 'video' | 'documento' | null;
    midiaId?: number | null;
    /** Mensagem do lead já lida (ex.: você mesmo mandou pelo celular). */
    lida?: boolean;
  },
): Promise<number | null> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO comercial.mensagens
       (conta_id, empresa_id, direcao, texto, telefone, status, origem, id_externo, nota, enviado_em,
        usuario_id, midia_tipo, midia_id, lida_em)
     VALUES (${contaSql()}, $1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $5 = 'enviada' THEN now() END,
             $9, $10, $11, CASE WHEN $2 = 'enviada' OR $12 THEN now() END)
     ON CONFLICT (conta_id, id_externo) WHERE id_externo IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      m.empresaId,
      m.direcao,
      m.texto,
      m.telefone,
      m.status,
      m.origem,
      m.idExterno ?? null,
      m.nota ?? null,
      m.usuarioId ?? null,
      m.midiaTipo ?? null,
      m.midiaId ?? null,
      m.lida ?? false,
    ],
  );
  return rows[0]?.id ?? null;
}

export async function aprovar(db: Executor, id: number, texto?: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE comercial.mensagens SET status = 'aprovada', texto = coalesce($2, texto)
      WHERE id = $1 AND conta_id = ${contaSql()} AND status = 'rascunho'`,
    [id, texto ?? null],
  );
  return (rowCount ?? 0) > 0;
}

/** Descartar a resposta da IA passa o lead para você (senão ela escreveria a mesma coisa de novo). */
export async function descartar(db: Executor, id: number): Promise<boolean> {
  const { rows } = await db.query<{ empresa_id: number; origem: string }>(
    `UPDATE comercial.mensagens SET status = 'descartada'
      WHERE id = $1 AND conta_id = ${contaSql()} AND status = 'rascunho'
     RETURNING empresa_id::int, origem`,
    [id],
  );
  const m = rows[0];
  if (!m) return false;
  if (m.origem === 'agente')
    await db.query(
      `UPDATE comercial.oportunidades SET agente_pausa = 'Você descartou a resposta da IA: responda você.'
        WHERE conta_id = ${contaSql()} AND empresa_id = $1`,
      [m.empresa_id],
    );
  return true;
}

/** Liga a IA nos leads ainda abertos das etapas pedidas (ex.: todos em "A abordar"). */
export async function ligarEmMassa(db: Executor, etapas: string[]): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE comercial.oportunidades SET agente = true, agente_pausa = NULL
      WHERE conta_id = ${contaSql()} AND etapa = ANY($1::text[]) AND NOT agente`,
    [etapas],
  );
  return rowCount ?? 0;
}

/**
 * Lead pelo telefone que mandou mensagem. Compara DDD + 8 últimos dígitos (o 9 do celular às
 * vezes vem, às vezes não). Só leads que estão no funil.
 */
export async function leadPorTelefone(db: Executor, telefone: string): Promise<number | null> {
  const d = telefone.replace(/\D/g, '');
  if (d.length < 10) return null;
  const ddd = d.slice(0, 2);
  const fim = d.slice(-8);
  const { rows } = await db.query<{ empresa_id: number }>(
    `WITH tel AS (
       SELECT c.empresa_id, c.valor FROM enriquecimento.contatos c WHERE c.canal IN ('whatsapp', 'telefone')
       UNION ALL SELECT e.id, e.maps_telefone FROM descoberta.empresas e WHERE e.maps_telefone IS NOT NULL
     )
     SELECT o.empresa_id::int FROM tel
       JOIN comercial.oportunidades o ON o.conta_id = ${contaSql()} AND o.empresa_id = tel.empresa_id
      WHERE left(tel.valor, 2) = $1 AND right(tel.valor, 8) = $2
      ORDER BY (o.etapa IN ('ganho', 'perdido', 'descartado')), o.atualizado_em DESC
      LIMIT 1`,
    [ddd, fim],
  );
  return rows[0]?.empresa_id ?? null;
}
