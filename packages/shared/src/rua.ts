import { z } from 'zod';
import type { EtapaFunil } from './funil.js';
import { haversineKm, type Ponto } from './geo.js';

/**
 * Vendas na rua: o roteiro de visitas do dia. A partir dos leads de uma campanha (com localização),
 * o sistema escolhe os melhores que cabem no dia, põe na ordem que anda menos e calcula a hora de
 * chegada em cada um (com o almoço no meio). No celular, o vendedor vai de um em um, faz o check-in
 * e registra como foi; o resultado move o lead no funil.
 */

/* ───────────────────────────── Resultado da visita ───────────────────────────── */

export const RESULTADOS_VISITA = [
  'decisor',
  'proposta',
  'reuniao',
  'nao_estava',
  'sem_interesse',
  'fechou',
] as const;
export type ResultadoVisita = (typeof RESULTADOS_VISITA)[number];

export const ROTULO_RESULTADO: Record<ResultadoVisita, string> = {
  decisor: 'Falei com quem decide',
  proposta: 'Pediu proposta',
  reuniao: 'Marcou reunião',
  nao_estava: 'Não estava',
  sem_interesse: 'Sem interesse',
  fechou: 'Fechou',
};

/** Para onde o lead vai no funil (só avança; null = fica onde está). */
export const ETAPA_DO_RESULTADO: Record<ResultadoVisita, EtapaFunil | null> = {
  decisor: 'respondeu',
  proposta: 'proposta',
  reuniao: 'reuniao',
  nao_estava: null,
  sem_interesse: 'perdido',
  fechou: 'ganho',
};

/** Resultados em que houve conversa com quem decide (o "falaram com quem decide" do gestor). */
export const RESULTADOS_COM_CONVERSA: readonly ResultadoVisita[] = [
  'decisor',
  'proposta',
  'reuniao',
  'sem_interesse',
  'fechou',
];

/** "2026-11-05" de uma data, no fuso de São Paulo. */
export function diaEmSaoPaulo(d: Date = new Date()): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

/** Soma dias úteis (pula sábado e domingo) a um dia "AAAA-MM-DD". */
export function somarDiasUteis(dia: string, dias: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  let falta = dias;
  while (falta > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const semana = d.getUTCDay();
    if (semana !== 0 && semana !== 6) falta--;
  }
  return d.toISOString().slice(0, 10);
}

/** Próximo passo que a tela já deixa marcado para cada resultado (o vendedor pode trocar). */
export function proximoPassoSugerido(
  resultado: ResultadoVisita,
  agora: Date = new Date(),
): { texto: string; dia: string } | null {
  const hoje = diaEmSaoPaulo(agora);
  switch (resultado) {
    case 'proposta':
      return { texto: 'Mandar a proposta', dia: somarDiasUteis(hoje, 1) };
    case 'reuniao':
      return { texto: 'Preparar a reunião', dia: somarDiasUteis(hoje, 1) };
    case 'decisor':
      return { texto: 'Retomar a conversa', dia: somarDiasUteis(hoje, 3) };
    case 'nao_estava':
      return { texto: 'Voltar para falar com quem decide', dia: somarDiasUteis(hoje, 1) };
    case 'fechou':
      return { texto: 'Dar as boas-vindas ao novo cliente', dia: somarDiasUteis(hoje, 1) };
    case 'sem_interesse':
      return null;
  }
}

/* ───────────────────────────── Horários ───────────────────────────── */

