-- Número (chip de WhatsApp) com dono (dono: api).
--
-- Comercial que tem número próprio: o chip ganha uma pessoa da equipe como dona. Assim:
--  * lead novo que chega por esse número fica com ela (fora do rodízio);
--  * o que ela manda pela tela para um lead que ainda não tem número sai pelo dela;
--  * quem vê só a própria base vê em "Não identificados" só o que chegou no número dela.

ALTER TABLE comercial.chips
  ADD COLUMN IF NOT EXISTS usuario_id integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS chips_usuario_idx ON comercial.chips (usuario_id) WHERE usuario_id IS NOT NULL;
