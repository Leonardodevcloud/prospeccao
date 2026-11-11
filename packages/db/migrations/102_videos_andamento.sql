-- v136: a tela da edição como no mockup. O worker anota o que cada etapa achou (palavras ouvidas,
-- o que foi cortado, onde está o rosto, imagens e música) e guarda um quadro do vídeo já em pé,
-- para a pessoa ver o mapa do rosto e onde cada texto vai ficar enquanto a IA trabalha.
ALTER TABLE comercial.videos ADD COLUMN andamento jsonb;
ALTER TABLE comercial.videos ADD COLUMN previa_chave text;
