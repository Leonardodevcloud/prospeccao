import { comTransacao, type Executor, type Pool } from '@prospeccao/db';
import {
  AppError,
  type CartaoQuadro,
  MAX_QUADROS,
  type Quadro,
  type QuadroEntrada,
} from '@prospeccao/shared';
import { contaSql, empresaVisivel, usuarioAtual } from '../../contexto.js';

/**
 * Quadros com gatilhos da IA: cada conta monta os seus (colunas com ou sem gatilho). Um lead fica em
 * uma coluna de cada quadro. A IA (leitura.ts) sugere ou já move; as pessoas movem à mão, confirmam
 * ou descartam. Quem vê só a própria base vê só os cartões dos leads dela (e os sem dono, na fila).
 */

export async function listar(db: Executor): Promise<Quadro[]> {
  const C = contaSql();
  const { rows } = await db.query<Quadro>(
    `SELECT q.id, q.nome, q.ia, q.confirmar,
            coalesce((SELECT json_agg(json_build_object('id', c.id, 'nome', c.nome, 'gatilho', c.gatilho, 'cor', c.cor)
                                ORDER BY c.ordem, c.id)
                        FROM comercial.quadro_colunas c WHERE c.quadro_id = q.id), '[]') AS colunas,
            (SELECT count(*)::int FROM comercial.quadro_cartoes k
              WHERE k.quadro_id = q.id AND k.sugerida_id IS NOT NULL AND ${empresaVisivel('k.empresa_id')}) AS sugestoes
       FROM comercial.quadros q
      WHERE q.conta_id = ${C}
      ORDER BY q.ordem, q.id`,
  );
  return rows;
}

async function exigirQuadro(
  db: Executor,
  id: number,
): Promise<{ id: number; nome: string; confirmar: boolean }> {
  const { rows } = await db.query<{ id: number; nome: string; confirmar: boolean }>(
    `SELECT id, nome, confirmar FROM comercial.quadros WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Quadro');
  return rows[0];
}

function nomeRepetido(e: unknown): never {
  if ((e as { code?: string }).code === '23505')
    throw AppError.conflito('Já existe um quadro com esse nome.');
  throw e;
}

/** Grava as colunas do jeito que vieram (as que sumiram saem, com os cartões delas). */
async function gravarColunas(
  tx: Executor,
  quadroId: number,
  colunas: QuadroEntrada['colunas'],
): Promise<void> {
  const { rows: atuais } = await tx.query<{ id: number }>(
    'SELECT id FROM comercial.quadro_colunas WHERE quadro_id = $1',
    [quadroId],
  );
  const existem = new Set(atuais.map((c) => c.id));
  const ficam = new Set(colunas.flatMap((c) => (c.id && existem.has(c.id) ? [c.id] : [])));
  const sair = [...existem].filter((id) => !ficam.has(id));
  if (sair.length) await tx.query('DELETE FROM comercial.quadro_colunas WHERE id = ANY($1::int[])', [sair]);
  for (const [ordem, c] of colunas.entries()) {
    if (c.id && existem.has(c.id))
      await tx.query(
        'UPDATE comercial.quadro_colunas SET nome = $2, gatilho = $3, cor = $4, ordem = $5 WHERE id = $1',
        [c.id, c.nome, c.gatilho, c.cor, ordem],
      );
    else
      await tx.query(
        'INSERT INTO comercial.quadro_colunas (quadro_id, nome, gatilho, cor, ordem) VALUES ($1, $2, $3, $4, $5)',
        [quadroId, c.nome, c.gatilho, c.cor, ordem],
      );
  }
  // Cartão que ficou sem coluna e sem sugestão (a coluna sugerida saiu): sai do quadro.
  await tx.query(
    'DELETE FROM comercial.quadro_cartoes WHERE quadro_id = $1 AND coluna_id IS NULL AND sugerida_id IS NULL',
    [quadroId],
  );
}

export async function criar(pool: Pool, d: QuadroEntrada): Promise<Quadro> {
  const C = contaSql();
  const id = await comTransacao(pool, async (tx) => {
    const { rows: n } = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM comercial.quadros WHERE conta_id = ${C}`,
    );
    if ((n[0]?.n ?? 0) >= MAX_QUADROS) throw AppError.invalido(`Até ${MAX_QUADROS} quadros por conta.`);
    const { rows } = await tx
      .query<{ id: number }>(
        `INSERT INTO comercial.quadros (conta_id, nome, ia, confirmar, ordem)
         VALUES (${C}, $1, $2, $3, coalesce((SELECT max(ordem) + 1 FROM comercial.quadros WHERE conta_id = ${C}), 0))
         RETURNING id`,
        [d.nome, d.ia, d.confirmar],
      )
      .catch(nomeRepetido);
    await gravarColunas(tx, rows[0]!.id, d.colunas);
    return rows[0]!.id;
  });
  return (await listar(pool)).find((q) => q.id === id)!;
}

