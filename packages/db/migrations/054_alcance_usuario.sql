-- Visão de cada pessoa da unidade (dono: api).
--
-- O gestor escolhe, por pessoa, se ela vê a UNIDADE TODA ou SÓ A PRÓPRIA BASE (as negociações em que
-- é a responsável). Hoje vale para o Argos e o mapa do conhecimento.
--
-- O escopo assinado ganha o campo "dono" (versão v2):
--   v2;<tudo 0|1>;<contas>;<dono 0|id>;<expira>;<assinatura>
-- assinatura = sha256(segredo | v2;tudo;contas;dono;expira | segredo). O formato v1 deixa de valer.
-- Com dono, as views que falam de empresas só mostram as que estão no funil com essa pessoa como
-- responsável; tarefas e equipe só as dela; o consumo de IA da unidade some.

ALTER TABLE cadastro.usuarios
  ADD COLUMN IF NOT EXISTS alcance text NOT NULL DEFAULT 'unidade' CHECK (alcance IN ('unidade', 'proprios'));

CREATE FUNCTION cerebro_priv.escopo_assinado() RETURNS TABLE (tudo boolean, contas integer[], dono integer)
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
    RETURN QUERY SELECT false, '{}'::integer[], NULL::integer;
    RETURN;
  END IF;
  partes := string_to_array(bruto, ';');
  IF coalesce(array_length(partes, 1), 0) <> 6 OR partes[1] <> 'v2' OR partes[2] NOT IN ('0', '1')
     OR partes[3] !~ '^[0-9,]*$' OR partes[4] !~ '^[0-9]{1,10}$' OR partes[5] !~ '^[0-9]{1,12}$' THEN
    RETURN QUERY SELECT false, '{}'::integer[], NULL::integer;
    RETURN;
  END IF;
  SELECT segredo INTO chave FROM cerebro_priv.chave WHERE id = 1;
  corpo := array_to_string(partes[1:5], ';');
  IF partes[6] IS DISTINCT FROM encode(sha256(convert_to(chave || '|' || corpo || '|' || chave, 'UTF8')), 'hex')
     OR partes[5]::bigint < extract(epoch FROM clock_timestamp())::bigint THEN
    RETURN QUERY SELECT false, '{}'::integer[], NULL::integer;
    RETURN;
  END IF;
  RETURN QUERY SELECT partes[2] = '1',
                      CASE WHEN partes[3] = '' THEN '{}'::integer[]
                           ELSE string_to_array(partes[3], ',')::integer[] END,
                      -- Quem vê tudo (master) não tem recorte por pessoa.
                      CASE WHEN partes[2] = '1' OR partes[4] = '0' THEN NULL ELSE partes[4]::integer END;
END $$;
REVOKE ALL ON FUNCTION cerebro_priv.escopo_assinado() FROM PUBLIC;

CREATE OR REPLACE FUNCTION cerebro_priv.escopo() RETURNS TABLE (tudo boolean, contas integer[])
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, cerebro_priv
AS $$ SELECT e.tudo, e.contas FROM cerebro_priv.escopo_assinado() e $$;

-- A pessoa cuja base é o recorte (NULL = a unidade toda).
CREATE FUNCTION cerebro_priv.dono() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, cerebro_priv
AS $$ SELECT e.dono FROM cerebro_priv.escopo_assinado() e $$;
REVOKE ALL ON FUNCTION cerebro_priv.dono() FROM PUBLIC;

/* ───────────── Views com o recorte por pessoa ───────────── */

CREATE OR REPLACE VIEW cerebro.leads WITH (security_barrier = true) AS
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
 WHERE ((SELECT tudo FROM cerebro_priv.escopo()) OR ce.conta_id = ANY ((SELECT contas FROM cerebro_priv.escopo())::integer[]))
   AND ((SELECT cerebro_priv.dono()) IS NULL OR EXISTS (SELECT 1 FROM comercial.oportunidades b WHERE b.conta_id = ce.conta_id AND b.empresa_id = ce.empresa_id AND b.responsavel_id = (SELECT cerebro_priv.dono())));

