-- MEI nem entra na campanha (não só fica escondido).
--
-- 1. A Receita escreve a razão social do MEI de dois jeitos: "NOME 12345678901" (CPF no fim, antigo)
--    e "12.345.678 NOME" (raiz do CNPJ no começo, atual). A dedução agora pega os dois.
UPDATE base_cnpj.empresas
   SET mei = true, mei_fonte = 'nome'
 WHERE coalesce(mei_fonte, '') <> 'simples'
   AND natureza_juridica = '2135'
   AND (razao_social ~ '\d{11}\s*$' OR razao_social ~ '^\d{2}\.\d{3}\.\d{3}\s');

UPDATE descoberta.empresas d SET mei = true
  FROM base_cnpj.empresas b
 WHERE b.cnpj_basico = d.cnpj_basico AND b.mei AND NOT d.mei;

-- 2. Tira os MEI das campanhas cujo nicho exclui MEI (quem já está no funil fica).
DELETE FROM descoberta.campanha_empresas ce
 USING descoberta.empresas e, cadastro.campanhas c, cadastro.nichos n
 WHERE e.id = ce.empresa_id AND c.id = ce.campanha_id AND n.id = c.nicho_id
   AND e.mei AND n.excluir_mei
   AND NOT EXISTS (SELECT 1 FROM comercial.oportunidades o WHERE o.empresa_id = e.id);

-- 3. Pedidos de enriquecimento desses MEI que ainda estavam na fila saem (se a fila já existe).
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
