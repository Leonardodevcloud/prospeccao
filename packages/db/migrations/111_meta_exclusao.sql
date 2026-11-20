-- v174: exclusão de dados e desautorização pedidas pela Meta (exigência da Análise do app).
--  • Quem conecta o Instagram faz login no Facebook; guardamos o id dessa pessoa no app (com escopo do
--    app, não é o perfil) para achar a conexão quando a Meta avisar que ela tirou o app ou pediu para
--    apagar os dados.
--  • Cada pedido fica registrado com um código, que a Meta mostra para a pessoa acompanhar
--    (página pública /api/meta/exclusao/<código>).
ALTER TABLE comercial.instagram_contas ADD COLUMN IF NOT EXISTS meta_usuario_id text;
CREATE INDEX IF NOT EXISTS instagram_contas_meta_usuario_idx
  ON comercial.instagram_contas (meta_usuario_id) WHERE meta_usuario_id IS NOT NULL;

CREATE TABLE comercial.meta_exclusoes (
  codigo           text PRIMARY KEY,
  -- 'exclusao': apagar os dados vindos da Meta; 'desautorizacao': a pessoa tirou o app (só desconecta).
  tipo             text NOT NULL CHECK (tipo IN ('exclusao', 'desautorizacao')),
  meta_usuario_id  text NOT NULL,
  -- Quantas conexões do Instagram eram dessa pessoa (em todas as contas do sistema).
  conexoes         integer NOT NULL DEFAULT 0,
  publicacoes      integer NOT NULL DEFAULT 0,
  comentarios      integer NOT NULL DEFAULT 0,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  concluido_em     timestamptz
);
CREATE INDEX meta_exclusoes_usuario_idx ON comercial.meta_exclusoes (meta_usuario_id, criado_em DESC);
