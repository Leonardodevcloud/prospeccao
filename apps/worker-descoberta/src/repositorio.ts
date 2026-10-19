import type { Executor } from '@prospeccao/db';
import type { ItemMaps } from '@prospeccao/integrations/apify';

/** Leituras de outros domínios (só views) e escritas no schema descoberta. */

export interface CampanhaDescoberta {
  id: number;
  nome: string;
  status: string;
  cidades: { cidade: string; uf: string }[];
  /** null = abrangência nacional. */
  raio_km: number | null;
  max_por_busca: number;
  nicho_id: number;
  cnaes: string[];
  termos_maps: string[];
  palavras_positivas: string[];
  palavras_negativas: string[];
  portes: string[];
  idade_minima_anos: number;
}

export async function obterCampanha(db: Executor, id: number): Promise<CampanhaDescoberta | null> {
  const { rows } = await db.query<CampanhaDescoberta>(
    'SELECT * FROM cadastro.v_campanhas_descoberta WHERE id = $1',
    [id],
  );
  return rows[0] ?? null;
}

export async function campanhasAtivas(db: Executor): Promise<number[]> {
  const { rows } = await db.query<{ id: number }>(
    `SELECT id FROM cadastro.v_campanhas_descoberta WHERE status = 'ativa' ORDER BY id`,
  );
  return rows.map((r) => r.id);
}

/**
 * Cria as buscas (cidade × termo) que ainda não rodaram dentro do prazo de
 * rebusca e devolve os ids das que precisam ser disparadas (novas ou pendentes).
 */
