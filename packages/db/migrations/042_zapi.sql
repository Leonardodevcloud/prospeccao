-- WhatsApp pela Z-API. Dono: api (agente).
-- Cada chip é uma instância da Z-API, criada pela plataforma (parceira) quando o cliente clica em
-- "Conectar número" e conectada pelo próprio cliente lendo o QR Code. O token da instância fica
-- cifrado (CHAVE_CREDENCIAIS), como os demais segredos.
ALTER TABLE comercial.chips
  ADD COLUMN provedor      text NOT NULL DEFAULT 'zapi' CHECK (provedor IN ('zapi', 'evolution')),
  ADD COLUMN token_cifrado text,
  -- Número que leu o QR Code (DDD + número), quando conectado.
  ADD COLUMN numero        text,
  -- Assinatura da instância na Z-API (feita na primeira conexão; antes disso é o teste de 2 dias).
  ADD COLUMN assinado_em   timestamptz;

-- Chips da Evolution não enviam mais: ficam pausados, pedindo para conectar o número de novo.
UPDATE comercial.chips
   SET provedor = 'evolution', ativo = false,
       estado = 'Da Evolution: conecte o número de novo pelo QR Code', estado_em = now()
 WHERE token_cifrado IS NULL;

-- Quantos números de WhatsApp a conta pode conectar (cada um é uma instância paga na Z-API).
-- Toda conta começa com 1 (o master aumenta no painel); null = sem limite (a conta principal).
ALTER TABLE cadastro.contas
  ADD COLUMN limite_chips integer DEFAULT 1 CHECK (limite_chips IS NULL OR limite_chips >= 0);
UPDATE cadastro.contas SET limite_chips = NULL WHERE principal;
