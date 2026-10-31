import { z } from 'zod';
import { ehCelular, normalizarTelefone } from './normalizar.js';
import { INTERESSES_REUNIAO, TIPOS_DESTAQUE } from './reunioes.js';

/**
 * Ligações pelo CRM: quem liga e fala é sempre o comercial (pelo navegador, com o número da
 * empresa). Depois que desliga, a IA transcreve e resume: o que foi dito, o clima da conversa e o
 * que fazer no lead (mover etapa, marcar reunião, contato novo, número certo ou errado).
 */

/* ───────────────────────────── Resultado ───────────────────────────── */

export const RESULTADOS_LIGACAO = [
  'conversou',
  'nao_atendeu',
  'caixa_postal',
  'ocupado',
  'numero_errado',
  'nao_ligar',
] as const;
export type ResultadoLigacao = (typeof RESULTADOS_LIGACAO)[number];

export const ROTULO_RESULTADO_LIGACAO: Record<ResultadoLigacao, string> = {
  conversou: 'Conversou',
  nao_atendeu: 'Não atendeu',
  caixa_postal: 'Caixa postal',
  ocupado: 'Ocupado',
  numero_errado: 'Número errado',
  nao_ligar: 'Não ligar mais',
};

/** Resultados em que ninguém do lado de lá conversou (tentar de novo depois, no próximo número). */
export const SEM_CONVERSA: ReadonlySet<ResultadoLigacao> = new Set([
  'nao_atendeu',
  'caixa_postal',
  'ocupado',
]);

/* ───────────────────────────── Números do lead ───────────────────────────── */

export type OrigemTelefone = 'contato' | 'whatsapp' | 'enriquecimento' | 'google' | 'receita' | 'manual';

export interface TelefoneBruto {
  numero: string;
  origem: OrigemTelefone;
  /** "Fernanda · sócia", "Site da clínica"… */
  rotulo?: string | null;
  /** O enriquecimento marcou como principal. */
  principal?: boolean;
  /** Tem WhatsApp conferido. */
  whatsapp?: boolean | null;
  /** Alguém do time marcou como errado. */
  errado?: boolean;
  /** Atendeu e conversou numa ligação (ou o time confirmou). */
  confirmado?: boolean;
  /** A última tentativa por este número. */
  ultimaEm?: string | null;
  ultimoResultado?: ResultadoLigacao | null;
  tentativas?: number;
}

export interface TelefoneParaLigar {
  numero: string;
  tipo: 'celular' | 'fixo';
  /** Ordem em que o CRM tenta (1 = o primeiro); null = errado, fora da lista. */
  ordem: number | null;
  rotulo: string;
  origens: OrigemTelefone[];
  whatsapp: boolean;
  confirmado: boolean;
  errado: boolean;
  ultimaEm: string | null;
  ultimoResultado: ResultadoLigacao | null;
  tentativas: number;
}

const NOME_ORIGEM: Record<OrigemTelefone, string> = {
  contato: 'Pessoa da negociação',
  whatsapp: 'WhatsApp',
  enriquecimento: 'Enriquecimento',
  google: 'Google',
  receita: 'Receita Federal',
  manual: 'Cadastrado à mão',
};

/** Mesmo número com ou sem o 9 da frente: DDD + os 8 últimos. */
export const chaveTelefone = (n: string) => `${n.slice(0, 2)}${n.slice(-8)}`;

/**
 * Junta os números do lead (o mesmo número de várias fontes vira um) e põe na ordem de ligar:
 * confirmado pelo time ou com WhatsApp primeiro, depois o principal, celular antes de fixo; quem
 * acabou de não atender vai para o fim da fila (a próxima tentativa é no número seguinte). Número
 * errado sai da lista (fica no fim, sem ordem).
 */
