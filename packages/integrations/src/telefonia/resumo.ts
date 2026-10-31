import {
  CLIMAS_LIGACAO,
  ETAPAS_LIGACAO,
  type ResumoLigacao,
  resumoLigacao,
} from '@prospeccao/shared/ligacoes';
import { fmtTempoReuniao, INTERESSES_REUNIAO, TIPOS_DESTAQUE } from '@prospeccao/shared/reunioes';
import { type ConfigIa, type EsquemaIa, gerarJson } from '../ia/index.js';

/**
 * Resumo da ligação para a ficha e para o "Como foi?": o que foi dito, o clima da conversa, o que
 * fazer no lead (etapa, reunião combinada, pessoas citadas) e se o número era o certo. A IA só usa o
 * que está na transcrição.
 */

export interface EntradaResumoLigacao {
  empresa: string;
  /** Quem ligou (do time). */
  comercial: string;
  lead: string | null;
  etapa: string | null;
  /** Data e hora de agora, em Brasília (para "quinta às 9h" virar uma data). */
  agora: Date;
  duracaoSegundos: number;
  falas: { segundo: number; quem: 'voce' | 'lead'; texto: string }[];
}

const ESQUEMA: EsquemaIa = {
  type: 'OBJECT',
  properties: {
    resumo: { type: 'STRING', description: 'duas a quatro frases: o que foi conversado e em que pé ficou' },
    conversou: { type: 'BOOLEAN', description: 'alguém do lado do lead conversou (não só caixa postal)' },
    caixaPostal: { type: 'BOOLEAN' },
    clima: { type: 'STRING', enum: [...CLIMAS_LIGACAO] },
    sentimento: { type: 'STRING', nullable: true, description: 'uma frase curta sobre como o lead estava' },
    interesse: { type: 'STRING', enum: [...INTERESSES_REUNIAO] },
    destaques: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { tipo: { type: 'STRING', enum: [...TIPOS_DESTAQUE] }, texto: { type: 'STRING' } },
        required: ['tipo', 'texto'],
      },
    },
    proximoPasso: { type: 'STRING', nullable: true, description: 'ação combinada, começando com verbo' },
    sugestaoEtapa: { type: 'STRING', enum: [...ETAPAS_LIGACAO], nullable: true },
    reuniao: {
      type: 'OBJECT',
      nullable: true,
      properties: {
        inicio: { type: 'STRING', nullable: true, description: 'ISO 8601 com -03:00' },
        texto: { type: 'STRING', description: 'como foi dito ("quinta de manhã")' },
      },
      required: ['texto'],
    },
    contatos: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          nome: { type: 'STRING' },
          cargo: { type: 'STRING', nullable: true },
          telefone: { type: 'STRING', nullable: true },
          decisor: { type: 'BOOLEAN' },
        },
        required: ['nome'],
      },
    },
    numeroCerto: { type: 'BOOLEAN', nullable: true },
  },
  required: ['resumo', 'conversou', 'caixaPostal', 'clima', 'interesse', 'destaques'],
};

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** "quinta, 31/10/2026 09:14" em Brasília. */
export function agoraEmBrasilia(d: Date): string {
  const p = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  const dia = DIAS[new Date(d.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).getDay()];
  return `${dia}, ${v('day')}/${v('month')}/${v('year')} ${v('hour')}:${v('minute')}`;
}

export function promptResumoLigacao(e: EntradaResumoLigacao): string {
  const linhas = e.falas.map(
    (f) =>
      `[${fmtTempoReuniao(f.segundo)}] ${f.quem === 'voce' ? `${e.comercial} (vendedor)` : 'Lead'}: ${f.texto}`,
  );
  return [
    `Você resume ligações comerciais da empresa ${e.empresa} para o vendedor. Português do Brasil, direto.`,
    'Regras:',
    '- Use SÓ o que está na transcrição. Não invente nome, número, preço, data ou prazo.',
    '- A transcrição é automática: pode ter palavras trocadas. Corrija o óbvio sem mudar o sentido.',
    '- conversou: true se alguém do lado do lead falou de verdade; false se só tocou, foi caixa postal ou mensagem da operadora.',
    '- caixaPostal: true se caiu na caixa postal ou na gravação da operadora.',
    '- clima: como a conversa foi para o lado do lead (positivo, neutro ou negativo). sentimento: uma frase ("receptiva, mas com pressa").',
    '- sugestaoEtapa: "reuniao" se marcou reunião ou demonstração; "proposta" se pediu proposta ou preço por escrito; "respondeu" se conversou e ficou de pensar; "ganho" só se fechou; "perdido" só se recusou de vez; null se não dá para dizer.',
    `- reuniao: só se combinaram data/hora. "inicio" em ISO 8601 com -03:00, calculado a partir de agora (${agoraEmBrasilia(e.agora)}, horário de Brasília); sem hora dita, use null em inicio.`,
    '- contatos: pessoas citadas que decidem ou devem ser procuradas (com o telefone, se foi dito). Não repita o próprio lead que atendeu se o nome não foi dito.',
    '- numeroCerto: false se disseram que é engano, que a pessoa não trabalha lá ou que o número é de outra empresa; true se falou com a empresa certa; null se não dá para saber.',
    '',
    `Ligação de ${e.comercial} (${fmtTempoReuniao(e.duracaoSegundos)})`,
    e.lead ? `Lead: ${e.lead}${e.etapa ? ` (etapa atual: ${e.etapa})` : ''}` : 'Ligação sem lead.',
    '',
    'Transcrição:',
    linhas.join('\n').slice(0, 60_000) || '(nada transcrito)',
  ].join('\n');
}

export async function resumirLigacao(cfg: ConfigIa, e: EntradaResumoLigacao): Promise<ResumoLigacao | null> {
  const texto = await gerarJson(cfg, {
    prompt: promptResumoLigacao(e),
    esquema: ESQUEMA,
    temperatura: 0.2,
    maxTokens: 1500,
    timeoutMs: 90_000,
  });
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto || '{}');
  } catch {
    return null;
  }
  const r = resumoLigacao.safeParse(bruto);
  if (!r.success) return null;
  // Reunião no passado (a IA errou o dia): fica só o texto, a data a pessoa escolhe.
  const reuniao = r.data.reuniao;
  if (reuniao?.inicio && new Date(reuniao.inicio).getTime() < e.agora.getTime())
    return { ...r.data, reuniao: { ...reuniao, inicio: null } };
  return r.data;
}
