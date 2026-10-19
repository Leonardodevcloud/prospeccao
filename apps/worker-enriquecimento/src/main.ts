import { booleano, carregarEnv, envBase, listaCsv, opcional } from '@prospeccao/config';
import { criarPool } from '@prospeccao/db';
import * as enriq from '@prospeccao/integrations/enriquecimento';
import { conectarFilas, encerrarAoReceberSinal } from '@prospeccao/queue';
import { criarLogger } from '@prospeccao/shared';
import { z } from 'zod';
import { enriquecerEmpresa } from './casos.js';
import type { Deps, Fontes } from './dependencias.js';

const env = carregarEnv(
  envBase.extend({
    /** Google (LinkedIn/Instagram) e perfis do Instagram. Sem ele, essas fontes são puladas. */
    APIFY_TOKEN: opcional(z.string().min(10)),
    APIFY_ATOR_GOOGLE: z.string().default('apify~google-search-scraper'),
    APIFY_ATOR_INSTAGRAM: z.string().default('apify~instagram-profile-scraper'),
    /** Nota de ICP e leitura do site. Sem ela, a nota sai por regras. */
    GEMINI_API_KEY: opcional(z.string().min(10)),
    GEMINI_MODELO: z.string().default('gemini-3.5-flash-lite'),
    /** Validação de WhatsApp pelo chip (só consulta, não envia). As três juntas ou nenhuma. */
    EVOLUTION_URL: opcional(z.string().url()),
    EVOLUTION_API_KEY: opcional(z.string().min(4)),
    EVOLUTION_INSTANCIA: opcional(z.string().min(1)),
    /** Pausa entre consultas de WhatsApp, para não pesar no chip. */
    EVOLUTION_INTERVALO_MS: z.coerce.number().int().min(0).default(3_000),
    /** Validação no Google Places (opcional). */
    GOOGLE_PLACES_KEY: opcional(z.string().min(10)),
    ENRIQ_FAIXAS_LINKEDIN: listaCsv.default(['A', 'B']),
    ENRIQ_FAIXAS_PLACES: listaCsv.default(['A', 'B']),
    ENRIQ_BUSCAR_INSTAGRAM: booleano.default(true),
    ENRIQ_REFAZER_DIAS: z.coerce.number().int().min(0).default(30),
    ENRIQ_CONCORRENCIA: z.coerce.number().int().min(1).max(10).default(2),
  }),
);

const log = criarLogger('worker-enriquecimento', env.LOG_LEVEL);
const pool = criarPool({ url: env.DATABASE_URL, aplicacao: 'worker-enriquecimento', max: 4 });
const filas = await conectarFilas({
  url: env.DATABASE_URL,
  aplicacao: 'worker-enriquecimento',
  log,
  filas: ['enriquecimento.solicitar'],
});

const apify: enriq.ConfigApifyEnriq | null = env.APIFY_TOKEN
  ? { token: env.APIFY_TOKEN, atorGoogle: env.APIFY_ATOR_GOOGLE, atorInstagram: env.APIFY_ATOR_INSTAGRAM }
  : null;
const evolution =
  env.EVOLUTION_URL && env.EVOLUTION_API_KEY && env.EVOLUTION_INSTANCIA
    ? { url: env.EVOLUTION_URL, apiKey: env.EVOLUTION_API_KEY, instancia: env.EVOLUTION_INSTANCIA }
    : null;
const espera = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const fontes: Fontes = {
  site: { ler: (url) => enriq.lerSite(url) },
  google: apify ? { buscar: (consultas) => enriq.buscarNoGoogle(apify, consultas) } : null,
  instagram: apify ? { ler: (usuario) => enriq.lerPerfilInstagram(apify, usuario) } : null,
  ia: env.GEMINI_API_KEY
    ? {
        avaliar: (e) => enriq.avaliarComGemini({ apiKey: env.GEMINI_API_KEY!, modelo: env.GEMINI_MODELO }, e),
      }
    : null,
  places: env.GOOGLE_PLACES_KEY
    ? { detalhes: (id) => enriq.detalhesDoLugar({ apiKey: env.GOOGLE_PLACES_KEY! }, id) }
    : null,
  whatsapp: evolution
    ? {
        async verificar(numeros) {
          const r = await enriq.verificarWhatsapp(evolution, numeros);
          await espera(env.EVOLUTION_INTERVALO_MS);
          return r;
        },
      }
    : null,
};

const deps: Deps = {
  pool,
  log,
  fontes,
  ajustes: {
    faixasLinkedin: new Set(env.ENRIQ_FAIXAS_LINKEDIN),
    faixasPlaces: new Set(env.ENRIQ_FAIXAS_PLACES),
    buscarInstagram: env.ENRIQ_BUSCAR_INSTAGRAM,
    refazerDias: env.ENRIQ_REFAZER_DIAS,
  },
};

await filas.consumir('enriquecimento.solicitar', (p) => enriquecerEmpresa(deps, p).then(() => undefined), {
  concorrencia: env.ENRIQ_CONCORRENCIA,
});

const ligado = (v: unknown) => (v ? 'ligado' : 'desligado');
log.info(
  {
    google_e_instagram: ligado(apify),
    ia: env.GEMINI_API_KEY ? env.GEMINI_MODELO : 'desligada (nota por regras)',
    whatsapp: ligado(evolution),
    places: ligado(env.GOOGLE_PLACES_KEY),
  },
  'worker-enriquecimento pronto',
);

encerrarAoReceberSinal(log, async () => {
  await filas.parar();
  await pool.end();
});
