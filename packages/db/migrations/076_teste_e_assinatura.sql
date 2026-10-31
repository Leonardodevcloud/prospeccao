-- Teste grátis de 7 dias pelo site e assinatura sozinho (cobrança recorrente no Asaas).
--
--  * Cadastro do teste: confirmado pelo e-mail, cria a organização com o plano Time (2 usuários,
--    100 leads, sem módulos) e assinatura = 'teste' até teste_ate.
--  * Assinatura na organização: teste → ativa (pagou) → atrasada → só leitura → arquivada. Sem
--    assinatura (null) = contrato combinado à mão pelo master, como antes.
--  * Cobranças do Asaas (para o histórico na tela) e os avisos do Asaas já processados.
--  * Quadro de vendas do master: etapa "Testando" e o canal "teste".

ALTER TABLE cadastro.organizacoes
  ADD COLUMN assinatura         text CHECK (assinatura IN ('teste', 'ativa', 'atrasada', 'cancelada', 'so_leitura', 'arquivada')),
  ADD COLUMN teste_ate          timestamptz,
  -- Pago até (cancelada: o acesso vai até aqui).
  ADD COLUMN acesso_ate         timestamptz,
  ADD COLUMN so_leitura_desde   timestamptz,
  -- O que foi pedido ao assinar (plano, usuários, módulos): vale quando o 1º pagamento cair.
  ADD COLUMN assinatura_pedido  jsonb,
  ADD COLUMN assinatura_valor   numeric(12, 2),
  ADD COLUMN assinatura_forma   text CHECK (assinatura_forma IN ('PIX', 'BOLETO', 'CREDIT_CARD')),
  ADD COLUMN asaas_cliente      text,
  ADD COLUMN asaas_assinatura   text,
  ADD COLUMN cobranca_documento text,
  ADD COLUMN cobranca_nome      text,
  ADD COLUMN cobranca_email     text,
  -- Avisos do teste já mandados ('d5', 'd6', 'fim', 'arquivar').
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
  asaas_assinatura  text,
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
