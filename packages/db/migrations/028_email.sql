-- Prospecção por e-mail: modelos com anexo, campanhas em sequência, envios rastreados e respostas.
-- Dono: api (schema comercial).

CREATE TABLE IF NOT EXISTS comercial.config_email (
  id                 boolean PRIMARY KEY DEFAULT true CHECK (id),
  ligado             boolean NOT NULL DEFAULT false,
  remetente_nome     text NOT NULL DEFAULT 'Tutts',
  responder_para     text,
  assinatura         text NOT NULL DEFAULT '{remetente}
Tutts Entregas Rápidas
www.tutts.com.br',
  -- Ritmo: poucos por dia no começo protege a reputação da caixa (não cai no spam).
  limite_dia         integer NOT NULL DEFAULT 60,
  intervalo_seg      integer NOT NULL DEFAULT 120,
  hora_inicio        integer NOT NULL DEFAULT 8  CHECK (hora_inicio BETWEEN 0 AND 23),
  hora_fim           integer NOT NULL DEFAULT 18 CHECK (hora_fim BETWEEN 1 AND 24),
  dias_semana        integer[] NOT NULL DEFAULT '{1,2,3,4,5}',
  rastrear_abertura  boolean NOT NULL DEFAULT true,
  -- Leitura das respostas (IMAP): até onde já leu.
  imap_ultimo_uid    bigint,
  imap_lido_em       timestamptz,
  imap_erro          text,
  atualizado_em      timestamptz NOT NULL DEFAULT now()
);
INSERT INTO comercial.config_email (id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS comercial.modelos_email (
  id           serial PRIMARY KEY,
  nome         text NOT NULL,
  assunto      text NOT NULL,
  corpo        text NOT NULL,
  -- Arquivos (comercial.midias) que vão junto: a proposta comercial, a apresentação…
  anexos       bigint[] NOT NULL DEFAULT '{}',
  criado_em    timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
INSERT INTO comercial.modelos_email (nome, assunto, corpo)
SELECT * FROM (VALUES
  ('Apresentação + proposta',
   'Entregas mais rápidas para a {empresa}',
   '{saudacao}

Sou {remetente}, da Tutts. Fazemos entregas de autopeças por motoboy em {cidade}, para lojas que não podem perder venda por demora na entrega.

Como funciona:
- Motoboy dedicado ou sob demanda, do jeito que a loja precisar
- Prazo garantido e acompanhamento de cada entrega em tempo real
- Atendimento próprio, sem robô

Mandei em anexo nossa proposta comercial. Faz sentido conversarmos 15 minutos esta semana para eu entender como a {empresa} entrega hoje?'),
  ('Follow-up',
   'Re: Entregas mais rápidas para a {empresa}',
   '{saudacao}

Passando para saber se conseguiu ver a proposta que mandei. Se fizer sentido, me responda com o melhor dia e horário que eu te ligo.

Se não for com você, pode me indicar quem cuida das entregas na {empresa}?')
) AS v(nome, assunto, corpo)
WHERE NOT EXISTS (SELECT 1 FROM comercial.modelos_email);

CREATE TABLE IF NOT EXISTS comercial.campanhas_email (
  id              serial PRIMARY KEY,
  nome            text NOT NULL,
  campanha_id     bigint NOT NULL,                     -- cadastro.campanhas
  -- Sequência: [{modeloId, dias}], o 1º sai logo, os outros N dias depois sem resposta.
  passos          jsonb NOT NULL,
  faixas          text[] NOT NULL DEFAULT '{}',
  pular_no_funil  boolean NOT NULL DEFAULT true,
  incluir_contador boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'rascunho'
                  CHECK (status IN ('rascunho', 'enviando', 'pausada', 'concluida')),
  criado_por      integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  iniciada_em     timestamptz,
  concluida_em    timestamptz
);

CREATE TABLE IF NOT EXISTS comercial.envios_email (
  id                 bigserial PRIMARY KEY,
  campanha_email_id  integer NOT NULL REFERENCES comercial.campanhas_email (id) ON DELETE CASCADE,
  empresa_id         bigint NOT NULL,
  email              text NOT NULL,
  passo              integer NOT NULL DEFAULT 1,
  status             text NOT NULL DEFAULT 'na_fila'
                     CHECK (status IN ('na_fila', 'enviado', 'erro', 'devolvido', 'cancelado')),
  -- Identifica o envio no pixel, nos cliques e no descadastro.
  token              text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  message_id         text,
  assunto            text,
  links              text[] NOT NULL DEFAULT '{}',
  erro               text,
  enviado_em         timestamptz,
  aberto_em          timestamptz,
  aberturas          integer NOT NULL DEFAULT 0,
  clicado_em         timestamptz,
  cliques            integer NOT NULL DEFAULT 0,
  respondido_em      timestamptz,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campanha_email_id, empresa_id, passo)
);
CREATE UNIQUE INDEX IF NOT EXISTS envios_email_token_idx ON comercial.envios_email (token);
CREATE INDEX IF NOT EXISTS envios_email_fila_idx ON comercial.envios_email (status, id) WHERE status = 'na_fila';
CREATE INDEX IF NOT EXISTS envios_email_msg_idx ON comercial.envios_email (message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS envios_email_email_idx ON comercial.envios_email (lower(email), enviado_em DESC);
CREATE INDEX IF NOT EXISTS envios_email_empresa_idx ON comercial.envios_email (empresa_id);

CREATE TABLE IF NOT EXISTS comercial.respostas_email (
  id            bigserial PRIMARY KEY,
  envio_id      bigint REFERENCES comercial.envios_email (id) ON DELETE SET NULL,
  empresa_id    bigint,
  de_email      text NOT NULL,
  de_nome       text,
  assunto       text,
  texto         text NOT NULL,
  message_id    text,
  recebido_em   timestamptz NOT NULL,
  classe        text NOT NULL CHECK (classe IN ('interessado', 'sem_interesse', 'descadastro', 'automatica')),
  resumo        text,
  -- Quem classificou: a IA, a regra de palavras, ou você (corrigindo).
  classificado_por text NOT NULL DEFAULT 'regra' CHECK (classificado_por IN ('ia', 'regra', 'voce')),
  lida_em       timestamptz,
  criado_em     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS respostas_email_msg_idx ON comercial.respostas_email (message_id)
  WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS respostas_email_empresa_idx ON comercial.respostas_email (empresa_id, recebido_em DESC);

-- Quem pediu para sair: nunca mais recebe (de nenhuma campanha).
CREATE TABLE IF NOT EXISTS comercial.descadastros_email (
  email      text PRIMARY KEY,
  motivo     text,
  criado_em  timestamptz NOT NULL DEFAULT now()
);
