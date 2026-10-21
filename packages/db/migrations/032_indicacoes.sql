-- Indicações: a conversa com a empresa passa por várias pessoas até chegar a quem decide. Dono: api.
--
--  * Contatos da negociação: quem a equipe conheceu conversando (a atendente, o comprador que ela
--    indicou, o sócio que o comprador indicou…), com quem indicou quem. São da CONTA (os dados de
--    enriquecimento são compartilhados; uma indicação é informação do comercial de cada conta).
--  * Sugestões: a IA viu um contato numa mensagem (cartão de contato ou telefone no texto) e propõe
--    cadastrar; a equipe confirma ou descarta. Nada entra sozinho.
--  * Enviar para: o número com quem a conversa segue (a cadência e a IA também usam).
--  * Não identificados: mensagem de um número que não é de nenhum lead fica guardada até alguém
--    vincular a um lead (antes ela era descartada).

CREATE TABLE comercial.contatos_lead (
  id                  bigserial PRIMARY KEY,
  conta_id            integer NOT NULL REFERENCES cadastro.contas (id),
  empresa_id          bigint NOT NULL,
  nome                text NOT NULL CHECK (length(trim(nome)) > 0),
  cargo               text,
  telefone            text,                    -- só dígitos, com DDD, sem o 55
  email               text,
  -- quem indicou: outro contato da negociação; ou um texto livre ("a atendente do balcão")
  indicado_por_id     bigint REFERENCES comercial.contatos_lead (id) ON DELETE SET NULL,
  indicado_por_texto  text,
  decisor             boolean NOT NULL DEFAULT false,
  status              text NOT NULL DEFAULT 'confirmado' CHECK (status IN ('sugerido', 'confirmado')),
  origem              text NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'ia', 'nao_identificado')),
  -- de onde a sugestão saiu (a frase da mensagem ou "cartão de contato")
  evidencia           text,
  mensagem_id         bigint,
  criado_por          integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (conta_id, empresa_id) REFERENCES comercial.oportunidades (conta_id, empresa_id) ON DELETE CASCADE,
  CHECK (telefone IS NOT NULL OR email IS NOT NULL OR status = 'confirmado')
);
CREATE INDEX contatos_lead_empresa_idx ON comercial.contatos_lead (conta_id, empresa_id);
CREATE UNIQUE INDEX contatos_lead_telefone_uidx ON comercial.contatos_lead (conta_id, empresa_id, telefone)
  WHERE telefone IS NOT NULL;
-- Achar o lead pelo número que mandou mensagem: DDD + 8 últimos dígitos.
CREATE INDEX contatos_lead_numero_idx ON comercial.contatos_lead (conta_id, left(telefone, 2), right(telefone, 8))
  WHERE telefone IS NOT NULL;
CREATE TRIGGER contatos_lead_atualizado BEFORE UPDATE ON comercial.contatos_lead
  FOR EACH ROW EXECUTE FUNCTION public.tocar_atualizado_em();

-- Com quem a conversa segue (número). null = o melhor telefone da empresa, como antes.
ALTER TABLE comercial.oportunidades ADD COLUMN whatsapp_destino text;

-- Mensagens de números que não são de nenhum lead (nem da empresa, nem de um contato indicado).
CREATE TABLE comercial.nao_identificadas (
  id           bigserial PRIMARY KEY,
  conta_id     integer NOT NULL REFERENCES cadastro.contas (id),
  telefone     text NOT NULL,
  nome         text,                           -- o nome que a pessoa usa no WhatsApp
  direcao      text NOT NULL CHECK (direcao IN ('enviada', 'recebida')),
  texto        text NOT NULL,
  midia_tipo   text,
  id_externo   text,
  chip_id      bigint,
  recebida_em  timestamptz NOT NULL DEFAULT now(),
  -- vinculada a um lead (as mensagens passam para a conversa dele) ou descartada
  empresa_id   bigint,
  resolvida_em timestamptz,
  descartada   boolean NOT NULL DEFAULT false
);
CREATE INDEX nao_identificadas_abertas_idx ON comercial.nao_identificadas (conta_id, telefone, recebida_em)
  WHERE resolvida_em IS NULL;
CREATE UNIQUE INDEX nao_identificadas_externo_idx ON comercial.nao_identificadas (conta_id, id_externo)
  WHERE id_externo IS NOT NULL;

-- A mensagem guarda o contato da negociação com quem foi trocada (quando não é o número da empresa).
ALTER TABLE comercial.mensagens ADD COLUMN contato_id bigint REFERENCES comercial.contatos_lead (id) ON DELETE SET NULL;
