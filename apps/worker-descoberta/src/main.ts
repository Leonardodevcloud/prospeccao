import { setTimeout as esperar } from 'node:timers/promises';
import { carregarEnv, envBase, opcional } from '@prospeccao/config';
import { cacheDeCredenciais, chaveDoAmbiente, criarPool, manterSinalDeVida } from '@prospeccao/db';
import * as apify from '@prospeccao/integrations/apify';
import * as ors from '@prospeccao/integrations/ors';
import * as places from '@prospeccao/integrations/places';
import { conectarFilas, ErroDefinitivo, encerrarAoReceberSinal, POLITICA_FILAS } from '@prospeccao/queue';
import { criarLogger } from '@prospeccao/shared';
import { z } from 'zod';
import * as casos from './casos.js';
import type { Deps } from './dependencias.js';

const env = carregarEnv(
  envBase.extend({
    /**
     * Google Places API (New) da conta principal. As outras contas usam a chave cadastrada no
     * painel master (lida com CHAVE_CREDENCIAIS, a mesma da api).
     */
    GOOGLE_PLACES_KEY: opcional(z.string().min(10)),
    CHAVE_CREDENCIAIS: opcional(z.string().min(32)),
    /** "apify" força o Apify mesmo com a chave do Google (para voltar atrás sem mexer em código). */
    /** Opcional (legado): Apify só termina a coleta de buscas antigas; buscas novas são no Places. */
    APIFY_TOKEN: opcional(z.string().min(10)),
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
const chave = chaveDoAmbiente();
if (!chave)
  log.warn(
    'CHAVE_CREDENCIAIS não configurada: chaves cadastradas por conta não são lidas; vale só GOOGLE_PLACES_KEY.',
  );
const pool = criarPool({ url: env.DATABASE_URL, aplicacao: 'worker-descoberta', max: 6 });
// Sinal de vida para o painel de alertas (worker parado aparece para o master).
const pararSinal = manterSinalDeVida(pool, 'worker-descoberta');
const filas = await conectarFilas({
  url: env.DATABASE_URL,
  aplicacao: 'worker-descoberta',
  log,
  filas: [
    'campanha.iniciar',
    'campanha.buscar_cnpj',
    'maps.buscar',
    'maps.importar_planilha',
    'maps.coletar',
    'empresa.localizar',
    'enriquecimento.solicitar',
    'cnpj.importacao_concluida',
  ],
});

const cfgApify: apify.ConfigApify | null = env.APIFY_TOKEN
  ? { token: env.APIFY_TOKEN, atorMaps: env.APIFY_MAPS_ATOR, inputExtra: env.APIFY_MAPS_INPUT_EXTRA }
  : null;
// Credenciais de cada conta (painel master) e as do ambiente, que valem para a conta principal.
const credenciais = cacheDeCredenciais(pool, chave, {
  placesKey: env.GOOGLE_PLACES_KEY ?? null,
  orsKey: env.ORS_API_KEY ?? null,
});

const deps: Deps = {
  pool,
  filas,
  log,
  async placesDa(contaId) {
    const c = await credenciais.obter(contaId);
    const cfg = c.places;
    return cfg ? { buscar: (busca) => places.buscarTexto(cfg, busca) } : null;
  },
  maps: cfgApify
    ? {
        iniciar: (busca) => apify.iniciarBuscaMaps(cfgApify, busca),
        obter: (runId) => apify.obterRun(cfgApify, runId),
        itens: (datasetId) => apify.listarItensMaps(cfgApify, datasetId),
      }
    : null,
  async geoDa(contaId) {
    const cfg = (await credenciais.obter(contaId)).ors;
    return cfg
      ? {
          async geocodificar(endereco) {
            const r = await ors.geocodificar(cfg, endereco);
            await esperar(env.ORS_INTERVALO_MS);
            return r;
          },
        }
      : null;
  },
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
await filas.consumir('empresa.localizar', (p) => casos.localizarEmpresa(deps, p.empresaId, p.campanhaId), {
  concorrencia: 1,
});
await filas.consumir('cnpj.importacao_concluida', () => casos.aoAtualizarBaseCnpj(deps));
await filas.consumir('maps.importar_planilha', (p) => casos.importarPlanilha(deps, p));

await casos
  .retomarBuscasParadas(deps)
  .catch((erro) => log.warn({ err: erro }, 'não consegui retomar buscas'));
// A cada 5 minutos: busca sem tarefa na fila volta a rodar e empresa pronta parada vai para o
// enriquecimento (sem depender de alguém clicar em "Tentar de novo").
const destravar = setInterval(
  () =>
    void casos.destravarCampanhas(deps).catch((erro) => log.warn({ err: erro }, 'não consegui destravar')),
  5 * 60_000,
);
log.info(
  {
    buscas: env.GOOGLE_PLACES_KEY
      ? 'Google Places (chave da conta ou da plataforma)'
      : 'Google Places (só contas com chave própria)',
    apify: cfgApify ? 'ligado (reserva)' : 'desligado',
  },
  'worker-descoberta pronto',
);

encerrarAoReceberSinal(log, async () => {
  clearInterval(destravar);
  pararSinal();
  await filas.parar();
  await pool.end();
});
