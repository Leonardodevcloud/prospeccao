-- Resumo da reunião: por que não saiu (a tela mostra e oferece gerar de novo) e o pedido de gerar só
-- o resumo (a transcrição já existe; não transcreve de novo).
ALTER TABLE comercial.sala_sessoes
  ADD COLUMN resumo_falha text,
  ADD COLUMN so_resumo boolean NOT NULL DEFAULT false;