export async function atualizar(pool: Pool, id: number, d: QuadroEntrada): Promise<Quadro> {
  await comTransacao(pool, async (tx) => {
    await exigirQuadro(tx, id);
    await tx
      .query(
        'UPDATE comercial.quadros SET nome = $2, ia = $3, confirmar = $4, atualizado_em = now() WHERE id = $1',
        [id, d.nome, d.ia, d.confirmar],
      )
      .catch(nomeRepetido);
    await gravarColunas(tx, id, d.colunas);
  });
  return (await listar(pool)).find((q) => q.id === id)!;
}

export async function apagar(db: Executor, id: number): Promise<void> {
  await db.query(`DELETE FROM comercial.quadros WHERE id = $1 AND conta_id = ${contaSql()}`, [id]);
}

/* ───────────────────────────── Cartões ───────────────────────────── */

export async function cartoes(
  db: Executor,
  quadroId: number,
  f: { responsavel: number | null },
): Promise<CartaoQuadro[]> {
  await exigirQuadro(db, quadroId);
  const C = contaSql();
  const { rows } = await db.query<CartaoQuadro>(
    `SELECT k.empresa_id::int AS "empresaId", coalesce(e.maps_nome, e.nome) AS nome,
            o.responsavel_id AS "responsavelId", r.nome AS "responsavelNome",
            k.coluna_id AS "colunaId", k.sugerida_id AS "sugeridaId", k.origem, k.trecho, k.motivo,
            k.movido_em AS "movidoEm", k.sugerida_em AS "sugeridaEm", p.nome AS "movidoPor",
            (SELECT max(m.criado_em) FROM comercial.mensagens m
              WHERE m.conta_id = k.conta_id AND m.empresa_id = k.empresa_id) AS "ultimaMensagemEm"
       FROM comercial.quadro_cartoes k
       JOIN descoberta.empresas e ON e.id = k.empresa_id
       LEFT JOIN comercial.oportunidades o ON o.conta_id = k.conta_id AND o.empresa_id = k.empresa_id
       LEFT JOIN cadastro.usuarios r ON r.id = o.responsavel_id
       LEFT JOIN cadastro.usuarios p ON p.id = k.movido_por
      WHERE k.quadro_id = $1 AND k.conta_id = ${C} AND ${empresaVisivel('k.empresa_id')}
        AND ($2::int IS NULL OR o.responsavel_id = $2)
        AND (k.coluna_id IS NOT NULL OR k.sugerida_id IS NOT NULL)
      ORDER BY coalesce(k.sugerida_em, k.movido_em) DESC
      LIMIT 2000`,
    [quadroId, f.responsavel],
  );
  return rows;
}

async function exigirColuna(db: Executor, quadroId: number, colunaId: number): Promise<string> {
  const { rows } = await db.query<{ nome: string }>(
    'SELECT nome FROM comercial.quadro_colunas WHERE id = $1 AND quadro_id = $2',
    [colunaId, quadroId],
  );
  if (!rows[0]) throw AppError.invalido('Essa coluna não é deste quadro.');
  return rows[0].nome;
}

async function anotar(
  db: Executor,
  empresaId: number,
  texto: string,
  autor: string,
  usuarioId: number | null,
) {
  await db.query(
    `INSERT INTO comercial.atividades (conta_id, empresa_id, tipo, texto, autor, usuario_id)
     VALUES (${contaSql()}, $1, 'nota', $2, $3, $4)`,
    [empresaId, texto.slice(0, 1000), autor, usuarioId],
  );
}

