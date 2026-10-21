import type { Executor } from '@prospeccao/db';
import type { NichoEntrada } from '@prospeccao/shared';
import { contaSql } from '../../contexto.js';

const CAMPOS = `
  n.id, n.nome, n.cnaes, n.termos_maps AS "termosMaps", n.palavras_positivas AS "palavrasPositivas",
  n.palavras_negativas AS "palavrasNegativas", n.cargos_alvo AS "cargosAlvo", n.portes,
  n.idade_minima_anos AS "idadeMinimaAnos", n.excluir_mei AS "excluirMei", n.ativo, n.criado_em AS "criadoEm", n.atualizado_em AS "atualizadoEm",
  (SELECT count(*)::int FROM cadastro.campanhas c WHERE c.nicho_id = n.id AND c.status IN ('ativa', 'pausada')) AS "campanhasEmAndamento"`;

export interface Nicho {
  id: number;
  nome: string;
  cnaes: string[];
  termosMaps: string[];
  palavrasPositivas: string[];
  palavrasNegativas: string[];
  cargosAlvo: string[];
  portes: string[];
  idadeMinimaAnos: number;
  excluirMei: boolean;
  ativo: boolean;
  campanhasEmAndamento: number;
}

export async function listar(db: Executor, incluirInativos: boolean): Promise<Nicho[]> {
  const { rows } = await db.query<Nicho>(
    `SELECT ${CAMPOS} FROM cadastro.nichos n WHERE n.conta_id = ${contaSql()} AND ($1 OR n.ativo)
      ORDER BY n.ativo DESC, n.nome`,
    [incluirInativos],
  );
  return rows;
}

export async function obter(db: Executor, id: number): Promise<Nicho | null> {
  const { rows } = await db.query<Nicho>(
    `SELECT ${CAMPOS} FROM cadastro.nichos n WHERE n.id = $1 AND n.conta_id = ${contaSql()}`,
    [id],
  );
  return rows[0] ?? null;
}

export async function criar(db: Executor, n: NichoEntrada): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO cadastro.nichos
       (conta_id, nome, cnaes, termos_maps, palavras_positivas, palavras_negativas, cargos_alvo, portes,
        idade_minima_anos, excluir_mei)
     VALUES (${contaSql()}, $1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      n.nome,
      n.cnaes,
      n.termosMaps,
      n.palavrasPositivas,
      n.palavrasNegativas,
      n.cargosAlvo,
      n.portes,
      n.idadeMinimaAnos,
      n.excluirMei,
    ],
  );
  return rows[0]!.id;
}

const COLUNAS: Record<string, string> = {
  nome: 'nome',
  cnaes: 'cnaes',
  termosMaps: 'termos_maps',
  palavrasPositivas: 'palavras_positivas',
  palavrasNegativas: 'palavras_negativas',
  cargosAlvo: 'cargos_alvo',
  portes: 'portes',
  idadeMinimaAnos: 'idade_minima_anos',
  excluirMei: 'excluir_mei',
  ativo: 'ativo',
};

export async function atualizar(db: Executor, id: number, dados: Record<string, unknown>): Promise<boolean> {
  const sets: string[] = [];
  const valores: unknown[] = [id];
  for (const [campo, valor] of Object.entries(dados)) {
    const coluna = COLUNAS[campo];
    if (!coluna || valor === undefined) continue;
    valores.push(valor);
    sets.push(`${coluna} = $${valores.length}`);
  }
  if (!sets.length) {
    const { rows } = await db.query(
      `SELECT 1 FROM cadastro.nichos WHERE id = $1 AND conta_id = ${contaSql()}`,
      [id],
    );
    return rows.length > 0;
  }
  const { rowCount } = await db.query(
    `UPDATE cadastro.nichos SET ${sets.join(', ')} WHERE id = $1 AND conta_id = ${contaSql()}`,
    valores,
  );
  return (rowCount ?? 0) > 0;
}
