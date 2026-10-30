-- Recursos por plano: cada plano libera um conjunto de recursos (Start só a base de prospecção e CRM;
-- Time o trabalho em equipe, reuniões e vendas na rua; Escala tudo), e o WhatsApp vem com 2 números,
-- cobrando cada número a mais. O que cada plano libera fica na tabela de preços (painel master).

ALTER TABLE cadastro.organizacoes
  -- Números de WhatsApp além dos inclusos no módulo (cada um cobra à parte).
  ADD COLUMN numeros_extras        integer NOT NULL DEFAULT 0 CHECK (numeros_extras BETWEEN 0 AND 200),
  -- Recursos liberados só para esta organização, além do plano (negociação, teste).
  ADD COLUMN recursos_extras       text[] NOT NULL DEFAULT '{}',
  -- Franquias combinadas só para esta organização (null = a do plano).
  ADD COLUMN limite_horas_reuniao  integer CHECK (limite_horas_reuniao >= 0),
  ADD COLUMN limite_conversas_ia   integer CHECK (limite_conversas_ia >= 0);

-- Quem já tinha plano continua com tudo o que usava até aqui: os recursos que o plano novo não
-- inclui ficam liberados à parte (o master tira no painel quando renegociar). Também mantém as
-- reuniões sem franquia apertada e os números de WhatsApp que já estavam conectados.
UPDATE cadastro.organizacoes o
   SET recursos_extras = ARRAY['equipe', 'funis', 'cadencia', 'relatorios', 'reunioes', 'rua', 'celular',
                               'argos', 'unidades', 'marca', 'seguranca'],
       limite_horas_reuniao = 60,
       numeros_extras = greatest(0, (
         SELECT count(*)::int FROM comercial.chips h JOIN cadastro.contas c ON c.id = h.conta_id
          WHERE c.organizacao_id = o.id AND h.token_cifrado IS NOT NULL) - 2)
 WHERE o.plano IS NOT NULL;

-- Agente de IA passa de R$ 150 para R$ 297 (só se a tabela salva ainda estiver no valor antigo).
UPDATE cadastro.tabela_precos
   SET dados = jsonb_set(dados, '{modulos,agente_ia}', '297'), atualizado_em = now()
 WHERE id = 1 AND (dados #>> '{modulos,agente_ia}')::numeric = 150;
