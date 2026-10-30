import type { Executor } from '@prospeccao/db';
import { contaSql } from '../../contexto.js';
import { temRecurso } from '../../recursos.js';
import { enviarPush } from '../push/servico.js';

/** Avisos para cada pessoa da equipe (o sino do menu). */

export interface Aviso {
  tipo: 'mensagem' | 'atribuido' | 'reuniao' | 'tarefa' | 'sistema';
  titulo: string;
  texto?: string | null;
  empresaId?: number | null;
  link?: string | null;
}

/** Para onde o toque na notificação do celular leva. */
function linkDoAviso(a: Aviso): string {
  if (a.link) return a.link;
  if (a.tipo === 'mensagem' && a.empresaId) return `/conversas?lead=${a.empresaId}`;
  if (a.empresaId) return `/funil?empresa=${a.empresaId}`;
  return a.tipo === 'reuniao' || a.tipo === 'tarefa' ? '/hoje' : '/';
}

/**
 * Cria um aviso (o sino) e manda para o celular de quem ativou as notificações. Mensagens do
 * mesmo lead se juntam num aviso só enquanto ele não for lido (o lead que manda cinco mensagens
 * seguidas não gera cinco avisos; no celular, a notificação é trocada pela nova).
 */
export async function notificar(db: Executor, usuarioId: number, a: Aviso): Promise<void> {
  await gravarAviso(db, usuarioId, a);
  // Notificação no celular é do plano Time em diante (o sino do sistema vale sempre).
  if (!(await temRecurso(db, 'celular'))) return;
  void enviarPush(usuarioId, {
    titulo: a.titulo,
    texto: a.texto ?? null,
    link: linkDoAviso(a),
    tag: a.tipo === 'mensagem' && a.empresaId ? `lead-${a.empresaId}` : null,
  });
}

async function gravarAviso(db: Executor, usuarioId: number, a: Aviso): Promise<void> {
  if (a.tipo === 'mensagem' && a.empresaId) {
    const { rowCount } = await db.query(
      `UPDATE comercial.notificacoes SET titulo = $3, texto = $4, criado_em = now()
        WHERE conta_id = ${contaSql()} AND usuario_id = $1 AND empresa_id = $2 AND tipo = 'mensagem'
          AND lida_em IS NULL`,
      [usuarioId, a.empresaId, a.titulo, a.texto ?? null],
    );
    if (rowCount) return;
  }
  await db.query(
    `INSERT INTO comercial.notificacoes (conta_id, usuario_id, tipo, titulo, texto, empresa_id, link)
     VALUES (${contaSql()}, $1, $2, $3, $4, $5, $6)`,
    [
      usuarioId,
      a.tipo,
      a.titulo.slice(0, 200),
      a.texto?.slice(0, 500) ?? null,
      a.empresaId ?? null,
      a.link ?? null,
    ],
  );
}

/** Avisa o dono do lead; sem dono, avisa os administradores. */
export async function notificarDono(db: Executor, empresaId: number, a: Aviso): Promise<void> {
  const C = contaSql();
  const { rows } = await db.query<{ id: number }>(
    `SELECT u.id FROM comercial.oportunidades o JOIN cadastro.usuarios u ON u.id = o.responsavel_id
      WHERE o.conta_id = ${C} AND o.empresa_id = $1 AND u.ativo
     UNION ALL
     SELECT u.id FROM cadastro.usuarios u
      WHERE u.conta_id = ${C} AND u.papel = 'admin' AND u.ativo
        AND NOT EXISTS (SELECT 1 FROM comercial.oportunidades o JOIN cadastro.usuarios d ON d.id = o.responsavel_id
                         WHERE o.conta_id = ${C} AND o.empresa_id = $1 AND d.ativo)`,
    [empresaId],
  );
  for (const r of rows) await notificar(db, r.id, { ...a, empresaId });
}

export async function listar(db: Executor, usuarioId: number) {
  const C = contaSql();
  const [itens, conta] = await Promise.all([
    db.query(
      `SELECT id, tipo, titulo, texto, empresa_id::int AS "empresaId", link, lida_em AS "lidaEm",
              criado_em AS "criadoEm"
         FROM comercial.notificacoes WHERE conta_id = ${C} AND usuario_id = $1
        ORDER BY criado_em DESC LIMIT 40`,
      [usuarioId],
    ),
    db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM comercial.notificacoes WHERE conta_id = ${C} AND usuario_id = $1 AND lida_em IS NULL`,
      [usuarioId],
    ),
  ]);
  return { naoLidas: conta.rows[0]?.n ?? 0, itens: itens.rows };
}

export async function marcarLidas(db: Executor, usuarioId: number, id?: number): Promise<void> {
  await db.query(
    `UPDATE comercial.notificacoes SET lida_em = now()
      WHERE conta_id = ${contaSql()} AND usuario_id = $1 AND lida_em IS NULL AND ($2::bigint IS NULL OR id = $2)`,
    [usuarioId, id ?? null],
  );
}

/** Ao abrir a conversa de um lead, os avisos de mensagem dele somem. */
export async function lerAvisosDoLead(db: Executor, usuarioId: number, empresaId: number): Promise<void> {
  await db.query(
    `UPDATE comercial.notificacoes SET lida_em = now()
      WHERE conta_id = ${contaSql()} AND usuario_id = $1 AND empresa_id = $2 AND tipo = 'mensagem'
        AND lida_em IS NULL`,
    [usuarioId, empresaId],
  );
}
