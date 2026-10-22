import type { Executor } from '@prospeccao/db';
import { contaSql } from '../../contexto.js';

/**
 * Números do agente no período: quanto a IA atendeu, o que conseguiu (reuniões, retornos), quando
 * passou para o time e por quê, o que as verificações barraram e o que a equipe ensinou.
 */
export async function desempenho(db: Executor, dias: number) {
  const C = contaSql();
  const desde = `now() - make_interval(days => $1)`;
  const [n, passagens, baseMaisUsada] = await Promise.all([
    db.query<{
      leadsAtendidos: number;
      respostas: number;
      reunioes: number;
      retornos: number;
      semInteresse: number;
      passagens: number;
      corrigidas: number;
      barradas: number;
      lacunas: number;
      ensinadas: number;
      aprendidas: number;
      tempoRespostaSeg: number | null;
    }>(
      `SELECT
         (SELECT count(DISTINCT empresa_id) FROM comercial.mensagens
           WHERE conta_id = ${C} AND origem = 'agente' AND status = 'enviada' AND enviado_em > ${desde})::int AS "leadsAtendidos",
         (SELECT count(*) FROM comercial.mensagens
           WHERE conta_id = ${C} AND origem = 'agente' AND status = 'enviada' AND enviado_em > ${desde})::int AS respostas,
         (SELECT count(*) FROM comercial.atividades
           WHERE conta_id = ${C} AND tipo = 'reuniao' AND autor = 'agente' AND criado_em > ${desde})::int AS reunioes,
         (SELECT count(*) FROM comercial.atividades
           WHERE conta_id = ${C} AND tipo = 'nota' AND autor = 'agente'
             AND texto LIKE 'A IA combinou retomar%' AND criado_em > ${desde})::int AS retornos,
         (SELECT count(*) FROM comercial.atividades
           WHERE conta_id = ${C} AND tipo = 'etapa' AND autor = 'agente' AND para_etapa = 'perdido'
             AND criado_em > ${desde})::int AS "semInteresse",
         (SELECT count(*) FROM comercial.passagens_ia WHERE conta_id = ${C} AND criado_em > ${desde})::int AS passagens,
         (SELECT count(*) FROM comercial.verificacoes_ia
           WHERE conta_id = ${C} AND resultado = 'reescrita' AND criado_em > ${desde})::int AS corrigidas,
         (SELECT count(*) FROM comercial.verificacoes_ia
           WHERE conta_id = ${C} AND resultado = 'bloqueada' AND criado_em > ${desde})::int AS barradas,
         (SELECT count(*) FROM comercial.lacunas_ia WHERE conta_id = ${C} AND criado_em > ${desde})::int AS lacunas,
         (SELECT count(*) FROM comercial.lacunas_ia
           WHERE conta_id = ${C} AND conhecimento_id IS NOT NULL AND resolvida_em > ${desde})::int AS ensinadas,
         (SELECT count(*) FROM comercial.conhecimento
           WHERE conta_id = ${C} AND origem = 'conversa' AND status = 'ativo' AND atualizado_em > ${desde})::int AS aprendidas,
         -- da mensagem do lead até a resposta da IA sair (mediana)
         (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM m.enviado_em - r.criado_em))
            FROM comercial.mensagens m
            CROSS JOIN LATERAL (SELECT max(x.criado_em) AS criado_em FROM comercial.mensagens x
                                 WHERE x.conta_id = m.conta_id AND x.empresa_id = m.empresa_id
                                   AND x.direcao = 'recebida' AND x.criado_em < m.criado_em) r
           WHERE m.conta_id = ${C} AND m.origem = 'agente' AND m.status = 'enviada'
             AND m.enviado_em > ${desde} AND r.criado_em > m.criado_em - interval '1 hour')::float8 AS "tempoRespostaSeg"`,
      [dias],
    ),
    db.query<{ tipo: string; n: number }>(
      `SELECT tipo, count(*)::int AS n FROM comercial.passagens_ia
        WHERE conta_id = ${C} AND criado_em > ${desde} GROUP BY tipo ORDER BY n DESC`,
      [dias],
    ),
    db.query<{ id: number; titulo: string; pergunta: string | null; usos: number }>(
      `SELECT id::int, titulo, pergunta, usos FROM comercial.conhecimento
        WHERE conta_id = ${C} AND status = 'ativo' AND usos > 0 ORDER BY usos DESC LIMIT 5`,
    ),
  ]);
  return { dias, numeros: n.rows[0]!, passagensPorTipo: passagens.rows, baseMaisUsada: baseMaisUsada.rows };
}
