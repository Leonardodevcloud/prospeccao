-- Número que já é usado no dia a dia (dono: api).
--
-- Ao conectar um número que já tem conversas, o sistema lê a lista de conversas do WhatsApp e
-- guarda esses contatos como "de antes": quando escrevem, a conversa segue só no celular (não vira
-- lead, não cai em "Sem lead", a IA nunca responde). Quem escrever pela primeira vez depois segue a
-- regra escolhida para o número.

ALTER TABLE comercial.chips
  ADD COLUMN IF NOT EXISTS uso_diario boolean NOT NULL DEFAULT false,
  -- O que fazer com quem escreve pela primeira vez: 'padrao' segue a configuração da conta.
  ADD COLUMN IF NOT EXISTS contato_novo text NOT NULL DEFAULT 'padrao'
    CHECK (contato_novo IN ('padrao', 'ignorar', 'sem_lead', 'lead')),
  ADD COLUMN IF NOT EXISTS contatos_lidos_em timestamptz,
  ADD COLUMN IF NOT EXISTS contatos_leitura text;

CREATE TABLE IF NOT EXISTS comercial.contatos_antigos (
  conta_id    integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  chip_id     integer NOT NULL REFERENCES comercial.chips (id) ON DELETE CASCADE,
  telefone    text NOT NULL,
  nome        text,
  ultima_em   timestamptz,
  -- 'conversa' = já existia ao conectar; 'celular' = a equipe puxou conversa pelo celular depois;
  -- 'ignorado' = escreveu pela primeira vez num número com a regra "ignorar".
  origem      text NOT NULL DEFAULT 'conversa' CHECK (origem IN ('conversa', 'celular', 'ignorado')),
  criado_em   timestamptz NOT NULL DEFAULT now(),
  -- Alguém trouxe para o CRM: daqui em diante segue o fluxo normal.
  trazido_em  timestamptz,
  trazido_por integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  PRIMARY KEY (chip_id, telefone)
);
CREATE INDEX IF NOT EXISTS contatos_antigos_conta_idx ON comercial.contatos_antigos (conta_id, right(telefone, 8));
