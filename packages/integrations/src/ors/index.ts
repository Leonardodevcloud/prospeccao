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

/* ───────────── Rotas (vendas na rua) ───────────── */

export interface PontoRota {
  lat: number;
  lng: number;
}

const respostaMatriz = z.object({
  durations: z.array(z.array(z.number().nullable())),
  distances: z.array(z.array(z.number().nullable())),
});

/**
 * Tempo (minutos) e distância (km) de carro de cada ponto para cada outro. Par sem caminho pelas
 * ruas (o ORS devolve null) fica null: quem chama completa com a estimativa em linha reta.
 * Limite do plano grátis: 3.500 pares por pedido (até 59 pontos).
 */
export async function matriz(
  cfg: ConfigOrs,
  pontos: PontoRota[],
): Promise<{ minutos: (number | null)[][]; km: (number | null)[][] }> {
  if (pontos.length > 59) throw new Error('Matriz do ORS: no máximo 59 pontos por pedido');
  const dados = respostaMatriz.parse(
    await requisitarJson('https://api.openrouteservice.org/v2/matrix/driving-car', {
      servico: 'OpenRouteService',
      method: 'POST',
      headers: { authorization: cfg.apiKey },
      body: { locations: pontos.map((p) => [p.lng, p.lat]), metrics: ['duration', 'distance'], units: 'km' },
      timeoutMs: 20_000,
    }),
  );
  return {
    minutos: dados.durations.map((l) => l.map((s) => (s == null ? null : s / 60))),
    km: dados.distances,
  };
}

const respostaTracado = z.object({
  features: z
    .array(
      z.object({
        geometry: z.object({ coordinates: z.array(z.tuple([z.number(), z.number()]).rest(z.number())) }),
        properties: z
          .object({
            summary: z.object({ distance: z.number().optional(), duration: z.number().optional() }).loose(),
          })
          .loose(),
      }),
    )
    .min(1),
});

/**
 * Caminho pelas ruas passando pelos pontos na ordem (para desenhar no mapa). Devolve a linha em
 * [lat, lng], já com menos pontos (um a cada ~30 m basta para a tela), e o total em km e minutos.
 */
export async function tracado(
  cfg: ConfigOrs,
  pontos: PontoRota[],
): Promise<{ linha: [number, number][]; km: number; minutos: number }> {
  if (pontos.length < 2) return { linha: pontos.map((p) => [p.lat, p.lng]), km: 0, minutos: 0 };
  if (pontos.length > 50) throw new Error('Rota do ORS: no máximo 50 pontos');
  const dados = respostaTracado.parse(
    await requisitarJson('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
      servico: 'OpenRouteService',
      method: 'POST',
      headers: { authorization: cfg.apiKey },
      body: {
        coordinates: pontos.map((p) => [p.lng, p.lat]),
        instructions: false,
        // Endereço achado longe da rua (dentro de um condomínio, por exemplo) ainda entra.
        radiuses: pontos.map(() => 2000),
      },
      timeoutMs: 25_000,
    }),
  );
  const f = dados.features[0]!;
  const linha: [number, number][] = [];
  for (const [lng, lat] of f.geometry.coordinates) {
    const u = linha[linha.length - 1];
    if (u && Math.abs(u[0] - lat) < 0.0003 && Math.abs(u[1] - lng) < 0.0003) continue;
    linha.push([Number(lat.toFixed(5)), Number(lng.toFixed(5))]);
  }
  const [ultLng, ultLat] = f.geometry.coordinates[f.geometry.coordinates.length - 1] ?? [];
  if (ultLat != null && ultLng != null) {
    const fim: [number, number] = [Number(ultLat.toFixed(5)), Number(ultLng.toFixed(5))];
    const u = linha[linha.length - 1];
    if (!u || u[0] !== fim[0] || u[1] !== fim[1]) linha.push(fim);
  }
  const s = f.properties.summary;
  return { linha, km: (s.distance ?? 0) / 1000, minutos: (s.duration ?? 0) / 60 };
}
