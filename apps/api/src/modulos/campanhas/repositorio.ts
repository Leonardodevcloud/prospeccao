import { comTransacao, type Executor, type Pool } from '@prospeccao/db';
import type { CampanhaEntrada, EscopoReenriquecer, StatusCampanha } from '@prospeccao/shared';
import { contaSql } from '../../contexto.js';

/** Campanha com o progresso da descoberta (lido das views publicadas pelo domínio descoberta). */
const SELECT = `
  SELECT c.id, c.nome, c.nicho_id AS "nichoId", n.nome AS "nichoNome", c.cidades, c.raio_km::float8 AS "raioKm",
         c.meta_diaria AS "metaDiaria", c.limite_envios_dia AS "limiteEnviosDia", c.cadencia, c.modo,
         c.max_por_busca AS "maxPorBusca", c.teto_places_usd::float8 AS "tetoPlacesUsd", c.status, c.iniciada_em AS "iniciadaEm",
         c.criado_em AS "criadoEm", c.atualizado_em AS "atualizadoEm",
         json_build_object(
           'empresas', coalesce(p.empresas, 0),
           'comCnpj', coalesce(p.com_cnpj, 0),
           'noMaps', coalesce(p.no_maps, 0),
           'soMaps', coalesce(p.so_maps, 0),
           'dentroDoRaio', coalesce(p.dentro_do_raio, 0),
           'semLocalizacao', coalesce(p.sem_localizacao, 0),
           'comSinalEntrega', coalesce(p.com_sinal_entrega, 0),
           'buscasPendentes', coalesce(b.pendentes, 0) + coalesce(b.rodando, 0),
           'buscasConcluidas', coalesce(b.concluidas, 0),
           'buscasComErro', coalesce(b.com_erro, 0),
           'ultimaBusca', b.ultima_conclusao,
           'novos', coalesce(f.novos, 0),
           'noFunil', coalesce(f.no_funil, 0),
           'descartados', coalesce(f.descartados, 0),
           'mei', coalesce(f.mei, 0),
           'buscasBloqueadas', coalesce(b.bloqueadas, 0),
           'buscasPorBairro', coalesce(b.por_bairro, 0),
           'pedidosPlaces', coalesce(u.pedidos, 0),
           'pagosPlaces', coalesce(u.pagos, 0),
           'gastoPlacesUsd', coalesce(u.gasto_usd, 0)
         ) AS progresso
    FROM cadastro.campanhas c
    JOIN cadastro.nichos n ON n.id = c.nicho_id
    LEFT JOIN descoberta.v_progresso_campanha p ON p.campanha_id = c.id
    LEFT JOIN descoberta.v_buscas_campanha b ON b.campanha_id = c.id
    LEFT JOIN descoberta.v_uso_places_campanha u ON u.campanha_id = c.id
    LEFT JOIN LATERAL (
      -- Situação comercial dos leads da campanha: novos = nunca trabalhados.
      SELECT count(*) FILTER (WHERE o.empresa_id IS NULL AND NOT e.mei)::int AS novos,
             count(*) FILTER (WHERE e.mei AND o.empresa_id IS NULL)::int AS mei,
             count(*) FILTER (WHERE o.etapa <> 'descartado')::int AS no_funil,
             count(*) FILTER (WHERE o.etapa = 'descartado')::int AS descartados
        FROM descoberta.campanha_empresas ce
        JOIN descoberta.empresas e ON e.id = ce.empresa_id
        LEFT JOIN comercial.oportunidades o ON o.conta_id = c.conta_id AND o.empresa_id = ce.empresa_id
       WHERE ce.campanha_id = c.id
    ) f ON true`;

/**
 * Pedidos de enriquecimento ainda abertos por campanha, lidos da fila (só leitura). Sem a fila
 * criada (banco novo), devolve vazio em vez de quebrar a tela.
 */
async function naFilaDoEnriquecimento(db: Executor): Promise<Map<number, number>> {
  try {
    const { rows } = await db.query<{ campanha_id: string; n: number }>(
      `SELECT j.data ->> 'campanhaId' AS campanha_id, count(*)::int AS n FROM fila.job j
        WHERE j.name = 'enriquecimento.solicitar' AND j.state IN ('created', 'retry', 'active')
        GROUP BY 1`,
    );
    return new Map(rows.map((r) => [Number(r.campanha_id), r.n]));
  } catch {
    return new Map();
  }
}

type ComProgresso = {
  id: number;
  nome: string;
  cidades: { cidade: string; uf: string }[];
  progresso: Record<string, unknown>;
};

