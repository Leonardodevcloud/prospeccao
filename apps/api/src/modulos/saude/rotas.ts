import { Router } from 'express';
import type { DepsApi } from '../../dependencias.js';

/** /saude é público (healthcheck do Railway); /saude/detalhes exige sessão. */
export function rotasSaudePublica({ pool }: DepsApi): Router {
  const r = Router();
  r.get('/', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  });
  return r;
}

export function rotasSaudeDetalhes({ pool, filas }: DepsApi): Router {
  const r = Router();
  r.get('/', async (_req, res) => {
    const [filasAbertas, importacao, migrations] = await Promise.all([
      filas.tamanhos(),
      pool.query(`SELECT mes, status, concluido_em AS "concluidoEm" FROM base_cnpj.v_ultima_importacao`),
      pool.query<{ n: number }>('SELECT count(*)::int AS n FROM public.schema_migrations'),
    ]);
    res.json({
      filas: filasAbertas,
      ultimaImportacaoCnpj: importacao.rows[0] ?? null,
      migrationsAplicadas: migrations.rows[0]?.n ?? 0,
    });
  });
  return r;
}
