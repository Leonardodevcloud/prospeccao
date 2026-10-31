-- Ligações pelo CRM (módulo Ligações): o comercial liga pelo navegador com o número da empresa
-- (LiveKit + tronco SIP do provedor), a ligação é gravada no navegador e, depois que desliga, a IA
-- transcreve e resume (clima da conversa e o que fazer no lead).

-- Franquia própria da organização (null = a do plano).
ALTER TABLE cadastro.organizacoes
  ADD COLUMN limite_minutos_ligacao integer CHECK (limite_minutos_ligacao >= 0);

-- Configuração da conta (Gestão › Telefonia).
CREATE TABLE comercial.telefonia_contas (
  conta_id        integer PRIMARY KEY REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  gravar          boolean NOT NULL DEFAULT true,
  aviso_gravacao  text NOT NULL DEFAULT 'Esta ligação pode ser gravada para melhorar o nosso atendimento.',
  aviso_falado    boolean NOT NULL DEFAULT true,
  transcrever     boolean NOT NULL DEFAULT true,
  toque_segundos  integer NOT NULL DEFAULT 25 CHECK (toque_segundos BETWEEN 10 AND 60),
  mesmo_ddd       boolean NOT NULL DEFAULT true,
  guardar_meses   integer NOT NULL DEFAULT 12 CHECK (guardar_meses BETWEEN 1 AND 60),
  atualizado_em   timestamptz NOT NULL DEFAULT now()
);

