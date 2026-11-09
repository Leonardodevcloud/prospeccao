import { describe, expect, it } from 'vitest';
import {
  inicioDaSemana,
  intervaloDaSemana,
  type NotaAtendimento,
  noHorarioDeAtendimento,
  notaDoTempo,
  notaGeral,
  oQueMaisPesou,
  resumirVendedor,
  situacaoDaNota,
  temposDeResposta,
} from '../src/atendimento.js';

// Terça, 4 nov 2026, em Brasília (UTC-3).
const br = (hhmm: string, dia = '2026-11-04') => new Date(`${dia}T${hhmm}:00-03:00`);

describe('tempo de resposta (medido pelo sistema)', () => {
  it('conta de cada mensagem do cliente (a primeira da sequência) até a resposta da equipe', () => {
    const t = temposDeResposta([
      { quem: 'lead', em: br('09:12') },
      { quem: 'equipe', em: br('09:16') },
      { quem: 'lead', em: br('09:18') },
      { quem: 'lead', em: br('09:20') },
      { quem: 'equipe', em: br('09:31') },
      { quem: 'lead', em: br('09:33') },
      { quem: 'equipe', em: br('09:34') },
    ]);
    expect(t).toEqual({ primeiraMin: 4, mediaMin: 6, vezes: 3 });
  });

  it('a IA ou um envio automático respondeu antes: aquela vez não conta para ninguém', () => {
    const t = temposDeResposta([
      { quem: 'lead', em: br('10:00') },
      { quem: 'outro', em: br('10:00') },
      { quem: 'equipe', em: br('11:30') },
    ]);
    expect(t).toEqual({ primeiraMin: null, mediaMin: null, vezes: 0 });
  });

  it('fora do horário (à noite e no domingo) não conta', () => {
    expect(noHorarioDeAtendimento(br('06:59'))).toBe(false);
    expect(noHorarioDeAtendimento(br('07:00'))).toBe(true);
    expect(noHorarioDeAtendimento(br('18:59'))).toBe(true);
    expect(noHorarioDeAtendimento(br('19:00'))).toBe(false);
    expect(noHorarioDeAtendimento(br('10:00', '2026-11-08'))).toBe(false);
    expect(noHorarioDeAtendimento(br('10:00', '2026-11-07'))).toBe(true);
    const t = temposDeResposta([
      { quem: 'lead', em: br('22:10') },
      { quem: 'equipe', em: br('08:05', '2026-11-05') },
    ]);
    expect(t.vezes).toBe(0);
  });

  it('a nota do tempo pela espera média', () => {
    expect([5, 6, 12, 25, 45, 90].map(notaDoTempo)).toEqual([10, 9, 8, 6, 4, 2]);
  });
});

describe('a nota', () => {
  it('a geral é a média dos pontos avaliados; a situação de cada ponto', () => {
    const c = (nota: number) => ({ nota, comentario: '', trecho: null, sugestao: null });
    expect(notaGeral({ tempo: c(10), respondeu: c(9), conduziu: c(8), proximo_passo: c(2), tom: c(9) })).toBe(
      7.6,
    );
    expect(notaGeral({ respondeu: c(7), tom: c(8) })).toBe(7.5);
    expect(notaGeral({})).toBeNull();
    expect([9, 8, 7.9, 5, 4.9].map(situacaoDaNota)).toEqual(['bom', 'bom', 'atencao', 'atencao', 'faltou']);
  });

  it('a semana começa na segunda-feira, em Brasília', () => {
    expect(inicioDaSemana(br('10:00'))).toBe('2026-11-02');
    expect(inicioDaSemana(br('23:30', '2026-11-08'))).toBe('2026-11-02');
    expect(inicioDaSemana(br('00:10', '2026-11-09'))).toBe('2026-11-09');
    const s = intervaloDaSemana('2026-11-02');
    expect(s.de.toISOString()).toBe('2026-11-02T03:00:00.000Z');
    expect(s.ate.toISOString()).toBe('2026-11-09T03:00:00.000Z');
  });
});

