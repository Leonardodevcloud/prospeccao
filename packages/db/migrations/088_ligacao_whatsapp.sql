-- Ligação pelo WhatsApp: o número de WhatsApp da conta (Z-API, pela ponte SIP) entra como mais um
-- número da telefonia. Recebida por ele cai no mesmo fluxo (menu de voz, grupos, gravação); feita
-- por ele sai pelo tronco do WhatsApp no LiveKit.
ALTER TABLE comercial.telefonia_numeros
  ADD COLUMN IF NOT EXISTS canal text NOT NULL DEFAULT 'telefone' CHECK (canal IN ('telefone', 'whatsapp'));
ALTER TABLE comercial.ligacoes
  ADD COLUMN IF NOT EXISTS canal text NOT NULL DEFAULT 'telefone' CHECK (canal IN ('telefone', 'whatsapp'));
