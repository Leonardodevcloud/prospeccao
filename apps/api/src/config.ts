import { carregarEnv, envBase, opcional } from '@prospeccao/config';
import { z } from 'zod';

export const esquemaEnvApi = envBase.extend({
  PORT: z.coerce.number().int().default(3000),
  /** Origem(ns) do web, separadas por vírgula. Requisições que alteram dados de outra origem são recusadas. */
  APP_ORIGENS: z
    .string({ message: 'Informe APP_ORIGENS, ex.: https://prospeccao.vercel.app' })
    .transform((v) =>
      v
        .split(',')
        .map((o) => o.trim().replace(/\/$/, '').toLowerCase())
        .filter(Boolean),
    )
    .refine((l) => l.length > 0, 'Informe APP_ORIGENS, ex.: https://prospeccao.vercel.app'),
  JWT_SEGREDO: z.string().min(32, 'JWT_SEGREDO precisa ter pelo menos 32 caracteres'),
  ADMIN_EMAIL: z
    .string()
    .email()
    .transform((v) => v.toLowerCase()),
  /** Hash bcrypt da senha. Gere com: pnpm --filter @prospeccao/api hash-senha */
  ADMIN_SENHA_HASH: z
    .string()
    .regex(/^\$2[aby]\$\d{2}\$.{53}$/, 'ADMIN_SENHA_HASH precisa ser um hash bcrypt'),
  SESSAO_HORAS: z.coerce.number().int().min(1).max(720).default(12),
  /** Opcional: geocodifica o endereço das bases de operação. */
  ORS_API_KEY: opcional(z.string().min(10)),
  /** Agente de abordagem: envio pelo chip (Evolution) e IA (Gemini). Sem eles, o agente não envia/responde. */
  EVOLUTION_URL: opcional(z.string().url()),
  EVOLUTION_API_KEY: opcional(z.string().min(4)),
  EVOLUTION_INSTANCIA: opcional(z.string().min(1)),
  GEMINI_API_KEY: opcional(z.string().min(10)),
  GEMINI_MODELO: z.string().default('gemini-3.5-flash-lite'),
});

export type EnvApi = z.infer<typeof esquemaEnvApi>;

export function carregarEnvApi(): EnvApi {
  return carregarEnv(esquemaEnvApi);
}
