import { type Logger, pino } from 'pino';

export type { Logger };

/** "18/10 23:46:05" no horário de São Paulo, o mesmo que o operador vê no relógio. */
const horaLocal = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/**
 * Logger JSON (pino) com o nome do serviço em todo registro. O horário vai no fuso de São Paulo
 * (campo "hora"), para não aparecer a hora UTC de Londres ao lado da hora local do painel.
 */
export function criarLogger(servico: string, nivel: string = process.env.LOG_LEVEL ?? 'info'): Logger {
  return pino({
    level: nivel,
    base: { servico },
    timestamp: () => `,"hora":"${horaLocal.format(new Date()).replace(',', '')}"`,
    redact: {
      paths: ['req.headers.cookie', 'req.headers.authorization', '*.senha', '*.token', '*.apiKey'],
      remove: true,
    },
  });
}
