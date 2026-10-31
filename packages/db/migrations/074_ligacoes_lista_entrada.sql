-- Ligações, parte 2: lista de ligação (um de cada vez ou até 3 em paralelo), ligações recebidas
-- (toca para o dono do lead, depois para o time; siga-me para o celular; perdida vira tarefa) e o
-- aviso da franquia de minutos.

CREATE TABLE comercial.listas_ligacao (
  id                bigserial PRIMARY KEY,
  conta_id          integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  usuario_id        integer NOT NULL REFERENCES cadastro.usuarios (id) ON DELETE CASCADE,
  nome              text NOT NULL,
  -- Linhas ao mesmo tempo: 1 (uma de cada vez) a 3 (paralelo).
  linhas            integer NOT NULL DEFAULT 1 CHECK (linhas BETWEEN 1 AND 3),
  tentar_proximo    boolean NOT NULL DEFAULT true,
  pausa_segundos    integer NOT NULL DEFAULT 10 CHECK (pausa_segundos BETWEEN 0 AND 120),
  situacao          text NOT NULL DEFAULT 'ativa' CHECK (situacao IN ('ativa', 'pausada', 'encerrada')),
  criada_em         timestamptz NOT NULL DEFAULT now(),
  encerrada_em      timestamptz
);
CREATE INDEX listas_ligacao_usuario_idx ON comercial.listas_ligacao (conta_id, usuario_id, criada_em DESC);
-- Uma lista em andamento por pessoa.
CREATE UNIQUE INDEX listas_ligacao_ativa_uq ON comercial.listas_ligacao (conta_id, usuario_id)
  WHERE situacao IN ('ativa', 'pausada');

CREATE TABLE comercial.lista_ligacao_itens (
  id            bigserial PRIMARY KEY,
  lista_id      bigint NOT NULL REFERENCES comercial.listas_ligacao (id) ON DELETE CASCADE,
  conta_id      integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  empresa_id    bigint NOT NULL,
  telefone      text NOT NULL,
  ordem         integer NOT NULL,
  -- na_fila → chamando → feito; "retornar": atendeu junto com outra linha e ouviu o recado.
  situacao      text NOT NULL DEFAULT 'na_fila' CHECK (situacao IN ('na_fila', 'chamando', 'feito', 'retornar', 'pulado')),
  resultado     text,
  ligacao_id    bigint REFERENCES comercial.ligacoes (id) ON DELETE SET NULL,
  -- Quantas vezes este lead já entrou na lista (outro número depois de não atender).
  tentativa     integer NOT NULL DEFAULT 1,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lista_ligacao_itens_lista_idx ON comercial.lista_ligacao_itens (lista_id, situacao, ordem);

ALTER TABLE comercial.ligacoes ADD COLUMN lista_item_id bigint REFERENCES comercial.lista_ligacao_itens (id) ON DELETE SET NULL;

-- Recebidas: para quem tocou e quando passou para o time.
ALTER TABLE comercial.ligacoes
  ADD COLUMN dono_id      integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  ADD COLUMN time_desde   timestamptz,
  ADD COLUMN siga_me      text,
  ADD COLUMN perdida      boolean NOT NULL DEFAULT false;
ALTER TABLE comercial.ligacoes DROP CONSTRAINT ligacoes_situacao_check;
ALTER TABLE comercial.ligacoes ADD CONSTRAINT ligacoes_situacao_check
  CHECK (situacao IN ('preparando', 'chamando', 'tocando', 'em_andamento', 'siga_me', 'encerrada', 'falhou'));
CREATE INDEX ligacoes_entrando_idx ON comercial.ligacoes (conta_id, iniciada_em) WHERE direcao = 'entrada' AND situacao = 'tocando';

ALTER TABLE comercial.telefonia_contas
  ADD COLUMN receber          boolean NOT NULL DEFAULT true,
  -- Segundos tocando só para o dono do lead antes de tocar para o time.
  ADD COLUMN toque_dono       integer NOT NULL DEFAULT 20 CHECK (toque_dono BETWEEN 0 AND 60),
  -- Segundos tocando no CRM antes do siga-me (ou de virar perdida).
  ADD COLUMN toque_entrada    integer NOT NULL DEFAULT 40 CHECK (toque_entrada BETWEEN 15 AND 120),
  ADD COLUMN siga_me          boolean NOT NULL DEFAULT true,
  -- Avisos da franquia já mandados (mês 'YYYY-MM').
  ADD COLUMN aviso_80_mes     text,
  ADD COLUMN aviso_100_mes    text;
