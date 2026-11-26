-- v178: a proteção do número (porteiro) fica sempre ligada, e as mensagens prontas ganham versões.
-- O mesmo texto para muita gente é o que mais derruba número no WhatsApp: com até 3 versões por
-- mensagem (a principal e mais 2), o sistema sorteia uma a cada envio.

UPDATE comercial.porteiro SET ativo = true, atualizado_em = now() WHERE NOT ativo;
ALTER TABLE comercial.porteiro ALTER COLUMN ativo SET DEFAULT true;

ALTER TABLE comercial.respostas_rapidas
  ADD COLUMN versoes text[] NOT NULL DEFAULT '{}' CHECK (cardinality(versoes) <= 2);

ALTER TABLE comercial.modelos_mensagem
  ADD COLUMN versoes text[] NOT NULL DEFAULT '{}' CHECK (cardinality(versoes) <= 2);

-- Envio automático (cadência, sequência) segurado por texto repetido: fica registrado no painel.
ALTER TABLE comercial.porteiro_eventos DROP CONSTRAINT IF EXISTS porteiro_eventos_tipo_check;
ALTER TABLE comercial.porteiro_eventos ADD CONSTRAINT porteiro_eventos_tipo_check
  CHECK (tipo IN ('repetida', 'limite', 'espera', 'pausado', 'mesmo_assim', 'variou', 'risco', 'automatica'));
