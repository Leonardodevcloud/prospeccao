import { comTransacao, type Executor, type Pool } from '@prospeccao/db';
import { AppError } from '@prospeccao/shared';

/** Pipelines e etapas (editáveis na tela). Sempre fica pelo menos uma etapa de cada papel essencial. */

export async function listar(db: Executor) {
  const { rows } = await db.query(
    `SELECT p.id, p.nome, p.ordem,
            (SELECT count(*)::int FROM comercial.oportunidades o JOIN comercial.etapas et ON et.id = o.etapa_id
              WHERE et.pipeline_id = p.id AND o.etapa NOT IN ('ganho', 'perdido', 'descartado')) AS abertos,
            coalesce((SELECT json_agg(json_build_object('id', et.id, 'nome', et.nome, 'cor', et.cor,
                                                        'ordem', et.ordem, 'papel', et.papel) ORDER BY et.ordem, et.id)
                        FROM comercial.etapas et WHERE et.pipeline_id = p.id), '[]') AS etapas
       FROM comercial.pipelines p ORDER BY p.ordem, p.id`,
  );
  return rows;
}

export async function criarPipeline(db: Executor, nome: string): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO comercial.pipelines (nome, ordem)
     VALUES ($1, coalesce((SELECT max(ordem) FROM comercial.pipelines), 0) + 1) RETURNING id`,
    [nome],
  );
  const id = rows[0]!.id;
  // Começa com o mínimo para funcionar; o usuário ajusta as etapas depois.
  await db.query(
    `INSERT INTO comercial.etapas (pipeline_id, nome, cor, ordem, papel) VALUES
       ($1, 'Em andamento', '#3b82f6', 1, 'respondeu'),
       ($1, 'Ganho', '#16a34a', 2, 'ganho'),
       ($1, 'Perdido', '#ef4444', 3, 'perdido')`,
    [id],
  );
  return id;
}

export async function renomearPipeline(db: Executor, id: number, nome: string) {
  const { rowCount } = await db.query('UPDATE comercial.pipelines SET nome = $2 WHERE id = $1', [id, nome]);
  if (!rowCount) throw AppError.naoEncontrado('Pipeline');
}

export async function apagarPipeline(db: Executor, id: number) {
  const { rows } = await db.query<{ n: number; total: number }>(
    `SELECT (SELECT count(*) FROM comercial.oportunidades o JOIN comercial.etapas et ON et.id = o.etapa_id
              WHERE et.pipeline_id = $1)::int AS n,
            (SELECT count(*) FROM comercial.pipelines)::int AS total`,
    [id],
  );
  if ((rows[0]?.total ?? 0) <= 1) throw AppError.invalido('Precisa ficar pelo menos um pipeline.');
  if ((rows[0]?.n ?? 0) > 0)
    throw AppError.invalido(
      `Este pipeline tem ${rows[0]?.n} lead(s). Mova os leads para outro pipeline antes.`,
    );
  await db.query('DELETE FROM comercial.pipelines WHERE id = $1', [id]);
}

export async function criarEtapa(
  db: Executor,
  pipelineId: number,
  e: { nome: string; cor: string; papel: string },
): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO comercial.etapas (pipeline_id, nome, cor, papel, ordem)
     SELECT $1, $2, $3, $4, coalesce(max(ordem), 0) + 1 FROM comercial.etapas WHERE pipeline_id = $1
     RETURNING id`,
    [pipelineId, e.nome, e.cor, e.papel],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Pipeline');
  return rows[0].id;
}

/** Papéis que não podem sumir: sem eles a cadência ou o fechamento não têm para onde mandar o lead. */
const ESSENCIAIS = ['a_abordar', 'abordado', 'respondeu', 'reuniao', 'proposta', 'ganho', 'perdido'];

async function conferirPapeis(db: Executor) {
  const { rows } = await db.query<{ papel: string }>('SELECT DISTINCT papel FROM comercial.etapas');
  const tem = new Set(rows.map((r) => r.papel));
  const falta = ESSENCIAIS.filter((p) => !tem.has(p));
  if (falta.length)
    throw AppError.invalido(
      'Toda etapa automática precisa existir em algum pipeline (primeiro contato, aguardando resposta, conversa, reunião, proposta, ganho e perdido).',
    );
}

export async function atualizarEtapa(
  pool: Pool,
  id: number,
  d: { nome?: string; cor?: string; papel?: string; ordem?: number },
) {
  await comTransacao(pool, async (tx) => {
    const { rows } = await tx.query<{ pipeline_id: number; papel: string }>(
      'SELECT pipeline_id, papel FROM comercial.etapas WHERE id = $1 FOR UPDATE',
      [id],
    );
    const atual = rows[0];
    if (!atual) throw AppError.naoEncontrado('Etapa');
    if (d.nome !== undefined || d.cor !== undefined || d.papel !== undefined)
      await tx.query(
        `UPDATE comercial.etapas SET nome = coalesce($2, nome), cor = coalesce($3, cor), papel = coalesce($4, papel)
          WHERE id = $1`,
        [id, d.nome ?? null, d.cor ?? null, d.papel ?? null],
      );
    if (d.papel && d.papel !== atual.papel) {
      await conferirPapeis(tx);
      // Leads nesta etapa passam a ter o novo papel (a cadência segue o papel).
      await tx.query('UPDATE comercial.oportunidades SET etapa = $2 WHERE etapa_id = $1', [id, d.papel]);
    }
    if (d.ordem !== undefined) {
      const { rows: lista } = await tx.query<{ id: number }>(
        'SELECT id FROM comercial.etapas WHERE pipeline_id = $1 AND id <> $2 ORDER BY ordem, id',
        [atual.pipeline_id, id],
      );
      const ids = lista.map((r) => r.id);
      ids.splice(Math.min(d.ordem - 1, ids.length), 0, id);
      for (const [i, eid] of ids.entries())
        await tx.query('UPDATE comercial.etapas SET ordem = $2 WHERE id = $1', [eid, i + 1]);
    }
  });
}

export async function apagarEtapa(pool: Pool, id: number) {
  await comTransacao(pool, async (tx) => {
    const { rows } = await tx.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM comercial.oportunidades WHERE etapa_id = $1',
      [id],
    );
    if ((rows[0]?.n ?? 0) > 0)
      throw AppError.invalido(`Esta etapa tem ${rows[0]?.n} lead(s). Mova os cards para outra etapa antes.`);
    const { rowCount } = await tx.query('DELETE FROM comercial.etapas WHERE id = $1', [id]);
    if (!rowCount) throw AppError.naoEncontrado('Etapa');
    await conferirPapeis(tx);
  });
}
