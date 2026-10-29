import type { Pool } from '@prospeccao/db';
import { consultar, type ResultadoConsulta } from './acesso.js';

/**
 * Respostas prontas: SQL escrito e testado à mão para as perguntas de todo dia. Rodam nas mesmas
 * views (com o mesmo escopo) que o SQL livre da IA, então valem as mesmas regras de acesso.
 */
export interface ConsultaPronta {
  nome: string;
  descricao: string;
  /** Parâmetros que a IA pode preencher. */
  parametros: Record<string, string>;
  executar(pool: Pool, escopo: string, p: Record<string, unknown>): Promise<ResultadoPronto>;
}

export interface ResultadoPronto extends ResultadoConsulta {
  titulo: string;
  sql: string;
  /** Números principais, já calculados, para a fala e os destaques. */
  totais: Record<string, number | string | null>;
}

const HOJE = `(now() AT TIME ZONE 'America/Sao_Paulo')::date`;
const dias = (v: unknown, padrao: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 366 ? n : padrao;
};
const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : null);
const soma = (linhas: Record<string, unknown>[], col: string) =>
  linhas.reduce((s, l) => s + Number(l[col] ?? 0), 0);
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

async function rodar(
  pool: Pool,
  escopo: string,
  titulo: string,
  sql: string,
  params: unknown[],
  totais: (r: ResultadoConsulta) => ResultadoPronto['totais'],
): Promise<ResultadoPronto> {
  const r = await consultar(pool, escopo, sql, params, { limite: 200 });
  return { ...r, titulo, sql: sql.trim(), totais: totais(r) };
}

/** Filtro opcional pelo nome da unidade (sem acento e sem caixa). */
const filtroUnidade = (indice: number) =>
  `AND ($${indice}::text IS NULL OR unaccent_simples(u.unidade) LIKE '%' || unaccent_simples($${indice}) || '%')`;

// Sem depender da extensão unaccent no papel de leitura: translate faz o básico.
const UNACCENT = (x: string) =>
  `translate(lower(${x}), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')`;
const comUnidade = (sql: string) =>
  sql.replaceAll(/unaccent_simples\(([^)]+)\)/g, (_m, x: string) => UNACCENT(x));

