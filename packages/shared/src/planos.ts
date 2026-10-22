import { z } from 'zod';

/**
 * Planos e módulos do Prospect Team. O plano dá os números de partida; cada conta pode ter os
 * próprios (mais ou menos usuários e leads) e os módulos que contratou. Conta sem plano não tem
 * limite nem trava (a conta principal e as que existiam antes dos planos).
 */

export const PLANOS = {
  start: { nome: 'Start', preco: 297, usuarios: 2, leadsMes: 5000 },
  time: { nome: 'Time', preco: 499, usuarios: 4, leadsMes: 15000 },
  escala: { nome: 'Escala', preco: 999, usuarios: 6, leadsMes: 25000 },
  personalizado: { nome: 'Personalizado', preco: 0, usuarios: 1, leadsMes: 0 },
} as const;
export type Plano = keyof typeof PLANOS;
export const LISTA_PLANOS = Object.keys(PLANOS) as Plano[];

export const MODULOS = {
  whatsapp: {
    nome: 'WhatsApp integrado',
    preco: 250,
    descricao: 'Conversas no CRM, chips, mensagens das sequências e da cadência pelo WhatsApp.',
  },
  agente_ia: {
    nome: 'Agente de IA',
    preco: 150,
    descricao: 'A IA aborda, responde, tira dúvidas pela base de conhecimento e marca reunião.',
  },
  email: {
    nome: 'E-mail automatizado',
    preco: 200,
    descricao: 'Campanhas e sequências de e-mail com a abertura escrita pela IA, e-mails ilimitados.',
  },
} as const;
export type Modulo = keyof typeof MODULOS;
export const LISTA_MODULOS = Object.keys(MODULOS) as Modulo[];

/** Cada usuário além do que o plano inclui. */
export const PRECO_USUARIO_ADICIONAL = 59;

export interface PlanoDaConta {
  plano: Plano | null;
  limiteUsuarios: number | null;
  limiteLeadsMes: number | null;
  modulos: string[];
  mensalidadeManual: number | null;
}

export interface PlanoEfetivo {
  plano: Plano | null;
  /** null: sem limite. */
  usuarios: number | null;
  leadsMes: number | null;
  /** Módulos que valem (sem plano: todos). */
  modulos: Modulo[];
  /** Quanto custa no mês, item a item, e o total (null: sem plano). */
  itens: { rotulo: string; valor: number }[];
  mensalidadeCalculada: number | null;
  mensalidade: number | null;
}

/** O que vale para a conta: os números do plano com o que foi trocado só para ela, e o preço. */
export function planoEfetivo(c: PlanoDaConta): PlanoEfetivo {
  if (!c.plano)
    return {
      plano: null,
      usuarios: null,
      leadsMes: null,
      modulos: [...LISTA_MODULOS],
      itens: [],
      mensalidadeCalculada: null,
      mensalidade: null,
    };
  const p = PLANOS[c.plano];
  const usuarios = c.limiteUsuarios ?? p.usuarios;
  const leadsMes = c.limiteLeadsMes ?? p.leadsMes;
  const modulos = LISTA_MODULOS.filter((m) => c.modulos.includes(m));
  const itens: { rotulo: string; valor: number }[] = [];
  if (c.plano !== 'personalizado') {
    itens.push({ rotulo: `Plano ${p.nome}`, valor: p.preco });
    const extras = Math.max(0, usuarios - p.usuarios);
    if (extras)
      itens.push({
        rotulo: `${extras} usuário${extras > 1 ? 's' : ''} adicional${extras > 1 ? 'is' : ''}`,
        valor: extras * PRECO_USUARIO_ADICIONAL,
      });
    for (const m of modulos) itens.push({ rotulo: MODULOS[m].nome, valor: MODULOS[m].preco });
  }
  const mensalidadeCalculada = itens.reduce((s, i) => s + i.valor, 0);
  return {
    plano: c.plano,
    usuarios,
    leadsMes,
    modulos,
    itens,
    mensalidadeCalculada,
    mensalidade: c.mensalidadeManual ?? (c.plano === 'personalizado' ? null : mensalidadeCalculada),
  };
}

/** Painel master: plano, números próprios da conta, módulos e mensalidade combinada. */
export const planoContaEntrada = z
  .object({
    plano: z.enum(['start', 'time', 'escala', 'personalizado']).nullable(),
    limiteUsuarios: z.number().int().min(1).max(500).nullable().default(null),
    limiteLeadsMes: z.number().int().min(0).max(1_000_000).nullable().default(null),
    modulos: z
      .array(z.enum(['whatsapp', 'agente_ia', 'email']))
      .max(3)
      .default([]),
    mensalidadeManual: z.number().min(0).max(1_000_000).nullable().default(null),
  })
  .refine((v) => v.plano !== 'personalizado' || (v.limiteUsuarios != null && v.limiteLeadsMes != null), {
    message: 'No plano personalizado, informe o número de usuários e de leads por mês.',
    path: ['limiteUsuarios'],
  })
  .refine((v) => !v.modulos.includes('agente_ia') || v.modulos.includes('whatsapp'), {
    message: 'O Agente de IA conversa pelo WhatsApp: ligue também o módulo WhatsApp.',
    path: ['modulos'],
  });
export type PlanoContaEntrada = z.infer<typeof planoContaEntrada>;
