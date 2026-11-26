import type { Pool } from '@prospeccao/db';
import type { Logger } from '@prospeccao/shared';
import { temRecurso } from '../../recursos.js';
import { paraCadaConta } from '../../rotinas.js';
import { encerrarParados } from './repositorio.js';

/** Chave do lock: só uma instância da API encerra os atendimentos parados por vez. */
const LOCK = 7_301_113;
const INTERVALO_MS = 10 * 60_000;

/** Uma rodada: encerra o que está aguardando o cliente há mais tempo do que a conta quer. */
export async function rodarCarteira(pool: Pool, log: Logger): Promise<void> {
  const cliente = await pool.connect();
  try {
    const { rows } = await cliente.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [LOCK]);
    if (!rows[0]?.ok) return;
    try {
      await paraCadaConta(pool, log, 'carteira', async (conta) => {
        if (!(await temRecurso(pool, 'carteira', conta))) return;
        const n = await encerrarParados(pool);
        if (n) log.info({ conta, encerrados: n }, 'carteira: atendimentos sem resposta encerrados');
      });
    } finally {
      await cliente.query('SELECT pg_advisory_unlock($1)', [LOCK]);
    }
  } catch (erro) {
    log.error({ err: erro }, 'carteira: rotina falhou');
  } finally {
    cliente.release();
  }
}

/** Roda ao subir e a cada 10 minutos. Devolve a função que para. */
export function iniciarCarteira(pool: Pool, log: Logger): () => void {
  void rodarCarteira(pool, log);
  const t = setInterval(() => void rodarCarteira(pool, log), INTERVALO_MS);
  t.unref();
  return () => clearInterval(t);
}
