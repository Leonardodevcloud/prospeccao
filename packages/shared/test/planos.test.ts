import { describe, expect, it } from 'vitest';
import { planoContaEntrada, planoEfetivo } from '../src/planos.js';

describe('planos', () => {
  it('números do plano, trocados só para a conta, e o preço', () => {
    const p = planoEfetivo({
      plano: 'time',
      limiteUsuarios: 6,
      limiteLeadsMes: null,
      modulos: ['whatsapp', 'email'],
      mensalidadeManual: null,
    });
    expect(p).toMatchObject({ usuarios: 6, leadsMes: 15000, modulos: ['whatsapp', 'email'] });
    expect(p.mensalidadeCalculada).toBe(499 + 2 * 59 + 250 + 200);
    expect(p.mensalidade).toBe(p.mensalidadeCalculada);
    // Menos usuários que o plano não dá desconto automático; o preço combinado vale.
    expect(
      planoEfetivo({
        plano: 'escala',
        limiteUsuarios: 3,
        limiteLeadsMes: 40000,
        modulos: [],
        mensalidadeManual: 800,
      }),
    ).toMatchObject({ usuarios: 3, leadsMes: 40000, mensalidadeCalculada: 999, mensalidade: 800 });
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
