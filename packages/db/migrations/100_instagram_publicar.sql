-- Publicar e agendar pelo CRM (v133). Dono: api.
-- Um carrossel ou um vídeo publicado agora ou num dia e hora: a rotina publica na hora marcada pela
-- API da Meta (permissão instagram_content_publish) e, com o Comente e receba, liga a regra direto
-- no post publicado (sem precisar reconhecer pela legenda). O DNA de cada post fica guardado para o
-- time aprender com os números (v134).

CREATE TABLE comercial.instagram_agendamentos (
  id            serial PRIMARY KEY,
  conta_id      integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  carrossel_id  integer REFERENCES comercial.carrosseis (id) ON DELETE CASCADE,
  video_id      integer REFERENCES comercial.videos (id) ON DELETE CASCADE,
  -- Quando publicar (agora = o momento do pedido).
  para          timestamptz NOT NULL,
  -- A legenda que vai no post (do carrossel ou o texto do Reels com as hashtags).
  legenda       text NOT NULL,
  -- Ligar a regra do Comente e receba no post publicado.
  comente       boolean NOT NULL DEFAULT true,
  situacao      text NOT NULL DEFAULT 'agendado'
                CHECK (situacao IN ('agendado', 'publicando', 'publicado', 'falhou', 'cancelado')),
  -- O contêiner da Meta (o vídeo leva um tempo para processar) e o post publicado.
  container_id  text,
  midia_id      text,
  midia_link    text,
  erro          text,
  tentativas    integer NOT NULL DEFAULT 0,
  -- O que o post é (assunto, objetivo, estilo, modelos, nº de slides, foto, chamada, dia e hora).
  dna           jsonb NOT NULL DEFAULT '{}',
  criado_por    integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  publicado_em  timestamptz,
  CHECK ((carrossel_id IS NULL) <> (video_id IS NULL))
);
CREATE INDEX instagram_agendamentos_conta ON comercial.instagram_agendamentos (conta_id, para);
CREATE INDEX instagram_agendamentos_fila ON comercial.instagram_agendamentos (para)
  WHERE situacao IN ('agendado', 'publicando');
-- Uma publicação pendente por peça (agendar de novo troca a data).
CREATE UNIQUE INDEX instagram_agendamentos_carrossel_pendente ON comercial.instagram_agendamentos (carrossel_id)
  WHERE carrossel_id IS NOT NULL AND situacao IN ('agendado', 'publicando');
CREATE UNIQUE INDEX instagram_agendamentos_video_pendente ON comercial.instagram_agendamentos (video_id)
  WHERE video_id IS NOT NULL AND situacao IN ('agendado', 'publicando');

-- O vídeo agendado aparece como tal na lista (o carrossel já tem a situação 'agendado').
ALTER TABLE comercial.videos ADD COLUMN agendado_para timestamptz;
ALTER TABLE comercial.carrosseis ADD COLUMN agendado_para timestamptz;
