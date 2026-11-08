-- Menu de voz nas ligações recebidas ("para a loja Centro, digite 1") e toque só para o grupo escolhido.
ALTER TABLE comercial.telefonia_contas
  ADD COLUMN IF NOT EXISTS menu boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS menu_saudacao text NOT NULL DEFAULT '';

ALTER TABLE comercial.ligacoes
  ADD COLUMN IF NOT EXISTS grupo_id integer REFERENCES cadastro.grupos_atendimento (id) ON DELETE SET NULL,
  -- Quando começou a tocar no CRM depois do menu (sem menu fica vazio: tocou quando chegou).
  ADD COLUMN IF NOT EXISTS tocando_desde timestamptz;

ALTER TABLE comercial.ligacoes DROP CONSTRAINT ligacoes_situacao_check;
ALTER TABLE comercial.ligacoes ADD CONSTRAINT ligacoes_situacao_check
  CHECK (situacao IN ('preparando', 'chamando', 'menu', 'tocando', 'em_andamento', 'siga_me', 'encerrada', 'falhou'));
