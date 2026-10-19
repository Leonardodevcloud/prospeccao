import type { Executor } from '@prospeccao/db';
import type { FiltrosRelatorio } from '@prospeccao/shared';

/**
 * Relatórios (só leitura): o que as campanhas acharam, como os leads andaram no funil e se a
 * nota A/B/C acerta. Período: leads encontrados / atividades feitas nos últimos N dias.
 */

/** Etapa → ordem de avanço, em SQL (ganho conta como o fim do funil). */
const ORDEM_SQL = `CASE para_etapa WHEN 'a_abordar' THEN 0 WHEN 'abordado' THEN 1 WHEN 'respondeu' THEN 2
  WHEN 'reuniao' THEN 3 WHEN 'proposta' THEN 4 WHEN 'ganho' THEN 5 ELSE NULL END`;

export async function relatorio(db: Executor, f: FiltrosRelatorio) {
  const v = [f.dias, f.campanhaId ?? null];
  const noPeriodo = (col: string) => `($1::int = 0 OR ${col} >= now() - make_interval(days => $1::int))`;
  const daCampanha = (col: string) =>
    `($2::bigint IS NULL OR EXISTS (SELECT 1 FROM descoberta.campanha_empresas cx WHERE cx.empresa_id = ${col} AND cx.campanha_id = $2))`;

  // Leads encontrados no período (uma linha por empresa), com nota, decisor e WhatsApp.
  const LEADS = `
    SELECT e.id, l.faixa, l.status,
           EXISTS (SELECT 1 FROM enriquecimento.pessoas p WHERE p.empresa_id = e.id AND p.decisor) AS com_decisor,
           (SELECT p.fontes FROM enriquecimento.pessoas p WHERE p.empresa_id = e.id AND p.decisor LIMIT 1) AS fontes_decisor,
           EXISTS (SELECT 1 FROM enriquecimento.contatos w WHERE w.empresa_id = e.id AND w.canal = 'whatsapp'
                     AND w.status <> 'invalido') AS com_whatsapp
      FROM descoberta.empresas e
      LEFT JOIN enriquecimento.leads l ON l.empresa_id = e.id
     WHERE EXISTS (SELECT 1 FROM descoberta.campanha_empresas ce WHERE ce.empresa_id = e.id
                     AND ($2::bigint IS NULL OR ce.campanha_id = $2) AND ${noPeriodo('ce.adicionada_em')})`;

  // Até onde cada oportunidade chegou (pelo histórico de etapas), mesmo que depois tenha perdido.
  const ALCANCE = `
    SELECT o.empresa_id, o.etapa, o.faixa_entrada, o.valor_mensal, o.criado_em,
           coalesce((SELECT max(${ORDEM_SQL}) FROM comercial.atividades a
                      WHERE a.empresa_id = o.empresa_id AND a.tipo = 'etapa'), 0) AS alcance
      FROM comercial.oportunidades o
     WHERE o.etapa <> 'descartado' AND ${noPeriodo('o.criado_em')} AND ${daCampanha('o.empresa_id')}`;

  const [kpis, funil, campanhas, faixas, decisores, motivos, diario] = await Promise.all([
    db.query(
      `WITH leads AS (${LEADS}), alc AS (${ALCANCE}),
            atv AS (
              SELECT a.* FROM comercial.atividades a
               WHERE ${noPeriodo('a.criado_em')} AND ${daCampanha('a.empresa_id')})
       SELECT (SELECT count(*) FROM leads)::int AS encontrados,
              (SELECT count(*) FROM leads WHERE status = 'concluido')::int AS enriquecidos,
              (SELECT count(*) FROM leads WHERE faixa = 'A')::int AS "faixaA",
              (SELECT count(*) FROM leads WHERE faixa = 'B')::int AS "faixaB",
              (SELECT count(*) FROM leads WHERE faixa = 'C')::int AS "faixaC",
              (SELECT count(*) FROM leads WHERE com_decisor)::int AS "comDecisor",
              (SELECT count(*) FROM leads WHERE com_whatsapp)::int AS "comWhatsapp",
              (SELECT count(*) FROM alc)::int AS "entraramNoFunil",
              (SELECT count(DISTINCT empresa_id) FROM atv
                WHERE tipo NOT IN ('nota', 'etapa') AND direcao IS DISTINCT FROM 'recebida')::int AS abordados,
              (SELECT count(DISTINCT empresa_id) FROM atv
                WHERE (tipo = 'etapa' AND para_etapa = 'respondeu') OR direcao = 'recebida')::int AS responderam,
              (SELECT count(DISTINCT empresa_id) FROM atv WHERE tipo = 'etapa' AND para_etapa = 'reuniao')::int AS reunioes,
              (SELECT count(DISTINCT empresa_id) FROM atv WHERE tipo = 'etapa' AND para_etapa = 'ganho')::int AS ganhos,
              (SELECT count(DISTINCT empresa_id) FROM atv WHERE tipo = 'etapa' AND para_etapa = 'perdido')::int AS perdidos,
              (SELECT count(*) FROM atv WHERE tipo NOT IN ('nota', 'etapa'))::int AS contatos,
              (SELECT coalesce(sum(o.valor_mensal), 0)::float8 FROM comercial.oportunidades o
                WHERE o.etapa = 'ganho' AND o.empresa_id IN (SELECT empresa_id FROM atv
                  WHERE tipo = 'etapa' AND para_etapa = 'ganho')) AS "valorGanho",
              (SELECT count(*) FROM comercial.oportunidades o WHERE o.etapa NOT IN ('ganho', 'perdido', 'descartado')
                 AND o.proxima_acao_em < now())::int AS "followupsAtrasados",
              (SELECT count(*) FROM comercial.oportunidades o WHERE o.etapa NOT IN ('ganho', 'perdido', 'descartado')
                 AND o.proxima_acao_em IS NULL AND ${daCampanha('o.empresa_id')})::int AS "semProximoPasso"`,
      v,
    ),
    // Funil da safra: das oportunidades criadas no período, quantas chegaram a cada etapa.
    db.query(
      `WITH alc AS (${ALCANCE})
       SELECT count(*)::int AS a_abordar,
              count(*) FILTER (WHERE alcance >= 1)::int AS abordado,
              count(*) FILTER (WHERE alcance >= 2)::int AS respondeu,
              count(*) FILTER (WHERE alcance >= 3)::int AS reuniao,
              count(*) FILTER (WHERE alcance >= 4)::int AS proposta,
              count(*) FILTER (WHERE alcance >= 5)::int AS ganho,
              count(*) FILTER (WHERE etapa = 'perdido')::int AS perdido
         FROM alc`,
      v,
    ),
    db.query(
      `SELECT c.id, c.nome, c.status,
              count(ce.empresa_id)::int AS encontrados,
              count(*) FILTER (WHERE l.faixa = 'A')::int AS "faixaA",
              count(*) FILTER (WHERE l.faixa = 'B')::int AS "faixaB",
              count(*) FILTER (WHERE l.faixa = 'C')::int AS "faixaC",
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM enriquecimento.pessoas p
                                WHERE p.empresa_id = ce.empresa_id AND p.decisor))::int AS "comDecisor",
              count(*) FILTER (WHERE o.empresa_id IS NULL)::int AS novos,
              count(*) FILTER (WHERE o.etapa = 'descartado')::int AS descartados,
              count(*) FILTER (WHERE o.etapa IS NOT NULL AND o.etapa <> 'descartado')::int AS "noFunil",
              count(*) FILTER (WHERE o.etapa IN ('abordado', 'respondeu', 'reuniao', 'proposta', 'ganho', 'perdido')
                                 OR o.ultimo_contato_em IS NOT NULL)::int AS abordados,
              count(*) FILTER (WHERE o.etapa IN ('respondeu', 'reuniao', 'proposta', 'ganho')
                                 OR (o.etapa = 'perdido' AND EXISTS (SELECT 1 FROM comercial.atividades a
                                     WHERE a.empresa_id = o.empresa_id AND a.para_etapa = 'respondeu')))::int AS responderam,
              count(*) FILTER (WHERE o.etapa = 'ganho')::int AS ganhos
         FROM cadastro.campanhas c
         JOIN descoberta.campanha_empresas ce ON ce.campanha_id = c.id AND ${noPeriodo('ce.adicionada_em')}
         LEFT JOIN enriquecimento.leads l ON l.empresa_id = ce.empresa_id
         LEFT JOIN comercial.oportunidades o ON o.empresa_id = ce.empresa_id
        WHERE ($2::bigint IS NULL OR c.id = $2)
        GROUP BY c.id ORDER BY count(ce.empresa_id) DESC`,
      v,
    ),
    // A nota acerta? Resultado por faixa de entrada no funil.
    db.query(
      `WITH alc AS (${ALCANCE})
       SELECT coalesce(faixa_entrada, 'sem_nota') AS faixa,
              count(*)::int AS "noFunil",
              count(*) FILTER (WHERE alcance >= 1)::int AS abordados,
              count(*) FILTER (WHERE alcance >= 2)::int AS responderam,
              count(*) FILTER (WHERE alcance >= 3)::int AS reunioes,
              count(*) FILTER (WHERE alcance >= 5)::int AS ganhos,
              count(*) FILTER (WHERE etapa = 'perdido')::int AS perdidos
         FROM alc GROUP BY 1 ORDER BY 1`,
      v,
    ),
    // De onde vem o decisor dos leads A e B (e quantos ainda estão sem): mede a falta da fonte paga.
    db.query(
      `WITH leads AS (${LEADS})
       SELECT faixa,
              count(*)::int AS total,
              count(*) FILTER (WHERE 'receita' = ANY(fontes_decisor))::int AS receita,
              count(*) FILTER (WHERE 'linkedin' = ANY(fontes_decisor) AND NOT 'receita' = ANY(fontes_decisor))::int AS linkedin,
              count(*) FILTER (WHERE com_decisor AND NOT ('receita' = ANY(fontes_decisor) OR 'linkedin' = ANY(fontes_decisor)))::int AS outras,
              count(*) FILTER (WHERE NOT com_decisor)::int AS "semDecisor",
              count(*) FILTER (WHERE com_whatsapp)::int AS "comWhatsapp"
         FROM leads WHERE faixa IN ('A', 'B', 'C') GROUP BY faixa ORDER BY faixa`,
      v,
    ),
    db.query(
      `SELECT o.etapa, coalesce(nullif(btrim(o.motivo), ''), 'Sem motivo informado') AS motivo, count(*)::int AS quantidade
         FROM comercial.oportunidades o
        WHERE o.etapa IN ('perdido', 'descartado') AND ${noPeriodo('o.etapa_desde')} AND ${daCampanha('o.empresa_id')}
        GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 20`,
      v,
    ),
    // Ritmo diário: contatos feitos, respostas e leads novos no funil (até 60 dias).
    db.query(
      `WITH dias AS (
         SELECT generate_series(
                  (now() AT TIME ZONE 'America/Sao_Paulo')::date - (least(CASE WHEN $1::int = 0 THEN 60 ELSE $1::int END, 60) - 1),
                  (now() AT TIME ZONE 'America/Sao_Paulo')::date, interval '1 day')::date AS dia)
       SELECT to_char(d.dia, 'YYYY-MM-DD') AS dia,
              count(a.id) FILTER (WHERE a.tipo NOT IN ('nota', 'etapa') AND a.direcao IS DISTINCT FROM 'recebida')::int AS contatos,
              count(a.id) FILTER (WHERE a.direcao = 'recebida')::int AS respostas,
              count(a.id) FILTER (WHERE a.tipo = 'etapa' AND a.de_etapa IS NULL AND a.para_etapa = 'a_abordar')::int AS "novosNoFunil"
         FROM dias d
         LEFT JOIN comercial.atividades a ON (a.criado_em AT TIME ZONE 'America/Sao_Paulo')::date = d.dia
              AND ${daCampanha('a.empresa_id')}
        GROUP BY d.dia ORDER BY d.dia`,
      v,
    ),
  ]);

  return {
    kpis: kpis.rows[0],
    funil: funil.rows[0],
    campanhas: campanhas.rows,
    faixas: faixas.rows,
    decisores: decisores.rows,
    motivos: motivos.rows,
    diario: diario.rows,
  };
}
