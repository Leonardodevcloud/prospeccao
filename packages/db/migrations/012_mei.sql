-- MEI: não usa o serviço (não tem volume nem estrutura para contratar entregas).
-- A Receita marca o MEI no arquivo do Simples Nacional; enquanto ele não é lido, o MEI é
-- reconhecido pela natureza jurídica 213-5 (empresário individual) com o CPF no fim da razão social,
-- que é o formato que a Receita usa para todo MEI.

ALTER TABLE base_cnpj.empresas
  ADD COLUMN mei       boolean,
  ADD COLUMN simples   boolean,
  ADD COLUMN mei_fonte text CHECK (mei_fonte IN ('simples', 'nome'));

UPDATE base_cnpj.empresas
   SET mei = true, mei_fonte = 'nome'
 WHERE natureza_juridica = '2135' AND razao_social ~ '\d{11}\s*$';

CREATE OR REPLACE VIEW base_cnpj.v_estabelecimentos AS
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
       e.email,
       coalesce(emp.mei, false) AS mei
  FROM base_cnpj.estabelecimentos e
  LEFT JOIN base_cnpj.empresas emp ON emp.cnpj_basico = e.cnpj_basico
  LEFT JOIN base_cnpj.municipios m ON m.codigo = e.municipio_codigo;

-- Descoberta guarda a marca para o Maps casar com o CNPJ e ainda assim saber que é MEI.
ALTER TABLE descoberta.empresas ADD COLUMN mei boolean NOT NULL DEFAULT false;
UPDATE descoberta.empresas d SET mei = true
  FROM base_cnpj.empresas b
 WHERE b.cnpj_basico = d.cnpj_basico AND b.mei;

-- Nicho decide se MEI entra (padrão: não entra).
ALTER TABLE cadastro.nichos ADD COLUMN excluir_mei boolean NOT NULL DEFAULT true;

CREATE OR REPLACE VIEW cadastro.v_campanhas_descoberta AS
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
       n.idade_minima_anos,
       n.excluir_mei
  FROM cadastro.campanhas cp
  JOIN cadastro.nichos n ON n.id = cp.nicho_id;
