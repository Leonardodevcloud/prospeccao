-- v138: a tela da edição viva. Além do quadro parado, o worker guarda os primeiros segundos do
-- vídeo em pé (sem som, leve) para a prévia tocar em loop com o mapa do rosto acompanhando.
ALTER TABLE comercial.videos ADD COLUMN previa_video_chave text;
