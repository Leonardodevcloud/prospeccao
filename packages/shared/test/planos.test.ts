import { describe, expect, it } from 'vitest';
import { planoContaEntrada, planoEfetivo, TABELA_PADRAO, tabelaCompleta } from '../src/planos.js';

describe('planos', () => {
  it('números do plano, trocados só para a conta, e o preço', () => {
    const p = planoEfetivo({
      plano: 'time',
      limiteUsuarios: 6,
      limiteLeadsMes: null,
      modulos: ['whatsapp', 'email'],
      mensalidadeManual: null,
    });
    expect(p).toMatchObject({ usuarios: 6, leadsMes: 5000, modulos: ['whatsapp', 'email'] });
    expect(p.mensalidadeCalculada).toBe(599 + 2 * 59 + 250 + 200);
    expect(p.mensalidade).toBe(p.mensalidadeCalculada);
    // Menos usuários desconta, mais leads soma; o preço combinado vale.
    expect(
      planoEfetivo({
        plano: 'escala',
        limiteUsuarios: 3,
        limiteLeadsMes: 40000,
        modulos: [],
        mensalidadeManual: 800,
      }),
    ).toMatchObject({
      usuarios: 3,
      leadsMes: 40000,
      // 3 usuários a menos (−177) e 30 mil leads a mais (+600)
      mensalidadeCalculada: 999 - 3 * 59 + 30 * 20,
      mensalidade: 800,
    });
  });

  it('personalizado montado item a item e tabela editada', () => {
    const p = planoEfetivo({
      plano: 'personalizado',
      limiteUsuarios: 10,
      limiteLeadsMes: 50000,
      modulos: ['whatsapp'],
      mensalidadeManual: null,
    });
    expect(p.mensalidadeCalculada).toBe(10 * 59 + 50 * 20 + 250);
    const t = tabelaCompleta({ ...TABELA_PADRAO, usuario: 40 });
    expect(
      planoEfetivo(
        { plano: 'start', limiteUsuarios: 4, limiteLeadsMes: null, modulos: [], mensalidadeManual: null },
        t,
      ).mensalidadeCalculada,
    ).toBe(297 + 80);
    expect(tabelaCompleta({ lixo: true })).toEqual(TABELA_PADRAO);
  });

  it('sem plano: sem limite e com todos os módulos', () => {
    expect(
      planoEfetivo({
        plano: null,
        limiteUsuarios: null,
        limiteLeadsMes: null,
        modulos: [],
        mensalidadeManual: null,
      }),
    ).toMatchObject({
      usuarios: null,
      leadsMes: null,
      modulos: ['whatsapp', 'agente_ia', 'email'],
      mensalidade: null,
    });
  });

  it('valida personalizado e o agente sem WhatsApp', () => {
    expect(planoContaEntrada.safeParse({ plano: 'personalizado' }).success).toBe(false);
    expect(planoContaEntrada.safeParse({ plano: 'start', modulos: ['agente_ia'] }).success).toBe(false);
    expect(planoContaEntrada.safeParse({ plano: 'start', modulos: ['agente_ia', 'whatsapp'] }).success).toBe(
      true,
    );
  });
});