export function ordenarTelefones(brutos: TelefoneBruto[]): TelefoneParaLigar[] {
  const porChave = new Map<string, TelefoneParaLigar & { principal: boolean }>();
  for (const b of brutos) {
    const numero = normalizarTelefone(b.numero);
    if (!numero) continue;
    const chave = chaveTelefone(numero);
    const atual = porChave.get(chave);
    if (!atual) {
      porChave.set(chave, {
        numero,
        tipo: ehCelular(numero) ? 'celular' : 'fixo',
        ordem: null,
        rotulo: b.rotulo?.trim() || NOME_ORIGEM[b.origem],
        origens: [b.origem],
        whatsapp: !!b.whatsapp || b.origem === 'whatsapp',
        confirmado: !!b.confirmado,
        errado: !!b.errado,
        ultimaEm: b.ultimaEm ?? null,
        ultimoResultado: b.ultimoResultado ?? null,
        tentativas: b.tentativas ?? 0,
        principal: !!b.principal,
      });
      continue;
    }
    if (!atual.origens.includes(b.origem)) atual.origens.push(b.origem);
    // A pessoa da negociação dá o melhor nome; o 11 dígitos (com o 9) é o certo.
    if (b.origem === 'contato' && b.rotulo) atual.rotulo = b.rotulo;
    if (numero.length > atual.numero.length) atual.numero = numero;
    atual.whatsapp ||= !!b.whatsapp || b.origem === 'whatsapp';
    atual.confirmado ||= !!b.confirmado;
    atual.errado ||= !!b.errado;
    atual.principal ||= !!b.principal;
    if (b.ultimaEm && (!atual.ultimaEm || b.ultimaEm > atual.ultimaEm)) {
      atual.ultimaEm = b.ultimaEm;
      atual.ultimoResultado = b.ultimoResultado ?? atual.ultimoResultado;
    }
    atual.tentativas = Math.max(atual.tentativas, b.tentativas ?? 0);
  }
  const lista = [...porChave.values()];
  const peso = (t: (typeof lista)[number]) => {
    let p = 0;
    if (t.confirmado) p += 100;
    if (t.whatsapp) p += 40;
    if (t.origens.includes('contato')) p += 30;
    if (t.principal) p += 20;
    if (t.tipo === 'celular') p += 10;
    if (t.origens.length > 1) p += 5;
    // Acabou de não atender por este número: tenta os outros antes.
    if (t.ultimoResultado && SEM_CONVERSA.has(t.ultimoResultado)) p -= 60;
    return p;
  };
  lista.sort((a, b) => Number(a.errado) - Number(b.errado) || peso(b) - peso(a));
  let ordem = 1;
  return lista.map(({ principal: _p, ...t }) => ({ ...t, ordem: t.errado ? null : ordem++ }));
}

/* ───────────────────────────── Entradas da api ───────────────────────────── */

const telefone = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const n = normalizarTelefone(v);
    if (!n) {
      ctx.addIssue({ code: 'custom', message: 'Telefone inválido: use DDD + número.' });
      return z.NEVER;
    }
    return n;
  });

/** Começar uma ligação para um número do lead (ou um número avulso, sem lead). */
export const iniciarLigacaoEntrada = z.object({
  empresaId: z.number().int().positive().nullable().default(null),
  telefone,
  /** Ligação da lista de ligação (o item reservado em "próximo"). */
  listaItemId: z.number().int().positive().nullish(),
});
export type IniciarLigacaoEntrada = z.infer<typeof iniciarLigacaoEntrada>;

/** O navegador conta o que o LiveKit viu: tocou, atendeu, terminou. */
export const estadoLigacaoEntrada = z.object({
  evento: z.enum(['tocando', 'atendeu', 'encerrou', 'falhou']),
  motivo: z.string().trim().max(200).nullish(),
});