CREATE OR REPLACE VIEW cerebro.funil WITH (security_barrier = true) AS
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
 WHERE ((SELECT tudo FROM cerebro_priv.escopo()) OR o.conta_id = ANY ((SELECT contas FROM cerebro_priv.escopo())::integer[]))
   AND ((SELECT cerebro_priv.dono()) IS NULL OR o.responsavel_id = (SELECT cerebro_priv.dono()));

CREATE OR REPLACE VIEW cerebro.historico_funil WITH (security_barrier = true) AS
SELECT a.id, a.conta_id AS unidade_id, a.empresa_id, a.tipo, a.direcao, a.de_nome AS de_etapa,
       a.para_nome AS para_etapa, a.autor, a.usuario_id, left(a.texto, 500) AS texto, a.criado_em
  FROM comercial.atividades a
 WHERE ((SELECT tudo FROM cerebro_priv.escopo()) OR a.conta_id = ANY ((SELECT contas FROM cerebro_priv.escopo())::integer[]))
   AND ((SELECT cerebro_priv.dono()) IS NULL OR EXISTS (SELECT 1 FROM comercial.oportunidades b WHERE b.conta_id = a.conta_id AND b.empresa_id = a.empresa_id AND b.responsavel_id = (SELECT cerebro_priv.dono())));

CREATE OR REPLACE VIEW cerebro.mensagens_whatsapp WITH (security_barrier = true) AS
SELECT m.id, m.conta_id AS unidade_id, m.empresa_id, m.direcao, m.status, m.origem, m.usuario_id,
       m.midia_tipo, left(m.texto, 500) AS texto, m.criado_em, m.enviado_em, m.lida_em
  FROM comercial.mensagens m
 WHERE ((SELECT tudo FROM cerebro_priv.escopo()) OR m.conta_id = ANY ((SELECT contas FROM cerebro_priv.escopo())::integer[]))
   AND ((SELECT cerebro_priv.dono()) IS NULL OR EXISTS (SELECT 1 FROM comercial.oportunidades b WHERE b.conta_id = m.conta_id AND b.empresa_id = m.empresa_id AND b.responsavel_id = (SELECT cerebro_priv.dono())));

CREATE OR REPLACE VIEW cerebro.tarefas WITH (security_barrier = true) AS
SELECT t.id AS tarefa_id, t.conta_id AS unidade_id, t.empresa_id, t.usuario_id AS responsavel_id,
       u.nome AS responsavel, t.tipo, t.titulo, left(t.descricao, 300) AS descricao, t.inicio, t.fim,
       t.concluida_em, t.criado_em
  FROM comercial.tarefas t
  LEFT JOIN cadastro.usuarios u ON u.id = t.usuario_id
 WHERE ((SELECT tudo FROM cerebro_priv.escopo()) OR t.conta_id = ANY ((SELECT contas FROM cerebro_priv.escopo())::integer[]))
   AND ((SELECT cerebro_priv.dono()) IS NULL OR t.usuario_id = (SELECT cerebro_priv.dono()));

CREATE OR REPLACE VIEW cerebro.emails_enviados WITH (security_barrier = true) AS
SELECT v.id, v.conta_id AS unidade_id, v.empresa_id, v.campanha_email_id, v.passo, v.canal, v.status,
       v.assunto, v.enviado_em, v.entregue_em, v.aberto_em, v.aberturas, v.clicado_em, v.cliques,
       v.respondido_em, v.parado_motivo
  FROM comercial.envios_email v
 WHERE ((SELECT tudo FROM cerebro_priv.escopo()) OR v.conta_id = ANY ((SELECT contas FROM cerebro_priv.escopo())::integer[]))
   AND ((SELECT cerebro_priv.dono()) IS NULL OR EXISTS (SELECT 1 FROM comercial.oportunidades b WHERE b.conta_id = v.conta_id AND b.empresa_id = v.empresa_id AND b.responsavel_id = (SELECT cerebro_priv.dono())));

