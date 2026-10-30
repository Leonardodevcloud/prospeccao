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

describe('enquadramento dos vídeos', () => {
  it('preenche o quadro só quando o corte é pequeno; senão mostra inteiro', async () => {
    const { encaixeDoVideo } = await import('../src/reunioes.js');
    const hd = { largura: 1280, altura: 720 };
    expect(encaixeDoVideo(hd, { largura: 640, altura: 360 })).toBe('cover');
    // Janela maximizada e larga (2,3:1): cortaria 23% da altura → inteiro.
    expect(encaixeDoVideo(hd, { largura: 1580, altura: 680 })).toBe('contain');
    // Celular em pé num quadro deitado → inteiro.
    expect(encaixeDoVideo({ largura: 720, altura: 1280 }, { largura: 640, altura: 360 })).toBe('contain');
    // Tela compartilhada é sempre inteira; sem saber o tamanho, também.
    expect(encaixeDoVideo(hd, { largura: 640, altura: 360 }, true)).toBe('contain');
    expect(encaixeDoVideo(null, { largura: 640, altura: 360 })).toBe('contain');
  });

  it('monta a grade que cabe no espaço, em 16:9', async () => {
    const { gradeEncaixada } = await import('../src/reunioes.js');
    expect(gradeEncaixada(1, { largura: 1600, altura: 700 }, 12)).toEqual({
      colunas: 1,
      largura: 1244,
      altura: 700,
    });
    const dois = gradeEncaixada(2, { largura: 1600, altura: 700 }, 12);
    expect(dois.colunas).toBe(2);
    expect(dois.largura * 2 + 12).toBeLessThanOrEqual(1600);
    const quatro = gradeEncaixada(4, { largura: 1000, altura: 800 }, 12);
    expect(quatro.colunas).toBe(2);
    expect(quatro.altura * 2 + 12).toBeLessThanOrEqual(800);
    expect(gradeEncaixada(3, { largura: 0, altura: 0 })).toMatchObject({ largura: 0, altura: 0 });
  });
});
