import { describe, expect, it } from 'vitest';
import {
  LISTA_RECURSOS,
  planoContaEntrada,
  planoEfetivo,
  planoQueLibera,
  TABELA_PADRAO,
  tabelaCompleta,
} from '../src/planos.js';

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
    // O e-mail já vem no Time: não cobra.
    expect(p.mensalidadeCalculada).toBe(1300 + 2 * 59 + 250);
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
      mensalidadeCalculada: 2500 - 3 * 59 + 30 * 20,
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
    ).toBe(497 + 80);
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

  it('recursos por plano, liberados à parte e o plano que libera', () => {
    const base = { limiteUsuarios: null, limiteLeadsMes: null, modulos: [], mensalidadeManual: null };
    expect(planoEfetivo({ plano: 'start', ...base }).recursos).toEqual([]);
    const time = planoEfetivo({ plano: 'time', ...base });
    expect(time.recursos).toContain('reunioes');
    expect(time.recursos).not.toContain('argos');
    expect(time.horasReuniao).toBe(30);
    expect(time.modulos).toEqual(['email']);
    // Escala: reuniões sem limite.
    expect(planoEfetivo({ plano: 'escala', ...base }).horasReuniao).toBeNull();
    expect(planoEfetivo({ plano: 'escala', ...base }).recursos).toEqual(LISTA_RECURSOS);
    // Liberado só para este cliente (sem mudar o plano), com a franquia combinada.
    const start = planoEfetivo({
      plano: 'start',
      ...base,
      recursosExtras: ['rua', 'reunioes'],
      horasReuniao: 5,
    });
    expect(start.recursos).toEqual(['reunioes', 'rua']);
    expect(start.horasReuniao).toBe(5);
    expect(planoQueLibera('equipe')).toBe('time');
    expect(planoQueLibera('argos')).toBe('escala');
    // Sem plano: tudo, sem limite.
    expect(planoEfetivo({ plano: null, ...base })).toMatchObject({
      numerosWhatsapp: null,
      horasReuniao: null,
    });
  });

  it('WhatsApp + IA pelo combo, números extras e e-mail incluso a partir do Time', () => {
    const base = { limiteUsuarios: null, limiteLeadsMes: null, mensalidadeManual: null };
    const p = planoEfetivo({ plano: 'start', ...base, modulos: ['whatsapp', 'agente_ia'], numerosExtras: 3 });
    expect(p.itens).toEqual([
      { rotulo: 'Plano Start', valor: 497 },
      { rotulo: 'WhatsApp + Agente de IA', valor: 999 },
      { rotulo: '3 números de WhatsApp extras', valor: 330 },
    ]);
    // 3 números no módulo + 3 extras; conversas da IA sem limite.
    expect(p).toMatchObject({ numerosWhatsapp: 6, conversasIa: null, mensalidadeCalculada: 497 + 999 + 330 });
    // Limite de conversas combinado só para um cliente.
    expect(
      planoEfetivo({ plano: 'start', ...base, modulos: ['whatsapp', 'agente_ia'], conversasIa: 500 })
        .conversasIa,
    ).toBe(500);
    // Só o WhatsApp (contas antigas): 3 números, sem conversas da IA.
    expect(planoEfetivo({ plano: 'time', ...base, modulos: ['whatsapp'] })).toMatchObject({
      numerosWhatsapp: 3,
      conversasIa: 0,
      mensalidadeCalculada: 1300 + 250,
    });
    // Sem WhatsApp, número extra não vale nem cobra.
    expect(planoEfetivo({ plano: 'time', ...base, modulos: [], numerosExtras: 2 })).toMatchObject({
      numerosWhatsapp: 0,
      mensalidadeCalculada: 1300,
    });
    // Escala: o e-mail já vem no plano.
    const e = planoEfetivo({ plano: 'escala', ...base, modulos: [] });
    expect(e.modulos).toEqual(['email']);
    expect(e.mensalidadeCalculada).toBe(2500);
  });

  it('tabela salva antes dos campos novos ganha o padrão só no que falta', () => {
    const antiga = {
      planos: {
        start: { preco: 297, usuarios: 2, leadsMes: 2000 },
        time: { preco: 650, usuarios: 4, leadsMes: 5000 },
        escala: { preco: 999, usuarios: 6, leadsMes: 10000 },
      },
      modulos: { whatsapp: 250, agente_ia: 150, email: 200 },
      usuario: 59,
      milLeads: 20,
    };
    const t = tabelaCompleta(antiga);
    expect(t.planos.time.preco).toBe(650);
    expect(t.planos.time.recursos).toEqual(TABELA_PADRAO.planos.time.recursos);
    expect(t.modulos.agente_ia).toBe(150);
    expect(t.numeroExtra).toBe(110);
  });
});
