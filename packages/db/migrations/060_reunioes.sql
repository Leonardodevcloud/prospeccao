-- Reuniões por vídeo no próprio sistema. Dono: api.
--
-- Uma SALA é a reunião marcada (normalmente presa a uma reunião da agenda) com um link público
-- (/r/<código>). Cada vez que a sala é usada abre uma SESSÃO (a sala do serviço de vídeo, a gravação,
-- a transcrição e o resumo da IA). Reabrir a sala depois de encerrada abre outra sessão.
--
-- O vídeo passa pelo LiveKit; as gravações vão para um armazenamento de arquivos (S3/R2) e aqui fica
-- só a chave de cada arquivo. O chat e os arquivos do chat ficam no banco, como os da conversa.

CREATE TABLE comercial.salas (
  id                  bigserial PRIMARY KEY,
  conta_id            integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  -- Reunião da agenda (apagar a tarefa não apaga o que já foi gravado).
  tarefa_id           bigint UNIQUE REFERENCES comercial.tarefas (id) ON DELETE SET NULL,
  empresa_id          bigint REFERENCES descoberta.empresas (id) ON DELETE SET NULL,
  -- Quem conduz (o dono da reunião na agenda).
  anfitriao_id        integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  codigo              text NOT NULL UNIQUE CHECK (codigo ~ '^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$'),
  titulo              text NOT NULL CHECK (length(titulo) BETWEEN 1 AND 200),
  inicio              timestamptz NOT NULL,
  fim                 timestamptz,
  abre_minutos_antes  integer NOT NULL DEFAULT 10 CHECK (abre_minutos_antes BETWEEN 0 AND 120),
  entrada             text NOT NULL DEFAULT 'livre' CHECK (entrada IN ('livre', 'aprovacao')),
  gravar              boolean NOT NULL DEFAULT true,
  transcrever         boolean NOT NULL DEFAULT true,
  status              text NOT NULL DEFAULT 'marcada'
                      CHECK (status IN ('marcada', 'ao_vivo', 'encerrada', 'cancelada')),
  -- Convite mandado ao lead pelo WhatsApp (pelo botão), para não mandar duas vezes sem querer.
  convite_enviado_em  timestamptz,
  criado_por          integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  criado_em           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX salas_conta_inicio_idx ON comercial.salas (conta_id, inicio DESC);
CREATE INDEX salas_empresa_idx ON comercial.salas (empresa_id) WHERE empresa_id IS NOT NULL;

CREATE TABLE comercial.sala_sessoes (
  id                    bigserial PRIMARY KEY,
  sala_id               bigint NOT NULL REFERENCES comercial.salas (id) ON DELETE CASCADE,
  conta_id              integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  -- Nome da sala no LiveKit (um por sessão).
  sala_video            text NOT NULL UNIQUE,
  iniciada_em           timestamptz NOT NULL DEFAULT now(),
  encerrada_em          timestamptz,
  -- Gravação pedida para esta sessão (a sala podia ter a gravação ligada e o armazenamento não).
  gravar                boolean NOT NULL DEFAULT false,
  transcrever           boolean NOT NULL DEFAULT false,
  -- ao_vivo → processando (esperando os arquivos, transcrevendo, resumindo) → pronta;
  -- encerrada: sem gravação para processar.
  situacao              text NOT NULL DEFAULT 'ao_vivo'
                        CHECK (situacao IN ('ao_vivo', 'processando', 'pronta', 'encerrada', 'erro')),
  -- Arquivo de vídeo da sala inteira (chave no armazenamento).
  video_chave           text,
  video_bytes           bigint,
  duracao_segundos      integer,
  transcricao           text CHECK (transcricao IN ('pendente', 'pronta', 'sem_audio', 'desligada', 'erro')),
  resumo                jsonb,
  resumo_em             timestamptz,
  erro                  text,
  tentativas            integer NOT NULL DEFAULT 0,
  -- Próxima tentativa de processar (falha na transcrição ou na IA espera um pouco).
  processar_em          timestamptz,
  tarefas_criadas_em    timestamptz
);
CREATE INDEX sala_sessoes_sala_idx ON comercial.sala_sessoes (sala_id, iniciada_em DESC);
CREATE INDEX sala_sessoes_processar_idx ON comercial.sala_sessoes (processar_em)
  WHERE situacao = 'processando';

CREATE TABLE comercial.sala_participantes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sala_id             bigint NOT NULL REFERENCES comercial.salas (id) ON DELETE CASCADE,
  conta_id            integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  -- Identidade no vídeo: "u-<usuário>" para o time, "c-<id>" para o convidado.
  identidade          text NOT NULL,
  nome                text NOT NULL CHECK (length(nome) BETWEEN 1 AND 80),
  tipo                text NOT NULL CHECK (tipo IN ('equipe', 'convidado')),
  usuario_id          integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  -- Convidado na sala de espera: aguardando → liberado ou recusado.
  situacao            text NOT NULL DEFAULT 'liberado' CHECK (situacao IN ('aguardando', 'liberado', 'recusado')),
  -- Hash do segredo que o navegador do convidado guarda (volta com a mesma identidade, pergunta se foi liberado).
  segredo_hash        text,
  aceitou_gravacao_em timestamptz,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  entrou_em           timestamptz,
  saiu_em             timestamptz,
  -- Tempo somado na sala (todas as entradas).
  segundos_na_sala    integer NOT NULL DEFAULT 0,
  -- Entrada em andamento (participant_joined sem o left ainda).
  presente_desde      timestamptz,
  UNIQUE (sala_id, identidade)
);
CREATE INDEX sala_participantes_espera_idx ON comercial.sala_participantes (sala_id) WHERE situacao = 'aguardando';