export async function prepararBuscas(
  db: Executor,
  campanha: CampanhaDescoberta,
  rebuscaDias: number,
): Promise<number[]> {
  const pares = campanha.cidades.flatMap((c) => campanha.termos_maps.map((termo) => ({ ...c, termo })));
  const ids: number[] = [];
  for (const p of pares) {
    const { rows: existentes } = await db.query<{ id: number; status: string }>(
      `SELECT id, status FROM descoberta.buscas_maps
        WHERE campanha_id = $1 AND cidade = $2 AND uf = $3 AND lower(termo) = lower($4)
          AND (status IN ('pendente', 'rodando') OR (status = 'concluida' AND concluido_em > now() - make_interval(days => $5)))
        ORDER BY id DESC LIMIT 1`,
      [campanha.id, p.cidade, p.uf, p.termo, rebuscaDias],
    );
    const existente = existentes[0];
    if (existente) {
      if (existente.status === 'pendente') ids.push(existente.id);
      continue;
    }
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO descoberta.buscas_maps (campanha_id, cidade, uf, termo) VALUES ($1, $2, $3, $4) RETURNING id`,
      [campanha.id, p.cidade, p.uf, p.termo],
    );
    ids.push(rows[0]!.id);
  }
  return ids;
}

/**
 * Traz da base de CNPJ os estabelecimentos ativos do nicho nas cidades da
 * campanha. Atualiza os dados cadastrais de quem já existe e liga à campanha.
 */
export async function importarEmpresasDaBase(db: Executor, c: CampanhaDescoberta): Promise<number> {
  const { rows } = await db.query<{ total: number }>(
    `WITH cidades AS (
       SELECT public.normalizar_cidade(x ->> 'cidade') AS cidade, upper(x ->> 'uf') AS uf
         FROM jsonb_array_elements($2::jsonb) x
     ),
     candidatos AS (
       SELECT DISTINCT ON (e.cnpj) e.*
         FROM base_cnpj.v_estabelecimentos e
         JOIN cidades ci ON ci.uf = e.uf AND ci.cidade = e.cidade
        WHERE e.situacao = '02'
          AND (e.cnae_principal = ANY($3::text[]) OR e.cnaes_secundarios && $3::text[])
          AND e.porte = ANY($4::text[])
          AND ($5::int = 0 OR e.data_inicio <= current_date - make_interval(years => $5::int))
     ),
     gravadas AS (
       INSERT INTO descoberta.empresas AS emp
         (cnpj, cnpj_basico, nome, razao_social, cnae_principal, porte, situacao, data_abertura,
          logradouro, numero, bairro, cep, cidade, uf, telefones_receita, email_receita)
       SELECT cnpj, cnpj_basico, coalesce(nome_fantasia, razao_social, cnpj), razao_social, cnae_principal,
              porte, situacao, data_inicio, logradouro, numero, bairro, cep, cidade, uf, telefones, email
         FROM candidatos
       ON CONFLICT (cnpj) DO UPDATE SET
         razao_social = EXCLUDED.razao_social, cnae_principal = EXCLUDED.cnae_principal,
         porte = EXCLUDED.porte, situacao = EXCLUDED.situacao, logradouro = EXCLUDED.logradouro,
         numero = EXCLUDED.numero, bairro = EXCLUDED.bairro, cep = EXCLUDED.cep,
         telefones_receita = EXCLUDED.telefones_receita, email_receita = EXCLUDED.email_receita,
         -- o nome do Maps, quando existe, é o que o cliente reconhece; não sobrescreve
         nome = CASE WHEN emp.place_id IS NULL THEN EXCLUDED.nome ELSE emp.nome END
       RETURNING id
     ),
     ligadas AS (
       INSERT INTO descoberta.campanha_empresas (campanha_id, empresa_id, origem)
       SELECT $1, id, 'cnpj' FROM gravadas
       ON CONFLICT (campanha_id, empresa_id) DO UPDATE
         SET origem = CASE WHEN descoberta.campanha_empresas.origem = 'maps' THEN 'ambos'
                           ELSE descoberta.campanha_empresas.origem END
       RETURNING 1
     )
     SELECT count(*)::int AS total FROM ligadas`,
    [c.id, JSON.stringify(c.cidades), c.cnaes, c.portes, c.idade_minima_anos],
  );
  return rows[0]?.total ?? 0;
}

export interface Busca {
  id: number;
  campanha_id: number;
  cidade: string;
  uf: string;
  termo: string;
  status: string;
  apify_run_id: string | null;
  dataset_id: string | null;
  verificacoes: number;
}

export async function obterBusca(db: Executor, id: number): Promise<Busca | null> {
  const { rows } = await db.query<Busca>('SELECT * FROM descoberta.buscas_maps WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function marcarBuscaRodando(db: Executor, id: number, runId: string, datasetId: string) {
  await db.query(
    `UPDATE descoberta.buscas_maps
        SET status = 'rodando', apify_run_id = $2, dataset_id = $3, iniciado_em = now(), verificacoes = 0, erro = NULL
      WHERE id = $1`,
    [id, runId, datasetId],
  );
}

export async function contarVerificacao(db: Executor, id: number): Promise<number> {
  const { rows } = await db.query<{ verificacoes: number }>(
    'UPDATE descoberta.buscas_maps SET verificacoes = verificacoes + 1 WHERE id = $1 RETURNING verificacoes',
    [id],
  );
  return rows[0]?.verificacoes ?? 0;
}

export async function concluirBusca(db: Executor, id: number, erro: string | null, itens: number | null) {
  await db.query(
    `UPDATE descoberta.buscas_maps SET status = $2, erro = $3, itens = $4, concluido_em = now() WHERE id = $1`,
    [id, erro ? 'erro' : 'concluida', erro, itens],
  );
}

export async function buscasEmAberto(db: Executor, campanhaId: number): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM descoberta.buscas_maps WHERE campanha_id = $1 AND status IN ('pendente', 'rodando')`,
    [campanhaId],
  );
  return rows[0]?.n ?? 0;
}

export async function salvarResultado(db: Executor, buscaId: number, i: ItemMaps): Promise<number | null> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO descoberta.maps_resultados
       (busca_id, place_id, nome, categoria, telefone, endereco, cep, cidade, uf, lat, lng, nota, avaliacoes,
        site, url, fechada, entrega, dados)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     ON CONFLICT (busca_id, place_id) DO NOTHING
     RETURNING id`,
    [
      buscaId,
      i.placeId,
      i.nome,
      i.categoria,
      i.telefone,
      i.endereco,
      i.cep,
      i.cidade,
      i.uf,
      i.lat,
      i.lng,
      i.nota,
      i.avaliacoes,
      i.site,
      i.url,
      i.fechada,
      i.entrega,
      JSON.stringify(i.dados),
    ],
  );
  return rows[0]?.id ?? null;
}

export interface EmpresaLocalizar {
  id: number;
  lat: number | null;
  lng: number | null;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  cep: string | null;
  cidade: string;
  uf: string;
  maps_endereco: string | null;
  geo_tentativas: number;
}

export async function obterEmpresaLocalizar(db: Executor, id: number): Promise<EmpresaLocalizar | null> {
  const { rows } = await db.query<EmpresaLocalizar>(
    `SELECT id, lat, lng, logradouro, numero, bairro, cep, cidade, uf, maps_endereco, geo_tentativas
       FROM descoberta.empresas WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function gravarLocalizacao(db: Executor, id: number, geo: { lat: number; lng: number } | null) {
  await db.query(
    geo
      ? `UPDATE descoberta.empresas SET lat = $2, lng = $3, geo_fonte = 'ors', geo_em = now(),
           geo_tentativas = geo_tentativas + 1 WHERE id = $1`
      : `UPDATE descoberta.empresas SET geo_tentativas = geo_tentativas + 1, geo_em = now() WHERE id = $1`,
    geo ? [id, geo.lat, geo.lng] : [id],
  );
}

