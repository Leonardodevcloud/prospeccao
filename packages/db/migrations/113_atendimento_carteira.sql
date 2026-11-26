-- v177: atendimento com carteira (recurso `carteira`, plano Escala).
-- As Conversas viram um canal de atendimento: cada vez que um cliente escreve, abre (ou continua) um
-- atendimento com protocolo. Cliente com dono cai na fila do dono ("Minha carteira"); sem dono, na
-- Fila geral, e quem responder vira o dono (se a conta quiser). O atendimento é encerrado com motivo,
-- etiquetas, mensagem de encerramento e pesquisa de 1 a 5; reabre sozinho quando o cliente volta.
-- Abrir, assumir e a nota da pesquisa são feitos por um gatilho em comercial.mensagens, para valer
-- em qualquer caminho (WhatsApp, Instagram, equipe, IA).

CREATE TABLE comercial.config_atendimento (
  conta_id                 integer PRIMARY KEY REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  ativo                    boolean NOT NULL DEFAULT false,
  -- Quem atende um cliente sem dono (Fila geral) vira o dono dele.
  vira_dono                boolean NOT NULL DEFAULT true,
  -- O dono não respondeu em X minutos: aparece também na Fila geral (null = não).
  espera_dono_min          integer DEFAULT 10 CHECK (espera_dono_min BETWEEN 1 AND 240),
  -- Dono em pausa (ou desativado): o atendimento novo vai direto para a Fila geral.
  pausa_vai_geral          boolean NOT NULL DEFAULT true,
  motivos                  text[] NOT NULL DEFAULT ARRAY[
                             'Venda fechada', 'Orçamento enviado', 'Dúvida resolvida', 'Troca ou garantia',
                             'Cliente não respondeu', 'Sem estoque ou indisponível'],
  mandar_encerramento      boolean NOT NULL DEFAULT true,
  msg_encerramento         text NOT NULL DEFAULT 'Obrigado pelo contato, {nome}! Seu atendimento {protocolo} foi encerrado. Se precisar, é só chamar aqui.',
  pesquisa                 boolean NOT NULL DEFAULT true,
  -- Aguardando o cliente por X horas sem resposta: encerra sozinho (null = não).
  encerrar_sem_resposta_h  integer DEFAULT 24 CHECK (encerrar_sem_resposta_h BETWEEN 1 AND 720),
  protocolo_na_primeira    boolean NOT NULL DEFAULT false,
  atualizado_em            timestamptz NOT NULL DEFAULT now()
);

