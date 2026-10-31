import { describe, expect, it } from 'vitest';
import {
  e164,
  fmtDuracaoLigacao,
  horarioDeLigar,
  minutosCobrados,
  numeroDeSaida,
  ordenarTelefones,
  resumoLigacao,
} from '../src/ligacoes.js';
import { planoEfetivo, TABELA_PADRAO } from '../src/planos.js';

describe('números do lead para ligar', () => {
  it('junta o mesmo número de várias fontes e põe na ordem certa', () => {
    const r = ordenarTelefones([
      { numero: '7132458800', origem: 'receita' },
      { numero: '(71) 3245-8800', origem: 'google', rotulo: 'Perfil no Google' },
      { numero: '71 9876-5432', origem: 'enriquecimento', principal: true },
      { numero: '71998765432', origem: 'whatsapp', rotulo: 'WhatsApp da clínica' },
      { numero: '7130124455', origem: 'receita', errado: true },
      { numero: '71991112222', origem: 'contato', rotulo: 'Dr. Paulo · sócio' },
      { numero: 'xx', origem: 'manual' },
    ]);
    expect(r.map((t) => [t.numero, t.ordem])).toEqual([
      ['71998765432', 1],
      ['71991112222', 2],
      ['7132458800', 3],
      ['7130124455', null],
    ]);
    expect(r[0]).toMatchObject({ tipo: 'celular', whatsapp: true, origens: ['enriquecimento', 'whatsapp'] });
    expect(r[2]).toMatchObject({ tipo: 'fixo', origens: ['receita', 'google'] });
  });

  it('confirmado vai primeiro; quem não atendeu agora há pouco vai para depois', () => {
    const r = ordenarTelefones([
      {
        numero: '71998765432',
        origem: 'whatsapp',
        ultimoResultado: 'nao_atendeu',
        ultimaEm: '2026-10-30T10:00:00Z',
      },
      { numero: '7132458800', origem: 'google' },
      { numero: '71991112222', origem: 'enriquecimento', confirmado: true },
    ]);
    expect(r.map((t) => t.numero)).toEqual(['71991112222', '7132458800', '71998765432']);
  });
});

describe('ligação', () => {
  it('número de saída: o do mesmo DDD do lead, senão o principal', () => {
    const nums = [
      { numero: '7133330400', principal: true },
      { numero: '1140032210', principal: false },
    ];
    expect(numeroDeSaida(nums, '11987654321', true)?.numero).toBe('1140032210');
    expect(numeroDeSaida(nums, '21987654321', true)?.numero).toBe('7133330400');
    expect(numeroDeSaida(nums, '11987654321', false)?.numero).toBe('7133330400');
    expect(numeroDeSaida([], '11987654321', true)).toBeNull();
  });

  it('formatos, minutos e discagem', () => {
    expect(fmtDuracaoLigacao(45)).toBe('45 s');
    expect(fmtDuracaoLigacao(372)).toBe('6 min 12 s');
    expect(fmtDuracaoLigacao(3720)).toBe('1 h 2 min');
    expect(minutosCobrados(0)).toBe(0);
    expect(minutosCobrados(61)).toBe(2);
    expect(e164('71998765432')).toBe('+5571998765432');
  });

  it('resumo da IA: o que vier fora do formato vira o padrão', () => {
    const r = resumoLigacao.parse({
      resumo: 'Ok',
      clima: 'feliz',
      destaques: 'x',
      contatos: [{ nome: 'Ana' }],
    });
    expect(r).toMatchObject({ clima: 'neutro', destaques: [], contatos: [{ nome: 'Ana', decisor: false }] });
  });

  it('módulo Ligações no plano: preço e franquia de minutos', () => {
    const p = planoEfetivo({
      plano: 'time',
      limiteUsuarios: null,
      limiteLeadsMes: null,
      modulos: ['ligacoes'],
      mensalidadeManual: null,
    });
    expect(p.minutosLigacao).toBe(TABELA_PADRAO.minutosLigacao);
    expect(p.itens).toContainEqual({ rotulo: 'Ligações', valor: TABELA_PADRAO.modulos.ligacoes });
    const sem = planoEfetivo({
      plano: 'time',
      limiteUsuarios: null,
      limiteLeadsMes: null,
      modulos: [],
      mensalidadeManual: null,
    });
    expect(sem.minutosLigacao).toBe(0);
  });
});

describe('horário de ligar (Brasília)', () => {
  it('dias úteis 8h–20h, sábado 8h–14h, domingo não', () => {
    // 31/10/2026 é sábado.
    expect(horarioDeLigar(new Date('2026-10-31T12:00:00-03:00'))).toBe(true);
    expect(horarioDeLigar(new Date('2026-10-31T15:00:00-03:00'))).toBe(false);
    expect(horarioDeLigar(new Date('2026-11-01T10:00:00-03:00'))).toBe(false);
    expect(horarioDeLigar(new Date('2026-11-02T07:59:00-03:00'))).toBe(false);
    expect(horarioDeLigar(new Date('2026-11-02T08:00:00-03:00'))).toBe(true);
    expect(horarioDeLigar(new Date('2026-11-02T19:59:00-03:00'))).toBe(true);
    expect(horarioDeLigar(new Date('2026-11-02T20:00:00-03:00'))).toBe(false);
  });
});
