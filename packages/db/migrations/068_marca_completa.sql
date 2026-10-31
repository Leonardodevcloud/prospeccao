-- Marca própria completa (como as plataformas de white label): duas logos (para fundo escuro e para
-- fundo claro), três ícones (aba do navegador, ícone da marca e app instalado) e quatro cores
-- (primária, secundária, destaque e clara), com a opção do menu lateral na cor secundária.
-- O que já existia continua: marca_logo é a logo para fundo claro, marca_icone o ícone da marca e
-- marca_cor a cor primária.

ALTER TABLE cadastro.organizacoes
  ADD COLUMN marca_logo_escuro       bytea,
  ADD COLUMN marca_logo_escuro_tipo  text CHECK (marca_logo_escuro_tipo IN ('image/png', 'image/jpeg')),
  ADD COLUMN marca_favicon           bytea,
  ADD COLUMN marca_favicon_tipo      text CHECK (marca_favicon_tipo IN ('image/png', 'image/jpeg')),
  ADD COLUMN marca_app               bytea,
  ADD COLUMN marca_app_tipo          text CHECK (marca_app_tipo IN ('image/png', 'image/jpeg')),
  ADD COLUMN marca_cor_secundaria    text CHECK (marca_cor_secundaria ~ '^#[0-9a-fA-F]{6}$'),
  ADD COLUMN marca_cor_destaque      text CHECK (marca_cor_destaque ~ '^#[0-9a-fA-F]{6}$'),
  ADD COLUMN marca_cor_clara         text CHECK (marca_cor_clara ~ '^#[0-9a-fA-F]{6}$'),
  ADD COLUMN marca_menu_escuro       boolean NOT NULL DEFAULT false;

-- Fundos da câmera que cada pessoa do time envia (até 5): aparecem em qualquer computador dela.
CREATE TABLE cadastro.fundos_pessoais (
  id          bigserial PRIMARY KEY,
  usuario_id  integer NOT NULL REFERENCES cadastro.usuarios (id) ON DELETE CASCADE,
  nome        text NOT NULL,
  imagem      bytea NOT NULL,
  tipo        text NOT NULL CHECK (tipo IN ('image/png', 'image/jpeg')),
  criado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX fundos_pessoais_usuario_idx ON cadastro.fundos_pessoais (usuario_id);
