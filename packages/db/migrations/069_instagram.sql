-- Instagram (e os cadastros dos anúncios da Meta) no CRM:
--  • a conexão da conta: a conta profissional do Instagram e a página do Facebook ligada a ela
--    (o token da página fica cifrado com CHAVE_CREDENCIAIS);
--  • "comente e receba": regras por publicação e palavra que mandam um direct para quem comentou,
--    e cada interação (quem comentou, se recebeu, se respondeu, que lead virou);
--  • formulários dos anúncios: o que cada pergunta vira no lead e onde ele entra no funil;
--  • o direct como mais um canal da conversa (mensagens com canal e o id da pessoa no Instagram).
-- Lead do Instagram não passa pelo enriquecimento.

CREATE TABLE comercial.instagram_contas (
  conta_id          integer PRIMARY KEY REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  ig_id             text,
  ig_usuario        text,
  ig_nome           text,
  ig_seguidores     integer,
  ig_foto           text,
  pagina_id         text,
  pagina_nome       text,
  token_cifrado     text,
  -- Mais de uma conta na mesma autorização: a pessoa escolhe (os tokens ficam aqui, cifrados).
  opcoes_cifradas   text,
  conectado_em      timestamptz,
  conectado_por     integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  -- A Meta respondeu que o acesso às mensagens está desligado no app do Instagram.
  mensagens_bloqueadas boolean NOT NULL DEFAULT false,
  erro              text,
  erro_em           timestamptz,
  -- Direct de quem não comentou em nenhuma regra: vira lead ou fica só no Instagram.
  direct_novo       text NOT NULL DEFAULT 'lead' CHECK (direct_novo IN ('lead', 'ignorar')),
  atualizado_em     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX instagram_contas_ig_idx ON comercial.instagram_contas (ig_id) WHERE ig_id IS NOT NULL;
CREATE INDEX instagram_contas_pagina_idx ON comercial.instagram_contas (pagina_id) WHERE pagina_id IS NOT NULL;

-- Regras de "comente e receba".
CREATE TABLE comercial.instagram_regras (
  id               bigserial PRIMARY KEY,
  conta_id         integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  -- publicacao: uma publicação escolhida; proxima: a próxima que for postada (vira publicacao);
  -- todas: qualquer publicação.
  alvo             text NOT NULL CHECK (alvo IN ('publicacao', 'proxima', 'todas')),
  midia_id         text,
  midia_legenda    text,
  midia_tipo       text,
  midia_link       text,
  midia_imagem     text,
  midia_em         timestamptz,
  palavras         text[] NOT NULL,
  respostas        text[] NOT NULL DEFAULT '{}',
  mensagem         text NOT NULL,
  botao_texto      text,
  botao_link       text,
  ia_continua      boolean NOT NULL DEFAULT false,
  avisar           boolean NOT NULL DEFAULT true,
  etapa_id         integer,
  responsavel_id   integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  etiquetas        text[] NOT NULL DEFAULT '{}',
  ligada           boolean NOT NULL DEFAULT true,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  criado_por       integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL
);
CREATE INDEX instagram_regras_conta_idx ON comercial.instagram_regras (conta_id, ligada);

-- Cada comentário que bateu com uma regra.
CREATE TABLE comercial.instagram_interacoes (
  id               bigserial PRIMARY KEY,
  conta_id         integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  regra_id         bigint REFERENCES comercial.instagram_regras (id) ON DELETE CASCADE,
  midia_id         text,
  comentario_id    text NOT NULL,
  pessoa_id        text NOT NULL,
  usuario          text,
  nome             text,
  comentario       text,
  comentado_em     timestamptz NOT NULL DEFAULT now(),
  direct           text NOT NULL CHECK (direct IN ('enviado', 'erro', 'fora_do_prazo', 'repetido')),
  direct_erro      text,
  resposta_publica boolean NOT NULL DEFAULT false,
  respondeu_em     timestamptz,
  empresa_id       bigint
);
CREATE UNIQUE INDEX instagram_interacoes_comentario_idx ON comercial.instagram_interacoes (conta_id, comentario_id);
CREATE INDEX instagram_interacoes_regra_idx ON comercial.instagram_interacoes (regra_id, comentado_em DESC);
CREATE INDEX instagram_interacoes_pessoa_idx ON comercial.instagram_interacoes (conta_id, pessoa_id);

-- Formulários dos anúncios (instant forms) da página: o que cada pergunta vira e onde o lead entra.
CREATE TABLE comercial.instagram_formularios (
  id               bigserial PRIMARY KEY,
  conta_id         integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  form_id          text NOT NULL,
  nome             text NOT NULL,
  -- [{ "chave": "full_name", "rotulo": "Nome completo", "tipo": "FULL_NAME", "campo": "contato" }]
  perguntas        jsonb NOT NULL DEFAULT '[]',
  ligado           boolean NOT NULL DEFAULT true,
  etapa_id         integer,
  responsavel_id   integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  etiquetas        text[] NOT NULL DEFAULT '{instagram}',
  boas_vindas      text,
  avisar           boolean NOT NULL DEFAULT true,
  criado_em        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX instagram_formularios_form_idx ON comercial.instagram_formularios (conta_id, form_id);

-- Cada cadastro que chegou de um formulário.
CREATE TABLE comercial.instagram_cadastros (
  id               bigserial PRIMARY KEY,
  conta_id         integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  leadgen_id       text NOT NULL,
  form_id          text,
  anuncio          text,
  campanha         text,
  plataforma       text,
  respostas        jsonb NOT NULL DEFAULT '[]',
  empresa_id       bigint,
  erro             text,
  criado_em        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX instagram_cadastros_leadgen_idx ON comercial.instagram_cadastros (conta_id, leadgen_id);
CREATE INDEX instagram_cadastros_form_idx ON comercial.instagram_cadastros (conta_id, form_id, criado_em DESC);

-- O lead do Instagram: o id da pessoa (para o direct) e de onde veio.
ALTER TABLE comercial.oportunidades
  ADD COLUMN instagram_id   text,
  ADD COLUMN instagram_usuario text,
  ADD COLUMN origem_instagram jsonb;
CREATE UNIQUE INDEX oportunidades_instagram_idx ON comercial.oportunidades (conta_id, instagram_id)
  WHERE instagram_id IS NOT NULL;

-- O direct é mais um canal da conversa.
ALTER TABLE comercial.mensagens
  ADD COLUMN canal        text NOT NULL DEFAULT 'whatsapp' CHECK (canal IN ('whatsapp', 'instagram')),
  ADD COLUMN instagram_id text;

ALTER TABLE comercial.atividades DROP CONSTRAINT atividades_tipo_check;
ALTER TABLE comercial.atividades ADD CONSTRAINT atividades_tipo_check
  CHECK (tipo IN ('whatsapp', 'ligacao', 'email', 'visita', 'reuniao', 'nota', 'etapa', 'instagram'));

-- Mensagem automática (o direct do "comente e receba" e as boas-vindas do formulário do anúncio).
ALTER TABLE comercial.mensagens DROP CONSTRAINT mensagens_origem_check;
ALTER TABLE comercial.mensagens ADD CONSTRAINT mensagens_origem_check
  CHECK (origem IN ('agente', 'cadencia', 'humano', 'lead', 'sequencia', 'automatico'));
