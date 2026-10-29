-- Argos, o assistente (segundo cérebro). Dono: api.
--
-- A IA escreve SQL sozinha, então a proteção fica no banco:
--  * schema `cerebro`: a vitrine. Só views escolhidas a dedo, sem colunas pessoais (e-mail, telefone,
--    senha, token, chave) e com nomes claros para a IA;
--  * cada view só devolve as linhas do ESCOPO de quem pergunta: a unidade da pessoa, as unidades da
--    organização (gestor e diretoria) ou tudo (master da plataforma);
--  * o escopo chega numa variável da transação assinada pelo servidor (chave guardada só aqui no
--    banco). Sem assinatura válida e dentro do prazo, as views voltam vazias;
--  * o papel `cerebro_leitura` (criado pela api, com senha derivada do segredo dela) só enxerga
--    estas views, só lê e tem limite de tempo por consulta.

CREATE SCHEMA cerebro;
CREATE SCHEMA cerebro_priv;

/* ───────────── Chave e escopo ───────────── */

CREATE TABLE cerebro_priv.chave (
  id       integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  segredo  text NOT NULL
);
INSERT INTO cerebro_priv.chave (segredo)
VALUES (encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex'));

-- Escopo da consulta em andamento. Formato da variável cerebro.escopo:
--   v1;<tudo 0|1>;<contas separadas por vírgula>;<expira em segundos unix>;<assinatura>
-- assinatura = sha256(segredo | v1;tudo;contas;expira | segredo), em hexadecimal.
CREATE FUNCTION cerebro_priv.escopo() RETURNS TABLE (tudo boolean, contas integer[])
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, cerebro_priv
AS $$
DECLARE
  bruto  text := current_setting('cerebro.escopo', true);
  partes text[];
  corpo  text;
  chave  text;
BEGIN
  IF bruto IS NULL OR bruto = '' THEN
    RETURN QUERY SELECT false, '{}'::integer[];
    RETURN;
  END IF;
  partes := string_to_array(bruto, ';');
  IF coalesce(array_length(partes, 1), 0) <> 5 OR partes[1] <> 'v1' OR partes[2] NOT IN ('0', '1')
     OR partes[3] !~ '^[0-9,]*$' OR partes[4] !~ '^[0-9]{1,12}$' THEN
    RETURN QUERY SELECT false, '{}'::integer[];
    RETURN;
  END IF;
  SELECT segredo INTO chave FROM cerebro_priv.chave WHERE id = 1;
  corpo := array_to_string(partes[1:4], ';');
  IF partes[5] IS DISTINCT FROM encode(sha256(convert_to(chave || '|' || corpo || '|' || chave, 'UTF8')), 'hex')
     OR partes[4]::bigint < extract(epoch FROM clock_timestamp())::bigint THEN
    RETURN QUERY SELECT false, '{}'::integer[];
    RETURN;
  END IF;
  RETURN QUERY SELECT partes[2] = '1',
                      CASE WHEN partes[3] = '' THEN '{}'::integer[]
                           ELSE string_to_array(partes[3], ',')::integer[] END;
END $$;
REVOKE ALL ON FUNCTION cerebro_priv.escopo() FROM PUBLIC;

/* ───────────── Vitrine: o que cada pessoa vê do próprio negócio ───────────── */

-- O filtro usa subconsultas escalares: o Postgres calcula o escopo uma vez só (InitPlan).
-- security_barrier: condições da consulta da IA não rodam antes do filtro do escopo.

CREATE VIEW cerebro.unidades WITH (security_barrier = true) AS
SELECT c.id AS unidade_id, c.nome AS unidade, c.organizacao_id, o.nome AS organizacao,
       c.ativa, c.cota_leads_mes, c.criado_em, c.desativada_em
  FROM cadastro.contas c
  JOIN cadastro.organizacoes o ON o.id = c.organizacao_id
 WHERE (SELECT tudo FROM cerebro_priv.escopo()) OR c.id = ANY ((SELECT contas FROM cerebro_priv.escopo())::integer[]);

CREATE VIEW cerebro.equipe WITH (security_barrier = true) AS
SELECT u.id AS usuario_id, u.nome, u.papel, u.ativo, u.recebe_leads, u.conta_id AS unidade_id,
       u.ultimo_acesso, u.criado_em,
       m.abordagens_dia AS meta_abordagens_dia, m.reunioes_mes AS meta_reunioes_mes, m.ganhos_mes AS meta_ganhos_mes
  FROM cadastro.usuarios u
  LEFT JOIN comercial.metas m ON m.usuario_id = u.id
 WHERE NOT u.master
   AND ((SELECT tudo FROM cerebro_priv.escopo()) OR u.conta_id = ANY ((SELECT contas FROM cerebro_priv.escopo())::integer[]));

CREATE VIEW cerebro.nichos WITH (security_barrier = true) AS
SELECT n.id AS nicho_id, n.conta_id AS unidade_id, n.nome, n.cnaes, n.termos_maps, n.palavras_positivas,
       n.palavras_negativas, n.cargos_alvo, n.portes, n.idade_minima_anos, n.excluir_mei, n.ativo, n.criado_em
  FROM cadastro.nichos n
 WHERE (SELECT tudo FROM cerebro_priv.escopo()) OR n.conta_id = ANY ((SELECT contas FROM cerebro_priv.escopo())::integer[]);

CREATE VIEW cerebro.campanhas WITH (security_barrier = true) AS
SELECT c.id AS campanha_id, c.conta_id AS unidade_id, c.nome, c.nicho_id, n.nome AS nicho,
       (SELECT string_agg((x ->> 'cidade') || '/' || (x ->> 'uf'), ', ') FROM jsonb_array_elements(c.cidades) x) AS cidades,
       c.raio_km, c.meta_diaria, c.limite_leads, c.status, c.modo, c.tipo, c.iniciada_em, c.criado_em
  FROM cadastro.campanhas c
  LEFT JOIN cadastro.nichos n ON n.id = c.nicho_id
 WHERE (SELECT tudo FROM cerebro_priv.escopo()) OR c.conta_id = ANY ((SELECT contas FROM cerebro_priv.escopo())::integer[]);

-- Um lead = uma empresa encontrada por uma campanha da unidade (a mesma empresa pode aparecer
-- em mais de uma campanha: use count(DISTINCT empresa_id) para contar empresas).
CREATE VIEW cerebro.leads WITH (security_barrier = true) AS
SELECT ce.empresa_id, ce.conta_id AS unidade_id, ce.campanha_id, ce.origem, ce.adicionada_em, ce.liberado_em,
       coalesce(e.maps_nome, e.nome) AS empresa, e.razao_social, e.cnpj, e.cnae_principal, e.porte,
       e.data_abertura, e.mei, e.bairro, e.cidade, e.uf,
       coalesce(l.maps_categoria, e.maps_categoria) AS categoria_google,
       coalesce(l.maps_nota, e.maps_nota) AS nota_google,
       coalesce(l.maps_avaliacoes, e.maps_avaliacoes) AS avaliacoes_google,
       (coalesce(l.site_url, e.maps_site) IS NOT NULL) AS tem_site,
       (l.instagram IS NOT NULL) AS tem_instagram,
       l.faixa, l.score, l.motivo AS motivo_da_nota, l.resumo AS resumo_da_empresa,
       l.status AS status_enriquecimento, l.concluido_em AS enriquecido_em
  FROM descoberta.campanha_empresas ce
  JOIN descoberta.empresas e ON e.id = ce.empresa_id
  LEFT JOIN enriquecimento.leads l ON l.empresa_id = ce.empresa_id
 WHERE (SELECT tudo FROM cerebro_priv.escopo()) OR ce.conta_id = ANY ((SELECT contas FROM cerebro_priv.escopo())::integer[]);

CREATE VIEW cerebro.etapas_funil WITH (security_barrier = true) AS
SELECT et.id AS etapa_id, et.conta_id AS unidade_id, p.nome AS pipeline, et.nome AS etapa, et.ordem,
       et.papel AS funciona_como
  FROM comercial.etapas et
  JOIN comercial.pipelines p ON p.id = et.pipeline_id
 WHERE (SELECT tudo FROM cerebro_priv.escopo()) OR et.conta_id = ANY ((SELECT contas FROM cerebro_priv.escopo())::integer[]);

-- Uma negociação por empresa e unidade.
CREATE VIEW cerebro.funil WITH (security_barrier = true) AS
SELECT o.empresa_id, o.conta_id AS unidade_id, coalesce(e.maps_nome, e.nome) AS empresa, e.cidade, e.uf,
       p.nome AS pipeline, coalesce(et.nome, o.etapa) AS etapa, o.etapa AS situacao, o.etapa_desde,
       o.valor_mensal, o.responsavel_id, u.nome AS responsavel, o.proxima_acao, o.proxima_acao_em,
       o.ultimo_contato_em, o.tentativas, o.motivo AS motivo_perda_ou_descarte, o.faixa_entrada,
       o.score_entrada, o.etiquetas, o.agente AS conduzido_pela_ia, o.campanha_id, o.criado_em, o.atualizado_em
  FROM comercial.oportunidades o
  JOIN descoberta.empresas e ON e.id = o.empresa_id
  LEFT JOIN comercial.etapas et ON et.id = o.etapa_id
  LEFT JOIN comercial.pipelines p ON p.id = et.pipeline_id
  LEFT JOIN cadastro.usuarios u ON u.id = o.responsavel_id
 WHERE (SELECT tudo FROM cerebro_priv.escopo()) OR o.conta_id = ANY ((SELECT contas FROM cerebro_priv.escopo())::integer[]);

CREATE VIEW cerebro.historico_funil WITH (security_barrier = true) AS
SELECT a.id, a.conta_id AS unidade_id, a.empresa_id, a.tipo, a.direcao, a.de_nome AS de_etapa,
       a.para_nome AS para_etapa, a.autor, a.usuario_id, left(a.texto, 500) AS texto, a.criado_em
  FROM comercial.atividades a
 WHERE (SELECT tudo FROM cerebro_priv.escopo()) OR a.conta_id = ANY ((SELECT contas FROM cerebro_priv.escopo())::integer[]);

CREATE VIEW cerebro.mensagens_whatsapp WITH (security_barrier = true) AS
SELECT m.id, m.conta_id AS unidade_id, m.empresa_id, m.direcao, m.status, m.origem, m.usuario_id,
       m.midia_tipo, left(m.texto, 500) AS texto, m.criado_em, m.enviado_em, m.lida_em
  FROM comercial.mensagens m
 WHERE (SELECT tudo FROM cerebro_priv.escopo()) OR m.conta_id = ANY ((SELECT contas FROM cerebro_priv.escopo())::integer[]);

CREATE VIEW cerebro.tarefas WITH (security_barrier = true) AS
SELECT t.id AS tarefa_id, t.conta_id AS unidade_id, t.empresa_id, t.usuario_id AS responsavel_id,
       u.nome AS responsavel, t.tipo, t.titulo, left(t.descricao, 300) AS descricao, t.inicio, t.fim,
       t.concluida_em, t.criado_em
  FROM comercial.tarefas t
  LEFT JOIN cadastro.usuarios u ON u.id = t.usuario_id
 WHERE (SELECT tudo FROM cerebro_priv.escopo()) OR t.conta_id = ANY ((SELECT contas FROM cerebro_priv.escopo())::integer[]);

CREATE VIEW cerebro.campanhas_email WITH (security_barrier = true) AS
SELECT c.id AS campanha_email_id, c.conta_id AS unidade_id, c.nome, c.campanha_id, c.status,
       c.iniciada_em, c.concluida_em, c.criado_em
  FROM comercial.campanhas_email c
 WHERE (SELECT tudo FROM cerebro_priv.escopo()) OR c.conta_id = ANY ((SELECT contas FROM cerebro_priv.escopo())::integer[]);

CREATE VIEW cerebro.emails_enviados WITH (security_barrier = true) AS
SELECT v.id, v.conta_id AS unidade_id, v.empresa_id, v.campanha_email_id, v.passo, v.canal, v.status,
       v.assunto, v.enviado_em, v.entregue_em, v.aberto_em, v.aberturas, v.clicado_em, v.cliques,
       v.respondido_em, v.parado_motivo
  FROM comercial.envios_email v
 WHERE (SELECT tudo FROM cerebro_priv.escopo()) OR v.conta_id = ANY ((SELECT contas FROM cerebro_priv.escopo())::integer[]);

CREATE VIEW cerebro.respostas_email WITH (security_barrier = true) AS
SELECT r.id, r.conta_id AS unidade_id, r.empresa_id, r.envio_id, r.classe AS interesse, r.resumo,
       r.recebido_em, r.lida_em
  FROM comercial.respostas_email r
 WHERE (SELECT tudo FROM cerebro_priv.escopo()) OR r.conta_id = ANY ((SELECT contas FROM cerebro_priv.escopo())::integer[]);

CREATE VIEW cerebro.decisores WITH (security_barrier = true) AS
SELECT p.id AS pessoa_id, p.conta_id AS unidade_id, p.empresa_id, p.nome, p.cargo, p.papel, p.decisor,
       p.desde, p.criado_em
  FROM enriquecimento.pessoas p
 WHERE (SELECT tudo FROM cerebro_priv.escopo()) OR p.conta_id = ANY ((SELECT contas FROM cerebro_priv.escopo())::integer[]);

-- Canais encontrados para falar com o lead (o número/e-mail em si não sai daqui).
CREATE VIEW cerebro.contatos_lead WITH (security_barrier = true) AS
SELECT c.empresa_id, c.conta_id AS unidade_id, c.canal, c.status, c.whatsapp, c.principal, c.fonte,
       c.confianca, c.verificado_em
  FROM enriquecimento.contatos c
 WHERE (SELECT tudo FROM cerebro_priv.escopo()) OR c.conta_id = ANY ((SELECT contas FROM cerebro_priv.escopo())::integer[]);

CREATE VIEW cerebro.conhecimento WITH (security_barrier = true) AS
SELECT k.id, k.conta_id AS unidade_id, k.tipo, k.titulo, k.pergunta, left(k.conteudo, 1500) AS conteudo,
       k.status, k.usos, k.atualizado_em
  FROM comercial.conhecimento k
 WHERE (SELECT tudo FROM cerebro_priv.escopo()) OR k.conta_id = ANY ((SELECT contas FROM cerebro_priv.escopo())::integer[]);

CREATE VIEW cerebro.consumo_ia WITH (security_barrier = true) AS
SELECT c.conta_id AS unidade_id, c.dia, c.origem, c.chamadas, c.tokens_entrada, c.tokens_saida, c.erros, c.bloqueadas
  FROM cadastro.consumo_ia c
 WHERE (SELECT tudo FROM cerebro_priv.escopo()) OR c.conta_id = ANY ((SELECT contas FROM cerebro_priv.escopo())::integer[]);

/* ───────────── Mercado: base pública da Receita (vale para todos) ───────────── */

CREATE VIEW cerebro.mercado WITH (security_barrier = true) AS
SELECT e.cnpj, e.matriz, nullif(btrim(e.nome_fantasia), '') AS nome_fantasia, emp.razao_social,
       emp.natureza_juridica, emp.capital_social, coalesce(emp.porte, 'nao_informado') AS porte, emp.mei, emp.simples,
       (e.situacao = '02') AS ativa, e.data_inicio, e.cnae_principal, cn.descricao AS cnae_descricao,
       e.cnaes_secundarios, e.bairro, public.normalizar_cidade(m.nome) AS cidade, e.uf
  FROM base_cnpj.estabelecimentos e
  LEFT JOIN base_cnpj.empresas emp ON emp.cnpj_basico = e.cnpj_basico
  LEFT JOIN base_cnpj.municipios m ON m.codigo = e.municipio_codigo
  LEFT JOIN base_cnpj.cnaes cn ON cn.codigo = e.cnae_principal;

/* ───────────── Só o master da plataforma ───────────── */

CREATE VIEW cerebro.plataforma_organizacoes WITH (security_barrier = true) AS
SELECT o.id AS organizacao_id, o.nome, o.ativa, o.plano, o.limite_usuarios, o.limite_leads_mes, o.modulos,
       o.mensalidade_manual, o.plano_desde, o.criado_em, o.desativada_em
  FROM cadastro.organizacoes o
 WHERE (SELECT tudo FROM cerebro_priv.escopo());

CREATE VIEW cerebro.plataforma_consumo_buscas WITH (security_barrier = true) AS
SELECT c.conta_id AS unidade_id, c.dia, c.servico, c.buscas
  FROM cadastro.consumo_buscas c
 WHERE (SELECT tudo FROM cerebro_priv.escopo());

CREATE VIEW cerebro.plataforma_pedidos_site WITH (security_barrier = true) AS
SELECT p.id, p.empresa, p.nicho, p.plano, p.canal, p.etapa, p.motivo_perda, p.demonstracao_em,
       p.conta_id AS unidade_id, p.criado_em, p.atualizado_em
  FROM cadastro.pedidos_site p
 WHERE (SELECT tudo FROM cerebro_priv.escopo());