/** Pessoa põe o lead (ou move) numa coluna: vale na hora e a sugestão da IA sai. */
export async function mover(
  db: Executor,
  quadroId: number,
  empresaId: number,
  colunaId: number,
): Promise<void> {
  const q = await exigirQuadro(db, quadroId);
  const coluna = await exigirColuna(db, quadroId, colunaId);
  const u = usuarioAtual();
  const { rows } = await db.query<{ antes: number | null }>(
    `INSERT INTO comercial.quadro_cartoes (conta_id, quadro_id, empresa_id, coluna_id, origem, movido_por)
     VALUES (${contaSql()}, $1, $2, $3, 'pessoa', $4)
     ON CONFLICT (quadro_id, empresa_id) DO UPDATE
       SET coluna_id = $3, sugerida_id = NULL, sugerida_em = NULL, origem = 'pessoa', trecho = NULL, motivo = NULL,
           mensagem_id = NULL, movido_por = $4, movido_em = now()
     RETURNING (SELECT coluna_id FROM comercial.quadro_cartoes WHERE quadro_id = $1 AND empresa_id = $2) AS antes`,
    [quadroId, empresaId, colunaId, u?.id ?? null],
  );
  if (rows[0]?.antes !== colunaId)
    await anotar(db, empresaId, `Quadro ${q.nome}: em "${coluna}"`, u?.nome ?? 'sistema', u?.id ?? null);
}

/** Confirma a sugestão da IA: o lead vai para a coluna sugerida. */
export async function confirmar(db: Executor, quadroId: number, empresaId: number): Promise<void> {
  const q = await exigirQuadro(db, quadroId);
  const u = usuarioAtual();
  const { rows } = await db.query<{ coluna: string; trecho: string | null }>(
    `UPDATE comercial.quadro_cartoes k
        SET coluna_id = k.sugerida_id, sugerida_id = NULL, sugerida_em = NULL, origem = 'ia',
            movido_por = $3, movido_em = now()
      WHERE k.quadro_id = $1 AND k.empresa_id = $2 AND k.sugerida_id IS NOT NULL
      RETURNING (SELECT nome FROM comercial.quadro_colunas WHERE id = k.coluna_id) AS coluna, k.trecho`,
    [quadroId, empresaId, u?.id ?? null],
  );
  const r = rows[0];
  if (!r) throw AppError.conflito('Essa sugestão já foi resolvida.');
  await anotar(
    db,
    empresaId,
    `Quadro ${q.nome}: em "${r.coluna}" (sugestão da IA confirmada${r.trecho ? `: “${r.trecho}”` : ''})`,
    u?.nome ?? 'sistema',
    u?.id ?? null,
  );
}

/** Descarta a sugestão: o lead fica onde estava (ou sai do quadro, se ainda não tinha entrado). */
export async function descartar(db: Executor, quadroId: number, empresaId: number): Promise<void> {
  await exigirQuadro(db, quadroId);
  await db.query(
    `DELETE FROM comercial.quadro_cartoes WHERE quadro_id = $1 AND empresa_id = $2 AND coluna_id IS NULL`,
    [quadroId, empresaId],
  );
  await db.query(
    `UPDATE comercial.quadro_cartoes SET sugerida_id = NULL, sugerida_em = NULL
      WHERE quadro_id = $1 AND empresa_id = $2`,
    [quadroId, empresaId],
  );
}

export async function tirar(db: Executor, quadroId: number, empresaId: number): Promise<void> {
  await exigirQuadro(db, quadroId);
  await db.query('DELETE FROM comercial.quadro_cartoes WHERE quadro_id = $1 AND empresa_id = $2', [
    quadroId,
    empresaId,
  ]);
}

/** Leads do funil para pôr no quadro à mão (os que esta pessoa vê). */
export async function buscarLeads(db: Executor, busca: string) {
  const C = contaSql();
  const { rows } = await db.query<{ empresaId: number; nome: string; responsavelNome: string | null }>(
    `SELECT o.empresa_id::int AS "empresaId", coalesce(e.maps_nome, e.nome) AS nome, r.nome AS "responsavelNome"
       FROM comercial.oportunidades o
       JOIN descoberta.empresas e ON e.id = o.empresa_id
       LEFT JOIN cadastro.usuarios r ON r.id = o.responsavel_id
      WHERE o.conta_id = ${C} AND o.etapa <> 'descartado' AND ${empresaVisivel('o.empresa_id')}
        AND ($1 = '' OR coalesce(e.maps_nome, e.nome) ILIKE '%' || $1 || '%' OR e.nome ILIKE '%' || $1 || '%')
      ORDER BY o.atualizado_em DESC NULLS LAST
      LIMIT 20`,
    [busca.replace(/[%_\\]/g, '')],
  );
  return rows;
}
