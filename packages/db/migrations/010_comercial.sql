-- Funil comercial: o que foi feito com cada lead. Dono: api.
--
-- Uma oportunidade por EMPRESA (não por campanha): a mesma loja achada por duas campanhas,
-- ou de novo numa nova rodada, continua sendo um card só, com todo o histórico.

CREATE SCHEMA IF NOT EXISTS comercial;

CREATE TABLE comercial.oportunidades (
  empresa_id        bigint PRIMARY KEY,                 -- descoberta.empresas.id
  campanha_id       bigint,                             -- campanha de onde veio (cadastro.campanhas.id)
  etapa             text NOT NULL DEFAULT 'a_abordar'
                    CHECK (etapa IN ('a_abordar', 'abordado', 'respondeu', 'reuniao', 'proposta',
                                     'ganho', 'perdido', 'descartado')),
  posicao           double precision NOT NULL DEFAULT 0, -- ordem dentro da coluna (menor = em cima)
  motivo            text,                               -- de perda ou de descarte
  valor_mensal      numeric(12, 2),                     -- potencial em R$/mês
  proxima_acao      text,
  proxima_acao_em   timestamptz,
  ultimo_contato_em timestamptz,
  etapa_desde       timestamptz NOT NULL DEFAULT now(),
  -- Nota do lead quando entrou no funil: o relatório compara nota x resultado.
  faixa_entrada     text,
  score_entrada     integer,
  criado_em         timestamptz NOT NULL DEFAULT now(),
  atualizado_em     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oportunidades_etapa_idx ON comercial.oportunidades (etapa, posicao);
CREATE INDEX oportunidades_acao_idx ON comercial.oportunidades (proxima_acao_em)
  WHERE proxima_acao_em IS NOT NULL;
CREATE TRIGGER oportunidades_atualizado BEFORE UPDATE ON comercial.oportunidades
  FOR EACH ROW EXECUTE FUNCTION public.tocar_atualizado_em();

-- Tudo que aconteceu com o lead: contatos feitos e recebidos, notas e mudanças de etapa.
CREATE TABLE comercial.atividades (
  id          bigserial PRIMARY KEY,
  empresa_id  bigint NOT NULL REFERENCES comercial.oportunidades (empresa_id) ON DELETE CASCADE,
  tipo        text NOT NULL CHECK (tipo IN ('whatsapp', 'ligacao', 'email', 'visita', 'reuniao', 'nota', 'etapa')),
  direcao     text CHECK (direcao IN ('enviada', 'recebida')),
  texto       text,
  contato     text,                                     -- número ou e-mail usado
  de_etapa    text,
  para_etapa  text,
  autor       text,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX atividades_empresa_idx ON comercial.atividades (empresa_id, criado_em DESC);
CREATE INDEX atividades_data_idx ON comercial.atividades (criado_em);

-- comercial → worker-descoberta: empresas que não devem gastar enriquecimento de novo.
CREATE VIEW comercial.v_empresas_descartadas AS
SELECT empresa_id FROM comercial.oportunidades WHERE etapa = 'descartado';
