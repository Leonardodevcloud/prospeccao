# Prospect Team: guia do app da Meta (Instagram, anúncios e WhatsApp oficial)

Criado em 20/11/2026, na v174, com o CNPJ da empresa. É o passo a passo para o app da Meta sair do modo de
desenvolvimento e qualquer cliente conseguir conectar o Instagram, e depois para virar **Tech Provider** do
WhatsApp. Marque cada item quando fizer.

**Um app só para todos os clientes.** O app é da Prospect Team, verificado com o CNPJ da Prospect Team. Cada
cliente só faz o login do Facebook e autoriza a página e o Instagram dele, de qualquer domínio (white label):
a volta do login é sempre `app.prospectteam.com.br/api/meta/retorno` e o sistema devolve a pessoa para o
domínio de onde ela saiu. A tela de autorização da Meta mostra o nome e o ícone do app ("Prospect Team").

## 0. Dados da empresa (iguais ao cartão CNPJ)

| Campo | Valor |
|---|---|
| Nome empresarial | PROSPECT LTDA |
| Nome fantasia | PROSPECT TEAM |
| CNPJ | 70.193.281/0001-21 (ativo desde 16/11/2026) |
| Atividade | 62.02-3-00, desenvolvimento e licenciamento de programas de computador customizáveis |
| Endereço | R 8 de Julho, 18, Sala Lex e Fisco, Centro, Contendas do Sincorá/BA, CEP 46620-000 |
| Site | https://prospectteam.com.br (rodapé, termos e privacidade já mostram razão social, CNPJ e endereço desde a v174) |
| E-mail | prospectteamcrm@gmail.com (o do cartão; desde a v175 é o mesmo no site, nos termos, na privacidade e na apresentação) |
| Telefone | (71) 99363-5290 (o cartão tem (71) 9363-5290, sem o 9 da frente; na Meta use o número com o 9, decidido em 20/11) |

## 1. Portfólio empresarial e verificação da empresa

1. [ ] business.facebook.com › criar o portfólio **Prospect Team** com o nome legal **PROSPECT LTDA**, o endereço e o site acima (escritos igual ao cartão).
2. [ ] Configurações do negócio › **Segurança da marca › Domínios** › adicionar `prospectteam.com.br` › verificar pelo **registro TXT** no DNS (Registro.br ou Vercel › Domains). Ajuda a Meta a ligar o site à empresa.
3. [ ] Configurações do negócio › **Central de segurança › Verificação da empresa** › Iniciar. Documento: o **cartão CNPJ** (o PDF de 18/11). Contato: o e-mail do cartão (`prospectteamcrm@gmail.com`), o telefone com o 9 ou o domínio verificado.
4. [ ] Esperar o "Verificado" (dias a algumas semanas). Sem ele, a Meta não aprova o acesso avançado de nenhuma permissão.

## 2. Criar o app

1. [ ] developers.facebook.com › Meus apps › **Criar app**, ligado ao portfólio da Prospect Team.
2. [ ] Casos de uso / produtos: **Login do Facebook para Empresas**, **Instagram (API com Login do Facebook)**, **Webhooks** e, para o Tech Provider, **WhatsApp** (seção 7).
3. [ ] **Configurações do app › Básico:**
   - Nome de exibição: `Prospect Team`
   - E-mail de contato: `prospectteamcrm@gmail.com`
   - Domínios do app: `prospectteam.com.br` e `app.prospectteam.com.br`
   - URL da Política de Privacidade: `https://prospectteam.com.br/privacidade`
   - URL dos Termos de Serviço: `https://prospectteam.com.br/termos`
   - **Exclusão de dados do usuário › URL de callback:** `https://app.prospectteam.com.br/api/meta/exclusao` (v174; as instruções também estão em `https://prospectteam.com.br/privacidade#exclusao-de-dados`)
   - Ícone do app (1024×1024): `marca/png/icone-1024.png`
   - Categoria: **Negócios e páginas** (Business and pages)
   - Plataforma › Site: `https://app.prospectteam.com.br`
4. [ ] **Login do Facebook para Empresas › Configurações:**
   - URIs de redirecionamento do OAuth válidos: `https://app.prospectteam.com.br/api/meta/retorno`
   - **URL de callback para cancelar autorização:** `https://app.prospectteam.com.br/api/meta/desautorizar` (v174)
   - (Opcional) **Configurações** › criar uma com as permissões da seção 5, tipo de token "Token de acesso do usuário"; o ID vai em `META_CONFIG_ID`.
