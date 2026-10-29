-- Painel master separado do CRM. Dono: api.
--
--  * Vendas da plataforma: os pedidos de demonstração do site andam num quadro próprio do master
--    (Novo pedido → Em contato → Demonstração marcada → Proposta → Virou cliente / Perdido) e não
--    entram mais no funil de SDR da conta principal.
--  * Cancelamentos: quando uma conta é desativada (para a receita do mês).
--  * Custos unitários (estimados, editáveis no painel) para comparar custo e mensalidade.

/* ───────────── Vendas da plataforma ───────────── */

ALTER TABLE cadastro.pedidos_site
  ADD COLUMN etapa text NOT NULL DEFAULT 'novo'
    CHECK (etapa IN ('novo', 'contato', 'demonstracao', 'proposta', 'cliente', 'perdido')),
  ADD COLUMN nota text,
  ADD COLUMN motivo_perda text,
  ADD COLUMN demonstracao_em timestamptz,
  ADD COLUMN conta_id integer REFERENCES cadastro.contas (id) ON DELETE SET NULL,
  ADD COLUMN atualizado_em timestamptz NOT NULL DEFAULT now();

UPDATE cadastro.pedidos_site
   SET etapa = CASE status WHEN 'atendido' THEN 'contato' WHEN 'descartado' THEN 'perdido' ELSE 'novo' END;

-- Os pedidos que já tinham virado lead no SDR da conta principal saem de lá (ficam só no quadro de
-- vendas do master). A empresa continua na base; some a negociação e o vínculo com a lista manual.
DELETE FROM comercial.oportunidades o
 USING cadastro.pedidos_site p, cadastro.contas c
 WHERE c.principal AND o.conta_id = c.id AND o.empresa_id = p.empresa_id
   -- Só a negociação que o próprio pedido criou (não apaga lead que já existia antes dele).
   AND o.criado_em >= p.criado_em - interval '1 minute';
DELETE FROM descoberta.campanha_empresas ce
 USING cadastro.pedidos_site p, cadastro.campanhas ca, cadastro.contas c
 WHERE c.principal AND ca.conta_id = c.id AND ca.tipo = 'manual'
   AND ce.campanha_id = ca.id AND ce.empresa_id = p.empresa_id
   AND ce.adicionada_em >= p.criado_em - interval '1 minute'
   AND NOT EXISTS (SELECT 1 FROM comercial.oportunidades o WHERE o.conta_id = c.id AND o.empresa_id = p.empresa_id);

ALTER TABLE cadastro.pedidos_site DROP COLUMN status, DROP COLUMN empresa_id, DROP COLUMN erro_lead;
CREATE INDEX pedidos_site_etapa_idx ON cadastro.pedidos_site (etapa, atualizado_em DESC);

-- Histórico do pedido (mudou de etapa, anotação).
CREATE TABLE cadastro.pedidos_site_historico (
  id          bigserial PRIMARY KEY,
  pedido_id   bigint NOT NULL REFERENCES cadastro.pedidos_site (id) ON DELETE CASCADE,
  texto       text NOT NULL,
  autor       text,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pedidos_site_historico_idx ON cadastro.pedidos_site_historico (pedido_id, criado_em DESC);

/* ───────────── Cancelamentos ───────────── */

ALTER TABLE cadastro.contas ADD COLUMN desativada_em timestamptz;
UPDATE cadastro.contas SET desativada_em = now() WHERE NOT ativa;

CREATE FUNCTION cadastro.marcar_desativada() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ativa IS DISTINCT FROM OLD.ativa THEN
    NEW.desativada_em := CASE WHEN NEW.ativa THEN NULL ELSE now() END;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contas_desativada BEFORE UPDATE OF ativa ON cadastro.contas
  FOR EACH ROW EXECUTE FUNCTION cadastro.marcar_desativada();

/* ───────────── Custos unitários ───────────── */

-- Vazia = os valores de partida do sistema (estimativas). Uma linha só.
CREATE TABLE cadastro.custos_plataforma (
  id             integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  dados          jsonb NOT NULL,
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  atualizado_por integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL
);
