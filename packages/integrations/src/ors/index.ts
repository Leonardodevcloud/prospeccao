import { z } from 'zod';
import { requisitarJson } from '../http.js';

export interface ConfigOrs {
  apiKey: string;
}

export interface ResultadoGeocodificacao {
  lat: number;
  lng: number;
  /** 0 a 1, do próprio ORS. */
  confianca: number;
  rotulo: string;
}

const resposta = z.object({
  features: z.array(
    z.object({
      geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]) }),
      properties: z.object({ confidence: z.number().optional(), label: z.string().optional() }).loose(),
    }),
  ),
});

/** Geocodifica um endereço no Brasil. null quando o ORS não acha nada. */
export async function geocodificar(
  cfg: ConfigOrs,
  endereco: string,
): Promise<ResultadoGeocodificacao | null> {
  const params = new URLSearchParams({ text: endereco, 'boundary.country': 'BR', size: '1' });
  const dados = resposta.parse(
    await requisitarJson(`https://api.openrouteservice.org/geocode/search?${params}`, {
      servico: 'OpenRouteService',
      headers: { authorization: cfg.apiKey },
      timeoutMs: 15_000,
    }),
  );
  const f = dados.features[0];
  if (!f) return null;
  const [lng, lat] = f.geometry.coordinates;
  return { lat, lng, confianca: f.properties.confidence ?? 0, rotulo: f.properties.label ?? endereco };
}
