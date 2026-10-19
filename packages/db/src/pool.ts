import { semSslmode, sslDoPostgres } from '@prospeccao/shared';
import pg from 'pg';

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;
export type Executor = Pick<pg.Pool, 'query'> | Pick<pg.PoolClient, 'query'>;

// int8 (bigserial, count) vem como string por padrão; nossos ids cabem em number.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number.parseInt(v, 10));
// numeric (nota, distância) → number.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number.parseFloat(v));
// date → string AAAA-MM-DD, sem fuso horário.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export interface OpcoesPool {
  url: string;
  /** Nome que aparece em pg_stat_activity: facilita saber qual serviço está consultando. */
  aplicacao: string;
  max?: number;
}

export function criarPool({ url, aplicacao, max = 10 }: OpcoesPool): Pool {
  return new pg.Pool({
    connectionString: semSslmode(url),
    application_name: aplicacao,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: sslDoPostgres(url),
  });
}

/** Executa fn numa transação; desfaz tudo se lançar. */
export async function comTransacao<T>(pool: Pool, fn: (cliente: PoolClient) => Promise<T>): Promise<T> {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (erro) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw erro;
  } finally {
    cliente.release();
  }
}

/** Monta um INSERT de várias linhas com placeholders $1..$n. */
export function valoresEmLote(linhas: unknown[][]): { placeholders: string; valores: unknown[] } {
  const valores: unknown[] = [];
  const grupos = linhas.map((linha) => {
    const ps = linha.map((v) => {
      valores.push(v);
      return `$${valores.length}`;
    });
    return `(${ps.join(', ')})`;
  });
  return { placeholders: grupos.join(',\n'), valores };
}