CREATE TABLE comercial.sala_arquivos (
  id          bigserial PRIMARY KEY,
  sala_id     bigint NOT NULL REFERENCES comercial.salas (id) ON DELETE CASCADE,
  conta_id    integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  nome        text NOT NULL,
  mime        text NOT NULL,
  tamanho     integer NOT NULL CHECK (tamanho BETWEEN 1 AND 10485760),
  dados       bytea NOT NULL,
  criado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE comercial.sala_mensagens (
  id               bigserial PRIMARY KEY,
  sala_id          bigint NOT NULL REFERENCES comercial.salas (id) ON DELETE CASCADE,
  conta_id         integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  sessao_id        bigint REFERENCES comercial.sala_sessoes (id) ON DELETE SET NULL,
  participante_id  uuid REFERENCES comercial.sala_participantes (id) ON DELETE SET NULL,
  autor            text NOT NULL,
  texto            text CHECK (length(texto) <= 2000),
  arquivo_id       bigint REFERENCES comercial.sala_arquivos (id) ON DELETE SET NULL,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  CHECK (texto IS NOT NULL OR arquivo_id IS NOT NULL)
);
CREATE INDEX sala_mensagens_sala_idx ON comercial.sala_mensagens (sala_id, id);

-- Cada arquivo gravado pelo LiveKit: a sala inteira (vídeo) ou o microfone de uma pessoa (áudio,
-- para a transcrição saber quem falou).
CREATE TABLE comercial.sala_gravacoes (
  id             bigserial PRIMARY KEY,
  sessao_id      bigint NOT NULL REFERENCES comercial.sala_sessoes (id) ON DELETE CASCADE,
  conta_id       integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  gravacao_id    text NOT NULL UNIQUE,
  tipo           text NOT NULL CHECK (tipo IN ('sala', 'audio')),
  identidade     text,
  nome           text,
  trilha_id      text,
  chave          text,
  situacao       text NOT NULL DEFAULT 'gravando' CHECK (situacao IN ('gravando', 'pronta', 'falhou')),
  iniciada_em    timestamptz,
  encerrada_em   timestamptz,
  bytes          bigint,
  segundos       integer,
  erro           text,
  criado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sala_gravacoes_sessao_idx ON comercial.sala_gravacoes (sessao_id);
-- Um vídeo da sala por sessão e um áudio por microfone (o LiveKit pode repetir o mesmo aviso).
CREATE UNIQUE INDEX sala_gravacoes_video_uq ON comercial.sala_gravacoes (sessao_id) WHERE tipo = 'sala';
CREATE UNIQUE INDEX sala_gravacoes_trilha_uq ON comercial.sala_gravacoes (sessao_id, trilha_id) WHERE tipo = 'audio';

-- Transcrição: uma linha por trecho falado, com quem falou e quando (ms desde o início da sessão).
CREATE TABLE comercial.sala_falas (
  id          bigserial PRIMARY KEY,
  sessao_id   bigint NOT NULL REFERENCES comercial.sala_sessoes (id) ON DELETE CASCADE,
  conta_id    integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  identidade  text NOT NULL,
  nome        text NOT NULL,
  inicio_ms   integer NOT NULL CHECK (inicio_ms >= 0),
  fim_ms      integer NOT NULL CHECK (fim_ms >= inicio_ms),
  texto       text NOT NULL
);
CREATE INDEX sala_falas_sessao_idx ON comercial.sala_falas (sessao_id, inicio_ms);

-- Argos: o que foi conversado nas reuniões (resumo da IA), no mesmo recorte das outras views.
CREATE VIEW cerebro.reunioes WITH (security_barrier = true) AS
SELECT ss.id AS reuniao_id, s.conta_id AS unidade_id, s.empresa_id, s.titulo, s.anfitriao_id AS responsavel_id,
       u.nome AS responsavel, ss.iniciada_em, ss.encerrada_em, ss.duracao_segundos,
       (ss.video_chave IS NOT NULL) AS gravada,
       ss.resumo->>'resumo' AS resumo,
       ss.resumo->>'interesse' AS interesse,
       (SELECT string_agg(d->>'tipo' || ': ' || (d->>'texto'), ' | ')
          FROM jsonb_array_elements(coalesce(ss.resumo->'destaques', '[]'::jsonb)) d) AS destaques,
       (SELECT string_agg(p->>'texto', ' | ')
          FROM jsonb_array_elements(coalesce(ss.resumo->'proximosPassos', '[]'::jsonb)) p) AS proximos_passos,
       (SELECT count(*)::int FROM comercial.sala_participantes sp
         WHERE sp.sala_id = s.id AND sp.situacao = 'liberado' AND sp.entrou_em IS NOT NULL) AS participantes
  FROM comercial.sala_sessoes ss
  JOIN comercial.salas s ON s.id = ss.sala_id
  LEFT JOIN cadastro.usuarios u ON u.id = s.anfitriao_id
 WHERE ((SELECT tudo FROM cerebro_priv.escopo()) OR s.conta_id = ANY ((SELECT contas FROM cerebro_priv.escopo())::integer[]))
   AND ((SELECT cerebro_priv.dono()) IS NULL
        OR s.anfitriao_id = (SELECT cerebro_priv.dono())
        OR EXISTS (SELECT 1 FROM comercial.oportunidades b WHERE b.conta_id = s.conta_id AND b.empresa_id = s.empresa_id
                    AND b.responsavel_id = (SELECT cerebro_priv.dono())));
