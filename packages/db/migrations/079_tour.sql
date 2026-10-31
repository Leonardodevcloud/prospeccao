-- v100: tour do sistema (a volta guiada do Argos no primeiro acesso).

-- Quando a pessoa assistiu, pulou ou fechou o convite do tour (null: ainda recebe o convite).
ALTER TABLE cadastro.usuarios ADD COLUMN tour_visto_em timestamptz;

-- Áudios das falas do tour, gerados com a voz do Argos (a chave muda quando muda a voz, a
-- velocidade ou o texto). Gera uma vez e serve para todo mundo.
CREATE TABLE cadastro.tour_audios (
  chave      text PRIMARY KEY,
  audio      bytea NOT NULL,
  criado_em  timestamptz NOT NULL DEFAULT now()
);