-- Números da empresa (comprados no provedor pela plataforma e ligados ao LiveKit).
CREATE TABLE comercial.telefonia_numeros (
  id          bigserial PRIMARY KEY,
  conta_id    integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  numero      text NOT NULL CHECK (numero ~ '^\d{10,11}$'),
  rotulo      text,
  principal   boolean NOT NULL DEFAULT false,
  ativo       boolean NOT NULL DEFAULT true,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
-- Um número é de uma conta só.
CREATE UNIQUE INDEX telefonia_numeros_numero_uq ON comercial.telefonia_numeros (numero) WHERE ativo;
CREATE INDEX telefonia_numeros_conta_idx ON comercial.telefonia_numeros (conta_id);

CREATE TABLE comercial.ligacoes (
  id                bigserial PRIMARY KEY,
  conta_id          integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  empresa_id        bigint,
  usuario_id        integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  direcao           text NOT NULL DEFAULT 'saida' CHECK (direcao IN ('saida', 'entrada')),
  -- Número do lead (só dígitos, DDD + número) e o da empresa usado na ligação.
  telefone          text NOT NULL,
  numero_empresa    text,
  sala              text NOT NULL UNIQUE,
  situacao          text NOT NULL DEFAULT 'preparando'
                    CHECK (situacao IN ('preparando', 'chamando', 'tocando', 'em_andamento', 'encerrada', 'falhou')),
  motivo_fim        text,
  iniciada_em       timestamptz NOT NULL DEFAULT now(),
  atendida_em       timestamptz,
  encerrada_em      timestamptz,
  duracao_segundos  integer,
  -- "Como foi?" (o comercial confirma; a IA sugere).
  resultado         text CHECK (resultado IN ('conversou', 'nao_atendeu', 'caixa_postal', 'ocupado', 'numero_errado', 'nao_ligar')),
  resultado_em      timestamptz,
  nota              text,
  -- Gravação (feita no navegador) e o que sai dela.
  gravar            boolean NOT NULL DEFAULT true,
  audio_chave       text,
  audio_bytes       bigint,
  processamento     text NOT NULL DEFAULT 'sem_gravacao'
                    CHECK (processamento IN ('sem_gravacao', 'aguardando', 'processando', 'pronto', 'erro')),
  processar_em      timestamptz,
  tentativas        integer NOT NULL DEFAULT 0,
  erro              text,
  transcricao       text CHECK (transcricao IN ('pronta', 'sem_audio', 'desligada', 'erro')),
  resumo            jsonb,
  resumo_em         timestamptz,
  criado_em         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ligacoes_conta_idx ON comercial.ligacoes (conta_id, iniciada_em DESC);
CREATE INDEX ligacoes_lead_idx ON comercial.ligacoes (conta_id, empresa_id, iniciada_em DESC);
CREATE INDEX ligacoes_usuario_idx ON comercial.ligacoes (conta_id, usuario_id, iniciada_em DESC);
CREATE INDEX ligacoes_processar_idx ON comercial.ligacoes (processar_em) WHERE processamento IN ('aguardando', 'processando');
CREATE INDEX ligacoes_abertas_idx ON comercial.ligacoes (iniciada_em) WHERE situacao IN ('preparando', 'chamando', 'tocando', 'em_andamento');

-- Arquivos gravados pelo navegador: a voz de cada lado (para a transcrição saber quem falou) e a
-- conversa junta (para ouvir na ficha).
CREATE TABLE comercial.ligacao_audios (
  id          bigserial PRIMARY KEY,
  ligacao_id  bigint NOT NULL REFERENCES comercial.ligacoes (id) ON DELETE CASCADE,
  conta_id    integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  quem        text NOT NULL CHECK (quem IN ('voce', 'lead', 'conversa')),
  chave       text NOT NULL,
  tipo        text NOT NULL,
  bytes       bigint NOT NULL,
  -- Começo da gravação em relação ao atendimento (alinha as falas dos dois lados).
  deslocamento_ms integer NOT NULL DEFAULT 0,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ligacao_id, quem)
);

CREATE TABLE comercial.ligacao_falas (
  id          bigserial PRIMARY KEY,
  ligacao_id  bigint NOT NULL REFERENCES comercial.ligacoes (id) ON DELETE CASCADE,
  conta_id    integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  quem        text NOT NULL CHECK (quem IN ('voce', 'lead')),
  nome        text NOT NULL,
  inicio_ms   integer NOT NULL CHECK (inicio_ms >= 0),
  fim_ms      integer NOT NULL CHECK (fim_ms >= inicio_ms),
  texto       text NOT NULL
);
CREATE INDEX ligacao_falas_idx ON comercial.ligacao_falas (ligacao_id, inicio_ms);

-- Número do lead confirmado numa ligação (passa a ser o primeiro da lista).
CREATE TABLE comercial.telefones_confirmados (
  conta_id      integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  empresa_id    bigint NOT NULL,
  telefone      text NOT NULL,
  confirmado_em timestamptz NOT NULL DEFAULT now(),
  usuario_id    integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  PRIMARY KEY (conta_id, empresa_id, telefone)
);

-- "Não ligar mais" (pediu para não ser contatado por telefone).
ALTER TABLE comercial.oportunidades ADD COLUMN nao_ligar_em timestamptz;

-- O histórico do lead aponta para a ligação (o card mostra a gravação e o resumo).
ALTER TABLE comercial.atividades ADD COLUMN ligacao_id bigint REFERENCES comercial.ligacoes (id) ON DELETE SET NULL;

-- Argos: as ligações (resumo da IA), no mesmo recorte das outras views.
CREATE VIEW cerebro.ligacoes WITH (security_barrier = true) AS
SELECT l.id AS ligacao_id, l.conta_id AS unidade_id, l.empresa_id, l.usuario_id AS responsavel_id,
       u.nome AS responsavel, l.direcao, l.iniciada_em, l.atendida_em, l.duracao_segundos, l.resultado,
       l.resumo->>'resumo' AS resumo, l.resumo->>'clima' AS clima, l.resumo->>'sentimento' AS sentimento,
       l.resumo->>'interesse' AS interesse, l.resumo->>'proximoPasso' AS proximo_passo
  FROM comercial.ligacoes l
  LEFT JOIN cadastro.usuarios u ON u.id = l.usuario_id
 WHERE ((SELECT tudo FROM cerebro_priv.escopo()) OR l.conta_id = ANY ((SELECT contas FROM cerebro_priv.escopo())::integer[]))
   AND ((SELECT cerebro_priv.dono()) IS NULL
        OR l.usuario_id = (SELECT cerebro_priv.dono())
        OR EXISTS (SELECT 1 FROM comercial.oportunidades b WHERE b.conta_id = l.conta_id AND b.empresa_id = l.empresa_id
                    AND b.responsavel_id = (SELECT cerebro_priv.dono())));
COMMENT ON VIEW cerebro.ligacoes IS 'Ligações feitas pelo CRM: quem ligou, quando, duração, resultado (conversou, não atendeu, caixa postal…) e o resumo da IA com o clima da conversa.';
