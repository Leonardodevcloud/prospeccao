-- Vídeos com IA (módulo à parte): a empresa sobe um vídeo falado, o worker-videos corta, legenda,
-- anima e trata o som, e a pessoa revisa e gera de novo. O original e o editado ficam no
-- armazenamento (videos/<conta>/<id>/…); aqui fica o que a IA decidiu e o que a pessoa mudou.

-- Franquia própria de vídeos por mês (null = a da tabela de preços).
ALTER TABLE cadastro.organizacoes ADD COLUMN IF NOT EXISTS limite_videos_mes integer;

CREATE TABLE comercial.videos (
  id               serial PRIMARY KEY,
  conta_id         integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  titulo           text NOT NULL,
  situacao         text NOT NULL DEFAULT 'enviando'
                   CHECK (situacao IN ('enviando', 'na_fila', 'editando', 'revisar', 'pronto', 'falhou')),
  etapa            text CHECK (etapa IN ('preparando', 'ouvindo', 'cortando', 'rosto', 'montando', 'gerando', 'conferindo')),
  progresso        integer NOT NULL DEFAULT 0 CHECK (progresso BETWEEN 0 AND 100),
  -- Assunto, estilo da legenda, ritmo, transição, chamada e instruções (OpcoesVideo no shared).
  opcoes           jsonb NOT NULL DEFAULT '{}',
  -- O arquivo enviado: chega em partes (envio_id é o envio em partes no armazenamento).
  original_chave   text NOT NULL,
  original_nome    text NOT NULL,
  original_tipo    text NOT NULL,
  original_bytes   bigint NOT NULL,
  envio_id         text,
  envio_partes     jsonb NOT NULL DEFAULT '[]',
  duracao_original numeric(8, 3),
  duracao_final    numeric(8, 3),
  -- O que a edição levantou uma vez e reaproveita ao gerar de novo: silêncios, mapa do rosto
  -- (caixas por quadro, no vídeo já em pé) e o tamanho do vídeo de trabalho.
  analise          jsonb,
  -- O que a IA cortou (CorteVideo[]), a fala palavra por palavra (PalavraVideo[]) e as animações.
  cortes           jsonb NOT NULL DEFAULT '[]',
  palavras         jsonb NOT NULL DEFAULT '[]',
  animacoes        jsonb,
  conferencia      jsonb,
  final_chave      text,
  capa_chave       text,
  -- A pessoa mudou algo na revisão depois da última geração (o botão "Gerar de novo" acende).
  mudancas_pendentes boolean NOT NULL DEFAULT false,
  -- A primeira edição que ficou pronta conta na franquia do mês (gerar de novo não conta).
  contou_em        timestamptz,
  erro             text,
  tentativas       integer NOT NULL DEFAULT 0,
  -- Segundos de servidor e o que a edição custou (transcrição + Claude + servidor), para a Saúde e consumo.
  custo_usd        numeric(12, 6) NOT NULL DEFAULT 0,
  -- Sobe a cada gravação da revisão: a tela manda a que editou e, se outra pessoa salvou no meio, recusa.
  versao           integer NOT NULL DEFAULT 1,
  criado_por       integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  pronto_em        timestamptz
);
CREATE INDEX videos_conta ON comercial.videos (conta_id, id DESC);
CREATE INDEX videos_fila ON comercial.videos (situacao) WHERE situacao IN ('na_fila', 'editando');

-- Palavras que a empresa quer sempre escritas do mesmo jeito (marca, produtos, siglas): vão como
-- vocabulário para a transcrição e corrigem a legenda dos próximos vídeos.
CREATE TABLE comercial.video_preferencias (
  conta_id    integer PRIMARY KEY REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  vocabulario text[] NOT NULL DEFAULT '{}',
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- Consumo por conta e dia (a Saúde e consumo e o Financeiro leem daqui).
CREATE TABLE cadastro.consumo_videos (
  conta_id          integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  dia               date NOT NULL,
  videos            integer NOT NULL DEFAULT 0,
  segundos_video    numeric(10, 3) NOT NULL DEFAULT 0,
  segundos_servidor numeric(10, 3) NOT NULL DEFAULT 0,
  transcricao_seg   numeric(10, 3) NOT NULL DEFAULT 0,
  claude_usd        numeric(12, 6) NOT NULL DEFAULT 0,
  custo_usd         numeric(12, 6) NOT NULL DEFAULT 0,
  PRIMARY KEY (conta_id, dia)
);
