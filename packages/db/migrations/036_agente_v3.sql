-- Agente de IA v3. Dono: api.
--
--  * Passagens para o time: cada vez que a IA para de responder um lead, com o tipo do motivo
--    (para os números de desempenho da IA).
--  * Aviso ao lead quando a IA passa para o time (pode desligar).
--  * Retorno combinado: o lead pediu para falar depois; a IA retoma na data, com o contexto.
--  * Saúde do chip: chip que começa a falhar fica pausado um tempo, sozinho.

CREATE TABLE comercial.passagens_ia (
  id          bigserial PRIMARY KEY,
  conta_id    integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  empresa_id  bigint NOT NULL,
  -- pediu_pessoa, sensivel, limite, sem_ia, falha, verificacao, ia
  tipo        text NOT NULL,
  motivo      text NOT NULL,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX passagens_ia_conta_idx ON comercial.passagens_ia (conta_id, criado_em DESC);

ALTER TABLE comercial.config_agente ADD COLUMN aviso_passagem boolean NOT NULL DEFAULT true;

ALTER TABLE comercial.oportunidades
  ADD COLUMN agente_retorno_em     timestamptz,
  ADD COLUMN agente_retorno_motivo text;
CREATE INDEX oportunidades_retorno_idx ON comercial.oportunidades (conta_id, agente_retorno_em)
  WHERE agente_retorno_em IS NOT NULL;

ALTER TABLE comercial.chips
  ADD COLUMN pausado_ate  timestamptz,
  ADD COLUMN pausa_motivo text;
-- Quando o envio foi tentado (enviada ou com erro): a saúde do chip olha as tentativas recentes.
ALTER TABLE comercial.mensagens ADD COLUMN tentado_em timestamptz;
CREATE INDEX mensagens_tentativas_chip_idx ON comercial.mensagens (chip_id, tentado_em) WHERE tentado_em IS NOT NULL;
