-- v104: visitas do site institucional, para o painel master (sem cookie e sem guardar o IP).
-- Cada página aberta, os cliques nos botões principais e, ao sair, até onde a pessoa rolou e quais
-- seções viu. O visitante é um código que muda todo dia (não dá para seguir ninguém de um dia
-- para o outro).
CREATE TABLE cadastro.visitas_site (
  id            bigserial PRIMARY KEY,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  dia           date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  visitante     text NOT NULL,
  evento        text NOT NULL CHECK (evento IN ('visita', 'clique', 'saida')),
  pagina        text NOT NULL,
  alvo          text,
  origem        text,
  utm_origem    text,
  utm_meio      text,
  utm_campanha  text,
  dispositivo   text,
  cidade        text,
  estado        text,
  pais          text,
  profundidade  smallint,
  segundos      integer,
  secoes        text[]
);
CREATE INDEX visitas_site_dia_idx ON cadastro.visitas_site (dia, evento);
