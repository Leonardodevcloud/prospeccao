-- Base de dados paga (Direct Data): telefones atualizados, com tipo, operadora e WhatsApp.
-- Dono: worker-enriquecimento. Só consultada para leads das faixas escolhidas e sem WhatsApp atual.

ALTER TABLE enriquecimento.etapas DROP CONSTRAINT IF EXISTS etapas_etapa_check;
ALTER TABLE enriquecimento.etapas ADD CONSTRAINT etapas_etapa_check
  CHECK (etapa IN ('receita', 'maps', 'site', 'google', 'instagram', 'ia', 'linkedin', 'places', 'whatsapp',
                   'base_paga'));

ALTER TABLE enriquecimento.contatos DROP CONSTRAINT IF EXISTS contatos_fonte_check;
ALTER TABLE enriquecimento.contatos ADD CONSTRAINT contatos_fonte_check
  CHECK (fonte IN ('receita', 'maps', 'site', 'instagram', 'linkedin', 'google', 'ia', 'places', 'manual',
                   'whatsapp', 'base_paga'));

-- Quanto foi gasto com a base paga (uma linha por consulta), para o custo aparecer.
CREATE TABLE IF NOT EXISTS enriquecimento.uso_base_paga (
  id          bigserial PRIMARY KEY,
  empresa_id  bigint NOT NULL,
  provedor    text NOT NULL,
  custo_brl   numeric(8, 2) NOT NULL DEFAULT 0,
  achados     integer NOT NULL DEFAULT 0,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS uso_base_paga_data_idx ON enriquecimento.uso_base_paga (criado_em);
