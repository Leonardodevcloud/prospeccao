-- Qualidade do atendimento: a nota que a IA dá a cada atendimento (conversa parada ou ligação
-- transcrita), com os pontos da régua, o tempo de resposta medido pelo sistema e a correção do gestor.
CREATE TABLE comercial.atendimento_notas (
  id                  bigserial PRIMARY KEY,
  conta_id            integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  tipo                text NOT NULL CHECK (tipo IN ('conversa', 'ligacao')),
  empresa_id          bigint,
  ligacao_id          bigint REFERENCES comercial.ligacoes (id) ON DELETE CASCADE,
  -- Quem atendeu (na conversa: quem mais escreveu da equipe).
  usuario_id          integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  de_mensagem         bigint,
  ate_mensagem        bigint,
  inicio_em           timestamptz NOT NULL,
  fim_em              timestamptz NOT NULL,
  nota_ia             numeric(3, 1) NOT NULL,
  criterios           jsonb NOT NULL DEFAULT '{}',
  primeira_resposta_min integer,
  media_resposta_min  integer,
  gestor_nota         numeric(3, 1),
  gestor_motivo       text,
  gestor_id           integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  gestor_em           timestamptz,
  modelo              text,
  avaliado_em         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX atendimento_notas_vendedor ON comercial.atendimento_notas (conta_id, usuario_id, fim_em DESC);
CREATE INDEX atendimento_notas_lead ON comercial.atendimento_notas (conta_id, empresa_id, fim_em DESC);
CREATE INDEX atendimento_notas_semana ON comercial.atendimento_notas (conta_id, fim_em DESC);
CREATE UNIQUE INDEX atendimento_notas_ligacao ON comercial.atendimento_notas (ligacao_id) WHERE ligacao_id IS NOT NULL;

-- Até onde as conversas de cada lead já foram avaliadas (uma mensagem só entra numa nota).
CREATE TABLE comercial.atendimento_leituras (
  conta_id      integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  empresa_id    bigint NOT NULL,
  ate_mensagem  bigint NOT NULL DEFAULT 0,
  tentado_em    timestamptz,
  PRIMARY KEY (conta_id, empresa_id)
);

-- Ligações: a avaliação tentou e não deu (para não tentar a cada rodada).
ALTER TABLE comercial.ligacoes ADD COLUMN nota_tentada_em timestamptz;

-- O recurso entra nos planos Time e Escala da tabela salva (se ainda não estiver).
UPDATE cadastro.tabela_precos
   SET dados = jsonb_set(dados, '{planos,time,recursos}', (dados #> '{planos,time,recursos}') || '["atendimento"]'),
       atualizado_em = now()
 WHERE id = 1 AND jsonb_typeof(dados #> '{planos,time,recursos}') = 'array'
   AND NOT (dados #> '{planos,time,recursos}') ? 'atendimento';
UPDATE cadastro.tabela_precos
   SET dados = jsonb_set(dados, '{planos,escala,recursos}', (dados #> '{planos,escala,recursos}') || '["atendimento"]'),
       atualizado_em = now()
 WHERE id = 1 AND jsonb_typeof(dados #> '{planos,escala,recursos}') = 'array'
   AND NOT (dados #> '{planos,escala,recursos}') ? 'atendimento';