/** "Como foi?": o resultado e o que aplicar no lead. */
export const resultadoLigacaoEntrada = z.object({
  resultado: z.enum(RESULTADOS_LIGACAO),
  nota: z.string().trim().max(4000).nullish(),
  /** Mover para esta etapa do funil (id da etapa do pipeline). */
  etapaId: z.number().int().positive().nullish(),
  /** Motivo, quando a etapa é perdido. */
  motivo: z.string().trim().max(300).nullish(),
  /** Marcar reunião (com sala de vídeo do sistema). */
  reuniao: z
    .object({
      inicio: z
        .string()
        .datetime({ offset: true })
        .transform((v) => new Date(v).toISOString()),
      sala: z.boolean().default(true),
    })
    .nullish(),
  /** Contatos que a IA ouviu na conversa e a pessoa confirmou. */
  contatos: z
    .array(
      z.object({
        nome: z.string().trim().min(1).max(120),
        cargo: z.string().trim().max(80).nullish(),
        telefone: z.string().trim().max(30).nullish(),
        decisor: z.boolean().default(false),
      }),
    )
    .max(5)
    .default([]),
  /** Próximo passo (tarefa de retorno), quando não conversou. */
  retornarEm: z
    .string()
    .datetime({ offset: true })
    .transform((v) => new Date(v).toISOString())
    .nullish(),
});
export type ResultadoLigacaoEntrada = z.infer<typeof resultadoLigacaoEntrada>;

/** Gestão › Telefonia (administrador da conta). */
export const telefoniaConfigEntrada = z.object({
  gravar: z.boolean(),
  avisoGravacao: z.string().trim().min(10).max(300),
  /** Toca o aviso com voz no começo da ligação (senão, o comercial lê). */
  avisoFalado: z.boolean(),
  transcrever: z.boolean(),
  /** Quanto tempo deixa tocar antes de desistir. */
  toqueSegundos: z.number().int().min(10).max(60),
  /** Ligar com o número do mesmo DDD do lead, quando houver. */
  mesmoDdd: z.boolean(),
  guardarMeses: z.number().int().min(1).max(60),
  /** Receber ligações nos números da empresa pelo CRM. */
  receber: z.boolean(),
  /** Segundos tocando só para o dono do lead antes de tocar para o time. */
  toqueDono: z.number().int().min(0).max(60),
  /** Segundos tocando no CRM antes de ir para o celular (siga-me) ou virar perdida. */
  toqueEntrada: z.number().int().min(15).max(120),
  /** Ninguém atendeu no CRM: toca no celular do dono do lead (o cadastrado na Equipe). */
  sigaMe: z.boolean(),
});
export type TelefoniaConfigEntrada = z.infer<typeof telefoniaConfigEntrada>;

export const TELEFONIA_PADRAO: TelefoniaConfigEntrada = {
  gravar: true,
  avisoGravacao: 'Esta ligação pode ser gravada para melhorar o nosso atendimento.',
  avisoFalado: true,
  transcrever: true,
  toqueSegundos: 25,
  mesmoDdd: true,
  guardarMeses: 12,
  receber: true,
  toqueDono: 20,
  toqueEntrada: 40,
  sigaMe: true,
};

/* ───────────────────────────── Lista de ligação ───────────────────────────── */

export const listaLigacaoEntrada = z.object({
  nome: z.string().trim().max(120).nullish(),
  empresaIds: z.array(z.number().int().positive()).min(1, 'Escolha ao menos um lead.').max(200),
  /** 1: um de cada vez; 2 ou 3: em paralelo (o primeiro que atende vem para você). */
  linhas: z.number().int().min(1).max(3).default(1),
  /** Não atendeu: põe o lead de novo no fim da lista com o próximo número dele. */
  tentarProximo: z.boolean().default(true),
  /** Pausa entre uma ligação e a próxima (para anotar). */
  pausaSegundos: z.number().int().min(0).max(120).default(10),
});
export type ListaLigacaoEntrada = z.infer<typeof listaLigacaoEntrada>;

/** Máximo de vezes que o mesmo lead entra na lista (um número diferente a cada vez). */
export const MAX_TENTATIVAS_LISTA = 3;

/**
 * Horário de ligar para lead (a lista não disca fora dele): segunda a sexta das 8h às 20h e sábado
 * das 8h às 14h, no horário de Brasília. Ligação avulsa pela ficha não tem trava (o comercial decide).
 */
export function horarioDeLigar(agora: Date = new Date()): boolean {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(agora);
  const dia = p.find((x) => x.type === 'weekday')?.value ?? '';
  const hora = Number(p.find((x) => x.type === 'hour')?.value ?? 0);
  if (dia === 'Sun') return false;
  if (dia === 'Sat') return hora >= 8 && hora < 14;
  return hora >= 8 && hora < 20;
}

