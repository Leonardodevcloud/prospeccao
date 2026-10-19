import { comTransacao, type Executor, type Pool } from '@prospeccao/db';
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
  /** MEI fica de fora do enriquecimento e da lista (padrão). */
  excluir_mei: boolean;
  /** Teto de gasto em buscas pagas no Google. null = sem teto; 0 = só a franquia grátis. */
  teto_places_usd: number | null;
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
 * Cria as buscas da cidade inteira (cidade × termo) que ainda não rodaram dentro do prazo de
 * rebusca e devolve os ids de todas as buscas pendentes da campanha (inclusive as por bairro).
 * Buscas que pararam no teto voltam para a fila; uma busca do Places "rodando" que não anda há
 * 10 minutos (o worker caiu no meio) também.
 */
export async function prepararBuscas(
  db: Executor,
  campanha: CampanhaDescoberta,
  rebuscaDias: number,
): Promise<number[]> {
  const pares = campanha.cidades.flatMap((c) => campanha.termos_maps.map((termo) => ({ ...c, termo })));
  for (const p of pares) {
    const { rows: existentes } = await db.query<{ id: number }>(
      `SELECT id FROM descoberta.buscas_maps
        WHERE campanha_id = $1 AND cidade = $2 AND uf = $3 AND lower(termo) = lower($4) AND bairro IS NULL
          AND (status IN ('pendente', 'rodando', 'bloqueada')
               OR (status = 'concluida' AND concluido_em > now() - make_interval(days => $5)))
        ORDER BY id DESC LIMIT 1`,
      [campanha.id, p.cidade, p.uf, p.termo, rebuscaDias],
    );
    if (existentes[0]) continue;
    await db.query(
      `INSERT INTO descoberta.buscas_maps (campanha_id, cidade, uf, termo) VALUES ($1, $2, $3, $4)`,
      [campanha.id, p.cidade, p.uf, p.termo],
    );
  }
  await db.query(
    `UPDATE descoberta.buscas_maps SET status = 'pendente'
      WHERE campanha_id = $1
        AND (status = 'bloqueada'
             OR (status = 'rodando' AND fonte = 'places' AND iniciado_em < now() - interval '10 minutes'))`,
    [campanha.id],
  );
  const { rows } = await db.query<{ id: number }>(
    `SELECT id FROM descoberta.buscas_maps WHERE campanha_id = $1 AND status = 'pendente'
      ORDER BY bairro NULLS FIRST, id`,
    [campanha.id],
  );
  return rows.map((r) => Number(r.id));
}

/**
 * A busca da cidade inteira encheu (o Google entrega no máximo 60 lugares por texto): cria uma
 * busca por bairro para o mesmo termo. Devolve os ids pendentes (novos ou que já existiam).
 */
