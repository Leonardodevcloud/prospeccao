-- v110: revisão de segurança.
-- Tentativas erradas de login e do código das duas etapas por pessoa (além do limite por endereço):
-- a cada 5 erros seguidos, o acesso fica travado por um tempo que cresce. Acertar zera.
ALTER TABLE cadastro.usuarios
  ADD COLUMN falhas_login   integer NOT NULL DEFAULT 0,
  ADD COLUMN bloqueado_ate  timestamptz,
  -- O último passo (30 s) do código do app já usado: o mesmo código não vale duas vezes.
  ADD COLUMN totp_ultimo_passo bigint;

-- O banco passa a guardar só o hash dos links de convite (como já era com o de senha nova).
-- Os links já enviados continuam valendo: o hash do token antigo fica no lugar dele.
UPDATE cadastro.usuarios
   SET convite_token = encode(sha256(convert_to(convite_token, 'UTF8')), 'hex')
 WHERE convite_token IS NOT NULL;

-- Tokens novos da agenda e do webhook do WhatsApp com sorteio criptográfico (os atuais seguem valendo).
ALTER TABLE cadastro.usuarios
  ALTER COLUMN agenda_token SET DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
ALTER TABLE comercial.config_agente
  ALTER COLUMN webhook_token SET DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

-- "Número errado" e "não é quem decide" passam a ser de cada conta: a marcação de uma conta não
-- some com o número (nem aparece como "marcado por você") na outra que tem a mesma empresa.
ALTER TABLE comercial.feedback ADD COLUMN conta_id integer REFERENCES cadastro.contas (id) ON DELETE CASCADE;
ALTER TABLE comercial.feedback DROP CONSTRAINT IF EXISTS feedback_empresa_id_tipo_valor_key;
-- Os que já existiam ficam com cada conta que tem a empresa no funil (como cada uma via antes).
INSERT INTO comercial.feedback (conta_id, empresa_id, tipo, valor, canal, fontes, autor, criado_em)
SELECT DISTINCT o.conta_id, f.empresa_id, f.tipo, f.valor, f.canal, f.fontes, f.autor, f.criado_em
  FROM comercial.feedback f JOIN comercial.oportunidades o ON o.empresa_id = f.empresa_id
 WHERE f.conta_id IS NULL;
DELETE FROM comercial.feedback WHERE conta_id IS NULL;
ALTER TABLE comercial.feedback ALTER COLUMN conta_id SET NOT NULL;
CREATE UNIQUE INDEX feedback_conta_unico ON comercial.feedback (conta_id, empresa_id, tipo, valor);
-- O enriquecimento (comum a todas as contas) só respeita a marcação quando todas as contas que têm
-- a empresa no funil concordam: uma conta sozinha não estraga o contato das outras.
CREATE OR REPLACE VIEW comercial.v_feedback AS
SELECT f.empresa_id, f.tipo, f.valor, min(f.canal) AS canal
  FROM comercial.feedback f
 GROUP BY f.empresa_id, f.tipo, f.valor
HAVING count(DISTINCT f.conta_id) >= (SELECT count(DISTINCT o.conta_id) FROM comercial.oportunidades o
                                       WHERE o.empresa_id = f.empresa_id);
