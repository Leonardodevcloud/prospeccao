import { describe, expect, it } from 'vitest';
import { centroDoRosto, remendarBuracos } from '../src/rosto.js';

const caixa = { x0: 100, x1: 300, y0: 200, y1: 600 };

describe('mapa do rosto', () => {
  it('remenda buraco curto (piscada) e deixa o rosto sumido de verdade', () => {
    const q = (t: number, tem: boolean) => ({ t, caixas: tem ? [caixa] : [] });
    const r = remendarBuracos([
      q(0, true),
      q(1, false),
      q(2, false),
      q(3, true),
      q(4, false),
      q(5, false),
      q(6, false),
      q(7, false),
      q(8, false),
    ]);
    expect(r.map((x) => x.caixas.length)).toEqual(
      [1, 1, 1, 1, 1, 1, 1, 1, 1].map((v, k) => (k >= 4 ? 0 : v)),
    );
  });

  it('centro típico do rosto para recortar em pé um vídeo deitado', () => {
    expect(
      centroDoRosto(
        [
          { t: 0, caixas: [caixa] },
          { t: 1, caixas: [{ ...caixa, x0: 900, x1: 1100 }] },
          { t: 2, caixas: [caixa] },
        ],
        1920,
      ),
    ).toBe(200);
    expect(centroDoRosto([], 1920)).toBe(960);
  });
});
