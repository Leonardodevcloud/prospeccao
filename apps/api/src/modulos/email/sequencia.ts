import type { Executor } from '@prospeccao/db';
import { contaSql } from '../../contexto.js';

/**
 * Regras da sequência multicanal que outros módulos usam (funil, WhatsApp, e-mail) sem depender do
 * motor: saber se o lead está numa sequência e pará-la quando ele responde em qualquer canal.
 */

/** Motivos que contam como resposta (estatística "responderam" da sequência). */
export const RESPONDEU_WHATSAPP = 'Respondeu no WhatsApp';
export const RESPONDEU_EMAIL = 'Respondeu o e-mail';

/**
 * SQL (EXISTS) que diz se o lead está no meio de uma sequência ativa: tem passo na fila ou o último
 * passo feito ainda não é o último da sequência, e ninguém parou.
 */
export function emSequenciaSql(conta: string, empresa: string): string {
  return `EXISTS (
    SELECT 1 FROM comercial.envios_email sx
      JOIN comercial.campanhas_email sc ON sc.id = sx.campanha_email_id
     WHERE sx.conta_id = ${conta} AND sx.empresa_id = ${empresa} AND sc.status = 'enviando'
       AND sx.parado_em IS NULL
       AND (sx.status = 'na_fila'
            OR (sx.status IN ('enviado', 'pulado') AND sx.passo < jsonb_array_length(sc.passos)
                AND NOT EXISTS (SELECT 1 FROM comercial.envios_email sy
                                 WHERE sy.campanha_email_id = sx.campanha_email_id
                                   AND sy.empresa_id = sx.empresa_id AND sy.passo > sx.passo))))`;
}

export async function estaEmSequencia(db: Executor, empresaId: number): Promise<boolean> {
  const { rows } = await db.query<{ sim: boolean }>(`SELECT ${emSequenciaSql(contaSql(), '$1')} AS sim`, [
    empresaId,
  ]);
  return rows[0]?.sim ?? false;
}

/**
 * Para as sequências do lead (respondeu, mudou de etapa, pediu para sair): nada mais sai para ele,
 * nem o que já estava na fila do e-mail ou do WhatsApp.
 */
export async function pararSequencia(db: Executor, empresaId: number, motivo: string): Promise<number> {
  const C = contaSql();
  const { rowCount } = await db.query(
    `UPDATE comercial.envios_email en SET parado_em = now(), parado_motivo = $2,
            status = CASE WHEN en.status = 'na_fila' THEN 'cancelado' ELSE en.status END,
            erro = CASE WHEN en.status = 'na_fila' THEN $2 ELSE en.erro END
       FROM comercial.campanhas_email ce
      WHERE ce.id = en.campanha_email_id AND en.conta_id = ${C} AND en.empresa_id = $1
        AND en.parado_em IS NULL AND ce.status IN ('enviando', 'pausada', 'rascunho')`,
    [empresaId, motivo.slice(0, 200)],
  );
  // Mensagem da sequência que ainda não saiu no WhatsApp também não sai mais.
  await db.query(
    `UPDATE comercial.mensagens SET status = 'descartada', erro = $2
      WHERE conta_id = ${C} AND empresa_id = $1 AND origem = 'sequencia' AND status IN ('rascunho', 'aprovada')`,
    [empresaId, motivo.slice(0, 200)],
  );
  return rowCount ?? 0;
}