export const CONSULTAS_PRONTAS: ConsultaPronta[] = [
  {
    nome: 'resumo_funil',
    descricao:
      'Como está o funil AGORA: quantas negociações em cada etapa e o valor mensal em potencial, por unidade se houver mais de uma.',
    parametros: { unidade: 'nome (ou parte) da unidade, opcional' },
    executar(pool, escopo, p) {
      const sql = comUnidade(`
        SELECT u.unidade, f.situacao, count(*) AS negociacoes, coalesce(sum(f.valor_mensal), 0) AS valor_mensal
          FROM funil f JOIN unidades u ON u.unidade_id = f.unidade_id
         WHERE f.situacao <> 'descartado' ${filtroUnidade(1)}
         GROUP BY u.unidade, f.situacao
         ORDER BY u.unidade, array_position(ARRAY['a_abordar','abordado','respondeu','reuniao','proposta','ganho','perdido'], f.situacao)`);
      return rodar(pool, escopo, 'Funil agora, por etapa', sql, [texto(p.unidade)], (r) => {
        const ativas = r.linhas
          .filter((l) => !['ganho', 'perdido'].includes(String(l.situacao)))
          .reduce((s, l) => s + Number(l.negociacoes), 0);
        const ganhos = soma(
          r.linhas.filter((l) => l.situacao === 'ganho'),
          'negociacoes',
        );
        const perdidos = soma(
          r.linhas.filter((l) => l.situacao === 'perdido'),
          'negociacoes',
        );
        return {
          em_andamento: ativas,
          potencial_em_andamento: r.linhas
            .filter((l) => !['ganho', 'perdido'].includes(String(l.situacao)))
            .reduce((s, l) => s + Number(l.valor_mensal), 0),
          ganhos,
          perdidos,
          conversao_pct: pct(ganhos, ganhos + perdidos),
        };
      });
    },
  },
  {
    nome: 'desempenho_equipe',
    descricao:
      'Ranking da equipe num período: abordagens feitas, respostas recebidas, reuniões marcadas e negócios ganhos por pessoa.',
    parametros: { dias: 'período em dias (padrão 30)', unidade: 'nome (ou parte) da unidade, opcional' },
    executar(pool, escopo, p) {
      const d = dias(p.dias, 30);
      const sql = comUnidade(`
        WITH periodo AS (SELECT now() - make_interval(days => $1::int) AS desde)
        SELECT e.nome AS pessoa, u.unidade, e.papel,
               (SELECT count(*) FROM historico_funil h, periodo
                 WHERE h.usuario_id = e.usuario_id AND h.direcao = 'enviada' AND h.criado_em >= periodo.desde) AS abordagens,
               (SELECT count(*) FROM historico_funil h JOIN funil f ON f.empresa_id = h.empresa_id AND f.unidade_id = h.unidade_id, periodo
                 WHERE f.responsavel_id = e.usuario_id AND h.direcao = 'recebida' AND h.criado_em >= periodo.desde) AS respostas,
               (SELECT count(*) FROM tarefas t, periodo
                 WHERE t.responsavel_id = e.usuario_id AND t.tipo = 'reuniao' AND t.criado_em >= periodo.desde) AS reunioes,
               (SELECT count(*) FROM funil f, periodo
                 WHERE f.responsavel_id = e.usuario_id AND f.situacao = 'ganho' AND f.etapa_desde >= periodo.desde) AS ganhos,
               (SELECT coalesce(sum(f.valor_mensal), 0) FROM funil f, periodo
                 WHERE f.responsavel_id = e.usuario_id AND f.situacao = 'ganho' AND f.etapa_desde >= periodo.desde) AS valor_ganho
          FROM equipe e JOIN unidades u ON u.unidade_id = e.unidade_id
         WHERE e.ativo ${filtroUnidade(2)}
         ORDER BY ganhos DESC, reunioes DESC, abordagens DESC`);
      return rodar(pool, escopo, `Equipe nos últimos ${d} dias`, sql, [d, texto(p.unidade)], (r) => ({
        pessoas: r.linhas.length,
        abordagens: soma(r.linhas, 'abordagens'),
        reunioes: soma(r.linhas, 'reunioes'),
        ganhos: soma(r.linhas, 'ganhos'),
        valor_ganho: soma(r.linhas, 'valor_ganho'),
      }));
    },
  },
  {
    nome: 'campanhas',
    descricao:
      'Resultado das campanhas de prospecção: empresas encontradas, faixa A e B, quantas foram para o funil e quantas viraram negócio.',
    parametros: {
      unidade: 'nome (ou parte) da unidade, opcional',
      situacao: "'ativa' para só as ativas, opcional",
    },
    executar(pool, escopo, p) {
      const sql = comUnidade(`
        SELECT c.nome AS campanha, u.unidade, c.nicho, c.status,
               count(DISTINCT l.empresa_id) AS empresas,
               count(DISTINCT l.empresa_id) FILTER (WHERE l.faixa = 'A') AS faixa_a,
               count(DISTINCT l.empresa_id) FILTER (WHERE l.faixa = 'B') AS faixa_b,
               count(DISTINCT f.empresa_id) AS no_funil,
               count(DISTINCT f.empresa_id) FILTER (WHERE f.situacao = 'ganho') AS ganhos
          FROM campanhas c
          JOIN unidades u ON u.unidade_id = c.unidade_id
          LEFT JOIN leads l ON l.campanha_id = c.campanha_id
          LEFT JOIN funil f ON f.empresa_id = l.empresa_id AND f.unidade_id = l.unidade_id AND f.situacao <> 'descartado'
         WHERE ($2::text IS NULL OR c.status = $2) ${filtroUnidade(1)}
         GROUP BY c.campanha_id, c.nome, u.unidade, c.nicho, c.status
         ORDER BY empresas DESC`);
      return rodar(
        pool,
        escopo,
        'Campanhas de prospecção',
        sql,
        [texto(p.unidade), texto(p.situacao)],
        (r) => ({
          campanhas: r.linhas.length,
          empresas: soma(r.linhas, 'empresas'),
          faixa_a: soma(r.linhas, 'faixa_a'),
          no_funil: soma(r.linhas, 'no_funil'),
          ganhos: soma(r.linhas, 'ganhos'),
        }),
      );
    },
  },
  {
    nome: 'follow_ups',
    descricao:
      'Próximos passos atrasados e de hoje no funil, por responsável (quem está devendo retorno para o lead).',
    parametros: { unidade: 'nome (ou parte) da unidade, opcional' },
    executar(pool, escopo, p) {
      const sql = comUnidade(`
        SELECT f.empresa, u.unidade, coalesce(f.responsavel, 'Sem responsável') AS responsavel, f.etapa,
               f.proxima_acao, (f.proxima_acao_em AT TIME ZONE 'America/Sao_Paulo')::date AS para_quando,
               ${HOJE} - (f.proxima_acao_em AT TIME ZONE 'America/Sao_Paulo')::date AS dias_de_atraso
          FROM funil f JOIN unidades u ON u.unidade_id = f.unidade_id
         WHERE f.situacao NOT IN ('ganho','perdido','descartado') AND f.proxima_acao_em IS NOT NULL
           AND (f.proxima_acao_em AT TIME ZONE 'America/Sao_Paulo')::date <= ${HOJE} ${filtroUnidade(1)}
         ORDER BY f.proxima_acao_em`);
      return rodar(pool, escopo, 'Follow-ups atrasados e de hoje', sql, [texto(p.unidade)], (r) => ({
        total: r.linhas.length,
        atrasados: r.linhas.filter((l) => Number(l.dias_de_atraso) > 0).length,
        de_hoje: r.linhas.filter((l) => Number(l.dias_de_atraso) === 0).length,
      }));
    },
  },
  {
    nome: 'por_unidade',
    descricao:
      'Comparativo entre unidades (gestor/diretoria/master): leads no mês, negociações em andamento, reuniões e ganhos no mês, valor em potencial.',
    parametros: {},
    executar(pool, escopo) {
      const sql = `
        WITH mes AS (SELECT date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo' AS inicio)
        SELECT u.organizacao, u.unidade,
               (SELECT count(DISTINCT l.empresa_id) FROM leads l, mes WHERE l.unidade_id = u.unidade_id AND l.adicionada_em >= mes.inicio) AS leads_no_mes,
               (SELECT count(*) FROM funil f WHERE f.unidade_id = u.unidade_id AND f.situacao NOT IN ('ganho','perdido','descartado')) AS em_andamento,
               (SELECT coalesce(sum(f.valor_mensal), 0) FROM funil f WHERE f.unidade_id = u.unidade_id AND f.situacao NOT IN ('ganho','perdido','descartado')) AS potencial,
               (SELECT count(*) FROM tarefas t, mes WHERE t.unidade_id = u.unidade_id AND t.tipo = 'reuniao' AND t.criado_em >= mes.inicio) AS reunioes_no_mes,
               (SELECT count(*) FROM funil f, mes WHERE f.unidade_id = u.unidade_id AND f.situacao = 'ganho' AND f.etapa_desde >= mes.inicio) AS ganhos_no_mes
          FROM unidades u
         WHERE u.ativa
         ORDER BY ganhos_no_mes DESC, em_andamento DESC`;
      return rodar(pool, escopo, 'Unidades neste mês', sql, [], (r) => ({
        unidades: r.linhas.length,
        leads_no_mes: soma(r.linhas, 'leads_no_mes'),
        em_andamento: soma(r.linhas, 'em_andamento'),
        ganhos_no_mes: soma(r.linhas, 'ganhos_no_mes'),
      }));
    },
  },
];

