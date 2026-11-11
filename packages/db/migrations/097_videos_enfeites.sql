-- Vídeos com IA, etapa 2 (v129): imagens, animações que acompanham a fala, efeitos sonoros e a
-- música feita para o vídeo.

-- As imagens de cada vídeo (fotos da empresa, fotos da pessoa ou geradas pela IA), onde a IA
-- preferiu não pôr imagem e o som (música e efeitos). As animações ficam em `animacoes.momentos`.
ALTER TABLE comercial.videos
  ADD COLUMN imagens    jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN sem_imagem jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN som        jsonb;

-- O que cada foto da empresa mostra, lido uma vez por um modelo de visão: é assim que a IA escolhe
-- a foto certa para o que a pessoa está falando no vídeo.
ALTER TABLE comercial.carrossel_fotos
  ADD COLUMN descricao_ia text,
  ADD COLUMN descrita_em  timestamptz;

-- Consumo das imagens geradas e da música, para a Saúde e consumo.
ALTER TABLE cadastro.consumo_videos
  ADD COLUMN imagens     integer NOT NULL DEFAULT 0,
  ADD COLUMN imagens_usd numeric(12, 6) NOT NULL DEFAULT 0,
  ADD COLUMN musica_seg  numeric(10, 3) NOT NULL DEFAULT 0,
  ADD COLUMN musica_usd  numeric(12, 6) NOT NULL DEFAULT 0;

-- Etapas novas na tela de andamento: as imagens e a música.
ALTER TABLE comercial.videos DROP CONSTRAINT videos_etapa_check;
ALTER TABLE comercial.videos ADD CONSTRAINT videos_etapa_check CHECK (
  etapa IS NULL OR etapa IN ('preparando', 'ouvindo', 'cortando', 'rosto', 'imagens', 'montando', 'gerando', 'som', 'conferindo')
);