describe('o resumo da semana', () => {
  let id = 0;
  const nota = (
    p: Partial<Record<'tempo' | 'respondeu' | 'conduziu' | 'proximo_passo' | 'tom', number>>,
    extra: Partial<NotaAtendimento> = {},
  ): NotaAtendimento => {
    const criterios = Object.fromEntries(
      Object.entries(p).map(([k, n]) => [
        k,
        {
          nota: n,
          comentario: '',
          trecho: n! >= 8 ? `bom ${k}` : `fraco ${k}`,
          sugestao: n! < 8 ? `melhor ${k}` : null,
        },
      ]),
    );
    const n = notaGeral(criterios)!;
    id++;
    return {
      id,
      tipo: 'conversa',
      empresaId: 1,
      empresa: 'Oficina do Joel',
      ligacaoId: null,
      usuarioId: 7,
      vendedor: 'Camila',
      inicioEm: `2026-11-0${3 + (id % 3)}T12:00:00.000Z`,
      fimEm: `2026-11-0${3 + (id % 3)}T12:30:00.000Z`,
      nota: n,
      notaIa: n,
      criterios,
      primeiraRespostaMin: p.tempo ? 4 : null,
      mediaRespostaMin: p.tempo ? 6 : null,
      correcao: null,
      avaliadoEm: '2026-11-05T00:00:00.000Z',
      ...extra,
    };
  };

  it('ponto forte, o que treinar (com o exemplo e o "poderia ter sido") e a comparação com a semana anterior', () => {
    const notas = [
      nota({ tempo: 10, respondeu: 9, proximo_passo: 3, tom: 9 }),
      nota({ tempo: 9, respondeu: 9, proximo_passo: 4, tom: 8 }),
      nota({ tempo: 10, respondeu: 8, proximo_passo: 9, tom: 9 }),
    ];
    const r = resumirVendedor({ usuarioId: 7, nome: 'Camila', grupo: 'Centro' }, notas, [
      nota({ respondeu: 6, tom: 6 }),
    ]);
    expect(r).toMatchObject({
      atendimentos: 3,
      conversas: 3,
      criterios: { tempo: 9.7, respondeu: 8.7, proximo_passo: 5.3, tom: 8.7 },
      primeiraRespostaMin: 4,
      proximoPassoPct: 33,
      forte: { criterio: 'tempo' },
      treinar: { criterio: 'proximo_passo', nota: 5.3, abaixo: 2 },
      notaAnterior: 6,
    });
    expect(r.treinar!.exemplo).toMatchObject({
      trecho: 'fraco proximo_passo',
      sugestao: 'melhor proximo_passo',
    });
    expect(r.nota).toBeGreaterThan(r.notaAnterior!);
  });

  it('tudo acima de 8: nada a treinar; a correção do gestor é a nota que vale', () => {
    const r = resumirVendedor({ usuarioId: 7, nome: 'Camila', grupo: null }, [
      nota({ respondeu: 9, tom: 9 }, { nota: 6, correcao: { nota: 6, motivo: 'x', por: 'Rui', em: '' } }),
      nota({ respondeu: 8, tom: 10 }),
    ]);
    expect(r.treinar).toBeNull();
    expect(r.nota).toBe(7.5);
  });

  it('o que mais pesou na equipe: os pontos com mais atendimentos abaixo de 6', () => {
    const p = oQueMaisPesou([
      nota({ proximo_passo: 2, tom: 9, respondeu: 5 }),
      nota({ proximo_passo: 3, tom: 9, respondeu: 9 }),
      nota({ proximo_passo: 9, tom: 4, respondeu: 9 }),
    ]);
    expect(p.map((x) => [x.criterio, x.quantos])).toEqual([
      ['proximo_passo', 2],
      ['respondeu', 1],
      ['tom', 1],
    ]);
    expect(p[0]!.texto).toBe('Terminou sem próximo passo combinado');
  });
});
