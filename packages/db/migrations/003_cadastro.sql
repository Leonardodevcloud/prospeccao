-- Configuração da prospecção. Dono: api.

CREATE TABLE cadastro.nichos (
  id                  bigserial PRIMARY KEY,
  nome                text NOT NULL,
  cnaes               text[] NOT NULL CHECK (cardinality(cnaes) > 0),   -- 7 dígitos
  termos_maps         text[] NOT NULL CHECK (cardinality(termos_maps) > 0),
  palavras_positivas  text[] NOT NULL DEFAULT '{}',
  palavras_negativas  text[] NOT NULL DEFAULT '{}',
  cargos_alvo         text[] NOT NULL DEFAULT '{}',
  portes              text[] NOT NULL DEFAULT '{me,epp,demais,nao_informado}',
  idade_minima_anos   integer NOT NULL DEFAULT 0 CHECK (idade_minima_anos >= 0),
  ativo               boolean NOT NULL DEFAULT true,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX nichos_nome_uidx ON cadastro.nichos (lower(nome)) WHERE ativo;
CREATE TRIGGER nichos_atualizado BEFORE UPDATE ON cadastro.nichos
  FOR EACH ROW EXECUTE FUNCTION public.tocar_atualizado_em();

CREATE TABLE cadastro.bases (
  id            bigserial PRIMARY KEY,
  nome          text NOT NULL,
  endereco      text,
  lat           double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng           double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  ativa         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER bases_atualizado BEFORE UPDATE ON cadastro.bases
  FOR EACH ROW EXECUTE FUNCTION public.tocar_atualizado_em();

CREATE TABLE cadastro.campanhas (
  id                 bigserial PRIMARY KEY,
  nome               text NOT NULL,
  nicho_id           bigint NOT NULL REFERENCES cadastro.nichos (id),
  cidades            jsonb NOT NULL CHECK (jsonb_typeof(cidades) = 'array' AND jsonb_array_length(cidades) > 0),
  raio_km            numeric(6, 1) NOT NULL DEFAULT 12,
  meta_diaria        integer NOT NULL DEFAULT 40,
  limite_envios_dia  integer NOT NULL DEFAULT 25,
  cadencia           text NOT NULL DEFAULT 'padrao' CHECK (cadencia IN ('padrao', 'curta')),
  modo               text NOT NULL DEFAULT 'semi' CHECK (modo IN ('semi', 'auto')),
  max_por_busca      integer NOT NULL DEFAULT 120,
  status             text NOT NULL DEFAULT 'rascunho'
                     CHECK (status IN ('rascunho', 'ativa', 'pausada', 'encerrada')),
  iniciada_em        timestamptz,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  atualizado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX campanhas_status_idx ON cadastro.campanhas (status);
CREATE TRIGGER campanhas_atualizado BEFORE UPDATE ON cadastro.campanhas
  FOR EACH ROW EXECUTE FUNCTION public.tocar_atualizado_em();
