import { AppError, ehAppError, type Logger, semSslmode, sslDoPostgres } from '@prospeccao/shared';
import { PgBoss } from 'pg-boss';
import { JOBS, type NomeJob, type PayloadJob, POLITICA_FILAS } from './contratos.js';

export { JOBS, type NomeJob, type PayloadJob, POLITICA_FILAS } from './contratos.js';

export interface OpcoesPublicar {
  /** Segundos até o job ficar disponível. */
  atrasoSegundos?: number;
  /** Evita jobs duplicados com a mesma chave enquanto um deles estiver na fila. */
  chaveUnica?: string;
  prioridade?: number;
}

export interface OpcoesConsumir {
  /** Jobs processados em paralelo por esta instância. */
  concorrencia?: number;
  /** Intervalo entre buscas por jobs, em segundos. */
  intervaloSegundos?: number;
}

export interface Filas {
  publicar<N extends NomeJob>(
    nome: N,
    payload: PayloadJob<N>,
    opcoes?: OpcoesPublicar,
  ): Promise<string | null>;
  consumir<N extends NomeJob>(
    nome: N,
    tratar: (payload: PayloadJob<N>, contexto: { jobId: string; tentativa: number }) => Promise<void>,
    opcoes?: OpcoesConsumir,
  ): Promise<void>;
  agendar<N extends NomeJob>(nome: N, cron: string, payload: PayloadJob<N>, fuso?: string): Promise<void>;
  tamanhos(nomes?: NomeJob[]): Promise<Record<string, number>>;
  parar(): Promise<void>;
}

/** Chave estável a partir do payload (chaves ordenadas). */
export function chavePayload(dados: object): string {
  return JSON.stringify(Object.fromEntries(Object.entries(dados).sort(([a], [b]) => a.localeCompare(b))));
}

/** Erro que não adianta repetir: o job vai direto para falha. */
export class ErroDefinitivo extends Error {
  override name = 'ErroDefinitivo';
}

/**
 * Filas sobre o Postgres (pg-boss, schema "fila"). Valida o payload ao publicar
 * e ao consumir, cria as filas com a política de cada uma e registra erros
 * com o contexto do job.
 */
export async function conectarFilas(opcoes: {
  url: string;
  aplicacao: string;
  log: Logger;
  /** Filas que este serviço publica ou consome: são criadas se não existirem. */
  filas: NomeJob[];
}): Promise<Filas> {
  const { url, aplicacao, log } = opcoes;
  const boss = new PgBoss({
    connectionString: semSslmode(url),
    application_name: `${aplicacao}-fila`,
    schema: 'fila',
    max: 5,
    ssl: sslDoPostgres(url),
  });
  boss.on('error', (erro) => log.error({ err: erro }, 'erro interno da fila'));
  await boss.start();

  for (const nome of opcoes.filas) {
    if (!(await boss.getQueue(nome))) {
      await boss.createQueue(nome, { ...POLITICA_FILAS[nome] });
    }
  }

  return {
    async publicar(nome, payload, op = {}) {
      const dados = JOBS[nome].parse(payload);
      // Em filas "short" a chave separa os jobs: sem ela, só caberia 1 job na fila inteira.
      const chave =
        op.chaveUnica ?? (POLITICA_FILAS[nome].policy === 'short' ? chavePayload(dados) : undefined);
      return boss.send(nome, dados, {
        ...(op.atrasoSegundos ? { startAfter: op.atrasoSegundos } : {}),
        ...(chave ? { singletonKey: chave } : {}),
        ...(op.prioridade != null ? { priority: op.prioridade } : {}),
      });
    },

    async consumir(nome, tratar, op = {}) {
      await boss.work<PayloadJob<typeof nome>>(
        nome,
        {
          batchSize: 1,
          localConcurrency: op.concorrencia ?? 1,
          pollingIntervalSeconds: op.intervaloSegundos ?? 2,
        },
        async (jobs) => {
          for (const job of jobs) {
            const parse = JOBS[nome].safeParse(job.data);
            if (!parse.success) {
              log.error(
                { fila: nome, jobId: job.id, erros: parse.error.issues },
                'payload inválido; job descartado',
              );
              continue; // repetir não conserta payload errado
            }
            const inicio = Date.now();
            try {
              await tratar(parse.data as PayloadJob<typeof nome>, {
                jobId: job.id,
                tentativa: job.retryCount,
              });
              log.debug({ fila: nome, jobId: job.id, ms: Date.now() - inicio }, 'job concluído');
            } catch (erro) {
              const definitivo = erro instanceof ErroDefinitivo || (ehAppError(erro) && !erro.repetivel);
              log.error(
                { fila: nome, jobId: job.id, tentativa: job.retryCount, definitivo, err: erro },
                'job falhou',
              );
              if (definitivo) continue; // conclui sem repetir; o handler já registrou o erro no domínio
              throw erro;
            }
          }
        },
      );
      log.info({ fila: nome }, 'consumindo fila');
    },

    async agendar(nome, cron, payload, fuso = 'America/Sao_Paulo') {
      await boss.schedule(nome, cron, JOBS[nome].parse(payload), { tz: fuso, key: 'padrao' });
    },

    async tamanhos(nomes) {
      const filas = await boss.getQueues(nomes);
      return Object.fromEntries(filas.map((f) => [f.name, f.queuedCount + f.activeCount]));
    },

    async parar() {
      await boss.stop({ graceful: true, timeout: 20_000 });
    },
  };
}

/** Garante que o processo encerra limpo no deploy (SIGTERM do Railway). */
export function encerrarAoReceberSinal(log: Logger, fechar: () => Promise<void>) {
  let encerrando = false;
  const sair = async (sinal: string) => {
    if (encerrando) return;
    encerrando = true;
    log.info({ sinal }, 'encerrando');
    try {
      await fechar();
      process.exit(0);
    } catch (erro) {
      log.error({ err: erro }, 'erro ao encerrar');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void sair('SIGTERM'));
  process.on('SIGINT', () => void sair('SIGINT'));
}

export { AppError };