export async function criarBuscasPorBairro(
  db: Executor,
  busca: Pick<Busca, 'campanha_id' | 'cidade' | 'uf' | 'termo'>,
  bairros: string[],
  rebuscaDias: number,
): Promise<number[]> {
  const ids: number[] = [];
  for (const bairro of bairros) {
    const { rows: existentes } = await db.query<{ id: number; status: string }>(
      `SELECT id, status FROM descoberta.buscas_maps
        WHERE campanha_id = $1 AND cidade = $2 AND uf = $3 AND lower(termo) = lower($4) AND bairro = $5
          AND (status IN ('pendente', 'rodando', 'bloqueada')
               OR (status = 'concluida' AND concluido_em > now() - make_interval(days => $6)))
        ORDER BY id DESC LIMIT 1`,
      [busca.campanha_id, busca.cidade, busca.uf, busca.termo, bairro, rebuscaDias],
    );
    const existente = existentes[0];
    if (existente) {
      if (existente.status === 'pendente') ids.push(Number(existente.id));
      continue;
    }
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO descoberta.buscas_maps (campanha_id, cidade, uf, termo, bairro, fonte)
       VALUES ($1, $2, $3, $4, $5, 'places') RETURNING id`,
      [busca.campanha_id, busca.cidade, busca.uf, busca.termo, bairro],
    );
    ids.push(Number(rows[0]!.id));
  }
  return ids;
}

/** Bairros com empresas do nicho na base de CNPJ (mais cheios primeiro). */
export async function bairrosParaBusca(
  db: Executor,
  c: { cidade: string; uf: string; cnaes: string[]; limite: number },
): Promise<string[]> {
  const { rows } = await db.query<{ bairro: string }>(
    'SELECT bairro FROM descoberta.bairros_para_busca($1, $2, $3::text[], $4)',
    [c.cidade, c.uf, c.cnaes, c.limite],
  );
  return rows.map((r) => r.bairro);
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
          -- MEI nem entra na campanha quando o nicho exclui MEI.
          AND NOT (e.mei AND coalesce($6::boolean, true))
     ),
     gravadas AS (
       INSERT INTO descoberta.empresas AS emp
         (cnpj, cnpj_basico, nome, razao_social, cnae_principal, porte, situacao, data_abertura,
          logradouro, numero, bairro, cep, cidade, uf, telefones_receita, email_receita, mei)
       SELECT cnpj, cnpj_basico, coalesce(nome_fantasia, razao_social, cnpj), razao_social, cnae_principal,
              porte, situacao, data_inicio, logradouro, numero, bairro, cep, cidade, uf, telefones, email, mei
         FROM candidatos
       ON CONFLICT (cnpj) DO UPDATE SET
         razao_social = EXCLUDED.razao_social, cnae_principal = EXCLUDED.cnae_principal,
         porte = EXCLUDED.porte, situacao = EXCLUDED.situacao, logradouro = EXCLUDED.logradouro,
         numero = EXCLUDED.numero, bairro = EXCLUDED.bairro, cep = EXCLUDED.cep,
         telefones_receita = EXCLUDED.telefones_receita, email_receita = EXCLUDED.email_receita,
         mei = EXCLUDED.mei,
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
    [c.id, JSON.stringify(c.cidades), c.cnaes, c.portes, c.idade_minima_anos, c.excluir_mei],
  );
  if (c.excluir_mei) await tirarMeiDaCampanha(db, c.id);
  return rows[0]?.total ?? 0;
}

/**
 * A base marcou mais MEI (leitura do Simples): atualiza a marca e tira da campanha os que ainda
 * não foram trabalhados no funil.
 */
export async function tirarMeiDaCampanha(db: Executor, campanhaId: number): Promise<number> {
  await db.query(
    `UPDATE descoberta.empresas d SET mei = true
       FROM base_cnpj.v_estabelecimentos e
      WHERE e.cnpj = d.cnpj AND e.mei AND NOT d.mei
        AND d.id IN (SELECT empresa_id FROM descoberta.campanha_empresas WHERE campanha_id = $1)`,
    [campanhaId],
  );
  const { rowCount } = await db.query(
    `DELETE FROM descoberta.campanha_empresas ce
      USING descoberta.empresas e
      WHERE e.id = ce.empresa_id AND ce.campanha_id = $1 AND e.mei
        AND NOT EXISTS (SELECT 1 FROM comercial.oportunidades o WHERE o.empresa_id = e.id)`,
    [campanhaId],
  );
  return rowCount ?? 0;
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
  /** null = cidade inteira. */
  bairro: string | null;
  fonte: 'apify' | 'places' | 'planilha';
  paginas: number;
  proxima_pagina: string | null;
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

/**
 * Falha que ainda vai ser tentada de novo: guarda o motivo. Busca do Places volta para pendente
 * (a próxima tentativa retoma da página onde parou); run do Apify segue rodando.
 */
export async function anotarFalhaBusca(db: Executor, id: number, erro: string) {
  await db.query(
    `UPDATE descoberta.buscas_maps
        SET erro = $2, status = CASE WHEN fonte = 'places' AND status = 'rodando' THEN 'pendente' ELSE status END
      WHERE id = $1`,
    [id, erro],
  );
}

/**
 * Pega a busca para o Places. Só uma tarefa por vez: pendente, ou "rodando" sem andar há
 * 4 minutos (a tarefa anterior caiu). Devolve null se outra tarefa está nela ou já acabou.
 */
export async function reivindicarBuscaPlaces(db: Executor, id: number): Promise<Busca | null> {
  const { rows } = await db.query<Busca>(
    `UPDATE descoberta.buscas_maps
        SET status = 'rodando', fonte = 'places', iniciado_em = now()
      WHERE id = $1
        AND (status = 'pendente' OR (status = 'rodando' AND fonte = 'places' AND iniciado_em < now() - interval '4 minutes'))
      RETURNING *`,
    [id],
  );
  return rows[0] ?? null;
}

/** Página lida: guarda onde parou (para retomar) e renova a posse da busca. */
export async function gravarPaginaPlaces(db: Executor, id: number, paginas: number, proxima: string | null) {
  await db.query(
    `UPDATE descoberta.buscas_maps SET paginas = $2, proxima_pagina = $3, iniciado_em = now() WHERE id = $1`,
    [id, paginas, proxima],
  );
}

/** Parou no teto: fica "bloqueada" com o motivo até a campanha ser retomada. */
export async function bloquearBusca(db: Executor, id: number, motivo: string) {
  await db.query(
    `UPDATE descoberta.buscas_maps SET status = 'bloqueada', erro = $2, concluido_em = now() WHERE id = $1`,
    [id, motivo],
  );
}

export async function contarResultados(db: Executor, buscaId: number): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM descoberta.maps_resultados WHERE busca_id = $1',
    [buscaId],
  );
  return rows[0]?.n ?? 0;
}

/* ---------------- Uso do Google Places (franquia, custo e tetos) ---------------- */

export interface ConfigPlaces {
  franquia_mensal: number;
  preco_mil_usd: number;
  cotacao_brl: number;
  teto_mensal_usd: number | null;
  max_bairros: number;
}

const CONFIG_PADRAO: ConfigPlaces = {
  franquia_mensal: 1000,
  preco_mil_usd: 35,
  cotacao_brl: 5.5,
  teto_mensal_usd: null,
  max_bairros: 150,
};

export async function configPlaces(db: Executor): Promise<ConfigPlaces> {
  const { rows } = await db.query<ConfigPlaces>('SELECT * FROM cadastro.v_config_places');
  return rows[0] ?? CONFIG_PADRAO;
}

const usd = (v: number) => `US$ ${v.toFixed(2).replace('.', ',')}`;

export type ReservaPlaces = { ok: true; usoId: number; paga: boolean } | { ok: false; motivo: string };

/**
 * Antes de cada pedido ao Google: conta o uso do mês, decide se o pedido é grátis ou pago e
 * confere os tetos. Um pedido de cada vez (lock), para duas buscas em paralelo não passarem
 * juntas do teto. O pedido fica registrado já aqui; se falhar, `cancelarUsoPlaces` desfaz.
 */
export async function reservarUsoPlaces(
  pool: Pool,
  r: { campanhaId: number; buscaId: number; tetoCampanhaUsd: number | null },
): Promise<ReservaPlaces> {
  return comTransacao(pool, async (db) => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext('descoberta.uso_places'))`);
    const cfg = await configPlaces(db);
    const { rows: mes } = await db.query<{ pedidos: number; gasto: number }>(
      `SELECT count(*)::int AS pedidos, coalesce(sum(custo_usd), 0)::float8 AS gasto
         FROM descoberta.uso_places WHERE mes = descoberta.mes_places()`,
    );
    const usados = mes[0]?.pedidos ?? 0;
    const paga = usados >= cfg.franquia_mensal;
    const custo = paga ? cfg.preco_mil_usd / 1000 : 0;

    if (paga && r.tetoCampanhaUsd != null) {
      if (r.tetoCampanhaUsd <= 0) {
        return {
          ok: false as const,
          motivo:
            'A franquia grátis do Google acabou e esta campanha está em "só o grátis". Ela volta a buscar no próximo mês, ou libere buscas pagas.',
        };
      }
      const { rows } = await db.query<{ gasto: number }>(
        `SELECT coalesce(sum(custo_usd), 0)::float8 AS gasto FROM descoberta.uso_places WHERE campanha_id = $1`,
        [r.campanhaId],
      );
      if ((rows[0]?.gasto ?? 0) + custo > r.tetoCampanhaUsd + 1e-9) {
        return {
          ok: false as const,
          motivo: `Teto da campanha atingido: ${usd(r.tetoCampanhaUsd)} em buscas pagas no Google. Aumente o teto para continuar.`,
        };
      }
    }
    if (paga && cfg.teto_mensal_usd != null && (mes[0]?.gasto ?? 0) + custo > cfg.teto_mensal_usd + 1e-9) {
      return {
        ok: false as const,
        motivo:
          cfg.teto_mensal_usd <= 0
            ? 'A franquia grátis do Google acabou e o teto do mês é US$ 0: as buscas voltam no próximo mês.'
            : `Teto do mês no Google atingido (${usd(cfg.teto_mensal_usd)}). Aumente o teto do mês para continuar.`,
      };
    }
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO descoberta.uso_places (mes, campanha_id, busca_id, paga, custo_usd)
       VALUES (descoberta.mes_places(), $1, $2, $3, $4) RETURNING id`,
      [r.campanhaId, r.buscaId, paga, custo],
    );
    return { ok: true as const, usoId: Number(rows[0]!.id), paga };
  });
}

export async function confirmarUsoPlaces(db: Executor, usoId: number, itens: number) {
  await db.query('UPDATE descoberta.uso_places SET itens = $2 WHERE id = $1', [usoId, itens]);
}

/** O pedido falhou (o Google não cobra pedido com erro): não conta no uso. */
export async function cancelarUsoPlaces(db: Executor, usoId: number) {
  await db.query('DELETE FROM descoberta.uso_places WHERE id = $1', [usoId]);
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
        -- MEI não contrata o serviço: não gasta enriquecimento (se o nicho excluir MEI).
        AND NOT (e.mei AND c.excluir_mei)
        -- Achada de novo, mas já marcada como fora do perfil no funil: não gasta enriquecimento.
        AND NOT EXISTS (SELECT 1 FROM comercial.v_empresas_descartadas d WHERE d.empresa_id = e.id)
        AND ($1::bigint IS NULL OR ce.campanha_id = $1)
        AND ($2::bigint IS NULL OR ce.empresa_id = $2)
      RETURNING ce.empresa_id, ce.campanha_id`,
    [filtro.campanhaId ?? null, filtro.empresaId ?? null],
  );
  return rows;
}

/** Busca do tipo planilha: já nasce "rodando" (as linhas chegam junto) e fecha no fim da importação. */
export async function criarBuscaPlanilha(
  db: Executor,
  campanhaId: number,
  cidade: string,
  uf: string,
): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO descoberta.buscas_maps (campanha_id, cidade, uf, termo, status, fonte, iniciado_em)
     VALUES ($1, $2, $3, 'planilha do Maps', 'rodando', 'planilha', now()) RETURNING id`,
    [campanhaId, cidade, uf],
  );
  return rows[0]!.id;
}
