import { z } from 'zod';

/**
 * Qualidade do atendimento: a IA avalia cada atendimento (uma conversa que ficou parada ou uma
 * ligação transcrita) com a mesma régua de 5 pontos. O tempo de resposta é medido pelo sistema
 * (pelos horários das mensagens); os outros 4 a IA avalia, citando o trecho que justifica (o
 * sistema confere que o trecho está mesmo no atendimento). O gestor pode corrigir a nota.
 */

export const CRITERIOS_ATENDIMENTO = ['tempo', 'respondeu', 'conduziu', 'proximo_passo', 'tom'] as const;
export type CriterioAtendimento = (typeof CRITERIOS_ATENDIMENTO)[number];
/** Os que a IA avalia (o tempo é medido pelo sistema). */
export const CRITERIOS_DA_IA = ['respondeu', 'conduziu', 'proximo_passo', 'tom'] as const;
export type CriterioDaIa = (typeof CRITERIOS_DA_IA)[number];

export const CRITERIO_ATENDIMENTO: Record<
  CriterioAtendimento,
  { nome: string; regua: string; forte: string; treinar: string; pesou: string }
> = {
  tempo: {
    nome: 'Tempo de resposta',
    regua:
      'Medido pelo sistema: quanto o cliente esperou pela resposta da equipe (mensagens que chegaram de segunda a sábado, das 7h às 19h).',
    forte: 'Responde rápido',
    treinar: 'Responder mais rápido',
    pesou: 'Cliente esperando muito pela resposta',
  },
  respondeu: {
    nome: 'Respondeu o que foi perguntado',
    regua:
      'Cada pergunta do cliente teve resposta clara: preço, prazo, disponibilidade, se a peça ou o serviço serve para o caso dele.',
    forte: 'Responde o que o cliente pergunta',
    treinar: 'Responder todas as perguntas do cliente',
    pesou: 'Pergunta do cliente que ficou sem resposta',
  },
  conduziu: {
    nome: 'Conduziu a conversa',
    regua:
      'Fez perguntas para entender a necessidade, ofereceu opções e levou a conversa adiante, em vez de só reagir.',
    forte: 'Conduz bem a conversa',
    treinar: 'Perguntar mais e oferecer opções',
    pesou: 'Atendimento que só reagiu, sem conduzir',
  },
  proximo_passo: {
    nome: 'Próximo passo combinado',
    regua:
      'Terminou com algo combinado: pedido separado, entrega marcada, retorno com dia ou hora, visita, reunião ou proposta.',
    forte: 'Fecha com o próximo passo',
    treinar: 'Combinar o próximo passo',
    pesou: 'Terminou sem próximo passo combinado',
  },
  tom: {
    nome: 'Tom e clareza',
    regua: 'Cordial e direto, sem erro de português, sem prometer o que não pode cumprir.',
    forte: 'Tom cordial e claro',
    treinar: 'Cuidar do tom e da clareza',
    pesou: 'Tom ou clareza a melhorar',
  },
};

export type SituacaoCriterio = 'bom' | 'atencao' | 'faltou';
export const ROTULO_SITUACAO: Record<SituacaoCriterio, string> = {
  bom: 'Bom',
  atencao: 'Atenção',
  faltou: 'Faltou',
};
export function situacaoDaNota(n: number): SituacaoCriterio {
  return n >= 8 ? 'bom' : n >= 5 ? 'atencao' : 'faltou';
}

/** Atendimento com menos mensagens da equipe que isso não recebe nota. */
export const MIN_MENSAGENS_EQUIPE = 3;
/** A conversa precisa estar parada há isso para ser avaliada (para não dar nota no meio). */
export const PARADA_ATENDIMENTO_MIN = 120;

/* ───────────────────────────── Tempo de resposta (sistema) ───────────────────────────── */

export interface MensagemTempo {
  /** lead: o cliente; equipe: alguém do time; outro: a IA ou um envio automático. */
  quem: 'lead' | 'equipe' | 'outro';
  em: Date;
}

const PARTES = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Sao_Paulo',
  weekday: 'short',
  hour: 'numeric',
  hourCycle: 'h23',
});
/** Segunda a sábado, das 7h às 19h em Brasília: a hora em que se espera resposta. */
export function noHorarioDeAtendimento(d: Date): boolean {
  const p = Object.fromEntries(PARTES.formatToParts(d).map((x) => [x.type, x.value]));
  const hora = Number(p.hour);
  return p.weekday !== 'Sun' && hora >= 7 && hora < 19;
}

