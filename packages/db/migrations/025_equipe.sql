-- Equipe: vários usuários com papel, dono de cada lead, rodízio, metas e avisos. Dono: api.
--
-- O login do ambiente (ADMIN_EMAIL / ADMIN_SENHA_HASH) continua valendo: no primeiro acesso ele
-- vira o usuário administrador. Os outros entram por convite (link para criar a senha).

CREATE TABLE IF NOT EXISTS cadastro.usuarios (
  id              serial PRIMARY KEY,
  nome            text NOT NULL,
  email           text NOT NULL,
  senha_hash      text,
  papel           text NOT NULL DEFAULT 'sdr' CHECK (papel IN ('admin', 'sdr', 'closer')),
  ativo           boolean NOT NULL DEFAULT true,
  -- Entra no rodízio de leads novos (SDR) ou de reuniões (closer).
  recebe_leads    boolean NOT NULL DEFAULT true,
  -- WhatsApp do vendedor (lembretes de reunião).
  telefone        text,
  convite_token   text,
  convite_expira  timestamptz,
  -- Endereço secreto da agenda (Google Agenda assina este link).
  agenda_token    text NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text),
  ultimo_acesso   timestamptz,
  criado_em       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_email_idx ON cadastro.usuarios (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_convite_idx ON cadastro.usuarios (convite_token)
  WHERE convite_token IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_agenda_idx ON cadastro.usuarios (agenda_token);

-- Dono do lead e quem fez cada coisa.
ALTER TABLE comercial.oportunidades
  ADD COLUMN IF NOT EXISTS responsavel_id integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS oportunidades_responsavel_idx ON comercial.oportunidades (responsavel_id);

ALTER TABLE comercial.atividades
  ADD COLUMN IF NOT EXISTS usuario_id integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS atividades_usuario_idx ON comercial.atividades (usuario_id, criado_em);

ALTER TABLE comercial.mensagens
  ADD COLUMN IF NOT EXISTS usuario_id integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL;

-- Como os leads são divididos.
CREATE TABLE IF NOT EXISTS comercial.config_equipe (
  id                   boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- Lead novo no funil: rodízio entre os SDRs ou fica com quem mandou para o funil.
  distribuicao_sdr     text NOT NULL DEFAULT 'rodizio' CHECK (distribuicao_sdr IN ('rodizio', 'manual')),
  -- Reunião marcada: rodízio entre os closers, continua com o SDR, ou você passa à mão.
  distribuicao_closer  text NOT NULL DEFAULT 'rodizio'
                       CHECK (distribuicao_closer IN ('rodizio', 'mesmo', 'manual')),
  ultimo_sdr           integer,
  ultimo_closer        integer
);
INSERT INTO comercial.config_equipe (id) VALUES (true) ON CONFLICT DO NOTHING;

-- Metas por pessoa.
CREATE TABLE IF NOT EXISTS comercial.metas (
  usuario_id       integer PRIMARY KEY REFERENCES cadastro.usuarios (id) ON DELETE CASCADE,
  abordagens_dia   integer NOT NULL DEFAULT 30 CHECK (abordagens_dia >= 0),
  reunioes_mes     integer NOT NULL DEFAULT 10 CHECK (reunioes_mes >= 0),
  ganhos_mes       integer NOT NULL DEFAULT 3 CHECK (ganhos_mes >= 0)
);

-- Avisos para cada pessoa: lead respondeu, lead passou para você, reunião daqui a pouco.
CREATE TABLE IF NOT EXISTS comercial.notificacoes (
  id          bigserial PRIMARY KEY,
  usuario_id  integer NOT NULL REFERENCES cadastro.usuarios (id) ON DELETE CASCADE,
  tipo        text NOT NULL,
  titulo      text NOT NULL,
  texto       text,
  empresa_id  bigint,
  link        text,
  lida_em     timestamptz,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notificacoes_usuario_idx ON comercial.notificacoes (usuario_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS notificacoes_nao_lidas_idx ON comercial.notificacoes (usuario_id)
  WHERE lida_em IS NULL;
