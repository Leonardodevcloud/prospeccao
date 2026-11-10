-- Reunião longa (v127). Dono: api.
-- O áudio de cada pessoa com mais de 20 minutos é transcrito em partes de 20 minutos (o plano
-- grátis da Groq aceita até 25 MB por envio e 2 horas de áudio por hora): cada parte pronta fica
-- guardada aqui, para a próxima tentativa (depois de esperar o limite) continuar de onde parou.
-- E o motivo da falha da transcrição fica na sessão (a tela mostra e oferece tentar de novo).

CREATE TABLE comercial.sala_transcricao_partes (
  gravacao_id text        NOT NULL,
  parte       integer     NOT NULL,
  sessao_id   bigint      NOT NULL REFERENCES comercial.sala_sessoes (id) ON DELETE CASCADE,
  conta_id    integer     NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  -- Onde a parte começa no áudio da pessoa (ms) e os trechos já com esse deslocamento.
  inicio_ms   integer     NOT NULL,
  trechos     jsonb       NOT NULL,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gravacao_id, parte)
);
CREATE INDEX sala_transcricao_partes_sessao_idx ON comercial.sala_transcricao_partes (sessao_id);

ALTER TABLE comercial.sala_sessoes ADD COLUMN transcricao_erro text;
