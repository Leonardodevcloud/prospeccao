-- E-mail pelo Resend (no lugar de SMTP/IMAP). Dono: api.
--  * envios_email.resend_id: id do e-mail no Resend (os webhooks de entrega, abertura, clique,
--    devolução e spam chegam por ele).
--  * config_email.webhook_em: último aviso do Resend recebido (a tela mostra se está chegando).

ALTER TABLE comercial.envios_email
  ADD COLUMN IF NOT EXISTS resend_id text,
  ADD COLUMN IF NOT EXISTS entregue_em timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS envios_email_resend_idx ON comercial.envios_email (resend_id)
  WHERE resend_id IS NOT NULL;

ALTER TABLE comercial.config_email
  ADD COLUMN IF NOT EXISTS webhook_em timestamptz,
  DROP COLUMN IF EXISTS imap_ultimo_uid,
  DROP COLUMN IF EXISTS imap_lido_em,
  DROP COLUMN IF EXISTS imap_erro;

-- Resposta recebida pelo Resend: id do e-mail recebido (evita processar duas vezes).
ALTER TABLE comercial.respostas_email
  ADD COLUMN IF NOT EXISTS resend_id text;
CREATE UNIQUE INDEX IF NOT EXISTS respostas_email_resend_idx ON comercial.respostas_email (resend_id)
  WHERE resend_id IS NOT NULL;
