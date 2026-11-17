-- v162: vídeos de apoio (b-roll). Além do vídeo principal, a pessoa sobe até 3 vídeos de apoio; o
-- editor usa trechos deles em tela cheia por cima da fala (a voz do principal continua). Cada item
-- guarda o arquivo enviado, a versão preparada (1080×1920, sem som), a capa e a descrição da IA.
ALTER TABLE comercial.videos ADD COLUMN IF NOT EXISTS apoios jsonb NOT NULL DEFAULT '[]'::jsonb;
