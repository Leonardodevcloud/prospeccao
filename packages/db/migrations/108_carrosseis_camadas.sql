-- v152: a peça "em camadas" dos cards: a foto da empresa com o fundo tirado pela IA (PNG transparente)
-- fica guardada como uma foto de origem 'recorte' (fora da biblioteca de fotos; uma por foto de origem,
-- reaproveitada nas peças seguintes).
ALTER TABLE comercial.carrossel_fotos DROP CONSTRAINT IF EXISTS carrossel_fotos_origem_check;
ALTER TABLE comercial.carrossel_fotos
  ADD CONSTRAINT carrossel_fotos_origem_check
  CHECK (origem IN ('enviada', 'gerada', 'cenario', 'referencia', 'melhorada', 'arte', 'recorte'));
CREATE INDEX IF NOT EXISTS carrossel_fotos_recorte
  ON comercial.carrossel_fotos (conta_id, base_foto_id) WHERE origem = 'recorte';
