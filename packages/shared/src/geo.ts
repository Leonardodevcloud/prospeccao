export interface Ponto {
  lat: number;
  lng: number;
}

const RAIO_TERRA_KM = 6371.0088;

/** Distância em linha reta (km) entre dois pontos. */
export function haversineKm(a: Ponto, b: Ponto): number {
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RAIO_TERRA_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A base mais próxima e a distância até ela; null quando não há bases. */
export function baseMaisProxima<T extends Ponto>(ponto: Ponto, bases: T[]): { base: T; km: number } | null {
  let melhor: { base: T; km: number } | null = null;
  for (const base of bases) {
    const km = haversineKm(ponto, base);
    if (!melhor || km < melhor.km) melhor = { base, km };
  }
  return melhor;
}
