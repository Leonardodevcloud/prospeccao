-- Agente de IA v2. Dono: api.
--
--  * Base de conhecimento em trechos (busca em português, sem acento): textos, perguntas e
--    respostas, arquivos e o que a IA aprendeu com as conversas (só entra depois de aprovado).
--  * Memória do lead: os fatos que ele já contou (para a IA não perguntar de novo).
--  * Resumo da passagem para o time: o que foi combinado, objeções, interesse e próximo passo.
--  * Verificações antes de enviar: o que foi barrado e por quê.
--  * Lacunas: perguntas que a IA não soube responder (o que falta ensinar).

CREATE TABLE comercial.conhecimento (
  id            bigserial PRIMARY KEY,
  conta_id      integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  tipo          text NOT NULL CHECK (tipo IN ('texto', 'faq', 'arquivo')),
  titulo        text NOT NULL,
  -- faq: a pergunta; os outros: null
  pergunta      text,
  conteudo      text NOT NULL,
  -- de onde veio: escrito por alguém, arquivo enviado ou aprendido numa conversa
  origem        text NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'arquivo', 'conversa')),
  -- sugerido: a IA propôs a partir de uma conversa e espera aprovação; só 'ativo' entra nas respostas
  status        text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'sugerido', 'arquivado')),
  empresa_id    bigint,
  usos          integer NOT NULL DEFAULT 0,
  usado_em      timestamptz,
  criado_por    integer REFERENCES cadastro.usuarios (id) ON DELETE SET NULL,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conhecimento_conta_idx ON comercial.conhecimento (conta_id, status);
CREATE TRIGGER conhecimento_atualizado BEFORE UPDATE ON comercial.conhecimento
  FOR EACH ROW EXECUTE FUNCTION public.tocar_atualizado_em();

CREATE TABLE comercial.conhecimento_trechos (
  id               bigserial PRIMARY KEY,
  conhecimento_id  bigint NOT NULL REFERENCES comercial.conhecimento (id) ON DELETE CASCADE,
  conta_id         integer NOT NULL,
  ordem            integer NOT NULL,
  texto            text NOT NULL,
  tsv              tsvector GENERATED ALWAYS AS (to_tsvector('portuguese', public.f_unaccent(texto))) STORED
);
CREATE INDEX conhecimento_trechos_tsv_idx ON comercial.conhecimento_trechos USING gin (tsv);
CREATE INDEX conhecimento_trechos_conta_idx ON comercial.conhecimento_trechos (conta_id);

-- Memória do lead e resumo da passagem para o time (por oportunidade, isto é, por conta).
ALTER TABLE comercial.oportunidades
  ADD COLUMN agente_memoria  jsonb,
  ADD COLUMN agente_resumo   jsonb,
  ADD COLUMN agente_resumo_em timestamptz;

-- O que as verificações barraram (e se a reescrita resolveu).
CREATE TABLE comercial.verificacoes_ia (
  id          bigserial PRIMARY KEY,
  conta_id    integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  empresa_id  bigint NOT NULL,
  texto       text NOT NULL,
  problemas   jsonb NOT NULL,
  -- reescrita: a IA corrigiu e a nova passou; bloqueada: nem a reescrita passou e o lead foi para o time
  resultado   text NOT NULL CHECK (resultado IN ('reescrita', 'bloqueada')),
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verificacoes_ia_conta_idx ON comercial.verificacoes_ia (conta_id, criado_em DESC);

-- Perguntas que a IA não soube responder: viram tarefa de "ensinar".
CREATE TABLE comercial.lacunas_ia (
  id               bigserial PRIMARY KEY,
  conta_id         integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  empresa_id       bigint NOT NULL,
  pergunta         text NOT NULL,
  motivo           text,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  resolvida_em     timestamptz,
  conhecimento_id  bigint REFERENCES comercial.conhecimento (id) ON DELETE SET NULL
);
CREATE INDEX lacunas_ia_abertas_idx ON comercial.lacunas_ia (conta_id, criado_em DESC) WHERE resolvida_em IS NULL;

-- Aprendizado: a resposta do time a uma lacuna vira sugestão para a base (uma tentativa por lacuna).
ALTER TABLE comercial.lacunas_ia ADD COLUMN aprendizado_em timestamptz;

-- Ritmo anti-banimento: chip novo manda pouco e vai subindo (aquecimento pela idade do número).
ALTER TABLE comercial.chips
  ADD COLUMN aquecer    boolean NOT NULL DEFAULT true,
  ADD COLUMN ativado_em date NOT NULL DEFAULT current_date;
-- Chips que já existiam já estão em operação: ficam sem aquecimento (dá para ligar na tela).
UPDATE comercial.chips SET ativado_em = criado_em::date, aquecer = false;

