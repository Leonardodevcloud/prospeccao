-- Histórico das conversas com o Argos. Dono: api.
--
-- Cada conversa é de UMA pessoa (privada: nem o gestor nem o master leem a conversa dos outros)
-- e fica fora da vitrine do Argos (schema cerebro), então a IA também não a consulta.
-- A pessoa renomeia e apaga; ao desativar/apagar a pessoa, as conversas vão junto.

CREATE TABLE comercial.argos_conversas (
  id            bigserial PRIMARY KEY,
  usuario_id    integer NOT NULL REFERENCES cadastro.usuarios (id) ON DELETE CASCADE,
  -- Unidade em que a conversa começou (as respostas seguem o escopo de quem pergunta, na hora).
  conta_id      integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  titulo        text NOT NULL,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX argos_conversas_usuario_idx ON comercial.argos_conversas (usuario_id, atualizado_em DESC);

CREATE TABLE comercial.argos_trocas (
  id           bigserial PRIMARY KEY,
  conversa_id  bigint NOT NULL REFERENCES comercial.argos_conversas (id) ON DELETE CASCADE,
  pergunta     text NOT NULL,
  -- A resposta como a tela mostra (fala, análise, dados da consulta, ação).
  resposta     jsonb NOT NULL,
  via          text NOT NULL DEFAULT 'texto' CHECK (via IN ('texto', 'voz')),
  criado_em    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX argos_trocas_conversa_idx ON comercial.argos_trocas (conversa_id, id);
