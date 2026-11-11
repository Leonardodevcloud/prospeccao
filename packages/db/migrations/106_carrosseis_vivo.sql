-- Cards e carrosséis mais vivos (v148). Dono: api.
-- O estilo Vivo (cor forte de fundo, foto de ponta a ponta, palavra-chave colorida, selo e botão: o
-- jeito que a maioria das marcas posta). As perguntas do time antes de criar, o objetivo Lançamento
-- e o jeito de postar lido do Instagram ficam nos jsonb que já existem (entrada do pedido e dados da
-- identidade).
ALTER TABLE comercial.carrosseis DROP CONSTRAINT IF EXISTS carrosseis_estilo_check;
ALTER TABLE comercial.carrosseis
  ADD CONSTRAINT carrosseis_estilo_check CHECK (estilo IN ('editorial', 'impacto', 'clean', 'foto', 'vivo'));
