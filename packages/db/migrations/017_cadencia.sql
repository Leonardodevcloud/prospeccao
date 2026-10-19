-- Cadência de follow-up: o sistema marca o próximo passo sozinho e encerra quem não responde.
-- Dono: api.

ALTER TABLE comercial.oportunidades
  -- Mensagens enviadas sem resposta na etapa atual (zera quando a etapa muda).
  ADD COLUMN IF NOT EXISTS tentativas  integer NOT NULL DEFAULT 0,
  -- Última tentativa feita: quando passar desta data sem resposta, vai para "Perdido".
  ADD COLUMN IF NOT EXISTS encerrar_em timestamptz;

CREATE INDEX IF NOT EXISTS oportunidades_encerrar_idx ON comercial.oportunidades (encerrar_em)
  WHERE encerrar_em IS NOT NULL;

-- Uma linha só: a configuração da cadência.
CREATE TABLE IF NOT EXISTS comercial.config_cadencia (
  id                    boolean PRIMARY KEY DEFAULT true CHECK (id),
  dias_followup         integer[] NOT NULL DEFAULT '{2,3,5}',
  dias_encerrar         integer NOT NULL DEFAULT 4,
  encerrar_sem_resposta boolean NOT NULL DEFAULT true,
  dias_cobrar_proposta  integer[] NOT NULL DEFAULT '{3,7}',
  remetente             text NOT NULL DEFAULT '',
  atualizado_em         timestamptz NOT NULL DEFAULT now()
);
INSERT INTO comercial.config_cadencia (id) VALUES (true) ON CONFLICT DO NOTHING;

-- Modelos de mensagem do WhatsApp, um por momento da cadência.
CREATE TABLE IF NOT EXISTS comercial.modelos_mensagem (
  chave         text PRIMARY KEY CHECK (chave IN ('primeira', 'followup1', 'followup2', 'ultima',
                                                   'marcar_reuniao', 'cobrar_proposta')),
  texto         text NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
INSERT INTO comercial.modelos_mensagem (chave, texto) VALUES
  ('primeira', '{saudacao} Tudo bem? Aqui é {remetente} da Tutts. Fazemos entregas de autopeças por motoboy em {cidade}, com motoboy dedicado e prazo garantido. Como vocês fazem hoje as entregas da {empresa}?'),
  ('followup1', '{saudacao} Passando para saber se viu minha mensagem. Posso te mostrar em 5 minutos como a Tutts ajudaria a {empresa} a entregar mais rápido?'),
  ('followup2', '{saudacao} Muitas lojas de autopeças em {cidade} já usam a Tutts para não perder venda por demora na entrega. Faz sentido conversarmos esta semana?'),
  ('ultima', '{saudacao} Não quero incomodar: esta é minha última mensagem. Se precisar de entregas rápidas para a {empresa}, é só me chamar aqui. Abraço!'),
  ('marcar_reuniao', '{saudacao} Que bom falar com você! Qual o melhor dia e horário para uma conversa rápida de 15 minutos?'),
  ('cobrar_proposta', '{saudacao} Conseguiu olhar a proposta que enviei? Fico à disposição para ajustar o que for preciso.')
ON CONFLICT (chave) DO NOTHING;

-- Quem já está no funil sem próximo passo ganha um, para entrar na rotina de follow-up.
UPDATE comercial.oportunidades
   SET proxima_acao = 'Primeira abordagem', proxima_acao_em = now()
 WHERE etapa = 'a_abordar' AND proxima_acao_em IS NULL;

UPDATE comercial.oportunidades o
   SET tentativas = greatest(1, (SELECT count(*) FROM comercial.atividades a
                                  WHERE a.empresa_id = o.empresa_id AND a.direcao = 'enviada'
                                    AND a.criado_em >= o.etapa_desde)),
       proxima_acao = coalesce(o.proxima_acao, 'Follow-up'),
       proxima_acao_em = coalesce(o.proxima_acao_em, now())
 WHERE o.etapa = 'abordado';
