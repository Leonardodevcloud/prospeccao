-- CRM de demonstração: uma organização separada, com dados fictícios, para apresentar o sistema.
-- Ela não entra no financeiro nem na lista de clientes, e "Recriar os dados" apaga e gera tudo de
-- novo. As empresas fictícias ficam marcadas para nunca se misturarem com as reais (só elas são
-- apagadas ao recriar).

ALTER TABLE cadastro.organizacoes
  ADD COLUMN demonstracao boolean NOT NULL DEFAULT false,
  -- Quando os dados de demonstração foram gerados pela última vez.
  ADD COLUMN demonstracao_gerada_em timestamptz;

-- Só pode haver uma organização de demonstração.
CREATE UNIQUE INDEX organizacoes_uma_demonstracao ON cadastro.organizacoes (demonstracao) WHERE demonstracao;

ALTER TABLE descoberta.empresas
  ADD COLUMN demonstracao boolean NOT NULL DEFAULT false;

CREATE INDEX empresas_demonstracao ON descoberta.empresas (id) WHERE demonstracao;

-- As campanhas do CRM de demonstração nunca buscam empresas de verdade (nem gastam Google Maps).
CREATE OR REPLACE VIEW cadastro.v_campanhas_descoberta AS
 SELECT cp.id,
    cp.nome,
    cp.status,
    cp.cidades,
    (cp.raio_km)::double precision AS raio_km,
    cp.max_por_busca,
    n.id AS nicho_id,
    n.cnaes,
    n.termos_maps,
    n.palavras_positivas,
    n.palavras_negativas,
    n.portes,
    n.idade_minima_anos,
    n.excluir_mei,
    (cp.teto_places_usd)::double precision AS teto_places_usd,
    cp.conta_id,
    cp.limite_leads
   FROM cadastro.campanhas cp
     JOIN cadastro.nichos n ON n.id = cp.nicho_id
  WHERE NOT EXISTS (
    SELECT 1 FROM cadastro.contas c JOIN cadastro.organizacoes o ON o.id = c.organizacao_id
     WHERE c.id = cp.conta_id AND o.demonstracao);
