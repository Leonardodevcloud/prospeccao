-- Vendas na rua: o roteiro de visitas do dia de cada vendedor. Dono: api.
--
-- Um ROTEIRO por vendedor por dia: de onde sai, o horário, quanto tempo em cada visita e o almoço.
-- Cada PARADA é um lead a visitar, na ordem do caminho, com a hora prevista de chegada. No celular, o
-- vendedor faz o check-in (hora e local) e registra como foi; o resultado também vai para o
-- histórico do lead e move o funil.

CREATE TABLE comercial.roteiros (
  id              bigserial PRIMARY KEY,
  conta_id        integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  vendedor_id     integer NOT NULL REFERENCES cadastro.usuarios (id) ON DELETE CASCADE,
  dia             date NOT NULL,
  -- Campanha de onde vieram os leads (cadastro.campanhas.id; null = de várias).
  campanha_id     bigint,
  partida_rotulo  text NOT NULL CHECK (length(partida_rotulo) BETWEEN 1 AND 200),
  partida_lat     double precision NOT NULL CHECK (partida_lat BETWEEN -90 AND 90),
  partida_lng     double precision NOT NULL CHECK (partida_lng BETWEEN -180 AND 180),
  inicio          time NOT NULL,
  fim             time NOT NULL,
  minutos_visita  integer NOT NULL CHECK (minutos_visita BETWEEN 5 AND 240),
  almoco_inicio   time,
  almoco_minutos  integer CHECK (almoco_minutos BETWEEN 15 AND 180),
  -- O caminho calculado: total e a linha para o mapa ([lat, lng]).
  km              numeric(8, 1),
  minutos_rota    integer,
  tracado         jsonb,
  -- "ruas": tempo e caminho pelo serviço de rotas; "estimado": linha reta com o fator das ruas.
  calculo         text NOT NULL DEFAULT 'estimado' CHECK (calculo IN ('ruas', 'estimado')),
  -- O que foi pedido na tela (notas, situações, raio), para abrir o planejamento como estava.
  filtros         jsonb NOT NULL DEFAULT '{}',
  enviado_em      timestamptz,
  criado_por      integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conta_id, vendedor_id, dia)
);
CREATE INDEX roteiros_conta_dia_idx ON comercial.roteiros (conta_id, dia DESC);
CREATE TRIGGER roteiros_atualizado BEFORE UPDATE ON comercial.roteiros
  FOR EACH ROW EXECUTE FUNCTION public.tocar_atualizado_em();

CREATE TABLE comercial.roteiro_paradas (
  id                   bigserial PRIMARY KEY,
  roteiro_id           bigint NOT NULL REFERENCES comercial.roteiros (id) ON DELETE CASCADE,
  conta_id             integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  empresa_id           bigint NOT NULL REFERENCES descoberta.empresas (id) ON DELETE CASCADE,
  ordem                integer NOT NULL CHECK (ordem >= 1),
  chegada_prevista     time,
  km_trecho            numeric(7, 1),
  minutos_trecho       integer,
  -- Almoço logo antes desta visita.
  almoco_antes         boolean NOT NULL DEFAULT false,
  situacao             text NOT NULL DEFAULT 'pendente'
                       CHECK (situacao IN ('pendente', 'em_visita', 'feita', 'pulada')),
  -- Check-in: hora, onde o celular estava e a distância até o endereço do lead.
  chegou_em            timestamptz,
  chegou_lat           double precision,
  chegou_lng           double precision,
  chegou_distancia_m   integer,
  concluida_em         timestamptz,
  resultado            text CHECK (resultado IN ('decisor', 'proposta', 'reuniao', 'nao_estava',
                                                 'sem_interesse', 'fechou')),
  anotacao             text,
  -- Foto da fachada (chave no armazenamento de arquivos).
  foto_chave           text,
  proximo_passo        text,
  proximo_passo_em     date,
  UNIQUE (roteiro_id, empresa_id)
);
CREATE INDEX roteiro_paradas_roteiro_idx ON comercial.roteiro_paradas (roteiro_id, ordem);
CREATE INDEX roteiro_paradas_feitas_idx ON comercial.roteiro_paradas (conta_id, concluida_em DESC)
  WHERE concluida_em IS NOT NULL;
CREATE INDEX roteiro_paradas_empresa_idx ON comercial.roteiro_paradas (conta_id, empresa_id);
