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
    descricao: 'Conversas no CRM, mensagens das sequências e da cadência pelo WhatsApp.',
  },
  agente_ia: {
    nome: 'Agente de IA',
    descricao:
      'A IA aborda, responde, tira dúvidas pela base de conhecimento e marca reunião (usa o WhatsApp).',
  },
  email: {
    nome: 'E-mail automatizado',
    descricao: 'Campanhas e sequências de e-mail com a abertura escrita pela IA, e-mails ilimitados.',
  },
} as const;
export type Modulo = keyof typeof MODULOS;
export const LISTA_MODULOS = Object.keys(MODULOS) as Modulo[];

/**
 * Recursos que mudam de um plano para outro. A base (prospecção, campanhas, enriquecimento, funil,
 * ficha, tarefas, Meu dia e relatórios básicos) vale em todos e não aparece aqui.
 */
export const RECURSOS = {
  equipe: {
    nome: 'Trabalho em equipe',
    descricao: 'Distribuição automática dos leads (rodízio de SDR e closer), metas e "só a própria base".',
  },
  funis: {
    nome: 'Vários funis',
    descricao: 'Mais de um funil (ex.: SDR e Closer), cada um com as suas etapas.',
  },
  cadencia: {
    nome: 'Cadência automática',
    descricao: 'O próximo passo do follow-up é marcado sozinho e quem não responde é encerrado no fim.',
  },
  relatorios: {
    nome: 'Relatórios completos',
    descricao: 'Desempenho de cada pessoa, Radar de negócios em risco e Atividade.',
  },
  reunioes: {
    nome: 'Reuniões por vídeo',
    descricao: 'Sala própria com link para o lead, gravação, transcrição e resumo da IA.',
  },
  rua: {
    nome: 'Vendas na rua',
    descricao: 'Roteiro de visitas no mapa, check-in no celular e painel de visitas.',
  },
  celular: {
    nome: 'Notificações no celular',
    descricao: 'Aviso no celular quando o lead responde ou algo vence.',
  },
  argos: { nome: 'Argos', descricao: 'Assistente por texto e voz que conhece o comercial, com memória.' },
  unidades: {
    nome: 'Várias unidades',
    descricao: 'Organização com várias unidades, painel do gestor e acesso só de leitura para a diretoria.',
  },
  marca: { nome: 'Marca própria', descricao: 'Logo e cor da empresa no sistema e na sala de reunião.' },
  seguranca: {
    nome: 'Auditoria e segurança',
    descricao: 'Registro de tudo o que foi feito e verificação em duas etapas obrigatória.',
  },
} as const;
export type Recurso = keyof typeof RECURSOS;
export const LISTA_RECURSOS = Object.keys(RECURSOS) as Recurso[];

/** Tabela de preços (editável no painel master). */
export interface TabelaPrecos {
  planos: Record<
    PlanoPronto,
    {
      preco: number;
      usuarios: number;
      leadsMes: number;
      /** O que o plano libera além da base. */
      recursos: Recurso[];
      /** Horas de reunião por vídeo no mês (0 = sem reuniões; null = sem limite). */
      horasReuniao: number | null;
      /** Módulos que já vêm no plano (sem cobrar à parte). */
      modulosInclusos: Modulo[];
    }
  >;
  modulos: Record<Modulo, number>;
  /** WhatsApp + Agente de IA juntos (no lugar da soma dos dois). */
  comboWhatsappIa: number;
  /** Números de WhatsApp que vêm com o módulo. */
  numerosInclusos: number;
  /** Cada número de WhatsApp além dos inclusos. */
  numeroExtra: number;
  /** Conversas do Agente de IA por mês (leads diferentes com quem a IA falou; null = sem limite). */
  conversasIaMes: number | null;
  /** Cada usuário a mais (ou a menos) que o plano inclui. */
  usuario: number;
  /** Cada 1.000 leads/mês a mais (ou a menos) que o plano inclui. */
  milLeads: number;
}

const RECURSOS_TIME: Recurso[] = ['equipe', 'funis', 'cadencia', 'relatorios', 'reunioes', 'rua', 'celular'];

export const TABELA_PADRAO: TabelaPrecos = {
  planos: {
    start: { preco: 497, usuarios: 2, leadsMes: 2000, recursos: [], horasReuniao: 0, modulosInclusos: [] },
    time: {
      preco: 1300,
      usuarios: 4,
      leadsMes: 5000,
      recursos: RECURSOS_TIME,
      horasReuniao: 30,
      modulosInclusos: ['email'],
    },
    escala: {
      preco: 2500,
      usuarios: 6,
      leadsMes: 10000,
      recursos: [...LISTA_RECURSOS],
      horasReuniao: null,
      modulosInclusos: ['email'],
    },
  },
  modulos: { whatsapp: 250, agente_ia: 297, email: 200 },
  comboWhatsappIa: 999,
  numerosInclusos: 3,
  numeroExtra: 110,
  conversasIaMes: null,
  usuario: 59,
  milLeads: 20,
};

