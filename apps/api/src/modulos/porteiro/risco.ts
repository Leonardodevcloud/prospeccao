import type { Pool } from '@prospeccao/db';
import { type Logger, PAUSA_RISCO_HORAS, PEDIU_PARA_PARAR } from '@prospeccao/shared';
import { comConta } from '../../contexto.js';
import * as alertas from '../alertas/repositorio.js';
import { registrar } from './regras.js';

/**
 * Sinais de risco do número (a cada 5 minutos, nas contas com o porteiro ligado): gente pedindo
 * para parar ou falando em denunciar, e contatos novos que quase ninguém responde. Com um deles, o
 * número fica algumas horas sem abordar contatos novos (equipe e automáticos) e os administradores
 * recebem um alerta. Responder quem já conversa continua. Só conta o que veio depois da última pausa.
 */

const LOCK = 860_118;
/** Pedidos para parar (leads diferentes) em 24 h que pausam. */
export const PEDIDOS_PARA_PAUSAR = 3;
/** Contatos novos em 24 h a partir dos quais a taxa de resposta conta, e a taxa mínima. */
export const NOVOS_PARA_MEDIR = 20;
export const RESPOSTA_MINIMA = 0.05;

interface ChipRisco {
  id: number;
  conta_id: number;
  nome: string;
  desde: Date;
}

/** O que há de risco neste número (null: nada). */
async function sinalDeRisco(pool: Pool, c: ChipRisco): Promise<string | null> {
  const { rows: recebidas } = await pool.query<{ empresa_id: string; texto: string }>(
    `SELECT empresa_id, texto FROM comercial.mensagens
      WHERE conta_id = $1 AND chip_id = $2 AND direcao = 'recebida' AND criado_em > $3
      ORDER BY id DESC LIMIT 3000`,
    [c.conta_id, c.id, c.desde],
  );
  const pediram = new Set(recebidas.filter((m) => PEDIU_PARA_PARAR.test(m.texto)).map((m) => m.empresa_id));
  if (pediram.size >= PEDIDOS_PARA_PAUSAR)
    return `${pediram.size} contatos pediram para parar ou falaram em denunciar nas últimas 24 horas`;

  const { rows: novos } = await pool.query<{ novos: number; responderam: number }>(
    `WITH primeiras AS (
       SELECT m.empresa_id, min(coalesce(m.enviado_em, m.criado_em)) AS em
         FROM comercial.mensagens m
        WHERE m.conta_id = $1 AND m.chip_id = $2 AND m.direcao = 'enviada' AND m.status = 'enviada'
          AND coalesce(m.enviado_em, m.criado_em) > $3
        GROUP BY m.empresa_id),
     frias AS (
       SELECT p.* FROM primeiras p
        WHERE NOT EXISTS (SELECT 1 FROM comercial.mensagens a
                           WHERE a.conta_id = $1 AND a.empresa_id = p.empresa_id
                             AND a.status IN ('enviada', 'recebida') AND coalesce(a.enviado_em, a.criado_em) < p.em)
          -- Quem foi abordado há pouco ainda não teve tempo de responder.
          AND p.em < now() - interval '2 hours')
     SELECT count(*)::int AS novos,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM comercial.mensagens r
                                             WHERE r.conta_id = $1 AND r.empresa_id = f.empresa_id
                                               AND r.direcao = 'recebida' AND r.criado_em > f.em))::int AS responderam
       FROM frias f`,
    [c.conta_id, c.id, c.desde],
  );
  const n = novos[0];
  if (n && n.novos >= NOVOS_PARA_MEDIR && n.responderam / n.novos < RESPOSTA_MINIMA)
    return `${n.responderam} de ${n.novos} contatos novos responderam nas últimas 24 horas (quase ninguém: sinal de mensagem que incomoda)`;
  return null;
}

export async function rodadaRisco(pool: Pool, log: Logger): Promise<number> {
  const cliente = await pool.connect();
  let pausados = 0;
  try {
    const { rows: trava } = await cliente.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [
      LOCK,
    ]);
    if (!trava[0]?.ok) return 0;
    try {
      const { rows } = await cliente.query<ChipRisco>(
        `SELECT c.id, c.conta_id, c.nome,
                greatest(now() - interval '24 hours', coalesce(c.frios_ate, '-infinity'::timestamptz)) AS desde
           FROM comercial.chips c
           JOIN comercial.porteiro p ON p.conta_id = c.conta_id AND p.ativo AND p.pausar_risco
          WHERE c.ativo AND (c.frios_ate IS NULL OR c.frios_ate <= now())`,
      );
      for (const c of rows)
        await comConta(c.conta_id, async () => {
          const motivo = await sinalDeRisco(pool, c);
          if (!motivo) return;
          await pool.query(
            `UPDATE comercial.chips SET frios_ate = now() + make_interval(hours => $2), frios_motivo = $3
              WHERE id = $1 AND (frios_ate IS NULL OR frios_ate <= now())`,
            [c.id, PAUSA_RISCO_HORAS, motivo.slice(0, 300)],
          );
          await registrar(pool, { tipo: 'risco', chipId: c.id, empresaId: null, detalhe: motivo });
          await alertas.abrir(pool, c.conta_id, `porteiro:${c.id}`, {
            nivel: 'aviso',
            titulo: `O número “${c.nome}” parou de abordar contatos novos por ${PAUSA_RISCO_HORAS} horas`,
            texto: `${motivo}. Responder quem já conversa continua normal. Revise a mensagem de abordagem antes de voltar; dá para liberar antes em Agente › Atendimento › Proteção do número.`,
            link: '/agente',
          });
          pausados++;
        }).catch((e) => log.warn({ err: e, chip: c.id }, 'porteiro: conferência de risco falhou'));
      return pausados;
    } finally {
      await cliente.query('SELECT pg_advisory_unlock($1)', [LOCK]);
    }
  } finally {
    cliente.release();
  }
}

export function iniciarPorteiro(d: { pool: Pool; log: Logger }): () => void {
  let rodando = false;
  const t = setInterval(() => {
    if (rodando) return;
    rodando = true;
    void rodadaRisco(d.pool, d.log)
      .catch((e) => d.log.warn({ err: e }, 'porteiro: rodada falhou'))
      .finally(() => {
        rodando = false;
      });
  }, 5 * 60_000);
  t.unref();
  return () => clearInterval(t);
}
