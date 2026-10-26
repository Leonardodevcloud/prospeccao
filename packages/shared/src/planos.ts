import { z } from 'zod';

/**
 * Planos e módulos do Prospect Team. O plano dá os números de partida; cada conta pode ter os
 * próprios (mais ou menos usuários e leads) e os módulos que contratou, e o preço acompanha. A
 * tabela de preços é editável no painel master; aqui ficam os valores de partida. Conta sem plano
 * não tem limite nem trava (a conta principal e as que existiam antes dos planos).
 */

export type Plano = 'start' | 'time' | 'escala' | 'personalizado';
export const LISTA_PLANOS: Plano[] = ['start', 'time', 'escala', 'personalizado'];
export type PlanoPronto = Exclude<Plano, 'personalizado'>;
export const PLANOS_PRONTOS: PlanoPronto[] = ['start', 'time', 'escala'];

export const NOME_PLANO: Record<Plano, string> = {
  start: 'Start',
  time: 'Time',
  escala: 'Escala',
  personalizado: 'Personalizado',
};

export const MODULOS = {
  whatsapp: {
    nome: 'WhatsApp integrado',
    descricao: 'Conversas no CRM, chips, mensagens das sequências e da cadência pelo WhatsApp.',
  },
  agente_ia: {
    nome: 'Agente de IA',
    descricao: 'A IA aborda, responde, tira dúvidas pela base de conhecimento e marca reunião.',
  },
  email: {
    nome: 'E-mail automatizado',
    descricao: 'Campanhas e sequências de e-mail com a abertura escrita pela IA, e-mails ilimitados.',
  },
} as const;
export type Modulo = keyof typeof MODULOS;
export const LISTA_MODULOS = Object.keys(MODULOS) as Modulo[];

/** Tabela de preços (editável no painel master). */
export interface TabelaPrecos {
  planos: Record<PlanoPronto, { preco: number; usuarios: number; leadsMes: number }>;
  modulos: Record<Modulo, number>;
  /** Cada usuário a mais (ou a menos) que o plano inclui. */
  usuario: number;
  /** Cada 1.000 leads/mês a mais (ou a menos) que o plano inclui. */
  milLeads: number;
}

export const TABELA_PADRAO: TabelaPrecos = {
  planos: {
    start: { preco: 297, usuarios: 2, leadsMes: 2000 },
    time: { preco: 599, usuarios: 4, leadsMes: 5000 },
    escala: { preco: 999, usuarios: 6, leadsMes: 10000 },
  },
  modulos: { whatsapp: 250, agente_ia: 150, email: 200 },
  usuario: 59,
  milLeads: 20,
};

const numero = (min: number, max: number) => z.number().min(min).max(max);
const linhaPlano = z.object({
  preco: numero(0, 1_000_000),
  usuarios: z.number().int().min(1).max(500),
  leadsMes: z.number().int().min(0).max(1_000_000),
});
export const tabelaPrecosEntrada = z.object({
  planos: z.object({ start: linhaPlano, time: linhaPlano, escala: linhaPlano }),
  modulos: z.object({
    whatsapp: numero(0, 100_000),
    agente_ia: numero(0, 100_000),
    email: numero(0, 100_000),
  }),
  usuario: numero(0, 100_000),
  milLeads: numero(0, 100_000),
});

/** Junta o que veio do banco com a tabela padrão (campo faltando = padrão). */
export function tabelaCompleta(t: unknown): TabelaPrecos {
  const r = tabelaPrecosEntrada.safeParse(t);
  return r.success ? r.data : TABELA_PADRAO;
}

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
  /** Quanto custa no mês, item a item (ajuste para menos entra negativo). */
  itens: { rotulo: string; valor: number }[];
  mensalidadeCalculada: number | null;
  mensalidade: number | null;
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const milhares = (n: number) => n.toLocaleString('pt-BR');

/**
 * O que vale para a conta e quanto custa. Planos prontos: o preço do plano mais (ou menos) cada
 * usuário e cada 1.000 leads de diferença, mais os módulos. Personalizado: montado item a item
 * (usuários, leads, módulos). Em todos, a mensalidade combinada substitui a calculada.
 */
export function planoEfetivo(c: PlanoDaConta, tabela: TabelaPrecos = TABELA_PADRAO): PlanoEfetivo {
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
  const modulos = LISTA_MODULOS.filter((m) => c.modulos.includes(m));
  const itens: { rotulo: string; valor: number }[] = [];
  let usuarios: number;
  let leadsMes: number;
  if (c.plano === 'personalizado') {
    usuarios = c.limiteUsuarios ?? 1;
    leadsMes = c.limiteLeadsMes ?? 0;
    itens.push({
      rotulo: plural(usuarios, 'usuário', 'usuários'),
      valor: usuarios * tabela.usuario,
    });
    if (leadsMes)
      itens.push({
        rotulo: `${milhares(leadsMes)} leads/mês`,
        valor: Math.ceil(leadsMes / 1000) * tabela.milLeads,
      });
  } else {
    const p = tabela.planos[c.plano];
    usuarios = c.limiteUsuarios ?? p.usuarios;
    leadsMes = c.limiteLeadsMes ?? p.leadsMes;
    itens.push({ rotulo: `Plano ${NOME_PLANO[c.plano]}`, valor: p.preco });
    const difUsuarios = usuarios - p.usuarios;
    if (difUsuarios)
      itens.push({
        rotulo:
          difUsuarios > 0
            ? `${plural(difUsuarios, 'usuário adicional', 'usuários adicionais')}`
            : `${plural(-difUsuarios, 'usuário a menos', 'usuários a menos')}`,
        valor: difUsuarios * tabela.usuario,
      });
    const difLeads = leadsMes - p.leadsMes;
    if (difLeads)
      itens.push({
        rotulo:
          difLeads > 0
            ? `${milhares(difLeads)} leads/mês a mais`
            : `${milhares(-difLeads)} leads/mês a menos`,
        valor: Math.sign(difLeads) * Math.ceil(Math.abs(difLeads) / 1000) * tabela.milLeads,
      });
  }
  for (const m of modulos) itens.push({ rotulo: MODULOS[m].nome, valor: tabela.modulos[m] });
  const mensalidadeCalculada = Math.max(
    0,
    itens.reduce((s, i) => s + i.valor, 0),
  );
  return {
    plano: c.plano,
    usuarios,
    leadsMes,
    modulos,
    itens,
    mensalidadeCalculada,
    mensalidade: c.mensalidadeManual ?? mensalidadeCalculada,
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
