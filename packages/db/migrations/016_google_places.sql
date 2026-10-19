-- Google Places (Text Search) no lugar do Apify nas buscas do Maps, com conta de uso e custo.
--
-- O Google não informa por API quanto da franquia grátis do mês ainda resta: o sistema conta
-- cada pedido que ele mesmo faz (descoberta.uso_places) e calcula o custo pela tabela de
-- preços guardada em cadastro.config_places (editável na tela, para quando o Google mudar).
-- O mês de cobrança do Google segue o horário do Pacífico (America/Los_Angeles).

-- ---------------------------------------------------------------------------------------------
-- cadastro (dono: api)
-- ---------------------------------------------------------------------------------------------

CREATE TABLE cadastro.config_places (
  id               integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- Text Search Enterprise (traz telefone e site): 1.000 grátis/mês, depois US$ 35 por mil.
  franquia_mensal  integer NOT NULL DEFAULT 1000 CHECK (franquia_mensal >= 0),
  preco_mil_usd    numeric(8, 2) NOT NULL DEFAULT 35 CHECK (preco_mil_usd >= 0),
  cotacao_brl      numeric(6, 2) NOT NULL DEFAULT 5.50 CHECK (cotacao_brl > 0),
  -- null = sem teto mensal; 0 = nunca pagar (só a franquia grátis).
  teto_mensal_usd  numeric(10, 2) CHECK (teto_mensal_usd >= 0),
  -- Limite de bairros por cidade quando a busca da cidade inteira enche (60 lugares).
  max_bairros      integer NOT NULL DEFAULT 150 CHECK (max_bairros BETWEEN 0 AND 1000),
  atualizado_em    timestamptz NOT NULL DEFAULT now()
);
INSERT INTO cadastro.config_places DEFAULT VALUES;
CREATE TRIGGER config_places_atualizado BEFORE UPDATE ON cadastro.config_places
  FOR EACH ROW EXECUTE FUNCTION public.tocar_atualizado_em();

-- Teto de gasto da campanha em buscas pagas. null = sem teto; 0 = só a franquia grátis.
ALTER TABLE cadastro.campanhas
  ADD COLUMN teto_places_usd numeric(10, 2) CHECK (teto_places_usd >= 0);

CREATE OR REPLACE VIEW cadastro.v_campanhas_descoberta AS
SELECT cp.id,
       cp.nome,
       cp.status,
       cp.cidades,
       cp.raio_km::float8 AS raio_km,
       cp.max_por_busca,
       n.id AS nicho_id,
       n.cnaes,
       n.termos_maps,
       n.palavras_positivas,
       n.palavras_negativas,
       n.portes,
       n.idade_minima_anos,
       n.excluir_mei,
       cp.teto_places_usd::float8 AS teto_places_usd
  FROM cadastro.campanhas cp
  JOIN cadastro.nichos n ON n.id = cp.nicho_id;

-- cadastro → worker-descoberta: tabela de preços e tetos.
CREATE VIEW cadastro.v_config_places AS
SELECT franquia_mensal,
       preco_mil_usd::float8   AS preco_mil_usd,
       cotacao_brl::float8     AS cotacao_brl,
       teto_mensal_usd::float8 AS teto_mensal_usd,
       max_bairros
  FROM cadastro.config_places WHERE id = 1;

-- ---------------------------------------------------------------------------------------------
-- descoberta (dono: worker-descoberta)
-- ---------------------------------------------------------------------------------------------

ALTER TABLE descoberta.buscas_maps
  ADD COLUMN bairro          text,                     -- null = cidade inteira
  ADD COLUMN fonte           text NOT NULL DEFAULT 'apify' CHECK (fonte IN ('apify', 'places')),
  ADD COLUMN paginas         integer NOT NULL DEFAULT 0, -- páginas do Places já lidas (até 3)
  ADD COLUMN proxima_pagina  text;                     -- nextPageToken para retomar

-- "bloqueada": parou no teto (da campanha ou do mês). Volta para pendente ao retomar a campanha.
ALTER TABLE descoberta.buscas_maps DROP CONSTRAINT buscas_maps_status_check;
ALTER TABLE descoberta.buscas_maps ADD CONSTRAINT buscas_maps_status_check
  CHECK (status IN ('pendente', 'rodando', 'concluida', 'erro', 'bloqueada'));
