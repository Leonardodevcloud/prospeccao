-- Operação com várias contas. Dono: api.
--
--  * Consumo e limites: quanto cada conta gasta de IA (chamadas e tokens), e-mail e WhatsApp no mês,
--    com teto por conta e a opção de não usar a IA da plataforma.
--  * Senha esquecida: link de redefinição por e-mail (a senha antiga vale até a nova ser criada).
--  * Auditoria: quem fez o quê, em qual conta (inclusive o master dentro da conta de outro).
--  * Sequência multicanal: os passos da campanha podem ser e-mail, WhatsApp ou ligação, e a
--    sequência para quando o lead responde em qualquer canal.
--  * Vários chips de WhatsApp por conta, com limite por chip e rodízio (o lead fica sempre no mesmo).
--  * Alertas: o que quebrou (e-mail não sai, chip caiu, worker parado…), com aviso para quem cuida.
--  * Notificação no celular (Web Push): inscrições de cada aparelho e as chaves VAPID da plataforma.

/* ───────────── Consumo e limites ───────────── */

ALTER TABLE cadastro.contas
  -- Sem chave de IA própria, a conta usa a IA da plataforma (a sua chave) se isto estiver ligado.
  ADD COLUMN usa_ia_plataforma  boolean NOT NULL DEFAULT true,
  -- Tetos do mês (null = sem teto). A IA conta só as chamadas feitas com a chave da plataforma.
  ADD COLUMN limite_ia_mes        integer CHECK (limite_ia_mes >= 0),
  ADD COLUMN limite_emails_mes    integer CHECK (limite_emails_mes >= 0),
  ADD COLUMN limite_whatsapp_mes  integer CHECK (limite_whatsapp_mes >= 0);

-- Uso da IA por dia (fuso de São Paulo), separado pela chave usada: a da conta ou a da plataforma.
CREATE TABLE cadastro.consumo_ia (
  conta_id        integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  dia             date NOT NULL,
  origem          text NOT NULL CHECK (origem IN ('conta', 'plataforma')),
  chamadas        integer NOT NULL DEFAULT 0,
  tokens_entrada  bigint NOT NULL DEFAULT 0,
  tokens_saida    bigint NOT NULL DEFAULT 0,
  erros           integer NOT NULL DEFAULT 0,
  bloqueadas      integer NOT NULL DEFAULT 0,
  PRIMARY KEY (conta_id, dia, origem)
);

/* ───────────── Senha esquecida ───────────── */

ALTER TABLE cadastro.usuarios
  -- Hash (sha256) do token do link: quem lê o banco não consegue usar o link.
  ADD COLUMN redefinir_hash    text,
  ADD COLUMN redefinir_expira  timestamptz;
CREATE UNIQUE INDEX usuarios_redefinir_idx ON cadastro.usuarios (redefinir_hash) WHERE redefinir_hash IS NOT NULL;

/* ───────────── Auditoria ───────────── */

