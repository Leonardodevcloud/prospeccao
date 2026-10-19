import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { carregarEnv, envBase, listaCsv, opcional } from '@prospeccao/config';
import { criarPool } from '@prospeccao/db';
import { conectarFilas, encerrarAoReceberSinal } from '@prospeccao/queue';
import { criarLogger } from '@prospeccao/shared';
import { z } from 'zod';
import { type FonteArquivos, FonteHttp, FontePasta } from './fonte.js';
import { importarBaseCnpj } from './importador.js';
import * as repo from './repositorio.js';

const env = carregarEnv(
  envBase.extend({
    RECEITA_CNPJ_URL: z
      .string()
      .url()
      .default('https://arquivos.receitafederal.gov.br/dados/cnpj/dados_abertos_cnpj'),
    /** Pasta com os zips já baixados. Quando definida, nada é baixado. */
    CNPJ_PASTA_LOCAL: opcional(z.string()),
    CNPJ_MES_LOCAL: opcional(z.string().regex(/^\d{4}-\d{2}$/, 'CNPJ_MES_LOCAL no formato AAAA-MM')),
    CNPJ_PASTA_TEMP: z.string().default(join(tmpdir(), 'cnpj')),
    CNPJ_UFS_EXTRAS: listaCsv,
    /** Cron da importação automática (fuso de São Paulo). Padrão: dia 20, às 3h. */
    CNPJ_AGENDA: z.string().default('0 3 20 * *'),
  }),
);

const log = criarLogger('worker-cnpj', env.LOG_LEVEL);
const pool = criarPool({ url: env.DATABASE_URL, aplicacao: 'worker-cnpj', max: 4 });
const filas = await conectarFilas({
  url: env.DATABASE_URL,
  aplicacao: 'worker-cnpj',
  log,
  filas: ['cnpj.importar', 'cnpj.importacao_concluida'],
});

function criarFonte(): FonteArquivos {
  if (env.CNPJ_PASTA_LOCAL) {
    if (!env.CNPJ_MES_LOCAL)
      throw new Error('Com CNPJ_PASTA_LOCAL, informe também CNPJ_MES_LOCAL (AAAA-MM).');
    return new FontePasta(env.CNPJ_PASTA_LOCAL, env.CNPJ_MES_LOCAL);
  }
  return new FonteHttp(env.RECEITA_CNPJ_URL, env.CNPJ_PASTA_TEMP, log);
}

await filas.consumir('cnpj.importar', async (payload) => {
  const importacaoId =
    payload.importacaoId ?? (await repo.criarImportacao(pool, payload.motivo, payload.mes ?? null));
  try {
    await importarBaseCnpj({ pool, log, fonte: criarFonte(), importacaoId, ufsExtras: env.CNPJ_UFS_EXTRAS });
    await repo.marcarFim(pool, importacaoId, null);
    await filas.publicar('cnpj.importacao_concluida', { importacaoId });
  } catch (erro) {
    await repo.marcarFim(pool, importacaoId, (erro as Error).message);
    throw erro;
  }
});

await filas.agendar('cnpj.importar', env.CNPJ_AGENDA, { motivo: 'agendada' });
log.info({ agenda: env.CNPJ_AGENDA }, 'worker-cnpj pronto');

encerrarAoReceberSinal(log, async () => {
  await filas.parar();
  await pool.end();
});