/** Estado do worker-enriquecimento pelo sinal de vida que ele grava a cada minuto. */
async function estadoDoEnriquecimento(
  db: Executor,
): Promise<'rodando' | 'pausado' | 'fora' | 'desconhecido'> {
  try {
    const { rows } = await db.query<{ pausado: boolean; recente: boolean }>(
      `SELECT pausado, visto_em > now() - interval '3 minutes' AS recente FROM enriquecimento.servico WHERE id = 1`,
    );
    const r = rows[0];
    if (!r) return 'desconhecido';
    if (!r.recente) return 'fora';
    return r.pausado ? 'pausado' : 'rodando';
  } catch {
    return 'desconhecido';
  }
}

/**
 * Andamento de cada etapa da campanha, para a tela mostrar se está andando e onde parou:
 * base de CNPJ (e estados que a base ainda não tem), buscas no Maps (com o último erro) e
 * enriquecimento (feitos, na fila e se o serviço está rodando).
 */
async function comAndamento<T extends ComProgresso>(db: Executor, campanhas: T[]): Promise<T[]> {
  if (!campanhas.length) return campanhas;
  const ids = campanhas.map((c) => Number(c.id));
  const [fila, servico, base, enriq, erros] = await Promise.all([
    naFilaDoEnriquecimento(db),
    estadoDoEnriquecimento(db),
    db.query<{ ufs: string[] }>(
      `SELECT ufs FROM base_cnpj.importacoes
        WHERE status = 'concluida' AND motivo <> 'mei' ORDER BY concluido_em DESC LIMIT 1`,
    ),
    db.query<{ campanha_id: string; enriquecidos: number; elegiveis: number }>(
      `SELECT ce.campanha_id, count(*) FILTER (WHERE l.status = 'concluido')::int AS enriquecidos,
              count(*)::int AS elegiveis
         FROM descoberta.campanha_empresas ce
         JOIN descoberta.empresas e ON e.id = ce.empresa_id AND NOT e.mei
         LEFT JOIN enriquecimento.leads l ON l.empresa_id = e.id
        WHERE ce.campanha_id = ANY($1::bigint[])
          AND NOT EXISTS (SELECT 1 FROM comercial.v_empresas_descartadas d
                           WHERE d.empresa_id = e.id AND d.conta_id = ${contaSql()})
        GROUP BY 1`,
      [ids],
    ),
    db.query<{ campanha_id: string; erro: string; total: number }>(
      `SELECT DISTINCT ON (campanha_id) campanha_id, erro,
              count(*) OVER (PARTITION BY campanha_id)::int AS total
         FROM descoberta.buscas_maps
        WHERE campanha_id = ANY($1::bigint[]) AND erro IS NOT NULL
          AND (status IN ('pendente', 'rodando', 'bloqueada') OR concluido_em > now() - interval '1 day')
        ORDER BY campanha_id, coalesce(concluido_em, criado_em) DESC`,
      [ids],
    ),
  ]);
  const ufsNaBase = base.rows[0]?.ufs ?? null;
  const porCampanha = new Map(enriq.rows.map((r) => [Number(r.campanha_id), r]));
  const erroPorCampanha = new Map(erros.rows.map((r) => [Number(r.campanha_id), r.erro]));
  // Busca pendente/rodando sem tarefa na fila não anda sozinha: a tela mostra "Parada" com "Tentar de novo".
  const paradas = await db
    .query<{ campanha_id: string; n: number }>(
      `SELECT b.campanha_id, count(*)::int AS n FROM descoberta.buscas_maps b
        WHERE b.campanha_id = ANY($1::bigint[]) AND b.status IN ('pendente', 'rodando')
          AND b.criado_em < now() - interval '1 minute'
          AND NOT EXISTS (SELECT 1 FROM fila.job j
                           WHERE j.name IN ('maps.buscar', 'maps.coletar') AND j.state IN ('created', 'retry', 'active')
                             AND (j.data ->> 'buscaId')::bigint = b.id)
        GROUP BY 1`,
      [ids],
    )
    .then((r) => new Map(r.rows.map((x) => [Number(x.campanha_id), x.n])))
    .catch(() => new Map<number, number>());
  for (const c of campanhas) {
    const ufs = [...new Set(c.cidades.map((x) => x.uf.toUpperCase()))];
    const e = porCampanha.get(Number(c.id));
    Object.assign(c.progresso, {
      naFilaEnriquecimento: fila.get(Number(c.id)) ?? 0,
      enriquecidos: e?.enriquecidos ?? 0,
      elegiveis: e?.elegiveis ?? 0,
      servicoEnriquecimento: servico,
      // Estados da campanha que a última importação da Receita não trouxe.
      ufsForaDaBase: ufsNaBase ? ufs.filter((u) => !ufsNaBase.includes(u)) : ufs,
      erroBusca: erroPorCampanha.get(Number(c.id)) ?? null,
      buscasParadas: paradas.get(Number(c.id)) ?? 0,
    });
  }
  return campanhas;
}

