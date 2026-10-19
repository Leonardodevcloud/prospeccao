-- Limpa perfis do LinkedIn ligados só pelo nome (homônimos), gravados antes da conferência
-- "o perfil cita esta empresa". O próximo enriquecimento só religa o que for comprovado.

-- 1. Sócio da Receita com LinkedIn achado só por nome igual: tira o perfil, mantém o sócio.
DELETE FROM enriquecimento.contatos c
 USING enriquecimento.pessoas p
 WHERE c.pessoa_id = p.id AND c.canal = 'linkedin'
   AND 'receita' = ANY(p.fontes) AND 'linkedin' = ANY(p.fontes);
UPDATE enriquecimento.pessoas
   SET linkedin_url = NULL, fontes = array_remove(fontes, 'linkedin')
 WHERE 'receita' = ANY(fontes) AND 'linkedin' = ANY(fontes);

-- 2. Pessoas que vieram só do LinkedIn sem a conferência do emprego atual: saem.
DELETE FROM enriquecimento.contatos c
 USING enriquecimento.pessoas p
 WHERE c.pessoa_id = p.id AND c.canal = 'linkedin' AND p.fontes = '{linkedin}';
DELETE FROM enriquecimento.pessoas WHERE fontes = '{linkedin}';

-- 3. Empresa que ficou sem decisor: volta para o sócio-administrador da Receita, se houver.
UPDATE enriquecimento.pessoas p SET decisor = true
  FROM (
    SELECT DISTINCT ON (empresa_id) id
      FROM enriquecimento.pessoas
     WHERE 'receita' = ANY(fontes)
       AND (cargo ILIKE '%administrador%' OR cargo ILIKE '%presidente%' OR cargo ILIKE '%diretor%'
            OR cargo ILIKE '%titular%')
       AND empresa_id NOT IN (SELECT empresa_id FROM enriquecimento.pessoas WHERE decisor)
     ORDER BY empresa_id, prioridade, id
  ) x
 WHERE p.id = x.id;
