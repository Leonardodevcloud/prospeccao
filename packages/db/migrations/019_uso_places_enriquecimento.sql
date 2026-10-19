-- Pedidos ao Google Places feitos pelo enriquecimento (achar a empresa pelo nome e endereço).
-- Dono: worker-enriquecimento. Somados aos da descoberta (descoberta.v_uso_places_mes), dizem
-- quanto da cota grátis do mês ainda resta: acabou a cota, o enriquecimento passa para o Serper.

CREATE TABLE IF NOT EXISTS enriquecimento.uso_places (
  mes      date PRIMARY KEY,               -- mês de cobrança do Google (horário do Pacífico)
  pedidos  integer NOT NULL DEFAULT 0
);

-- Uso do mês das duas pontas, para o painel e para o worker decidir.
CREATE OR REPLACE VIEW enriquecimento.v_uso_places_mes AS
SELECT mes, pedidos FROM enriquecimento.uso_places;
