import { z } from 'zod';

/** Etapas do funil, na ordem em que o lead avança. "descartado" fica fora do quadro. */
export const ETAPAS_FUNIL = [
  'a_abordar',
  'abordado',
  'respondeu',
  'reuniao',
  'proposta',
  'ganho',
  'perdido',
  'descartado',
] as const;
export type EtapaFunil = (typeof ETAPAS_FUNIL)[number];

/** Etapas que aparecem como colunas do quadro. */
export const COLUNAS_FUNIL = ETAPAS_FUNIL.filter((e) => e !== 'descartado');

/** Ordem de avanço: o lead nunca "volta" sozinho para uma etapa anterior. */
export const ORDEM_ETAPA: Record<EtapaFunil, number> = {
  a_abordar: 0,
  abordado: 1,
  respondeu: 2,
  reuniao: 3,
  proposta: 4,
  ganho: 5,
  perdido: 5,
  descartado: 5,
};

export const ROTULO_ETAPA: Record<EtapaFunil, string> = {
  a_abordar: 'A abordar',
  abordado: 'Abordado',
  respondeu: 'Respondeu',
  reuniao: 'Reunião',
  proposta: 'Proposta',
  ganho: 'Ganho',
  perdido: 'Perdido',
  descartado: 'Descartado',
};

export const TIPOS_ATIVIDADE = ['whatsapp', 'ligacao', 'email', 'visita', 'reuniao', 'nota'] as const;
export type TipoAtividade = (typeof TIPOS_ATIVIDADE)[number];

const texto = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null);

const dataOpcional = z
  .union([z.string().datetime({ offset: true }), z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()])
  .transform((v) => (v ? new Date(v.length === 10 ? `${v}T12:00:00-03:00` : v).toISOString() : null));

/** Mandar leads para o funil (ou descartar) em lote. */
export const funilAdicionar = z.object({
  empresaIds: z.array(z.number().int().positive()).min(1, 'Escolha ao menos um lead.').max(500),
  etapa: z.enum(['a_abordar', 'descartado']).default('a_abordar'),
  motivo: texto(300).optional(),
  /** Adiciona mesmo se o telefone já estiver em outra empresa do funil. */
  forcar: z.boolean().default(false),
});
export type FunilAdicionar = z.infer<typeof funilAdicionar>;

export const funilAtualizar = z
  .object({
    etapa: z.enum(ETAPAS_FUNIL).optional(),
    /** Coloca o card antes deste (mesma coluna); sem ele, vai para o fim. */
    antesDe: z.number().int().positive().nullable().optional(),
    motivo: texto(300).optional(),
    valorMensal: z.number().min(0).max(10_000_000).nullable().optional(),
    proximaAcao: texto(200).optional(),
    proximaAcaoEm: dataOpcional.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nada para atualizar.');
export type FunilAtualizar = z.infer<typeof funilAtualizar>;

export const atividadeEntrada = z.object({
  tipo: z.enum(TIPOS_ATIVIDADE),
  direcao: z.enum(['enviada', 'recebida']).nullable().default(null),
  texto: texto(4000).optional(),
  contato: texto(200).optional(),
  /** Já marca o próximo passo junto com o registro. */
  proximaAcao: texto(200).optional(),
  proximaAcaoEm: dataOpcional.optional(),
});
export type AtividadeEntrada = z.infer<typeof atividadeEntrada>;

export const filtrosFunil = z.object({
  campanhaId: z.coerce.number().int().positive().optional(),
  faixa: z.enum(['A', 'B', 'C']).optional(),
  busca: z.string().trim().max(120).optional(),
  /** Só quem tem próximo passo vencido ou para hoje. */
  pendentes: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type FiltrosFunil = z.infer<typeof filtrosFunil>;

export const filtrosRelatorio = z.object({
  /** Dias para trás (0 = desde o começo). */
  dias: z.coerce.number().int().min(0).max(3650).default(30),
  campanhaId: z.coerce.number().int().positive().optional(),
});
export type FiltrosRelatorio = z.infer<typeof filtrosRelatorio>;
