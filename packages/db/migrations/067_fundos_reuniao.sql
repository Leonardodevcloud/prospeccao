-- Fundos da câmera nas reuniões (desfoque, cenários e fotos da empresa com a logo da marca própria).
-- A configuração da empresa (quais fundos o time usa, o padrão ao entrar, travar, onde a logo fica)
-- vale para todas as unidades da organização. As fotos que a empresa envia (recepção, fachada…)
-- ficam aqui, já ajustadas para 1920×1080 pelo navegador.

ALTER TABLE cadastro.organizacoes
  ADD COLUMN fundos jsonb NOT NULL DEFAULT '{}';

CREATE TABLE cadastro.fundos_empresa (
  id              bigserial PRIMARY KEY,
  organizacao_id  integer NOT NULL REFERENCES cadastro.organizacoes (id) ON DELETE CASCADE,
  nome            text NOT NULL,
  imagem          bytea NOT NULL,
  tipo            text NOT NULL CHECK (tipo IN ('image/png', 'image/jpeg')),
  criado_em       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX fundos_empresa_organizacao_idx ON cadastro.fundos_empresa (organizacao_id);
