-- Contatos já salvos: visto em duas ou mais fontes independentes vira "Confirmado" (Maps e Places
-- são o mesmo perfil do Google; a IA não conta), e e-mails de exemplo saem.
UPDATE enriquecimento.contatos c
   SET status = 'verificado'
 WHERE c.status = 'nao_verificado'
   AND (SELECT count(DISTINCT CASE WHEN f = 'places' THEN 'maps' ELSE f END)
          FROM unnest(c.fontes || c.fonte) AS f
         WHERE f <> 'ia') >= 2;

UPDATE enriquecimento.contatos SET status = 'verificado'
 WHERE status = 'nao_verificado'
   AND ((canal = 'site' AND fonte = 'site') OR (canal = 'instagram' AND fonte = 'instagram'));

DELETE FROM enriquecimento.contatos
 WHERE canal = 'email'
   AND valor ~* '^(exemplo|example|seuemail|seu\.email|seu-email|email|teste|test|usuario|fulano|name|user|nome|seu|your)@';
