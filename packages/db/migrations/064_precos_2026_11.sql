-- Preços novos: Start R$ 497, Time R$ 1.300 (30 h de reunião e e-mail incluso), Escala R$ 2.500
-- (reuniões sem limite). WhatsApp + Agente de IA por R$ 999 com 3 números e conversas da IA sem
-- limite.
--
-- 1) Quem já tinha plano continua pagando o que pagava: a mensalidade calculada pela tabela antiga
--    vira o "valor combinado" (só onde ainda não havia um). O master muda no painel quando renegociar.
WITH t AS (
  SELECT coalesce((SELECT dados FROM cadastro.tabela_precos WHERE id = 1), '{}'::jsonb) AS d
), v AS (
  SELECT
    coalesce((d #>> '{planos,start,preco}')::numeric, 297)        AS p_start,
    coalesce((d #>> '{planos,start,usuarios}')::int, 2)           AS u_start,
    coalesce((d #>> '{planos,start,leadsMes}')::int, 2000)        AS l_start,
    coalesce((d #>> '{planos,time,preco}')::numeric, 599)         AS p_time,
    coalesce((d #>> '{planos,time,usuarios}')::int, 4)            AS u_time,
    coalesce((d #>> '{planos,time,leadsMes}')::int, 5000)         AS l_time,
    coalesce((d #>> '{planos,escala,preco}')::numeric, 999)       AS p_escala,
    coalesce((d #>> '{planos,escala,usuarios}')::int, 6)          AS u_escala,
    coalesce((d #>> '{planos,escala,leadsMes}')::int, 10000)      AS l_escala,
    coalesce((d #>> '{modulos,whatsapp}')::numeric, 250)          AS m_whatsapp,
    coalesce((d #>> '{modulos,agente_ia}')::numeric, 297)         AS m_ia,
    coalesce((d #>> '{modulos,email}')::numeric, 200)             AS m_email,
    coalesce((d ->> 'comboWhatsappIa')::numeric, 497)             AS combo,
    coalesce((d ->> 'numeroExtra')::numeric, 110)                 AS numero,
    coalesce((d ->> 'usuario')::numeric, 59)                      AS usuario,
    coalesce((d ->> 'milLeads')::numeric, 20)                     AS mil
  FROM t
), base AS (
  SELECT o.id, o.plano, o.modulos, o.numeros_extras, v.*,
         CASE o.plano WHEN 'start' THEN v.p_start WHEN 'time' THEN v.p_time WHEN 'escala' THEN v.p_escala END AS pp,
         CASE o.plano WHEN 'start' THEN v.u_start WHEN 'time' THEN v.u_time WHEN 'escala' THEN v.u_escala END AS pu,
         CASE o.plano WHEN 'start' THEN v.l_start WHEN 'time' THEN v.l_time WHEN 'escala' THEN v.l_escala END AS pl,
         o.limite_usuarios AS lu, o.limite_leads_mes AS ll
    FROM cadastro.organizacoes o CROSS JOIN v
   WHERE o.plano IS NOT NULL AND o.mensalidade_manual IS NULL
), calc AS (
  SELECT id,
    greatest(0,
      CASE WHEN plano = 'personalizado'
        THEN coalesce(lu, 1) * usuario + ceil(coalesce(ll, 0) / 1000.0) * mil
        ELSE pp + (coalesce(lu, pu) - pu) * usuario
             + sign(coalesce(ll, pl) - pl) * ceil(abs(coalesce(ll, pl) - pl) / 1000.0) * mil
      END
      + CASE WHEN 'whatsapp' = ANY(modulos) AND 'agente_ia' = ANY(modulos) THEN combo
             ELSE (CASE WHEN 'whatsapp' = ANY(modulos) THEN m_whatsapp ELSE 0 END)
                + (CASE WHEN 'agente_ia' = ANY(modulos) THEN m_ia ELSE 0 END) END
      + CASE WHEN 'email' = ANY(modulos) AND plano <> 'escala' THEN m_email ELSE 0 END
      + CASE WHEN 'whatsapp' = ANY(modulos) THEN numeros_extras * numero ELSE 0 END
    ) AS valor
  FROM base
)
UPDATE cadastro.organizacoes o SET mensalidade_manual = calc.valor FROM calc WHERE calc.id = o.id;

-- 2) No Escala as reuniões passam a não ter limite: tira a franquia de 60 h que a v72 pôs em quem
--    já tinha plano (a franquia maior do Time continua para quem já tinha).
UPDATE cadastro.organizacoes
   SET limite_horas_reuniao = NULL
 WHERE plano = 'escala' AND limite_horas_reuniao = 60;

-- 3) Tabela salva no painel master (quando existe) passa para os valores novos.
UPDATE cadastro.tabela_precos
   SET dados = jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(
                 dados,
                 '{planos,start,preco}', '497'),
                 '{planos,time,preco}', '1300'),
                 '{planos,time,horasReuniao}', '30'),
                 '{planos,time,modulosInclusos}', '["email"]'),
                 '{planos,escala,preco}', '2500'),
                 '{planos,escala,horasReuniao}', 'null'),
                 '{comboWhatsappIa}', '999'),
                 '{numerosInclusos}', '3'),
                 '{conversasIaMes}', 'null'),
       atualizado_em = now()
 WHERE id = 1
   AND dados ? 'planos'
   AND dados #> '{planos,start}' IS NOT NULL
   AND dados #> '{planos,time}' IS NOT NULL
   AND dados #> '{planos,escala}' IS NOT NULL;

-- 4) Contato comercial que o site e a apresentação mostram (só onde ainda não foi configurado no
--    painel master).
INSERT INTO cadastro.config_site (id, whatsapp, email) VALUES (1, '5571993635290', 'prospectteam@gmail.com')
ON CONFLICT (id) DO UPDATE
   SET whatsapp = coalesce(cadastro.config_site.whatsapp, EXCLUDED.whatsapp),
       email = coalesce(cadastro.config_site.email, EXCLUDED.email);
