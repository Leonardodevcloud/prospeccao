import { describe, expect, it } from 'vitest';
import { gravarMedicoes, registrarChamada } from '../src/medidor.js';
import type { Executor } from '../src/pool.js';

describe('medidor das chamadas para fora', () => {
  it('soma por serviço e minuto e grava o último erro e os erros seguidos', async () => {
    const consultas: { sql: string; params: unknown[] }[] = [];
    const db = {
      query: async (sql: string, params: unknown[]) => {
        consultas.push({ sql, params });
        return { rows: [] };
      },
    } as unknown as Executor;
    const em = Date.UTC(2026, 9, 31, 12, 0, 10);
    registrarChamada('serper', 100, null, em);
    registrarChamada('serper', 300, 'HTTP 403 sem créditos', em + 1000);
    registrarChamada('serper', 200, 'HTTP 403 sem créditos', em + 2000);
    registrarChamada('ia', 1500, null, em + 70_000);
    await gravarMedicoes(db);
    const uso = consultas.find((c) => c.sql.includes('servicos_uso'))!;
    const [servicos, minutos, chamadas, erros, msTotal, msMax] = uso.params as unknown[][];
    expect(servicos).toEqual(['serper', 'ia']);
    expect(minutos).toEqual(['2026-10-31T12:00:00.000Z', '2026-10-31T12:01:00.000Z']);
    expect(chamadas).toEqual([3, 1]);
    expect(erros).toEqual([2, 0]);
    expect(msTotal).toEqual([600, 1500]);
    expect(msMax).toEqual([300, 1500]);
    const serper = consultas.find((c) => c.sql.includes('servicos_estado') && c.params[0] === 'serper')!;
    expect(serper.params[3]).toBe('HTTP 403 sem créditos');
    expect(serper.params[4]).toBe(2);
    // Nada novo: a próxima gravação não escreve nada.
    consultas.length = 0;
    await gravarMedicoes(db);
    expect(consultas).toHaveLength(0);
    // Os erros seguidos continuam contando entre uma gravação e outra; um sucesso zera.
    registrarChamada('serper', 200, 'HTTP 403 sem créditos', em + 90_000);
    await gravarMedicoes(db);
    expect(consultas.find((c) => c.sql.includes('servicos_estado'))!.params[4]).toBe(3);
    registrarChamada('serper', 200, null, em + 95_000);
    await gravarMedicoes(db);
    expect(consultas.filter((c) => c.sql.includes('servicos_estado')).at(-1)!.params[4]).toBe(0);
  });
});
