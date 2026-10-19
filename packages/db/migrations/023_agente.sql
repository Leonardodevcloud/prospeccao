-- Agente de abordagem com IA. Dono: api (schema comercial).
--  * config_agente: liga/desliga, revisão antes de enviar, horário, limites e o que a IA sabe da Tutts.
--  * mensagens: conversa de WhatsApp de cada lead (enviadas e recebidas) e a fila de rascunhos.
--  * oportunidades.agente: a IA conduz este lead; agente_pausa: por que passou para você.

CREATE TABLE IF NOT EXISTS comercial.config_agente (
  id                boolean PRIMARY KEY DEFAULT true CHECK (id),
  ligado            boolean NOT NULL DEFAULT false,
  revisar_antes     boolean NOT NULL DEFAULT true,
  hora_inicio       integer NOT NULL DEFAULT 8  CHECK (hora_inicio BETWEEN 0 AND 23),
  hora_fim          integer NOT NULL DEFAULT 18 CHECK (hora_fim BETWEEN 1 AND 24),
  dias_semana       integer[] NOT NULL DEFAULT '{1,2,3,4,5}',
  limite_dia        integer NOT NULL DEFAULT 40,
  intervalo_seg     integer NOT NULL DEFAULT 90,
  respostas_dia_lead integer NOT NULL DEFAULT 6,
  sobre_empresa     text NOT NULL DEFAULT '',
  regras            text NOT NULL DEFAULT '',
  horarios_reuniao  text NOT NULL DEFAULT 'segunda a sexta, das 9h às 12h e das 14h às 17h',
  webhook_token     text NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text),
  atualizado_em     timestamptz NOT NULL DEFAULT now()
);
INSERT INTO comercial.config_agente (id, sobre_empresa, regras) VALUES (
  true,
  'A Tutts faz entregas de última milha por motoboy para lojas de autopeças (B2B). Diferenciais: motoboy dedicado ou sob demanda, prazo garantido (SLA), acompanhamento das entregas em tempo real e atendimento próprio. Atendemos várias cidades do Brasil. Preço depende do volume e da distância: passamos uma proposta depois de entender a operação.',
  'Não prometa preço fechado nem desconto: diga que a proposta sai depois de uma conversa rápida. Não invente cidades atendidas nem prazos. Seja breve (até 3 frases), cordial e em português do Brasil. Objetivo: marcar uma conversa de 15 minutos.'
) ON CONFLICT (id) DO NOTHING;

ALTER TABLE comercial.oportunidades
  ADD COLUMN IF NOT EXISTS agente       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agente_pausa text;

CREATE TABLE IF NOT EXISTS comercial.mensagens (
  id           bigserial PRIMARY KEY,
  empresa_id   bigint NOT NULL,
  direcao      text NOT NULL CHECK (direcao IN ('enviada', 'recebida')),
  texto        text NOT NULL,
  telefone     text,
  status       text NOT NULL CHECK (status IN ('rascunho', 'aprovada', 'enviada', 'erro', 'recebida', 'descartada')),
  origem       text NOT NULL CHECK (origem IN ('agente', 'cadencia', 'humano', 'lead')),
  id_externo   text,
  erro         text,
  -- por que a IA decidiu isso (para você ler na revisão)
  nota         text,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  enviado_em   timestamptz
);
CREATE INDEX IF NOT EXISTS mensagens_empresa_idx ON comercial.mensagens (empresa_id, criado_em);
CREATE INDEX IF NOT EXISTS mensagens_fila_idx ON comercial.mensagens (status, criado_em)
  WHERE status IN ('rascunho', 'aprovada');
CREATE UNIQUE INDEX IF NOT EXISTS mensagens_externo_idx ON comercial.mensagens (id_externo)
  WHERE id_externo IS NOT NULL;