/**
 * Recalcula a base mais próxima, a distância e o "dentro do raio" de cada
 * campanha. Campanha nacional (sem raio) ou sem bases cadastradas: ninguém
 * fica de fora por distância.
 */
export async function recalcularDistancias(
  db: Executor,
  filtro: { empresaId?: number; campanhaId?: number },
) {
  const params = [filtro.empresaId ?? null, filtro.campanhaId ?? null];
  await db.query(
    `UPDATE descoberta.empresas e
        SET base_id = p.base_id, distancia_base_km = round(p.km::numeric, 2)
       FROM (
         SELECT e2.id, b.id AS base_id, b.km
           FROM descoberta.empresas e2
           CROSS JOIN LATERAL (
             SELECT ba.id, public.distancia_km(e2.lat, e2.lng, ba.lat, ba.lng) AS km
               FROM cadastro.v_bases_ativas ba ORDER BY 2 LIMIT 1
           ) b
          WHERE e2.lat IS NOT NULL
            AND ($1::bigint IS NULL OR e2.id = $1)
            AND ($2::bigint IS NULL OR e2.id IN (SELECT empresa_id FROM descoberta.campanha_empresas WHERE campanha_id = $2))
       ) p
      WHERE e.id = p.id`,
    params,
  );
  await db.query(
    `UPDATE descoberta.campanha_empresas ce
        SET dentro_do_raio = CASE
              WHEN c.raio_km IS NULL THEN true
              WHEN NOT EXISTS (SELECT 1 FROM cadastro.v_bases_ativas) THEN true
              WHEN e.distancia_base_km IS NULL THEN NULL
              ELSE e.distancia_base_km <= c.raio_km END
       FROM descoberta.empresas e, cadastro.v_campanhas_descoberta c
      WHERE e.id = ce.empresa_id AND c.id = ce.campanha_id
        AND ($1::bigint IS NULL OR ce.empresa_id = $1)
        AND ($2::bigint IS NULL OR ce.campanha_id = $2)`,
    params,
  );
}

export async function empresasSemLocalizacao(
  db: Executor,
  campanhaId: number,
  maxTentativas: number,
): Promise<number[]> {
  const { rows } = await db.query<{ id: number }>(
    `SELECT e.id FROM descoberta.empresas e
       JOIN descoberta.campanha_empresas ce ON ce.empresa_id = e.id
       JOIN cadastro.v_campanhas_descoberta c ON c.id = ce.campanha_id
      WHERE ce.campanha_id = $1 AND c.raio_km IS NOT NULL
        AND e.lat IS NULL AND e.geo_tentativas < $2
        AND coalesce(e.maps_fechada, false) = false`,
    [campanhaId, maxTentativas],
  );
  return rows.map((r) => r.id);
}

/**
 * Marca e devolve as empresas prontas para enriquecer: localizadas, dentro do
 * raio, não fechadas e ainda não enviadas. Só campanhas ativas.
 */
export async function reservarParaEnriquecimento(
  db: Executor,
  filtro: { campanhaId?: number; empresaId?: number },
): Promise<{ empresa_id: number; campanha_id: number }[]> {
  const { rows } = await db.query<{ empresa_id: number; campanha_id: number }>(
    `UPDATE descoberta.campanha_empresas ce
        SET enriquecimento_solicitado_em = now()
       FROM descoberta.empresas e, cadastro.v_campanhas_descoberta c
      WHERE e.id = ce.empresa_id AND c.id = ce.campanha_id AND c.status = 'ativa'
        AND ce.enriquecimento_solicitado_em IS NULL
        AND ce.dentro_do_raio
        AND coalesce(e.maps_fechada, false) = false
        AND ($1::bigint IS NULL OR ce.campanha_id = $1)
        AND ($2::bigint IS NULL OR ce.empresa_id = $2)
      RETURNING ce.empresa_id, ce.campanha_id`,
    [filtro.campanhaId ?? null, filtro.empresaId ?? null],
  );
  return rows;
}