export const consultaPronta = (nome: string) => CONSULTAS_PRONTAS.find((c) => c.nome === nome) ?? null;

const sem = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * A consulta pronta que quase certamente responde a pergunta, para já ir buscando junto com a 1ª
 * chamada à IA (regras simples; quando não bate, a IA decide sozinha).
 */
export function planoRapido(pergunta: string): { nome: string; parametros: Record<string, unknown> } | null {
  const t = sem(pergunta);
  const d = /(\d{1,3})\s*dias/.exec(t)?.[1];
  const periodo = d ? Number(d) : /\bsemana\b/.test(t) ? 7 : /\bhoje\b/.test(t) ? 1 : undefined;
  if (/\b(follow ?-?ups?|retornos?|atrasad[oa]s?|proximos? passos?)\b/.test(t))
    return { nome: 'follow_ups', parametros: {} };
  if (/\b(ranking|equipe|time|vendedor(es)?|sdrs?|closers?|quem (mais|menos))\b/.test(t))
    return { nome: 'desempenho_equipe', parametros: periodo ? { dias: periodo } : {} };
  if (/\b(unidades|regionais|filiais|comparar? as unidades|por unidade)\b/.test(t))
    return { nome: 'por_unidade', parametros: {} };
  if (/\bcampanhas?\b/.test(t)) return { nome: 'campanhas', parametros: {} };
  if (/\b(funil|pipeline|negociac(ao|oes)|como (esta|estao) (as vendas|o comercial))\b/.test(t))
    return { nome: 'resumo_funil', parametros: {} };
  return null;
}
