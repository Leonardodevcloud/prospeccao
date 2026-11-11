import { describe, expect, it } from 'vitest';
import { linhaDoAndamento, mapaDaPrevia, quantoFalta } from '../src/videos.js';

describe('v136: o andamento da edição', () => {
  it('cada etapa feita mostra o que achou', () => {
    const a = {
      ouvindo: { palavras: 218 },
      cortando: { pausas: 14, muletas: 3, recomecos: 1, outros: 0, de: 84, para: 62 },
      rosto: { caixa: { x0: 300, y0: 500, x1: 780, y1: 1100 }, t: 1.5 },
      imagens: { fotos: 1, geradas: 2, animacoes: 4, musica: true },
    };
    expect(linhaDoAndamento('ouvindo', a)).toBe('218 palavras, cada uma com o momento exato');
    expect(linhaDoAndamento('cortando', a)).toBe(
      '14 pausas, 3 "éé" e "né", 1 frase recomeçada: 1:24 vira 1:02',
    );
    expect(linhaDoAndamento('rosto', a)).toContain('abaixo do queixo');
    expect(linhaDoAndamento('imagens', a)).toBe('3 imagens (2 feitas pela IA), 4 animações, música');
    expect(linhaDoAndamento('gerando', a)).toBeNull();
    expect(linhaDoAndamento('ouvindo', null)).toBeNull();
  });

  it('quanto falta só depois de 15%, pelo ritmo', () => {
    const inicio = new Date(0).toISOString();
    expect(quantoFalta(inicio, 10, 60_000)).toBeNull();
    expect(quantoFalta(inicio, 50, 120_000)).toBe('cerca de 2 minutos');
    expect(quantoFalta(inicio, 90, 90_000)).toBe('menos de 1 minuto');
  });

  it('o mapa: legenda abaixo do queixo (nunca acima de 1180 px) e gráficos acima da cabeça', () => {
    const m = mapaDaPrevia({ x0: 300, y0: 500, x1: 780, y1: 1100 });
    expect(m.rosto).toMatchObject({ x: 300 / 1080, y: 500 / 1920 });
    expect(m.legenda.y).toBeCloseTo(1180 / 1920, 5);
    expect(m.graficos!.y + m.graficos!.h).toBeCloseTo((500 - 34) / 1920, 5);
    const baixo = mapaDaPrevia({ x0: 300, y0: 900, x1: 780, y1: 1400 });
    expect(baixo.legenda.y).toBeCloseTo(1434 / 1920, 5);
    expect(mapaDaPrevia(null).rosto).toBeNull();
  });
});