-- Etiquetas da conta (com cor), usadas no atendimento e no cliente (oportunidades.etiquetas).
CREATE TABLE comercial.etiquetas (
  id         serial PRIMARY KEY,
  conta_id   integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  nome       text NOT NULL CHECK (length(nome) BETWEEN 1 AND 30),
  cor        text NOT NULL DEFAULT 'cinza' CHECK (cor IN ('cinza', 'azul', 'verde', 'laranja', 'vermelho', 'roxo')),
  ordem      integer NOT NULL DEFAULT 0,
  criado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX etiquetas_nome ON comercial.etiquetas (conta_id, lower(nome));

CREATE TABLE comercial.atendimentos (
  id                    bigserial PRIMARY KEY,
  conta_id              integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  empresa_id            bigint NOT NULL,
  protocolo             text NOT NULL,
  canal                 text NOT NULL DEFAULT 'whatsapp' CHECK (canal IN ('whatsapp', 'instagram')),
  -- aberto: esperando a equipe; aguardando: a equipe respondeu, esperando o cliente.
  situacao              text NOT NULL DEFAULT 'aberto' CHECK (situacao IN ('aberto', 'aguardando', 'encerrado')),
  -- Com quem está (null = Fila geral; com grupo_id, a fila daquele grupo).
  atendente_id          integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  grupo_id              integer REFERENCES cadastro.grupos_atendimento (id) ON DELETE SET NULL,
  -- carteira: o cliente já tinha dono quando chegou; geral: chegou sem dono.
  origem                text NOT NULL DEFAULT 'geral' CHECK (origem IN ('carteira', 'geral')),
  reaberto              boolean NOT NULL DEFAULT false,
  aberto_em             timestamptz NOT NULL DEFAULT now(),
  primeira_resposta_em  timestamptz,
  ultima_cliente_em     timestamptz,
  ultima_equipe_em      timestamptz,
  encerrado_em          timestamptz,
  encerrado_por         integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  motivo                text,
  etiquetas             text[] NOT NULL DEFAULT '{}',
  pesquisa_em           timestamptz,
  nota_cliente          smallint CHECK (nota_cliente BETWEEN 1 AND 5),
  nota_em               timestamptz
);
CREATE UNIQUE INDEX atendimentos_protocolo ON comercial.atendimentos (conta_id, protocolo);
-- Um atendimento em aberto por cliente.
CREATE UNIQUE INDEX atendimentos_um_aberto ON comercial.atendimentos (conta_id, empresa_id)
  WHERE situacao <> 'encerrado';
CREATE INDEX atendimentos_filas ON comercial.atendimentos (conta_id, situacao, atendente_id)
  WHERE situacao <> 'encerrado';
CREATE INDEX atendimentos_lead ON comercial.atendimentos (conta_id, empresa_id, aberto_em DESC);
CREATE INDEX atendimentos_encerrados ON comercial.atendimentos (conta_id, encerrado_em DESC)
  WHERE situacao = 'encerrado';

-- O que aconteceu no atendimento (aparece na conversa): abriu, assumiu, transferiu, nota interna…
CREATE TABLE comercial.atendimento_eventos (
  id               bigserial PRIMARY KEY,
  conta_id         integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  atendimento_id   bigint NOT NULL REFERENCES comercial.atendimentos (id) ON DELETE CASCADE,
  empresa_id       bigint NOT NULL,
  tipo             text NOT NULL CHECK (tipo IN ('aberto', 'reaberto', 'assumiu', 'transferiu', 'nota',
                                                 'encerrou', 'pesquisa', 'carteira', 'etiquetas')),
  usuario_id       integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  para_usuario_id  integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  para_grupo_id    integer REFERENCES cadastro.grupos_atendimento (id) ON DELETE SET NULL,
  texto            text,
  criado_em        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX atendimento_eventos_lead ON comercial.atendimento_eventos (conta_id, empresa_id, criado_em);

-- Número do protocolo: AAAA-MMDD-NNNN, contado por conta e dia (de Brasília).
CREATE TABLE comercial.atendimento_contador (
  conta_id  integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  dia       date NOT NULL,
  n         integer NOT NULL DEFAULT 0,
  PRIMARY KEY (conta_id, dia)
);

-- Disponível / Em pausa (cada pessoa marca no menu).
ALTER TABLE cadastro.usuarios
  ADD COLUMN disponivel boolean NOT NULL DEFAULT true,
  ADD COLUMN pausa_desde timestamptz;

-- Protocolo novo da conta (AAAA-MMDD-NNNN, dia de Brasília).
CREATE OR REPLACE FUNCTION comercial.novo_protocolo(p_conta integer) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  num  integer;
BEGIN
  INSERT INTO comercial.atendimento_contador AS ac (conta_id, dia, n) VALUES (p_conta, hoje, 1)
  ON CONFLICT (conta_id, dia) DO UPDATE SET n = ac.n + 1
  RETURNING ac.n INTO num;
  RETURN to_char(hoje, 'YYYY-MMDD') || '-' || lpad(num::text, 4, '0');
END;
$$;

CREATE OR REPLACE FUNCTION comercial.atendimento_da_mensagem() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cfg   comercial.config_atendimento%ROWTYPE;
  a     comercial.atendimentos%ROWTYPE;
  ult   comercial.atendimentos%ROWTYPE;
  dono  integer;
  livre boolean;
  quem  integer;
  em    timestamptz;
BEGIN
  IF NEW.canal NOT IN ('whatsapp', 'instagram') THEN
    RETURN NEW;
  END IF;
  SELECT * INTO cfg FROM comercial.config_atendimento WHERE conta_id = NEW.conta_id AND ativo;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT * INTO a FROM comercial.atendimentos
   WHERE conta_id = NEW.conta_id AND empresa_id = NEW.empresa_id AND situacao <> 'encerrado'
   FOR UPDATE;

  IF NEW.direcao = 'recebida' THEN
    IF FOUND THEN
      UPDATE comercial.atendimentos
         SET ultima_cliente_em = NEW.criado_em, situacao = 'aberto'
       WHERE id = a.id;
      RETURN NEW;
    END IF;

    -- A resposta da pesquisa (só o número de 1 a 5, até 48 h depois) não reabre o atendimento.
    SELECT * INTO ult FROM comercial.atendimentos
     WHERE conta_id = NEW.conta_id AND empresa_id = NEW.empresa_id AND situacao = 'encerrado'
     ORDER BY encerrado_em DESC LIMIT 1;
    IF FOUND AND ult.pesquisa_em IS NOT NULL AND ult.nota_cliente IS NULL
       AND NEW.criado_em < ult.pesquisa_em + interval '48 hours'
       AND btrim(coalesce(NEW.texto, '')) ~ '^[1-5]$' THEN
      UPDATE comercial.atendimentos
         SET nota_cliente = btrim(NEW.texto)::smallint, nota_em = NEW.criado_em
       WHERE id = ult.id;
      INSERT INTO comercial.atendimento_eventos (conta_id, atendimento_id, empresa_id, tipo, texto, criado_em)
      VALUES (NEW.conta_id, ult.id, NEW.empresa_id, 'pesquisa', btrim(NEW.texto), NEW.criado_em);
      RETURN NEW;
    END IF;

    SELECT o.responsavel_id INTO dono FROM comercial.oportunidades o
     WHERE o.conta_id = NEW.conta_id AND o.empresa_id = NEW.empresa_id;
    IF dono IS NOT NULL THEN
      SELECT u.ativo AND u.disponivel INTO livre FROM cadastro.usuarios u WHERE u.id = dono;
    END IF;

    INSERT INTO comercial.atendimentos
      (conta_id, empresa_id, protocolo, canal, situacao, atendente_id, origem, reaberto, aberto_em, ultima_cliente_em)
    VALUES (
      NEW.conta_id, NEW.empresa_id, comercial.novo_protocolo(NEW.conta_id), NEW.canal, 'aberto',
      CASE WHEN dono IS NOT NULL AND (coalesce(livre, false) OR NOT cfg.pausa_vai_geral) THEN dono END,
      CASE WHEN dono IS NOT NULL THEN 'carteira' ELSE 'geral' END,
      ult.id IS NOT NULL AND ult.encerrado_em > now() - interval '7 days',
      NEW.criado_em, NEW.criado_em)
    RETURNING * INTO a;
    INSERT INTO comercial.atendimento_eventos (conta_id, atendimento_id, empresa_id, tipo, para_usuario_id, criado_em)
    VALUES (NEW.conta_id, a.id, NEW.empresa_id, CASE WHEN a.reaberto THEN 'reaberto' ELSE 'aberto' END,
            a.atendente_id, NEW.criado_em);
    RETURN NEW;
  END IF;

  -- Enviada: só conta o que saiu de verdade (rascunho e fila da IA, quando saírem, chegam pelo UPDATE).
  IF NEW.status <> 'enviada' OR NEW.origem = 'automatico' THEN
    RETURN NEW;
  END IF;
  quem := CASE WHEN NEW.origem = 'humano' THEN NEW.usuario_id END;
  em := coalesce(NEW.enviado_em, NEW.criado_em);
  IF NOT FOUND THEN
    -- Alguém da equipe chamou o cliente (Nova conversa): abre o atendimento já esperando o cliente.
    IF quem IS NULL THEN
      RETURN NEW;
    END IF;
    SELECT o.responsavel_id INTO dono FROM comercial.oportunidades o
     WHERE o.conta_id = NEW.conta_id AND o.empresa_id = NEW.empresa_id;
    INSERT INTO comercial.atendimentos
      (conta_id, empresa_id, protocolo, canal, situacao, atendente_id, origem, aberto_em, primeira_resposta_em,
       ultima_equipe_em)
    VALUES (NEW.conta_id, NEW.empresa_id, comercial.novo_protocolo(NEW.conta_id), NEW.canal, 'aguardando', quem,
            CASE WHEN dono IS NOT NULL THEN 'carteira' ELSE 'geral' END, em, em, em)
    RETURNING * INTO a;
    INSERT INTO comercial.atendimento_eventos (conta_id, atendimento_id, empresa_id, tipo, usuario_id, para_usuario_id, criado_em)
    VALUES (NEW.conta_id, a.id, NEW.empresa_id, 'aberto', quem, quem, em);
  ELSE
    UPDATE comercial.atendimentos
       SET situacao = 'aguardando',
           ultima_equipe_em = em,
           primeira_resposta_em = coalesce(primeira_resposta_em, em),
           atendente_id = coalesce(quem, atendente_id),
           grupo_id = CASE WHEN quem IS NOT NULL THEN NULL ELSE grupo_id END
     WHERE id = a.id;
    IF quem IS NOT NULL AND a.atendente_id IS DISTINCT FROM quem THEN
      INSERT INTO comercial.atendimento_eventos (conta_id, atendimento_id, empresa_id, tipo, usuario_id, criado_em)
      VALUES (NEW.conta_id, a.id, NEW.empresa_id, 'assumiu', quem, em);
    END IF;
  END IF;
  IF quem IS NOT NULL AND cfg.vira_dono THEN
    UPDATE comercial.oportunidades SET responsavel_id = quem
     WHERE conta_id = NEW.conta_id AND empresa_id = NEW.empresa_id AND responsavel_id IS NULL;
    IF FOUND THEN
      INSERT INTO comercial.atendimento_eventos (conta_id, atendimento_id, empresa_id, tipo, usuario_id, para_usuario_id, criado_em)
      VALUES (NEW.conta_id, a.id, NEW.empresa_id, 'carteira', quem, quem, em);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER mensagens_atendimento AFTER INSERT ON comercial.mensagens
  FOR EACH ROW EXECUTE FUNCTION comercial.atendimento_da_mensagem();

-- A IA (ou a cadência) mandou a mensagem que estava na fila: o atendimento passa a aguardar o cliente.
CREATE OR REPLACE FUNCTION comercial.atendimento_da_mensagem_enviada() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.direcao = 'enviada' AND NEW.status = 'enviada' AND OLD.status IS DISTINCT FROM 'enviada'
     AND NEW.origem IN ('agente', 'cadencia', 'sequencia') THEN
    UPDATE comercial.atendimentos
       SET situacao = 'aguardando',
           ultima_equipe_em = coalesce(NEW.enviado_em, now()),
           primeira_resposta_em = coalesce(primeira_resposta_em, coalesce(NEW.enviado_em, now()))
     WHERE conta_id = NEW.conta_id AND empresa_id = NEW.empresa_id AND situacao <> 'encerrado';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER mensagens_atendimento_enviada AFTER UPDATE OF status ON comercial.mensagens
  FOR EACH ROW EXECUTE FUNCTION comercial.atendimento_da_mensagem_enviada();

-- O recurso novo entra no plano Escala da tabela de preços salva.
UPDATE cadastro.tabela_precos
   SET dados = jsonb_set(dados, '{planos,escala,recursos}', (dados #> '{planos,escala,recursos}') || '"carteira"'),
       atualizado_em = now()
 WHERE id = 1 AND jsonb_typeof(dados #> '{planos,escala,recursos}') = 'array'
   AND NOT (dados #> '{planos,escala,recursos}') ? 'carteira';
