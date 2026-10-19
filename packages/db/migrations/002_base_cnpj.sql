-- Cópia filtrada dos dados abertos de CNPJ (só UFs e CNAEs de interesse).
-- Dono: worker-cnpj.

CREATE TABLE base_cnpj.importacoes (
  id               bigserial PRIMARY KEY,
  mes              text NOT NULL,                       -- AAAA-MM da publicação da Receita
  status           text NOT NULL DEFAULT 'na_fila'
                   CHECK (status IN ('na_fila', 'rodando', 'concluida', 'erro')),
  motivo           text NOT NULL DEFAULT 'manual',      -- manual | agendada
  ufs              text[] NOT NULL DEFAULT '{}',
  cnaes            text[] NOT NULL DEFAULT '{}',
  etapa            text,
  linhas_lidas     bigint NOT NULL DEFAULT 0,
  estabelecimentos integer NOT NULL DEFAULT 0,
  empresas         integer NOT NULL DEFAULT 0,
  socios           integer NOT NULL DEFAULT 0,
  erro             text,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  iniciado_em      timestamptz,
  concluido_em     timestamptz
);
CREATE INDEX importacoes_criado_idx ON base_cnpj.importacoes (criado_em DESC);

CREATE TABLE base_cnpj.municipios (
  codigo text PRIMARY KEY,                               -- código da Receita (não é o do IBGE)
  nome   text NOT NULL
);

CREATE TABLE base_cnpj.qualificacoes (
  codigo    text PRIMARY KEY,
  descricao text NOT NULL
);

CREATE TABLE base_cnpj.cnaes (
  codigo    text PRIMARY KEY,                            -- 7 dígitos
  descricao text NOT NULL
);

CREATE TABLE base_cnpj.empresas (
  cnpj_basico       text PRIMARY KEY,
  razao_social      text NOT NULL,
  natureza_juridica text,
  capital_social    numeric(18, 2),
  porte             text NOT NULL DEFAULT 'nao_informado'
                    CHECK (porte IN ('me', 'epp', 'demais', 'nao_informado')),
  importacao_id     bigint REFERENCES base_cnpj.importacoes (id) ON DELETE SET NULL,
  atualizado_em     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE base_cnpj.estabelecimentos (
  cnpj               text PRIMARY KEY,                   -- 14 dígitos
  cnpj_basico        text NOT NULL,
  matriz             boolean NOT NULL,
  nome_fantasia      text,
  situacao           text NOT NULL,                      -- 02 = ativa
  data_situacao      date,
  data_inicio        date,
  cnae_principal     text NOT NULL,
  cnaes_secundarios  text[] NOT NULL DEFAULT '{}',
  tipo_logradouro    text,
  logradouro         text,
  numero             text,
  complemento        text,
  bairro             text,
  cep                text,
  uf                 text NOT NULL,
  municipio_codigo   text NOT NULL,
  telefones          text[] NOT NULL DEFAULT '{}',       -- normalizados: DDD + número
  email              text,
  importacao_id      bigint REFERENCES base_cnpj.importacoes (id) ON DELETE SET NULL,
  atualizado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX estab_basico_idx ON base_cnpj.estabelecimentos (cnpj_basico);
CREATE INDEX estab_local_idx ON base_cnpj.estabelecimentos (uf, municipio_codigo) WHERE situacao = '02';
CREATE INDEX estab_cnae_idx ON base_cnpj.estabelecimentos (cnae_principal);
CREATE INDEX estab_cnaes_sec_idx ON base_cnpj.estabelecimentos USING gin (cnaes_secundarios);
CREATE INDEX estab_telefones_idx ON base_cnpj.estabelecimentos USING gin (telefones);

CREATE TABLE base_cnpj.socios (
  id                  bigserial PRIMARY KEY,
  cnpj_basico         text NOT NULL,
  tipo                text NOT NULL CHECK (tipo IN ('pj', 'pf', 'estrangeiro')),
  nome                text NOT NULL,
  documento           text,                              -- CPF já vem mascarado pela Receita
  qualificacao_codigo text,
  data_entrada        date,
  faixa_etaria        text,
  importacao_id       bigint REFERENCES base_cnpj.importacoes (id) ON DELETE SET NULL
);
CREATE INDEX socios_basico_idx ON base_cnpj.socios (cnpj_basico);
