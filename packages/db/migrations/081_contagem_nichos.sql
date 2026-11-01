-- v105: quantas empresas ativas de cada nicho pronto existem em cada município do Brasil, contadas
-- na importação da base de CNPJ (todas as UFs, não só as das campanhas). Alimenta o contador público
-- do site ("quantas empresas do seu nicho existem na sua cidade?"): só o número, nunca os dados.
CREATE TABLE base_cnpj.contagem_nichos (
  uf                text NOT NULL,
  municipio_codigo  text NOT NULL,
  nicho             text NOT NULL,
  ativas            integer NOT NULL,
  PRIMARY KEY (uf, municipio_codigo, nicho)
);
-- A contagem da importação que está rodando; troca pela de cima quando os estabelecimentos acabam.
CREATE TABLE base_cnpj.contagem_nichos_nova (LIKE base_cnpj.contagem_nichos INCLUDING ALL);
