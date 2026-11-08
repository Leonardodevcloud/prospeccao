-- Carrosséis com IA: preço definido (R$ 200 por mês, sem limite de carrosséis) e o módulo entra na
-- assinatura pelo sistema. A tabela salva no painel master só muda se ainda estiver com os valores
-- de partida da v121 (R$ 397 e 20 por mês): o que o master já mudou fica como está.
UPDATE cadastro.tabela_precos
   SET dados = jsonb_set(dados, '{modulos,carrosseis}', '200'),
       atualizado_em = now()
 WHERE id = 1 AND dados #>> '{modulos,carrosseis}' = '397';

UPDATE cadastro.tabela_precos
   SET dados = jsonb_set(dados, '{carrosseisMes}', 'null'),
       atualizado_em = now()
 WHERE id = 1 AND dados ->> 'carrosseisMes' = '20';

-- A conversa com o time de IA dentro do editor: cada pedido da pessoa e a resposta do time, com a
-- proposta (os slides e a legenda como ficariam) esperando alguém aplicar ou descartar.
CREATE TABLE comercial.carrossel_conversa (
  id            bigserial PRIMARY KEY,
  conta_id      integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  carrossel_id  integer NOT NULL REFERENCES comercial.carrosseis (id) ON DELETE CASCADE,
  autor         text NOT NULL CHECK (autor IN ('pessoa', 'time')),
  texto         text NOT NULL DEFAULT '',
  -- slide (um só), carrossel (pode incluir, tirar e reordenar) ou legenda.
  alcance       text NOT NULL CHECK (alcance IN ('slide', 'carrossel', 'legenda')),
  slide_id      text,
  -- Na resposta do time: pensando → proposta → aplicada/descartada (aplicada → desfeita), ou erro.
  situacao      text CHECK (situacao IN ('pensando', 'proposta', 'aplicada', 'descartada', 'desfeita', 'erro')),
  -- { antes: {slides, legenda}, depois: {slides, legenda} }
  proposta      jsonb,
  mudancas      jsonb NOT NULL DEFAULT '[]',
  avisos        jsonb NOT NULL DEFAULT '[]',
  usuario_id    integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  respondido_em timestamptz
);
CREATE INDEX carrossel_conversa_carrossel ON comercial.carrossel_conversa (carrossel_id, id);
