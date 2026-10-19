import { setTimeout as esperar } from 'node:timers/promises';
import { carregarEnv, envBase, opcional } from '@prospeccao/config';
import { criarPool } from '@prospeccao/db';
import * as apify from '@prospeccao/integrations/apify';
import * as ors from '@prospeccao/integrations/ors';
import { conectarFilas, ErroDefinitivo, encerrarAoReceberSinal, POLITICA_FILAS } from '@prospeccao/queue';
import { criarLogger } from '@prospeccao/shared';
import { z } from 'zod';
import * as casos from './casos.js';
import type { Deps } from './dependencias.js';

const env = carregarEnv(
  envBase.extend({
    APIFY_TOKEN: z.string().min(10, 'APIFY_TOKEN é obrigatório'),
    APIFY_MAPS_ATOR: z.string().default('compass~crawler-google-places'),
    /** JSON com opções extras do ator, ex.: {"scrapePlaceDetailPage":true}. */
    APIFY_MAPS_INPUT_EXTRA: z
      .string()
      .default('{}')
      .transform((v, ctx) => {
        try {
          return JSON.parse(v) as Record<string, unknown>;
        } catch {
          ctx.addIssue({ code: 'custom', message: 'APIFY_MAPS_INPUT_EXTRA precisa ser JSON' });
          return z.NEVER;
        }
      }),
    /** Opcional: só campanhas com raio usam, para localizar empresas que vieram só da Receita. */
    ORS_API_KEY: opcional(z.string().min(10)),
    /** Pausa entre geocodificações: o plano gratuito do ORS aceita 100/min e 1.000/dia. */
    ORS_INTERVALO_MS: z.coerce.number().int().min(0).default(700),
    MAPS_REBUSCA_DIAS: z.coerce.number().int().min(0).default(30),
    MAPS_ESPERA_SEGUNDOS: z.coerce.number().int().min(10).default(60),
    MAPS_MAX_VERIFICACOES: z.coerce.number().int().min(1).default(90),
    GEO_CONFIANCA_MINIMA: z.coerce.number().min(0).max(1).default(0.6),
  }),
);

const log = criarLogger('worker-descoberta', env.LOG_LEVEL);
const pool = criarPool({ url: env.DATABASE_URL, aplicacao: 'worker-descoberta', max: 6 });
const filas = await conectarFilas({
  url: env.DATABASE_URL,
  aplicacao: 'worker-descoberta',
  log,
  filas: [
    'campanha.iniciar',
    'campanha.buscar_cnpj',
    'maps.buscar',
    'maps.coletar',
    'empresa.localizar',
    'enriquecimento.solicitar',
    'cnpj.importacao_concluida',
  ],
});

const cfgApify: apify.ConfigApify = {
  token: env.APIFY_TOKEN,
  atorMaps: env.APIFY_MAPS_ATOR,
  inputExtra: env.APIFY_MAPS_INPUT_EXTRA,
};

const deps: Deps = {
  pool,
  filas,
  log,
  maps: {
    iniciar: (busca) => apify.iniciarBuscaMaps(cfgApify, busca),
    obter: (runId) => apify.obterRun(cfgApify, runId),
    itens: (datasetId) => apify.listarItensMaps(cfgApify, datasetId),
  },
  geo: env.ORS_API_KEY
    ? {
        async geocodificar(endereco) {
          const r = await ors.geocodificar({ apiKey: env.ORS_API_KEY! }, endereco);
          await esperar(env.ORS_INTERVALO_MS);
          return r;
        },
      }
    : null,
  ajustes: {
    rebuscaDias: env.MAPS_REBUSCA_DIAS,
    esperaColetaSegundos: env.MAPS_ESPERA_SEGUNDOS,
    maxVerificacoes: env.MAPS_MAX_VERIFICACOES,
    confiancaMinimaGeo: env.GEO_CONFIANCA_MINIMA,
  },
};

await filas.consumir('campanha.iniciar', (p) => casos.iniciarCampanha(deps, p.campanhaId));
await filas.consumir('campanha.buscar_cnpj', (p) => casos.buscarNaBaseCnpj(deps, p.campanhaId));
/** Roda a etapa da busca; se falhar, deixa o motivo na busca (e fecha com erro na última tentativa). */
const comFalhaNaBusca =
  (fila: 'maps.buscar' | 'maps.coletar', etapa: (buscaId: number) => Promise<void>) =>
  async (p: { buscaId: number }, ctx: { tentativa: number }) => {
    try {
      await etapa(p.buscaId);
    } catch (erro) {
      const final = erro instanceof ErroDefinitivo || ctx.tentativa >= POLITICA_FILAS[fila].retryLimit;
      await casos.registrarFalhaBusca(deps, p.buscaId, erro, final).catch(() => {});
      throw erro;
    }
  };
await filas.consumir(
  'maps.buscar',
  comFalhaNaBusca('maps.buscar', (id) => casos.dispararBuscaMaps(deps, id)),
  { concorrencia: 3 },
);
await filas.consumir(
  'maps.coletar',
  comFalhaNaBusca('maps.coletar', (id) => casos.coletarBuscaMaps(deps, id)),
  { concorrencia: 2 },
);
// Concorrência 1: respeita o limite do ORS.
await filas.consumir('empresa.localizar', (p) => casos.localizarEmpresa(deps, p.empresaId), {
  concorrencia: 1,
});
await filas.consumir('cnpj.importacao_concluida', () => casos.aoAtualizarBaseCnpj(deps));

log.info({ geocodificacao: deps.geo ? 'ligada' : 'desligada (sem ORS_API_KEY)' }, 'worker-descoberta pronto');

encerrarAoReceberSinal(log, async () => {
  await filas.parar();
  await pool.end();
});
