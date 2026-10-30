import { describe, expect, it } from 'vitest';
import {
  codigoSala,
  codigoSalaValido,
  faltaParaAbrir,
  fmtDuracaoReuniao,
  fmtTempoReuniao,
  partesDeFala,
  resumoReuniao,
  situacaoDaSala,
  tarefaAtualizar,
} from '../src/index.js';

describe('reuniões', () => {
  it('sorteia códigos de sala legíveis (sem 0/o, 1/l/i)', () => {
    const c = codigoSala(Uint8Array.from([0, 1, 2, 3, 250, 251, 252, 253]));
    expect(c).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(codigoSalaValido(c)).toBe(true);
    expect(codigoSalaValido('abcd-efg0')).toBe(false);
    expect(codigoSalaValido('ABCD-EFGH')).toBe(false);
    expect(() => codigoSala(new Uint8Array(4))).toThrow();
  });

  it('abre para o convidado alguns minutos antes; encerrada e cancelada não abrem', () => {
    const inicio = new Date('2026-10-30T18:00:00Z');
    const s = { status: 'marcada' as const, inicio, abreMinutosAntes: 10 };
    expect(situacaoDaSala(s, new Date('2026-10-30T17:49:00Z'))).toEqual({
      situacao: 'antes',
      abreEm: new Date('2026-10-30T17:50:00Z'),
    });
    expect(situacaoDaSala(s, new Date('2026-10-30T17:50:00Z')).situacao).toBe('aberta');
    // Sem hora para acabar: horas depois do início continua aberta até alguém encerrar.
    expect(situacaoDaSala(s, new Date('2026-10-30T23:00:00Z')).situacao).toBe('aberta');
    expect(situacaoDaSala({ ...s, status: 'encerrada' }).situacao).toBe('encerrada');
    expect(situacaoDaSala({ ...s, status: 'cancelada' }).situacao).toBe('cancelada');
    expect(situacaoDaSala({ ...s, status: 'ao_vivo' }, new Date('2026-10-30T12:00:00Z')).situacao).toBe(
      'aberta',
    );
  });

  it('diz quanto falta e formata tempos', () => {
    const agora = new Date('2026-10-30T12:00:00Z');
    expect(faltaParaAbrir(new Date('2026-10-30T14:14:00Z'), agora)).toBe('2 h 14 min');
    expect(faltaParaAbrir(new Date('2026-10-30T12:14:00Z'), agora)).toBe('14 min');
    expect(faltaParaAbrir(new Date('2026-10-30T12:00:30Z'), agora)).toBe('menos de 1 min');
    expect(faltaParaAbrir(new Date('2026-11-01T14:00:00Z'), agora)).toBe('2 dias e 2 h');
    expect(fmtTempoReuniao(760)).toBe('12:40');
    expect(fmtTempoReuniao(3723)).toBe('1:02:03');
    expect(fmtDuracaoReuniao(3120)).toBe('52 min');
    expect(fmtDuracaoReuniao(4500)).toBe('1 h 15 min');
  });

  it('parte de cada pessoa no tempo de fala', () => {
    const p = partesDeFala([
      { identidade: 'a', inicioMs: 0, fimMs: 3000 },
      { identidade: 'b', inicioMs: 3000, fimMs: 4000 },
    ]);
    expect(Object.fromEntries(p)).toEqual({ a: 75, b: 25 });
    expect(partesDeFala([]).size).toBe(0);
  });

  it('resumo da IA: o que vier torto vira vazio, sem derrubar o resto', () => {
    const r = resumoReuniao.parse({
      resumo: 'Ok.',
      interesse: 'enorme',
      destaques: [{ tipo: 'dor', texto: 'Falta motoboy', segundo: -5 }],
      proximosPassos: 'nenhum',
      momentos: [],
      sugestaoEtapa: 'fechar',
    });
    expect(r).toMatchObject({
      interesse: 'indefinido',
      destaques: [{ tipo: 'dor', segundo: null }],
      proximosPassos: [],
      sugestaoEtapa: null,
    });
  });

  it('atualizar a tarefa não muda o tipo sem pedir (marcar reunião como feita continua reunião)', () => {
    expect(tarefaAtualizar.parse({ concluida: true })).toEqual({ concluida: true });
  });
});
