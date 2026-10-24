-- Domínio de e-mail do cliente. Dono: api (e-mail).
-- A conta do Resend é da plataforma: o próprio cliente cadastra o domínio dele, vê os registros de
-- DNS, confere e escolhe o remetente. Verificado, a conta envia pelo Resend da plataforma com o
-- remetente do domínio dela (as respostas chegam pelo domínio de respostas da plataforma).
CREATE TABLE cadastro.dominios_email (
  conta_id        integer PRIMARY KEY REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  dominio         text NOT NULL,
  resend_id       text NOT NULL,
  situacao        text NOT NULL DEFAULT 'pendente' CHECK (situacao IN ('pendente', 'verificado', 'falhou')),
  registros       jsonb NOT NULL DEFAULT '[]',
  -- Remetente (ex.: comercial@loja.com.br); o nome que aparece para o lead vem da marca.
  remetente       text,
  conferido_em    timestamptz,
  verificado_em   timestamptz,
  criado_em       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX dominios_email_dominio ON cadastro.dominios_email (lower(dominio));