const numero = (min: number, max: number) => z.number().min(min).max(max);
const inteiro = (min: number, max: number) => z.number().int().min(min).max(max);
const linhaPlano = z.object({
  preco: numero(0, 1_000_000),
  usuarios: inteiro(1, 500),
  leadsMes: inteiro(0, 1_000_000),
  recursos: z.array(z.enum(LISTA_RECURSOS as [Recurso, ...Recurso[]])),
  horasReuniao: inteiro(0, 10_000).nullable(),
  modulosInclusos: z.array(z.enum(['whatsapp', 'agente_ia', 'email'])),
});
export const tabelaPrecosEntrada = z.object({
  planos: z.object({ start: linhaPlano, time: linhaPlano, escala: linhaPlano }),
  modulos: z.object({
    whatsapp: numero(0, 100_000),
    agente_ia: numero(0, 100_000),
    email: numero(0, 100_000),
  }),
  comboWhatsappIa: numero(0, 100_000),
  numerosInclusos: inteiro(0, 100),
  numeroExtra: numero(0, 100_000),
  conversasIaMes: inteiro(0, 1_000_000).nullable(),
  usuario: numero(0, 100_000),
  milLeads: numero(0, 100_000),
});

/**
 * Junta o que veio do banco com a tabela padrão, campo a campo: uma tabela salva antes de existir
 * um campo novo continua valendo e ganha o padrão só no que falta.
 */
export function tabelaCompleta(t: unknown): TabelaPrecos {
  const o = (x: unknown): Record<string, unknown> =>
    x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
  const salvo = o(t);
  const planos = o(salvo.planos);
  const juntado = {
    ...TABELA_PADRAO,
    ...salvo,
    planos: Object.fromEntries(
      PLANOS_PRONTOS.map((p) => [p, { ...TABELA_PADRAO.planos[p], ...o(planos[p]) }]),
    ),
    modulos: { ...TABELA_PADRAO.modulos, ...o(salvo.modulos) },
  };
  const r = tabelaPrecosEntrada.safeParse(juntado);
  return r.success ? r.data : TABELA_PADRAO;
}

export interface PlanoDaConta {
  plano: Plano | null;
  limiteUsuarios: number | null;
  limiteLeadsMes: number | null;
  modulos: string[];
  mensalidadeManual: number | null;
  /** Números de WhatsApp além dos inclusos no módulo. */
  numerosExtras?: number;
  /** Recursos liberados só para esta organização, além do plano. */
  recursosExtras?: string[];
  /** Franquias combinadas só para esta organização (null = a do plano). */
  horasReuniao?: number | null;
  conversasIa?: number | null;
}

