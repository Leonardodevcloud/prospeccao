import type { Pool } from '@prospeccao/db';
import { AppError } from '@prospeccao/shared';

/** Memória do Argos: o que a pessoa pediu para ele guardar. Privada, como as conversas. */

export const MAX_MEMORIAS = 60;

export interface Memoria {
  id: number;
  texto: string;
  criadoEm: string;
}

export async function listar(pool: Pool, usuarioId: number): Promise<Memoria[]> {
  const { rows } = await pool.query<Memoria>(
    `SELECT id::int, texto, criado_em AS "criadoEm" FROM comercial.argos_memorias
      WHERE usuario_id = $1 ORDER BY criado_em DESC, id DESC LIMIT ${MAX_MEMORIAS}`,
    [usuarioId],
  );
  return rows;
}

const normal = (t: string) =>
  t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Guarda (sem repetir a mesma frase). Passando do limite, a mais antiga sai. */
export async function lembrar(
  pool: Pool,
  u: { id: number; contaId: number },
  texto: string,
): Promise<{ id: number; nova: boolean }> {
  const limpo = texto.replace(/\s+/g, ' ').trim().slice(0, 300);
  if (limpo.length < 3) throw AppError.invalido('O que é para lembrar ficou vazio.');
  const atuais = await listar(pool, u.id);
  const igual = atuais.find((m) => normal(m.texto) === normal(limpo));
  if (igual) return { id: igual.id, nova: false };
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO comercial.argos_memorias (usuario_id, conta_id, texto) VALUES ($1, $2, $3) RETURNING id::int`,
    [u.id, u.contaId, limpo],
  );
  await pool.query(
    `DELETE FROM comercial.argos_memorias WHERE usuario_id = $1 AND id NOT IN (
       SELECT id FROM comercial.argos_memorias WHERE usuario_id = $1 ORDER BY criado_em DESC, id DESC LIMIT ${MAX_MEMORIAS})`,
    [u.id],
  );
  return { id: rows[0]!.id, nova: true };
}

export async function esquecer(pool: Pool, usuarioId: number, id: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    'DELETE FROM comercial.argos_memorias WHERE usuario_id = $1 AND id = $2',
    [usuarioId, id],
  );
  return !!rowCount;
}

/** Para o contexto da IA: uma linha por memória, com o id que ela usa para esquecer. */
export const memoriasParaIa = (m: Memoria[]) =>
  m
    .map(
      (x) =>
        `- [m${x.id}] ${x.texto} (guardado em ${new Date(x.criadoEm).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })})`,
    )
    .join('\n');