export async function listar(db: Executor) {
  const { rows } = await db.query<ComProgresso>(
    `${SELECT} WHERE c.conta_id = ${contaSql()} ORDER BY CASE c.status WHEN 'ativa' THEN 0 WHEN 'pausada' THEN 1 WHEN 'rascunho' THEN 2 ELSE 3 END, c.criado_em DESC`,
  );
  return comAndamento(db, rows);
}

export async function obter(db: Executor, id: number) {
  const { rows } = await db.query<ComProgresso>(`${SELECT} WHERE c.id = $1 AND c.conta_id = ${contaSql()}`, [
    id,
  ]);
  return (await comAndamento(db, rows))[0] ?? null;
}

export async function nichoAtivo(db: Executor, nichoId: number): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM cadastro.nichos WHERE id = $1 AND ativo AND conta_id = ${contaSql()}`,
    [nichoId],
  );
  return rows.length > 0;
}

export async function criar(db: Executor, c: CampanhaEntrada): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO cadastro.campanhas
       (conta_id, nome, nicho_id, cidades, raio_km, meta_diaria, limite_envios_dia, cadencia, modo, max_por_busca)
     VALUES (${contaSql()}, $1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      c.nome,
      c.nichoId,
      JSON.stringify(c.cidades),
      c.raioKm,
      c.metaDiaria,
      c.limiteEnviosDia,
      c.cadencia,
      c.modo,
      c.maxPorBusca,
    ],
  );
  return rows[0]!.id;
}

const COLUNAS: Record<string, string> = {
  nome: 'nome',
  nichoId: 'nicho_id',
  cidades: 'cidades',
  raioKm: 'raio_km',
  metaDiaria: 'meta_diaria',
  limiteEnviosDia: 'limite_envios_dia',
  cadencia: 'cadencia',
  modo: 'modo',
  maxPorBusca: 'max_por_busca',
};

export async function atualizar(db: Executor, id: number, dados: Record<string, unknown>) {
  const sets: string[] = [];
  const valores: unknown[] = [id];
  for (const [campo, valor] of Object.entries(dados)) {
    const coluna = COLUNAS[campo];
    if (!coluna || valor === undefined) continue;
    valores.push(campo === 'cidades' ? JSON.stringify(valor) : valor);
    sets.push(`${coluna} = $${valores.length}`);
  }
  if (sets.length)
    await db.query(
      `UPDATE cadastro.campanhas SET ${sets.join(', ')} WHERE id = $1 AND conta_id = ${contaSql()}`,
      valores,
    );
}

export async function statusAtual(db: Executor, id: number): Promise<StatusCampanha | null> {
  const { rows } = await db.query<{ status: StatusCampanha }>(
    `SELECT status FROM cadastro.campanhas WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id],
  );
  return rows[0]?.status ?? null;
}

