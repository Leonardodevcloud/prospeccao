-- O que é lead da conta e o enriquecimento honesto. Donos: worker-descoberta (campanha_empresas) e
-- worker-enriquecimento (leads).
--
-- 1) A busca liga à campanha muitas empresas candidatas (todas as do nicho na base da Receita, por
--    exemplo). Lead de verdade (o que o cliente vê e conta na meta do plano) é só o que foi liberado:
--    mandado para o enriquecimento dentro da meta, importado, cadastrado à mão ou posto no funil.
--    liberado_em marca isso; o resto é estoque da busca e não aparece.
ALTER TABLE descoberta.campanha_empresas ADD COLUMN liberado_em timestamptz;

UPDATE descoberta.campanha_empresas ce
   SET liberado_em = coalesce(ce.enriquecimento_solicitado_em, ce.adicionada_em)
 WHERE ce.enriquecimento_solicitado_em IS NOT NULL
    OR ce.origem IN ('importacao', 'manual')
    OR EXISTS (SELECT 1 FROM comercial.oportunidades o WHERE o.conta_id = ce.conta_id AND o.empresa_id = ce.empresa_id);

CREATE INDEX campanha_empresas_liberadas_idx ON descoberta.campanha_empresas (conta_id, empresa_id)
  WHERE liberado_em IS NOT NULL;

-- Mandou para o enriquecimento, importou ou cadastrou: liberado.
CREATE FUNCTION descoberta.liberar_lead() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.liberado_em IS NULL
     AND (NEW.enriquecimento_solicitado_em IS NOT NULL OR NEW.origem IN ('importacao', 'manual')) THEN
    NEW.liberado_em := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER liberar_lead BEFORE INSERT OR UPDATE ON descoberta.campanha_empresas
  FOR EACH ROW EXECUTE FUNCTION descoberta.liberar_lead();

-- Entrou no funil: é lead da conta (em todas as campanhas dela em que a empresa está).
CREATE FUNCTION comercial.liberar_lead_do_funil() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE descoberta.campanha_empresas SET liberado_em = now()
   WHERE conta_id = NEW.conta_id AND empresa_id = NEW.empresa_id AND liberado_em IS NULL;
  RETURN NEW;
END $$;
CREATE TRIGGER liberar_lead_do_funil AFTER INSERT ON comercial.oportunidades
  FOR EACH ROW EXECUTE FUNCTION comercial.liberar_lead_do_funil();

-- 2) Fontes que não responderam na última rodada do enriquecimento (Instagram sem crédito, Receita
--    fora do ar…). O lead fica "em parte" e o que já tinha não se perde.
ALTER TABLE enriquecimento.leads ADD COLUMN pendencias text[] NOT NULL DEFAULT '{}';
