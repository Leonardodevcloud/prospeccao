import { AppError } from '@prospeccao/shared';
import type { Executor } from './pool.js';

/**
 * Consumo de cada conta: o que ela gasta de IA (chamadas e tokens, pela chave dela ou pela da
 * plataforma), e o teto do mês. A IA da plataforma é a sua chave: o teto vale só para ela.
 */

export const DIA_SP = `(now() AT TIME ZONE 'America/Sao_Paulo')::date`;
export const INICIO_MES_SP = `date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date`;
/** Começo do mês em São Paulo como instante (para comparar com timestamptz). */
export const INICIO_MES_SP_TS = `(date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')`;

type OrigemIa = 'conta' | 'plataforma';

async function registrar(
  db: Executor,
  contaId: number,
  origem: OrigemIa,
  d: { chamadas?: number; entrada?: number; saida?: number; erros?: number; bloqueadas?: number },
): Promise<void> {
  await db.query(
    `INSERT INTO cadastro.consumo_ia (conta_id, dia, origem, chamadas, tokens_entrada, tokens_saida, erros, bloqueadas)
     VALUES ($1, ${DIA_SP}, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (conta_id, dia, origem) DO UPDATE SET
       chamadas = consumo_ia.chamadas + EXCLUDED.chamadas,
       tokens_entrada = consumo_ia.tokens_entrada + EXCLUDED.tokens_entrada,
       tokens_saida = consumo_ia.tokens_saida + EXCLUDED.tokens_saida,
       erros = consumo_ia.erros + EXCLUDED.erros,
       bloqueadas = consumo_ia.bloqueadas + EXCLUDED.bloqueadas`,
    [
      contaId,
      origem,
      d.chamadas ?? 0,
      Math.round(d.entrada ?? 0),
      Math.round(d.saida ?? 0),
      d.erros ?? 0,
      d.bloqueadas ?? 0,
    ],
  );
}

/** Mais N buscas no Google (Serper) para a conta, hoje. Falha ao contar nunca derruba a busca. */
export async function contarBuscas(db: Executor, contaId: number, n = 1, servico = 'serper'): Promise<void> {
  await db
    .query(
      `INSERT INTO cadastro.consumo_buscas (conta_id, dia, servico, buscas) VALUES ($1, ${DIA_SP}, $2, $3)
       ON CONFLICT (conta_id, dia, servico) DO UPDATE SET buscas = consumo_buscas.buscas + EXCLUDED.buscas`,
      [contaId, servico, n],
    )
    .catch(() => undefined);
}

/** Chamadas à IA da plataforma neste mês e o teto da conta (null = sem teto). */
export async function usoIaDoMes(
  db: Executor,
  contaId: number,
): Promise<{ limite: number | null; usado: number }> {
  const { rows } = await db.query<{ limite: number | null; usado: number }>(
    `SELECT c.limite_ia_mes AS limite,
            coalesce((SELECT sum(u.chamadas) FROM cadastro.consumo_ia u
                       WHERE u.conta_id = c.id AND u.origem = 'plataforma' AND u.dia >= ${INICIO_MES_SP}), 0)::int AS usado
       FROM cadastro.contas c WHERE c.id = $1`,
    [contaId],
  );
  return rows[0] ?? { limite: null, usado: 0 };
}

/** Erro de teto: quem chama a IA trata como "IA indisponível" (pausa o lead, usa a regra…). */
export function limiteIaAtingido(limite: number): AppError {
  return new AppError(
    429,
    'limite_ia',
    `A IA desta conta chegou ao teto do mês (${limite} chamadas pela chave da plataforma). Fale com o administrador do sistema.`,
  );
}

/** Medidor da IA de uma conta (o formato que a camada de IA espera). */
export function medidorDeIa(db: Executor, contaId: number, origem: OrigemIa) {
  return {
    async antes(): Promise<void> {
      if (origem !== 'plataforma') return;
      const { limite, usado } = await usoIaDoMes(db, contaId);
      if (limite != null && usado >= limite) {
        await registrar(db, contaId, origem, { bloqueadas: 1 }).catch(() => undefined);
        throw limiteIaAtingido(limite);
      }
    },
    async depois(uso: { tokensEntrada: number; tokensSaida: number } | null, ok: boolean): Promise<void> {
      await registrar(db, contaId, origem, {
        chamadas: 1,
        entrada: uso?.tokensEntrada,
        saida: uso?.tokensSaida,
        erros: ok ? 0 : 1,
      });
    },
  };
}

/**
 * Sinal de vida de um serviço (api e workers), gravado a cada minuto: o painel de alertas avisa
 * quando um deles parou de dar sinal. Devolve a função que para.
 */
export function manterSinalDeVida(db: Executor, nome: string, info?: Record<string, unknown>): () => void {
  const gravar = () =>
    db
      .query(
        `INSERT INTO cadastro.servicos_vivos (nome, visto_em, iniciado_em, info) VALUES ($1, now(), now(), $2)
         ON CONFLICT (nome) DO UPDATE SET visto_em = now(), info = EXCLUDED.info`,
        [nome, info ? JSON.stringify(info) : null],
      )
      .catch(() => undefined);
  // A primeira gravação marca o início desta execução.
  void db
    .query(
      `INSERT INTO cadastro.servicos_vivos (nome, visto_em, iniciado_em, info) VALUES ($1, now(), now(), $2)
       ON CONFLICT (nome) DO UPDATE SET visto_em = now(), iniciado_em = now(), info = EXCLUDED.info`,
      [nome, info ? JSON.stringify(info) : null],
    )
    .catch(() => undefined);
  const t = setInterval(gravar, 60_000);
  t.unref();
  return () => clearInterval(t);
}
