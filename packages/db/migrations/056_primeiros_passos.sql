-- Primeiros passos (dono: api): a lista de começo na tela inicial do administrador.
-- O que está feito é calculado na hora; aqui fica só quando o administrador fechou a lista.

ALTER TABLE cadastro.contas ADD COLUMN IF NOT EXISTS primeiros_passos_fechado_em timestamptz;
