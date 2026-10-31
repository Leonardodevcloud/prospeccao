import { type ServicoExterno, servicoDoEndereco } from '@prospeccao/shared';
import type { Executor } from './pool.js';

/**
 * Medidor das chamadas para fora (api e workers): cada `fetch` para um serviço que a plataforma paga
 * (IA, Z-API, LiveKit, Serper…) é contado por minuto, com os erros, o tempo de resposta e o último
 * erro. A tela Saúde e consumo lê isso. O site de um lead (enriquecimento) não entra: só endereços
 * conhecidos (`servicoDoEndereco`). Medir nunca derruba a chamada.
 */

interface Balde {
  chamadas: number;
  erros: number;
  msTotal: number;
  msMax: number;
}

interface Estado {
  okEm: number | null;
  erroEm: number | null;
  erro: string | null;
  /** Erros seguidos (zera no primeiro sucesso; continua entre uma gravação e outra). */
  seguidos: number;
  /** Mudou desde a última gravação. */
  sujo: boolean;
}

/** Erros que dizem que o serviço não está atendendo (o resto é pedido errado nosso ou "não achei"). */
const STATUS_ERRO = new Set([401, 402, 403, 429]);

const baldes = new Map<string, Balde>();
const estados = new Map<ServicoExterno, Estado>();
let instalado = false;

function minutoDe(ms: number): string {
  return new Date(Math.floor(ms / 60_000) * 60_000).toISOString();
}

/** Registra uma chamada (exportado para os testes e para quem não usa fetch). */
export function registrarChamada(servico: ServicoExterno, ms: number, erro: string | null, em = Date.now()) {
  const k = `${servico}|${minutoDe(em)}`;
  const b = baldes.get(k) ?? { chamadas: 0, erros: 0, msTotal: 0, msMax: 0 };
  b.chamadas++;
  if (erro) b.erros++;
  b.msTotal += Math.round(ms);
  b.msMax = Math.max(b.msMax, Math.round(ms));
  baldes.set(k, b);
  const e = estados.get(servico) ?? { okEm: null, erroEm: null, erro: null, seguidos: 0, sujo: false };
  e.sujo = true;
  if (erro) {
    e.erroEm = em;
    e.erro = erro.slice(0, 300);
    e.seguidos++;
  } else {
    e.okEm = em;
    e.seguidos = 0;
  }
  estados.set(servico, e);
}

function instalarNoFetch() {
  if (instalado || typeof globalThis.fetch !== 'function') return;
  instalado = true;
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (entrada: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    const servico = servicoDoEndereco(url);
    if (!servico) return original(entrada, init);
    const inicio = performance.now();
    try {
      const r = await original(entrada, init);
      const ms = performance.now() - inicio;
      if (r.status >= 500 || STATUS_ERRO.has(r.status)) {
        // Lê um pedaço da resposta de uma cópia (quem chamou continua lendo a original).
        const copia = r.clone();
        void copia
          .text()
          .catch(() => '')
          .then((t) =>
            registrarChamada(
              servico,
              ms,
              `HTTP ${r.status}${t ? ` ${t.replace(/\s+/g, ' ').slice(0, 200)}` : ''}`,
            ),
          );
      } else registrarChamada(servico, ms, null);
      return r;
    } catch (erro) {
      const e = erro as Error;
      registrarChamada(
        servico,
        performance.now() - inicio,
        e?.name === 'TimeoutError' || e?.name === 'AbortError'
          ? 'sem resposta (tempo esgotado)'
          : `sem resposta (${e?.message ?? e})`,
      );
      throw erro;
    }
  };
}

/** Grava o que foi medido desde a última vez (soma no minuto, se outra execução já gravou). */
export async function gravarMedicoes(db: Executor): Promise<void> {
  if (baldes.size) {
    const linhas = [...baldes.entries()];
    baldes.clear();
    const servicos: string[] = [];
    const minutos: string[] = [];
    const chamadas: number[] = [];
    const erros: number[] = [];
    const msTotal: number[] = [];
    const msMax: number[] = [];
    for (const [k, b] of linhas) {
      const [s, m] = k.split('|');
      servicos.push(s!);
      minutos.push(m!);
      chamadas.push(b.chamadas);
      erros.push(b.erros);
      msTotal.push(b.msTotal);
      msMax.push(b.msMax);
    }
    try {
      await db.query(
        `INSERT INTO cadastro.servicos_uso (servico, minuto, chamadas, erros, ms_total, ms_max)
         SELECT * FROM unnest($1::text[], $2::timestamptz[], $3::int[], $4::int[], $5::bigint[], $6::int[])
         ON CONFLICT (servico, minuto) DO UPDATE SET
           chamadas = servicos_uso.chamadas + EXCLUDED.chamadas,
           erros = servicos_uso.erros + EXCLUDED.erros,
           ms_total = servicos_uso.ms_total + EXCLUDED.ms_total,
           ms_max = greatest(servicos_uso.ms_max, EXCLUDED.ms_max)`,
        [servicos, minutos, chamadas, erros, msTotal, msMax],
      );
    } catch {
      // Banco fora: devolve para a próxima vez (sem crescer sem limite).
      if (baldes.size < 5_000)
        for (const [k, b] of linhas) {
          const a = baldes.get(k);
          baldes.set(
            k,
            a
              ? {
                  chamadas: a.chamadas + b.chamadas,
                  erros: a.erros + b.erros,
                  msTotal: a.msTotal + b.msTotal,
                  msMax: Math.max(a.msMax, b.msMax),
                }
              : b,
          );
        }
    }
  }
  for (const [servico, e] of estados) {
    if (!e.sujo) continue;
    e.sujo = false;
    await db
      .query(
        `INSERT INTO cadastro.servicos_estado (servico, ultimo_ok_em, ultimo_erro_em, ultimo_erro, erros_seguidos, atualizado_em)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (servico) DO UPDATE SET
           ultimo_ok_em = greatest(servicos_estado.ultimo_ok_em, EXCLUDED.ultimo_ok_em),
           ultimo_erro = CASE WHEN EXCLUDED.ultimo_erro_em > coalesce(servicos_estado.ultimo_erro_em, '-infinity')
                              THEN EXCLUDED.ultimo_erro ELSE servicos_estado.ultimo_erro END,
           ultimo_erro_em = greatest(servicos_estado.ultimo_erro_em, EXCLUDED.ultimo_erro_em),
           erros_seguidos = EXCLUDED.erros_seguidos,
           atualizado_em = now()`,
        [servico, e.okEm ? new Date(e.okEm) : null, e.erroEm ? new Date(e.erroEm) : null, e.erro, e.seguidos],
      )
      .catch(() => {
        e.sujo = true;
      });
  }
}

/**
 * Liga o medidor neste processo: passa a contar os `fetch` para os serviços conhecidos e grava a
 * cada 15 segundos. Devolve a função que para (gravando o que faltou).
 */
export function iniciarMedidor(db: Executor): () => Promise<void> {
  instalarNoFetch();
  const t = setInterval(() => void gravarMedicoes(db), 15_000);
  t.unref();
  return async () => {
    clearInterval(t);
    await gravarMedicoes(db).catch(() => undefined);
  };
}
