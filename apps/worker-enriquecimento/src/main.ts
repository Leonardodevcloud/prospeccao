import { booleano, carregarEnv, envBase, listaCsv, opcional } from '@prospeccao/config';
import {
  cacheDeCredenciais,
  chaveDoAmbiente,
  contaDaCampanha,
  contarBuscas,
  criarPool,
  lerChipWhatsapp,
  manterSinalDeVida,
  medidorDeIa,
} from '@prospeccao/db';
import * as enriq from '@prospeccao/integrations/enriquecimento';
import { configIa } from '@prospeccao/integrations/ia';
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
    /**
     * Nota de ICP e leitura do site: IA da plataforma (deepseek, gemini ou openai). Contas com IA
     * própria (painel master) usam a delas. Sem nenhuma, a nota sai por regras.
     */
    IA_PROVEDOR: z.enum(['deepseek', 'gemini', 'openai']).optional().catch(undefined),
    IA_API_KEY: opcional(z.string().min(10)),
    IA_MODELO: opcional(z.string().min(2)),
    IA_BASE_URL: opcional(z.string().url()),
    /** Legado: sem IA_API_KEY, a IA é o Gemini com esta chave. */
    GEMINI_API_KEY: opcional(z.string().min(10)),
    GEMINI_MODELO: z.string().default('gemini-3.5-flash-lite'),
    /** Lê as credenciais das contas (a mesma CHAVE_CREDENCIAIS da api). */
    CHAVE_CREDENCIAIS: opcional(z.string().min(32)),
    /**
     * Validação de WhatsApp pelo chip da conta principal (só consulta, não envia). As três juntas
     * ou nenhuma. As outras contas usam o chip cadastrado no painel master.
     */
    ZAPI_PARCEIRO_TOKEN: opcional(z.string().min(4)),
    ZAPI_CLIENT_TOKEN: opcional(z.string().min(4)),
    /** Pausa entre consultas de WhatsApp, para não pesar no chip. */
    WHATSAPP_INTERVALO_MS: z.coerce.number().int().min(0).default(3_000),
    /** Google Places da conta principal (opcional; as outras usam a chave do painel master). */
    GOOGLE_PLACES_KEY: opcional(z.string().min(10)),
    ENRIQ_FAIXAS_LINKEDIN: listaCsv.default(['A', 'B']),
    ENRIQ_FAIXAS_PLACES: listaCsv.default(['A', 'B']),
    ENRIQ_BUSCAR_INSTAGRAM: booleano.default(true),
    /** Procura no Google (nome + endereço) quem veio da base de CNPJ e não apareceu nas buscas. */
    ENRIQ_ACHAR_NO_GOOGLE: booleano.default(true),
    /**
     * Abre o perfil do Instagram pelo Apify (bio completa, link da bio, seguidores). Desligado, o
     * sistema usa só o @ e o trecho que o Google (Serper) já mostra, sem custo do Apify.
     */
    ENRIQ_LER_INSTAGRAM: booleano.default(true),
    /** Confirma o CNPJ de quem veio só do Maps na BrasilAPI (dados públicos da Receita, grátis). */
    ENRIQ_CNPJ_PUBLICO: booleano.default(true),
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
// Sinal de vida para o painel de alertas (worker parado aparece para o master).
const pararSinal = manterSinalDeVida(pool, 'worker-enriquecimento');
const filas = await conectarFilas({
  url: env.DATABASE_URL,
  aplicacao: 'worker-enriquecimento',
  log,
  filas: ['enriquecimento.solicitar'],
});

const apify: enriq.ConfigApifyEnriq | null = env.APIFY_TOKEN
  ? { token: env.APIFY_TOKEN, atorGoogle: env.APIFY_ATOR_GOOGLE, atorInstagram: env.APIFY_ATOR_INSTAGRAM }
  : null;
const espera = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const serper = env.SERPER_API_KEY ? { apiKey: env.SERPER_API_KEY } : null;

