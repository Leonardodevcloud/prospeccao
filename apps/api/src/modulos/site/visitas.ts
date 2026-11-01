import { createHash } from 'node:crypto';
import type { Executor } from '@prospeccao/db';
import {
  dispositivoDoNavegador,
  NAVEGADOR_ROBO,
  origemDaVisita,
  ROTULO_CLIQUE_SITE,
  SECOES_DO_SITE,
  type VisitaSiteEntrada,
} from '@prospeccao/shared';

/**
 * Visitas do site institucional (painel master › Visitas do site). Sem cookie e sem guardar o IP:
 * o visitante é um código do IP + navegador + dia, embaralhado com um segredo do servidor, que
 * muda todo dia. A cidade vem do Vercel (quando ele manda).
 */

const diaSp = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

export interface QuemVisita {
  ip: string;
  navegador: string;
  cidade: string | null;
  estado: string | null;
  pais: string | null;
}

const decodificar = (v: string | undefined) => {
  if (!v) return null;
  try {
    return decodeURIComponent(v).slice(0, 80);
  } catch {
    return v.slice(0, 80);
  }
};

/** O IP de quem visita (o Vercel repassa no x-forwarded-for) e a cidade que ele calcula. */
export function quemVisita(cabecalho: (nome: string) => string | undefined, ipDaConexao: string): QuemVisita {
  const encaminhado = cabecalho('x-forwarded-for')?.split(',')[0]?.trim();
  return {
    // O primeiro do x-forwarded-for é quem abriu o site (o Vercel põe; o Railway acrescenta o resto).
    ip: encaminhado || cabecalho('x-real-ip') || ipDaConexao,
    navegador: cabecalho('user-agent') ?? '',
    cidade: decodificar(cabecalho('x-vercel-ip-city')),
    estado: decodificar(cabecalho('x-vercel-ip-country-region')),
    pais: decodificar(cabecalho('x-vercel-ip-country')),
  };
}

