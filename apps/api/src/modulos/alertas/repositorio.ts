import type { Executor } from '@prospeccao/db';
import { comConta } from '../../contexto.js';
import { notificar } from '../notificacoes/repositorio.js';

/**
 * Alertas: o que quebrou e precisa de alguém (e-mail não sai, chip caiu, worker parou…). Cada
 * alerta tem uma chave: enquanto o problema continua, é o mesmo alerta (avisa uma vez só); quando
 * some, ele fecha sozinho. Alerta de conta vai para os administradores dela; o da plataforma
 * (conta null), para quem é master.
 */

/**
 * Alertas que o cliente vê (limites do plano). Os técnicos (chaves, WhatsApp desconectado, e-mail
 * falhando, serviços parados) vão só para quem é master: o cliente não configura nada disso.
 */
const DO_CLIENTE = ['plano:', 'limite_emails', 'limite_whatsapp'];
export const ehDoCliente = (chave: string) => DO_CLIENTE.some((p) => chave.startsWith(p));

export interface NovoAlerta {
  nivel?: 'erro' | 'aviso';
  titulo: string;
  texto?: string | null;
  link?: string | null;
}

/** Abre (ou mantém) o alerta. Na primeira vez, avisa quem cuida. Devolve true se é novo. */
export async function abrir(
  db: Executor,
  contaId: number | null,
  chave: string,
  a: NovoAlerta,
): Promise<boolean> {
  const { rows } = await db.query<{ novo: boolean }>(
    `INSERT INTO comercial.alertas (conta_id, chave, nivel, titulo, texto, link)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT ((coalesce(conta_id, 0)), chave) WHERE ativo
     DO UPDATE SET ultima_vez = now(), titulo = EXCLUDED.titulo, texto = EXCLUDED.texto,
                   nivel = EXCLUDED.nivel, link = EXCLUDED.link
     RETURNING (xmax = 0) AS novo`,
    [
      contaId,
      chave,
      a.nivel ?? 'erro',
      a.titulo.slice(0, 200),
      a.texto?.slice(0, 500) ?? null,
      a.link ?? null,
    ],
  );
  const novo = rows[0]?.novo ?? false;
  if (novo) await avisar(db, contaId, chave, a);
  return novo;
}

/** O problema sumiu: o alerta fecha. */
export async function fechar(db: Executor, contaId: number | null, chave: string): Promise<void> {
  await db.query(
    `UPDATE comercial.alertas SET ativo = false, resolvido_em = now()
      WHERE coalesce(conta_id, 0) = coalesce($1::int, 0) AND chave = $2 AND ativo`,
    [contaId, chave],
  );
}

/** Abre ou fecha conforme a condição. */
export async function conferir(
  db: Executor,
  contaId: number | null,
  chave: string,
  problema: NovoAlerta | null,
): Promise<void> {
  if (problema) await abrir(db, contaId, chave, problema);
  else await fechar(db, contaId, chave);
}

/** Fecha os alertas de um grupo (ex.: "chip:") que não foram vistos agora. */
export async function fecharOsOutros(
  db: Executor,
  contaId: number | null,
  prefixo: string,
  vistas: string[],
): Promise<void> {
  await db.query(
    `UPDATE comercial.alertas SET ativo = false, resolvido_em = now()
      WHERE coalesce(conta_id, 0) = coalesce($1::int, 0) AND ativo AND chave LIKE $2 AND NOT (chave = ANY($3::text[]))`,
    [contaId, `${prefixo}%`, vistas],
  );
}

async function avisar(db: Executor, contaId: number | null, chave: string, a: NovoAlerta) {
  const doCliente = contaId != null && ehDoCliente(chave);
  const { rows } = await db.query<{ id: number; conta_id: number; nome_conta: string | null }>(
    doCliente
      ? `SELECT id, conta_id, NULL AS nome_conta FROM cadastro.usuarios WHERE conta_id = $1 AND papel = 'admin' AND ativo`
      : // Técnico: só o master (com o nome do cliente no título, quando é de uma conta).
        `SELECT u.id, u.conta_id, (SELECT c.nome FROM cadastro.contas c WHERE c.id = $1 AND NOT c.principal) AS nome_conta
           FROM cadastro.usuarios u WHERE u.master AND u.ativo`,
    [contaId],
  );
  for (const u of rows)
    await comConta(u.conta_id, () =>
      notificar(db, u.id, {
        tipo: 'sistema',
        titulo: u.nome_conta ? `${u.nome_conta}: ${a.titulo}` : a.titulo,
        texto: a.texto ?? null,
        link: u.nome_conta && contaId ? `/master?conta=${contaId}` : (a.link ?? null),
      }),
    );
}

/** Alertas em aberto da conta (e os da plataforma, para o master). */
export async function ativos(db: Executor, contaId: number, master: boolean) {
  const { rows } = await db.query(
    `SELECT id::int, conta_id AS "contaId", chave, nivel, titulo, texto, link,
            primeira_vez AS "primeiraVez", ultima_vez AS "ultimaVez"
       FROM comercial.alertas
      WHERE ativo AND (conta_id = $1 OR ($2 AND conta_id IS NULL))
      ORDER BY (nivel = 'erro') DESC, primeira_vez`,
    [contaId, master],
  );
  // O cliente só vê os avisos de limite do plano; o resto é com o suporte (master).
  return master ? rows : rows.filter((r) => ehDoCliente(String(r.chave)));
}

/** Histórico recente (painel master). */
export async function recentes(db: Executor, contaId: number | null) {
  const { rows } = await db.query(
    `SELECT id::int, chave, nivel, titulo, texto, ativo, primeira_vez AS "primeiraVez",
            ultima_vez AS "ultimaVez", resolvido_em AS "resolvidoEm"
       FROM comercial.alertas WHERE coalesce(conta_id, 0) = coalesce($1::int, 0)
      ORDER BY id DESC LIMIT 50`,
    [contaId],
  );
  return rows;
}