// Credenciais: as de cada conta (painel master) e as do ambiente (conta principal; a IA vale para todas).
const iaLegada = !env.IA_API_KEY && env.GEMINI_API_KEY;
const credenciais = cacheDeCredenciais(pool, chaveDoAmbiente(), {
  placesKey: env.GOOGLE_PLACES_KEY ?? null,
  zapiParceiroToken: env.ZAPI_PARCEIRO_TOKEN ?? null,
  zapiClientToken: env.ZAPI_CLIENT_TOKEN ?? null,
  iaProvedor: iaLegada ? 'gemini' : (env.IA_PROVEDOR ?? null),
  iaKey: env.IA_API_KEY ?? env.GEMINI_API_KEY ?? null,
  iaModelo: iaLegada ? env.GEMINI_MODELO : (env.IA_MODELO ?? null),
  iaBaseUrl: env.IA_BASE_URL ?? null,
});

/** Fontes da plataforma: as mesmas para todas as contas (Serper, Apify, base paga, sites). */
const fontesDaPlataforma: Pick<Fontes, 'site' | 'google' | 'instagram' | 'diretorios' | 'basePaga' | 'cnpj'> =
  {
    site: { ler: (url) => enriq.lerSite(url), lerLinks: (url) => enriq.lerPaginaDeLinks(url) },
    // Serper é mais barato e rápido; o Apify fica de reserva quando não há a chave do Serper.
    google: serper
      ? { nome: 'Serper', buscar: (consultas) => enriq.buscarNoGoogleSerper(serper, consultas) }
      : apify
        ? { nome: 'Apify', buscar: (consultas) => enriq.buscarNoGoogle(apify, consultas) }
        : null,
    instagram:
      apify && env.ENRIQ_LER_INSTAGRAM
        ? { ler: (usuario) => enriq.lerPerfilInstagram(apify, usuario) }
        : null,
    diretorios: serper ? { buscar: (e) => enriq.buscarDiretorios(serper, e) } : null,
    cnpj: env.ENRIQ_CNPJ_PUBLICO ? { consultar: (cnpj) => enriq.consultarCnpjPublico(cnpj) } : null,
    basePaga: env.DIRECTD_TOKEN
      ? {
          nome: 'Direct Data',
          precoBrl: env.DIRECTD_PRECO_BRL,
          consultar: (cnpj) =>
            enriq.consultarDirectData({ token: env.DIRECTD_TOKEN! }, cnpj, normalizarTelefone),
        }
      : null,
  };

