-- Instagram (v90) entra nos planos a partir do Time: a tabela de preços salva no painel master
-- ganha o recurso no Time e no Escala. Plano personalizado com recursos de equipe também ganha
-- (o master tira no painel, se a negociação for outra).
UPDATE cadastro.tabela_precos
   SET dados = jsonb_set(dados, '{planos,time,recursos}', (dados #> '{planos,time,recursos}') || '"instagram"'),
       atualizado_em = now()
 WHERE id = 1 AND jsonb_typeof(dados #> '{planos,time,recursos}') = 'array'
   AND NOT (dados #> '{planos,time,recursos}') ? 'instagram';

UPDATE cadastro.tabela_precos
   SET dados = jsonb_set(dados, '{planos,escala,recursos}', (dados #> '{planos,escala,recursos}') || '"instagram"'),
       atualizado_em = now()
 WHERE id = 1 AND jsonb_typeof(dados #> '{planos,escala,recursos}') = 'array'
   AND NOT (dados #> '{planos,escala,recursos}') ? 'instagram';

UPDATE cadastro.organizacoes
   SET recursos_extras = array_append(recursos_extras, 'instagram')
 WHERE plano = 'personalizado' AND 'equipe' = ANY (recursos_extras)
   AND NOT 'instagram' = ANY (recursos_extras);
