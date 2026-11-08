-- Porteiro do WhatsApp: segura o mesmo texto indo para muitos contatos, põe ritmo nos contatos novos
-- da equipe e, com sinais de risco, para os contatos novos do número por algumas horas.
CREATE TABLE comercial.porteiro (
  conta_id             integer PRIMARY KEY REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  ativo                boolean NOT NULL DEFAULT false,
  repetidas_contatos   integer NOT NULL DEFAULT 5 CHECK (repetidas_contatos BETWEEN 2 AND 100),
  repetidas_janela_min integer NOT NULL DEFAULT 60 CHECK (repetidas_janela_min BETWEEN 10 AND 1440),
  repetidas_acao       text NOT NULL DEFAULT 'segurar' CHECK (repetidas_acao IN ('segurar', 'avisar')),
  novos_dia            integer NOT NULL DEFAULT 30 CHECK (novos_dia BETWEEN 1 AND 500),
  novos_intervalo_seg  integer NOT NULL DEFAULT 30 CHECK (novos_intervalo_seg BETWEEN 0 AND 600),
  pausar_risco         boolean NOT NULL DEFAULT true,
  atualizado_em        timestamptz NOT NULL DEFAULT now()
);

-- Número sem abordar contatos novos até esta hora (sinal de risco). Responder quem conversa continua.
ALTER TABLE comercial.chips
  ADD COLUMN IF NOT EXISTS frios_ate    timestamptz,
  ADD COLUMN IF NOT EXISTS frios_motivo text;

-- O que o porteiro segurou (ou deixou passar depois do aviso), para a tela e para o histórico.
CREATE TABLE comercial.porteiro_eventos (
  id          bigserial PRIMARY KEY,
  conta_id    integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  chip_id     integer REFERENCES comercial.chips (id) ON DELETE SET NULL,
  usuario_id  integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  empresa_id  bigint,
  tipo        text NOT NULL CHECK (tipo IN ('repetida', 'limite', 'espera', 'pausado', 'mesmo_assim', 'variou', 'risco')),
  detalhe     text,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX porteiro_eventos_conta ON comercial.porteiro_eventos (conta_id, criado_em DESC);
