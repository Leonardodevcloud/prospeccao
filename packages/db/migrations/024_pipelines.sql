-- Pipelines (SDR, Closer…) com etapas editáveis. Dono: api (schema comercial).
--
-- Cada etapa tem um "papel" (o comportamento: primeiro contato, aguardando resposta, conversa,
-- reunião, proposta, ganho, perdido). A cadência, a IA e os relatórios continuam usando o papel
-- (oportunidades.etapa); a tela usa a etapa (oportunidades.etapa_id). Várias etapas podem ter o
-- mesmo papel (ex.: "Proposta enviada", "Negociação" e "Contrato enviado" se comportam como
-- proposta). Quando o sistema muda o papel sozinho (lead respondeu, reunião marcada), o lead vai
-- para a primeira etapa com aquele papel no pipeline dele; se o pipeline não tem, passa para o
-- pipeline que tem (é assim que a reunião leva o lead do SDR para o Closer).

CREATE TABLE IF NOT EXISTS comercial.pipelines (
  id         serial PRIMARY KEY,
  nome       text NOT NULL,
  ordem      integer NOT NULL DEFAULT 0,
  criado_em  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS comercial.etapas (
  id           serial PRIMARY KEY,
  pipeline_id  integer NOT NULL REFERENCES comercial.pipelines (id) ON DELETE CASCADE,
  nome         text NOT NULL,
  cor          text NOT NULL DEFAULT '#64748b',
  ordem        integer NOT NULL DEFAULT 0,
  papel        text NOT NULL
               CHECK (papel IN ('a_abordar', 'abordado', 'respondeu', 'reuniao', 'proposta', 'ganho', 'perdido'))
);
CREATE INDEX IF NOT EXISTS etapas_pipeline_idx ON comercial.etapas (pipeline_id, ordem);

DO $$
DECLARE sdr integer; closer integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM comercial.pipelines) THEN
    INSERT INTO comercial.pipelines (nome, ordem) VALUES ('SDR', 1) RETURNING id INTO sdr;
    INSERT INTO comercial.pipelines (nome, ordem) VALUES ('Closer', 2) RETURNING id INTO closer;
    INSERT INTO comercial.etapas (pipeline_id, nome, cor, ordem, papel) VALUES
      (sdr, 'A abordar', '#94a3b8', 1, 'a_abordar'),
      (sdr, 'Abordado', '#3b82f6', 2, 'abordado'),
      (sdr, 'Respondeu', '#14b8a6', 3, 'respondeu'),
      (sdr, 'Perdido', '#ef4444', 4, 'perdido'),
      (closer, 'Reunião agendada', '#3b82f6', 1, 'reuniao'),
      (closer, 'Diagnóstico', '#f59e0b', 2, 'reuniao'),
      (closer, 'Proposta enviada', '#f97316', 3, 'proposta'),
      (closer, 'Negociação', '#e11d48', 4, 'proposta'),
      (closer, 'Contrato enviado', '#8b5cf6', 5, 'proposta'),
      (closer, 'Ganho', '#16a34a', 6, 'ganho'),
      (closer, 'Perdido', '#ef4444', 7, 'perdido');
  END IF;
END $$;

ALTER TABLE comercial.oportunidades
  ADD COLUMN IF NOT EXISTS etapa_id  integer REFERENCES comercial.etapas (id) ON DELETE SET NULL,
  -- Suas etiquetas (Indicação, Farma, +50 entregas…).
  ADD COLUMN IF NOT EXISTS etiquetas text[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS oportunidades_etapa_id_idx ON comercial.oportunidades (etapa_id, posicao);
CREATE INDEX IF NOT EXISTS oportunidades_etiquetas_idx ON comercial.oportunidades USING gin (etiquetas);

-- Histórico com o nome da etapa (várias etapas podem ter o mesmo papel).
ALTER TABLE comercial.atividades
  ADD COLUMN IF NOT EXISTS de_nome   text,
  ADD COLUMN IF NOT EXISTS para_nome text;

-- Leads que já estão no funil: cada um na etapa do seu papel. Perdido depois de reunião ou
-- proposta fica no Closer; perdido antes disso, no SDR.
UPDATE comercial.oportunidades o
   SET etapa_id = (
     SELECT et.id FROM comercial.etapas et JOIN comercial.pipelines p ON p.id = et.pipeline_id
      WHERE et.papel = o.etapa
      ORDER BY CASE WHEN o.etapa = 'perdido' AND EXISTS (
                      SELECT 1 FROM comercial.atividades a
                       WHERE a.empresa_id = o.empresa_id AND a.para_etapa IN ('reuniao', 'proposta'))
                    THEN -p.ordem ELSE p.ordem END,
               et.ordem
      LIMIT 1)
 WHERE o.etapa_id IS NULL AND o.etapa <> 'descartado';
