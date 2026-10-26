-- Leads cadastrados à mão (no funil) e os que chegam por uma conversa nova no WhatsApp. Dono: api.
--
-- Ficam numa lista da conta ("Cadastrados à mão e do WhatsApp", tipo manual), criada na primeira
-- vez. Os contatos que a pessoa digitou ou que vieram da conversa são só da conta (como os importados).

ALTER TABLE cadastro.campanhas DROP CONSTRAINT campanhas_tipo_check;
ALTER TABLE cadastro.campanhas
  ADD CONSTRAINT campanhas_tipo_check CHECK (tipo IN ('busca', 'importacao', 'manual'));

ALTER TABLE descoberta.campanha_empresas DROP CONSTRAINT campanha_empresas_origem_check;
ALTER TABLE descoberta.campanha_empresas
  ADD CONSTRAINT campanha_empresas_origem_check CHECK (origem IN ('cnpj', 'maps', 'ambos', 'importacao', 'manual'));

-- Contato privado: do arquivo importado ou cadastrado pela conta.
ALTER TABLE enriquecimento.contatos DROP CONSTRAINT contatos_privado_importado;
ALTER TABLE enriquecimento.contatos
  ADD CONSTRAINT contatos_privado_da_conta CHECK (conta_id = 0 OR fonte IN ('importacao', 'manual'));

-- Conversa nova no WhatsApp com um número que não é lead: espera alguém decidir (Não identificados)
-- ou já vira lead no funil.
ALTER TABLE comercial.config_agente
  ADD COLUMN conversa_nova text NOT NULL DEFAULT 'perguntar' CHECK (conversa_nova IN ('perguntar', 'criar_lead'));
