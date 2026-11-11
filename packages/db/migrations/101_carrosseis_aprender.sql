-- O time aprende (v134). Dono: api.
-- As ideias com a fonte de cada uma (o estrategista propõe; a pessoa cria o carrossel ou descarta),
-- as contas de referência (números públicos de perfis profissionais, pelo Business Discovery da Meta,
-- só para ver o que funciona no nicho), o carrossel como o time fez (as edições de quem publica
-- ensinam o redator) e a view do Argos com os carrosséis e os números.

ALTER TABLE comercial.carrossel_pedidos DROP CONSTRAINT IF EXISTS carrossel_pedidos_tipo_check;
ALTER TABLE comercial.carrossel_pedidos
  ADD CONSTRAINT carrossel_pedidos_tipo_check CHECK (tipo IN ('carrossel', 'dossie', 'ideias'));

-- Os slides como o time entregou (a pessoa mexe nos slides; a diferença vira preferência do redator).
ALTER TABLE comercial.carrosseis ADD COLUMN slides_do_time jsonb;

CREATE TABLE comercial.carrossel_ideias (
  id            serial PRIMARY KEY,
  conta_id      integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  pedido_id     integer REFERENCES comercial.carrossel_pedidos (id) ON DELETE SET NULL,
  titulo        text NOT NULL,
  gancho        text NOT NULL,
  formato       text NOT NULL DEFAULT '',
  objetivo      text NOT NULL DEFAULT 'ensinar',
  slides        integer,
  chamada       text NOT NULL DEFAULT 'salvar',
  teste         boolean NOT NULL DEFAULT false,
  -- [{rotulo, texto}]: de onde a ideia veio, com a evidência conferida.
  fontes        jsonb NOT NULL DEFAULT '[]',
  criado_em     timestamptz NOT NULL DEFAULT now(),
  usada_em      timestamptz,
  carrossel_id  integer REFERENCES comercial.carrosseis (id) ON DELETE SET NULL,
  descartada_em timestamptz
);
CREATE INDEX carrossel_ideias_conta ON comercial.carrossel_ideias (conta_id, criado_em DESC);

CREATE TABLE comercial.carrossel_referencias (
  id         serial PRIMARY KEY,
  conta_id   integer NOT NULL REFERENCES cadastro.contas (id) ON DELETE CASCADE,
  usuario    text NOT NULL CHECK (usuario ~ '^[a-z0-9._]{1,30}$'),
  nome       text,
  seguidores integer,
  -- Os posts recentes com os números públicos: [{legenda, tipo, curtidas, comentarios, em}].
  posts      jsonb NOT NULL DEFAULT '[]',
  lido_em    timestamptz,
  erro       text,
  criado_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conta_id, usuario)
);

-- O Argos: um carrossel por linha, com o resultado no Instagram e no Comente e receba.
CREATE VIEW cerebro.carrosseis WITH (security_barrier = true) AS
SELECT c.id AS carrossel_id, c.conta_id AS unidade_id, c.titulo, c.situacao, c.estilo, c.origem,
       jsonb_array_length(c.slides) AS slides, c.relatorio->>'objetivo' AS objetivo,
       c.relatorio->>'angulo' AS angulo, left(c.legenda, 500) AS legenda,
       c.criado_em, c.pronto_em, c.agendado_para, c.publicado_em, c.midia_link AS link_no_instagram,
       u.nome AS criado_por,
       m.alcance, m.curtidas, m.comentarios, m.salvos, m.compartilhamentos,
       (SELECT count(*)::int FROM comercial.instagram_interacoes i WHERE i.regra_id = r.id) AS comentaram_a_palavra,
       (SELECT count(DISTINCT i.empresa_id)::int FROM comercial.instagram_interacoes i WHERE i.regra_id = r.id) AS viraram_lead
  FROM comercial.carrosseis c
  LEFT JOIN cadastro.usuarios u ON u.id = c.criado_por
  LEFT JOIN comercial.instagram_midias m ON m.conta_id = c.conta_id AND m.midia_id = c.midia_id
  LEFT JOIN comercial.instagram_regras r ON r.carrossel_id = c.id AND r.conta_id = c.conta_id
 WHERE ((SELECT tudo FROM cerebro_priv.escopo()) OR c.conta_id = ANY ((SELECT contas FROM cerebro_priv.escopo())::integer[]))
   AND (SELECT cerebro_priv.dono()) IS NULL;
