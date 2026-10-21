import { cifrar, decifrar, type Pool } from '@prospeccao/db';
import type { Logger } from '@prospeccao/shared';
import webpush from 'web-push';

/**
 * Notificação no celular (Web Push). As chaves VAPID da plataforma são geradas pelo próprio
 * sistema na primeira vez e ficam no banco (a privada cifrada com CHAVE_CREDENCIAIS, quando há):
 * nada para configurar. Cada aparelho que ativa as notificações vira uma inscrição; todo aviso do
 * sino também vai para os aparelhos da pessoa.
 */

interface Estado {
  pool: Pool;
  log: Logger;
  publica: string;
}
let estado: Estado | null = null;

async function lerOuGerarChaves(
  pool: Pool,
  chave: string | null,
): Promise<{ publica: string; privada: string }> {
  const ler = async () => {
    const { rows } = await pool.query<{ chave: string; valor: string }>(
      `SELECT chave, valor FROM cadastro.plataforma WHERE chave IN ('vapid_publica', 'vapid_privada')`,
    );
    const m = new Map(rows.map((r) => [r.chave, r.valor]));
    return { publica: m.get('vapid_publica'), privada: m.get('vapid_privada') };
  };
  let atual = await ler();
  if (!atual.publica || !atual.privada) {
    const novas = webpush.generateVAPIDKeys();
    const privada = chave ? cifrar(chave, novas.privateKey) : novas.privateKey;
    // Duas instâncias subindo juntas: a primeira grava, a outra lê o que ficou.
    await pool.query(
      `INSERT INTO cadastro.plataforma (chave, valor) VALUES ('vapid_publica', $1), ('vapid_privada', $2)
       ON CONFLICT (chave) DO NOTHING`,
      [novas.publicKey, privada],
    );
    atual = await ler();
  }
  const privada = atual.privada!.startsWith('v1:')
    ? chave
      ? decifrar(chave, atual.privada!)
      : ''
    : atual.privada!;
  return { publica: atual.publica!, privada };
}

/** Liga o envio (na subida da API). Sem conseguir as chaves, o push fica desligado e o resto segue. */
export async function iniciarPush(
  pool: Pool,
  log: Logger,
  chave: string | null,
  contato: string,
): Promise<void> {
  try {
    const { publica, privada } = await lerOuGerarChaves(pool, chave);
    if (!privada) {
      log.warn(
        'push: a chave VAPID está cifrada com uma CHAVE_CREDENCIAIS diferente; notificação no celular desligada',
      );
      return;
    }
    webpush.setVapidDetails(`mailto:${contato}`, publica, privada);
    estado = { pool, log, publica };
  } catch (erro) {
    log.warn({ err: erro }, 'push: não consegui preparar as chaves; notificação no celular desligada');
  }
}

export function chavePublica(): string | null {
  return estado?.publica ?? null;
}

export async function inscrever(
  pool: Pool,
  usuarioId: number,
  d: { endpoint: string; keys: { p256dh: string; auth: string }; aparelho?: string | null },
): Promise<void> {
  await pool.query(
    `INSERT INTO cadastro.push_inscricoes (usuario_id, endpoint, p256dh, auth, aparelho)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET usuario_id = EXCLUDED.usuario_id, p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth, aparelho = EXCLUDED.aparelho, falhas = 0`,
    [usuarioId, d.endpoint, d.keys.p256dh, d.keys.auth, d.aparelho ?? null],
  );
}

export async function cancelar(pool: Pool, usuarioId: number, endpoint: string): Promise<void> {
  await pool.query('DELETE FROM cadastro.push_inscricoes WHERE usuario_id = $1 AND endpoint = $2', [
    usuarioId,
    endpoint,
  ]);
}

export async function aparelhos(pool: Pool, usuarioId: number) {
  const { rows } = await pool.query(
    `SELECT id::int, aparelho, criado_em AS "criadoEm", usado_em AS "usadoEm"
       FROM cadastro.push_inscricoes WHERE usuario_id = $1 ORDER BY id`,
    [usuarioId],
  );
  return rows;
}

export interface MensagemPush {
  titulo: string;
  texto?: string | null;
  link?: string | null;
  /** Mesma tag substitui a notificação anterior (o lead que manda cinco mensagens). */
  tag?: string | null;
}

/** Manda para todos os aparelhos da pessoa. Nunca lança erro (aviso no celular é extra). */
export async function enviarPush(usuarioId: number, m: MensagemPush): Promise<number> {
  const e = estado;
  if (!e) return 0;
  try {
    const { rows } = await e.pool.query<{ id: number; endpoint: string; p256dh: string; auth: string }>(
      'SELECT id::int, endpoint, p256dh, auth FROM cadastro.push_inscricoes WHERE usuario_id = $1',
      [usuarioId],
    );
    const corpo = JSON.stringify({
      titulo: m.titulo.slice(0, 120),
      texto: m.texto?.slice(0, 240) ?? '',
      link: m.link ?? '/',
      tag: m.tag ?? null,
    });
    let enviados = 0;
    for (const i of rows) {
      try {
        await webpush.sendNotification(
          { endpoint: i.endpoint, keys: { p256dh: i.p256dh, auth: i.auth } },
          corpo,
          {
            TTL: 6 * 3600,
            urgency: 'high',
          },
        );
        enviados++;
        await e.pool.query('UPDATE cadastro.push_inscricoes SET usado_em = now(), falhas = 0 WHERE id = $1', [
          i.id,
        ]);
      } catch (erro) {
        const status = (erro as { statusCode?: number }).statusCode;
        // 404/410: o aparelho cancelou (ou desinstalou); muitas falhas seguidas: também sai.
        if (status === 404 || status === 410)
          await e.pool.query('DELETE FROM cadastro.push_inscricoes WHERE id = $1', [i.id]);
        else
          await e.pool.query('UPDATE cadastro.push_inscricoes SET falhas = falhas + 1 WHERE id = $1', [i.id]);
        e.log.warn({ status, inscricao: i.id }, 'push: aviso não chegou ao aparelho');
      }
    }
    await e.pool.query('DELETE FROM cadastro.push_inscricoes WHERE falhas >= 10');
    return enviados;
  } catch (erro) {
    e.log.warn({ err: erro }, 'push: falhou');
    return 0;
  }
}
