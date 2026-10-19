import { normalizarTelefone } from '@prospeccao/shared';
import { z } from 'zod';
import { ufDoEstado } from '../apify/estados.js';
import type { ItemMaps } from '../apify/index.js';
import { requisitarJson } from '../http.js';

/**
 * Google Places API (New) · Text Search. Substitui o ator do Apify nas buscas do Maps.
 *
 * Cada chamada traz até 20 lugares e conta como 1 pedido no SKU "Text Search Enterprise"
 * (o nível que devolve telefone e site): 1.000 grátis por mês, depois US$ 35 por mil.
 * O Google entrega no máximo 3 páginas (60 lugares) por texto buscado; por isso a busca da
 * cidade inteira que enche é dividida por bairro.
 *
 * Os campos pedidos ficam no nível Enterprise de propósito: pedir "delivery" ou outros campos
 * de "Atmosphere" muda o pedido para um SKU mais caro.
 */

const URL = 'https://places.googleapis.com/v1/places:searchText';

export const POR_PAGINA = 20;
export const MAX_PAGINAS = 3;

const CAMPOS = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.addressComponents',
  'places.location',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.googleMapsUri',
  'places.businessStatus',
  'places.primaryTypeDisplayName',
  'nextPageToken',
].join(',');

export interface ConfigPlaces {
  apiKey: string;
}

export interface PaginaPlaces {
  itens: ItemMaps[];
  ignorados: number;
  proximaPagina: string | null;
}

/** Texto da busca: termo + bairro (quando há) + cidade/UF. */
export function textoDaBusca(b: { termo: string; cidade: string; uf: string; bairro?: string | null }) {
  const onde = [b.bairro, `${b.cidade} - ${b.uf}`].filter(Boolean).join(', ');
  return `${b.termo} em ${onde}`;
}

/** Uma página do Text Search. Sem `pagina`, é a primeira. */
export async function buscarTexto(
  cfg: ConfigPlaces,
  busca: { texto: string; pagina?: string | null },
): Promise<PaginaPlaces> {
  const r = await requisitarJson<{ places?: unknown[]; nextPageToken?: string }>(URL, {
    servico: 'Google Places',
    method: 'POST',
    headers: { 'X-Goog-Api-Key': cfg.apiKey, 'X-Goog-FieldMask': CAMPOS },
    body: {
      textQuery: busca.texto,
      languageCode: 'pt-BR',
      regionCode: 'BR',
      pageSize: POR_PAGINA,
      ...(busca.pagina ? { pageToken: busca.pagina } : {}),
    },
    timeoutMs: 20_000,
  });
  const itens: ItemMaps[] = [];
  let ignorados = 0;
  for (const bruto of r.places ?? []) {
    const item = converterLugar(bruto);
    if (item) itens.push(item);
    else ignorados++;
  }
  return { itens, ignorados, proximaPagina: r.nextPageToken || null };
}

const componente = z.object({
  longText: z.string().nullish(),
  shortText: z.string().nullish(),
  types: z.array(z.string()).nullish(),
});

/** Lugar bruto do Places: só validamos o que usamos, o resto fica em `dados`. */
const lugarBruto = z
  .object({
    id: z.string().min(1),
    displayName: z.object({ text: z.string().min(1) }),
    formattedAddress: z.string().nullish(),
    addressComponents: z.array(componente).nullish(),
    location: z.object({ latitude: z.number(), longitude: z.number() }).nullish(),
    nationalPhoneNumber: z.string().nullish(),
    internationalPhoneNumber: z.string().nullish(),
    websiteUri: z.string().nullish(),
    rating: z.number().nullish(),
    userRatingCount: z.number().nullish(),
    googleMapsUri: z.string().nullish(),
    businessStatus: z.string().nullish(),
    primaryTypeDisplayName: z.object({ text: z.string() }).nullish(),
  })
  .loose();

/** true se o item guardado em `dados` veio do Places (e não do Apify). */
export function ehLugarPlaces(bruto: unknown): boolean {
  return !!bruto && typeof bruto === 'object' && 'displayName' in bruto && 'id' in bruto;
}

export function converterLugar(bruto: unknown): ItemMaps | null {
  const r = lugarBruto.safeParse(bruto);
  if (!r.success) return null;
  const l = r.data;
  const comp = (tipo: string) => l.addressComponents?.find((c) => c.types?.includes(tipo));
  const ufTexto = comp('administrative_area_level_1');
  const uf =
    ufTexto?.shortText && /^[A-Za-z]{2}$/.test(ufTexto.shortText)
      ? ufTexto.shortText.toUpperCase()
      : ufDoEstado(ufTexto?.longText ?? null);
  const cep = comp('postal_code')?.longText?.replace(/\D/g, '') || null;
  return {
    placeId: l.id,
    nome: l.displayName.text,
    categoria: l.primaryTypeDisplayName?.text ?? null,
    telefone: normalizarTelefone(l.nationalPhoneNumber ?? l.internationalPhoneNumber),
    endereco: l.formattedAddress ?? null,
    cep,
    cidade: comp('administrative_area_level_2')?.longText ?? comp('locality')?.longText ?? null,
    uf,
    lat: l.location?.latitude ?? null,
    lng: l.location?.longitude ?? null,
    nota: l.rating ?? null,
    avaliacoes: l.userRatingCount ?? null,
    site: l.websiteUri ?? null,
    url: l.googleMapsUri ?? null,
    fechada: l.businessStatus === 'CLOSED_PERMANENTLY' || l.businessStatus === 'CLOSED_TEMPORARILY',
    // O Places só informa entrega no SKU "Atmosphere" (mais caro): fica sem sinal.
    entrega: null,
    dados: bruto as Record<string, unknown>,
  };
}
