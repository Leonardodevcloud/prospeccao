-- Sinal de vida do worker-enriquecimento, para a tela saber se ele está rodando, pausado
-- (ENRIQ_PAUSADO=true) ou fora do ar. Dono: worker-enriquecimento. Uma linha só.
CREATE TABLE enriquecimento.servico (
  id         smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  pausado    boolean NOT NULL,
  visto_em   timestamptz NOT NULL DEFAULT now(),
  iniciado_em timestamptz NOT NULL DEFAULT now()
);
