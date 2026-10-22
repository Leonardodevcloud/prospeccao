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
});
