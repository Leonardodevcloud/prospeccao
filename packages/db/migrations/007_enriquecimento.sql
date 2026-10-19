-- Enriquecimento: quem decide e como falar com ele. Dono: worker-enriquecimento.
-- Uma linha por empresa em "leads"; pessoas e contatos encontrados, cada um com a fonte;
-- e as etapas da última rodada (a trilha "Como encontramos" da ficha).

CREATE SCHEMA IF NOT EXISTS enriquecimento;

CREATE TABLE enriquecimento.leads (
  empresa_id        bigint PRIMARY KEY,                -- descoberta.empresas.id (sem FK entre domínios)
  campanha_id       bigint,                            -- última campanha que pediu
  status            text NOT NULL DEFAULT 'na_fila'
                    CHECK (status IN ('na_fila', 'rodando', 'concluido', 'erro')),
  faixa             text CHECK (faixa IN ('A', 'B', 'C')),
  score             smallint CHECK (score BETWEEN 0 AND 100),
  motivo            text,                              -- por que essa nota, em uma frase
  resumo            text,                              -- o que a empresa faz, em uma frase
  entrega           boolean,                           -- a IA viu sinal de entrega (site/Instagram)
  cnpj_achado       text,                              -- CNPJ achado no site/Instagram de lead só do Maps
  site_url          text,
  instagram         text,                              -- usuário, sem @
  facebook          text,
  linkedin_empresa  text,
  maps_aberto       boolean,                           -- Places: a loja segue aberta?
  tentativas        integer NOT NULL DEFAULT 0,
  erro              text,
  solicitado_em     timestamptz NOT NULL DEFAULT now(),
  iniciado_em       timestamptz,
  concluido_em      timestamptz,
  atualizado_em     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leads_faixa_idx ON enriquecimento.leads (faixa, score DESC);
CREATE TRIGGER leads_atualizado BEFORE UPDATE ON enriquecimento.leads
  FOR EACH ROW EXECUTE FUNCTION public.tocar_atualizado_em();

CREATE TABLE enriquecimento.pessoas (
  id            bigserial PRIMARY KEY,
  empresa_id    bigint NOT NULL,
  nome          text NOT NULL,
  nome_chave    text GENERATED ALWAYS AS (public.normalizar_nome(nome)) STORED,
  cargo         text,
  papel         text NOT NULL DEFAULT 'outro'
                CHECK (papel IN ('socio', 'compras', 'gestao', 'outro')),
  decisor       boolean NOT NULL DEFAULT false,      -- a pessoa a abordar primeiro
  prioridade    smallint NOT NULL DEFAULT 9,         -- 1 = mais provável de decidir a compra
  desde         date,                                -- entrada no quadro societário
  linkedin_url  text,
  fontes        text[] NOT NULL DEFAULT '{}',
  url_origem    text,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, nome_chave)
);
CREATE TRIGGER pessoas_atualizado BEFORE UPDATE ON enriquecimento.pessoas
  FOR EACH ROW EXECUTE FUNCTION public.tocar_atualizado_em();

CREATE TABLE enriquecimento.contatos (
  id            bigserial PRIMARY KEY,
  empresa_id    bigint NOT NULL,
  pessoa_id     bigint REFERENCES enriquecimento.pessoas (id) ON DELETE SET NULL,
  canal         text NOT NULL
                CHECK (canal IN ('whatsapp', 'telefone', 'email', 'instagram', 'linkedin', 'site', 'facebook')),
  valor         text NOT NULL,                       -- telefone só dígitos com DDD; e-mail minúsculo; URL
  rotulo        text,                                -- "compras@", "WhatsApp da loja"...
  fonte         text NOT NULL
                CHECK (fonte IN ('receita', 'maps', 'site', 'instagram', 'linkedin', 'google', 'ia', 'places', 'manual')),
  fontes        text[] NOT NULL DEFAULT '{}',        -- todas as fontes onde apareceu
  url_origem    text,
  confianca     smallint NOT NULL DEFAULT 50 CHECK (confianca BETWEEN 0 AND 100),
  status        text NOT NULL DEFAULT 'nao_verificado'
                CHECK (status IN ('verificado', 'nao_verificado', 'atencao', 'invalido')),
  whatsapp      boolean,                             -- telefone: tem WhatsApp? null = não conferido
  verificado_em timestamptz,
  principal     boolean NOT NULL DEFAULT false,      -- o melhor contato da empresa
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, canal, valor)
);
CREATE INDEX contatos_empresa_idx ON enriquecimento.contatos (empresa_id);
CREATE TRIGGER contatos_atualizado BEFORE UPDATE ON enriquecimento.contatos
  FOR EACH ROW EXECUTE FUNCTION public.tocar_atualizado_em();

CREATE TABLE enriquecimento.etapas (
  id          bigserial PRIMARY KEY,
  empresa_id  bigint NOT NULL,
  ordem       smallint NOT NULL,
  etapa       text NOT NULL
              CHECK (etapa IN ('receita', 'maps', 'site', 'instagram', 'ia', 'linkedin', 'places', 'whatsapp')),
  status      text NOT NULL CHECK (status IN ('encontrado', 'sem_resultado', 'pulada', 'erro')),
  detalhe     text,
  url         text,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX etapas_empresa_idx ON enriquecimento.etapas (empresa_id, ordem);

-- cadastro → worker-enriquecimento: o nicho de cada campanha (cargos-alvo guiam a busca no LinkedIn).
CREATE VIEW cadastro.v_campanhas_enriquecimento AS
SELECT cp.id,
       cp.nome,
       cp.status,
       n.id AS nicho_id,
       n.nome AS nicho_nome,
       n.cargos_alvo,
       n.palavras_positivas,
       n.termos_maps
  FROM cadastro.campanhas cp
  JOIN cadastro.nichos n ON n.id = cp.nicho_id;
