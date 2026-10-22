-- Planos e módulos de cada conta (cliente). Dono: api.
--
-- O plano dá os números de partida (usuários e leads enriquecidos por mês); cada número pode ser
-- trocado só para aquela conta. Os módulos vendidos à parte (WhatsApp, Agente de IA, E-mail) ligam
-- e desligam por conta. Conta sem plano (a principal e as antigas) não tem limite nem trava.

ALTER TABLE cadastro.contas
  ADD COLUMN plano              text CHECK (plano IN ('start', 'time', 'escala', 'personalizado')),
  -- null = o número do plano
  ADD COLUMN limite_usuarios    integer CHECK (limite_usuarios >= 1),
  ADD COLUMN limite_leads_mes   integer CHECK (limite_leads_mes >= 0),
  ADD COLUMN modulos            text[] NOT NULL DEFAULT '{}',
  -- Mensalidade combinada com o cliente (desconto, valor fechado); null = a calculada.
  ADD COLUMN mensalidade_manual numeric(10, 2) CHECK (mensalidade_manual >= 0),
  ADD COLUMN plano_desde        date;

-- Lead que esperou porque a conta chegou no limite de leads do mês: volta para a fila quando der.
ALTER TABLE enriquecimento.leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE enriquecimento.leads
  ADD CONSTRAINT leads_status_check CHECK (status IN ('na_fila', 'rodando', 'concluido', 'erro', 'limite'));