const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "08:30" → 510 (minutos desde a meia-noite). */
export function minutosDoDia(hora: string): number {
  const m = HORA.exec(hora);
  if (!m) throw new Error(`Hora inválida: ${hora}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 510 → "08:30" (passa da meia-noite: continua contando, "24:10"). */
export function horaDoDia(minutos: number): string {
  const m = Math.max(0, Math.round(minutos));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** "1 h 52 min", "38 min". */
export function fmtMinutos(minutos: number): string {
  const m = Math.max(0, Math.round(minutos));
  const h = Math.floor(m / 60);
  return h ? (m % 60 ? `${h} h ${m % 60} min` : `${h} h`) : `${m} min`;
}

/* ───────────────────────────── Distâncias ───────────────────────────── */

/** Tempo e distância de cada ponto para cada outro (índice 0 = ponto de partida). */
export interface Matriz {
  minutos: number[][];
  km: number[][];
}

/** Ruas não são linha reta: a distância real costuma ser uns 35% maior. */
const FATOR_RUAS = 1.35;
/** Velocidade média na cidade (com trânsito e semáforo), em km/h. */
const VELOCIDADE_CIDADE = 24;
/** Para estacionar e chegar na porta. */
const MINUTOS_ESTACIONAR = 3;

/** Estimativa sem o serviço de rotas: linha reta com o fator das ruas e a velocidade média. */
export function matrizEstimada(pontos: Ponto[]): Matriz {
  const km = pontos.map((a) => pontos.map((b) => (a === b ? 0 : haversineKm(a, b) * FATOR_RUAS)));
  const minutos = km.map((linha) =>
    linha.map((k) => (k === 0 ? 0 : (k / VELOCIDADE_CIDADE) * 60 + MINUTOS_ESTACIONAR)),
  );
  return { minutos, km };
}

/* ───────────────────────────── Montar o dia ───────────────────────────── */

export interface ConfigDia {
  /** Saída do ponto de partida (minutos do dia). */
  inicio: number;
  /** Até quando a última visita pode terminar. */
  fim: number;
  minutosVisita: number;
  almoco: { inicio: number; minutos: number } | null;
}

export interface HorarioParada {
  /** Índice do ponto na matriz. */
  indice: number;
  chegada: number;
  saida: number;
  kmTrecho: number;
  minutosTrecho: number;
}

export interface HorariosDoDia {
  paradas: HorarioParada[];
  km: number;
  /** Minutos dirigindo. */
  minutosRota: number;
  /** Fim da última visita. */
  termino: number;
  /** Posição (na lista) da visita que vem logo depois do almoço; null = sem almoço no meio. */
  almocoAntesDe: number | null;
}

/**
 * Horário de cada visita na ordem dada. O almoço entra antes da visita que passaria do horário
 * dele (meia hora de folga): se for a hora, para; se ainda não for, espera até dar a hora.
 */
export function horarios(ordem: number[], m: Matriz, cfg: ConfigDia): HorariosDoDia {
  let relogio = cfg.inicio;
  let anterior = 0;
  let km = 0;
  let minutosRota = 0;
  let almocoAntesDe: number | null = null;
  const paradas: HorarioParada[] = [];
  ordem.forEach((indice, posicao) => {
    const trecho = m.minutos[anterior]![indice]!;
    const kmTrecho = m.km[anterior]![indice]!;
    if (cfg.almoco && almocoAntesDe === null && posicao > 0) {
      const terminaria = relogio + trecho + cfg.minutosVisita;
      if (relogio >= cfg.almoco.inicio || terminaria > cfg.almoco.inicio + 30) {
        relogio = Math.max(relogio, cfg.almoco.inicio) + cfg.almoco.minutos;
        almocoAntesDe = posicao;
      }
    }
    const chegada = relogio + trecho;
    const saida = chegada + cfg.minutosVisita;
    paradas.push({ indice, chegada, saida, kmTrecho, minutosTrecho: trecho });
    km += kmTrecho;
    minutosRota += trecho;
    relogio = saida;
    anterior = indice;
  });
  return { paradas, km, minutosRota, termino: relogio, almocoAntesDe };
}

/** Tempo total do caminho (partida → visitas, sem voltar), para comparar ordens. */
function custo(ordem: number[], m: Matriz): number {
  let total = 0;
  let anterior = 0;
  for (const i of ordem) {
    total += m.minutos[anterior]![i]!;
    anterior = i;
  }
  return total;
}

/** Melhora a ordem invertendo trechos enquanto encurta o caminho (2-opt, caminho aberto). */
function melhorarOrdem(ordem: number[], m: Matriz): number[] {
  let melhor = [...ordem];
  let melhorCusto = custo(melhor, m);
  let mudou = true;
  let voltas = 0;
  while (mudou && voltas++ < 50) {
    mudou = false;
    for (let i = 0; i < melhor.length - 1; i++)
      for (let j = i + 1; j < melhor.length; j++) {
        const tentativa = [
          ...melhor.slice(0, i),
          ...melhor.slice(i, j + 1).reverse(),
          ...melhor.slice(j + 1),
        ];
        const c = custo(tentativa, m);
        if (c < melhorCusto - 1e-9) {
          melhor = tentativa;
          melhorCusto = c;
          mudou = true;
        }
      }
  }
  return melhor;
}

/** A ordem que anda menos: sempre o mais perto que falta, depois os ajustes do 2-opt. */
export function ordenar(indices: number[], m: Matriz): number[] {
  const falta = new Set(indices);
  const ordem: number[] = [];
  let atual = 0;
  while (falta.size) {
    let proximo = -1;
    for (const i of falta)
      if (proximo < 0 || m.minutos[atual]![i]! < m.minutos[atual]![proximo]!) proximo = i;
    ordem.push(proximo);
    falta.delete(proximo);
    atual = proximo;
  }
  return melhorarOrdem(ordem, m);
}

export interface Candidato {
  indice: number;
  /** Quanto maior, antes entra no dia. */
  prioridade: number;
}

/**
 * Escolhe os leads que cabem no dia: do mais importante para o menos, cada um entra onde aumenta
 * menos o caminho, se a última visita ainda terminar no horário. No fim, a ordem é refeita para
 * andar o mínimo.
 */
export function escolherDoDia(candidatos: Candidato[], m: Matriz, cfg: ConfigDia, maxParadas = 20): number[] {
  const fila = [...candidatos].sort((a, b) => b.prioridade - a.prioridade || a.indice - b.indice);
  let rota: number[] = [];
  for (const c of fila) {
    if (rota.length >= maxParadas) break;
    let melhor: number[] | null = null;
    let melhorCusto = Number.POSITIVE_INFINITY;
    for (let p = 0; p <= rota.length; p++) {
      const tentativa = [...rota.slice(0, p), c.indice, ...rota.slice(p)];
      const t = custo(tentativa, m);
      if (t < melhorCusto) {
        melhorCusto = t;
        melhor = tentativa;
      }
    }
    if (melhor && horarios(melhor, m, cfg).termino <= cfg.fim) rota = melhor;
  }
  const otima = ordenar(rota, m);
  return horarios(otima, m, cfg).termino <= cfg.fim ? otima : rota;
}

/* ───────────────────────────── Links de navegação ───────────────────────────── */

export function linkWaze(p: Ponto): string {
  return `https://waze.com/ul?ll=${p.lat.toFixed(6)},${p.lng.toFixed(6)}&navigate=yes`;
}

/** Google Maps até um ponto, ou o caminho todo (até 9 paradas no meio, o limite do link). */
export function linkGoogleMaps(destino: Ponto, origem?: Ponto, paradas: Ponto[] = []): string {
  const f = (p: Ponto) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  const q = new URLSearchParams({ api: '1', destination: f(destino), travelmode: 'driving' });
  if (origem) q.set('origin', f(origem));
  if (paradas.length) q.set('waypoints', paradas.slice(0, 9).map(f).join('|'));
  return `https://www.google.com/maps/dir/?${q.toString().replace(/%2C/g, ',').replace(/%7C/g, '|')}`;
}

/* ───────────────────────────── Entradas da api ───────────────────────────── */

const hora = z.string().regex(HORA, 'Use o formato 08:30.');
const diaIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dia inválido.');

export const SITUACOES_RUA = ['nunca', 'negociacao', 'clientes'] as const;
export type SituacaoRua = (typeof SITUACOES_RUA)[number];
export const ROTULO_SITUACAO_RUA: Record<SituacaoRua, string> = {
  nunca: 'Nunca visitados',
  negociacao: 'Em negociação',
  clientes: 'Clientes',
};

export const partidaRua = z.object({
  rotulo: z.string().trim().min(1).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type PartidaRua = z.infer<typeof partidaRua>;

/** O que o planejamento pede para montar o dia. */
export const configRoteiro = z
  .object({
    /** De quem é o roteiro (padrão: quem está planejando). */
    vendedorId: z.number().int().positive().optional(),
    dia: diaIso,
    campanhaId: z.number().int().positive().nullable().default(null),
    faixas: z
      .array(z.enum(['A', 'B', 'C']))
      .min(1, 'Escolha ao menos uma nota.')
      .default(['A', 'B']),
    situacoes: z
      .array(z.enum(SITUACOES_RUA))
      .min(1, 'Escolha quais leads entram.')
      .default(['nunca', 'negociacao']),
    partida: partidaRua,
    inicio: hora.default('08:30'),
    fim: hora.default('17:30'),
    minutosVisita: z.number().int().min(5).max(240).default(30),
    almoco: z
      .object({ inicio: hora, minutos: z.number().int().min(15).max(180) })
      .nullable()
      .default({
        inicio: '12:00',
        minutos: 60,
      }),
    /** Até quantos km da partida (em linha reta). */
    raioKm: z.number().min(1).max(200).default(15),
    maxParadas: z.number().int().min(1).max(30).default(15),
  })
  .refine((c) => minutosDoDia(c.fim) > minutosDoDia(c.inicio), {
    message: 'O fim do dia precisa ser depois do começo.',
    path: ['fim'],
  });
export type ConfigRoteiro = z.infer<typeof configRoteiro>;

/** Recalcular (ou salvar) com a lista que a pessoa montou: adicionou, tirou ou mudou a ordem. */
export const roteiroMontado = z.object({
  config: configRoteiro,
  empresaIds: z.array(z.number().int().positive()).max(30, 'No máximo 30 visitas por dia.'),
  /** Refaz a ordem para andar menos (padrão: mantém a ordem que veio). */
  otimizar: z.boolean().default(false),
  /** Ao salvar: avisa o vendedor no celular. */
  enviar: z.boolean().default(false),
});
export type RoteiroMontado = z.infer<typeof roteiroMontado>;

export const chegadaVisita = z.object({
  lat: z.number().min(-90).max(90).nullable().default(null),
  lng: z.number().min(-180).max(180).nullable().default(null),
  /** Precisão do GPS em metros. */
  precisao: z.number().min(0).max(100_000).nullable().default(null),
});

export const conclusaoVisita = z.object({
  resultado: z.enum(RESULTADOS_VISITA),
  anotacao: z.string().trim().max(4000).nullable().default(null),
  proximoPasso: z.string().trim().max(200).nullable().default(null),
  /** "AAAA-MM-DD" (o próximo passo fica para as 9h desse dia). */
  proximoPassoEm: diaIso.nullable().default(null),
});
export type ConclusaoVisita = z.infer<typeof conclusaoVisita>;

/** Até quantos metros do endereço o check-in conta como "no endereço da empresa". */
export const RAIO_CHEGADA_METROS = 300;