CREATE INDEX buscas_chave_idx ON descoberta.buscas_maps (campanha_id, uf, cidade, lower(termo), bairro);

-- Um registro por pedido feito ao Google (cada página conta como um pedido).
-- Sem FK para a busca: apagar uma campanha não pode apagar o que já foi gasto no mês.
CREATE TABLE descoberta.uso_places (
  id           bigserial PRIMARY KEY,
  mes          date NOT NULL,                          -- 1º dia do mês de cobrança (Pacífico)
  campanha_id  bigint,
  busca_id     bigint,
  sku          text NOT NULL DEFAULT 'text_search_enterprise',
  paga         boolean NOT NULL,                       -- passou da franquia quando foi feito
  custo_usd    numeric(10, 4) NOT NULL DEFAULT 0,
  itens        integer NOT NULL DEFAULT 0,
  criado_em    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX uso_places_mes_idx ON descoberta.uso_places (mes);
CREATE INDEX uso_places_campanha_idx ON descoberta.uso_places (campanha_id);

-- Mês de cobrança do Google para um instante.
CREATE FUNCTION descoberta.mes_places(t timestamptz DEFAULT now())
RETURNS date
LANGUAGE sql STABLE
AS $$ SELECT date_trunc('month', t AT TIME ZONE 'America/Los_Angeles')::date $$;

-- Bairros onde a base de CNPJ tem empresas ativas do nicho, dos mais cheios para os vazios.
-- Usada pelo worker (para dividir a busca) e pela api (para estimar o custo antes de rodar).
CREATE FUNCTION descoberta.bairros_para_busca(p_cidade text, p_uf text, p_cnaes text[], p_limite integer)
RETURNS TABLE (bairro text, empresas integer)
LANGUAGE sql STABLE
AS $$
  SELECT b AS bairro, count(*)::int AS empresas
    FROM (
      SELECT public.normalizar_cidade(e.bairro) AS b
        FROM base_cnpj.v_estabelecimentos e
       WHERE e.uf = upper(p_uf)
         AND e.cidade = public.normalizar_cidade(p_cidade)
         AND e.situacao = '02'
         AND (e.cnae_principal = ANY (p_cnaes) OR e.cnaes_secundarios && p_cnaes)
    ) x
   WHERE length(b) >= 3 AND b NOT IN ('SEM BAIRRO', 'NAO INFORMADO', 'ZONA RURAL')
   GROUP BY b
   ORDER BY count(*) DESC, b
   LIMIT greatest(p_limite, 0)
$$;

-- descoberta → api: uso do mês e por campanha.
CREATE VIEW descoberta.v_uso_places_mes AS
SELECT mes,
       count(*)::int                              AS pedidos,
       count(*) FILTER (WHERE paga)::int          AS pagos,
       coalesce(sum(custo_usd), 0)::float8        AS gasto_usd,
       coalesce(sum(itens), 0)::int               AS lugares
  FROM descoberta.uso_places
 GROUP BY mes;

CREATE VIEW descoberta.v_uso_places_campanha AS
SELECT campanha_id,
       count(*)::int                                                   AS pedidos,
       count(*) FILTER (WHERE paga)::int                               AS pagos,
       coalesce(sum(custo_usd), 0)::float8                             AS gasto_usd,
       count(*) FILTER (WHERE mes = descoberta.mes_places())::int      AS pedidos_mes,
       coalesce(sum(custo_usd) FILTER (WHERE mes = descoberta.mes_places()), 0)::float8 AS gasto_mes_usd
  FROM descoberta.uso_places
 GROUP BY campanha_id;

CREATE OR REPLACE VIEW descoberta.v_buscas_campanha AS
SELECT campanha_id,
       count(*) FILTER (WHERE status = 'pendente')  AS pendentes,
       count(*) FILTER (WHERE status = 'rodando')   AS rodando,
       count(*) FILTER (WHERE status = 'concluida') AS concluidas,
       count(*) FILTER (WHERE status = 'erro')      AS com_erro,
       coalesce(sum(itens), 0)                      AS itens_maps,
       max(concluido_em)                            AS ultima_conclusao,
       count(*) FILTER (WHERE status = 'bloqueada') AS bloqueadas,
       count(*) FILTER (WHERE bairro IS NOT NULL)   AS por_bairro
  FROM descoberta.buscas_maps
 GROUP BY campanha_id;