5. [ ] **Webhooks:** URL `https://app.prospectteam.com.br/api/meta/webhook`, token = `META_TOKEN_WEBHOOK`. Objeto **Instagram**: `comments` e `messages`. Objeto **Page**: `leadgen`.
6. [ ] **Railway › api › Variables:** `META_APP_ID`, `META_APP_SECRET`, `META_TOKEN_WEBHOOK` (uma senha que você inventa, 8+ caracteres), `META_CONFIG_ID` (se criou). **Não** pôr `META_PUBLICAR=sim` antes da aprovação do `instagram_content_publish`. Redeploy da api.
7. [ ] Painel master › Sistema › Configurações › "Instagram e anúncios · Meta": deve ficar verde (o "Como fazer" repete as URLs acima).

## 3. O que o sistema faz com a exclusão e a desautorização (v174)

- **Desautorizar** (a pessoa tira o Prospect Team em Facebook › Configurações › Integrações comerciais): a Meta chama `/api/meta/desautorizar`; o sistema desconecta o Instagram em todas as contas em que essa pessoa conectou e avisa os administradores no sino.
- **Excluir dados** (a pessoa pede a exclusão na mesma tela): `/api/meta/exclusao` desconecta, apaga as publicações e os comentários guardados (aba Conteúdo) e responde com o código e o link de acompanhamento (`/api/meta/exclusao/EX-…`), que a Meta mostra para a pessoa. Leads, conversas e regras ficam: são o CRM do cliente.
- O pedido da Meta vem assinado com a chave secreta do app (`signed_request`); assinatura errada é recusada. Cada pedido fica em `comercial.meta_exclusoes`.
- Quem conectou antes da v174 não tem o id da pessoa guardado (`instagram_contas.meta_usuario_id`): é só reconectar uma vez. Na prática, ninguém conectou ainda.

## 4. Testar com a sua conta (antes da análise)

Com o app em modo de desenvolvimento, quem tem papel no app (administrador, desenvolvedor ou testador) já usa tudo. Para testar com outra pessoa: Funções do app › Testadores.

1. [ ] Instagram profissional da Prospect Team ligado à página do Facebook. No app do Instagram: Configurações › Mensagens › Ferramentas conectadas › **Permitir acesso às mensagens**.
2. [ ] CRM › Automação › Instagram › Conexão › **Conectar Instagram** (de uma conta de cliente de teste ou da demonstração, não do painel master).
3. [ ] Conteúdo: os posts aparecem com os números.
4. [ ] Comente e receba: criar uma regra, comentar a palavra com outra conta, ver o direct chegar, responder e ver o lead em Conversas.
5. [ ] Formulários: criar um cadastro na Ferramenta de testes de anúncios de cadastro (developers.facebook.com/tools/lead-ads-testing) e ver o lead no funil.
6. [ ] Publicação (carrossel ou vídeo): só funciona depois de pedir a permissão (seção 5) e ligar `META_PUBLICAR=sim`. No modo de desenvolvimento, com o seu papel no app, dá para testar ligando a variável temporariamente.
7. [ ] Exclusão: em Facebook › Configurações › Integrações comerciais, remover o Prospect Team; a conexão cai e chega o aviso no sino. Conectar de novo.

## 5. Análise do app (Instagram e anúncios)

Pedir **acesso avançado** a cada permissão abaixo. Para cada uma a Meta pede: para que serve, como o usuário usa, e um **vídeo** (gravação da tela, com o login da Meta aparecendo no começo). Texto em inglês é o mais seguro para o revisor; abaixo vai o texto em inglês para colar.

| Permissão | Para que (colar no pedido) | O que mostrar no vídeo |
|---|---|---|
| `instagram_basic` | Read the connected Instagram professional account profile (username, name, picture, followers) and its media list, so the business sees its posts inside the CRM. | Conectar o Instagram; a conta e os posts aparecendo. |
| `instagram_manage_comments` | Read comments on the business's own posts and reply to them (public reply and private reply) when a comment matches a keyword rule the business created ("comment to receive"). | Criar a regra, comentar a palavra com outra conta, a resposta no comentário. |
| `instagram_manage_messages` | Receive and send Instagram Direct messages for the business inside the CRM inbox, within Meta's messaging window, including the private reply to a commenter. | O direct chegando no Instagram da outra conta; responder pelo CRM em Conversas. |
| `instagram_manage_insights` | Show reach, likes, saves and shares of each post next to the leads that post generated, so the business knows which content brings customers. | Aba Conteúdo com os números de um post. |
| `instagram_content_publish` | Publish carousels and Reels that the business created in the CRM to its own Instagram account, only when the business clicks Publish. | Abrir um carrossel pronto, clicar em Publicar, o post aparecendo no Instagram. |
| `pages_show_list` | List the Facebook Pages the user manages so they can choose which Page/Instagram account to connect. | A tela de escolha da página (se houver mais de uma). |
| `pages_read_engagement` | Read the Page and its connected Instagram account data needed for the connection and for messaging. | O nome da página na tela de Conexão. |
| `pages_manage_metadata` | Subscribe the app to the Page webhooks (leadgen, messages) so new leads and messages reach the CRM in real time. | Conectar e, em seguida, um cadastro de teste chegando sozinho. |
| `pages_manage_ads` | Required by Meta to receive Lead Ads webhooks and read the business's lead forms. | Aba Formulários com os formulários da página. |
| `leads_retrieval` | Retrieve the Lead Ads form submissions of the business's own Page and create a lead in its sales pipeline. | Cadastro pela ferramenta de testes virando lead no funil. |
| `business_management` | Used by Facebook Login for Business to list Pages owned by the client's business portfolio during connection. | A mesma tela da conexão. |

