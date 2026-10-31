import type { Executor } from '@prospeccao/db';
import { AppError } from '@prospeccao/shared';
import { type ConfigFundos, lerConfigFundos } from '@prospeccao/shared/fundos';
import { temRecurso } from '../../recursos.js';
import { imagemDaMarca } from '../organizacao/repositorio.js';

/**
 * Fundos da câmera nas reuniões: a configuração da empresa (organização) e as fotos que ela envia.
 * O desfoque e os cenários sem logo valem para todos; os fundos com a logo, com a marca própria.
 */

export const LIMITE_FOTOS = 8;

export interface FotoFundo {
  id: number;
  nome: string;
  criadoEm: string;
}

export async function config(db: Executor, organizacaoId: number): Promise<ConfigFundos> {
  const { rows } = await db.query<{ fundos: unknown }>(
    'SELECT fundos FROM cadastro.organizacoes WHERE id = $1',
    [organizacaoId],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Organização');
  return lerConfigFundos(rows[0].fundos);
}

export async function fotos(db: Executor, organizacaoId: number): Promise<FotoFundo[]> {
  const { rows } = await db.query<FotoFundo>(
    `SELECT id::int AS id, nome, criado_em AS "criadoEm"
       FROM cadastro.fundos_empresa WHERE organizacao_id = $1 ORDER BY id`,
    [organizacaoId],
  );
  return rows;
}

/** Guarda a configuração, sem fotos que já não existem. */
export async function salvarConfig(db: Executor, organizacaoId: number, c: ConfigFundos): Promise<void> {
  const ids = new Set((await fotos(db, organizacaoId)).map((f) => `foto:${f.id}`));
  const vale = (id: string) => !id.startsWith('foto:') || ids.has(id);
  const limpo: ConfigFundos = {
    ...c,
    liberados: [...new Set(c.liberados.filter(vale))],
    padrao: c.padrao && vale(c.padrao) ? c.padrao : null,
    lugares: Object.fromEntries(Object.entries(c.lugares).filter(([id]) => vale(id))),
  };
  await db.query('UPDATE cadastro.organizacoes SET fundos = $2 WHERE id = $1', [
    organizacaoId,
    JSON.stringify(limpo),
  ]);
}

export async function adicionarFoto(
  db: Executor,
  organizacaoId: number,
  d: { nome: string; imagem: string },
): Promise<FotoFundo> {
  const { rows: n } = await db.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM cadastro.fundos_empresa WHERE organizacao_id = $1',
    [organizacaoId],
  );
  if ((n[0]?.n ?? 0) >= LIMITE_FOTOS)
    throw AppError.invalido(`Dá para ter até ${LIMITE_FOTOS} fotos. Tire uma para enviar outra.`);
  const { buf, tipo } = imagemDaMarca(d.imagem, 1536, 'Foto');
  const { rows } = await db.query<FotoFundo>(
    `INSERT INTO cadastro.fundos_empresa (organizacao_id, nome, imagem, tipo) VALUES ($1, $2, $3, $4)
     RETURNING id::int AS id, nome, criado_em AS "criadoEm"`,
    [organizacaoId, d.nome, buf, tipo],
  );
  // Foto nova já vem liberada para o time.
  const c = await config(db, organizacaoId);
  await salvarConfig(db, organizacaoId, { ...c, liberados: [...c.liberados, `foto:${rows[0]!.id}`] });
  return rows[0]!;
}

export async function removerFoto(db: Executor, organizacaoId: number, id: number): Promise<void> {
  const { rowCount } = await db.query(
    'DELETE FROM cadastro.fundos_empresa WHERE id = $1 AND organizacao_id = $2',
    [id, organizacaoId],
  );
  if (!rowCount) throw AppError.naoEncontrado('Foto');
  await salvarConfig(db, organizacaoId, await config(db, organizacaoId));
}

export async function imagemDaFoto(db: Executor, organizacaoId: number, id: number) {
  const { rows } = await db.query<{ imagem: Buffer; tipo: string }>(
    'SELECT imagem, tipo FROM cadastro.fundos_empresa WHERE id = $1 AND organizacao_id = $2',
    [id, organizacaoId],
  );
  return rows[0] ?? null;
}

/** O que a sala manda para quem é do time: os fundos da empresa (com logo só com a marca própria). */
export async function fundosDaConta(
  db: Executor,
  contaId: number,
): Promise<{ organizacaoId: number; comLogo: boolean; config: ConfigFundos; fotos: FotoFundo[] }> {
  const { rows } = await db.query<{ organizacao_id: number; tem_logo: boolean }>(
    `SELECT o.id AS organizacao_id, o.marca_logo IS NOT NULL AS tem_logo
       FROM cadastro.contas c JOIN cadastro.organizacoes o ON o.id = c.organizacao_id
      WHERE c.id = $1`,
    [contaId],
  );
  const org = rows[0];
  if (!org) throw AppError.naoEncontrado('Conta');
  const comMarca = await temRecurso(db, 'marca', contaId);
  return {
    organizacaoId: org.organizacao_id,
    comLogo: comMarca && org.tem_logo,
    config: await config(db, org.organizacao_id),
    fotos: comMarca ? await fotos(db, org.organizacao_id) : [],
  };
}
