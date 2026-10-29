-- Perfil da IA de atendimento (dono: api).
--
-- O gestor preenche e confere cada seção (quem atende, empresa, região, oferta, objetivo, objeções,
-- limites, reunião). A IA pode sugerir conteúdo a partir do site, de documentos ou de conversas
-- reais, mas a sugestão só entra no perfil quando alguém aceita. Antes de ligar, a "prova": conversas
-- de teste (com armadilhas) que uma pessoa aprova uma a uma.

CREATE TABLE comercial.ia_perfil (
  conta_id        integer PRIMARY KEY REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  dados           jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- {"quem": {"por": "Paulo", "porId": 1, "em": "…"}, …}: seções conferidas por uma pessoa.
  conferidas      jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Muda a cada salvamento: a prova guarda com qual versão foi feita.
  versao          integer NOT NULL DEFAULT 1,
  site_url        text,
  site_lido_em    timestamptz,
  atualizado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE comercial.ia_sugestoes (
  id          bigserial PRIMARY KEY,
  conta_id    integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  secao       text NOT NULL,
  campo       text NOT NULL,
  valor       jsonb NOT NULL,
  origem      text NOT NULL,
  trecho      text,
  status      text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aceita', 'descartada')),
  criado_em   timestamptz NOT NULL DEFAULT now(),
  resolvida_em timestamptz,
  resolvida_por integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL
);
CREATE INDEX ia_sugestoes_pendentes_idx ON comercial.ia_sugestoes (conta_id, secao) WHERE status = 'pendente';

CREATE TABLE comercial.ia_prova (
  id           bigserial PRIMARY KEY,
  conta_id     integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  -- Cenário padrão ("desconto", "robo"…) ou "seu-<n>" para os escritos pelo gestor.
  chave        text NOT NULL,
  tipo         text NOT NULL,
  titulo       text NOT NULL,
  mensagem     text NOT NULL,
  esperado     text NOT NULL DEFAULT '',
  resposta     text,
  acao         text,
  motivo       text,
  conferencia  jsonb NOT NULL DEFAULT '[]'::jsonb,
  barrada      jsonb NOT NULL DEFAULT '[]'::jsonb,
  status       text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovada', 'reprovada')),
  correcao     text,
  rodada_em    timestamptz,
  versao_perfil integer,
  avaliada_por integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  avaliada_em  timestamptz,
  UNIQUE (conta_id, chave)
);

-- Conferência frase a frase de cada mensagem real (o que foi barrado e por quê) já cabe em
-- comercial.verificacoes_ia (regra "sem_fonte").
