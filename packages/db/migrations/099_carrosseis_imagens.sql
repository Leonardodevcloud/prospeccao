-- Imagens nos carrosséis (v132). Dono: api.
-- As imagens feitas pela IA viram fotos da empresa como as enviadas (o slide aponta para a foto pelo
-- id, do mesmo jeito): 'gerada' (uma cena para um slide, sem texto, na paleta da marca), 'cenario'
-- (o produto de uma foto enviada num fundo novo, com o produto igual) e 'referencia' (um post de que
-- a empresa gostou: só inspira o estilo, não aparece entre as fotos). Cada uma passou pelo revisor
-- visual; o que ele disse fica guardado.

ALTER TABLE comercial.carrossel_fotos
  ADD COLUMN origem       text NOT NULL DEFAULT 'enviada'
                          CHECK (origem IN ('enviada', 'gerada', 'cenario', 'referencia')),
  -- O cenário: a foto do produto de onde ele saiu.
  ADD COLUMN base_foto_id integer REFERENCES comercial.carrossel_fotos (id) ON DELETE SET NULL,
  -- O que foi pedido à IA de imagem (a cena), e o carrossel para o qual foi feita.
  ADD COLUMN pedido       text,
  ADD COLUMN carrossel_id integer REFERENCES comercial.carrosseis (id) ON DELETE SET NULL,
  -- A referência: o estilo lido pelo modelo de visão (composição, luz, clima).
  ADD COLUMN estilo       text;
CREATE INDEX carrossel_fotos_base ON comercial.carrossel_fotos (base_foto_id) WHERE base_foto_id IS NOT NULL;

-- O custo das imagens dos carrosséis em Saúde e consumo (como o dos vídeos).
ALTER TABLE cadastro.consumo_carrosseis
  ADD COLUMN imagens     integer NOT NULL DEFAULT 0,
  ADD COLUMN imagens_usd numeric(12, 6) NOT NULL DEFAULT 0;
