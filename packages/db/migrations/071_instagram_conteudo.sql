-- Análise do conteúdo do Instagram: as publicações com os números do Instagram (alcance,
-- curtidas, salvos…) guardados a cada atualização, e todos os comentários de cada uma (para
-- responder, mandar direct ou virar lead; os que perguntam preço ou pedem contato ficam marcados).

CREATE TABLE comercial.instagram_midias (
  conta_id          integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  midia_id          text NOT NULL,
  legenda           text,
  tipo              text,
  link              text,
  imagem            text,
  publicado_em      timestamptz,
  alcance           integer,
  visualizacoes     integer,
  curtidas          integer,
  comentarios       integer,
  salvos            integer,
  compartilhamentos integer,
  visitas_perfil    integer,
  seguiram          integer,
  interacoes        integer,
  numeros_em        timestamptz,
  comentarios_em    timestamptz,
  PRIMARY KEY (conta_id, midia_id)
);
CREATE INDEX instagram_midias_data_idx ON comercial.instagram_midias (conta_id, publicado_em DESC);

CREATE TABLE comercial.instagram_comentarios (
  conta_id          integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  comentario_id     text NOT NULL,
  midia_id          text NOT NULL,
  pessoa_id         text,
  usuario           text,
  texto             text NOT NULL,
  comentado_em      timestamptz NOT NULL DEFAULT now(),
  -- preco, informacao ou contato (quem demonstrou interesse); null: comentário comum
  interesse         text CHECK (interesse IN ('preco', 'informacao', 'contato')),
  respondido_em     timestamptz,
  resposta          text,
  direct_em         timestamptz,
  empresa_id        bigint,
  PRIMARY KEY (conta_id, comentario_id)
);
CREATE INDEX instagram_comentarios_midia_idx ON comercial.instagram_comentarios (conta_id, midia_id, comentado_em DESC);

-- A conexão sabe quando os números foram atualizados e se falta a permissão das estatísticas.
ALTER TABLE comercial.instagram_contas
  ADD COLUMN conteudo_em        timestamptz,
  ADD COLUMN estatisticas_erro  text;

-- Direct mandado à mão a partir de um comentário (na página do post): o texto fica na interação
-- para entrar na conversa quando a pessoa responder.
ALTER TABLE comercial.instagram_interacoes ADD COLUMN mensagem text;
