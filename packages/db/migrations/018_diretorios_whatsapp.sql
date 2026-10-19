-- Novas fontes do enriquecimento. Dono: worker-enriquecimento.
--  * etapa "google": busca da razão social no Google (diretórios como AutoGuiaBR, Lavrale…),
--    de onde saem telefone e e-mail citados nos trechos.
--  * fonte "whatsapp": e-mail/site do perfil comercial (WhatsApp Business) do número da loja.

ALTER TABLE enriquecimento.etapas DROP CONSTRAINT IF EXISTS etapas_etapa_check;
ALTER TABLE enriquecimento.etapas ADD CONSTRAINT etapas_etapa_check
  CHECK (etapa IN ('receita', 'maps', 'site', 'google', 'instagram', 'ia', 'linkedin', 'places', 'whatsapp'));

ALTER TABLE enriquecimento.contatos DROP CONSTRAINT IF EXISTS contatos_fonte_check;
ALTER TABLE enriquecimento.contatos ADD CONSTRAINT contatos_fonte_check
  CHECK (fonte IN ('receita', 'maps', 'site', 'instagram', 'linkedin', 'google', 'ia', 'places', 'manual', 'whatsapp'));
