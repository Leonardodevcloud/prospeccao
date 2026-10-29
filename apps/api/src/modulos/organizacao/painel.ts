import type { Executor } from '@prospeccao/db';
import { planoDaOrganizacao } from '../plano/repositorio.js';

/**
 * Painel do gestor: a organização inteira somada, unidade por unidade e pessoa por pessoa, num
 * período. Uma empresa é de uma unidade só, então somar as unidades não conta nada duas vezes.
 */

export interface Periodo {
  desde: Date;
  ate: Date;
  /** Como aparece na tela e no PDF: "Últimos 30 dias", "Outubro de 2026". */
  rotulo: string;
}

const ABERTO = `o.etapa NOT IN ('ganho', 'perdido', 'descartado')`;
const CONTATO = `a.tipo IN ('whatsapp', 'ligacao', 'email', 'visita') AND a.direcao = 'enviada'`;

/** Etapa → ordem de avanço (ganho é o fim do funil). */
const ORDEM = `CASE a.para_etapa WHEN 'a_abordar' THEN 0 WHEN 'abordado' THEN 1 WHEN 'respondeu' THEN 2
  WHEN 'reuniao' THEN 3 WHEN 'proposta' THEN 4 WHEN 'ganho' THEN 5 ELSE NULL END`;

export async function painel(db: Executor, organizacaoId: number, p: Periodo) {
  const v = [organizacaoId, p.desde.toISOString(), p.ate.toISOString()];
  const UN = `(SELECT id FROM cadastro.contas WHERE organizacao_id = $1)`;
  const NO_PERIODO = (col: string) => `${col} >= $2::timestamptz AND ${col} < $3::timestamptz`;

  const [plano, unidades, pessoas, funil, diario] = await Promise.all([
    planoDaOrganizacao(db, organizacaoId),
    db.query<{
      id: number;
      nome: string;
      ativa: boolean;
      cota: number | null;
      leads: number;
      noFunil: number;
      contatos: number;
      abordados: number;
      responderam: number;
      reunioes: number;
      ganhos: number;
      perdidos: number;
      valorGanho: number;
      atrasados: number;
      pessoas: number;
    }>(
      `SELECT c.id, c.nome, c.ativa, c.cota_leads_mes AS cota,
              (SELECT count(*) FROM enriquecimento.leads l JOIN cadastro.campanhas ca ON ca.id = l.campanha_id
                WHERE ca.conta_id = c.id AND l.status = 'concluido' AND ${NO_PERIODO('l.concluido_em')})::int AS leads,
              (SELECT count(*) FROM comercial.oportunidades o WHERE o.conta_id = c.id AND ${ABERTO})::int AS "noFunil",
              (SELECT count(*) FROM comercial.atividades a
                WHERE a.conta_id = c.id AND ${CONTATO} AND ${NO_PERIODO('a.criado_em')})::int AS contatos,
              (SELECT count(DISTINCT a.empresa_id) FROM comercial.atividades a
                WHERE a.conta_id = c.id AND ${CONTATO} AND ${NO_PERIODO('a.criado_em')})::int AS abordados,
              (SELECT count(DISTINCT a.empresa_id) FROM comercial.atividades a
                WHERE a.conta_id = c.id AND ${NO_PERIODO('a.criado_em')}
                  AND (a.direcao = 'recebida' OR (a.tipo = 'etapa' AND a.para_etapa = 'respondeu')))::int AS responderam,
              (SELECT count(DISTINCT a.empresa_id) FROM comercial.atividades a
                WHERE a.conta_id = c.id AND a.tipo = 'etapa' AND a.para_etapa = 'reuniao' AND ${NO_PERIODO('a.criado_em')})::int
                AS reunioes,
              (SELECT count(DISTINCT a.empresa_id) FROM comercial.atividades a
                WHERE a.conta_id = c.id AND a.tipo = 'etapa' AND a.para_etapa = 'ganho' AND ${NO_PERIODO('a.criado_em')})::int
                AS ganhos,
              (SELECT count(DISTINCT a.empresa_id) FROM comercial.atividades a
                WHERE a.conta_id = c.id AND a.tipo = 'etapa' AND a.para_etapa = 'perdido' AND ${NO_PERIODO('a.criado_em')})::int
                AS perdidos,
              (SELECT coalesce(sum(o.valor_mensal), 0) FROM comercial.oportunidades o
                WHERE o.conta_id = c.id AND o.etapa = 'ganho' AND ${NO_PERIODO('o.etapa_desde')})::float8 AS "valorGanho",
              (SELECT count(*) FROM comercial.oportunidades o
                WHERE o.conta_id = c.id AND ${ABERTO} AND o.proxima_acao_em < now())::int AS atrasados,
              (SELECT count(*) FROM cadastro.usuarios u
                WHERE u.conta_id = c.id AND u.ativo AND NOT u.master AND u.papel NOT IN ('gestor', 'leitura'))::int AS pessoas
         FROM cadastro.contas c WHERE c.organizacao_id = $1
        ORDER BY c.ativa DESC, c.criado_em`,
      v,
    ),
    db.query<{
      id: number;
      nome: string;
      papel: string;
      unidade: string;
      contatos: number;
      respostas: number;
      reunioes: number;
      ganhos: number;
      valorGanho: number;
      abertos: number;
      atrasados: number;
      ultimoAcesso: string | null;
      metaReunioes: number;
      metaGanhos: number;
      metaAbordagensDia: number;
    }>(
      `WITH un AS ${UN},
       contatos AS (
         SELECT a.usuario_id, count(*)::int AS n FROM comercial.atividades a
          WHERE a.conta_id IN (SELECT id FROM un) AND ${CONTATO} AND a.usuario_id IS NOT NULL AND ${NO_PERIODO('a.criado_em')}
          GROUP BY 1),
       respostas AS (
         SELECT o.responsavel_id AS usuario_id, count(DISTINCT a.empresa_id)::int AS n
           FROM comercial.atividades a
           JOIN comercial.oportunidades o ON o.conta_id = a.conta_id AND o.empresa_id = a.empresa_id
          WHERE a.conta_id IN (SELECT id FROM un) AND a.direcao = 'recebida' AND ${NO_PERIODO('a.criado_em')}
          GROUP BY 1),
       etapas AS (
         SELECT a.usuario_id,
                count(DISTINCT a.empresa_id) FILTER (WHERE a.para_etapa = 'reuniao')::int AS reunioes,
                count(DISTINCT a.empresa_id) FILTER (WHERE a.para_etapa = 'ganho')::int AS ganhos
           FROM comercial.atividades a
          WHERE a.conta_id IN (SELECT id FROM un) AND a.tipo = 'etapa' AND a.usuario_id IS NOT NULL
            AND a.para_etapa IN ('reuniao', 'ganho') AND ${NO_PERIODO('a.criado_em')}
          GROUP BY 1),
       valor AS (
         SELECT o.responsavel_id AS usuario_id, sum(o.valor_mensal)::float8 AS v
           FROM comercial.oportunidades o
          WHERE o.conta_id IN (SELECT id FROM un) AND o.etapa = 'ganho' AND ${NO_PERIODO('o.etapa_desde')}
          GROUP BY 1),
       abertos AS (
         SELECT o.responsavel_id AS usuario_id, count(*)::int AS n,
                count(*) FILTER (WHERE o.proxima_acao_em < now())::int AS atrasados
           FROM comercial.oportunidades o WHERE o.conta_id IN (SELECT id FROM un) AND ${ABERTO}
          GROUP BY 1)
       SELECT u.id, u.nome, u.papel, c.nome AS unidade,
              coalesce(ct.n, 0) AS contatos, coalesce(r.n, 0) AS respostas,
              coalesce(et.reunioes, 0) AS reunioes, coalesce(et.ganhos, 0) AS ganhos,
              coalesce(vl.v, 0) AS "valorGanho", coalesce(ab.n, 0) AS abertos, coalesce(ab.atrasados, 0) AS atrasados,
              u.ultimo_acesso AS "ultimoAcesso",
              coalesce(m.reunioes_mes, 10) AS "metaReunioes", coalesce(m.ganhos_mes, 3) AS "metaGanhos",
              coalesce(m.abordagens_dia, 30) AS "metaAbordagensDia"
         FROM cadastro.usuarios u
         JOIN cadastro.contas c ON c.id = u.conta_id
         LEFT JOIN comercial.metas m ON m.usuario_id = u.id
         LEFT JOIN contatos ct ON ct.usuario_id = u.id
         LEFT JOIN respostas r ON r.usuario_id = u.id
         LEFT JOIN etapas et ON et.usuario_id = u.id
         LEFT JOIN valor vl ON vl.usuario_id = u.id
         LEFT JOIN abertos ab ON ab.usuario_id = u.id
        WHERE c.organizacao_id = $1 AND u.ativo AND NOT u.master AND u.papel IN ('admin', 'sdr', 'closer')
        ORDER BY coalesce(et.ganhos, 0) DESC, coalesce(et.reunioes, 0) DESC, coalesce(ct.n, 0) DESC, u.nome`,
      v,
    ),
    // Safra do período: das negociações abertas no período, até onde cada uma chegou.
    db.query<Record<string, number>>(
      `WITH alc AS (
         SELECT o.etapa,
                coalesce((SELECT max(${ORDEM}) FROM comercial.atividades a
                           WHERE a.conta_id = o.conta_id AND a.empresa_id = o.empresa_id AND a.tipo = 'etapa'), 0) AS alcance
           FROM comercial.oportunidades o
          WHERE o.conta_id IN ${UN} AND o.etapa <> 'descartado' AND ${NO_PERIODO('o.criado_em')})
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
    db.query<{ dia: string; contatos: number; respostas: number; ganhos: number }>(
      `WITH dias AS (
         SELECT generate_series(
                  greatest(($2::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date,
                           ($3::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date - 59),
                  (($3::timestamptz - interval '1 second') AT TIME ZONE 'America/Sao_Paulo')::date,
                  interval '1 day')::date AS dia)
       SELECT to_char(d.dia, 'YYYY-MM-DD') AS dia,
              count(a.id) FILTER (WHERE ${CONTATO})::int AS contatos,
              count(a.id) FILTER (WHERE a.direcao = 'recebida')::int AS respostas,
              count(a.id) FILTER (WHERE a.tipo = 'etapa' AND a.para_etapa = 'ganho')::int AS ganhos
         FROM dias d
         LEFT JOIN comercial.atividades a ON (a.criado_em AT TIME ZONE 'America/Sao_Paulo')::date = d.dia
              AND a.conta_id IN ${UN}
        GROUP BY d.dia ORDER BY d.dia`,
      v,
    ),
  ]);

  const us = unidades.rows;
  const soma = (k: keyof (typeof us)[number]) => us.reduce((s, u) => s + Number(u[k] ?? 0), 0);
  const totais = {
    leads: soma('leads'),
    noFunil: soma('noFunil'),
    contatos: soma('contatos'),
    abordados: soma('abordados'),
    responderam: soma('responderam'),
    reunioes: soma('reunioes'),
    ganhos: soma('ganhos'),
    perdidos: soma('perdidos'),
    valorGanho: soma('valorGanho'),
    atrasados: soma('atrasados'),
  };
  const ps = pessoas.rows;
  return {
    periodo: { desde: p.desde.toISOString(), ate: p.ate.toISOString(), rotulo: p.rotulo },
    plano: {
      plano: plano.plano,
      leadsMes: plano.leadsMes,
      usoLeadsMes: plano.uso.leadsMes,
      usuarios: plano.usuarios,
      usoUsuarios: plano.uso.usuarios,
    },
    totais: {
      ...totais,
      taxaResposta: totais.abordados ? totais.responderam / totais.abordados : null,
      taxaReuniao: totais.abordados ? totais.reunioes / totais.abordados : null,
      taxaGanho: totais.reunioes ? totais.ganhos / totais.reunioes : null,
    },
    metasMes: {
      reunioes: {
        meta: ps.reduce((s, x) => s + x.metaReunioes, 0),
        feito: ps.reduce((s, x) => s + x.reunioes, 0),
      },
      ganhos: { meta: ps.reduce((s, x) => s + x.metaGanhos, 0), feito: ps.reduce((s, x) => s + x.ganhos, 0) },
    },
    funil: funil.rows[0] ?? {},
    unidades: us,
    pessoas: ps,
    diario: diario.rows,
  };
}

export type PainelOrganizacao = Awaited<ReturnType<typeof painel>>;

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/** Período pelo número de dias (até agora) ou por um mês do calendário (fuso de Brasília). */
export function periodo(q: { dias?: number; mes?: string }): Periodo {
  if (q.mes && /^\d{4}-\d{2}$/.test(q.mes)) {
    const [a, m] = q.mes.split('-').map(Number) as [number, number];
    const desde = new Date(Date.UTC(a, m - 1, 1, 3));
    const ate = new Date(Date.UTC(m === 12 ? a + 1 : a, m === 12 ? 0 : m, 1, 3));
    const fim = ate > new Date() ? new Date() : ate;
    return { desde, ate: fim, rotulo: `${MESES[m - 1]![0]!.toUpperCase()}${MESES[m - 1]!.slice(1)} de ${a}` };
  }
  const dias = q.dias && q.dias > 0 ? Math.min(q.dias, 365) : 30;
  const ate = new Date();
  return { desde: new Date(ate.getTime() - dias * 86_400_000), ate, rotulo: `Últimos ${dias} dias` };
}
