-- Meta de leads da campanha: quantos leads enriquecer (null = todos que achar). Dono: api.
-- Atingida a meta, as buscas no Maps que faltam ficam "bloqueadas" com o motivo e voltam
-- se a meta subir; o enriquecimento só recebe até a meta (achados no Google primeiro).
ALTER TABLE cadastro.campanhas
  ADD COLUMN limite_leads integer CHECK (limite_leads IS NULL OR limite_leads > 0);

CREATE OR REPLACE VIEW cadastro.v_campanhas_descoberta AS
SELECT cp.id,
       cp.nome,
       cp.status,
       cp.cidades,
       cp.raio_km::float8 AS raio_km,
       cp.max_por_busca,
       n.id AS nicho_id,
       n.cnaes,
       n.termos_maps,
       n.palavras_positivas,
       n.palavras_negativas,
       n.portes,
       n.idade_minima_anos,
       n.excluir_mei,
       cp.teto_places_usd::float8 AS teto_places_usd,
       cp.conta_id,
       cp.limite_leads
  FROM cadastro.campanhas cp
  JOIN cadastro.nichos n ON n.id = cp.nicho_id;
