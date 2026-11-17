import type { PalavraVideo } from '@prospeccao/shared/videos';
import { describe, expect, it } from 'vitest';
import { recuperarFala } from '../src/editar.js';

describe('v164: recuperar a fala que a transcrição pulou', () => {
  it('ouve de novo só os trechos suspeitos e põe as palavras no tempo do vídeo', async () => {
    const palavras: PalavraVideo[] = [
      { t: 'Se', i: 0.2, f: 0.4 },
      { t: 'você', i: 0.45, f: 3.45 },
      { t: 'mesmo.', i: 3.5, f: 3.9 },
      { t: 'Chama', i: 5.1, f: 5.5 },
    ];
    const pedidos: [number, number][] = [];
    const r = await recuperarFala(palavras, [], 6, {
      reouvir: async (a, b) => {
        pedidos.push([a, b]);
        // O trecho começa em `a`: os tempos voltam contados dali.
        if (a < 1)
          return [
            { t: 'você', i: 0.21, f: 0.55 },
            { t: 'aluga', i: 0.6, f: 1.05 },
            { t: 'hoje', i: 2.4, f: 3.1 },
          ];
        throw new Error('a transcrição caiu neste trecho');
      },
    });
    // Do fim para o começo: primeiro o vão (3,9 a 5,1), depois a palavra esticada.
    expect(pedidos).toEqual([
      [3.7, 5.3],
      [0.25, 3.65],
    ]);
    expect(r.map((p) => p.t)).toEqual(['Se', 'você', 'aluga', 'hoje', 'mesmo.', 'Chama']);
    expect(r[1]).toMatchObject({ i: 0.46, f: 0.8 });
    expect(r[3]).toMatchObject({ i: 2.65, f: 3.35, conferir: true });
  });
});
