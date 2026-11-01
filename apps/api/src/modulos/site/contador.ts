import type { Executor } from '@prospeccao/db';
import { NICHOS_PRONTOS } from '@prospeccao/shared';

/**
 * Contador público do site: quantas empresas ativas de um nicho pronto existem numa cidade (ou na
 * UF inteira), pela contagem que a importação da base de CNPJ faz no Brasil todo. Só o número,
 * nunca os dados das empresas.
 */

export const NICHOS_DO_CONTADOR = NICHOS_PRONTOS.map((n) => ({ id: n.id, nome: n.nome }));

/** A publicação da Receita da contagem que está valendo (null: ainda não há contagem). */
export async function situacaoDoContador(db: Executor): Promise<{ disponivel: boolean; mes: string | null }> {
  const { rows } = await db.query<{ tem: boolean; mes: string | null }>(
    `SELECT EXISTS (SELECT 1 FROM base_cnpj.contagem_nichos) AS tem,
            (SELECT mes FROM base_cnpj.importacoes WHERE status = 'concluida' AND mes ~ '^\\d{4}-\\d{2}$'
              ORDER BY concluido_em DESC NULLS LAST LIMIT 1) AS mes`,
  );
  return { disponivel: !!rows[0]?.tem, mes: rows[0]?.tem ? (rows[0].mes ?? null) : null };
}

export type Contagem =
  | { achou: true; ativas: number; cidade: string | null; uf: string; nicho: { id: string; nome: string } }
  | { achou: false; motivo: 'sem_contagem' | 'cidade' };

export async function contarEmpresas(
  db: Executor,
  q: { nicho: string; uf: string; cidade?: string | null },
): Promise<Contagem> {
  const nicho = NICHOS_DO_CONTADOR.find((n) => n.id === q.nicho)!;
  const uf = q.uf.toUpperCase();
  if (!(await situacaoDoContador(db)).disponivel) return { achou: false, motivo: 'sem_contagem' };
  const cidade = q.cidade?.trim().replace(/\s+/g, ' ') || null;
  if (!cidade) {
    const { rows } = await db.query<{ n: number }>(
      'SELECT coalesce(sum(ativas), 0)::int AS n FROM base_cnpj.contagem_nichos WHERE uf = $1 AND nicho = $2',
      [uf, nicho.id],
    );
    return { achou: true, ativas: rows[0]?.n ?? 0, cidade: null, uf, nicho };
  }
  // A cidade existe na UF? (os nomes da Receita vêm sem acento: compara normalizado)
  const { rows: m } = await db.query<{ codigo: string }>(
    `SELECT DISTINCT c.municipio_codigo AS codigo
       FROM base_cnpj.contagem_nichos c JOIN base_cnpj.municipios m ON m.codigo = c.municipio_codigo
      WHERE c.uf = $1 AND public.normalizar_cidade(m.nome) = public.normalizar_cidade($2)`,
    [uf, cidade],
  );
  if (!m.length) return { achou: false, motivo: 'cidade' };
  const { rows } = await db.query<{ n: number }>(
    `SELECT coalesce(sum(ativas), 0)::int AS n FROM base_cnpj.contagem_nichos
      WHERE uf = $1 AND nicho = $2 AND municipio_codigo = ANY($3::text[])`,
    [uf, nicho.id, m.map((x) => x.codigo)],
  );
  return { achou: true, ativas: rows[0]?.n ?? 0, cidade, uf, nicho };
}