CREATE OR REPLACE VIEW cerebro.respostas_email WITH (security_barrier = true) AS
SELECT r.id, r.conta_id AS unidade_id, r.empresa_id, r.envio_id, r.classe AS interesse, r.resumo,
       r.recebido_em, r.lida_em
  FROM comercial.respostas_email r
 WHERE ((SELECT tudo FROM cerebro_priv.escopo()) OR r.conta_id = ANY ((SELECT contas FROM cerebro_priv.escopo())::integer[]))
   AND ((SELECT cerebro_priv.dono()) IS NULL OR EXISTS (SELECT 1 FROM comercial.oportunidades b WHERE b.conta_id = r.conta_id AND b.empresa_id = r.empresa_id AND b.responsavel_id = (SELECT cerebro_priv.dono())));

CREATE OR REPLACE VIEW cerebro.decisores WITH (security_barrier = true) AS
SELECT p.id AS pessoa_id, p.conta_id AS unidade_id, p.empresa_id, p.nome, p.cargo, p.papel, p.decisor,
       p.desde, p.criado_em
  FROM enriquecimento.pessoas p
 WHERE ((SELECT tudo FROM cerebro_priv.escopo()) OR p.conta_id = ANY ((SELECT contas FROM cerebro_priv.escopo())::integer[]))
   AND ((SELECT cerebro_priv.dono()) IS NULL OR EXISTS (SELECT 1 FROM comercial.oportunidades b WHERE b.conta_id = p.conta_id AND b.empresa_id = p.empresa_id AND b.responsavel_id = (SELECT cerebro_priv.dono())));

CREATE OR REPLACE VIEW cerebro.contatos_lead WITH (security_barrier = true) AS
SELECT c.empresa_id, c.conta_id AS unidade_id, c.canal, c.status, c.whatsapp, c.principal, c.fonte,
       c.confianca, c.verificado_em
  FROM enriquecimento.contatos c
 WHERE ((SELECT tudo FROM cerebro_priv.escopo()) OR c.conta_id = ANY ((SELECT contas FROM cerebro_priv.escopo())::integer[]))
   AND ((SELECT cerebro_priv.dono()) IS NULL OR EXISTS (SELECT 1 FROM comercial.oportunidades b WHERE b.conta_id = c.conta_id AND b.empresa_id = c.empresa_id AND b.responsavel_id = (SELECT cerebro_priv.dono())));

CREATE OR REPLACE VIEW cerebro.equipe WITH (security_barrier = true) AS
SELECT u.id AS usuario_id, u.nome, u.papel, u.ativo, u.recebe_leads, u.conta_id AS unidade_id,
       u.ultimo_acesso, u.criado_em,
       m.abordagens_dia AS meta_abordagens_dia, m.reunioes_mes AS meta_reunioes_mes, m.ganhos_mes AS meta_ganhos_mes
  FROM cadastro.usuarios u
  LEFT JOIN comercial.metas m ON m.usuario_id = u.id
 WHERE (NOT u.master AND ((SELECT tudo FROM cerebro_priv.escopo()) OR u.conta_id = ANY ((SELECT contas FROM cerebro_priv.escopo())::integer[])))
   AND ((SELECT cerebro_priv.dono()) IS NULL OR u.id = (SELECT cerebro_priv.dono()));

CREATE OR REPLACE VIEW cerebro.consumo_ia WITH (security_barrier = true) AS
SELECT c.conta_id AS unidade_id, c.dia, c.origem, c.chamadas, c.tokens_entrada, c.tokens_saida, c.erros, c.bloqueadas
  FROM cadastro.consumo_ia c
 WHERE ((SELECT tudo FROM cerebro_priv.escopo()) OR c.conta_id = ANY ((SELECT contas FROM cerebro_priv.escopo())::integer[]))
   AND (SELECT cerebro_priv.dono()) IS NULL;
