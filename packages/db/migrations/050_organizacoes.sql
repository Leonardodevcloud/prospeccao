-- Organizações e unidades. Dono: api.
--
-- Até aqui cada cliente era uma conta. Agora o cliente é a ORGANIZAÇÃO (o contrato: plano,
-- usuários, leads por mês, módulos, mensalidade) e cada conta vira uma UNIDADE dela (regional,
-- filial ou time, com funil, campanhas, WhatsApp e equipe próprios). Cliente pequeno é uma
-- organização com uma unidade só: para ele nada muda.
--
--  * Contrato na organização: os números valem somados para todas as unidades. A organização pode
--    dar uma cota de leads do mês para cada unidade (o resto fica livre para quem usar primeiro).
--  * Papéis novos: gestor (vê e administra todas as unidades da organização) e leitura (diretoria:
--    vê tudo, não muda nada).
--  * Uma empresa é de uma unidade só: a mesma organização não aborda a mesma empresa duas vezes.

/* ───────────── Organizações ───────────── */

CREATE TABLE cadastro.organizacoes (
  id                 serial PRIMARY KEY,
  nome               text NOT NULL,
  ativa              boolean NOT NULL DEFAULT true,
  observacoes        text,
  plano              text CHECK (plano IN ('start', 'time', 'escala', 'personalizado')),
  limite_usuarios    integer CHECK (limite_usuarios >= 1),
  limite_leads_mes   integer CHECK (limite_leads_mes >= 0),
  modulos            text[] NOT NULL DEFAULT '{}',
  mensalidade_manual numeric(10, 2) CHECK (mensalidade_manual >= 0),
  plano_desde        date,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  desativada_em      timestamptz
);
CREATE UNIQUE INDEX organizacoes_nome_idx ON cadastro.organizacoes (lower(nome));

ALTER TABLE cadastro.contas
  ADD COLUMN organizacao_id integer REFERENCES cadastro.organizacoes (id),
  -- Parte da cota de leads do mês da organização reservada para esta unidade (null = sem cota
  -- própria: usa o que sobrar da organização).
  ADD COLUMN cota_leads_mes integer CHECK (cota_leads_mes >= 0);

-- Cada conta que existe vira uma organização com ela de unidade única, levando o contrato junto.
DO $$
DECLARE c record; o integer;
BEGIN
  FOR c IN SELECT * FROM cadastro.contas ORDER BY id LOOP
    INSERT INTO cadastro.organizacoes (nome, ativa, observacoes, plano, limite_usuarios, limite_leads_mes,
                                       modulos, mensalidade_manual, plano_desde, criado_em, desativada_em)
    VALUES (c.nome, c.ativa, c.observacoes, c.plano, c.limite_usuarios, c.limite_leads_mes,
            c.modulos, c.mensalidade_manual, c.plano_desde, c.criado_em, c.desativada_em)
    RETURNING id INTO o;
    UPDATE cadastro.contas SET organizacao_id = o WHERE id = c.id;
  END LOOP;
END $$;

ALTER TABLE cadastro.contas ALTER COLUMN organizacao_id SET NOT NULL;

-- Conta criada sem organização (caminhos antigos, testes): ganha uma organização própria com o
-- mesmo nome, como as que já existiam.
CREATE FUNCTION cadastro.organizacao_da_conta_nova() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organizacao_id IS NULL THEN
    INSERT INTO cadastro.organizacoes (nome)
    VALUES (CASE WHEN EXISTS (SELECT 1 FROM cadastro.organizacoes WHERE lower(nome) = lower(NEW.nome))
                 THEN NEW.nome || ' (' || substr(md5(random()::text), 1, 4) || ')' ELSE NEW.nome END)
    RETURNING id INTO NEW.organizacao_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contas_organizacao BEFORE INSERT ON cadastro.contas
  FOR EACH ROW EXECUTE FUNCTION cadastro.organizacao_da_conta_nova();
CREATE INDEX contas_organizacao_idx ON cadastro.contas (organizacao_id);

-- O contrato agora mora na organização.
ALTER TABLE cadastro.contas
  DROP COLUMN plano,
  DROP COLUMN limite_usuarios,
  DROP COLUMN limite_leads_mes,
  DROP COLUMN modulos,
  DROP COLUMN mensalidade_manual,
  DROP COLUMN plano_desde;

-- Nome da unidade é único dentro da organização (duas organizações podem ter "Bahia").
DROP INDEX cadastro.contas_nome_idx;
CREATE UNIQUE INDEX contas_nome_idx ON cadastro.contas (organizacao_id, lower(nome));

-- Desativar a organização tira o acesso de todas as unidades dela.
CREATE FUNCTION cadastro.marcar_organizacao_desativada() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ativa IS DISTINCT FROM OLD.ativa THEN
    NEW.desativada_em := CASE WHEN NEW.ativa THEN NULL ELSE now() END;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER organizacoes_desativada BEFORE UPDATE OF ativa ON cadastro.organizacoes
  FOR EACH ROW EXECUTE FUNCTION cadastro.marcar_organizacao_desativada();

/* ───────────── Papéis ───────────── */

ALTER TABLE cadastro.usuarios DROP CONSTRAINT IF EXISTS usuarios_papel_check;
ALTER TABLE cadastro.usuarios
  ADD CONSTRAINT usuarios_papel_check CHECK (papel IN ('admin', 'sdr', 'closer', 'gestor', 'leitura'));

/* ───────────── Uma empresa, uma unidade ───────────── */

-- Unidade da mesma organização que já trabalha a empresa (negociação aberta ou fechada).
CREATE FUNCTION comercial.unidade_dona(p_empresa bigint, p_conta integer)
RETURNS TABLE (conta_id integer, nome text) LANGUAGE sql STABLE AS $$
  SELECT o.conta_id, c.nome
    FROM comercial.oportunidades o
    JOIN cadastro.contas c ON c.id = o.conta_id
   WHERE o.empresa_id = p_empresa AND o.conta_id <> p_conta AND o.etapa <> 'descartado'
     AND c.organizacao_id = (SELECT organizacao_id FROM cadastro.contas WHERE id = p_conta)
   ORDER BY o.criado_em
   LIMIT 1
$$;

-- Garantia no banco: nenhuma unidade abre negociação de empresa que outra unidade da mesma
-- organização já trabalha (a api já filtra antes; isto pega qualquer caminho que escape).
CREATE FUNCTION comercial.travar_lead_de_outra_unidade() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE dona text;
BEGIN
  IF NEW.etapa = 'descartado' THEN RETURN NEW; END IF;
  SELECT u.nome INTO dona FROM comercial.unidade_dona(NEW.empresa_id, NEW.conta_id) u;
  IF dona IS NOT NULL THEN
    RAISE EXCEPTION 'lead_de_outra_unidade:%', dona USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER oportunidades_uma_unidade BEFORE INSERT ON comercial.oportunidades
  FOR EACH ROW EXECUTE FUNCTION comercial.travar_lead_de_outra_unidade();
