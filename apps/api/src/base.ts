import type { Executor } from '@prospeccao/db';
import { AppError } from '@prospeccao/shared';
import type { NextFunction, Request, Response } from 'express';
import { contaSql, donoDaBase, empresaVisivel } from './contexto.js';

/**
 * "Só a própria base": quem foi configurado assim na Equipe não abre nem mexe em lead de colega.
 * As listas filtram com naBase/empresaVisivel (contexto.ts); aqui fica a trava das rotas de um lead.
 */

/** A empresa é de um colega (ou está no funil esperando dono): para esta pessoa, ela não existe. */
export async function exigirVisivel(db: Executor, empresaId: number): Promise<void> {
  if (!donoDaBase()) return;
  if (!Number.isInteger(empresaId) || empresaId <= 0) throw AppError.naoEncontrado('Lead');
  const { rows } = await db.query<{ ok: boolean }>(`SELECT ${empresaVisivel('$1::bigint')} AS ok`, [
    empresaId,
  ]);
  if (!rows[0]?.ok) throw AppError.naoEncontrado('Lead');
}

/** Para router.param: confere o lead da rota antes de qualquer rota que o use. */
export function travaDaBase(db: Executor) {
  return (_req: Request, _res: Response, next: NextFunction, valor: string) => {
    if (!donoDaBase()) return next();
    exigirVisivel(db, Number(valor)).then(() => next(), next);
  };
}

/** Responsável que esta pessoa pode escolher: quem vê só a própria base só pode pegar para si. */
export function exigirPodeAtribuir(responsavelId: number | null): void {
  const d = donoDaBase();
  if (d && responsavelId !== d)
    throw AppError.invalido('Você trabalha só com a sua base: não dá para passar o lead para outra pessoa.');
}

/**
 * A empresa é lead desta conta (uma lista da conta a liberou, ou está no funil da conta) e esta
 * pessoa pode vê-la. A base de empresas é de todas as contas: id de empresa vindo de fora (corpo
 * da requisição) passa por aqui antes de qualquer coisa mostrar o nome dela.
 */
export async function exigirLeadDaConta(db: Executor, empresaId: number): Promise<void> {
  if (!Number.isInteger(empresaId) || empresaId <= 0) throw AppError.naoEncontrado('Lead');
  const C = contaSql();
  const { rows } = await db.query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM descoberta.campanha_empresas cx
                     WHERE cx.empresa_id = $1 AND cx.conta_id = ${C} AND cx.liberado_em IS NOT NULL)
         OR EXISTS (SELECT 1 FROM comercial.oportunidades o WHERE o.empresa_id = $1 AND o.conta_id = ${C}) AS ok`,
    [empresaId],
  );
  if (!rows[0]?.ok) throw AppError.naoEncontrado('Lead');
  await exigirVisivel(db, empresaId);
}
