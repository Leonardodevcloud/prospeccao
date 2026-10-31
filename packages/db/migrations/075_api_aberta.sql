-- API aberta: chaves por conta, formulários do site (um endereço que recebe o envio como vier) e
-- avisos (webhooks) com assinatura, novas tentativas e histórico. O recurso "api" entra no Time e
-- no Escala.

/* ───────────── Chaves ───────────── */

CREATE TABLE comercial.api_chaves (
  id               bigserial PRIMARY KEY,
  conta_id         integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  nome             text NOT NULL,
  -- Só o fim da chave (para reconhecer na tela) e o hash SHA-256 dela; a chave inteira nunca é guardada.
  final            text NOT NULL,
  hash             text NOT NULL UNIQUE,
  permissoes       text[] NOT NULL,
  -- Endereços IP (ou faixas CIDR) de onde a chave pode ser usada; vazio = qualquer um.
  ips              text[] NOT NULL DEFAULT '{}',
  expira_em        timestamptz,
  criado_por       integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  criado_por_nome  text,
  criada_em        timestamptz NOT NULL DEFAULT now(),
  revogada_em      timestamptz,
  revogada_por     text,
  ultimo_uso_em    timestamptz,
  ultimo_ip        text,
  usos_dia         date,
  usos_hoje        integer NOT NULL DEFAULT 0
);
CREATE INDEX api_chaves_conta_idx ON comercial.api_chaves (conta_id, criada_em DESC);

-- Uso por dia (a tela mostra; o limite diário da conta conta por aqui).
CREATE TABLE comercial.api_uso (
  conta_id       integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  dia            date NOT NULL,
  chamadas       integer NOT NULL DEFAULT 0,
  erros          integer NOT NULL DEFAULT 0,
  leads_criados  integer NOT NULL DEFAULT 0,
  duplicados     integer NOT NULL DEFAULT 0,
  PRIMARY KEY (conta_id, dia)
);

-- Idempotency-Key: o mesmo pedido repetido devolve a mesma resposta (por 24 h).
CREATE TABLE comercial.api_idempotencia (
  conta_id   integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  chave      text NOT NULL,
  rota       text NOT NULL,
  status     integer NOT NULL,
  resposta   jsonb NOT NULL,
  criado_em  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conta_id, chave)
);

/* ───────────── Formulários do site ───────────── */

CREATE TABLE comercial.formularios_site (
  id               bigserial PRIMARY KEY,
  conta_id         integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  nome             text NOT NULL,
  -- Vai no endereço público (/v1/entrada/<chave>): é o que identifica a conta.
  chave            text NOT NULL UNIQUE,
  ligado           boolean NOT NULL DEFAULT true,
  -- Campos que já chegaram e para onde vão: [{ chave, rotulo, exemplo, campo, novo }].
  campos           jsonb NOT NULL DEFAULT '[]',
  etapa_id         integer REFERENCES comercial.etapas (id) ON DELETE SET NULL,
  responsavel_id   integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  etiquetas        text[] NOT NULL DEFAULT '{site}',
  boas_vindas      text,
  avisar           boolean NOT NULL DEFAULT true,
  -- Para onde mandar quem enviou por um formulário HTML comum (sem JavaScript).
  redirecionar     text,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  ultimo_envio_em  timestamptz
);
CREATE INDEX formularios_site_conta_idx ON comercial.formularios_site (conta_id, criado_em);

CREATE TABLE comercial.formulario_envios (
  id             bigserial PRIMARY KEY,
  formulario_id  bigint NOT NULL REFERENCES comercial.formularios_site (id) ON DELETE CASCADE,
  conta_id       integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  recebido_em    timestamptz NOT NULL DEFAULT now(),
  dados          jsonb NOT NULL,
  -- lead (novo), duplicado (juntou num lead que já existia), robo (barrado), erro, desligado.
  resultado      text NOT NULL CHECK (resultado IN ('lead', 'duplicado', 'robo', 'erro', 'desligado')),
  empresa_id     bigint,
  erro           text,
  ip             text
);
CREATE INDEX formulario_envios_idx ON comercial.formulario_envios (formulario_id, recebido_em DESC);

/* ───────────── Avisos (webhooks) ───────────── */

