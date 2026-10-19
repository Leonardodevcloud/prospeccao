-- 1) Seu retorno sobre os contatos (dono: api, schema comercial): "número errado" e "não é quem
--    decide". O enriquecimento lê a view publicada e respeita na próxima rodada; o relatório mostra
--    quais fontes erram mais.
CREATE TABLE IF NOT EXISTS comercial.feedback (
  id          bigserial PRIMARY KEY,
  empresa_id  bigint NOT NULL,
  tipo        text NOT NULL CHECK (tipo IN ('numero_errado', 'nao_decisor')),
  -- numero_errado: o valor do contato (telefone só dígitos, e-mail); nao_decisor: o nome da pessoa
  valor       text NOT NULL,
  canal       text,
  -- de onde o contato tinha vindo (para saber quais fontes erram)
  fontes      text[] NOT NULL DEFAULT '{}',
  autor       text,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, tipo, valor)
);
CREATE INDEX IF NOT EXISTS feedback_empresa_idx ON comercial.feedback (empresa_id);

CREATE OR REPLACE VIEW comercial.v_feedback AS
SELECT empresa_id, tipo, valor, canal FROM comercial.feedback;

-- 2) Dados do Google achados pelo enriquecimento (busca por nome e endereço), para a ficha mostrar
--    nota, avaliações e categoria de quem não apareceu nas buscas da campanha. Dono: worker-enriquecimento.
ALTER TABLE enriquecimento.leads
  ADD COLUMN IF NOT EXISTS maps_nota       numeric(2, 1),
  ADD COLUMN IF NOT EXISTS maps_avaliacoes integer,
  ADD COLUMN IF NOT EXISTS maps_categoria  text,
  ADD COLUMN IF NOT EXISTS maps_url        text,
  ADD COLUMN IF NOT EXISTS maps_endereco   text;
