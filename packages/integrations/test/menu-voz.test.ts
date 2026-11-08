import { execFileSync, spawnSync } from 'node:child_process';
import { textoChamandoGrupo, textoDoMenu } from '@prospeccao/shared';
import { describe, expect, it } from 'vitest';
import { paraPcm, TAXA, tomDeChamada } from '../src/telefonia/menu.js';

const temFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

describe('menu de voz', () => {
  it('o texto do menu segue a ordem dos grupos (uma tecla cada, até 9)', () => {
    expect(
      textoDoMenu('Olá! Você ligou para a Autopeças Silva', [
        { nome: 'Loja Centro' },
        { nome: 'Loja Norte' },
      ]),
    ).toBe('Olá! Você ligou para a Autopeças Silva. Para Loja Centro, digite 1. Para Loja Norte, digite 2.');
    expect(textoDoMenu('', [{ nome: 'Peças' }])).toBe('Para Peças, digite 1.');
    const muitos = Array.from({ length: 12 }, (_, i) => ({ nome: `Loja ${i + 1}` }));
    expect(textoDoMenu('Oi.', muitos)).toMatch(/digite 9\.$/);
    expect(textoChamandoGrupo(null)).toBe('Um momento, estamos chamando um atendente.');
  });

  it('tom de chamada: 1 s tocando e 4 s em silêncio', () => {
    const t = tomDeChamada();
    expect(t.length).toBe(TAXA * 5);
    expect(Math.max(...t.subarray(0, TAXA))).toBeGreaterThan(6000);
    expect(t.subarray(TAXA).every((v) => v === 0)).toBe(true);
  });

  it.skipIf(!temFfmpeg)('converte o mp3 da voz para o som da ligação', async () => {
    const mp3 = execFileSync('ffmpeg', [
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1',
      '-ac',
      '1',
      '-f',
      'mp3',
      'pipe:1',
    ]);
    const pcm = await paraPcm(new Uint8Array(mp3));
    expect(pcm.length).toBeGreaterThan(TAXA * 0.95);
    expect(pcm.length).toBeLessThan(TAXA * 1.15);
    await expect(paraPcm(new Uint8Array([1, 2, 3]))).rejects.toThrow(/ffmpeg/);
  });
});