CREATE TABLE comercial.webhooks (
  id               bigserial PRIMARY KEY,
  conta_id         integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  nome             text NOT NULL,
  url              text NOT NULL,
  eventos          text[] NOT NULL,
  -- Segredo da assinatura HMAC (cifrado com CHAVE_CREDENCIAIS).
  segredo_cifrado  text NOT NULL,
  situacao         text NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo', 'pausado')),
  pausado_motivo   text,
  -- Criado pela API (Make/Zapier se inscrevendo sozinhos): a chave que criou.
  chave_id         bigint REFERENCES comercial.api_chaves (id) ON DELETE SET NULL,
  -- Desde quando as entregas falham sem nenhum sucesso no meio (3 dias: pausa).
  falhando_desde   timestamptz,
  criado_em        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhooks_conta_idx ON comercial.webhooks (conta_id) WHERE situacao = 'ativo';

CREATE TABLE comercial.webhook_entregas (
  id           bigserial PRIMARY KEY,
  webhook_id   bigint NOT NULL REFERENCES comercial.webhooks (id) ON DELETE CASCADE,
  conta_id     integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  evento       text NOT NULL,
  empresa_id   bigint,
  -- O que o gatilho anotou (ids, de/para); o corpo enviado é montado na 1ª tentativa e guardado.
  dados        jsonb NOT NULL DEFAULT '{}',
  corpo        jsonb,
  situacao     text NOT NULL DEFAULT 'pendente' CHECK (situacao IN ('pendente', 'entregue', 'falhou')),
  tentativas   integer NOT NULL DEFAULT 0,
  proxima_em   timestamptz NOT NULL DEFAULT now(),
  status_http  integer,
  resposta     text,
  duracao_ms   integer,
  erro         text,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  entregue_em  timestamptz
);
CREATE INDEX webhook_entregas_fila_idx ON comercial.webhook_entregas (proxima_em) WHERE situacao = 'pendente';
CREATE INDEX webhook_entregas_hist_idx ON comercial.webhook_entregas (webhook_id, criado_em DESC);

/* ───────────── Eventos (gatilhos) ───────────── */

-- Anota o evento para cada aviso ativo da conta que pediu por ele. Sem aviso, não grava nada.
CREATE FUNCTION comercial.emitir_aviso(p_conta integer, p_evento text, p_empresa bigint, p_dados jsonb)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_conta IS NULL THEN RETURN; END IF;
  INSERT INTO comercial.webhook_entregas (webhook_id, conta_id, evento, empresa_id, dados)
  SELECT w.id, w.conta_id, p_evento, p_empresa, coalesce(p_dados, '{}'::jsonb)
    FROM comercial.webhooks w
   WHERE w.conta_id = p_conta AND w.situacao = 'ativo' AND p_evento = ANY (w.eventos);
END $$;

CREATE FUNCTION comercial.aviso_oportunidade() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM comercial.webhooks w WHERE w.conta_id = NEW.conta_id AND w.situacao = 'ativo') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.etapa <> 'descartado' THEN
      PERFORM comercial.emitir_aviso(NEW.conta_id, 'lead.criado', NEW.empresa_id, '{}'::jsonb);
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.etapa_id IS DISTINCT FROM OLD.etapa_id OR NEW.etapa IS DISTINCT FROM OLD.etapa THEN
    IF OLD.etapa = 'descartado' AND NEW.etapa <> 'descartado' THEN
      PERFORM comercial.emitir_aviso(NEW.conta_id, 'lead.criado', NEW.empresa_id, '{}'::jsonb);
    ELSE
      PERFORM comercial.emitir_aviso(NEW.conta_id, 'lead.etapa', NEW.empresa_id,
        jsonb_build_object('deEtapaId', OLD.etapa_id, 'deEtapa', OLD.etapa));
    END IF;
    IF NEW.etapa = 'ganho' AND OLD.etapa <> 'ganho' THEN
      PERFORM comercial.emitir_aviso(NEW.conta_id, 'lead.ganho', NEW.empresa_id, '{}'::jsonb);
    ELSIF NEW.etapa = 'perdido' AND OLD.etapa <> 'perdido' THEN
      PERFORM comercial.emitir_aviso(NEW.conta_id, 'lead.perdido', NEW.empresa_id, '{}'::jsonb);
    END IF;
  END IF;
  IF NEW.responsavel_id IS DISTINCT FROM OLD.responsavel_id THEN
    PERFORM comercial.emitir_aviso(NEW.conta_id, 'lead.responsavel', NEW.empresa_id,
      jsonb_build_object('deResponsavelId', OLD.responsavel_id));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER oportunidades_aviso AFTER INSERT OR UPDATE OF etapa, etapa_id, responsavel_id
  ON comercial.oportunidades FOR EACH ROW EXECUTE FUNCTION comercial.aviso_oportunidade();

CREATE FUNCTION comercial.aviso_mensagem() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.direcao = 'recebida' THEN
    PERFORM comercial.emitir_aviso(NEW.conta_id, 'mensagem.recebida', NEW.empresa_id,
      jsonb_build_object('mensagemId', NEW.id));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER mensagens_aviso AFTER INSERT ON comercial.mensagens
  FOR EACH ROW EXECUTE FUNCTION comercial.aviso_mensagem();

CREATE FUNCTION comercial.aviso_tarefa() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tipo = 'reuniao' AND NEW.empresa_id IS NOT NULL THEN
    PERFORM comercial.emitir_aviso(NEW.conta_id, 'reuniao.marcada', NEW.empresa_id,
      jsonb_build_object('tarefaId', NEW.id));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tarefas_aviso AFTER INSERT ON comercial.tarefas
  FOR EACH ROW EXECUTE FUNCTION comercial.aviso_tarefa();

CREATE FUNCTION comercial.aviso_ligacao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.resultado IS NOT NULL AND OLD.resultado IS NULL THEN
    PERFORM comercial.emitir_aviso(NEW.conta_id, 'ligacao.encerrada', NEW.empresa_id,
      jsonb_build_object('ligacaoId', NEW.id));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ligacoes_aviso AFTER UPDATE OF resultado ON comercial.ligacoes
  FOR EACH ROW EXECUTE FUNCTION comercial.aviso_ligacao();

/* ───────────── Plano ───────────── */

-- A API vem no Time e no Escala. Plano personalizado com os recursos de equipe também ganha.
UPDATE cadastro.tabela_precos
   SET dados = jsonb_set(dados, '{planos,time,recursos}', (dados #> '{planos,time,recursos}') || '"api"')
 WHERE id = 1 AND jsonb_typeof(dados #> '{planos,time,recursos}') = 'array'
   AND NOT (dados #> '{planos,time,recursos}') ? 'api';
UPDATE cadastro.tabela_precos
   SET dados = jsonb_set(dados, '{planos,escala,recursos}', (dados #> '{planos,escala,recursos}') || '"api"')
 WHERE id = 1 AND jsonb_typeof(dados #> '{planos,escala,recursos}') = 'array'
   AND NOT (dados #> '{planos,escala,recursos}') ? 'api';
UPDATE cadastro.organizacoes
   SET recursos_extras = array_append(recursos_extras, 'api')
 WHERE plano = 'personalizado' AND 'equipe' = ANY (recursos_extras)
   AND NOT 'api' = ANY (recursos_extras);