export const HORARIO_DE_LIGAR = 'segunda a sexta, das 8h às 20h, e sábado, das 8h às 14h';

/** Painel master: número da empresa (comprado no provedor e ligado ao LiveKit). */
export const numeroEmpresaEntrada = z.object({
  numero: telefone,
  rotulo: z.string().trim().max(60).nullish(),
  principal: z.boolean().default(false),
});

/* ───────────────────────────── Resumo da IA ───────────────────────────── */

export const CLIMAS_LIGACAO = ['positivo', 'neutro', 'negativo'] as const;
export type ClimaLigacao = (typeof CLIMAS_LIGACAO)[number];
export const ROTULO_CLIMA: Record<ClimaLigacao, string> = {
  positivo: 'Clima bom',
  neutro: 'Clima neutro',
  negativo: 'Clima ruim',
};

export const ETAPAS_LIGACAO = ['respondeu', 'reuniao', 'proposta', 'ganho', 'perdido'] as const;

const curto = (max: number) => z.string().trim().max(max);

export const resumoLigacao = z.object({
  resumo: curto(1200),
  /** Se alguém atendeu e conversou (a IA ouviu outra voz além do comercial). */
  conversou: z.boolean().catch(true),
  caixaPostal: z.boolean().catch(false),
  clima: z.enum(CLIMAS_LIGACAO).catch('neutro'),
  /** Uma frase sobre o sentimento: "Receptiva, mas com pressa", "Irritado com a insistência". */
  sentimento: curto(200).nullable().catch(null),
  interesse: z.enum(INTERESSES_REUNIAO).catch('indefinido'),
  destaques: z
    .array(z.object({ tipo: z.enum(TIPOS_DESTAQUE).catch('outro'), texto: curto(200) }))
    .max(8)
    .catch([]),
  proximoPasso: curto(240).nullable().catch(null),
  sugestaoEtapa: z.enum(ETAPAS_LIGACAO).nullable().catch(null),
  /** Reunião combinada na ligação (data e hora como ISO, no fuso de Brasília). */
  reuniao: z
    .object({
      inicio: z.string().datetime({ offset: true }).nullable().catch(null),
      texto: curto(120),
    })
    .nullable()
    .catch(null),
  /** Pessoas citadas que não estavam no lead (quem decide, quem cuida das compras…). */
  contatos: z
    .array(
      z.object({
        nome: curto(120).min(1),
        cargo: curto(80).nullable().catch(null),
        telefone: curto(30).nullable().catch(null),
        decisor: z.boolean().catch(false),
      }),
    )
    .max(5)
    .catch([]),
  /** Falou com a pessoa ou a empresa certa? (false: "não é aqui", número de outra pessoa). */
  numeroCerto: z.boolean().nullable().catch(null),
});
export type ResumoLigacao = z.infer<typeof resumoLigacao>;

/* ───────────────────────────── Formatos ───────────────────────────── */

/** 372 → "6 min 12 s"; 45 → "45 s". */
export function fmtDuracaoLigacao(segundos: number | null | undefined): string {
  const s = Math.max(0, Math.round(segundos ?? 0));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r ? `${m} min ${r} s` : `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Minutos que contam na franquia: cada ligação atendida arredonda para cima. */
export const minutosCobrados = (segundos: number) => (segundos > 0 ? Math.ceil(segundos / 60) : 0);

/** Número da empresa para a ligação: o do mesmo DDD do lead, senão o principal. */
export function numeroDeSaida<T extends { numero: string; principal: boolean }>(
  numeros: T[],
  telefoneLead: string,
  mesmoDdd: boolean,
): T | null {
  if (!numeros.length) return null;
  if (mesmoDdd) {
    const ddd = telefoneLead.slice(0, 2);
    const igual = numeros.find((n) => n.numero.slice(0, 2) === ddd);
    if (igual) return igual;
  }
  return numeros.find((n) => n.principal) ?? numeros[0] ?? null;
}

/** "71988124410" → "+5571988124410" (como a telefonia disca). */
export const e164 = (n: string) => `+55${n.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')}`;
