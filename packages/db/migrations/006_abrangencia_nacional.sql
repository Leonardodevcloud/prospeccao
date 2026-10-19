-- Abrangência nacional por padrão: raio_km NULL = sem limite de distância.
-- Com raio, os leads mais longe da base mais próxima ficam fora do enriquecimento.
ALTER TABLE cadastro.campanhas
  ALTER COLUMN raio_km DROP NOT NULL,
  ALTER COLUMN raio_km DROP DEFAULT;

COMMENT ON COLUMN cadastro.campanhas.raio_km IS
  'Raio em km a partir da base mais próxima. NULL = abrangência nacional (sem limite).';
