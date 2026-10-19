-- Caixa de entrada do WhatsApp: lidas/não lidas, anexos e respostas rápidas. Dono: api.

ALTER TABLE comercial.mensagens
  ADD COLUMN IF NOT EXISTS lida_em    timestamptz,
  ADD COLUMN IF NOT EXISTS midia_tipo text CHECK (midia_tipo IN ('imagem', 'audio', 'video', 'documento')),
  ADD COLUMN IF NOT EXISTS midia_id   bigint;

-- O que já chegou antes da caixa de entrada conta como lido.
UPDATE comercial.mensagens SET lida_em = criado_em WHERE direcao = 'recebida' AND lida_em IS NULL;

CREATE INDEX IF NOT EXISTS mensagens_nao_lidas_idx ON comercial.mensagens (empresa_id)
  WHERE direcao = 'recebida' AND lida_em IS NULL;

-- Arquivos das conversas (foto, áudio, PDF). Ficam no banco: são poucos e pequenos (até 10 MB).
CREATE TABLE IF NOT EXISTS comercial.midias (
  id         bigserial PRIMARY KEY,
  mime       text NOT NULL,
  nome       text,
  tamanho    integer NOT NULL,
  dados      bytea NOT NULL,
  criado_em  timestamptz NOT NULL DEFAULT now()
);

-- Textos prontos: digite "/" na conversa para escolher.
CREATE TABLE IF NOT EXISTS comercial.respostas_rapidas (
  id         serial PRIMARY KEY,
  atalho     text NOT NULL,
  texto      text NOT NULL,
  criado_em  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO comercial.respostas_rapidas (atalho, texto)
SELECT * FROM (VALUES
  ('apresentacao', '{saudacao} Aqui é {remetente} da Tutts. Fazemos entregas de autopeças por motoboy em {cidade}, com motoboy dedicado e prazo garantido.'),
  ('reuniao', 'Que tal uma conversa rápida de 15 minutos para eu entender como vocês entregam hoje? Qual o melhor dia e horário?'),
  ('preco', 'O valor depende do volume e da distância das entregas. Me conta quantas entregas vocês fazem por dia, em média, que eu monto a proposta.'),
  ('obrigado', 'Obrigado pelo retorno! Qualquer coisa, é só me chamar por aqui.')
) AS v(atalho, texto)
WHERE NOT EXISTS (SELECT 1 FROM comercial.respostas_rapidas);
