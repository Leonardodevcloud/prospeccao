-- Novos números dos planos prontos: Start 2.000 leads/mês, Time R$ 599 com 5.000, Escala 10.000.
-- Só mexe na tabela de preços salva no painel master (se houver); o padrão já vem do código.
-- Contas com limite próprio (limite_leads_mes) continuam com o que foi combinado.
UPDATE cadastro.tabela_precos
   SET dados = jsonb_set(jsonb_set(jsonb_set(jsonb_set(dados,
         '{planos,start,leadsMes}', '2000'),
         '{planos,time,preco}', '599'),
         '{planos,time,leadsMes}', '5000'),
         '{planos,escala,leadsMes}', '10000'),
       atualizado_em = now()
 WHERE id = 1 AND dados ? 'planos';
