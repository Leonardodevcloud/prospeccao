-- Carrosséis com IA, etapa 2: o cérebro da marca, o que divulgar no mês, os pedidos ao time de IA
-- (a fila com o andamento de cada um) e o consumo do Claude por conta.

-- O dossiê da marca: rascunho montado pela IA, corrigido e conferido pelo administrador.
CREATE TABLE comercial.carrossel_cerebro (
  conta_id       integer PRIMARY KEY REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  dados          jsonb NOT NULL DEFAULT '{}',
  -- De onde veio o último rascunho (quantos itens de cada fonte foram lidos).
  fontes         jsonb NOT NULL DEFAULT '[]',
  gerado_em      timestamptz,
  -- Só o dossiê conferido vale para o time; mudou depois de conferir, precisa conferir de novo.
  conferido_em   timestamptz,
  conferido_por  integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);

-- O que divulgar: promoções (preço e prazo saem exatamente como digitados), lançamentos, datas.
CREATE TABLE comercial.carrossel_divulgar (
  id          serial PRIMARY KEY,
  conta_id    integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  tipo        text NOT NULL CHECK (tipo IN ('promocao', 'lancamento', 'campanha', 'data', 'novidade')),
  titulo      text NOT NULL,
  dados       jsonb NOT NULL DEFAULT '{}',
  ate         date,
  arquivado   boolean NOT NULL DEFAULT false,
  criado_por  integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX carrossel_divulgar_conta ON comercial.carrossel_divulgar (conta_id, criado_em DESC);

-- Pedidos ao time de IA: um carrossel ou o rascunho do cérebro da marca. A api trabalha um por vez
-- em cada vaga (fila → trabalhando → pronto/falhou) e a tela acompanha a etapa.
CREATE TABLE comercial.carrossel_pedidos (
  id             serial PRIMARY KEY,
  conta_id       integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  tipo           text NOT NULL CHECK (tipo IN ('carrossel', 'dossie')),
  entrada        jsonb NOT NULL DEFAULT '{}',
  situacao       text NOT NULL DEFAULT 'fila'
                 CHECK (situacao IN ('fila', 'trabalhando', 'pronto', 'falhou', 'cancelado')),
  etapa          text,
  detalhes       jsonb NOT NULL DEFAULT '{}',
  carrossel_id   integer REFERENCES comercial.carrosseis (id) ON DELETE SET NULL,
  erro           text,
  tentativas     integer NOT NULL DEFAULT 0,
  tokens_entrada integer NOT NULL DEFAULT 0,
  tokens_saida   integer NOT NULL DEFAULT 0,
  custo_usd      numeric(12, 6) NOT NULL DEFAULT 0,
  criado_por     integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  iniciado_em    timestamptz,
  concluido_em   timestamptz
);
CREATE INDEX carrossel_pedidos_fila ON comercial.carrossel_pedidos (id) WHERE situacao IN ('fila', 'trabalhando');
CREATE INDEX carrossel_pedidos_conta ON comercial.carrossel_pedidos (conta_id, criado_em DESC);

-- O relatório do time junto do carrossel (ângulo, ganchos, notas do revisor e os avisos para decidir).
ALTER TABLE comercial.carrosseis ADD COLUMN relatorio jsonb;
ALTER TABLE comercial.carrosseis ADD COLUMN divulgar_id integer REFERENCES comercial.carrossel_divulgar (id) ON DELETE SET NULL;

-- Consumo do Claude por conta e dia (o custo em dólar vai calculado com o preço do modelo usado).
CREATE TABLE cadastro.consumo_carrosseis (
  conta_id       integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  dia            date NOT NULL,
  chamadas       integer NOT NULL DEFAULT 0,
  tokens_entrada bigint NOT NULL DEFAULT 0,
  tokens_saida   bigint NOT NULL DEFAULT 0,
  cache_escrita  bigint NOT NULL DEFAULT 0,
  cache_leitura  bigint NOT NULL DEFAULT 0,
  erros          integer NOT NULL DEFAULT 0,
  custo_usd      numeric(12, 6) NOT NULL DEFAULT 0,
  PRIMARY KEY (conta_id, dia)
);

-- Quem começou a usar antes desta etapa: o "como a empresa fala" da identidade visual vira o
-- começo do dossiê (ainda não conferido).
INSERT INTO comercial.carrossel_cerebro (conta_id, dados)
SELECT conta_id,
       jsonb_strip_nulls(jsonb_build_object(
         'publico', nullif(dados->>'publico', ''),
         'tom', nullif(dados->>'tom', ''),
         'oQueVende', nullif(dados->>'vende', ''),
         'pilares', CASE WHEN jsonb_typeof(dados->'pilares') = 'array' THEN dados->'pilares' END,
         'nuncaDizer', CASE WHEN nullif(dados->>'nuncaDizer', '') IS NOT NULL
                            THEN to_jsonb(array_remove(regexp_split_to_array(dados->>'nuncaDizer', E'\\s*\\n\\s*'), ''))
                       END
       ))
  FROM comercial.carrossel_identidade
ON CONFLICT (conta_id) DO NOTHING;
