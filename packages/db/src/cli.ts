import { carregarEnv, envBase } from '@prospeccao/config';
import { criarLogger } from '@prospeccao/shared';
import { migrar, statusMigrations } from './migrar.js';
import { criarPool } from './pool.js';

const env = carregarEnv(envBase);
const log = criarLogger('db', env.LOG_LEVEL);
const pool = criarPool({ url: env.DATABASE_URL, aplicacao: 'db-cli', max: 2 });
const comando = process.argv[2] ?? 'migrate';

try {
  if (comando === 'migrate') {
    const aplicadas = await migrar(pool, log);
    log.info({ aplicadas }, aplicadas.length ? 'migrations aplicadas' : 'banco já está atualizado');
  } else if (comando === 'status') {
    for (const m of await statusMigrations(pool)) {
      const estado = m.alterada ? 'ALTERADA' : m.aplicada ? 'aplicada' : 'pendente';
      console.log(`${estado.padEnd(9)} ${m.nome}`);
    }
  } else {
    console.error(`Comando desconhecido: ${comando}. Use migrate ou status.`);
    process.exitCode = 2;
  }
} catch (erro) {
  log.error({ err: erro }, 'falha no comando de banco');
  process.exitCode = 1;
} finally {
  await pool.end();
}
