import { type Logger, pino } from 'pino';

export type { Logger };

/** Logger JSON (pino) com o nome do serviço em todo registro. */
export function criarLogger(servico: string, nivel: string = process.env.LOG_LEVEL ?? 'info'): Logger {
  return pino({
    name: servico,
    level: nivel,
    base: { servico },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ['req.headers.cookie', 'req.headers.authorization', '*.senha', '*.token', '*.apiKey'],
      remove: true,
    },
  });
}
