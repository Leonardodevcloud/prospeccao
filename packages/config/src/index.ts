import { z } from 'zod';

/**
 * Variáveis comuns a todos os serviços. Cada serviço estende com as suas
 * e valida no boot: se faltar algo, o processo para com a lista do que falta.
 */
export const envBase = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url({ message: 'DATABASE_URL precisa ser uma URL postgres' }),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type EnvBase = z.infer<typeof envBase>;

export function carregarEnv<T extends z.ZodType>(
  schema: T,
  fonte: NodeJS.ProcessEnv = process.env,
): z.infer<T> {
  const resultado = schema.safeParse(fonte);
  if (resultado.success) return resultado.data;
  const linhas = resultado.error.issues.map((i) => `  - ${i.path.join('.') || '(raiz)'}: ${i.message}`);
  // Sem logger aqui: o logger depende da config. Falha cedo e com clareza.
  console.error(`Configuração inválida:\n${linhas.join('\n')}`);
  process.exit(1);
}

/** "BA,PE , al" → ["BA","PE","AL"] */
export const listaCsv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
  );

export const booleano = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

/** Variável opcional: string vazia no .env conta como ausente. */
export function opcional<T extends z.ZodType>(schema: T) {
  return z.preprocess((v) => (v === '' ? undefined : v), schema.optional());
}
