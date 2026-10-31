-- Devolver as vendas para a Meta (API de Conversões, integração de leads de CRM): o conjunto de
-- dados (pixel) e o token que o cliente gera no Gerenciador de Eventos, e cada etapa do funil
-- avisada para cada lead que veio de formulário de anúncio.

ALTER TABLE comercial.instagram_contas
  ADD COLUMN capi_ligado        boolean NOT NULL DEFAULT false,
  ADD COLUMN capi_dataset       text,
  ADD COLUMN capi_token_cifrado text,
  ADD COLUMN capi_erro          text,
  ADD COLUMN capi_erro_em       timestamptz;

CREATE TABLE comercial.meta_eventos (
  id           bigserial PRIMARY KEY,
  conta_id     integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  empresa_id   bigint NOT NULL,
  leadgen_id   text NOT NULL,
  etapa        text NOT NULL CHECK (etapa IN ('lead', 'respondeu', 'reuniao', 'proposta', 'ganho')),
  evento       text NOT NULL,
  evento_em    timestamptz NOT NULL,
  enviado_em   timestamptz,
  tentativas   integer NOT NULL DEFAULT 0,
  erro         text,
  criado_em    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX meta_eventos_etapa_idx ON comercial.meta_eventos (conta_id, empresa_id, etapa);
CREATE INDEX meta_eventos_fila_idx ON comercial.meta_eventos (conta_id, enviado_em) WHERE enviado_em IS NULL;
