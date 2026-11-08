-- Carteira: "fila" é a divisão em que o lead sem dono fica numa fila que todo o time vê e puxa para
-- a própria carteira (quem vê só a própria base passa a ver também os sem dono).
ALTER TABLE comercial.config_equipe DROP CONSTRAINT IF EXISTS config_equipe_distribuicao_sdr_check;
ALTER TABLE comercial.config_equipe
  ADD CONSTRAINT config_equipe_distribuicao_sdr_check CHECK (distribuicao_sdr IN ('rodizio', 'manual', 'fila'));

-- Grupos de atendimento (lojas, departamentos): quem atende cada grupo. Base da central telefônica
-- com menu ("aperte 1 para a loja A": toca para o grupo).
CREATE TABLE cadastro.grupos_atendimento (
  id         serial PRIMARY KEY,
  conta_id   integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  nome       text NOT NULL,
  ordem      integer NOT NULL DEFAULT 0,
  criado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX grupos_atendimento_nome ON cadastro.grupos_atendimento (conta_id, lower(nome));

CREATE TABLE cadastro.grupo_membros (
  grupo_id   integer NOT NULL REFERENCES cadastro.grupos_atendimento (id) ON DELETE CASCADE,
  usuario_id integer NOT NULL REFERENCES cadastro.usuarios (id) ON DELETE CASCADE,
  PRIMARY KEY (grupo_id, usuario_id)
);
CREATE INDEX grupo_membros_usuario ON cadastro.grupo_membros (usuario_id);
