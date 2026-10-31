-- v98: completa a 076 em quem aplicou a 1ª versão dela (cobrança recorrente no Asaas): a 076 mudou
-- depois (cobrança avulsa por mês, pacotes de minutos, Ligações a R$ 499). Em quem já tem a 076
-- nova, não muda nada (tudo é "se ainda não existe").
SET LOCAL lock_timeout = '30s';

ALTER TABLE cadastro.organizacoes
  -- O plano pago que está valendo (plano, usuários, módulos e o valor do mês): a renovação repete.
  ADD COLUMN IF NOT EXISTS assinatura_contrato jsonb,
  -- Mudança para menos marcada para a próxima renovação.
  ADD COLUMN IF NOT EXISTS assinatura_proximo jsonb,
  -- Desligado: não gera a cobrança do mês seguinte (o acesso vai até acesso_ate).
  ADD COLUMN IF NOT EXISTS renovar boolean NOT NULL DEFAULT true,
  -- Minutos de ligação comprados em pacote que ainda sobram (não vencem) e o mês a que o saldo se refere.
  ADD COLUMN IF NOT EXISTS minutos_saldo integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS minutos_saldo_mes text,
  -- Da cobrança recorrente (saiu).
  DROP COLUMN IF EXISTS assinatura_pedido,
  DROP COLUMN IF EXISTS assinatura_forma,
  DROP COLUMN IF EXISTS asaas_assinatura;

ALTER TABLE cadastro.cobrancas
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'mensalidade'
    CHECK (tipo IN ('mensalidade', 'diferenca', 'minutos')),
  -- Mensalidade e mudança de plano: o plano que passa a valer quando pagar.
  ADD COLUMN IF NOT EXISTS pedido jsonb,
  -- Pacote de minutos: quantos minutos entram no saldo quando pagar.
  ADD COLUMN IF NOT EXISTS minutos integer,
  -- Mensalidade de renovação: o mês que ela paga começa aqui (null = começa quando pagar).
  ADD COLUMN IF NOT EXISTS periodo_de date,
  DROP COLUMN IF EXISTS asaas_assinatura;
CREATE INDEX IF NOT EXISTS cobrancas_abertas_idx ON cadastro.cobrancas (organizacao_id)
  WHERE situacao IN ('pendente', 'atrasada');

-- Módulo Ligações: R$ 499 com 2.000 minutos (antes R$ 890), se a tabela salva ainda tem o antigo.
UPDATE cadastro.tabela_precos
   SET dados = jsonb_set(dados, '{modulos,ligacoes}', '499'::jsonb), atualizado_em = now()
 WHERE id = 1 AND dados #>> '{modulos,ligacoes}' = '890';
