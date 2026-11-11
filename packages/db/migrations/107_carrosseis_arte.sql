-- v150: a "Arte da IA" dos cards avulsos: a peça inteira desenhada pela IA de imagem fica guardada como
-- uma foto de origem 'arte' (fora da biblioteca de fotos; apagada junto com a variação).
ALTER TABLE comercial.carrossel_fotos DROP CONSTRAINT IF EXISTS carrossel_fotos_origem_check;
ALTER TABLE comercial.carrossel_fotos
  ADD CONSTRAINT carrossel_fotos_origem_check
  CHECK (origem IN ('enviada', 'gerada', 'cenario', 'referencia', 'melhorada', 'arte'));