/**
 * Quanto o cliente esperou: de cada mensagem do cliente (a primeira de uma sequência) até a
 * resposta da equipe. Só contam as que chegaram no horário de atendimento; se a IA ou um envio
 * automático respondeu antes, aquela vez não conta para ninguém.
 */
export function temposDeResposta(ms: MensagemTempo[]): {
  primeiraMin: number | null;
  mediaMin: number | null;
  vezes: number;
} {
  const ordem = [...ms].sort((a, b) => a.em.getTime() - b.em.getTime());
  const esperas: number[] = [];
  let esperando: Date | null = null;
  for (const m of ordem) {
    if (m.quem === 'lead') {
      if (!esperando) esperando = m.em;
    } else if (esperando) {
      if (m.quem === 'equipe' && noHorarioDeAtendimento(esperando))
        esperas.push((m.em.getTime() - esperando.getTime()) / 60_000);
      esperando = null;
    }
  }
  if (!esperas.length) return { primeiraMin: null, mediaMin: null, vezes: 0 };
  const media = esperas.reduce((s, x) => s + x, 0) / esperas.length;
  return {
    primeiraMin: Math.round(esperas[0]!),
    mediaMin: Math.round(media),
    vezes: esperas.length,
  };
}

/** A nota do tempo de resposta (pela espera média, em minutos). */
export function notaDoTempo(mediaMin: number): number {
  if (mediaMin <= 5) return 10;
  if (mediaMin <= 10) return 9;
  if (mediaMin <= 15) return 8;
  if (mediaMin <= 30) return 6;
  if (mediaMin <= 60) return 4;
  return 2;
}

/* ───────────────────────────── A nota ───────────────────────────── */

export interface CriterioAvaliado {
  /** 0 a 10. */
  nota: number;
  comentario: string;
  /** O trecho do atendimento que justifica (conferido pelo sistema), ou null. */
  trecho: string | null;
  /** Como poderia ter sido (só quando ficou abaixo de 8). */
  sugestao: string | null;
}

export type CriteriosAvaliados = Partial<Record<CriterioAtendimento, CriterioAvaliado>>;

/** A nota geral: a média dos pontos avaliados, com uma casa. */
export function notaGeral(c: CriteriosAvaliados): number | null {
  const notas = CRITERIOS_ATENDIMENTO.flatMap((k) => (c[k] ? [c[k]!.nota] : []));
  if (!notas.length) return null;
  return Math.round((notas.reduce((s, x) => s + x, 0) / notas.length) * 10) / 10;
}

export interface NotaAtendimento {
  id: number;
  tipo: 'conversa' | 'ligacao';
  empresaId: number | null;
  empresa: string | null;
  ligacaoId: number | null;
  usuarioId: number | null;
  vendedor: string | null;
  inicioEm: string;
  fimEm: string;
  /** A que vale: a do gestor, se ele corrigiu; senão a da IA. */
  nota: number;
  notaIa: number;
  criterios: CriteriosAvaliados;
  primeiraRespostaMin: number | null;
  mediaRespostaMin: number | null;
  correcao: { nota: number; motivo: string; por: string | null; em: string } | null;
  avaliadoEm: string;
}

export const corrigirNotaEntrada = z.object({
  nota: z.number().min(0, 'De 0 a 10.').max(10, 'De 0 a 10.'),
  motivo: z.string().trim().min(5, 'Diga o motivo da correção.').max(500),
});

/* ───────────────────────────── A semana ───────────────────────────── */

/** A segunda-feira da semana de uma data, em Brasília (AAAA-MM-DD). */
export function inicioDaSemana(d: Date): string {
  const br = new Date(d.getTime() - 3 * 3600_000);
  const dia = br.getUTCDay();
  const volta = (dia + 6) % 7;
  const seg = new Date(Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), br.getUTCDate() - volta));
  return seg.toISOString().slice(0, 10);
}

/** O intervalo da semana (segunda 00h a segunda seguinte 00h, Brasília) como instantes. */
export function intervaloDaSemana(segunda: string): { de: Date; ate: Date } {
  const de = new Date(`${segunda}T00:00:00-03:00`);
  return { de, ate: new Date(de.getTime() + 7 * 86_400_000) };
}

export interface ExemploAtendimento {
  notaId: number;
  empresa: string | null;
  em: string;
  trecho: string | null;
  sugestao: string | null;
}

