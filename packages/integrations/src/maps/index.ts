import { normalizarTelefone } from '@prospeccao/shared';
import { z } from 'zod';
import { ufDoEstado } from './estados.js';

/**
 * Item do Google Maps como o sistema guarda (`ItemMaps`). O Google Places e o Serper convertem para
 * ele. `converterItem` lê os itens antigos guardados no formato do Apify (buscas feitas antes da troca
 * para o Places), que ainda podem estar nos resultados pendentes.
 */

/** Item antigo (formato do Apify): só validamos o que usamos, o resto fica em `dados`. */
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
