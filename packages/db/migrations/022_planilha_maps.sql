-- Importar planilha do Google Maps (Instant Data Scraper): vira uma "busca" do tipo planilha,
-- cruzada com a base de CNPJ como os resultados do Maps. Dono: worker-descoberta.
ALTER TABLE descoberta.buscas_maps DROP CONSTRAINT IF EXISTS buscas_maps_fonte_check;
ALTER TABLE descoberta.buscas_maps ADD CONSTRAINT buscas_maps_fonte_check
  CHECK (fonte IN ('apify', 'places', 'planilha'));