export interface ResumoVendedor {
  usuarioId: number;
  nome: string;
  grupo: string | null;
  atendimentos: number;
  conversas: number;
  ligacoes: number;
  nota: number | null;
  notaAnterior: number | null;
  criterios: Partial<Record<CriterioAtendimento, number>>;
  primeiraRespostaMin: number | null;
  /** % dos atendimentos que saíram com o próximo passo combinado (nota ≥ 8). */
  proximoPassoPct: number | null;
  forte: { criterio: CriterioAtendimento; nota: number; exemplo: ExemploAtendimento | null } | null;
  /** O ponto mais fraco (só se ficou abaixo de 8). */
  treinar: {
    criterio: CriterioAtendimento;
    nota: number;
    /** Atendimentos com esse ponto abaixo de 6. */
    abaixo: number;
    exemplo: ExemploAtendimento | null;
  } | null;
}

const media = (xs: number[]) =>
  xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null;

/** O resumo de uma pessoa a partir das notas (da semana). */
export function resumirVendedor(
  base: { usuarioId: number; nome: string; grupo: string | null },
  notas: NotaAtendimento[],
  anteriores: NotaAtendimento[] = [],
): ResumoVendedor {
  const criterios: Partial<Record<CriterioAtendimento, number>> = {};
  for (const k of CRITERIOS_ATENDIMENTO) {
    const m = media(notas.flatMap((n) => (n.criterios[k] ? [n.criterios[k]!.nota] : [])));
    if (m != null) criterios[k] = m;
  }
  const primeiras = notas.flatMap((n) => (n.primeiraRespostaMin != null ? [n.primeiraRespostaMin] : []));
  const comPasso = notas.filter((n) => n.criterios.proximo_passo);
  const avaliados = CRITERIOS_ATENDIMENTO.filter((k) => criterios[k] != null);
  const ordem = [...avaliados].sort((a, b) => criterios[b]! - criterios[a]!);
  const exemplo = (k: CriterioAtendimento, bom: boolean): ExemploAtendimento | null => {
    const n = [...notas]
      .filter((x) => {
        const c = x.criterios[k];
        return c && (bom ? c.nota >= 8 && c.trecho : c.nota < 6 && (c.trecho || c.sugestao));
      })
      .sort((a, b) => b.fimEm.localeCompare(a.fimEm))[0];
    if (!n) return null;
    const c = n.criterios[k]!;
    return {
      notaId: n.id,
      empresa: n.empresa,
      em: n.fimEm,
      trecho: c.trecho,
      sugestao: bom ? null : c.sugestao,
    };
  };
  const forteK = ordem[0];
  const fracoK = ordem.at(-1);
  return {
    ...base,
    atendimentos: notas.length,
    conversas: notas.filter((n) => n.tipo === 'conversa').length,
    ligacoes: notas.filter((n) => n.tipo === 'ligacao').length,
    nota: media(notas.map((n) => n.nota)),
    notaAnterior: media(anteriores.map((n) => n.nota)),
    criterios,
    primeiraRespostaMin: primeiras.length
      ? Math.round(primeiras.reduce((s, x) => s + x, 0) / primeiras.length)
      : null,
    proximoPassoPct: comPasso.length
      ? Math.round(
          (comPasso.filter((n) => n.criterios.proximo_passo!.nota >= 8).length / comPasso.length) * 100,
        )
      : null,
    forte: forteK ? { criterio: forteK, nota: criterios[forteK]!, exemplo: exemplo(forteK, true) } : null,
    treinar:
      fracoK && fracoK !== forteK && criterios[fracoK]! < 8
        ? {
            criterio: fracoK,
            nota: criterios[fracoK]!,
            abaixo: notas.filter((n) => (n.criterios[fracoK]?.nota ?? 10) < 6).length,
            exemplo: exemplo(fracoK, false),
          }
        : null,
  };
}

export interface PainelAtendimento {
  semana: string;
  equipe: {
    nota: number | null;
    notaAnterior: number | null;
    atendimentos: number;
    conversas: number;
    ligacoes: number;
    primeiraRespostaMin: number | null;
    proximoPassoPct: number | null;
  };
  /** Os pontos que mais ficaram abaixo de 6 na equipe (até 3). */
  pesou: { criterio: CriterioAtendimento; texto: string; quantos: number }[];
  vendedores: ResumoVendedor[];
  grupos: { id: number; nome: string }[];
}

/** O que mais pesou: os pontos com mais atendimentos abaixo de 6. */
export function oQueMaisPesou(notas: NotaAtendimento[]): PainelAtendimento['pesou'] {
  return CRITERIOS_ATENDIMENTO.map((k) => ({
    criterio: k,
    texto: CRITERIO_ATENDIMENTO[k].pesou,
    quantos: notas.filter((n) => (n.criterios[k]?.nota ?? 10) < 6).length,
  }))
    .filter((x) => x.quantos > 0)
    .sort((a, b) => b.quantos - a.quantos)
    .slice(0, 3);
}
