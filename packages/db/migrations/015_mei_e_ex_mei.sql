-- MEI e ex-MEI ficam de fora, mesmo quando o Simples já foi lido.
--
-- A leitura do Simples marca só quem é MEI HOJE. Quem saiu do MEI continua com a razão social no
-- formato do MEI ("12.345.678 NOME") e é o mesmo negócio individual pequeno: também não contrata.
-- Antes, a marca do Simples ("não é MEI") impedia a dedução pelo nome; agora vale qualquer uma.
UPDATE base_cnpj.empresas
   SET mei = true, mei_fonte = coalesce(mei_fonte, 'nome')
 WHERE NOT coalesce(mei, false)
   AND (razao_social ~ '^\d{2}\.\d{3}\.\d{3}\s'
        OR (natureza_juridica = '2135' AND razao_social ~ '\d{11}\s*$'));

UPDATE descoberta.empresas d SET mei = true
  FROM base_cnpj.empresas b
 WHERE b.cnpj_basico = d.cnpj_basico AND b.mei AND NOT d.mei;

-- Também pelo nome guardado na descoberta (caso a empresa da base não tenha sido lida ainda).
UPDATE descoberta.empresas
   SET mei = true
 WHERE NOT mei AND (razao_social ~ '^\d{2}\.\d{3}\.\d{3}\s' OR nome ~ '^\d{2}\.\d{3}\.\d{3}\s');

DELETE FROM descoberta.campanha_empresas ce
 USING descoberta.empresas e, cadastro.campanhas c, cadastro.nichos n
 WHERE e.id = ce.empresa_id AND c.id = ce.campanha_id AND n.id = c.nicho_id
   AND e.mei AND n.excluir_mei
   AND NOT EXISTS (SELECT 1 FROM comercial.oportunidades o WHERE o.empresa_id = e.id);

DO $$
BEGIN
  IF to_regclass('fila.job') IS NOT NULL THEN
    DELETE FROM fila.job j
     USING descoberta.empresas e
     WHERE j.name = 'enriquecimento.solicitar' AND j.state IN ('created', 'retry')
       AND (j.data ->> 'empresaId')::bigint = e.id AND e.mei
       AND NOT EXISTS (SELECT 1 FROM descoberta.campanha_empresas ce WHERE ce.empresa_id = e.id);
  END IF;
END $$;
