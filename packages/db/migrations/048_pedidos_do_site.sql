-- Pedidos de demonstração que chegam pelo formulário do site institucional. Dono: api.
-- Cada pedido também vira lead no funil da conta principal (a do master); aqui fica o registro
-- de tudo o que chegou, mesmo quando o lead não pôde ser criado.
CREATE TABLE cadastro.pedidos_site (
  id          bigserial PRIMARY KEY,
  nome        text NOT NULL,
  empresa     text NOT NULL,
  whatsapp    text,
  email       text,
  nicho       text,
  plano       text,
  -- Para onde a pessoa seguiu depois de enviar: whatsapp, email ou só o formulário.
  canal       text NOT NULL DEFAULT 'formulario' CHECK (canal IN ('whatsapp', 'email', 'formulario')),
  empresa_id  bigint REFERENCES descoberta.empresas (id) ON DELETE SET NULL,
  status      text NOT NULL DEFAULT 'novo' CHECK (status IN ('novo', 'atendido', 'descartado')),
  erro_lead   text,
  ip_hash     text,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pedidos_site_criado_idx ON cadastro.pedidos_site (criado_em DESC);

-- Contato comercial que o site mostra (WhatsApp com DDI e DDD, e-mail). Uma linha só.
CREATE TABLE cadastro.config_site (
  id             integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  whatsapp       text CHECK (whatsapp ~ '^[0-9]{12,13}$'),
  email          text,
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  atualizado_por integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL
);
INSERT INTO cadastro.config_site (id) VALUES (1) ON CONFLICT DO NOTHING;
