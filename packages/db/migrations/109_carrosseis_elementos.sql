-- v153: os elementos em 3D da peça "em camadas": um objeto feito pela IA (PNG transparente), guardado
-- como uma foto de origem 'elemento' (fora da biblioteca de fotos).
ALTER TABLE comercial.carrossel_fotos DROP CONSTRAINT IF EXISTS carrossel_fotos_origem_check;
ALTER TABLE comercial.carrossel_fotos
  ADD CONSTRAINT carrossel_fotos_origem_check
  CHECK (origem IN ('enviada', 'gerada', 'cenario', 'referencia', 'melhorada', 'arte', 'recorte', 'elemento'));
