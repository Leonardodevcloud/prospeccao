import { booleano, carregarEnv, envBase, listaCsv, opcional } from '@prospeccao/config';
import { criarPool } from '@prospeccao/db';
import * as enriq from '@prospeccao/integrations/enriquecimento';
import { conectarFilas, encerrarAoReceberSinal } from '@prospeccao/queue';
import { criarLogger, normalizarTelefone } from '@prospeccao/shared';
import { z } from 'zod';
import { enriquecerEmpresa } from './casos.js';
import type { Deps, Fontes } from './dependencias.js';
import * as repo from './repositorio.js';

const env = carregarEnv(
  envBase.extend({
    /** Google (LinkedIn/Instagram) e perfis do Instagram. Sem ele, essas fontes são puladas. */
    APIFY_TOKEN: opcional(z.string().min(10)),
    APIFY_ATOR_GOOGLE: z.string().default('apify~google-search-scraper'),
    APIFY_ATOR_INSTAGRAM: z.string().default('apify~instagram-profile-scraper'),
    /** Busca no Google pelo Serper (LinkedIn e Instagram). Com ela, o Apify só lê perfis do Instagram. */
    SERPER_API_KEY: opcional(z.string().min(10)),
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
    /** Procura no Google (nome + endereço) quem veio da base de CNPJ e não apareceu nas buscas. */
    ENRIQ_ACHAR_NO_GOOGLE: booleano.default(true),
    /** Base paga Direct Data (telefones atualizados). Sem o token, a etapa não roda. */
    DIRECTD_TOKEN: opcional(z.string().min(8)),
    DIRECTD_PRECO_BRL: z.coerce.number().min(0).default(0.16),
    /** Faixas que podem gastar a consulta paga (só quando não há WhatsApp atual). */
    ENRIQ_FAIXAS_BASE_PAGA: listaCsv.default(['A']),
    /** Interruptor de emergência: com "true", o serviço sobe mas não processa nada (a fila espera). */
    ENRIQ_PAUSADO: booleano.default(false),
    ENRIQ_REFAZER_DIAS: z.coerce.number().int().min(0).default(30),
    /** Telefone repetido em N ou mais CNPJs da base = número do contador. */
    ENRIQ_LIMITE_CONTADOR: z.coerce.number().int().min(2).default(5),
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
const serper = env.SERPER_API_KEY ? { apiKey: env.SERPER_API_KEY } : null;

const fontes: Fontes = {
  site: { ler: (url) => enriq.lerSite(url) },
  // Serper é mais barato e rápido; o Apify fica de reserva quando não há a chave do Serper.
  google: env.SERPER_API_KEY
    ? {
        nome: 'Serper',
        buscar: (consultas) => enriq.buscarNoGoogleSerper({ apiKey: env.SERPER_API_KEY! }, consultas),
      }
    : apify
      ? { nome: 'Apify', buscar: (consultas) => enriq.buscarNoGoogle(apify, consultas) }
      : null,
  instagram: apify ? { ler: (usuario) => enriq.lerPerfilInstagram(apify, usuario) } : null,
  ia: env.GEMINI_API_KEY
    ? {
        avaliar: (e) => enriq.avaliarComGemini({ apiKey: env.GEMINI_API_KEY!, modelo: env.GEMINI_MODELO }, e),
        lerBusca: (e) =>
          enriq.lerBuscaComGemini({ apiKey: env.GEMINI_API_KEY!, modelo: env.GEMINI_MODELO }, e),
      }
    : null,
  places: env.GOOGLE_PLACES_KEY
    ? { detalhes: (id) => enriq.detalhesDoLugar({ apiKey: env.GOOGLE_PLACES_KEY! }, id) }
    : null,
  // Achar no Maps pelo nome e endereço: Google Places enquanto houver cota GRÁTIS no mês
  // (somando o que as campanhas já usaram); acabou a cota, Serper (centavos). Sem Serper, o
  // Places segue e passa a cobrar.
  lugar:
    serper || env.GOOGLE_PLACES_KEY
      ? {
          async achar(e) {
            const pedidos = e.razaoSocial && e.razaoSocial !== e.nome ? 2 : 1;
            const places = env.GOOGLE_PLACES_KEY ? { apiKey: env.GOOGLE_PLACES_KEY } : null;
            if (places && (!serper || (await repo.reservarPlacesGratis(pool, pedidos)))) {
              try {
                const r = await enriq.acharLugar(places, e);
                if (r.lugar || !serper) return r;
              } catch (erro) {
                if (!serper) throw erro;
                log.warn({ err: erro }, 'Google Places falhou ao achar o lugar; tentando o Serper');
              }
            }
            return enriq.acharLugarSerper(serper!, e);
          },
        }
      : null,
  diretorios: serper ? { buscar: (e) => enriq.buscarDiretorios(serper, e) } : null,
  basePaga: env.DIRECTD_TOKEN
    ? {
        nome: 'Direct Data',
        precoBrl: env.DIRECTD_PRECO_BRL,
        consultar: (cnpj) =>
          enriq.consultarDirectData({ token: env.DIRECTD_TOKEN! }, cnpj, normalizarTelefone),
      }
    : null,
  whatsapp: evolution
    ? {
        async verificar(numeros) {
          const r = await enriq.verificarWhatsapp(evolution, numeros);
          await espera(env.EVOLUTION_INTERVALO_MS);
          return r;
        },
        async perfil(numero) {
          const p = await enriq.perfilComercialWhatsapp(evolution, numero);
          await espera(env.EVOLUTION_INTERVALO_MS);
          return p;
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
    acharNoGoogle: env.ENRIQ_ACHAR_NO_GOOGLE,
    faixasBasePaga: new Set(env.ENRIQ_FAIXAS_BASE_PAGA),
    refazerDias: env.ENRIQ_REFAZER_DIAS,
    limiteContador: env.ENRIQ_LIMITE_CONTADOR,
  },
};

// Sobras de um processo anterior que morreu no meio (deploy): voltam para a fila.
await pool.query(`UPDATE enriquecimento.leads SET status = 'na_fila' WHERE status = 'rodando'`);
await filas.liberarTravados('enriquecimento.solicitar');

// Sinal de vida a cada minuto: a tela mostra "pausado" ou "fora do ar" em vez de uma fila parada sem explicação.
const sinalDeVida = () =>
  pool
    .query(
      `INSERT INTO enriquecimento.servico (id, pausado, visto_em, iniciado_em) VALUES (1, $1, now(), now())
       ON CONFLICT (id) DO UPDATE SET pausado = EXCLUDED.pausado, visto_em = now()`,
      [env.ENRIQ_PAUSADO],
    )
    .catch((erro) => log.warn({ err: erro }, 'não consegui gravar o sinal de vida'));
await sinalDeVida();
const batimento = setInterval(sinalDeVida, 60_000);

if (env.ENRIQ_PAUSADO) {
  log.warn('ENRIQ_PAUSADO=true: enriquecimento parado, a fila fica esperando (nada é gasto)');
} else {
  await filas.consumir('enriquecimento.solicitar', (p) => enriquecerEmpresa(deps, p).then(() => undefined), {
    concorrencia: env.ENRIQ_CONCORRENCIA,
  });
}

const ligado = (v: unknown) => (v ? 'ligado' : 'desligado');
log.info(
  {
    busca_no_google: env.SERPER_API_KEY ? 'Serper' : apify ? 'Apify' : 'desligada',
    perfis_instagram: ligado(apify),
    ia: env.GEMINI_API_KEY ? env.GEMINI_MODELO : 'desligada (nota por regras)',
    whatsapp: ligado(evolution),
    places: ligado(env.GOOGLE_PLACES_KEY),
    achar_no_maps:
      env.GOOGLE_PLACES_KEY && serper
        ? 'Places na cota grátis, depois Serper'
        : env.GOOGLE_PLACES_KEY
          ? 'Places'
          : serper
            ? 'Serper'
            : 'desligado',
    diretorios: ligado(serper),
    base_paga: env.DIRECTD_TOKEN
      ? `Direct Data (faixas ${env.ENRIQ_FAIXAS_BASE_PAGA.join(', ')})`
      : 'desligada',
  },
  'worker-enriquecimento pronto',
);

encerrarAoReceberSinal(log, async () => {
  clearInterval(batimento);
  await filas.parar();
  await pool.end();
});
