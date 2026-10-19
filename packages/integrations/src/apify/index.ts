import { normalizarTelefone } from '@prospeccao/shared';
import { z } from 'zod';
import { requisitarJson } from '../http.js';
import { ufDoEstado } from './estados.js';

const API = 'https://api.apify.com/v2';

export interface ConfigApify {
  token: string;
  /** Ator do Google Maps. Padrão: compass~crawler-google-places. */
  atorMaps: string;
  /** Campos extras de input do ator (JSON), para ligar opções sem mudar código. */
  inputExtra?: Record<string, unknown>;
}

export type StatusRun =
  | 'READY'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'TIMING-OUT'
  | 'TIMED-OUT'
  | 'ABORTING'
  | 'ABORTED';

export interface Run {
  id: string;
  status: StatusRun;
  datasetId: string;
}

const respostaRun = z.object({
  data: z.object({ id: z.string(), status: z.string(), defaultDatasetId: z.string() }),
});

function autenticacao(cfg: ConfigApify) {
  return { authorization: `Bearer ${cfg.token}` };
}

/** Dispara a busca no Maps e devolve o run, sem esperar terminar. */
export async function iniciarBuscaMaps(
  cfg: ConfigApify,
  busca: { termo: string; local: string; max: number },
): Promise<Run> {
  const input = {
    searchStringsArray: [busca.termo],
    locationQuery: busca.local,
    maxCrawledPlacesPerSearch: busca.max,
    language: 'pt-BR',
    ...cfg.inputExtra,
  };
  const r = respostaRun.parse(
    await requisitarJson(`${API}/acts/${encodeURIComponent(cfg.atorMaps)}/runs`, {
      servico: 'Apify',
      method: 'POST',
      headers: autenticacao(cfg),
      body: input,
    }),
  );
  return { id: r.data.id, status: r.data.status as StatusRun, datasetId: r.data.defaultDatasetId };
}

export async function obterRun(cfg: ConfigApify, runId: string): Promise<Run> {
  const r = respostaRun.parse(
    await requisitarJson(`${API}/actor-runs/${encodeURIComponent(runId)}`, {
      servico: 'Apify',
      headers: autenticacao(cfg),
    }),
  );
  return { id: r.data.id, status: r.data.status as StatusRun, datasetId: r.data.defaultDatasetId };
}

export function runTerminou(status: StatusRun): 'sucesso' | 'falha' | 'rodando' {
  if (status === 'SUCCEEDED') return 'sucesso';
  if (status === 'READY' || status === 'RUNNING') return 'rodando';
  return 'falha';
}

/** Item bruto do ator: só validamos o que usamos, o resto fica em `dados`. */
const itemBruto = z
  .object({
    placeId: z.string().min(1),
    title: z.string().min(1),
    categoryName: z.string().nullish(),
    phone: z.string().nullish(),
    phoneUnformatted: z.string().nullish(),
    address: z.string().nullish(),
    postalCode: z.string().nullish(),
    city: z.string().nullish(),
    state: z.string().nullish(),
    location: z.object({ lat: z.number(), lng: z.number() }).nullish(),
    totalScore: z.number().nullish(),
    reviewsCount: z.number().nullish(),
    website: z.string().nullish(),
    url: z.string().nullish(),
    permanentlyClosed: z.boolean().nullish(),
    temporarilyClosed: z.boolean().nullish(),
    additionalInfo: z.record(z.string(), z.unknown()).nullish(),
    description: z.string().nullish(),
  })
  .loose();

export interface ItemMaps {
  placeId: string;
  nome: string;
  categoria: string | null;
  telefone: string | null;
  endereco: string | null;
  cep: string | null;
  cidade: string | null;
  uf: string | null;
  lat: number | null;
  lng: number | null;
  nota: number | null;
  avaliacoes: number | null;
  site: string | null;
  url: string | null;
  fechada: boolean;
  entrega: boolean | null;
  dados: Record<string, unknown>;
}

const PADRAO_ENTREGA = /entrega|delivery|delivers/i;

/**
 * "Opções de serviço" do Maps vêm como { "Opções de serviço": [{ "Entrega": true }, ...] }.
 * true se alguma opção de entrega está marcada; false se aparece desmarcada; null se não aparece.
 */
export function detectarEntrega(additionalInfo: Record<string, unknown> | null | undefined): boolean | null {
  if (!additionalInfo) return null;
  let visto: boolean | null = null;
  for (const grupo of Object.values(additionalInfo)) {
    if (!Array.isArray(grupo)) continue;
    for (const opcao of grupo) {
      if (!opcao || typeof opcao !== 'object') continue;
      for (const [chave, valor] of Object.entries(opcao as Record<string, unknown>)) {
        if (!PADRAO_ENTREGA.test(chave) || typeof valor !== 'boolean') continue;
        if (valor) return true;
        visto = false;
      }
    }
  }
  return visto;
}

export function converterItem(bruto: unknown): ItemMaps | null {
  const r = itemBruto.safeParse(bruto);
  if (!r.success) return null;
  const i = r.data;
  return {
    placeId: i.placeId,
    nome: i.title,
    categoria: i.categoryName ?? null,
    telefone: normalizarTelefone(i.phoneUnformatted ?? i.phone),
    endereco: i.address ?? null,
    cep: i.postalCode ? i.postalCode.replace(/\D/g, '') || null : null,
    cidade: i.city ?? null,
    uf: ufDoEstado(i.state),
    lat: i.location?.lat ?? null,
    lng: i.location?.lng ?? null,
    nota: i.totalScore ?? null,
    avaliacoes: i.reviewsCount ?? null,
    site: i.website ?? null,
    url: i.url ?? null,
    fechada: Boolean(i.permanentlyClosed || i.temporarilyClosed),
    entrega: detectarEntrega(i.additionalInfo),
    dados: bruto as Record<string, unknown>,
  };
}

/** Lê todos os itens do dataset do run, paginando. Itens fora do formato são ignorados. */
export async function listarItensMaps(
  cfg: ConfigApify,
  datasetId: string,
): Promise<{ itens: ItemMaps[]; ignorados: number }> {
  const itens: ItemMaps[] = [];
  let ignorados = 0;
  const limite = 1000;
  for (let offset = 0; ; offset += limite) {
    const pagina = await requisitarJson<unknown[]>(
      `${API}/datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json&offset=${offset}&limit=${limite}`,
      { servico: 'Apify', headers: autenticacao(cfg), timeoutMs: 60_000 },
    );
    for (const bruto of pagina) {
      const item = converterItem(bruto);
      if (item) itens.push(item);
      else ignorados++;
    }
    if (pagina.length < limite) break;
  }
  return { itens, ignorados };
}
