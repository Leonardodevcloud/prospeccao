-- Segundo cérebro (v147). Dono: api.
-- A conta liga o Prospect Team ao "Cérebro" da empresa (outro sistema, repositório brain):
-- os agentes de carrosséis, cards e vídeos leem o que está valendo lá (sem restritos e com dados
-- pessoais mascarados pelo próprio Cérebro) e o que o time aprende no Instagram volta para lá
-- como rascunho. Uma ligação por conta; o token fica cifrado com a CHAVE_CREDENCIAIS.
CREATE TABLE comercial.segundo_cerebro (
  conta_id             integer PRIMARY KEY REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  url                  text NOT NULL CHECK (url ~ '^https?://'),
  token_cifrado        text NOT NULL,
  -- Os 4 últimos do token, para a tela mostrar qual está guardado.
  token_final          text NOT NULL,
  -- De quem é o token no Cérebro (o que o teste devolveu).
  usuario_no_cerebro   text,
  ligado               boolean NOT NULL DEFAULT true,
  enviar_aprendizados  boolean NOT NULL DEFAULT true,
  testado_em           timestamptz,
  erro                 text,
  erro_em              timestamptz,
  ultima_leitura_em    timestamptz,
  leituras             integer NOT NULL DEFAULT 0,
  ultimo_envio_em      timestamptz,
  ultimo_envio_codigo  text,
  ultimo_envio_link    text,
  criado_por           integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  criado_em            timestamptz NOT NULL DEFAULT now(),
  atualizado_em        timestamptz NOT NULL DEFAULT now()
);
