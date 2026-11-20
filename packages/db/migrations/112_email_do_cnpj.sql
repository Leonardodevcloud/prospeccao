-- v175: o e-mail de contato do site e da apresentação passa a ser o do cartão CNPJ
-- (prospectteamcrm@gmail.com), o mesmo da verificação da empresa na Meta. Só troca se ainda está o antigo
-- (se o master já mudou em Pedidos do site › Contato, fica o dele).
UPDATE cadastro.config_site SET email = 'prospectteamcrm@gmail.com', atualizado_em = now()
 WHERE id = 1 AND email = 'prospectteam@gmail.com';
