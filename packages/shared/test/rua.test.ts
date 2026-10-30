import { describe, expect, it } from 'vitest';
import {
  type ConfigDia,
  configRoteiro,
  diaEmSaoPaulo,
  escolherDoDia,
  fmtMinutos,
  horaDoDia,
  horarios,
  linkGoogleMaps,
  linkWaze,
  type Matriz,
  matrizEstimada,
  minutosDoDia,
  ordenar,
  proximoPassoSugerido,
  somarDiasUteis,
} from '../src/rua.js';

/** Pontos numa linha (cada um a 10 min do vizinho): 0 é a partida. */
function linha(n: number, passo = 10): Matriz {
  const minutos = Array.from({ length: n }, (_, a) =>
    Array.from({ length: n }, (_, b) => Math.abs(a - b) * passo),
  );
  return { minutos, km: minutos.map((l) => l.map((x) => x / 2)) };
}

const DIA: ConfigDia = {
  inicio: minutosDoDia('08:30'),
  fim: minutosDoDia('17:30'),
  minutosVisita: 30,
  almoco: { inicio: minutosDoDia('12:00'), minutos: 60 },
};

describe('vendas na rua: horários e ordem', () => {
  it('converte horas e durações', () => {
    expect(minutosDoDia('08:30')).toBe(510);
    expect(horaDoDia(510)).toBe('08:30');
    expect(horaDoDia(1000.4)).toBe('16:40');
    expect(fmtMinutos(112)).toBe('1 h 52 min');
    expect(fmtMinutos(38)).toBe('38 min');
    expect(fmtMinutos(120)).toBe('2 h');
    expect(() => minutosDoDia('8h')).toThrow();
  });

  it('calcula a chegada em cada visita e põe o almoço antes da que passaria do horário', () => {
    const m = linha(8, 15);
    const h = horarios([1, 2, 3, 4, 5, 6], m, DIA);
    expect(h.paradas.map((p) => horaDoDia(p.chegada))).toEqual([
      '08:45',
      '09:30',
      '10:15',
      '11:00',
      // 11:30 + 15 de trecho + 30 de visita = 12:15, cabe na folga de meia hora
      '11:45',
      // passaria das 12:30: almoça das 12:15 às 13:15 e segue
      '13:30',
    ]);
    expect(h.almocoAntesDe).toBe(5);
    expect(horaDoDia(h.termino)).toBe('14:00');
    expect(h.minutosRota).toBe(90);
    expect(h.km).toBe(45);
  });

  it('espera dar a hora do almoço quando o próximo trecho entraria no horário dele', () => {
    const m = linha(3, 100);
    const h = horarios([1, 2], m, { ...DIA, inicio: minutosDoDia('10:00') });
    // 1ª: 11:40-12:10. A 2ª terminaria 14:20: almoça 12:10-13:10, chega 14:50.
    expect(h.paradas.map((p) => horaDoDia(p.chegada))).toEqual(['11:40', '14:50']);
  });

  it('sem almoço e sem paradas', () => {
    expect(horarios([], linha(2), DIA)).toMatchObject({ paradas: [], termino: DIA.inicio, km: 0 });
    const h = horarios([1, 2, 3, 4, 5, 6, 7], linha(8, 30), { ...DIA, almoco: null });
    expect(h.almocoAntesDe).toBeNull();
  });

  it('ordena para andar menos (vizinho mais próximo + 2-opt)', () => {
    const m = linha(6);
    expect(ordenar([5, 2, 4, 1, 3], m)).toEqual([1, 2, 3, 4, 5]);
    expect(ordenar([], m)).toEqual([]);
  });

  it('escolhe os mais importantes que cabem no dia e põe em ordem', () => {
    const m = linha(30, 20);
    const candidatos = Array.from({ length: 29 }, (_, i) => ({ indice: i + 1, prioridade: 100 - i }));
    const dia = escolherDoDia(candidatos, m, DIA);
    expect(dia.length).toBeGreaterThan(5);
    expect(horarios(dia, m, DIA).termino).toBeLessThanOrEqual(DIA.fim);
    // Os de maior prioridade entraram e a ordem anda para um lado só.
    expect(dia).toContain(1);
    expect([...dia].sort((a, b) => a - b)).toEqual(dia);
    // Respeita o máximo de paradas.
    expect(escolherDoDia(candidatos, m, DIA, 3)).toHaveLength(3);
  });

  it('deixa de fora o lead que não cabe no horário', () => {
    const m: Matriz = {
      minutos: [
        [0, 10, 600],
        [10, 0, 600],
        [600, 600, 0],
      ],
      km: [
        [0, 5, 300],
        [5, 0, 300],
        [300, 300, 0],
      ],
    };
    expect(
      escolherDoDia(
        [
          { indice: 2, prioridade: 99 },
          { indice: 1, prioridade: 10 },
        ],
        m,
        DIA,
      ),
    ).toEqual([1]);
  });

  it('estima distância e tempo sem o serviço de rotas', () => {
    const m = matrizEstimada([
      { lat: -12.9714, lng: -38.5014 },
      { lat: -12.9814, lng: -38.4614 },
    ]);
    expect(m.km[0]![0]).toBe(0);
    expect(m.km[0]![1]!).toBeGreaterThan(5);
    expect(m.km[0]![1]!).toBeLessThan(8);
    expect(m.minutos[0]![1]!).toBeGreaterThan(m.km[0]![1]! * 2);
  });
});

describe('vendas na rua: visita e links', () => {
  it('sugere o próximo passo pelo resultado, em dia útil', () => {
    // Quinta, 5 de novembro de 2026, 11h em São Paulo.
    const quinta = new Date('2026-11-05T14:00:00Z');
    expect(diaEmSaoPaulo(quinta)).toBe('2026-11-05');
    expect(proximoPassoSugerido('proposta', quinta)).toEqual({
      texto: 'Mandar a proposta',
      dia: '2026-11-06',
    });
    // Sexta + 1 dia útil = segunda.
    expect(somarDiasUteis('2026-11-06', 1)).toBe('2026-11-09');
    expect(proximoPassoSugerido('decisor', quinta)?.dia).toBe('2026-11-10');
    expect(proximoPassoSugerido('sem_interesse', quinta)).toBeNull();
  });

  it('monta os links do Waze e do Google Maps', () => {
    expect(linkWaze({ lat: -12.97, lng: -38.5 })).toBe(
      'https://waze.com/ul?ll=-12.970000,-38.500000&navigate=yes',
    );
    const g = linkGoogleMaps({ lat: -12.9, lng: -38.4 }, { lat: -12.97, lng: -38.5 }, [
      { lat: -12.95, lng: -38.45 },
    ]);
    expect(g).toContain('destination=-12.900000,-38.400000');
    expect(g).toContain('origin=-12.970000,-38.500000');
    expect(g).toContain('waypoints=-12.950000,-38.450000');
  });

  it('valida a configuração do dia', () => {
    const base = { dia: '2026-11-05', partida: { rotulo: 'Escritório', lat: -12.97, lng: -38.5 } };
    const c = configRoteiro.parse(base);
    expect(c).toMatchObject({ inicio: '08:30', minutosVisita: 30, faixas: ['A', 'B'], campanhaId: null });
    expect(configRoteiro.safeParse({ ...base, inicio: '18:00', fim: '08:00' }).success).toBe(false);
    expect(configRoteiro.safeParse({ ...base, faixas: [] }).success).toBe(false);
  });
});