/** Guarda o evento. Robôs não contam. */
export async function registrarVisita(
  db: Executor,
  segredo: string,
  quem: QuemVisita,
  v: VisitaSiteEntrada,
): Promise<boolean> {
  if (!quem.navegador || NAVEGADOR_ROBO.test(quem.navegador)) return false;
  const dia = diaSp();
  const visitante = createHash('sha256')
    .update(`${segredo}|${dia}|${quem.ip}|${quem.navegador}`)
    .digest('base64url')
    .slice(0, 22);
  const pagina = (v.pagina || '/').replace(/\.html$/, '').replace(/\/index$/, '/') || '/';
  await db.query(
    `INSERT INTO cadastro.visitas_site (visitante, evento, pagina, alvo, origem, utm_origem, utm_meio, utm_campanha,
                                        dispositivo, cidade, estado, pais, profundidade, segundos, secoes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      visitante,
      v.evento,
      pagina,
      v.alvo ?? null,
      v.evento === 'visita' ? origemDaVisita(v.referencia, v.utmOrigem) : null,
      v.utmOrigem ?? null,
      v.utmMeio ?? null,
      v.utmCampanha ?? null,
      dispositivoDoNavegador(quem.navegador),
      quem.cidade,
      quem.estado,
      quem.pais,
      v.profundidade ?? null,
      v.segundos ?? null,
      v.secoes?.length ? [...new Set(v.secoes)] : null,
    ],
  );
  return true;
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

/** O painel: visitas, de onde vêm, o que clicam, até onde rolam e quantas viram cadastro. */
export async function resumoVisitas(db: Executor, dias: number) {
  const D = Math.max(1, Math.min(365, Math.trunc(dias)));
  // Período: os últimos D dias (contando hoje) e os D dias antes, para comparar.
  const periodo = `dia > (now() AT TIME ZONE 'America/Sao_Paulo')::date - ${D}`;
  const anterior = `dia > (now() AT TIME ZONE 'America/Sao_Paulo')::date - ${2 * D}
                    AND dia <= (now() AT TIME ZONE 'America/Sao_Paulo')::date - ${D}`;
  const visitas = `evento = 'visita' AND origem IS DISTINCT FROM 'Interno'`;

  const [
    totais,
    antes,
    porDia,
    origens,
    campanhas,
    paginas,
    cliques,
    dispositivos,
    cidades,
    saidas,
    secoes,
    conversao,
  ] = await Promise.all([
    db.query<{ visitas: number; visitantes: number; celular: number }>(
      `SELECT count(*) FILTER (WHERE evento = 'visita')::int AS visitas,
                count(DISTINCT (dia, visitante)) FILTER (WHERE evento = 'visita')::int AS visitantes,
                count(DISTINCT (dia, visitante)) FILTER (WHERE evento = 'visita' AND dispositivo = 'celular')::int AS celular
           FROM cadastro.visitas_site WHERE ${periodo}`,
    ),
    db.query<{ visitas: number; visitantes: number }>(
      `SELECT count(*) FILTER (WHERE evento = 'visita')::int AS visitas,
                count(DISTINCT (dia, visitante)) FILTER (WHERE evento = 'visita')::int AS visitantes
           FROM cadastro.visitas_site WHERE ${anterior}`,
    ),
    db.query<{ dia: string; visitas: number; visitantes: number; cliques: number }>(
      `SELECT to_char(d, 'YYYY-MM-DD') AS dia,
                count(v.id) FILTER (WHERE v.evento = 'visita')::int AS visitas,
                count(DISTINCT v.visitante) FILTER (WHERE v.evento = 'visita')::int AS visitantes,
                count(v.id) FILTER (WHERE v.evento = 'clique')::int AS cliques
           FROM generate_series((now() AT TIME ZONE 'America/Sao_Paulo')::date - ${D - 1},
                                (now() AT TIME ZONE 'America/Sao_Paulo')::date, interval '1 day') d
           LEFT JOIN cadastro.visitas_site v ON v.dia = d::date
          GROUP BY d ORDER BY d`,
    ),
    db.query<{ origem: string; visitantes: number }>(
      `SELECT coalesce(origem, 'Direto') AS origem, count(DISTINCT (dia, visitante))::int AS visitantes
           FROM cadastro.visitas_site WHERE ${periodo} AND ${visitas}
          GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
    ),
    db.query<{ campanha: string; visitantes: number }>(
      `SELECT concat_ws(' · ', utm_origem, utm_meio, utm_campanha) AS campanha,
                count(DISTINCT (dia, visitante))::int AS visitantes
           FROM cadastro.visitas_site WHERE ${periodo} AND evento = 'visita' AND utm_origem IS NOT NULL
          GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
    ),
    db.query<{ pagina: string; visitas: number }>(
      `SELECT pagina, count(*)::int AS visitas FROM cadastro.visitas_site
          WHERE ${periodo} AND evento = 'visita' GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
    ),
    db.query<{ alvo: string; cliques: number; pessoas: number }>(
      `SELECT alvo, count(*)::int AS cliques, count(DISTINCT (dia, visitante))::int AS pessoas
           FROM cadastro.visitas_site WHERE ${periodo} AND evento = 'clique' AND alvo IS NOT NULL
          GROUP BY 1 ORDER BY 2 DESC LIMIT 15`,
    ),
    db.query<{ dispositivo: string; visitantes: number }>(
      `SELECT coalesce(dispositivo, 'computador') AS dispositivo, count(DISTINCT (dia, visitante))::int AS visitantes
           FROM cadastro.visitas_site WHERE ${periodo} AND evento = 'visita' GROUP BY 1 ORDER BY 2 DESC`,
    ),
    db.query<{ cidade: string; visitantes: number }>(
      `SELECT concat_ws(' · ', cidade, estado) AS cidade, count(DISTINCT (dia, visitante))::int AS visitantes
           FROM cadastro.visitas_site WHERE ${periodo} AND evento = 'visita' AND cidade IS NOT NULL
          GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
    ),
    db.query<{ saidas: number; profundidade: number | null; segundos: number | null; fim: number }>(
      `SELECT count(*)::int AS saidas, round(avg(profundidade))::int AS profundidade,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY segundos)::int AS segundos,
                count(*) FILTER (WHERE profundidade >= 90)::int AS fim
           FROM cadastro.visitas_site WHERE ${periodo} AND evento = 'saida' AND pagina = '/'`,
    ),
    db.query<{ secao: string; viram: number }>(
      `SELECT s AS secao, count(*)::int AS viram
           FROM cadastro.visitas_site, unnest(secoes) s
          WHERE ${periodo} AND evento = 'saida' AND pagina = '/' GROUP BY 1`,
    ),
    db.query<{ cadastros: number; confirmados: number; pagaram: number; demonstracoes: number }>(
      `SELECT (SELECT count(*)::int FROM cadastro.cadastros_teste
                  WHERE (criado_em AT TIME ZONE 'America/Sao_Paulo')::date > (now() AT TIME ZONE 'America/Sao_Paulo')::date - ${D}) AS cadastros,
                (SELECT count(*)::int FROM cadastro.cadastros_teste
                  WHERE (confirmado_em AT TIME ZONE 'America/Sao_Paulo')::date > (now() AT TIME ZONE 'America/Sao_Paulo')::date - ${D}) AS confirmados,
                (SELECT count(DISTINCT t.organizacao_id)::int FROM cadastro.cadastros_teste t
                   JOIN cadastro.cobrancas b ON b.organizacao_id = t.organizacao_id AND b.tipo = 'mensalidade' AND b.situacao = 'paga'
                  WHERE (t.confirmado_em AT TIME ZONE 'America/Sao_Paulo')::date > (now() AT TIME ZONE 'America/Sao_Paulo')::date - ${D}) AS pagaram,
                (SELECT count(*)::int FROM cadastro.pedidos_site
                  WHERE canal <> 'teste' AND ip_hash IS NOT NULL AND (criado_em AT TIME ZONE 'America/Sao_Paulo')::date > (now() AT TIME ZONE 'America/Sao_Paulo')::date - ${D}) AS demonstracoes`,
    ),
  ]);

  const t = totais.rows[0]!;
  const s = saidas.rows[0]!;
  const viram = new Map(secoes.rows.map((r) => [r.secao, r.viram]));
  const c = conversao.rows[0]!;
  const cliquesTeste = cliques.rows
    .filter((r) => r.alvo === 'teste' || r.alvo.startsWith('assinar:'))
    .reduce((n, r) => n + r.pessoas, 0);
  return {
    dias: D,
    totais: {
      visitas: t.visitas,
      visitantes: t.visitantes,
      celular: pct(t.celular, t.visitantes),
      anterior: antes.rows[0]!,
      /** Leitura da página inicial: até onde rolam, quanto tempo ficam e quantos chegam ao fim. */
      profundidade: s.profundidade,
      segundos: s.segundos,
      chegaramAoFim: pct(s.fim, s.saidas),
      leituras: s.saidas,
    },
    porDia: porDia.rows,
    origens: origens.rows,
    campanhas: campanhas.rows,
    paginas: paginas.rows,
    cliques: cliques.rows.map((r) => ({ ...r, rotulo: ROTULO_CLIQUE_SITE[r.alvo] ?? r.alvo })),
    dispositivos: dispositivos.rows,
    cidades: cidades.rows,
    /** Quantas leituras da página inicial passaram por cada seção (na ordem da página). */
    secoes: SECOES_DO_SITE.map((x) => ({
      ...x,
      viram: viram.get(x.id) ?? 0,
      pct: pct(viram.get(x.id) ?? 0, s.saidas),
    })),
    conversao: {
      visitantes: t.visitantes,
      clicaramTesteOuAssinar: cliquesTeste,
      cadastros: c.cadastros,
      confirmados: c.confirmados,
      pagaram: c.pagaram,
      demonstracoes: c.demonstracoes,
    },
  };
}

/** Limpeza: visitas com mais de 13 meses saem. */
export async function apagarVisitasAntigas(db: Executor): Promise<void> {
  await db.query(
    `DELETE FROM cadastro.visitas_site WHERE dia < (now() AT TIME ZONE 'America/Sao_Paulo')::date - 400`,
  );
}
