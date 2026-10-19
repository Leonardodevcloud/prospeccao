-- Contratos de leitura entre domínios. Os workers leem o schema de outro domínio
-- só por estas views; as tabelas podem mudar por dentro desde que a view se
-- mantenha. A API, que é a camada de leitura do web, pode ler tabelas, nunca escrever.

-- cadastro → worker-cnpj: o que importar da Receita.
CREATE VIEW cadastro.v_alvos_importacao AS
SELECT
  coalesce((SELECT array_agg(DISTINCT c ORDER BY c)
              FROM cadastro.nichos n, unnest(n.cnaes) c
             WHERE n.ativo), '{}') AS cnaes,
  coalesce((SELECT array_agg(DISTINCT x ->> 'uf' ORDER BY x ->> 'uf')
              FROM cadastro.campanhas cp, jsonb_array_elements(cp.cidades) x
             WHERE cp.status <> 'encerrada'), '{}') AS ufs;

-- cadastro → worker-descoberta: tudo que a descoberta precisa de uma campanha.
CREATE VIEW cadastro.v_campanhas_descoberta AS
SELECT cp.id,
       cp.nome,
       cp.status,
       cp.cidades,
       cp.raio_km::float8 AS raio_km,
       cp.max_por_busca,
       n.id AS nicho_id,
       n.cnaes,
       n.termos_maps,
       n.palavras_positivas,
       n.palavras_negativas,
       n.portes,
       n.idade_minima_anos
  FROM cadastro.campanhas cp
  JOIN cadastro.nichos n ON n.id = cp.nicho_id;

CREATE VIEW cadastro.v_bases_ativas AS
SELECT id, nome, lat, lng FROM cadastro.bases WHERE ativa;

-- base_cnpj → worker-descoberta: estabelecimentos prontos para virar empresa.
CREATE VIEW base_cnpj.v_estabelecimentos AS
SELECT e.cnpj,
       e.cnpj_basico,
       nullif(btrim(e.nome_fantasia), '') AS nome_fantasia,
       emp.razao_social,
       coalesce(emp.porte, 'nao_informado') AS porte,
       e.situacao,
       e.data_inicio,
       e.cnae_principal,
       e.cnaes_secundarios,
       nullif(btrim(concat_ws(' ', e.tipo_logradouro, e.logradouro)), '') AS logradouro,
       e.numero,
       e.complemento,
       e.bairro,
       e.cep,
       e.uf,
       public.normalizar_cidade(m.nome) AS cidade,
       e.telefones,
       e.email
  FROM base_cnpj.estabelecimentos e
  LEFT JOIN base_cnpj.empresas emp ON emp.cnpj_basico = e.cnpj_basico
  LEFT JOIN base_cnpj.municipios m ON m.codigo = e.municipio_codigo;

-- base_cnpj → api: sócios com a qualificação por extenso. Sócio-administrador primeiro.
CREATE VIEW base_cnpj.v_socios AS
SELECT s.cnpj_basico,
       s.nome,
       s.tipo,
       s.qualificacao_codigo,
       coalesce(q.descricao, 'Qualificação ' || s.qualificacao_codigo) AS qualificacao,
       s.data_entrada,
       s.faixa_etaria,
       CASE
         WHEN s.qualificacao_codigo IN ('49', '05', '16', '65') THEN 1   -- administra a empresa
         WHEN s.qualificacao_codigo = '22' THEN 2                         -- sócio
         ELSE 3
       END AS prioridade
  FROM base_cnpj.socios s
  LEFT JOIN base_cnpj.qualificacoes q ON q.codigo = s.qualificacao_codigo;

CREATE VIEW base_cnpj.v_ultima_importacao AS
SELECT * FROM base_cnpj.importacoes ORDER BY criado_em DESC LIMIT 1;

-- descoberta → api: uma linha por empresa em cada campanha.
CREATE VIEW descoberta.v_empresas_campanha AS
SELECT ce.campanha_id,
       ce.origem,
       ce.dentro_do_raio,
       ce.adicionada_em,
       ce.enriquecimento_solicitado_em,
       e.*
  FROM descoberta.campanha_empresas ce
  JOIN descoberta.empresas e ON e.id = ce.empresa_id;

CREATE VIEW descoberta.v_progresso_campanha AS
SELECT c.campanha_id,
       count(*)                                              AS empresas,
       count(*) FILTER (WHERE e.cnpj IS NOT NULL)            AS com_cnpj,
       count(*) FILTER (WHERE e.place_id IS NOT NULL)        AS no_maps,
       count(*) FILTER (WHERE c.origem = 'maps')             AS so_maps,
       count(*) FILTER (WHERE c.dentro_do_raio)              AS dentro_do_raio,
       count(*) FILTER (WHERE e.lat IS NULL)                 AS sem_localizacao,
       count(*) FILTER (WHERE e.sinal_entrega)               AS com_sinal_entrega
  FROM descoberta.campanha_empresas c
  JOIN descoberta.empresas e ON e.id = c.empresa_id
 GROUP BY c.campanha_id;

CREATE VIEW descoberta.v_buscas_campanha AS
SELECT campanha_id,
       count(*) FILTER (WHERE status = 'pendente')  AS pendentes,
       count(*) FILTER (WHERE status = 'rodando')   AS rodando,
       count(*) FILTER (WHERE status = 'concluida') AS concluidas,
       count(*) FILTER (WHERE status = 'erro')      AS com_erro,
       coalesce(sum(itens), 0)                      AS itens_maps,
       max(concluido_em)                            AS ultima_conclusao
  FROM descoberta.buscas_maps
 GROUP BY campanha_id;