export interface PlanoEfetivo {
  plano: Plano | null;
  /** null: sem limite. */
  usuarios: number | null;
  leadsMes: number | null;
  /** Módulos que valem (contratados e inclusos no plano; sem plano: todos). */
  modulos: Modulo[];
  /** Recursos liberados (sem plano: todos). */
  recursos: Recurso[];
  /** Números de WhatsApp que pode conectar (null: sem limite; 0: sem o módulo). */
  numerosWhatsapp: number | null;
  numerosExtras: number;
  /** Horas de reunião por vídeo no mês (null: sem limite). */
  horasReuniao: number | null;
  /** Conversas do Agente de IA no mês (null: sem limite; 0: sem o módulo). */
  conversasIa: number | null;
  /** Quanto custa no mês, item a item (ajuste para menos entra negativo). */
  itens: { rotulo: string; valor: number }[];
  mensalidadeCalculada: number | null;
  mensalidade: number | null;
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const milhares = (n: number) => n.toLocaleString('pt-BR');

/** O plano pronto mais barato que tem o recurso (para a tela dizer "a partir do plano X"). */
export function planoQueLibera(r: Recurso, tabela: TabelaPrecos = TABELA_PADRAO): PlanoPronto | null {
  return PLANOS_PRONTOS.find((p) => tabela.planos[p].recursos.includes(r)) ?? null;
}

/**
 * O que vale para a conta e quanto custa. Planos prontos: o preço do plano mais (ou menos) cada
 * usuário e cada 1.000 leads de diferença, mais os módulos (WhatsApp + IA juntos saem pelo combo;
 * os inclusos no plano não cobram) e os números de WhatsApp extras. Personalizado: montado item a
 * item. Em todos, a mensalidade combinada substitui a calculada.
 */
export function planoEfetivo(c: PlanoDaConta, tabela: TabelaPrecos = TABELA_PADRAO): PlanoEfetivo {
  if (!c.plano)
    return {
      plano: null,
      usuarios: null,
      leadsMes: null,
      modulos: [...LISTA_MODULOS],
      recursos: [...LISTA_RECURSOS],
      numerosWhatsapp: null,
      numerosExtras: 0,
      horasReuniao: null,
      conversasIa: null,
      itens: [],
      mensalidadeCalculada: null,
      mensalidade: null,
    };
  const pronto = c.plano === 'personalizado' ? null : tabela.planos[c.plano];
  const inclusos = pronto?.modulosInclusos ?? [];
  const modulos = LISTA_MODULOS.filter((m) => c.modulos.includes(m) || inclusos.includes(m));
  const extras = (c.recursosExtras ?? []).filter((r): r is Recurso =>
    (LISTA_RECURSOS as string[]).includes(r),
  );
  const recursos = LISTA_RECURSOS.filter((r) => pronto?.recursos.includes(r) || extras.includes(r));
  const itens: { rotulo: string; valor: number }[] = [];
  let usuarios: number;
  let leadsMes: number;
  if (!pronto) {
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
    usuarios = c.limiteUsuarios ?? pronto.usuarios;
    leadsMes = c.limiteLeadsMes ?? pronto.leadsMes;
    itens.push({ rotulo: `Plano ${NOME_PLANO[c.plano]}`, valor: pronto.preco });
    const difUsuarios = usuarios - pronto.usuarios;
    if (difUsuarios)
      itens.push({
        rotulo:
          difUsuarios > 0
            ? `${plural(difUsuarios, 'usuário adicional', 'usuários adicionais')}`
            : `${plural(-difUsuarios, 'usuário a menos', 'usuários a menos')}`,
        valor: difUsuarios * tabela.usuario,
      });
    const difLeads = leadsMes - pronto.leadsMes;
    if (difLeads)
      itens.push({
        rotulo:
          difLeads > 0
            ? `${milhares(difLeads)} leads/mês a mais`
            : `${milhares(-difLeads)} leads/mês a menos`,
        valor: Math.sign(difLeads) * Math.ceil(Math.abs(difLeads) / 1000) * tabela.milLeads,
      });
  }
  const pagos = modulos.filter((m) => !inclusos.includes(m));
  const combo = pagos.includes('whatsapp') && pagos.includes('agente_ia');
  if (combo) itens.push({ rotulo: 'WhatsApp + Agente de IA', valor: tabela.comboWhatsappIa });
  for (const m of pagos) {
    if (combo && (m === 'whatsapp' || m === 'agente_ia')) continue;
    itens.push({ rotulo: MODULOS[m].nome, valor: tabela.modulos[m] });
  }
  for (const m of modulos.filter((x) => inclusos.includes(x)))
    itens.push({ rotulo: `${MODULOS[m].nome} (incluso no plano)`, valor: 0 });
  const temWhatsapp = modulos.includes('whatsapp');
  const numerosExtras = temWhatsapp ? Math.max(0, Math.trunc(c.numerosExtras ?? 0)) : 0;
  if (numerosExtras)
    itens.push({
      rotulo: plural(numerosExtras, 'número de WhatsApp extra', 'números de WhatsApp extras'),
      valor: numerosExtras * tabela.numeroExtra,
    });
  const mensalidadeCalculada = Math.max(
    0,
    itens.reduce((s, i) => s + i.valor, 0),
  );
  return {
    plano: c.plano,
    usuarios,
    leadsMes,
    modulos,
    recursos,
    numerosWhatsapp: temWhatsapp ? tabela.numerosInclusos + numerosExtras : 0,
    numerosExtras,
    horasReuniao: !recursos.includes('reunioes')
      ? 0
      : c.horasReuniao != null
        ? c.horasReuniao
        : pronto
          ? pronto.horasReuniao
          : 0,
    conversasIa: modulos.includes('agente_ia') ? (c.conversasIa ?? tabela.conversasIaMes) : 0,
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
    /** Números de WhatsApp além dos inclusos no módulo. */
    numerosExtras: z.number().int().min(0).max(200).default(0),
    /** Recursos liberados só para esta organização, além do plano. */
    recursosExtras: z
      .array(z.enum(LISTA_RECURSOS as [Recurso, ...Recurso[]]))
      .max(20)
      .default([]),
    /** Franquias combinadas só para esta organização (null = a do plano). */
    horasReuniao: z.number().int().min(0).max(10_000).nullable().default(null),
    conversasIa: z.number().int().min(0).max(1_000_000).nullable().default(null),
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
