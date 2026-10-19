-- Importação retomável: a nova tentativa do mesmo job continua a mesma importação,
-- pulando os arquivos que já foram processados.

ALTER TABLE base_cnpj.importacoes
  ADD COLUMN job_id              text,
  ADD COLUMN arquivos_concluidos text[] NOT NULL DEFAULT '{}',
  -- Contadores no fim do último arquivo concluído (os da tela incluem o arquivo que estava no meio).
  ADD COLUMN placar_concluido    jsonb;

CREATE UNIQUE INDEX importacoes_job_idx ON base_cnpj.importacoes (job_id) WHERE job_id IS NOT NULL;
