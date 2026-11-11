-- Cards avulsos e fotos do pedido (v144). Dono: api.
-- Um card avulso é um carrossel de um slide só (tipo 'card'): usa o mesmo editor, a mesma conversa
-- com o time, o mesmo desenho e a mesma publicação. Os cards de um pedido ficam juntos pelo
-- pedido_id; cada card (1, 2, 3…) tem as suas variações (1, 2, 3…) e uma delas é a escolhida.
-- Formato: 'feed' (1080 × 1350, o de todo carrossel) ou 'story' (1080 × 1920).

ALTER TABLE comercial.carrosseis
  ADD COLUMN tipo      text NOT NULL DEFAULT 'carrossel' CHECK (tipo IN ('carrossel', 'card')),
  ADD COLUMN formato   text NOT NULL DEFAULT 'feed' CHECK (formato IN ('feed', 'story')),
  ADD COLUMN pedido_id integer REFERENCES comercial.carrossel_pedidos (id) ON DELETE SET NULL,
  ADD COLUMN card      integer,
  ADD COLUMN variacao  integer,
  ADD COLUMN escolhido boolean NOT NULL DEFAULT false;
CREATE INDEX carrosseis_cards ON comercial.carrosseis (pedido_id, card, variacao) WHERE tipo = 'card';

-- O pedido de cards ao time (e "outra variação" de um card).
ALTER TABLE comercial.carrossel_pedidos DROP CONSTRAINT IF EXISTS carrossel_pedidos_tipo_check;
ALTER TABLE comercial.carrossel_pedidos
  ADD CONSTRAINT carrossel_pedidos_tipo_check CHECK (tipo IN ('carrossel', 'dossie', 'ideias', 'cards'));

-- A foto melhorada pela IA (a mesma foto, com luz, cor e fundo tratados; o assunto igual).
ALTER TABLE comercial.carrossel_fotos DROP CONSTRAINT IF EXISTS carrossel_fotos_origem_check;
ALTER TABLE comercial.carrossel_fotos
  ADD CONSTRAINT carrossel_fotos_origem_check
  CHECK (origem IN ('enviada', 'gerada', 'cenario', 'referencia', 'melhorada'));
