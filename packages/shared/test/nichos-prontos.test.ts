import { describe, expect, it } from 'vitest';
import { nichoEntrada } from '../src/dominio.js';
import { NICHOS_PRONTOS } from '../src/nichosProntos.js';

describe('nichos prontos', () => {
  it('todos passam na validação do nicho e têm id único', () => {
    for (const n of NICHOS_PRONTOS) {
      const r = nichoEntrada.safeParse({ ...n });
      expect(r.success, `${n.nome}: ${r.success ? '' : r.error.issues[0]?.message}`).toBe(true);
    }
    expect(new Set(NICHOS_PRONTOS.map((n) => n.id)).size).toBe(NICHOS_PRONTOS.length);
  });

  it('sinais falam do ramo (não de entrega) e as sugestões não repetem os já marcados', () => {
    for (const n of NICHOS_PRONTOS) {
      const sinais = [...n.palavrasPositivas, ...n.outrosSinais];
      expect(
        sinais.some((s) => /entreg|delivery|motoboy/i.test(s)),
        n.nome,
      ).toBe(false);
      expect(
        n.outrosSinais.filter((s) => n.palavrasPositivas.includes(s)),
        n.nome,
      ).toEqual([]);
      expect(n.palavrasPositivas.length, n.nome).toBeGreaterThan(0);
    }
  });
});
