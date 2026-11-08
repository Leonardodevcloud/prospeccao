-- Quadros com gatilhos da IA: o cliente monta quadros e colunas; a IA lê as conversas paradas e põe
-- o lead na coluna cujo gatilho aconteceu (sugere e alguém confirma, ou já move).
CREATE TABLE comercial.quadros (
  id            serial PRIMARY KEY,
  conta_id      integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  nome          text NOT NULL,
  ordem         integer NOT NULL DEFAULT 0,
  ia            boolean NOT NULL DEFAULT true,
  confirmar     boolean NOT NULL DEFAULT true,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX quadros_nome ON comercial.quadros (conta_id, lower(nome));

CREATE TABLE comercial.quadro_colunas (
  id        serial PRIMARY KEY,
  quadro_id integer NOT NULL REFERENCES comercial.quadros (id) ON DELETE CASCADE,
  nome      text NOT NULL,
  ordem     integer NOT NULL DEFAULT 0,
  -- Quando o lead vem para cá, em português. Vazio: coluna só para mover à mão.
  gatilho   text,
  cor       text NOT NULL DEFAULT 'cinza'
);
CREATE INDEX quadro_colunas_quadro ON comercial.quadro_colunas (quadro_id, ordem);

CREATE TABLE comercial.quadro_cartoes (
  id          bigserial PRIMARY KEY,
  conta_id    integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  quadro_id   integer NOT NULL REFERENCES comercial.quadros (id) ON DELETE CASCADE,
  empresa_id  bigint NOT NULL,
  -- Onde o lead está (vazio: ainda não entrou, só tem a sugestão da IA).
  coluna_id   integer REFERENCES comercial.quadro_colunas (id) ON DELETE CASCADE,
  -- Para onde a IA sugere mover, esperando alguém confirmar.
  sugerida_id integer REFERENCES comercial.quadro_colunas (id) ON DELETE SET NULL,
  sugerida_em timestamptz,
  origem      text NOT NULL DEFAULT 'pessoa' CHECK (origem IN ('ia', 'pessoa')),
  -- O que o lead disse e por que a IA moveu (ou sugeriu).
  trecho      text,
  motivo      text,
  mensagem_id bigint,
  movido_por  integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  movido_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quadro_id, empresa_id)
);
CREATE INDEX quadro_cartoes_lead ON comercial.quadro_cartoes (conta_id, empresa_id);

-- Até qual mensagem a IA já leu de cada lead (só lê de novo quando chega mensagem nova).
CREATE TABLE comercial.quadro_leituras (
  conta_id     integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  empresa_id   bigint NOT NULL,
  ate_mensagem bigint NOT NULL DEFAULT 0,
  lido_em      timestamptz,
  -- Última tentativa que falhou (IA fora do ar, sem chave, teto do mês): espera antes de tentar de novo.
  tentado_em   timestamptz,
  PRIMARY KEY (conta_id, empresa_id)
);
