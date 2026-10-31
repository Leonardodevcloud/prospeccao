-- Teste grátis de 7 dias pelo site e assinatura sozinho (cobranças avulsas no Asaas, sem recorrência).
--
--  * Cadastro do teste: confirmado pelo e-mail, cria a organização com o plano Time (2 usuários,
--    100 leads, sem módulos) e assinatura = 'teste' até teste_ate.
--  * Assinatura na organização: teste → ativa (pagou o mês) → atrasada (venceu: 3 dias normais) →
--    só leitura até pagar. Teste vencido sem assinar: só leitura 15 dias e arquiva. Sem assinatura
--    (null) = contrato combinado à mão pelo master, como antes.
--  * Cada mês, mudança de plano ou pacote de minutos é uma cobrança avulsa no Asaas; a cobrança
--    guarda o que paga (o plano pedido ou os minutos) e vale quando o pagamento cai.
--  * Quadro de vendas do master: etapa "Testando" e o canal "teste".

ALTER TABLE cadastro.organizacoes
  ADD COLUMN assinatura         text CHECK (assinatura IN ('teste', 'ativa', 'atrasada', 'cancelada', 'so_leitura', 'arquivada')),
  ADD COLUMN teste_ate          timestamptz,
  -- Pago até (o mês que vale).
  ADD COLUMN acesso_ate         timestamptz,
  ADD COLUMN so_leitura_desde   timestamptz,
  -- O plano pago que está valendo (plano, usuários, módulos e o valor do mês): a renovação repete.
  ADD COLUMN assinatura_contrato jsonb,
  -- Mudança para menos marcada para a próxima renovação.
  ADD COLUMN assinatura_proximo jsonb,
  ADD COLUMN assinatura_valor   numeric(12, 2),
  -- Desligado: não gera a cobrança do mês seguinte (o acesso vai até acesso_ate).
  ADD COLUMN renovar            boolean NOT NULL DEFAULT true,
  ADD COLUMN asaas_cliente      text,
  ADD COLUMN cobranca_documento text,
  ADD COLUMN cobranca_nome      text,
  ADD COLUMN cobranca_email     text,
  -- Minutos de ligação comprados em pacote que ainda sobram (não vencem) e o mês a que o saldo se refere.
  ADD COLUMN minutos_saldo      integer NOT NULL DEFAULT 0,
  ADD COLUMN minutos_saldo_mes  text,
  -- Avisos já mandados ('d5', 'd6', 'fim', 'arquivar', 'v7:2026-11-30'…).
  ADD COLUMN avisos_assinatura  text[] NOT NULL DEFAULT '{}';
CREATE INDEX organizacoes_assinatura_idx ON cadastro.organizacoes (assinatura) WHERE assinatura IS NOT NULL;

CREATE TABLE cadastro.cadastros_teste (
  id              bigserial PRIMARY KEY,
  nome            text NOT NULL,
  empresa         text NOT NULL,
  email           text NOT NULL,
  whatsapp        text NOT NULL,
  cnpj            text,
  senha_hash      text NOT NULL,
  -- Hash do link de confirmação (o link vale 48 h e uma vez só).
  token_hash      text NOT NULL UNIQUE,
  ip_hash         text,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  expira_em       timestamptz NOT NULL,
  confirmado_em   timestamptz,
  organizacao_id  integer REFERENCES cadastro.organizacoes (id) ON DELETE SET NULL,
  conta_id        integer REFERENCES cadastro.contas (id) ON DELETE SET NULL,
  pedido_id       bigint REFERENCES cadastro.pedidos_site (id) ON DELETE SET NULL
);
CREATE INDEX cadastros_teste_email_idx ON cadastro.cadastros_teste (lower(email));
CREATE INDEX cadastros_teste_whatsapp_idx ON cadastro.cadastros_teste (whatsapp);
CREATE INDEX cadastros_teste_cnpj_idx ON cadastro.cadastros_teste (cnpj) WHERE cnpj IS NOT NULL;
CREATE INDEX cadastros_teste_ip_idx ON cadastro.cadastros_teste (ip_hash, criado_em);

CREATE TABLE cadastro.cobrancas (
  id                bigserial PRIMARY KEY,
  organizacao_id    integer NOT NULL REFERENCES cadastro.organizacoes (id) ON DELETE CASCADE,
  asaas_id          text NOT NULL UNIQUE,
  tipo              text NOT NULL DEFAULT 'mensalidade' CHECK (tipo IN ('mensalidade', 'diferenca', 'minutos')),
  -- Mensalidade e mudança de plano: o plano que passa a valer quando pagar.
  pedido            jsonb,
  -- Pacote de minutos: quantos minutos entram no saldo quando pagar.
  minutos           integer,
  -- Mensalidade de renovação: o mês que ela paga começa aqui (null = começa quando pagar).
  periodo_de        date,
  descricao         text,
  valor             numeric(12, 2) NOT NULL,
  vencimento        date NOT NULL,
  situacao          text NOT NULL DEFAULT 'pendente'
                    CHECK (situacao IN ('pendente', 'paga', 'atrasada', 'cancelada', 'estornada')),
  forma             text,
  -- Página segura do Asaas (boleto, cartão e Pix).
  link              text,
  pago_em           timestamptz,
  criado_em         timestamptz NOT NULL DEFAULT now(),
  atualizado_em     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cobrancas_org_idx ON cadastro.cobrancas (organizacao_id, vencimento DESC);
CREATE INDEX cobrancas_abertas_idx ON cadastro.cobrancas (organizacao_id) WHERE situacao IN ('pendente', 'atrasada');

-- Avisos do Asaas já tratados (o Asaas pode mandar o mesmo de novo).
CREATE TABLE cadastro.asaas_eventos (
  id            text PRIMARY KEY,
  tipo          text NOT NULL,
  corpo         jsonb NOT NULL,
  recebido_em   timestamptz NOT NULL DEFAULT now(),
  erro          text
);

ALTER TABLE cadastro.pedidos_site DROP CONSTRAINT pedidos_site_etapa_check;
ALTER TABLE cadastro.pedidos_site ADD CONSTRAINT pedidos_site_etapa_check
  CHECK (etapa IN ('novo', 'contato', 'demonstracao', 'teste', 'proposta', 'cliente', 'perdido'));
ALTER TABLE cadastro.pedidos_site DROP CONSTRAINT pedidos_site_canal_check;
ALTER TABLE cadastro.pedidos_site ADD CONSTRAINT pedidos_site_canal_check
  CHECK (canal IN ('whatsapp', 'email', 'formulario', 'teste'));

-- Módulo Ligações: R$ 499 com 2.000 minutos (antes R$ 890). Só troca se a tabela salva ainda tem o
-- preço antigo. O pacote de minutos (+500 por R$ 149) entra pela tabela padrão.
UPDATE cadastro.tabela_precos
   SET dados = jsonb_set(dados, '{modulos,ligacoes}', '499'::jsonb), atualizado_em = now()
 WHERE id = 1 AND dados #>> '{modulos,ligacoes}' = '890';
