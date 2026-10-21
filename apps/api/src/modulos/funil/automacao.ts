import type { Pool } from '@prospeccao/db';
import type { Logger } from '@prospeccao/shared';
import { paraCadaConta } from '../../rotinas.js';
import { encerrarSemResposta } from './repositorio.js';

/** Chave do lock: só uma instância da API roda a automação por vez. */
const LOCK = 7_301_017;
const INTERVALO_MS = 15 * 60_000;

/** Uma rodada: encerra quem esgotou a cadência sem responder. */
export async function rodarAutomacaoFunil(pool: Pool, log: Logger): Promise<void> {
  const cliente = await pool.connect();
  try {
    const { rows } = await cliente.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [LOCK]);
    if (!rows[0]?.ok) return;
    try {
      await paraCadaConta(pool, log, 'funil', async (conta) => {
        const n = await encerrarSemResposta(pool);
        if (n) log.info({ conta, encerrados: n }, 'funil: leads sem resposta foram para Perdido');
      });
    } finally {
      await cliente.query('SELECT pg_advisory_unlock($1)', [LOCK]);
    }
  } catch (erro) {
    log.error({ err: erro }, 'funil: automação falhou');
  } finally {
    cliente.release();
  }
}

/** Roda ao subir e a cada 15 minutos. Devolve a função que para. */
export function iniciarAutomacaoFunil(pool: Pool, log: Logger): () => void {
  void rodarAutomacaoFunil(pool, log);
  const t = setInterval(() => void rodarAutomacaoFunil(pool, log), INTERVALO_MS);
  t.unref();
  return () => clearInterval(t);
}
