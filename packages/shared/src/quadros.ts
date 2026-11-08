import { z } from 'zod';

/*
 * Quadros com gatilhos da IA: quadros que o cliente monta (ex.: "Objeções", com as colunas "Achou
 * caro", "Sem estoque", "Vai pensar"). Cada coluna pode ter um gatilho escrito em português; a IA lê
 * as conversas que pararam há alguns minutos e põe o lead na coluna cujo gatilho aconteceu, com o
 * trecho que mostra isso. O vendedor confirma ou descarta (ou a IA já move, se o quadro deixar).
 */

/** Minutos sem mensagem nova para a IA ler a conversa (não lê no meio da conversa). */
export const PARADA_QUADROS_MIN = 3;
export const MAX_COLUNAS_QUADRO = 12;
export const MAX_QUADROS = 10;

export const CORES_COLUNA = ['cinza', 'azul', 'verde', 'amarelo', 'laranja', 'vermelho', 'roxo'] as const;
export type CorColuna = (typeof CORES_COLUNA)[number];

export const colunaQuadroEntrada = z.object({
  /** Coluna que já existe (sem id: nova). */
  id: z.number().int().positive().optional(),
  nome: z.string().trim().min(1, 'Dê um nome para a coluna.').max(40),
  /** Quando o lead vem para cá, em português ("o cliente disse que achou caro"). Vazio: só à mão. */
  gatilho: z
    .string()
    .trim()
    .max(300)
    .nullish()
    .transform((v) => v || null),
  cor: z.enum(CORES_COLUNA).default('cinza'),
});
export type ColunaQuadroEntrada = z.infer<typeof colunaQuadroEntrada>;

export const quadroEntrada = z
  .object({
    nome: z.string().trim().min(1, 'Dê um nome para o quadro.').max(60),
    /** A IA lê as conversas e põe os leads nas colunas pelos gatilhos. */
    ia: z.boolean().default(true),
    /** A IA sugere e alguém confirma (false: a IA já move). */
    confirmar: z.boolean().default(true),
    colunas: z
      .array(colunaQuadroEntrada)
      .min(1, 'O quadro precisa de pelo menos uma coluna.')
      .max(MAX_COLUNAS_QUADRO, `Até ${MAX_COLUNAS_QUADRO} colunas por quadro.`),
  })
  .refine((q) => new Set(q.colunas.map((c) => c.nome.toLowerCase())).size === q.colunas.length, {
    message: 'Duas colunas com o mesmo nome.',
    path: ['colunas'],
  });
export type QuadroEntrada = z.infer<typeof quadroEntrada>;

export const cartaoNovoEntrada = z.object({
  empresaId: z.number().int().positive(),
  colunaId: z.number().int().positive(),
});

export const cartaoMoverEntrada = z.object({ colunaId: z.number().int().positive() });

export interface ColunaQuadro {
  id: number;
  nome: string;
  gatilho: string | null;
  cor: CorColuna;
}

export interface Quadro {
  id: number;
  nome: string;
  ia: boolean;
  confirmar: boolean;
  colunas: ColunaQuadro[];
  /** Sugestões da IA esperando alguém confirmar (das que esta pessoa vê). */
  sugestoes: number;
}

export interface CartaoQuadro {
  empresaId: number;
  nome: string;
  responsavelId: number | null;
  responsavelNome: string | null;
  /** Onde o lead está (null: ainda não entrou; só a sugestão). */
  colunaId: number | null;
  /** Para onde a IA sugere mover (esperando confirmar). */
  sugeridaId: number | null;
  /** Quem pôs na coluna atual (ou sugeriu). */
  origem: 'ia' | 'pessoa';
  /** O que o lead disse (palavra por palavra) e por que a IA moveu. */
  trecho: string | null;
  motivo: string | null;
  movidoEm: string;
  sugeridaEm: string | null;
  movidoPor: string | null;
  ultimaMensagemEm: string | null;
}

/* ───────────────────────────── A leitura da IA ───────────────────────────── */

export const movimentoGatilho = z.object({
  quadroId: z.number().int(),
  colunaId: z.number().int(),
  /** As palavras da mensagem que mostram o gatilho (copiadas da conversa). */
  trecho: z.string().trim().min(2).max(300),
  /** Uma frase: por que esse gatilho. */
  motivo: z.string().trim().min(2).max(300),
});
export type MovimentoGatilho = z.infer<typeof movimentoGatilho>;

/** Para comparar o trecho com a conversa: sem acento, caixa, pontuação e espaços repetidos. */
export function normalizarTrecho(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
