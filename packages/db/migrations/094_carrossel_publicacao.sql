-- Do carrossel ao direct (v126). Dono: api.
-- O "comente e receba" nasce junto com o carrossel: a regra fica ligada a ele, esperando o post
-- aparecer no Instagram (alvo 'carrossel'); o CRM reconhece o post pela legenda (ou a pessoa
-- escolhe) e a regra passa a valer para aquela publicação. O direct entrega um link, um arquivo
-- guardado no CRM, uma promoção (botão para o WhatsApp) ou só a conversa; cada botão passa por um
-- link do CRM que conta quem abriu.

ALTER TABLE comercial.instagram_regras DROP CONSTRAINT IF EXISTS instagram_regras_alvo_check;
ALTER TABLE comercial.instagram_regras
  ADD CONSTRAINT instagram_regras_alvo_check CHECK (alvo IN ('publicacao', 'proxima', 'todas', 'carrossel'));

ALTER TABLE comercial.instagram_regras
  -- O carrossel de onde a regra nasceu (apagar o carrossel não apaga a regra que já está valendo).
  ADD COLUMN carrossel_id      integer REFERENCES comercial.carrosseis (id) ON DELETE SET NULL,
  -- O que vai no direct: link, arquivo, promocao ou conversa (null: regra antiga, o botão como está).
  ADD COLUMN entrega           text CHECK (entrega IN ('link', 'arquivo', 'promocao', 'conversa')),
  -- O arquivo guardado no armazenamento (instagram/<conta>/arquivos/…), quando a entrega é arquivo.
  ADD COLUMN arquivo_chave     text,
  ADD COLUMN arquivo_nome      text,
  ADD COLUMN arquivo_tipo      text,
  ADD COLUMN arquivo_bytes     integer,
  ADD COLUMN divulgar_id       integer REFERENCES comercial.carrossel_divulgar (id) ON DELETE SET NULL,
  -- DDD + número do WhatsApp da promoção (o botão abre a conversa com o texto pronto).
  ADD COLUMN whatsapp          text CHECK (whatsapp IS NULL OR whatsapp ~ '^\d{10,11}$'),
  -- Posts que a pessoa disse "não é este": o reconhecimento não liga a regra neles de novo.
  ADD COLUMN midias_recusadas  text[] NOT NULL DEFAULT '{}',
  -- Já avisou que o post não apareceu em 3 dias (uma vez só).
  ADD COLUMN esperando_aviso_em timestamptz;
CREATE UNIQUE INDEX instagram_regras_carrossel_idx ON comercial.instagram_regras (carrossel_id)
  WHERE carrossel_id IS NOT NULL;
CREATE INDEX instagram_regras_esperando_idx ON comercial.instagram_regras (conta_id)
  WHERE alvo = 'carrossel';

-- Cada direct com botão leva um código só dele: o link passa pelo CRM, que marca quem abriu.
ALTER TABLE comercial.instagram_interacoes
  ADD COLUMN codigo   text,
  ADD COLUMN abriu_em timestamptz;
CREATE UNIQUE INDEX instagram_interacoes_codigo_idx ON comercial.instagram_interacoes (codigo)
  WHERE codigo IS NOT NULL;

-- O post do carrossel no Instagram (depois de reconhecido, o carrossel fica Publicado) e desde
-- quando está pronto (a espera de 3 dias pelo post conta daí) e quando as imagens foram baixadas.
ALTER TABLE comercial.carrosseis
  ADD COLUMN midia_id     text,
  ADD COLUMN midia_link   text,
  ADD COLUMN publicado_em timestamptz,
  ADD COLUMN pronto_em    timestamptz,
  ADD COLUMN baixado_em   timestamptz;
UPDATE comercial.carrosseis SET pronto_em = atualizado_em WHERE situacao = 'pronto';
