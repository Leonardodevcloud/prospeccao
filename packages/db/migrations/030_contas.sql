-- Várias contas (empresas) no mesmo sistema. Dono: api.
--
-- Cada conta tem a sua equipe, campanhas, funil, conversas, e-mails e configurações; o painel
-- master (usuários com usuarios.master) cria as contas e guarda as credenciais de cada uma
-- (Google Places, Resend, WhatsApp/Evolution, IA, ORS). O que é público continua comum a todas:
-- a base da Receita (base_cnpj), as empresas encontradas (descoberta.empresas) e o enriquecimento
-- (enriquecimento.*), para uma conta não pagar de novo por um CNPJ que a outra já achou.
--
-- Tudo o que existia vira da conta 1 (a principal).

/* ───────────── Contas e credenciais ───────────── */

CREATE TABLE cadastro.contas (
  id             serial PRIMARY KEY,
  nome           text NOT NULL,
  ativa          boolean NOT NULL DEFAULT true,
  -- A conta da plataforma: usa as chaves do ambiente (variáveis do Railway) quando não tem as suas.
  principal      boolean NOT NULL DEFAULT false,
  -- Parte secreta dos endereços de webhook da conta (Resend: /e/resend/<token>).
  webhook_token  text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  observacoes    text,
  criado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX contas_nome_idx ON cadastro.contas (lower(nome));
CREATE UNIQUE INDEX contas_principal_idx ON cadastro.contas (principal) WHERE principal;
CREATE UNIQUE INDEX contas_webhook_idx ON cadastro.contas (webhook_token);
INSERT INTO cadastro.contas (id, nome, principal) VALUES (1, 'Tutts', true);
SELECT setval('cadastro.contas_id_seq', 1);

-- Chaves das APIs de cada conta. Os segredos ficam cifrados (AES-256-GCM, chave CHAVE_CREDENCIAIS
-- do ambiente); a tela só vê o final de cada um (dicas).
CREATE TABLE cadastro.credenciais_conta (
  conta_id                  integer PRIMARY KEY REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  email_remetente           text,
  resend_dominio_respostas  text,
  evolution_url             text,
  evolution_instancia       text,
  ia_provedor               text CHECK (ia_provedor IN ('deepseek', 'gemini', 'openai')),
  ia_modelo                 text,
  ia_base_url               text,
  -- JSON cifrado: placesKey, resendKey, resendWebhookSegredo, evolutionKey, iaKey, orsKey.
  segredos                  text,
  dicas                     jsonb NOT NULL DEFAULT '{}',
  atualizado_em             timestamptz NOT NULL DEFAULT now(),
  atualizado_por            integer
);

/* ───────────── Usuários: cada um de uma conta; master administra todas ───────────── */

ALTER TABLE cadastro.usuarios
  ADD COLUMN conta_id integer NOT NULL DEFAULT 1 REFERENCES cadastro.contas (id),
  ADD COLUMN master   boolean NOT NULL DEFAULT false;
ALTER TABLE cadastro.usuarios ALTER COLUMN conta_id DROP DEFAULT;
CREATE INDEX usuarios_conta_idx ON cadastro.usuarios (conta_id);
ALTER TABLE cadastro.credenciais_conta
  ADD FOREIGN KEY (atualizado_por) REFERENCES cadastro.usuarios (id) ON DELETE SET NULL;

/* ───────────── conta_id nas tabelas de cada conta (o código sempre informa) ───────────── */

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'cadastro.nichos', 'cadastro.bases', 'cadastro.campanhas',
    'comercial.oportunidades', 'comercial.atividades', 'comercial.mensagens', 'comercial.pipelines',
    'comercial.etapas', 'comercial.notificacoes', 'comercial.midias', 'comercial.respostas_rapidas',
    'comercial.tarefas', 'comercial.modelos_email', 'comercial.campanhas_email', 'comercial.envios_email',
    'comercial.respostas_email'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %s ADD COLUMN conta_id integer NOT NULL DEFAULT 1 REFERENCES cadastro.contas (id)', t);
    EXECUTE format('ALTER TABLE %s ALTER COLUMN conta_id DROP DEFAULT', t);
    EXECUTE format('CREATE INDEX ON %s (conta_id)', t);
  END LOOP;
END $$;

-- Nome de nicho único dentro da conta.
DROP INDEX cadastro.nichos_nome_uidx;
CREATE UNIQUE INDEX nichos_nome_uidx ON cadastro.nichos (conta_id, lower(nome)) WHERE ativo;

-- Oportunidade: uma por empresa EM CADA conta (as duas contas podem trabalhar a mesma loja).
ALTER TABLE comercial.atividades DROP CONSTRAINT atividades_empresa_id_fkey;
ALTER TABLE comercial.tarefas DROP CONSTRAINT tarefas_empresa_id_fkey;
ALTER TABLE comercial.oportunidades DROP CONSTRAINT oportunidades_pkey;
ALTER TABLE comercial.oportunidades ADD PRIMARY KEY (conta_id, empresa_id);
ALTER TABLE comercial.atividades
  ADD FOREIGN KEY (conta_id, empresa_id) REFERENCES comercial.oportunidades (conta_id, empresa_id) ON DELETE CASCADE;
ALTER TABLE comercial.tarefas
  ADD FOREIGN KEY (conta_id, empresa_id) REFERENCES comercial.oportunidades (conta_id, empresa_id) ON DELETE CASCADE;
CREATE INDEX oportunidades_empresa_idx ON comercial.oportunidades (empresa_id);
CREATE INDEX oportunidades_conta_etapa_idx ON comercial.oportunidades (conta_id, etapa_id, posicao);
CREATE INDEX atividades_conta_empresa_idx ON comercial.atividades (conta_id, empresa_id, criado_em DESC);
CREATE INDEX mensagens_conta_empresa_idx ON comercial.mensagens (conta_id, empresa_id, criado_em);

-- Mensagem do WhatsApp e resposta de e-mail: o id externo é único dentro da conta.
DROP INDEX comercial.mensagens_externo_idx;
CREATE UNIQUE INDEX mensagens_externo_idx ON comercial.mensagens (conta_id, id_externo) WHERE id_externo IS NOT NULL;
DROP INDEX comercial.respostas_email_msg_idx;
CREATE UNIQUE INDEX respostas_email_msg_idx ON comercial.respostas_email (conta_id, message_id)
  WHERE message_id IS NOT NULL;

-- Quem pediu para sair, sai da lista DAQUELA conta (cada empresa responde pelos seus e-mails).
ALTER TABLE comercial.descadastros_email ADD COLUMN conta_id integer REFERENCES cadastro.contas (id);
UPDATE comercial.descadastros_email SET conta_id = 1;
ALTER TABLE comercial.descadastros_email
  DROP CONSTRAINT descadastros_email_pkey,
  ALTER COLUMN conta_id SET NOT NULL,
  ADD PRIMARY KEY (conta_id, email);

-- Modelos de mensagem do WhatsApp: um jogo por conta.
ALTER TABLE comercial.modelos_mensagem ADD COLUMN conta_id integer REFERENCES cadastro.contas (id);
UPDATE comercial.modelos_mensagem SET conta_id = 1;
ALTER TABLE comercial.modelos_mensagem
  DROP CONSTRAINT modelos_mensagem_pkey,
  ALTER COLUMN conta_id SET NOT NULL,
  ADD PRIMARY KEY (conta_id, chave);

/* ───────────── Configurações de linha única: uma linha por conta ───────────── */

DROP VIEW cadastro.v_config_places;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'comercial.config_cadencia', 'comercial.config_agente', 'comercial.config_equipe',
    'comercial.config_agenda', 'comercial.config_email', 'cadastro.config_places'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %s ADD COLUMN conta_id integer REFERENCES cadastro.contas (id)', t);
    EXECUTE format('UPDATE %s SET conta_id = 1', t);
    EXECUTE format('ALTER TABLE %s DROP COLUMN id', t);
    EXECUTE format('ALTER TABLE %s ALTER COLUMN conta_id SET NOT NULL', t);
    EXECUTE format('ALTER TABLE %s ADD PRIMARY KEY (conta_id)', t);
  END LOOP;
END $$;
CREATE UNIQUE INDEX config_agente_webhook_idx ON comercial.config_agente (webhook_token);

CREATE VIEW cadastro.v_config_places AS
SELECT conta_id,
       franquia_mensal,
       preco_mil_usd::float8   AS preco_mil_usd,
       cotacao_brl::float8     AS cotacao_brl,
       teto_mensal_usd::float8 AS teto_mensal_usd,
       max_bairros
  FROM cadastro.config_places;

/* ───────────── Descoberta: a conta vem da campanha ───────────── */

-- Quem grava (o worker) não precisa saber da conta: o gatilho copia a da campanha.
CREATE FUNCTION cadastro.conta_da_campanha() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.conta_id IS NULL AND NEW.campanha_id IS NOT NULL THEN
    SELECT conta_id INTO NEW.conta_id FROM cadastro.campanhas WHERE id = NEW.campanha_id;
  END IF;
  IF NEW.conta_id IS NULL THEN
    RAISE EXCEPTION 'Sem conta para a campanha %', NEW.campanha_id;
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['descoberta.campanha_empresas', 'descoberta.buscas_maps', 'descoberta.uso_places']
  LOOP
    EXECUTE format('ALTER TABLE %s ADD COLUMN conta_id integer REFERENCES cadastro.contas (id)', t);
    EXECUTE format('UPDATE %s SET conta_id = 1', t);
    EXECUTE format('ALTER TABLE %s ALTER COLUMN conta_id SET NOT NULL', t);
    EXECUTE format('CREATE INDEX ON %s (conta_id)', t);
    EXECUTE format(
      'CREATE TRIGGER conta_da_campanha BEFORE INSERT ON %s FOR EACH ROW EXECUTE FUNCTION cadastro.conta_da_campanha()', t);
  END LOOP;
END $$;
CREATE INDEX campanha_empresas_conta_empresa_idx ON descoberta.campanha_empresas (conta_id, empresa_id);

-- Base mais próxima e distância passam a ser da campanha (cada conta tem as suas bases).
ALTER TABLE descoberta.campanha_empresas
  ADD COLUMN base_id           bigint,
  ADD COLUMN distancia_base_km numeric(7, 2);
UPDATE descoberta.campanha_empresas ce
   SET base_id = e.base_id, distancia_base_km = e.distancia_base_km
  FROM descoberta.empresas e
 WHERE e.id = ce.empresa_id;

-- A view publicada "uma linha por empresa em cada campanha" passa a trazer a conta e a distância
-- da campanha (no lugar da distância antiga, que era uma só para todas).
DO $$
DECLARE colunas text;
BEGIN
  SELECT string_agg(
           CASE column_name
             WHEN 'base_id' THEN 'ce.base_id'
             WHEN 'distancia_base_km' THEN 'ce.distancia_base_km'
             ELSE format('e.%I', column_name)
           END, ', ' ORDER BY ordinal_position)
    INTO colunas
    FROM information_schema.columns
   WHERE table_schema = 'descoberta' AND table_name = 'empresas';
  DROP VIEW descoberta.v_empresas_campanha;
  EXECUTE format(
    'CREATE VIEW descoberta.v_empresas_campanha AS
     SELECT ce.campanha_id, ce.origem, ce.dentro_do_raio, ce.adicionada_em, ce.enriquecimento_solicitado_em,
            %s, ce.conta_id
       FROM descoberta.campanha_empresas ce
       JOIN descoberta.empresas e ON e.id = ce.empresa_id', colunas);
END $$;

-- Uso do Google Places do enriquecimento: por conta (cada conta tem a sua chave e a sua cota).
DROP VIEW enriquecimento.v_uso_places_mes;
ALTER TABLE enriquecimento.uso_places ADD COLUMN conta_id integer REFERENCES cadastro.contas (id);
UPDATE enriquecimento.uso_places SET conta_id = 1;
ALTER TABLE enriquecimento.uso_places
  DROP CONSTRAINT uso_places_pkey,
  ALTER COLUMN conta_id SET NOT NULL,
  ADD PRIMARY KEY (conta_id, mes);
CREATE VIEW enriquecimento.v_uso_places_mes AS
SELECT conta_id, mes, pedidos FROM enriquecimento.uso_places;

DROP VIEW descoberta.v_uso_places_mes;
CREATE VIEW descoberta.v_uso_places_mes AS
SELECT conta_id,
       mes,
       count(*)::int                              AS pedidos,
       count(*) FILTER (WHERE paga)::int          AS pagos,
       coalesce(sum(custo_usd), 0)::float8        AS gasto_usd,
       coalesce(sum(itens), 0)::int               AS lugares
  FROM descoberta.uso_places
 GROUP BY conta_id, mes;

/* ───────────── Views publicadas: com a conta ───────────── */

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
       n.excluir_mei,
       cp.teto_places_usd::float8 AS teto_places_usd,
       cp.conta_id
  FROM cadastro.campanhas cp
  JOIN cadastro.nichos n ON n.id = cp.nicho_id;

CREATE OR REPLACE VIEW cadastro.v_campanhas_enriquecimento AS
SELECT cp.id,
       cp.nome,
       cp.status,
       n.id AS nicho_id,
       n.nome AS nicho_nome,
       n.cargos_alvo,
       n.palavras_positivas,
       n.termos_maps,
       cp.conta_id
  FROM cadastro.campanhas cp
  JOIN cadastro.nichos n ON n.id = cp.nicho_id;

CREATE OR REPLACE VIEW cadastro.v_bases_ativas AS
SELECT id, nome, lat, lng, conta_id FROM cadastro.bases WHERE ativa;

CREATE OR REPLACE VIEW comercial.v_empresas_descartadas AS
SELECT empresa_id, conta_id FROM comercial.oportunidades WHERE etapa = 'descartado';

/* ───────────── E-mail: identidade visual por marca, personalização por campanha ───────────── */

-- Imagens da marca (logo, capa) precisam abrir no e-mail do lead, sem login: só elas ganham token.
ALTER TABLE comercial.midias ADD COLUMN publico_token text;
CREATE UNIQUE INDEX midias_publico_idx ON comercial.midias (publico_token) WHERE publico_token IS NOT NULL;

-- Identidade visual do e-mail (white label): cores, logo, capa, assinatura e rodapé. Uma conta pode
-- ter várias (ex.: Tutts, Fiix Peças, IG Express) e cada campanha escolhe a sua.
CREATE TABLE comercial.marcas_email (
  id               serial PRIMARY KEY,
  conta_id         integer NOT NULL REFERENCES cadastro.contas (id),
  nome             text NOT NULL,
  remetente_nome   text NOT NULL,
  -- Vazio = o remetente da conta (o domínio precisa estar verificado no Resend da conta).
  remetente_email  text,
  responder_para   text,
  -- "cartao": cabeçalho com logo e cor, corpo em cartão branco, botão colorido.
  -- "simples": parece um e-mail escrito à mão (melhor entrega), com a logo só na assinatura.
  estilo           text NOT NULL DEFAULT 'cartao' CHECK (estilo IN ('cartao', 'simples')),
  cor_primaria     text NOT NULL DEFAULT '#7c3aed',
  cor_fundo        text NOT NULL DEFAULT '#f4f4f5',
  cor_texto        text NOT NULL DEFAULT '#1f2933',
  cor_cabecalho    text NOT NULL DEFAULT '#ffffff',
  logo_id          bigint,
  largura_logo     integer NOT NULL DEFAULT 140 CHECK (largura_logo BETWEEN 40 AND 400),
  capa_id          bigint,
  assinatura       text NOT NULL DEFAULT '',
  rodape           text NOT NULL DEFAULT '',
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX marcas_email_conta_idx ON comercial.marcas_email (conta_id);

ALTER TABLE comercial.campanhas_email
  ADD COLUMN marca_id        integer REFERENCES comercial.marcas_email (id),
  -- O que a IA precisa saber do nicho para abrir cada e-mail (dor, tom, o que destacar).
  ADD COLUMN instrucoes_ia   text NOT NULL DEFAULT '',
  ADD COLUMN personalizar_ia boolean NOT NULL DEFAULT false;

ALTER TABLE comercial.modelos_email
  -- Nicho do modelo (só organiza a lista).
  ADD COLUMN nicho_id bigint;

-- Abertura escrita pela IA para este lead (fica guardada: a prévia e o histórico mostram o que foi).
ALTER TABLE comercial.envios_email ADD COLUMN personalizacao text;

-- A marca da conta 1 nasce da configuração de e-mail que já existia.
INSERT INTO comercial.marcas_email (conta_id, nome, remetente_nome, responder_para, assinatura, cor_primaria)
SELECT 1, 'Tutts', remetente_nome, responder_para, assinatura, '#7c3aed' FROM comercial.config_email WHERE conta_id = 1;
UPDATE comercial.campanhas_email SET marca_id = (SELECT min(id) FROM comercial.marcas_email WHERE conta_id = 1);

-- Remetente, resposta e assinatura agora são da marca.
ALTER TABLE comercial.config_email
  DROP COLUMN remetente_nome,
  DROP COLUMN responder_para,
  DROP COLUMN assinatura;

/* ───────────── Conta nova: tudo que ela precisa para funcionar ───────────── */

CREATE FUNCTION cadastro.preparar_conta(p_conta integer) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_nome text;
  sdr integer;
  closer integer;
BEGIN
  SELECT nome INTO v_nome FROM cadastro.contas WHERE id = p_conta;
  IF v_nome IS NULL THEN RAISE EXCEPTION 'Conta % não existe', p_conta; END IF;

  INSERT INTO comercial.config_cadencia (conta_id) VALUES (p_conta) ON CONFLICT DO NOTHING;
  INSERT INTO comercial.config_equipe (conta_id) VALUES (p_conta) ON CONFLICT DO NOTHING;
  INSERT INTO comercial.config_email (conta_id) VALUES (p_conta) ON CONFLICT DO NOTHING;
  INSERT INTO cadastro.config_places (conta_id) VALUES (p_conta) ON CONFLICT DO NOTHING;
  INSERT INTO comercial.config_agenda (conta_id, texto_lembrete_lead)
  VALUES (p_conta, '{saudacao} Passando para confirmar nossa conversa {quando}. Até lá! {remetente}')
  ON CONFLICT DO NOTHING;
  INSERT INTO comercial.config_agente (conta_id, sobre_empresa, regras)
  VALUES (p_conta, '',
          'Não prometa preço fechado nem desconto: diga que a proposta sai depois de uma conversa rápida. Não invente nada que não esteja em "sobre a empresa". Seja breve (até 3 frases), cordial e em português do Brasil. Objetivo: marcar uma conversa de 15 minutos.')
  ON CONFLICT DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM comercial.pipelines WHERE conta_id = p_conta) THEN
    INSERT INTO comercial.pipelines (conta_id, nome, ordem) VALUES (p_conta, 'SDR', 1) RETURNING id INTO sdr;
    INSERT INTO comercial.pipelines (conta_id, nome, ordem) VALUES (p_conta, 'Closer', 2) RETURNING id INTO closer;
    INSERT INTO comercial.etapas (conta_id, pipeline_id, nome, cor, ordem, papel) VALUES
      (p_conta, sdr, 'A abordar', '#94a3b8', 1, 'a_abordar'),
      (p_conta, sdr, 'Abordado', '#3b82f6', 2, 'abordado'),
      (p_conta, sdr, 'Respondeu', '#14b8a6', 3, 'respondeu'),
      (p_conta, sdr, 'Perdido', '#ef4444', 4, 'perdido'),
      (p_conta, closer, 'Reunião agendada', '#3b82f6', 1, 'reuniao'),
      (p_conta, closer, 'Diagnóstico', '#f59e0b', 2, 'reuniao'),
      (p_conta, closer, 'Proposta enviada', '#f97316', 3, 'proposta'),
      (p_conta, closer, 'Negociação', '#e11d48', 4, 'proposta'),
      (p_conta, closer, 'Contrato enviado', '#8b5cf6', 5, 'proposta'),
      (p_conta, closer, 'Ganho', '#16a34a', 6, 'ganho'),
      (p_conta, closer, 'Perdido', '#ef4444', 7, 'perdido');
  END IF;

  INSERT INTO comercial.modelos_mensagem (conta_id, chave, texto) VALUES
    (p_conta, 'primeira', '{saudacao} Tudo bem? Aqui é {remetente}, da ' || v_nome || '. Trabalhamos com empresas como a {empresa} em {cidade}. Posso te fazer uma pergunta rápida sobre como vocês fazem hoje?'),
    (p_conta, 'followup1', '{saudacao} Passando para saber se viu minha mensagem. Posso te mostrar em 5 minutos como a ' || v_nome || ' ajudaria a {empresa}?'),
    (p_conta, 'followup2', '{saudacao} Várias empresas de {cidade} já trabalham com a gente. Faz sentido conversarmos esta semana?'),
    (p_conta, 'ultima', '{saudacao} Não quero incomodar: esta é minha última mensagem. Se precisar, é só me chamar aqui. Abraço!'),
    (p_conta, 'marcar_reuniao', '{saudacao} Que bom falar com você! Qual o melhor dia e horário para uma conversa rápida de 15 minutos?'),
    (p_conta, 'cobrar_proposta', '{saudacao} Conseguiu olhar a proposta que enviei? Fico à disposição para ajustar o que for preciso.')
  ON CONFLICT DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM comercial.respostas_rapidas WHERE conta_id = p_conta) THEN
    INSERT INTO comercial.respostas_rapidas (conta_id, atalho, texto) VALUES
      (p_conta, 'apresentacao', '{saudacao} Aqui é {remetente}, da ' || v_nome || '.'),
      (p_conta, 'reuniao', 'Que tal uma conversa rápida de 15 minutos? Qual o melhor dia e horário?'),
      (p_conta, 'obrigado', 'Obrigado pelo retorno! Qualquer coisa, é só me chamar por aqui.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM comercial.marcas_email WHERE conta_id = p_conta) THEN
    INSERT INTO comercial.marcas_email (conta_id, nome, remetente_nome, assinatura)
    VALUES (p_conta, v_nome, v_nome, E'{remetente}\n' || v_nome);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM comercial.modelos_email WHERE conta_id = p_conta) THEN
    INSERT INTO comercial.modelos_email (conta_id, nome, assunto, corpo) VALUES
      (p_conta, 'Apresentação + proposta', 'Uma ideia para a {empresa}',
       E'{saudacao}\n\n{abertura}\n\nSou {remetente}, da ' || v_nome || E'. Em poucas linhas, o que fazemos:\n- (benefício 1)\n- (benefício 2)\n- (benefício 3)\n\nMandei em anexo nossa proposta. Faz sentido conversarmos 15 minutos esta semana?'),
      (p_conta, 'Follow-up', 'Re: Uma ideia para a {empresa}',
       E'{saudacao}\n\nPassando para saber se conseguiu ver a proposta que mandei. Se fizer sentido, me responda com o melhor dia e horário que eu te ligo.');
  END IF;
END $$;

SELECT cadastro.preparar_conta(1);
