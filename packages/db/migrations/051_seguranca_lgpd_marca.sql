-- Segurança, LGPD e marca do cliente. Dono: api.
--
--  * Verificação em duas etapas (app autenticador, TOTP) com códigos de recuperação; a organização
--    pode exigir de todo mundo.
--  * Sessões: cada login é uma sessão que a pessoa vê e pode encerrar (outro aparelho, computador
--    emprestado); desativar a pessoa ou encerrar a sessão derruba na hora.
--  * Termos de uso e política de privacidade: quem aceitou qual versão e quando.
--  * Titular que pediu para ser esquecido (LGPD): a empresa sai do CRM da organização e não volta
--    por campanha, importação ou cadastro à mão.
--  * Marca do cliente: nome de exibição, cor e logo no sistema e nos relatórios.

/* ───────────── Duas etapas ───────────── */

ALTER TABLE cadastro.usuarios
  -- Segredo do app autenticador, cifrado pela api.
  ADD COLUMN totp_segredo      text,
  ADD COLUMN totp_ativo        boolean NOT NULL DEFAULT false,
  ADD COLUMN totp_desde        timestamptz,
  -- Hash (sha256) de cada código de recuperação que ainda não foi usado.
  ADD COLUMN totp_recuperacao  text[] NOT NULL DEFAULT '{}',
  ADD COLUMN termos_versao     text,
  ADD COLUMN termos_aceitos_em timestamptz;

ALTER TABLE cadastro.organizacoes
  ADD COLUMN exigir_2fa  boolean NOT NULL DEFAULT false,
  ADD COLUMN marca_nome  text,
  ADD COLUMN marca_cor   text CHECK (marca_cor ~ '^#[0-9a-fA-F]{6}$'),
  ADD COLUMN marca_logo  bytea,
  ADD COLUMN marca_logo_tipo text CHECK (marca_logo_tipo IN ('image/png', 'image/jpeg')),
  ADD COLUMN marca_atualizada_em timestamptz;

/* ───────────── Sessões ───────────── */

CREATE TABLE cadastro.sessoes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id   integer NOT NULL REFERENCES cadastro.usuarios (id) ON DELETE CASCADE,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  ultimo_uso   timestamptz NOT NULL DEFAULT now(),
  expira_em    timestamptz NOT NULL,
  ip           text,
  aparelho     text,
  revogada_em  timestamptz
);
CREATE INDEX sessoes_usuario_idx ON cadastro.sessoes (usuario_id, criado_em DESC);

/* ───────────── LGPD: titular esquecido ───────────── */

CREATE TABLE cadastro.supressoes (
  id              bigserial PRIMARY KEY,
  organizacao_id  integer NOT NULL REFERENCES cadastro.organizacoes (id) ON DELETE CASCADE,
  empresa_id      bigint NOT NULL REFERENCES descoberta.empresas (id) ON DELETE CASCADE,
  motivo          text,
  pedido_por      text,
  -- Hash (sha256) do CNPJ, dos telefones e e-mails do titular: o mesmo contato não volta nem como
  -- empresa "nova" numa importação ou cadastro à mão.
  chaves          text[] NOT NULL DEFAULT '{}',
  criado_em       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organizacao_id, empresa_id)
);

-- A empresa esquecida não volta para nenhuma unidade da organização: nem por campanha, nem por
-- importação, nem à mão (o vínculo novo é ignorado em silêncio).
CREATE FUNCTION descoberta.barrar_suprimida() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM cadastro.supressoes s JOIN cadastro.contas c ON c.organizacao_id = s.organizacao_id
              WHERE c.id = NEW.conta_id AND s.empresa_id = NEW.empresa_id) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER campanha_empresas_suprimida BEFORE INSERT ON descoberta.campanha_empresas
  FOR EACH ROW EXECUTE FUNCTION descoberta.barrar_suprimida();
CREATE TRIGGER oportunidades_suprimida BEFORE INSERT ON comercial.oportunidades
  FOR EACH ROW EXECUTE FUNCTION descoberta.barrar_suprimida();
CREATE INDEX supressoes_chaves_idx ON cadastro.supressoes USING gin (chaves);
