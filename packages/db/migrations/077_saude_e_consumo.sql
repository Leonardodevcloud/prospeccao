-- v98: saúde e consumo dos serviços externos (painel master) e saída do Apify.
-- Só cria tabelas novas e mexe em uma linha de custos: não trava tabela que a versão no ar usa.
SET LOCAL lock_timeout = '15s';

-- Chamadas para fora (IA, Z-API, LiveKit, Serper…) contadas por minuto pela api e pelos workers.
-- Guarda 35 dias (a rotina de alertas apaga o resto).
CREATE TABLE cadastro.servicos_uso (
  servico   text NOT NULL,
  minuto    timestamptz NOT NULL,
  chamadas  integer NOT NULL DEFAULT 0,
  erros     integer NOT NULL DEFAULT 0,
  ms_total  bigint NOT NULL DEFAULT 0,
  ms_max    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (servico, minuto)
);
CREATE INDEX servicos_uso_minuto_idx ON cadastro.servicos_uso (minuto);

-- Último sucesso, último erro e erros seguidos de cada serviço.
CREATE TABLE cadastro.servicos_estado (
  servico         text PRIMARY KEY,
  ultimo_ok_em    timestamptz,
  ultimo_erro_em  timestamptz,
  ultimo_erro     text,
  erros_seguidos  integer NOT NULL DEFAULT 0,
  atualizado_em   timestamptz NOT NULL DEFAULT now()
);

-- Planos que a plataforma contratou em cada serviço (LiveKit, operadora, Serper, Resend…) e os
-- outros custos fixos. Uma linha só; o que faltar vem do padrão do sistema.
CREATE TABLE cadastro.consumo_planos (
  id              integer PRIMARY KEY CHECK (id = 1),
  dados           jsonb NOT NULL DEFAULT '{}',
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  atualizado_por  integer
);

-- O antigo "Infraestrutura por mês" (Custos unitários) vira o primeiro custo fixo da lista.
INSERT INTO cadastro.consumo_planos (id, dados)
SELECT 1, jsonb_build_object('fixos', jsonb_build_array(jsonb_build_object(
         'nome', 'Servidores e banco (Railway)',
         'valor', coalesce((SELECT (dados ->> 'infraMes')::numeric FROM cadastro.custos_plataforma WHERE id = 1), 250))))
ON CONFLICT (id) DO NOTHING;

-- O Apify saiu do sistema e a infraestrutura foi para os custos fixos.
UPDATE cadastro.custos_plataforma
   SET dados = dados - 'apifyInstagramMil' - 'apifyGoogleMil' - 'infraMes'
 WHERE id = 1;
