-- Buscas no Google pelo Serper, por conta e por dia (o principal custo do enriquecimento).
-- Dono: worker-enriquecimento grava; api lê no painel de Consumo.
CREATE TABLE cadastro.consumo_buscas (
  conta_id  integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  dia       date NOT NULL,
  servico   text NOT NULL DEFAULT 'serper',
  buscas    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (conta_id, dia, servico)
);