- **Sobre o `business_management`:** nenhuma chamada do código depende dele hoje (a lista de páginas vem de `/me/accounts`). Ele ajuda quando a página é do portfólio da empresa e a pessoa não tem papel direto nela. Se o revisor recusar só essa, aprove as outras e tire ela de `PERMISSOES_META` (`apps/api/src/modulos/instagram/meta.ts`) numa versão seguinte.
- **Instruções para o revisor (Reviewer instructions):** criar no painel master um cliente "Revisão Meta" no plano Escala, com um usuário administrador de e-mail e senha só para isso, e escrever (em inglês): o endereço `https://app.prospectteam.com.br/login`, o e-mail e a senha, e o caminho *Automation › Instagram › Connection › Connect Instagram*. Dizer que o revisor pode usar a própria página de teste. Desativar o cliente depois da aprovação.
- **Tratamento de dados (Data handling):** quem processa os dados: nós (PROSPECT LTDA) e prestadores sob contrato (hospedagem Railway/Vercel/Cloudflare, IA quando o cliente liga o atendimento com IA). Os dados não são vendidos nem usados para publicidade. Exclusão pela URL de callback. Tudo isso está na política (seção 3 e 4).
- [ ] Mandar a análise. Prazo comum: alguns dias úteis por rodada; se recusar, a Meta diz o motivo por permissão.
- [ ] Aprovado: colocar o app em **modo Ao vivo** e, se aprovou `instagram_content_publish`, pôr `META_PUBLICAR=sim` na api.

## 6. Depois da aprovação

- [ ] A Meta faz a **Verificação anual de uso de dados** (Data Use Checkup) e pode pedir a **Avaliação de proteção de dados** (Data Protection Assessment) para quem tem acesso avançado. Responder pelo painel do app quando chegar o aviso (o prazo costuma ser de 60 dias).
- [ ] Manter a política de privacidade em dia sempre que entrar uma função nova que use dados da Meta.

## 7. Tech Provider do WhatsApp (API oficial)

O Tech Provider é do **WhatsApp Business Platform** (a API oficial, Cloud API). Hoje o WhatsApp do sistema é todo pela Z-API (QR Code); a API oficial ainda não existe no código.

1. [ ] Mesmo app e mesmo portfólio verificado. Painel do app › Casos de uso › WhatsApp › **Personalizar** › **Integração de provedor de tecnologia** (Tech Provider onboarding).
2. [ ] Análise do app pedindo `whatsapp_business_messaging` e `whatsapp_business_management` (acesso avançado). Os dois vídeos pedidos (mandar uma mensagem que chega no WhatsApp e criar um modelo de mensagem) podem ser feitos **sem código nosso**: gravar o script cURL da página "Configuração da API" mandando para um número de teste e gravar o **WhatsApp Manager** criando um modelo. Dá para pedir já, depois da verificação.
3. [ ] Para atender clientes de verdade, falta construir (com mockup antes, regra do projeto): **Embedded Signup** (o cliente conecta o número dele pela janela da Meta e o sistema troca o código pelo token dele), envio e recebimento pela Cloud API, **modelos de mensagem**, janela de 24 h, status das mensagens e o webhook da conta do WhatsApp. Cada cliente cadastra o **cartão dele** na Meta (a Meta cobra o uso direto do cliente).
4. Regra que muda o uso: pela política da Meta, a empresa só pode chamar no WhatsApp quem deu o número e **autorizou** receber mensagens dela. A API oficial serve para leads de anúncio e formulário, quem chama primeiro e clientes que já conversam; a abordagem fria continua pela Z-API (risco do cliente, como hoje). Proposta: os dois tipos de número convivendo na conta ("WhatsApp oficial" e "WhatsApp por QR Code"). Decisão pendente com o Leonardo.
