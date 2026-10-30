import { afterEach, describe, expect, it, vi } from 'vitest';
import { matriz, tracado } from '../src/ors/index.js';

const CFG = { apiKey: 'chave-teste' };

afterEach(() => vi.unstubAllGlobals());

function responder(corpo: unknown, pedidos: { url: string; corpo: unknown; auth: string | null }[]) {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    pedidos.push({
      url,
      corpo: JSON.parse(String(init.body)),
      auth: new Headers(init.headers).get('authorization'),
    });
    return new Response(JSON.stringify(corpo), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

describe('OpenRouteService: rotas', () => {
  it('matriz em minutos e km, com [lng, lat] no pedido', async () => {
    const pedidos: { url: string; corpo: unknown; auth: string | null }[] = [];
    responder(
      {
        durations: [
          [0, 600],
          [540, null],
        ],
        distances: [
          [0, 4.2],
          [3.9, null],
        ],
      },
      pedidos,
    );
    const m = await matriz(CFG, [
      { lat: -12.97, lng: -38.5 },
      { lat: -12.98, lng: -38.46 },
    ]);
    expect(m.minutos).toEqual([
      [0, 10],
      [9, null],
    ]);
    expect(m.km[0]![1]).toBe(4.2);
    expect(pedidos[0]!.url).toContain('/v2/matrix/driving-car');
    expect(pedidos[0]!.auth).toBe('chave-teste');
    expect(pedidos[0]!.corpo).toMatchObject({
      locations: [
        [-38.5, -12.97],
        [-38.46, -12.98],
      ],
      units: 'km',
    });
  });

  it('traçado em [lat, lng], sem pontos colados e com o total', async () => {
    const pedidos: { url: string; corpo: unknown; auth: string | null }[] = [];
    responder(
      {
        type: 'FeatureCollection',
        features: [
          {
            geometry: {
              coordinates: [
                [-38.5, -12.97],
                [-38.50001, -12.97001],
                [-38.48, -12.975],
                [-38.46, -12.98],
              ],
            },
            properties: { summary: { distance: 5300, duration: 780 } },
          },
        ],
      },
      pedidos,
    );
    const t = await tracado(CFG, [
      { lat: -12.97, lng: -38.5 },
      { lat: -12.98, lng: -38.46 },
    ]);
    expect(t.linha).toEqual([
      [-12.97, -38.5],
      [-12.975, -38.48],
      [-12.98, -38.46],
    ]);
    expect(t.km).toBeCloseTo(5.3);
    expect(t.minutos).toBe(13);
    expect(pedidos[0]!.url).toContain('/v2/directions/driving-car/geojson');
  });

  it('um ponto só não chama o serviço', async () => {
    const pedidos: { url: string; corpo: unknown; auth: string | null }[] = [];
    responder({}, pedidos);
    expect(await tracado(CFG, [{ lat: 1, lng: 2 }])).toEqual({ linha: [[1, 2]], km: 0, minutos: 0 });
    expect(pedidos).toHaveLength(0);
  });
});
