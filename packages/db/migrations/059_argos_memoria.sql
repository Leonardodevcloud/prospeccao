-- Memória do Argos. Dono: api.
--
-- O que a pessoa pede para o Argos guardar ("lembra que minha meta é 30 reuniões por mês",
-- "quando eu falar farmácias, é a campanha Farmácias de Maceió"). Cada memória é de UMA pessoa
-- (privada, como as conversas) e fica fora da vitrine do Argos (schema cerebro): ela entra no
-- contexto de cada pergunta dessa pessoa, nunca nas de outra.

CREATE TABLE comercial.argos_memorias (
  id          bigserial PRIMARY KEY,
  usuario_id  integer NOT NULL REFERENCES cadastro.usuarios (id) ON DELETE CASCADE,
  conta_id    integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  texto       text NOT NULL CHECK (length(texto) BETWEEN 3 AND 300),
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX argos_memorias_usuario_idx ON comercial.argos_memorias (usuario_id, criado_em DESC);
