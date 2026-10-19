-- Um schema por domínio. Regra: cada schema tem UM serviço que escreve nele.
-- Os outros serviços só leem, de preferência pelas views publicadas
-- (005_views_publicadas.sql), que são o contrato estável entre domínios.
--
--   base_cnpj  → worker-cnpj         (cópia filtrada dos dados abertos da Receita)
--   cadastro   → api                 (nichos, campanhas, bases de operação)
--   descoberta → worker-descoberta   (empresas encontradas, buscas no Maps, cruzamentos)

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE SCHEMA IF NOT EXISTS base_cnpj;
CREATE SCHEMA IF NOT EXISTS cadastro;
CREATE SCHEMA IF NOT EXISTS descoberta;

-- unaccent() não é IMMUTABLE, então não pode ir em índice. Esta versão fixa o
-- dicionário e pode.
CREATE OR REPLACE FUNCTION public.f_unaccent(texto text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, texto) $$;

-- Mesma regra de normalizarNome() em packages/shared: minúsculo, sem acento,
-- sem pontuação e sem sufixo societário.
CREATE OR REPLACE FUNCTION public.normalizar_nome(nome text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT btrim(regexp_replace(
           regexp_replace(
             regexp_replace(
               replace(lower(public.f_unaccent(coalesce(nome, ''))), '&', ' e '),
               '\m(ltda|me|epp|eireli|mei|s/?a|cia|limitada|microempresa|empresa individual|sociedade unipessoal|slu)\M',
               ' ', 'g'),
             '[^a-z0-9 ]+', ' ', 'g'),
           '\s+', ' ', 'g'))
$$;

CREATE OR REPLACE FUNCTION public.normalizar_cidade(cidade text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT btrim(regexp_replace(regexp_replace(upper(public.f_unaccent(coalesce(cidade, ''))), '[^A-Z ]+', ' ', 'g'), '\s+', ' ', 'g'))
$$;

-- Distância em km (haversine), igual a haversineKm() em packages/shared.
CREATE OR REPLACE FUNCTION public.distancia_km(lat1 double precision, lng1 double precision,
                                              lat2 double precision, lng2 double precision)
RETURNS double precision
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $$
  SELECT 2 * 6371.0088 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )))
$$;

CREATE OR REPLACE FUNCTION public.tocar_atualizado_em()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$;
