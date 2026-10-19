import { z } from 'zod';

/**
 * Contratos das filas: o único acoplamento entre serviços. Quem publica e quem
 * consome importam daqui, então um payload errado não compila. Mudou o formato?
 * Crie um job novo (ex.: "maps.buscar.v2") em vez de alterar este.
 */
export const JOBS = {
  /**
   * api / agendamento → worker-cnpj: importar a publicação mensal da Receita.
   * Sem importacaoId (disparo agendado), o worker cria o registro da importação.
   */
  'cnpj.importar': z.object({
    importacaoId: z.number().int().positive().optional(),
    /** AAAA-MM; sem ele, a publicação mais recente. */
    mes: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional(),
    motivo: z.enum(['manual', 'agendada']).default('agendada'),
  }),

  /** worker-cnpj → worker-descoberta: base atualizada, reprocessar campanhas ativas. */
  'cnpj.importacao_concluida': z.object({
    importacaoId: z.number().int().positive(),
  }),

  /** api → worker-descoberta: campanha iniciada ou retomada. */
  'campanha.iniciar': z.object({
    campanhaId: z.number().int().positive(),
  }),

  /** worker-descoberta (interno): trazer empresas da base de CNPJ para a campanha. */
  'campanha.buscar_cnpj': z.object({
    campanhaId: z.number().int().positive(),
  }),

  /** worker-descoberta (interno): disparar uma busca no Maps (cidade × termo). */
  'maps.buscar': z.object({
    buscaId: z.number().int().positive(),
  }),

  /** worker-descoberta (interno): conferir se o run do Apify terminou e coletar. */
  'maps.coletar': z.object({
    buscaId: z.number().int().positive(),
  }),

  /** worker-descoberta (interno): achar coordenadas e distância até a base. */
  'empresa.localizar': z.object({
    empresaId: z.number().int().positive(),
  }),

  /**
   * worker-descoberta / api → worker-enriquecimento: buscar quem decide e como falar com ele.
   * forcar: refaz mesmo se a empresa foi enriquecida há pouco (botão "Enriquecer de novo").
   */
  'enriquecimento.solicitar': z.object({
    empresaId: z.number().int().positive(),
    campanhaId: z.number().int().positive(),
    forcar: z.boolean().optional(),
  }),
} as const;

export type NomeJob = keyof typeof JOBS;
export type PayloadJob<N extends NomeJob> = z.infer<(typeof JOBS)[N]>;

/** Como cada fila se comporta: tentativas, espera entre tentativas e tempo máximo. */
export interface PoliticaFila {
  retryLimit: number;
  retryDelay: number;
  retryBackoff: boolean;
  expireInSeconds: number;
  /**
   * standard: sem restrição. short: no máximo 1 job na fila por chave (o payload
   * vira a chave), evita duplicados. exclusive: 1 job por vez, no total.
   */
  policy: 'standard' | 'short' | 'exclusive';
}

export const POLITICA_FILAS: Record<NomeJob, PoliticaFila> = {
  'cnpj.importar': {
    retryLimit: 2,
    retryDelay: 600,
    retryBackoff: false,
    expireInSeconds: 6 * 3600,
    policy: 'exclusive',
  },
  'cnpj.importacao_concluida': {
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 600,
    policy: 'standard',
  },
  'campanha.iniciar': {
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 300,
    policy: 'short',
  },
  'campanha.buscar_cnpj': {
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 1800,
    policy: 'short',
  },
  'maps.buscar': {
    retryLimit: 5,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 300,
    policy: 'standard',
  },
  'maps.coletar': {
    retryLimit: 5,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 900,
    policy: 'short',
  },
  'empresa.localizar': {
    retryLimit: 4,
    retryDelay: 120,
    retryBackoff: true,
    expireInSeconds: 120,
    policy: 'short',
  },
  'enriquecimento.solicitar': {
    retryLimit: 5,
    retryDelay: 120,
    retryBackoff: true,
    expireInSeconds: 900,
    policy: 'short',
  },
};
