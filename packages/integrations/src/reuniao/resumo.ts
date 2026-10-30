import {
  ETAPAS_SUGERIDAS,
  fmtTempoReuniao,
  INTERESSES_REUNIAO,
  type ResumoReuniao,
  resumoReuniao,
  TIPOS_DESTAQUE,
  TIPOS_MOMENTO,
} from '@prospeccao/shared/reunioes';
import { type ConfigIa, type EsquemaIa, gerarJson } from '../ia/index.js';

/**
 * Resumo da reunião para a ficha do lead: o que foi conversado, dores, objeções, quem decide,
 * próximos passos (viram tarefas) e os momentos importantes com o minuto (para pular na gravação).
 * A IA só usa o que está na transcrição: nada de inventar número ou nome.
 */

export interface EntradaResumoReuniao {
  /** Nossa empresa (quem vende). */
  empresa: string;
  /** Empresa do lead, se a reunião é com um lead. */
  lead: string | null;
  etapa: string | null;
  titulo: string;
  duracaoSegundos: number;
  participantes: { nome: string; doTime: boolean }[];
  falas: { segundo: number; nome: string; texto: string }[];
  /** Mensagens do chat da sala ("Nome: texto"). */
  chat: string[];
}

const ESQUEMA: EsquemaIa = {
  type: 'OBJECT',
  properties: {
    resumo: {
      type: 'STRING',
      description: 'três a cinco frases: o que foi conversado, em que pé ficou e o que foi combinado',
    },
    interesse: { type: 'STRING', enum: [...INTERESSES_REUNIAO] },
    destaques: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          tipo: { type: 'STRING', enum: [...TIPOS_DESTAQUE] },
          texto: { type: 'STRING', description: 'frase curta, com o que foi dito' },
          segundo: { type: 'INTEGER', nullable: true, description: 'segundo da reunião em que foi dito' },
        },
        required: ['tipo', 'texto'],
      },
    },
    proximosPassos: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          texto: { type: 'STRING', description: 'ação começando com verbo' },
          quem: { type: 'STRING', nullable: true, description: 'nome de quem ficou de fazer' },
          prazo: { type: 'STRING', nullable: true, description: 'prazo combinado, como foi dito' },
        },
        required: ['texto'],
      },
    },
    momentos: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          segundo: { type: 'INTEGER' },
          titulo: { type: 'STRING', description: 'duas a cinco palavras' },
          tipo: { type: 'STRING', enum: [...TIPOS_MOMENTO] },
        },
        required: ['segundo', 'titulo', 'tipo'],
      },
    },
    sugestaoEtapa: { type: 'STRING', enum: [...ETAPAS_SUGERIDAS], nullable: true },
    motivoSugestao: { type: 'STRING', nullable: true },
  },
  required: ['resumo', 'interesse', 'destaques', 'proximosPassos', 'momentos'],
};

/** Transcrição em texto ("[12:40] Carlos: …"), cortando o meio se for longa demais para a IA. */
export function transcricaoParaIa(falas: EntradaResumoReuniao['falas'], maxLetras = 90_000): string {
  const linhas = falas.map((f) => `[${fmtTempoReuniao(f.segundo)}] ${f.nome}: ${f.texto}`);
  const texto = linhas.join('\n');
  if (texto.length <= maxLetras) return texto;
  // Começo e fim pesam mais (apresentação e combinados); o meio vai resumido pelo corte.
  const metade = Math.floor(maxLetras / 2);
  const inicio = texto.slice(0, metade);
  const fim = texto.slice(texto.length - metade);
  return `${inicio.slice(0, inicio.lastIndexOf('\n'))}\n[… trecho do meio cortado por tamanho …]\n${fim.slice(fim.indexOf('\n') + 1)}`;
}

export function promptResumoReuniao(e: EntradaResumoReuniao): string {
  const time = e.participantes.filter((p) => p.doTime).map((p) => p.nome);
  const convidados = e.participantes.filter((p) => !p.doTime).map((p) => p.nome);
  return [
    `Você resume reuniões comerciais da empresa ${e.empresa} para o vendedor. Escreva em português do Brasil, direto, sem floreio.`,
    'Regras:',
    '- Use SÓ o que está na transcrição e no chat. Não invente número, nome, preço ou prazo. Se algo não foi dito, deixe de fora.',
    '- A transcrição é automática: pode ter palavras trocadas. Corrija o óbvio, sem mudar o sentido.',
    '- "segundo" é o tempo da reunião em segundos, tirado da marcação [mm:ss] ou [h:mm:ss] da linha onde aquilo foi dito.',
    '- destaques: a dor principal, volume ou números citados, orçamento, objeções, quem decide, prazo, concorrente. Só os que aparecem.',
    '- proximosPassos: o que alguém ficou de fazer, começando com verbo. Diga quem (pelo nome) e o prazo se foi combinado.',
    '- momentos: até 8 pontos para pular na gravação (preço, objeção, decisão, próximos passos).',
    '- sugestaoEtapa: "proposta" se ficou de mandar proposta ou o lead pediu; "ganho" só se fechou; "perdido" só se recusou de vez; "reuniao" se vai ter outra reunião; null se não dá para dizer.',
    '',
    `Reunião: ${e.titulo} (${fmtTempoReuniao(e.duracaoSegundos)} de duração)`,
    e.lead ? `Lead: ${e.lead}${e.etapa ? ` (etapa atual: ${e.etapa})` : ''}` : 'Reunião sem lead.',
    `Do time (${e.empresa}): ${time.join(', ') || 'não identificado'}`,
    `Convidados: ${convidados.join(', ') || 'não identificados'}`,
    '',
    'Transcrição:',
    transcricaoParaIa(e.falas),
    ...(e.chat.length ? ['', 'Chat da sala:', ...e.chat.slice(-40)] : []),
  ].join('\n');
}

/** Pede o resumo à IA. Devolve null se a IA respondeu algo que não dá para usar. */
export async function resumirReuniao(cfg: ConfigIa, e: EntradaResumoReuniao): Promise<ResumoReuniao | null> {
  const texto = await gerarJson(cfg, {
    prompt: promptResumoReuniao(e),
    esquema: ESQUEMA,
    temperatura: 0.2,
    maxTokens: 2500,
    timeoutMs: 120_000,
  });
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto || '{}');
  } catch {
    return null;
  }
  const r = resumoReuniao.safeParse(bruto);
  if (!r.success) return null;
  // Marcação fora da reunião não serve para pular na gravação.
  const limite = Math.max(0, e.duracaoSegundos);
  return {
    ...r.data,
    destaques: r.data.destaques.map((d) => ({
      ...d,
      segundo: d.segundo !== null && d.segundo <= limite ? d.segundo : null,
    })),
    momentos: r.data.momentos.filter((m) => m.segundo <= limite).sort((a, b) => a.segundo - b.segundo),
  };
}
