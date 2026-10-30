-- Marca própria completa (plano Escala): além do nome, da cor e do logo, o ícone (aba do navegador e
-- app no celular), a imagem de divulgação (ao lado do login e na prévia do link no WhatsApp) e o
-- domínio próprio do cliente (crm.empresa.com.br), que ele mesmo configura no DNS dele. O sistema
-- cadastra o domínio no Vercel e confere sozinho até ficar ativo.

ALTER TABLE cadastro.organizacoes
  ADD COLUMN marca_icone        bytea,
  ADD COLUMN marca_icone_tipo   text CHECK (marca_icone_tipo IN ('image/png', 'image/jpeg')),
  ADD COLUMN marca_imagem       bytea,
  ADD COLUMN marca_imagem_tipo  text CHECK (marca_imagem_tipo IN ('image/png', 'image/jpeg')),
  -- Domínio próprio (sempre em minúsculas) e onde ele está: pendente (esperando o DNS) ou ativo.
  ADD COLUMN dominio            text CHECK (dominio = lower(dominio)),
  ADD COLUMN dominio_situacao   text CHECK (dominio_situacao IN ('pendente', 'ativo')),
  -- Registros que o cliente cria no DNS dele (CNAME ou A, e o TXT de verificação quando o Vercel pede).
  ADD COLUMN dominio_registros  jsonb NOT NULL DEFAULT '[]',
  -- O que falta, em português, da última conferência.
  ADD COLUMN dominio_erro       text,
  ADD COLUMN dominio_desde      timestamptz,
  ADD COLUMN dominio_ativo_em   timestamptz,
  ADD COLUMN dominio_conferido_em timestamptz,
  ADD CONSTRAINT organizacoes_dominio_situacao CHECK ((dominio IS NULL) = (dominio_situacao IS NULL));

-- Um domínio é de um cliente só.
CREATE UNIQUE INDEX organizacoes_dominio_uidx ON cadastro.organizacoes (dominio) WHERE dominio IS NOT NULL;
