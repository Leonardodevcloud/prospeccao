-- Gravação das reuniões pelo navegador de quem conduz (sem custo de gravação na nuvem).
-- O navegador grava a aba da reunião (a visão de quem conduz) e o microfone de cada pessoa, e manda
-- em pedaços de poucos segundos; a api guarda cada pedaço no armazenamento e, quando a gravação
-- termina, monta o arquivo final (com ffmpeg, para dar para pular para qualquer momento do vídeo).

ALTER TABLE comercial.sala_gravacoes
  ADD COLUMN origem text NOT NULL DEFAULT 'livekit' CHECK (origem IN ('livekit', 'navegador')),
  -- Formato que o navegador gravou (ex.: video/webm;codecs=h264,opus).
  ADD COLUMN mime text,
  -- Quem está gravando (identidade na sala): só ele manda os pedaços.
  ADD COLUMN gravado_por text,
  ADD COLUMN ultimo_pedaco_em timestamptz,
  -- O navegador avisou que terminou e quantos pedaços mandou.
  ADD COLUMN concluida_cliente_em timestamptz,
  ADD COLUMN pedacos_esperados integer CHECK (pedacos_esperados >= 0);

-- Um vídeo do LiveKit por sessão continua valendo; pelo navegador pode haver mais de um (quando
-- outra pessoa do time assume a gravação no meio da reunião).
DROP INDEX comercial.sala_gravacoes_video_uq;
CREATE UNIQUE INDEX sala_gravacoes_video_uq ON comercial.sala_gravacoes (sessao_id)
  WHERE tipo = 'sala' AND origem = 'livekit';
DROP INDEX comercial.sala_gravacoes_trilha_uq;
CREATE UNIQUE INDEX sala_gravacoes_trilha_uq ON comercial.sala_gravacoes (sessao_id, trilha_id)
  WHERE tipo = 'audio' AND origem = 'livekit';
-- Gravações do navegador ainda chegando (a api confere se dá para montar).
CREATE INDEX sala_gravacoes_chegando_idx ON comercial.sala_gravacoes (sessao_id)
  WHERE origem = 'navegador' AND situacao = 'gravando';

-- Pedaços recebidos (o arquivo de cada um fica no armazenamento até a gravação ser montada).
CREATE TABLE comercial.sala_gravacao_pedacos (
  gravacao_id  text NOT NULL REFERENCES comercial.sala_gravacoes (gravacao_id) ON DELETE CASCADE,
  n            integer NOT NULL CHECK (n >= 0),
  bytes        integer NOT NULL CHECK (bytes > 0),
  recebido_em  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gravacao_id, n)
);