CREATE TABLE cadastro.auditoria (
  id            bigserial PRIMARY KEY,
  -- Conta onde a ação aconteceu (null: ação da plataforma, como criar conta no painel master).
  conta_id      integer REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  usuario_id    integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  usuario_nome  text,
  -- O master agindo dentro da conta de outra empresa.
  como_master   boolean NOT NULL DEFAULT false,
  acao          text NOT NULL,
  descricao     text NOT NULL,
  metodo        text,
  caminho       text,
  empresa_id    bigint,
  detalhes      jsonb,
  ip            text,
  criado_em     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auditoria_conta_idx ON cadastro.auditoria (conta_id, criado_em DESC);
CREATE INDEX auditoria_usuario_idx ON cadastro.auditoria (usuario_id, criado_em DESC);
CREATE INDEX auditoria_empresa_idx ON cadastro.auditoria (conta_id, empresa_id, criado_em DESC)
  WHERE empresa_id IS NOT NULL;

/* ───────────── Sequência multicanal ───────────── */

-- Cada passo (passos[]) ganha "canal": email (padrão, como era), whatsapp (texto com variáveis) ou
-- ligacao (tarefa para o dono do lead). O passo de WhatsApp ou ligação põe o lead no funil.
ALTER TABLE comercial.envios_email
  ALTER COLUMN email DROP NOT NULL,
  ADD COLUMN canal        text NOT NULL DEFAULT 'email' CHECK (canal IN ('email', 'whatsapp', 'ligacao')),
  ADD COLUMN telefone     text,
  ADD COLUMN mensagem_id  bigint,
  ADD COLUMN tarefa_id    bigint,
  -- A sequência parou para este lead (respondeu em algum canal, mudou de etapa, pediu para sair).
  ADD COLUMN parado_em    timestamptz,
  ADD COLUMN parado_motivo text;
ALTER TABLE comercial.envios_email DROP CONSTRAINT envios_email_status_check;
ALTER TABLE comercial.envios_email ADD CONSTRAINT envios_email_status_check
  CHECK (status IN ('na_fila', 'enviado', 'erro', 'devolvido', 'cancelado', 'pulado'));
CREATE INDEX envios_email_lead_idx ON comercial.envios_email (conta_id, empresa_id, campanha_email_id);

-- Mensagem de WhatsApp que veio de um passo da sequência.
ALTER TABLE comercial.mensagens DROP CONSTRAINT mensagens_origem_check;
ALTER TABLE comercial.mensagens ADD CONSTRAINT mensagens_origem_check
  CHECK (origem IN ('agente', 'cadencia', 'humano', 'lead', 'sequencia'));

/* ───────────── Chips de WhatsApp ───────────── */

-- A Evolution da conta (endereço e chave no painel master) pode ter várias instâncias (chips).
-- Sem nenhum chip cadastrado, vale a instância das credenciais, como antes.
CREATE TABLE comercial.chips (
  id          serial PRIMARY KEY,
  conta_id    integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  nome        text NOT NULL,
  instancia   text NOT NULL,
  ativo       boolean NOT NULL DEFAULT true,
  -- Mensagens automáticas (IA, cadência, sequência) por dia neste chip.
  limite_dia  integer NOT NULL DEFAULT 40 CHECK (limite_dia BETWEEN 1 AND 1000),
  -- Último estado lido na Evolution ("open" = conectado).
  estado      text,
  estado_em   timestamptz,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX chips_instancia_idx ON comercial.chips (conta_id, lower(instancia));

ALTER TABLE comercial.mensagens ADD COLUMN chip_id integer REFERENCES comercial.chips (id) ON DELETE SET NULL;
-- O lead conversa sempre pelo mesmo chip (o número que ele conhece).
ALTER TABLE comercial.oportunidades ADD COLUMN chip_id integer REFERENCES comercial.chips (id) ON DELETE SET NULL;
CREATE INDEX mensagens_chip_idx ON comercial.mensagens (chip_id, enviado_em) WHERE chip_id IS NOT NULL;

-- Quem já tinha a instância cadastrada no painel ganha o chip correspondente.
INSERT INTO comercial.chips (conta_id, nome, instancia)
SELECT k.conta_id, 'Chip principal', k.evolution_instancia
  FROM cadastro.credenciais_conta k
 WHERE k.evolution_instancia IS NOT NULL AND k.evolution_instancia <> ''
ON CONFLICT DO NOTHING;

/* ───────────── Alertas e sinais de vida ───────────── */

CREATE TABLE comercial.alertas (
  id            bigserial PRIMARY KEY,
  -- null: alerta da plataforma (worker parado), só para o master.
  conta_id      integer REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  chave         text NOT NULL,
  nivel         text NOT NULL DEFAULT 'erro' CHECK (nivel IN ('erro', 'aviso')),
  titulo        text NOT NULL,
  texto         text,
  link          text,
  ativo         boolean NOT NULL DEFAULT true,
  primeira_vez  timestamptz NOT NULL DEFAULT now(),
  ultima_vez    timestamptz NOT NULL DEFAULT now(),
  resolvido_em  timestamptz
);
CREATE UNIQUE INDEX alertas_ativos_idx ON comercial.alertas (coalesce(conta_id, 0), chave) WHERE ativo;
CREATE INDEX alertas_conta_idx ON comercial.alertas (conta_id, ultima_vez DESC);

-- Cada serviço (api, workers) diz que está vivo a cada minuto.
CREATE TABLE cadastro.servicos_vivos (
  nome       text PRIMARY KEY,
  visto_em   timestamptz NOT NULL DEFAULT now(),
  iniciado_em timestamptz NOT NULL DEFAULT now(),
  info       jsonb
);

/* ───────────── Notificação no celular ───────────── */

CREATE TABLE cadastro.push_inscricoes (
  id          bigserial PRIMARY KEY,
  usuario_id  integer NOT NULL REFERENCES cadastro.usuarios (id) ON DELETE CASCADE,
  endpoint    text NOT NULL UNIQUE,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  aparelho    text,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  usado_em    timestamptz,
  falhas      integer NOT NULL DEFAULT 0
);
CREATE INDEX push_inscricoes_usuario_idx ON cadastro.push_inscricoes (usuario_id);

-- Chaves da plataforma geradas pelo próprio sistema (VAPID do Web Push): nada para configurar.
CREATE TABLE cadastro.plataforma (
  chave      text PRIMARY KEY,
  valor      text NOT NULL,
  criado_em  timestamptz NOT NULL DEFAULT now()
);