/** Fontes de uma conta: a IA, o Google Places e o chip do WhatsApp são os dela. */
async function fontesDa(contaId: number): Promise<Fontes> {
  const c = await credenciais.obter(contaId);
  // Cada chamada à IA conta no consumo da conta (e para no teto do mês da IA da plataforma).
  const ia = c.ia && c.origem.ia ? configIa(c.ia, medidorDeIa(pool, contaId, c.origem.ia)) : null;
  const places = c.places;
  // Confere WhatsApp pelo número que a própria conta conectou (Z-API); sem número conectado, pula.
  const chip = c.whatsapp ? await lerChipWhatsapp(pool, contaId, chaveDoAmbiente()) : null;
  const zapi = chip ? { ...chip, clientToken: c.whatsapp?.clientToken ?? null } : null;
  // Serper da plataforma, mas cada busca conta no consumo desta conta.
  const serperConta = serper
    ? { ...serper, aoBuscar: (n: number) => void contarBuscas(pool, contaId, n) }
    : null;
  // Apify (Instagram e, sem Serper, o Google) também conta no consumo da conta (painel da plataforma).
  const apifyConta = {
    ...(fontesDaPlataforma.instagram
      ? {
          instagram: {
            ler: (usuario: string) => {
              void contarBuscas(pool, contaId, 1, 'apify_instagram');
              return fontesDaPlataforma.instagram!.ler(usuario);
            },
          },
        }
      : {}),
    ...(!serper && fontesDaPlataforma.google
      ? {
          google: {
            nome: fontesDaPlataforma.google.nome,
            buscar: (consultas: string[]) => {
              void contarBuscas(pool, contaId, consultas.length, 'apify_google');
              return fontesDaPlataforma.google!.buscar(consultas);
            },
          },
        }
      : {}),
  };
  return {
    ...fontesDaPlataforma,
    ...apifyConta,
    ...(serperConta
      ? {
          google: {
            nome: 'Serper',
            buscar: (consultas: string[]) => enriq.buscarNoGoogleSerper(serperConta, consultas),
          },
          diretorios: {
            buscar: (e: Parameters<typeof enriq.buscarDiretorios>[1]) =>
              enriq.buscarDiretorios(serperConta, e),
          },
        }
      : {}),
    ia: ia
      ? { avaliar: (e) => enriq.avaliarComIa(ia, e), lerBusca: (e) => enriq.lerBuscaComIa(ia, e) }
      : null,
    places: places ? { detalhes: (id) => enriq.detalhesDoLugar(places, id) } : null,
    // Achar no Maps pelo nome e endereço: Google Places da conta enquanto houver cota GRÁTIS no mês
    // (somando o que as campanhas dela já usaram); acabou a cota, Serper (centavos). Sem Serper, o
    // Places segue e passa a cobrar.
    lugar:
      serper || places
        ? {
            async achar(e) {
              const pedidos = e.razaoSocial && e.razaoSocial !== e.nome ? 2 : 1;
              if (places && (!serper || (await repo.reservarPlacesGratis(pool, pedidos, contaId)))) {
                try {
                  const r = await enriq.acharLugar(places, e);
                  if (r.lugar || !serper) return r;
                } catch (erro) {
                  if (!serper) throw erro;
                  log.warn({ err: erro }, 'Google Places falhou ao achar o lugar; tentando o Serper');
                }
              }
              return enriq.acharLugarSerper(serperConta!, e);
            },
          }
        : null,
    whatsapp: zapi
      ? {
          async verificar(numeros) {
            const r = await enriq.verificarWhatsapp(zapi, numeros);
            await espera(env.WHATSAPP_INTERVALO_MS);
            return r;
          },
        }
      : null,
  };
}

const ajustes: Deps['ajustes'] = {
  faixasLinkedin: new Set(env.ENRIQ_FAIXAS_LINKEDIN),
  faixasPlaces: new Set(env.ENRIQ_FAIXAS_PLACES),
  buscarInstagram: env.ENRIQ_BUSCAR_INSTAGRAM,
  acharNoGoogle: env.ENRIQ_ACHAR_NO_GOOGLE,
  faixasBasePaga: new Set(env.ENRIQ_FAIXAS_BASE_PAGA),
  refazerDias: env.ENRIQ_REFAZER_DIAS,
  limiteContador: env.ENRIQ_LIMITE_CONTADOR,
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
  await filas.consumir(
    'enriquecimento.solicitar',
    async (p) => {
      // O enriquecimento é comum a todas as contas, mas gasta a IA, o Places e o chip da conta que pediu.
      const contaId = (await contaDaCampanha(pool, p.campanhaId)) ?? 1;
      await enriquecerEmpresa({ pool, log, fontes: await fontesDa(contaId), ajustes, contaId }, p);
    },
    { concorrencia: env.ENRIQ_CONCORRENCIA },
  );
}

const ligado = (v: unknown) => (v ? 'ligado' : 'desligado');
log.info(
  {
    busca_no_google: serper ? 'Serper' : apify ? 'Apify' : 'desligada',
    perfis_instagram: ligado(apify && env.ENRIQ_LER_INSTAGRAM),
    ia: 'a de cada conta (ou a da plataforma: IA_API_KEY)',
    places_whatsapp: 'os de cada conta (painel master)',
    diretorios: ligado(serper),
    base_paga: env.DIRECTD_TOKEN
      ? `Direct Data (faixas ${env.ENRIQ_FAIXAS_BASE_PAGA.join(', ')})`
      : 'desligada',
  },
  'worker-enriquecimento pronto',
);

encerrarAoReceberSinal(log, async () => {
  pararSinal();
  clearInterval(batimento);
  await filas.parar();
  await pool.end();
});
