-- Cota grátis do Google Places por CHAVE, não por conta. Dono: descoberta (lida pelo enriquecimento e pela api).
-- Conta com chave própria do Google tem a sua cota; as demais usam a chave da plataforma e dividem a
-- cota da conta principal (a franquia e o preço configurados nela). As "dicas" dizem, sem decifrar,
-- quais chaves a conta cadastrou.
CREATE FUNCTION cadastro.cota_places(p_conta integer) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM cadastro.credenciais_conta k
                  WHERE k.conta_id = p_conta AND k.dicas ? 'placesKey') THEN p_conta
    ELSE coalesce((SELECT id FROM cadastro.contas WHERE principal), p_conta)
  END
$$;

-- Pedidos ao Google do mês por cota (descoberta + enriquecimento: a franquia é uma só por chave).
CREATE VIEW descoberta.v_uso_places_cota AS
SELECT cadastro.cota_places(x.conta_id) AS cota_id, x.mes, sum(x.pedidos)::int AS pedidos
  FROM (
    SELECT conta_id, mes, count(*)::int AS pedidos FROM descoberta.uso_places GROUP BY conta_id, mes
    UNION ALL
    SELECT conta_id, mes, pedidos FROM enriquecimento.uso_places
  ) x
 GROUP BY 1, 2;
