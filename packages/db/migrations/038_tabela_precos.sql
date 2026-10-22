-- Tabela de preços dos planos (editável no painel master). Dono: api.
-- Vazia = os valores de partida do sistema. Uma linha só.
CREATE TABLE cadastro.tabela_precos (
  id            integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  dados         jsonb NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL
);
