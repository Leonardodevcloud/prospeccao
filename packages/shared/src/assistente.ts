import { z } from 'zod';

/* ───────────────────────────── Argos, o assistente ───────────────────────────── */

/** Uma troca anterior da conversa, para perguntas de continuação ("e na unidade de Recife?"). */
export interface TurnoAnterior {
  pergunta: string;
  resposta: string;
}

export const perguntaAssistente = z.object({
  texto: z.string().trim().min(2, 'Diga ou digite a pergunta.').max(1000),
  historico: z
    .array(z.object({ pergunta: z.string().max(1000), resposta: z.string().max(4000) }))
    .max(10)
    .default([]),
  /** A interface vai falar a resposta: o servidor já adianta a voz do 1º trecho. */
  falar: z.boolean().default(false),
});

export const textoParaFalar = z.object({ texto: z.string().trim().min(1).max(1200) });

export const vozAssistente = z.object({
  voz: z.string().min(2).max(30),
  velocidade: z.number().min(0.8).max(1.5),
});

/** Como desenhar o resultado (a IA escolhe tipo e colunas; os números são sempre os da consulta). */
export interface GraficoDTO {
  tipo: 'linha' | 'barras' | 'pizza';
  x: string;
  y: string[];
  titulo: string | null;
  /** Abre primeiro (a pessoa pediu) ou fica como opção ao lado da tabela. */
  principal: boolean;
}

/** Resultado de uma consulta do Argos aos dados. */
export interface DadosAssistenteDTO {
  titulo: string;
  /** "pronta" = consulta escrita à mão e testada; "livre" = SQL escrito pela IA. */
  origem: 'pronta' | 'livre';
  colunas: string[];
  linhas: Record<string, unknown>[];
  cortado: boolean;
  totais: Record<string, number | string | null>;
  destaques: { rotulo: string; valor: string }[];
  analise: string | null;
  /** Como o número foi obtido: a consulta exata, para conferir. */
  sql: string;
  explicacao: string | null;
  tabelas: string[];
  ms: number;
  grafico?: GraficoDTO | null;
}

export interface RespostaAssistenteDTO {
  texto: string;
  /** Versão curta, para ser falada. */
  fala: string;
  /** Markdown curto com o porquê, quando acrescenta algo. */
  detalhe: string | null;
  acao: { destino: string; rotulo: string; automatica: boolean } | null;
  dados?: DadosAssistenteDTO | null;
  /** O Argos perguntou de volta: a interface volta a ouvir. */
  aguardaResposta?: boolean;
  /** O 1º trecho da fala, já sendo gerado no servidor. */
  voz?: { id: string; texto: string } | null;
  tempos?: Record<string, number>;
}

export interface ConfigVozDTO {
  /** Há voz no servidor? Sem ela, a interface usa a voz do navegador. */
  disponivel: boolean;
  /** Dá para falar com o Argos (transcrição ligada)? Sem ela, só digitando. */
  ouvir: boolean;
  /** O acesso só leitura aos dados está ligado (sem ele, o Argos conversa mas não consulta). */
  dados: boolean;
  voz: string;
  velocidade: number;
  vozes: readonly string[];
}

/**
 * Divide o texto falado em trechos: o primeiro curto (sai rápido) e os outros maiores, gerados
 * enquanto o primeiro toca. Igual no servidor (adianta o 1º trecho) e na interface.
 */
export function dividirFala(texto: string, primeiro = 90, demais = 240): string[] {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  if (!limpo) return [];
  const frases = limpo.match(/[^.!?;]+[.!?;]*/g) ?? [limpo];
  const partes: string[] = [];
  let atual = '';
  for (const f of frases) {
    const limite = partes.length === 0 ? primeiro : demais;
    if ((atual + f).length > limite && atual) {
      partes.push(atual.trim());
      atual = '';
    }
    atual += f;
  }
  if (atual.trim()) partes.push(atual.trim());
  return partes;
}
