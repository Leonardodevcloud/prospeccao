/**
 * Aplica as migrations do banco. Em produção roda como "pre-deploy" do serviço
 * api (Railway), antes da nova versão subir; MIGRATIONS_DIR aponta para a pasta.
 */
import { carregarEnv, envBase } from '@prospeccao/config';
import { criarPool, migrar } from '@prospeccao/db';
import { criarLogger } from '@prospeccao/shared';

const env = carregarEnv(envBase);
const log = criarLogger('migrations', env.LOG_LEVEL);
const pool = criarPool({ url: env.DATABASE_URL, aplicacao: 'migrations', max: 2 });

try {
  const aplicadas = await migrar(pool, log);
  log.info({ aplicadas }, aplicadas.length ? 'migrations aplicadas' : 'banco já está atualizado');
} catch (erro) {
  log.error({ err: erro }, 'falha ao aplicar migrations');
  process.exitCode = 1;
} finally {
  await pool.end();
}