export async function mudarStatus(db: Executor, id: number, status: StatusCampanha) {
  await db.query(
    `UPDATE cadastro.campanhas
        SET status = $2, iniciada_em = CASE WHEN $2 = 'ativa' THEN coalesce(iniciada_em, now()) ELSE iniciada_em END
      WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id, status],
  );
}

export async function baseCnpjImportada(db: Executor): Promise<boolean> {
  const { rows } = await db.query(`SELECT 1 FROM base_cnpj.v_ultima_importacao WHERE status = 'concluida'`);
  return rows.length > 0;
}

/** Leads da campanha que podem voltar ao enriquecimento: sem MEI (se o nicho exclui) e sem descartados. */
const elegiveis = () => `
  FROM descoberta.campanha_empresas ce
  JOIN descoberta.empresas e ON e.id = ce.empresa_id
  JOIN cadastro.campanhas cp ON cp.id = ce.campanha_id
  JOIN cadastro.nichos n ON n.id = cp.nicho_id
  LEFT JOIN enriquecimento.leads l ON l.empresa_id = e.id
 WHERE ce.campanha_id = $1 AND cp.conta_id = ${contaSql()}
   AND NOT (e.mei AND n.excluir_mei)
   AND NOT EXISTS (SELECT 1 FROM comercial.v_empresas_descartadas d
                    WHERE d.empresa_id = e.id AND d.conta_id = cp.conta_id)`;

const SEM_DECISOR = `NOT EXISTS (SELECT 1 FROM enriquecimento.pessoas p WHERE p.empresa_id = e.id AND p.decisor)`;

const FILTRO_ESCOPO: Record<EscopoReenriquecer, string> = {
  ab: `l.faixa IN ('A', 'B')`,
  sem_decisor: SEM_DECISOR,
  todos: 'true',
};

export async function previaReenriquecer(db: Executor, campanhaId: number) {
  const { rows } = await db.query<{ ab: number; semDecisor: number; todos: number }>(
    `SELECT count(*) FILTER (WHERE ${FILTRO_ESCOPO.ab})::int AS ab,
            count(*) FILTER (WHERE ${SEM_DECISOR})::int AS "semDecisor",
            count(*)::int AS todos
       ${elegiveis()}`,
    [campanhaId],
  );
  return rows[0] ?? { ab: 0, semDecisor: 0, todos: 0 };
}

export async function empresasParaReenriquecer(
  db: Executor,
  campanhaId: number,
  escopo: EscopoReenriquecer,
): Promise<number[]> {
  // Notas A primeiro: o que mais importa fica pronto antes.
  const { rows } = await db.query<{ id: number }>(
    `SELECT e.id::int ${elegiveis()} AND ${FILTRO_ESCOPO[escopo]}
      ORDER BY l.score DESC NULLS LAST, e.id`,
    [campanhaId],
  );
  return rows.map((r) => r.id);
}

/** Buscas no Maps da campanha (para tirar da fila as que ainda não rodaram). */
export async function buscasDaCampanha(db: Executor, campanhaId: number): Promise<number[]> {
  const { rows } = await db.query<{ id: number }>(
    `SELECT id::int FROM descoberta.buscas_maps WHERE campanha_id = $1 AND conta_id = ${contaSql()}`,
    [campanhaId],
  );
  return rows.map((r) => r.id);
}

/**
 * Apaga a campanha e os leads que só ela achou (com enriquecimento e funil). Leads achados também
 * por outra campanha ficam. Base de CNPJ e nichos não são tocados.
 *
 * Exceção consciente à regra "um dono por schema": é uma faxina de teste pedida pela pessoa, feita
 * numa transação só. Os workers tratam o que sumiu (empresa/busca inexistente → job descartado).
 */
export async function apagarComLeads(pool: Pool, campanhaId: number) {
  return comTransacao(pool, async (tx) => {
    const { rows: dona } = await tx.query(
      `SELECT 1 FROM cadastro.campanhas WHERE id = $1 AND conta_id = ${contaSql()}`,
      [campanhaId],
    );
    if (!dona.length) return { leadsApagados: 0 };
    const { rows } = await tx.query<{ id: number }>(
      `SELECT ce.empresa_id::int AS id FROM descoberta.campanha_empresas ce
        WHERE ce.campanha_id = $1
          AND NOT EXISTS (SELECT 1 FROM descoberta.campanha_empresas o
                           WHERE o.empresa_id = ce.empresa_id AND o.campanha_id <> $1)`,
      [campanhaId],
    );
    const ids = rows.map((r) => r.id);
    await tx.query(
      `DELETE FROM comercial.oportunidades WHERE conta_id = ${contaSql()} AND empresa_id = ANY($1::bigint[])`,
      [ids],
    );
    for (const t of ['contatos', 'pessoas', 'etapas', 'leads'])
      await tx.query(`DELETE FROM enriquecimento.${t} WHERE empresa_id = ANY($1::bigint[])`, [ids]);
    await tx.query('DELETE FROM descoberta.campanha_empresas WHERE campanha_id = $1', [campanhaId]);
    await tx.query('DELETE FROM descoberta.buscas_maps WHERE campanha_id = $1', [campanhaId]);
    await tx.query('DELETE FROM descoberta.empresas WHERE id = ANY($1::bigint[])', [ids]);
    // Sobras de enriquecimento sem empresa (job que terminou durante uma faxina anterior).
    for (const t of ['contatos', 'pessoas', 'etapas', 'leads'])
      await tx.query(
        `DELETE FROM enriquecimento.${t} x WHERE NOT EXISTS (SELECT 1 FROM descoberta.empresas e WHERE e.id = x.empresa_id)`,
      );
    await tx.query(`DELETE FROM cadastro.campanhas WHERE id = $1 AND conta_id = ${contaSql()}`, [campanhaId]);
    return { leadsApagados: ids.length };
  });
}

/** Teto de gasto da campanha em buscas pagas no Google. null = sem teto; 0 = só a franquia grátis. */
export async function mudarTetoPlaces(db: Executor, id: number, teto: number | null) {
  await db.query(
    `UPDATE cadastro.campanhas SET teto_places_usd = $2 WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id, teto],
  );
}
