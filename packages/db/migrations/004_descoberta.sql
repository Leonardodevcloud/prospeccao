-- Empresas encontradas pelas campanhas. Dono: worker-descoberta.

CREATE TABLE descoberta.empresas (
  id                  bigserial PRIMARY KEY,
  cnpj                text UNIQUE,                       -- nulo: achada só no Maps
  cnpj_basico         text,
  nome                text NOT NULL,                     -- nome fantasia, ou razão social, ou título no Maps
  nome_busca          text GENERATED ALWAYS AS (public.normalizar_nome(nome)) STORED,
  razao_social        text,
  razao_busca         text GENERATED ALWAYS AS (public.normalizar_nome(razao_social)) STORED,
  cnae_principal      text,
  porte               text,
  situacao            text,
  data_abertura       date,
  logradouro          text,
  numero              text,
  bairro              text,
  cep                 text,
  cidade              text NOT NULL,                     -- normalizada (SALVADOR)
  uf                  text NOT NULL,
  telefones_receita   text[] NOT NULL DEFAULT '{}',
  email_receita       text,
  lat                 double precision,
  lng                 double precision,
  geo_fonte           text CHECK (geo_fonte IN ('maps', 'ors', 'manual')),
  geo_tentativas      integer NOT NULL DEFAULT 0,
  geo_em              timestamptz,
  base_id             bigint,                            -- cadastro.bases.id (sem FK entre domínios)
  distancia_base_km   numeric(7, 2),
  place_id            text UNIQUE,
  maps_nome           text,
  maps_categoria      text,
  maps_endereco       text,
  maps_nota           numeric(2, 1),
  maps_avaliacoes     integer,
  maps_site           text,
  maps_telefone       text,
  maps_url            text,
  maps_fechada        boolean,
  maps_em             timestamptz,
  sinal_entrega       boolean,
  sinal_entrega_fonte text,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX empresas_nome_trgm ON descoberta.empresas USING gin (nome_busca gin_trgm_ops);
CREATE INDEX empresas_razao_trgm ON descoberta.empresas USING gin (razao_busca gin_trgm_ops);
CREATE INDEX empresas_telefones_idx ON descoberta.empresas USING gin (telefones_receita);
CREATE INDEX empresas_local_idx ON descoberta.empresas (uf, cidade);
CREATE INDEX empresas_sem_geo_idx ON descoberta.empresas (id) WHERE lat IS NULL;
CREATE TRIGGER empresas_atualizado BEFORE UPDATE ON descoberta.empresas
  FOR EACH ROW EXECUTE FUNCTION public.tocar_atualizado_em();

CREATE TABLE descoberta.campanha_empresas (
  campanha_id                  bigint NOT NULL,          -- cadastro.campanhas.id
  empresa_id                   bigint NOT NULL REFERENCES descoberta.empresas (id) ON DELETE CASCADE,
  origem                       text NOT NULL CHECK (origem IN ('cnpj', 'maps', 'ambos')),
  dentro_do_raio               boolean,
  enriquecimento_solicitado_em timestamptz,
  adicionada_em                timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campanha_id, empresa_id)
);
CREATE INDEX campanha_empresas_empresa_idx ON descoberta.campanha_empresas (empresa_id);

CREATE TABLE descoberta.buscas_maps (
  id            bigserial PRIMARY KEY,
  campanha_id   bigint NOT NULL,
  cidade        text NOT NULL,
  uf            text NOT NULL,
  termo         text NOT NULL,
  status        text NOT NULL DEFAULT 'pendente'
                CHECK (status IN ('pendente', 'rodando', 'concluida', 'erro')),
  apify_run_id  text,
  dataset_id    text,
  verificacoes  integer NOT NULL DEFAULT 0,
  itens         integer,
  erro          text,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  iniciado_em   timestamptz,
  concluido_em  timestamptz
);
CREATE INDEX buscas_campanha_idx ON descoberta.buscas_maps (campanha_id, status);

CREATE TABLE descoberta.maps_resultados (
  id            bigserial PRIMARY KEY,
  busca_id      bigint NOT NULL REFERENCES descoberta.buscas_maps (id) ON DELETE CASCADE,
  place_id      text NOT NULL,
  nome          text NOT NULL,
  nome_busca    text GENERATED ALWAYS AS (public.normalizar_nome(nome)) STORED,
  categoria     text,
  telefone      text,                                    -- normalizado
  endereco      text,
  cep           text,
  cidade        text,
  uf            text,
  lat           double precision,
  lng           double precision,
  nota          numeric(2, 1),
  avaliacoes    integer,
  site          text,
  url           text,
  fechada       boolean NOT NULL DEFAULT false,
  entrega       boolean,
  dados         jsonb NOT NULL,                          -- item bruto do Apify, para auditoria
  empresa_id    bigint REFERENCES descoberta.empresas (id) ON DELETE SET NULL,
  cruzamento    text CHECK (cruzamento IN ('place_id', 'telefone', 'nome_cep', 'nome_cidade', 'novo', 'descartado')),
  similaridade  real,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (busca_id, place_id)
);
CREATE INDEX maps_resultados_pendentes_idx ON descoberta.maps_resultados (busca_id) WHERE cruzamento IS NULL;
