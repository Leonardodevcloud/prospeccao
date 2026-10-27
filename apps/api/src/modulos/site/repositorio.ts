import type { Pool } from '@prospeccao/db';

/** Pedidos de demonstração do site e o contato comercial que ele mostra. */

export interface ConfigSite {
  whatsapp: string | null;
  email: string | null;
}

export async function lerConfig(pool: Pool): Promise<ConfigSite> {
  const { rows } = await pool.query<ConfigSite>(
    'SELECT whatsapp, email FROM cadastro.config_site WHERE id = 1',
  );
  return rows[0] ?? { whatsapp: null, email: null };
}

export async function salvarConfig(pool: Pool, c: ConfigSite, usuarioId: number): Promise<void> {
  await pool.query(
    `INSERT INTO cadastro.config_site (id, whatsapp, email, atualizado_em, atualizado_por)
     VALUES (1, $1, $2, now(), $3)
     ON CONFLICT (id) DO UPDATE SET whatsapp = $1, email = $2, atualizado_em = now(), atualizado_por = $3`,
    [c.whatsapp, c.email, usuarioId],
  );
}

export async function contaPrincipal(pool: Pool): Promise<number | null> {
  const { rows } = await pool.query<{ id: number }>(
    'SELECT id FROM cadastro.contas WHERE principal ORDER BY id LIMIT 1',
  );
  return rows[0]?.id ?? null;
}

/** Quantos pedidos o mesmo endereço mandou na última hora (trava de abuso além do rate limit). */
export async function pedidosRecentes(pool: Pool, ipHash: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM cadastro.pedidos_site
      WHERE ip_hash = $1 AND criado_em > now() - interval '1 hour'`,
    [ipHash],
  );
  return rows[0]?.n ?? 0;
}

export async function gravarPedido(
  pool: Pool,
  p: {
    nome: string;
    empresa: string;
    whatsapp: string;
    email: string | null;
    nicho: string | null;
    plano: string | null;
    canal: string;
    ipHash: string;
  },
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO cadastro.pedidos_site (nome, empresa, whatsapp, email, nicho, plano, canal, ip_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [p.nome, p.empresa, p.whatsapp, p.email, p.nicho, p.plano, p.canal, p.ipHash],
  );
  return Number(rows[0]!.id);
}

export async function ligarLead(
  pool: Pool,
  id: number,
  empresaId: number | null,
  erro: string | null,
): Promise<void> {
  await pool.query('UPDATE cadastro.pedidos_site SET empresa_id = $2, erro_lead = $3 WHERE id = $1', [
    id,
    empresaId,
    erro,
  ]);
}

export async function listar(pool: Pool) {
  const { rows } = await pool.query(
    `SELECT id, nome, empresa, whatsapp, email, nicho, plano, canal, status,
            empresa_id AS "empresaId", erro_lead AS "erroLead", criado_em AS "criadoEm"
       FROM cadastro.pedidos_site ORDER BY criado_em DESC LIMIT 300`,
  );
  return rows.map((r) => ({ ...r, id: Number(r.id), empresaId: r.empresaId ? Number(r.empresaId) : null }));
}

export async function contarNovos(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM cadastro.pedidos_site WHERE status = 'novo'`,
  );
  return rows[0]?.n ?? 0;
}

export async function mudarStatus(pool: Pool, id: number, status: string): Promise<boolean> {
  const { rowCount } = await pool.query('UPDATE cadastro.pedidos_site SET status = $2 WHERE id = $1', [
    id,
    status,
  ]);
  return !!rowCount;
}
