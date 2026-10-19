-- Prova de que a pessoa citada no site é da equipe (trecho com nome e cargo).
ALTER TABLE enriquecimento.pessoas ADD COLUMN evidencia text;

-- Limpa nomes do site gravados antes da conferência (depoimentos de clientes viravam "decisor"):
-- pessoa só do site, sem cargo e sem contato próprio sai; quem sobrou sem prova perde o "decisor".
DELETE FROM enriquecimento.pessoas p
 WHERE p.fontes = '{site}' AND p.cargo IS NULL
   AND NOT EXISTS (SELECT 1 FROM enriquecimento.contatos c WHERE c.pessoa_id = p.id);
UPDATE enriquecimento.pessoas SET decisor = false
 WHERE decisor AND fontes = '{site}' AND papel = 'outro';
