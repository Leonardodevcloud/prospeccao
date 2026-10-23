-- Etapa "cnpj" do enriquecimento: o CNPJ de quem veio só do Google Maps é achado (site, Instagram,
-- Google) e conferido na Receita (BrasilAPI). Dono: worker-enriquecimento.
ALTER TABLE enriquecimento.etapas DROP CONSTRAINT IF EXISTS etapas_etapa_check;
ALTER TABLE enriquecimento.etapas ADD CONSTRAINT etapas_etapa_check
  CHECK (etapa IN ('receita', 'maps', 'site', 'google', 'instagram', 'ia', 'linkedin', 'places', 'whatsapp',
                   'base_paga', 'cnpj'));
