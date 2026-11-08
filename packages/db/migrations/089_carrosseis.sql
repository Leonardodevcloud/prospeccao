-- Carrosséis com IA (módulo à parte): a identidade visual de cada conta, as fotos da empresa que
-- entram nos slides e os carrosséis (slides em JSON; as imagens finais são desenhadas na hora).

-- Franquia própria de carrosséis do time de IA por mês (null = a da tabela de preços).
ALTER TABLE cadastro.organizacoes ADD COLUMN IF NOT EXISTS limite_carrosseis_mes integer;

CREATE TABLE comercial.carrossel_identidade (
  conta_id      integer PRIMARY KEY REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  -- Cores, fontes, estilo, assinatura e como a empresa fala (IdentidadeCarrossel no shared).
  dados         jsonb NOT NULL DEFAULT '{}',
  -- Logos próprias dos carrosséis no armazenamento (sem elas, usa as de Marca e domínio).
  logo_claro    text,
  logo_claro_largura  integer,
  logo_claro_altura   integer,
  logo_escuro   text,
  logo_escuro_largura integer,
  logo_escuro_altura  integer,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE comercial.carrossel_fotos (
  id         serial PRIMARY KEY,
  conta_id   integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  nome       text NOT NULL,
  -- Caminho no armazenamento (carrosseis/<conta>/fotos/…): JPEG já reduzido e sem os dados do aparelho.
  chave      text NOT NULL,
  largura    integer NOT NULL,
  altura     integer NOT NULL,
  bytes      integer NOT NULL,
  criado_por integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  criado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX carrossel_fotos_conta ON comercial.carrossel_fotos (conta_id, id DESC);

CREATE TABLE comercial.carrosseis (
  id            serial PRIMARY KEY,
  conta_id      integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  titulo        text NOT NULL,
  estilo        text NOT NULL CHECK (estilo IN ('editorial', 'impacto', 'clean', 'foto')),
  situacao      text NOT NULL DEFAULT 'rascunho'
                CHECK (situacao IN ('rascunho', 'pronto', 'agendado', 'publicado', 'falhou')),
  slides        jsonb NOT NULL DEFAULT '[]',
  legenda       text NOT NULL DEFAULT '',
  -- Quem montou: à mão no editor ou o time de IA (só os do time contam na franquia do mês).
  origem        text NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'ia')),
  -- Sobe a cada gravação: a tela manda a que editou e, se outra pessoa salvou no meio, recusa.
  versao        integer NOT NULL DEFAULT 1,
  criado_por    integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX carrosseis_conta ON comercial.carrosseis (conta_id, atualizado_em DESC);
