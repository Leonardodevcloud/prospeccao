-- Leads importados pelo cliente (Excel, CSV ou PDF). Donos: api (importações) e worker-descoberta
-- (empresas, vínculo com a lista e os contatos que vieram do arquivo).
--
-- A base de empresas e o enriquecimento são de todas as contas; o que o cliente traz no arquivo dele
-- (o nome, o telefone e o e-mail de quem ele já conhece) é DELE: fica em enriquecimento.contatos e
-- enriquecimento.pessoas com conta_id da conta (0 = público, achado pelo enriquecimento). Toda leitura
-- filtra "conta_id IN (0, conta atual)".

/* ───────────── Contatos e pessoas privados por conta ───────────── */

ALTER TABLE enriquecimento.contatos ADD COLUMN conta_id integer NOT NULL DEFAULT 0;
ALTER TABLE enriquecimento.contatos DROP CONSTRAINT contatos_empresa_id_canal_valor_key;
ALTER TABLE enriquecimento.contatos
  ADD CONSTRAINT contatos_empresa_conta_canal_valor_key UNIQUE (empresa_id, conta_id, canal, valor);
ALTER TABLE enriquecimento.contatos DROP CONSTRAINT contatos_fonte_check;
ALTER TABLE enriquecimento.contatos ADD CONSTRAINT contatos_fonte_check CHECK (fonte IN (
  'receita', 'maps', 'site', 'instagram', 'linkedin', 'google', 'ia', 'places', 'manual', 'whatsapp',
  'base_paga', 'importacao'));
-- Privado só vem do arquivo do cliente.
ALTER TABLE enriquecimento.contatos
  ADD CONSTRAINT contatos_privado_importado CHECK (conta_id = 0 OR fonte = 'importacao');

ALTER TABLE enriquecimento.pessoas ADD COLUMN conta_id integer NOT NULL DEFAULT 0;
ALTER TABLE enriquecimento.pessoas DROP CONSTRAINT pessoas_empresa_id_nome_chave_key;
ALTER TABLE enriquecimento.pessoas
  ADD CONSTRAINT pessoas_empresa_conta_nome_key UNIQUE (empresa_id, conta_id, nome_chave);

/* ───────────── Listas importadas ───────────── */

-- Campanha de busca (Maps + base de CNPJ) ou lista importada (os leads vêm do arquivo; não busca nada).
ALTER TABLE cadastro.campanhas
  ADD COLUMN tipo text NOT NULL DEFAULT 'busca' CHECK (tipo IN ('busca', 'importacao'));

ALTER TABLE descoberta.campanha_empresas DROP CONSTRAINT campanha_empresas_origem_check;
ALTER TABLE descoberta.campanha_empresas
  ADD CONSTRAINT campanha_empresas_origem_check CHECK (origem IN ('cnpj', 'maps', 'ambos', 'importacao'));

/* ───────────── Importações ───────────── */

CREATE TABLE cadastro.importacoes_leads (
  id            bigserial PRIMARY KEY,
  conta_id      integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  usuario_id    integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  arquivo       text NOT NULL,
  formato       text NOT NULL CHECK (formato IN ('xlsx', 'csv', 'pdf')),
  -- analisada: o cliente está conferindo as colunas; na_fila/gravando: o worker grava; funil: a api
  -- põe no funil; concluida/erro: fim.
  status        text NOT NULL DEFAULT 'analisada'
                CHECK (status IN ('analisada', 'na_fila', 'gravando', 'funil', 'concluida', 'erro')),
  -- O arquivo lido: cabeçalhos e linhas (texto), e o que cada coluna é.
  colunas       jsonb NOT NULL DEFAULT '[]',
  linhas        jsonb NOT NULL DEFAULT '[]',
  mapa          jsonb NOT NULL DEFAULT '{}',
  leitura       text NOT NULL DEFAULT 'regras' CHECK (leitura IN ('regras', 'ia')),
  -- O que o cliente escolheu ao importar (lista, cidade padrão, enriquecer, funil e responsável).
  opcoes        jsonb,
  campanha_id   bigint REFERENCES cadastro.campanhas (id) ON DELETE SET NULL,
  -- Leads normalizados que o worker grava (o mapa já aplicado).
  leads         jsonb,
  total         integer NOT NULL DEFAULT 0,
  gravados      integer NOT NULL DEFAULT 0,
  -- {novas, existentes, ignorados, duplicados, enriquecer, funil}
  resultado     jsonb NOT NULL DEFAULT '{}',
  -- Empresas gravadas (para o funil e o enriquecimento).
  empresa_ids   bigint[] NOT NULL DEFAULT '{}',
  erro          text,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  iniciado_em   timestamptz,
  concluido_em  timestamptz
);
CREATE INDEX importacoes_leads_conta_idx ON cadastro.importacoes_leads (conta_id, criado_em DESC);
CREATE INDEX importacoes_leads_status_idx ON cadastro.importacoes_leads (status)
  WHERE status IN ('na_fila', 'gravando', 'funil');
