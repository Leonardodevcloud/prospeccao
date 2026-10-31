import type { Executor, Pool } from '@prospeccao/db';
import type { PedidoSiteAtualizar } from '@prospeccao/shared';
import { sqlLeadsDoMesDaOrganizacao, sqlUsuariosAtivos } from '../plano/repositorio.js';

/** Pedidos de demonstração (site e cadastro à mão) e o contato comercial que o site mostra. */

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

/** Pedido aberto do mesmo WhatsApp (pedir de novo não cria outro card). */
export async function pedidoAbertoDoNumero(pool: Pool, whatsapp: string): Promise<number | null> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM cadastro.pedidos_site
      WHERE whatsapp = $1 AND etapa NOT IN ('cliente', 'perdido') ORDER BY id DESC LIMIT 1`,
    [whatsapp],
  );
  return rows[0] ? Number(rows[0].id) : null;
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
    ipHash: string | null;
    nota?: string | null;
  },
): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO cadastro.pedidos_site (nome, empresa, whatsapp, email, nicho, plano, canal, ip_hash, nota)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [p.nome, p.empresa, p.whatsapp, p.email, p.nicho, p.plano, p.canal, p.ipHash, p.nota ?? null],
  );
  return Number(rows[0]!.id);
}

export async function historico(db: Executor, pedidoId: number, texto: string, autor: string | null) {
  await db.query(
    'INSERT INTO cadastro.pedidos_site_historico (pedido_id, texto, autor) VALUES ($1, $2, $3)',
    [pedidoId, texto.slice(0, 1000), autor],
  );
}

const CAMPOS =
  () => `p.id::int, p.nome, p.empresa, p.whatsapp, p.email, p.nicho, p.plano, p.canal, p.etapa, p.nota,
  p.motivo_perda AS "motivoPerda", p.demonstracao_em AS "demonstracaoEm", p.conta_id AS "contaId",
  (SELECT c.nome FROM cadastro.contas c WHERE c.id = p.conta_id) AS "contaNome",
  (SELECT json_build_object('situacao', o.assinatura, 'testeAte', o.teste_ate, 'valor', o.assinatura_valor,
          'forma', (SELECT b.forma FROM cadastro.cobrancas b WHERE b.organizacao_id = o.id AND b.situacao = 'paga' ORDER BY b.pago_em DESC NULLS LAST LIMIT 1), 'plano', o.plano, 'acessoAte', o.acesso_ate,
          'leads', ${sqlLeadsDoMesDaOrganizacao('o.id')}, 'usuarios', ${sqlUsuariosAtivos('o.id')},
          'ultimoAcesso', (SELECT max(u.ultimo_acesso) FROM cadastro.usuarios u JOIN cadastro.contas x ON x.id = u.conta_id
                            WHERE x.organizacao_id = o.id AND NOT u.master),
          'reunioes', (SELECT count(*)::int FROM comercial.tarefas t JOIN cadastro.contas x ON x.id = t.conta_id
                        WHERE x.organizacao_id = o.id AND t.tipo = 'reuniao'))
     FROM cadastro.contas c JOIN cadastro.organizacoes o ON o.id = c.organizacao_id
    WHERE c.id = p.conta_id AND o.assinatura IS NOT NULL) AS assinatura,
  p.criado_em AS "criadoEm", p.atualizado_em AS "atualizadoEm"`;

export async function listar(pool: Pool) {
  const { rows } = await pool.query(
    `SELECT ${CAMPOS()} FROM cadastro.pedidos_site p
      WHERE p.etapa NOT IN ('cliente', 'perdido') OR p.atualizado_em > now() - interval '90 days'
      ORDER BY p.atualizado_em DESC LIMIT 500`,
  );
  return rows;
}

export async function obter(pool: Pool, id: number) {
  const { rows } = await pool.query(`SELECT ${CAMPOS()} FROM cadastro.pedidos_site p WHERE p.id = $1`, [id]);
  if (!rows[0]) return null;
  const h = await pool.query(
    `SELECT id::int, texto, autor, criado_em AS "criadoEm" FROM cadastro.pedidos_site_historico
      WHERE pedido_id = $1 ORDER BY criado_em DESC, id DESC LIMIT 100`,
    [id],
  );
  return { ...rows[0], historico: h.rows };
}

export async function contarNovos(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM cadastro.pedidos_site WHERE etapa = 'novo'`,
  );
  return rows[0]?.n ?? 0;
}

/** Atualiza o que veio (undefined = não mexe) e devolve a linha anterior para o histórico. */
export async function atualizar(pool: Pool, id: number, d: PedidoSiteAtualizar) {
  const antes = await pool.query<{ etapa: string; conta_id: number | null }>(
    'SELECT etapa, conta_id FROM cadastro.pedidos_site WHERE id = $1',
    [id],
  );
  if (!antes.rows[0]) return null;
  const sets: string[] = ['atualizado_em = now()'];
  const valores: unknown[] = [id];
  const set = (coluna: string, v: unknown) => {
    valores.push(v);
    sets.push(`${coluna} = $${valores.length}`);
  };
  if (d.etapa !== undefined) set('etapa', d.etapa);
  if (d.nota !== undefined) set('nota', d.nota || null);
  if (d.motivoPerda !== undefined) set('motivo_perda', d.motivoPerda || null);
  if (d.demonstracaoEm !== undefined) set('demonstracao_em', d.demonstracaoEm);
  if (d.contaId !== undefined) set('conta_id', d.contaId);
  await pool.query(`UPDATE cadastro.pedidos_site SET ${sets.join(', ')} WHERE id = $1`, valores);
  return antes.rows[0];
}
