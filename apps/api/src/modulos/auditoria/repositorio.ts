import type { Executor } from '@prospeccao/db';
import { contaSql } from '../../contexto.js';

/** Registro de quem fez o quê (alterações pela tela, logins, ações do master). */

export interface EventoAuditoria {
  contaId: number | null;
  usuarioId: number | null;
  usuarioNome: string | null;
  comoMaster?: boolean;
  acao: string;
  descricao: string;
  metodo?: string | null;
  caminho?: string | null;
  empresaId?: number | null;
  detalhes?: Record<string, unknown> | null;
  ip?: string | null;
}

export async function registrar(db: Executor, e: EventoAuditoria): Promise<void> {
  await db.query(
    `INSERT INTO cadastro.auditoria
       (conta_id, usuario_id, usuario_nome, como_master, acao, descricao, metodo, caminho, empresa_id, detalhes, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      e.contaId,
      e.usuarioId,
      e.usuarioNome,
      e.comoMaster ?? false,
      e.acao.slice(0, 80),
      e.descricao.slice(0, 500),
      e.metodo ?? null,
      e.caminho ?? null,
      e.empresaId ?? null,
      e.detalhes ? JSON.stringify(e.detalhes) : null,
      e.ip ?? null,
    ],
  );
}

export interface FiltrosAuditoria {
  usuarioId?: number;
  acao?: string;
  busca?: string;
  empresaId?: number;
  dias?: number;
  antesDe?: number;
}

/** Histórico da conta da sessão, do mais novo para o mais velho (páginas de 100). */
export async function listar(db: Executor, f: FiltrosAuditoria) {
  const where = [`a.conta_id = ${contaSql()}`];
  const valores: unknown[] = [];
  const p = (v: unknown) => {
    valores.push(v);
    return `$${valores.length}`;
  };
  if (f.usuarioId) where.push(`a.usuario_id = ${p(f.usuarioId)}`);
  if (f.acao) where.push(`a.acao = ${p(f.acao)}`);
  if (f.empresaId) where.push(`a.empresa_id = ${p(f.empresaId)}`);
  if (f.dias) where.push(`a.criado_em > now() - make_interval(days => ${p(f.dias)})`);
  if (f.antesDe) where.push(`a.id < ${p(f.antesDe)}`);
  if (f.busca)
    where.push(
      `(a.descricao ILIKE ${p(`%${f.busca}%`)} OR a.usuario_nome ILIKE ${p(`%${f.busca}%`)} OR e.nome ILIKE ${p(`%${f.busca}%`)})`,
    );
  const { rows } = await db.query(
    `SELECT a.id::int, a.usuario_id AS "usuarioId", a.usuario_nome AS "usuarioNome", a.como_master AS "comoMaster",
            a.acao, a.descricao, a.metodo, a.caminho, a.empresa_id::int AS "empresaId", e.nome AS "empresaNome",
            a.detalhes, a.ip, a.criado_em AS "criadoEm"
       FROM cadastro.auditoria a
       LEFT JOIN descoberta.empresas e ON e.id = a.empresa_id
      WHERE ${where.join(' AND ')}
      ORDER BY a.id DESC
      LIMIT 101`,
    valores,
  );
  return { itens: rows.slice(0, 100), temMais: rows.length > 100 };
}

/** Ações que aparecem no filtro (as que já aconteceram na conta). */
export async function acoes(db: Executor) {
  const { rows } = await db.query<{ acao: string; n: number }>(
    `SELECT acao, count(*)::int AS n FROM cadastro.auditoria WHERE conta_id = ${contaSql()}
      GROUP BY acao ORDER BY acao`,
  );
  return rows;
}

/** Histórico de uma conta qualquer (painel master), inclusive o que o master fez nela. */
export async function daConta(db: Executor, contaId: number) {
  const { rows } = await db.query(
    `SELECT a.id::int, a.usuario_nome AS "usuarioNome", a.como_master AS "comoMaster", a.acao, a.descricao,
            a.empresa_id::int AS "empresaId", e.nome AS "empresaNome", a.criado_em AS "criadoEm"
       FROM cadastro.auditoria a LEFT JOIN descoberta.empresas e ON e.id = a.empresa_id
      WHERE a.conta_id = $1 ORDER BY a.id DESC LIMIT 100`,
    [contaId],
  );
  return rows;
}
