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
  /** Libera jobs que ficaram "ativos" porque o processo anterior morreu. Devolve quantos. */
  liberarTravados(nome: NomeJob): Promise<number>;
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

/** Schema do pg-boss no Postgres. */
export const SCHEMA_FILAS = 'fila';

/** Job ainda não terminado: esperando, rodando ou aguardando nova tentativa depois de uma falha. */
export interface JobAberto {
  estado: 'na_fila' | 'rodando' | 'nova_tentativa';
  /** Tentativas já falhas (0 na primeira execução). */
  falhas: number;
  limiteTentativas: number;
  /** Quando roda (na fila / nova tentativa) ou quando começou (rodando). */
  quando: string;
  criadoEm: string;
  dados: unknown;
}

const ESTADO_JOB: Record<string, JobAberto['estado']> = {
  created: 'na_fila',
  retry: 'nova_tentativa',
  active: 'rodando',
};

/**
 * Jobs abertos de uma fila, lidos direto da tabela do pg-boss (só leitura). Serve para a tela de
 * atividade mostrar "nova tentativa às 23:56" sem depender do serviço que consome a fila.
 */
export async function jobsAbertos(
  db: { query: (sql: string, valores?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
  nome: NomeJob,
  limite = 20,
): Promise<JobAberto[]> {
  const { rows } = await db.query(
    // Em 'retry', started_on ainda é o da tentativa que falhou: a hora da próxima é start_after.
    `SELECT state, retry_count, retry_limit,
            CASE WHEN state = 'active' THEN coalesce(started_on, start_after) ELSE start_after END AS quando,
            created_on, data
       FROM ${SCHEMA_FILAS}.job
      WHERE name = $1 AND state IN ('created', 'retry', 'active')
      ORDER BY created_on DESC
      LIMIT $2`,
    [nome, limite],
  );
  return rows.map((r) => ({
    estado: ESTADO_JOB[String(r.state)] ?? 'na_fila',
    // O pg-boss só soma retry_count quando a nova tentativa começa: em 'retry', já houve uma falha a mais.
    falhas: Number(r.retry_count) + (r.state === 'retry' ? 1 : 0),
    limiteTentativas: Number(r.retry_limit),
    quando: new Date(r.quando as string).toISOString(),
    criadoEm: new Date(r.created_on as string).toISOString(),
    dados: r.data,
  }));
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
    schema: SCHEMA_FILAS,
    max: 5,
    ssl: sslDoPostgres(url),
  });
  boss.on('error', (erro) => log.error({ err: erro }, 'erro interno da fila'));
  await boss.start();

  for (const nome of opcoes.filas) {
    const { policy, ...ajustaveis } = POLITICA_FILAS[nome];
    if (!(await boss.getQueue(nome))) {
      await boss.createQueue(nome, { policy, ...ajustaveis });
    } else {
      // Fila já existe: aplica tentativas, tempos e heartbeat novos (a política não muda depois de criada).
      await boss.updateQueue(nome, { ...ajustaveis, heartbeatSeconds: ajustaveis.heartbeatSeconds ?? null });
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

    async liberarTravados(nome) {
      // Jobs criados antes de uma mudança de política guardam o limite antigo de tentativas:
      // os que ainda estão abertos passam a ter o limite atual.
      await boss.getDb().executeSql(
        `UPDATE ${SCHEMA_FILAS}.job SET retry_limit = $2
          WHERE name = $1 AND state IN ('created', 'retry', 'active') AND retry_limit < $2`,
        [nome, POLITICA_FILAS[nome].retryLimit],
      );
      // Chamado no início do serviço que é o único consumidor da fila: nada pode estar rodando aqui,
      // então job "ativo" é sobra de um processo que morreu (deploy). Falhar libera nova tentativa.
      const ativos = (await boss.findJobs(nome)).filter((j) => j.state === 'active').map((j) => j.id);
      if (ativos.length) {
        await boss.fail(nome, ativos, { motivo: 'serviço reiniciou no meio do job' });
        log.warn(
          { fila: nome, jobs: ativos.length },
          'jobs interrompidos por reinício liberados para nova tentativa',
        );
      }
      return ativos.length;
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
