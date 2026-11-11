import { existsSync } from 'node:fs';
import { opcoesVideoEntrada } from '@prospeccao/shared/videos';
import { describe, expect, it } from 'vitest';
import { arquivoDoEfeito, efeitosParaMisturar, somPadrao, sonsPresentes } from '../src/enfeitar.js';

describe('o som de cada vídeo', () => {
  const o = opcoesVideoEntrada.parse({});

  it('vídeo novo: música ligada se a conta tem; vídeo da v128 fica sem música e sem efeitos', () => {
    expect(somPadrao(o, { liberada: true, antigo: false })).toMatchObject({
      musica: { usar: true, clima: 'confiante', volume: 35, erro: null },
      efeitos: { ligados: true },
    });
    expect(somPadrao(o, { liberada: false, antigo: false }).musica).toMatchObject({
      usar: false,
      erro: expect.stringContaining('ligada na plataforma'),
    });
    expect(somPadrao(o, { liberada: true, antigo: true })).toMatchObject({
      musica: { usar: false },
      efeitos: { ligados: false },
    });
    expect(somPadrao({ ...o, musica: 'calma' }, { liberada: true, antigo: false }).musica.clima).toBe(
      'calma',
    );
  });

  it('os efeitos tirados não entram na mistura, e os arquivos estão no pacote', async () => {
    const som = somPadrao(o, { liberada: true, antigo: false });
    som.efeitos.desligados = ['b'];
    const lista = [
      { id: 'a', tipo: 'tique' as const, em: 1, onde: '' },
      { id: 'b', tipo: 'sopro' as const, em: 2, onde: '' },
    ];
    expect(efeitosParaMisturar(som, lista).map((e) => e.em)).toEqual([1]);
    expect(efeitosParaMisturar({ ...som, efeitos: { ...som.efeitos, ligados: false } }, lista)).toEqual([]);
    expect(await sonsPresentes()).toBe(true);
    for (const t of ['tique', 'sopro', 'estalo', 'subida'] as const)
      expect(existsSync(arquivoDoEfeito(t))).toBe(true);
  });
});
