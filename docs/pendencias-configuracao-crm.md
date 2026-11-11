# Prospect Team — pendências de configuração (variáveis e cadastros)

Decisão: as funções vieram primeiro; a configuração abaixo é feita de uma vez. Marque cada item quando fizer.

Última atualização: v125 (08/11/2026; Qualidade do atendimento, migration 093, seção 4o; redeploy da api, do front e do site). Antes: v124 (08/11/2026; apresentação do time de IA dos carrosséis, migration 092, sem configuração nova). Antes: v123 (08/11/2026; carrosséis R$ 200 sem limite no Assinar e no site, conversa com o time no editor; migration 091; redeploy da api, do front e do site). Antes: v122 (08/11/2026; time de IA dos carrosséis em 4n.6, `ANTHROPIC_CHAVE` na api; migration 090). Antes: v121 (08/11/2026; carrosséis com IA em 4n; migration 089). Antes: v119 (07/11/2026; ligação pelo WhatsApp em 4e.11; porteiro em 4e.12; quadros sem configuração nova; menu de voz em 4e.10) e v110 (01/11/2026). Este doc fica também no repositório, em `docs/pendencias-configuracao-crm.md`. **Todas as versões até a v109 estão no ar; a v110 (segurança) e a v111 (Base CNPJ só com ativas) estão para subir** (confirmado pelo Leonardo em 01/11); as variáveis do Railway foram conferidas pelos prints (seção 2). O que segue em aberto é configuração (variáveis, contas e testes), não deploy. Todas as migrations (até a 093) rodam sozinhas quando a api sobe.

**Para configurar depois (Leonardo):**
- [ ] **Chave da Anthropic na api** (time de IA dos carrosséis, v122): `ANTHROPIC_CHAVE` no Railway › api (seção 4n.6). Sem ela, os carrosséis funcionam só à mão.
- [ ] **Tokens do Vercel na api** (domínio próprio dos clientes, v85): `VERCEL_TOKEN`, `VERCEL_PROJETO` = `prospeccao` e, se o projeto estiver num time, `VERCEL_TIME`. Passo a passo na seção 2 › "Domínio próprio dos clientes". Sem eles, a marca própria funciona e a aba Domínio próprio avisa que ainda não está liberado.
- [ ] **Pedir já à Meta a permissão `instagram_content_publish`** (carrosséis, v129): entra na mesma Análise do app do item abaixo (lista em 4d.7). A análise demora; a publicação pelo CRM só funciona depois dela.
- [ ] **App da Meta (Instagram e anúncios, v90)**: criar o app, colocar `META_APP_ID`, `META_APP_SECRET` e `META_TOKEN_WEBHOOK` na api, cadastrar o webhook e pedir a **Análise do app** (seção 4d). É o item que mais demora (verificação da empresa + análise da Meta, dias a semanas). Até a aprovação, só as contas que têm papel no app (você) conseguem conectar e testar.

O que mudou desde a v32 (a versão anterior deste doc):
- WhatsApp agora é pela **Z-API**, não mais pela Evolution. O cliente conecta o número lendo o QR Code na tela. Os webhooks são configurados sozinhos.
- O **Argos** (assistente de voz e texto) tem variáveis próprias.
- Organizações e unidades, perfil "só leitura" (diretoria), "só a própria base" por pessoa e número com dono: nada disso precisa de variável, é cadastro na tela.
- **IA de atendimento** (v59): só liga com a Configuração da IA toda conferida e a prova aprovada. Não precisa de variável nova (usa a IA da conta).
- **Número de uso diário** (v60): ao conectar um WhatsApp que já conversa com clientes, as conversas que já existiam ficam fora do CRM. Não precisa de variável nova.
- **Central de ajuda** (v60): menu Gestão › Ajuda, um artigo por área.
- **Argos** (v61): memória por pessoa, conhecimento da empresa (perfil conferido + base de conhecimento) em toda pergunta e conferência automática dos números. Não precisa de variável nova.
- **Reuniões por vídeo** (v62): sala de vídeo própria (LiveKit Cloud), gravação num bucket (Cloudflare R2 ou outro compatível com S3), transcrição pela Groq e resumo pela IA da conta. **Precisa de variáveis novas na api** (seção 2 › Reuniões por vídeo) e do webhook do LiveKit (seção 4b). Sem elas, a tela Reuniões avisa que a sala não foi configurada e o resto do sistema segue normal.
- **Gravação pelo navegador** (v67): quem grava é o Chrome/Edge de quem conduz (grava a aba da reunião e o microfone de cada pessoa), sem custo de gravação no LiveKit. O plano gratuito (Build) do LiveKit basta. A api monta o arquivo final com ffmpeg (já vem na imagem Docker da api). A gravação pela nuvem do LiveKit continua pronta: liga com `GRAVACAO_NA_NUVEM=sim` (precisa de plano pago do LiveKit).
- **Sem nicho fixo** (v69): a nota por regras não dá mais pontos por "faz entrega". Nada a configurar; só o redeploy do **worker-enriquecimento** para a nota nova valer.
- **Planos com recursos** (v72, preços da v74): cada plano libera um conjunto de recursos (Start só a base; Time equipe, reuniões 30 h, vendas na rua, e-mail…; Escala tudo, reuniões sem limite), o módulo WhatsApp + IA (R$ 999) vem com 3 números e conversas da IA sem limite, e cada número extra é cobrado. Não precisa de variável: é a Tabela de preços e o plano de cada cliente no painel master (seção 5).
- **Painel master** (v79): a tela **Configurações** do painel mostra cada variável/serviço desta lista como Funcionando, Com aviso ou Falta configurar, com o botão Testar e o "Como fazer". Use-a como checklist depois de configurar. O Financeiro usa os Custos unitários (novos: reuniões por 1.000 minutos, transcrição por hora e GB guardado). O CRM de demonstração não precisa de variável.
- **Marca própria e domínio do cliente** (v85): o cliente do Escala configura nome, cor, logo, ícone, imagem e o endereço próprio sozinho. Precisa dos tokens do Vercel na api (acima).
- **Fundos das reuniões** (v86): desfoque, cenários e fotos da empresa com a logo, tudo no navegador de cada pessoa. Não precisa de variável nova. O navegador baixa o modelo que separa a pessoa do fundo do CDN do Google/jsDelivr na primeira vez (rede da empresa que bloqueie esses endereços: a reunião segue sem efeito e a tela avisa).
- **Instagram** (v90, plano Time em diante desde a v91): comente e receba, direct em Conversas e os cadastros dos formulários dos anúncios. Precisa do app da Meta (seção 4d). A IA no direct precisa também do módulo WhatsApp + IA. Sem ele, a tela Automação › Instagram avisa que a integração não foi liberada.
- **Carrosséis com IA** (v121, módulo à parte, só o administrador; o time de IA escrevendo na v122 precisa da `ANTHROPIC_CHAVE`, seção 4n.6). Usa o mesmo bucket das reuniões (`GRAVACOES_S3_*`) para as logos e fotos; sem ele, a tela avisa que não dá para guardar imagens. Liberar por cliente no master (seção 4n).
- **Quadros com gatilhos da IA** (v117): nada a configurar. Usa a IA da conta (conta no consumo do mês); o administrador do cliente monta os quadros em Vendas › Quadros.
- **Vendas na rua** (v70): roteiro de visitas no mapa, no celular do vendedor. Não precisa de variável nova, mas usa a `ORS_API_KEY` na api (tempo e caminho pelas ruas), as bases cadastradas (ponto de partida), o bucket das gravações (foto da fachada) e a `GROQ_CHAVE` (anotação falada). Tudo isso é opcional: sem cada item, a tela funciona e explica o que falta (seção 4c).

## 0. Acesso master
- [ ] Entrar com o e-mail de `ADMIN_EMAIL` (senha de `ADMIN_SENHA_HASH`).
  - Gerar o hash: `pnpm --filter @prospeccao/api hash-senha`.
  - O master entra direto no painel da plataforma (Visão geral, Vendas, Clientes, Financeiro, Configurações, Operação, Base CNPJ). Com outro usuário, nada disso aparece.
  - Outros administradores (v82): Configurações › Administradores da plataforma › Novo administrador (a pessoa recebe um link para criar a senha). O do `ADMIN_EMAIL` é o acesso de emergência e não se desativa pela tela.

## 1. Deploy
- [x] **api** no Railway na versão mais nova. No log do pre-deploy aparece "migrations aplicadas" com a lista. Até a 065.
- [x] **worker-descoberta** e **worker-enriquecimento** na mesma versão. Eles mandam "sinal de vida": sem isso, o alerta "worker parado" aparece no painel master.
- [x] **worker-cnpj** (base da Receita) rodando, com a agenda do mês.
- [x] Front no **Vercel** apontando para a api (`/api` repassado).
- [ ] **Backup do Postgres** do Railway ligado, e um restore testado pelo menos uma vez.
- [ ] **Domínio do painel e das reuniões (v82): `app.prospectteam.com.br`** (o site já está em `prospectteam.com.br`):
  1. Vercel › projeto do **painel (web)**, não o do site › Settings › Domains › Add `app.prospectteam.com.br`.
  2. O Vercel mostra o registro DNS. Se o domínio usa os nameservers do Vercel, ele cria sozinho. Se o DNS está no Registro.br (ou outro), criar lá um **CNAME** `app` apontando para o valor que o Vercel mostrar (ex.: `cname.vercel-dns.com`). Esperar o "Valid Configuration" (minutos a algumas horas).
  3. Railway › **api** › `APP_ORIGENS` = `https://app.prospectteam.com.br,https://prospeccao-virid.vercel.app` (o **novo primeiro**: é dele que saem os links das reuniões nas mensagens automáticas, convites e "esqueci a senha"; o antigo fica para os links já enviados continuarem funcionando) e redeploy.
  4. Entrar por `https://app.prospectteam.com.br`: é preciso fazer login de novo (o login é por endereço) e, no celular, "Ligar neste aparelho" de novo nas notificações. Os links de reunião copiados no painel já saem com o domínio novo.
  5. Só depois do passo 2 publicar o site da v82: o botão **Entrar** do site aponta para `app.prospectteam.com.br/login`.

## 2. Variáveis

### Situação conferida em 01/11/2026 (prints do Railway)
Serviços: **api**, **worker-cnpj**, **worker-descoberta** e **worker-enriquecimento** (no Railway aparece com o nome "prospeccao").

| Serviço | Já tem | Falta | Pode apagar |
|---|---|---|---|
| api | SERVICO, DATABASE_URL, JWT_SEGREDO, ADMIN_EMAIL, ADMIN_SENHA_HASH, APP_ORIGENS, ORS_API_KEY, LOG_LEVEL, LIVEKIT_URL/API_KEY/API_SECRET, GRAVACOES_S3_BUCKET/CHAVE/ENDPOINT/SEGREDO, GROQ_CHAVE, IA_API_KEY, IA_PROVEDOR, OPENAI_CHAVE | **CHAVE_CREDENCIAIS** (importante), **ASAAS_CHAVE** e **ASAAS_TOKEN_WEBHOOK** (assinatura), TURNSTILE_SITE/SEGREDO (robôs no cadastro), RESEND_API_KEY/EMAIL_REMETENTE/RESEND_DOMINIO_RESPOSTAS/RESEND_WEBHOOK_SEGREDO (e-mails do sistema), ZAPI_PARCEIRO_TOKEN/ZAPI_CLIENT_TOKEN (WhatsApp), API_URL_PUBLICA, VERCEL_TOKEN/VERCEL_PROJETO (domínio próprio), META_APP_ID/META_APP_SECRET/META_TOKEN_WEBHOOK (Instagram), TELEFONIA_TRONCO_SAIDA (ligações), GOOGLE_PLACES_KEY (só para o botão Testar) | — |
| worker-cnpj | SERVICO, DATABASE_URL, LOG_LEVEL, CNPJ_UFS_EXTRAS=TODAS | — | — |
| worker-descoberta | SERVICO, DATABASE_URL, ORS_API_KEY, LOG_LEVEL, GOOGLE_PLACES_KEY | **CHAVE_CREDENCIAIS** | APIFY_TOKEN (Apify saiu), CNPJ_UFS_EXTRAS (posta aqui por engano; vale só no worker-cnpj), SERPER_API_KEY e ENRIQ_ACHAR_NO_GOOGLE (a descoberta não lê) |
| worker-enriquecimento ("prospeccao") | SERVICO, DATABASE_URL, LOG_LEVEL, GOOGLE_PLACES_KEY, SERPER_API_KEY, ENRIQ_ACHAR_NO_GOOGLE, GEMINI_API_KEY | **CHAVE_CREDENCIAIS**, IA_PROVEDOR + IA_API_KEY (hoje a IA usa a GEMINI_API_KEY como reserva; para usar a mesma IA da api, copie as duas da api e depois apague a GEMINI_API_KEY), ZAPI_PARCEIRO_TOKEN/ZAPI_CLIENT_TOKEN (WhatsApp) | APIFY_TOKEN |

- Os prints mostram só as variáveis do serviço. Se alguma das que faltam estiver como **Shared Variable** do projeto, ela já vale; confira em Project Settings › Shared Variables.
- **CHAVE_CREDENCIAIS** é a mais importante das que faltam: sem ela, o painel master não guarda as chaves de cada cliente (só a conta principal funciona pelas variáveis). Mesmo valor na api, na descoberta e no enriquecimento. Gerar no PowerShell: `[Convert]::ToBase64String((1..48 | % { Get-Random -Max 256 }))`.

### Em todos os serviços (mesmo valor)
- [x] `DATABASE_URL`: Postgres do Railway.
- [ ] `CHAVE_CREDENCIAIS` em **api, worker-descoberta e worker-enriquecimento**: 32 caracteres ou mais, aleatórios.
  - Gerar no PowerShell: `[Convert]::ToBase64String((1..48 | % { Get-Random -Max 256 }))`.
  - Sem ela, o painel master não guarda as chaves dos clientes e só a conta principal funciona.
  - Se trocar depois, as chaves do painel precisam ser cadastradas de novo. Os celulares também precisam "Ligar neste aparelho" de novo (ela cifra a chave das notificações).

### api (obrigatórias)
- [x] `APP_ORIGENS`: endereço do front (ex.: `https://app.prospectteam.com.br`). Pode ter mais de um, separados por vírgula. **O primeiro é o que vai no link das salas de reunião** (`<primeiro>/r/<código>`).
- [x] `JWT_SEGREDO`: 32 caracteres ou mais. **Não trocar depois**, porque derruba todas as sessões, muda a senha interna do Argos (ele se ajusta sozinho ao subir) e invalida quem estiver numa reunião naquele momento.
- [x] `ADMIN_EMAIL` e `ADMIN_SENHA_HASH`.
- [ ] `API_URL_PUBLICA`: endereço público da api (links de e-mail, agenda, webhooks). Sem ela, o sistema usa o domínio do Railway.

### WhatsApp (Z-API): api e worker-enriquecimento
- [ ] `ZAPI_PARCEIRO_TOKEN`: token de parceiro. É com ele que o sistema cria a instância de cada número dos clientes.
- [ ] `ZAPI_CLIENT_TOKEN`: token de segurança da conta Z-API.
- [ ] Remover as variáveis antigas da Evolution (`EVOLUTION_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCIA`). Elas não são mais lidas.

### IA da plataforma: api e worker-enriquecimento
- [x] `IA_PROVEDOR` = `deepseek` (ou `gemini` / `openai`).
- [x] `IA_API_KEY`.
- [ ] `IA_MODELO`: opcional (em branco usa o padrão do provedor).
- [ ] `IA_BASE_URL`: só para provedor "compatível com OpenAI" (OpenRouter, Groq…).
- [ ] Depois de testar, remover `GEMINI_API_KEY` e `GEMINI_MODELO`. O sistema ainda usa os dois como reserva quando falta `IA_API_KEY`.
- Custo: cada mensagem da IA de atendimento faz uma chamada a mais (a conferência frase a frase). No Argos, a conferência dos números não chama a IA; só quando um número não bate ela pede uma correção. Cada reunião gravada faz uma chamada para o resumo. Em vendas na rua, cada visita com anotação faz uma chamada pequena para sugerir o próximo passo.

### Argos (voz): só na api
- [x] `GROQ_CHAVE`: transcrição da voz (Whisper na Groq). Sem ela, o Argos funciona só por texto. **A transcrição das reuniões e a anotação falada das visitas usam a mesma chave.**
- [x] `OPENAI_CHAVE`: a voz do Argos (gpt-4o-mini-tts). Sem ela, ele responde em texto, sem falar.
- [ ] Opcionais: `VOZ_MODELO`, `VOZ_BASE_URL`, `FALA_MODELO`, `FALA_BASE_URL`, `ARGOS_RACIOCINIO` (`desligado` | `baixo` | `alto`; padrão `desligado`, que é mais rápido).

### Reuniões por vídeo (v62): só na api
Servidor de vídeo (LiveKit Cloud, https://cloud.livekit.io › criar projeto › Settings › Keys):
- [x] `LIVEKIT_URL`: o endereço do projeto, começa com `wss://` (ex.: `wss://prospect-team-xxxx.livekit.cloud`).
- [x] `LIVEKIT_API_KEY` e `LIVEKIT_API_SECRET`: a chave criada no projeto.
- Sem essas três, a sala não abre (a tela avisa) e nada mais muda.

Gravações (bucket compatível com S3; recomendado **Cloudflare R2**, que não cobra a saída para assistir):
- [x] `GRAVACOES_S3_ENDPOINT`: no R2, `https://<id-da-conta>.r2.cloudflarestorage.com` (sem o nome do bucket).
- [x] `GRAVACOES_S3_BUCKET`: ex.: `prospect-reunioes`.
- [x] `GRAVACOES_S3_CHAVE` e `GRAVACOES_S3_SEGREDO`: token de API do R2 com permissão **Object Read & Write** só nesse bucket.
- [ ] `GRAVACOES_S3_REGIAO`: opcional (padrão `auto`, que é o do R2; na AWS, a região do bucket).
- Sem o bucket, as reuniões acontecem normalmente, mas sem gravação, transcrição e resumo (a tela avisa). **As fotos de fachada das visitas também ficam nesse bucket** (pasta `rua/`).
- [ ] `GRAVACAO_NA_NUVEM`: deixar **sem** (padrão = gravação pelo navegador de quem conduz, sem custo). Só pôr `sim` com plano pago do LiveKit (Ship, US$ 50/mês).
- Custo do plano gratuito do LiveKit (Build): 5.000 minutos de participante por mês (cerca de 40 h de reunião com 2 pessoas).
- Transcrição: usa `GROQ_CHAVE` (acima). Resumo: usa a IA da conta.

### E-mail (Resend) da conta principal: api
- [ ] `RESEND_API_KEY` (`re_…`), `EMAIL_REMETENTE`, `RESEND_DOMINIO_RESPOSTAS`, `RESEND_WEBHOOK_SEGREDO` (`whsec_…`).
  - Esse Resend também manda o "Esqueci minha senha" de todas as contas.

### Busca, enriquecimento e rotas
- [x] `GOOGLE_PLACES_KEY` em **worker-descoberta e worker-enriquecimento** (na api, só para o botão "Testar").
- [ ] **Apify saiu na v98**: apagar `APIFY_TOKEN`, `APIFY_ATOR_GOOGLE`, `APIFY_ATOR_INSTAGRAM`, `APIFY_MAPS_ATOR`, `APIFY_MAPS_INPUT_EXTRA`, `ENRIQ_LER_INSTAGRAM`, `MAPS_ESPERA_SEGUNDOS` e `MAPS_MAX_VERIFICACOES` dos workers (se ficarem, são ignoradas). O Maps é pelo Google Places e a busca no Google pelo Serper; o Instagram fica com o @ e o trecho do Google.
- [x] `ORS_API_KEY` em **api e worker-descoberta** (OpenRouteService, https://openrouteservice.org › Dashboard › token grátis). Na descoberta, só campanhas com raio usam. **Na api, desde a v70, é o que calcula o roteiro pelas ruas** (tempo, km e o caminho no mapa) e acha o endereço digitado como ponto de partida. Sem ela, os tempos são estimados pela distância (a tela avisa).
  - Plano grátis do ORS (conferir no painel): por volta de 500 matrizes e 2.000 rotas por dia. Cada "Sugerir roteiro", "Otimizar", mudança de ordem e "Salvar" usa uma matriz e uma rota.
- [ ] Opcionais no **worker-enriquecimento**:
  - `SERPER_API_KEY`: busca no Google (site, Instagram, LinkedIn e diretórios). Sem ela, essas etapas são puladas.
  - `DIRECTD_TOKEN` e `DIRECTD_PRECO_BRL`: base paga de contatos. Só liga se o custo valer.

### Domínio próprio dos clientes (v85): só na api
- [ ] `VERCEL_TOKEN`: no Vercel, Account Settings › **Tokens** › Create (escopo: o time onde está o projeto `prospeccao`; sem validade ou longa). É com ele que o sistema cadastra sozinho o domínio que o cliente digitar (o projeto do painel) e confere o DNS. Ninguém precisa mexer no Vercel por cliente.
- [ ] `VERCEL_PROJETO`: `prospeccao` (nome ou id do projeto do painel, o mesmo do `app.prospectteam.com.br`).
- [ ] `VERCEL_TIME`: só se o projeto estiver num time (Team): o **Team ID** (Settings do time › General, começa com `team_`). Conta pessoal: deixe vazio.
- Conferir em Configurações › serviço **Domínio próprio dos clientes** (mostra quantos ativos e esperando DNS). Opcional no **front** (Vercel): `API_URL` só se a api mudar de endereço (o middleware da prévia no WhatsApp usa `https://prospeccaoapi-production.up.railway.app` por padrão).

### Instagram e anúncios (v90): só na api
- `META_APP_ID` e `META_APP_SECRET`: Painel do app na Meta › Configurações do app › Básico (ID do aplicativo e Chave secreta).
- `META_TOKEN_WEBHOOK`: uma senha que você inventa (8+ caracteres) e repete no cadastro do webhook.
- `META_CONFIG_ID` (opcional): o ID da configuração do "Login do Facebook para Empresas". Sem ela, o login pede as permissões direto.
- `META_VERSAO` (opcional, padrão `v23.0`).

### Ligações (v94 e v95): só na api
- `TELEFONIA_TRONCO_SAIDA`: o ID do tronco SIP de saída criado no LiveKit (começa com `ST_`). Usa as mesmas `LIVEKIT_*` das reuniões; grava no mesmo armazenamento (`GRAVACOES_S3_*`), transcreve com a `GROQ_CHAVE` e o aviso falado usa a `OPENAI_CHAVE` do Argos. Passo a passo na seção 4e.

- `TELEFONIA_TRONCO_WHATSAPP` (v119, opcional): o ID (`ST_…`) do tronco de saída do LiveKit que aponta para a ponte do WhatsApp (seção 4e.11). Sem ele, o botão “Ligar pelo WhatsApp” não aparece.
### Front (Vercel): opcional
- [ ] `VITE_MAPA_TILES` e `VITE_MAPA_CREDITO`: só se for trocar o mapa do OpenStreetMap (padrão, sem chave) por outro provedor (ex.: MapTiler, Stadia). Formato com `{z}/{x}/{y}`. Recomendado se o uso crescer: o OpenStreetMap pede uso moderado.

## 3. Resend da conta principal
- [ ] Domínio de envio verificado. Usar um subdomínio só para prospecção (ex.: `contato.prospectteam.com.br`).
- [ ] Domínio de recebimento (Receiving) com o MX que o Resend mostrar (ex.: `respostas.prospectteam.com.br`).
- [ ] Webhook: no painel master, abrir a conta e copiar o endereço `…/api/e/resend/<código>`.
  - Eventos: received, delivered, opened, clicked, bounced, complained, failed.
  - O "Signing secret" vai em `RESEND_WEBHOOK_SEGREDO`.
- [ ] Deixar desligado o rastreio de abertura e clique no próprio Resend. O sistema já conta.
- [ ] Testar "Esqueci minha senha" na tela de login. O link chega e vale 1 hora.
- [ ] E-mail dos clientes: cada cliente cadastra o próprio domínio pela tela (E-mail › Configuração › Domínio de e-mail; passo a passo no artigo de ajuda "Domínio de e-mail") e ele entra no Resend da plataforma. Conferir no plano do Resend o limite de domínios e de envios por mês antes do primeiro cliente com e-mail.

## 4. WhatsApp (Z-API)
- [ ] Painel master › cliente › "Testar" WhatsApp. Esperado: "Z-API da plataforma ok".
- [ ] Na conta: Agente › Números de WhatsApp › "Conectar número" › responder "Este número já é usado no dia a dia?" › ler o QR Code com o celular. O webhook é configurado sozinho.
- [ ] Número que já conversa com clientes (**uso diário**):
  - Depois de conectar, a linha do número mostra "N contatos ficam só no celular". Conferir em "Ver contatos de antes".
  - Escolher "Quem escrever pela primeira vez": fica no celular, vai para "Sem lead", vira lead ou a regra da conta.
  - **Primeiro teste com número real**: a leitura das conversas (Z-API `/chats`) ainda não foi testada numa instância real. Se aparecer "Não deu para ler as conversas", mandar o texto do erro.
- [ ] Número novo: deixar "Aquecer" ligado. Começa com poucas mensagens por dia e sobe em 30 dias.
- [ ] Número próprio de um comercial: em "De quem é", escolher a pessoa. Os leads novos que chegam por ele ficam com ela.
- [ ] "Conferir" em cada número deve mostrar "Conectado".

## 4b. Reuniões por vídeo (LiveKit e R2)
- [ ] **Cloudflare R2**: criar o bucket (ex.: `prospect-reunioes`), sem acesso público. Em "Manage R2 API Tokens", criar um token Object Read & Write só desse bucket e copiar Access Key ID, Secret e o endpoint S3.
  - Opcional: regra de ciclo de vida para apagar gravações antigas (ex.: 365 dias), se for a política combinada com os clientes. Se criar, limitar ao prefixo das reuniões para não apagar as fotos das visitas (`rua/`) junto, ou fazer outra regra para elas.
- [ ] **LiveKit Cloud** › projeto › Settings › **Webhooks** › adicionar (recomendado, não obrigatório: desde a v63 a api também confere a sala a cada 10 s):
  - URL: endereço público da api + `/livekit` (ex.: `https://api.prospectteam.com.br/livekit`). Tem que ser a api direto, não o front.
  - Chave de assinatura: a mesma `LIVEKIT_API_KEY`.
  - Se o painel pedir para escolher os eventos, marcar todos.
- [ ] Plano do LiveKit Cloud: com a gravação pelo navegador (padrão), o gratuito (Build) atende as reuniões (5.000 minutos de participante). **Com o módulo Ligações**, o Build inclui só 1.000 minutos de ligação (SIP) por mês, somando todos os clientes, e não cobra excedente (as ligações param): passar para o Ship (US$ 50/mês, 5.000 minutos de ligação, depois US$ 0,004/min) quando as ligações começarem. O minuto da ligação em si é cobrado pela operadora (Nvoip). Acompanhar em Settings › Usage.
- [ ] Não há liberação por plano: as reuniões estão disponíveis para todas as contas. Se for virar módulo pago, avisar para eu travar por módulo.

## 4c. Vendas na rua (v70)
- [ ] `ORS_API_KEY` na **api** (seção 2 › Busca, enriquecimento e rotas). Com ela, a tela Planejar não mostra o aviso amarelo e o mapa desenha o caminho pelas ruas.
- [ ] Em cada conta, cadastrar a **base** da empresa (o ponto de partida padrão): em Na rua › Planejar o dia › Ponto de partida › Outro endereço, digitar o endereço, "Usar" e "Guardar como base da empresa" (só o administrador vê). Sem base, o vendedor usa a localização do celular ou digita um endereço.
- [ ] Os leads precisam ter **localização** (vêm do Google Maps ou do endereço da Receita, pelo worker-descoberta). A tela diz quantos leads da campanha ainda estão sem endereço no mapa.
- [ ] Foto da fachada: precisa do bucket das gravações (seção 2 › Reuniões por vídeo). Anotação falada: precisa da `GROQ_CHAVE`. Próximo passo lido da anotação: precisa da IA da conta.
- [ ] Vendedores: cada um entra no sistema pelo celular (Chrome no Android, Safari no iPhone) e, de preferência, liga as **notificações no celular** (Minha conta) para receber o aviso do roteiro.
- [ ] No celular, o navegador pede a localização na hora do **Cheguei**: tem que permitir. O sistema não acompanha o celular durante o dia (só no check-in).
- [ ] Não há liberação por plano: disponível para todas as contas.

## 4d. App da Meta: Instagram e cadastros dos anúncios (v90)
1. [ ] **Portfólio empresarial** (business.facebook.com) da Prospect Team, com a **verificação da empresa** (CNPJ, comprovante, domínio). Configurações do negócio › Central de segurança › Verificação.
2. [ ] **Criar o app** em developers.facebook.com › Meus apps › Criar app › tipo **Empresa**, ligado ao portfólio. Adicionar os produtos: **Login do Facebook para Empresas**, **Instagram** (API com Login do Facebook), **Webhooks**.
3. [ ] **Login**: em "URIs de redirecionamento do OAuth válidos" colocar `https://app.prospectteam.com.br/api/meta/retorno`. (Opcional: criar uma configuração do Login para Empresas com as permissões abaixo e pôr o ID em `META_CONFIG_ID`.)
4. [ ] **Variáveis na api** (seção 2 › Instagram) e redeploy da api.
5. [ ] **Webhooks** (no painel do app): URL `https://app.prospectteam.com.br/api/meta/webhook`, token = `META_TOKEN_WEBHOOK`.
   - Objeto **Instagram**: assinar `comments` e `messages`.
   - Objeto **Page**: assinar `leadgen`.
   - (A página de cada cliente é ligada sozinha quando ele conecta.)
6. [ ] **Testar com a sua conta** (você tem papel no app, então funciona antes da aprovação): Automação › Instagram › Conexão › Conectar Instagram. Criar uma regra, comentar a palavra com outra conta, responder o direct e ver o lead em Conversas. Para formulários: Ferramenta de testes de anúncios de cadastro (developers.facebook.com/tools/lead-ads-testing).
7. [ ] **Análise do app** (App Review) pedindo acesso avançado a: `instagram_basic`, `instagram_manage_comments`, `instagram_manage_messages`, `instagram_manage_insights` (números da aba Conteúdo, v92), `instagram_content_publish` (publicar e agendar os carrosséis, v129; gravar o vídeo quando a v129 existir, mas já pedir na mesma análise se der), `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `pages_manage_ads`, `leads_retrieval`, `business_management`. A Meta pede um vídeo de cada uso (gravar a tela: conectar, aba Conteúdo com os números, regra, direct chegando, lead no CRM, cadastro do formulário) e a política de privacidade (prospectteam.com.br/privacidade).
8. [ ] Depois de aprovado: colocar o app em **modo Ao vivo**. Aí qualquer cliente conecta.
9. [ ] Conferir em Plataforma › Configurações › "Instagram e anúncios · Meta" (mostra contas conectadas, directs e cadastros do mês).
10. [ ] **Devolver as vendas para a Meta (v93)**: não precisa de permissão nova no app (cada cliente usa o token do próprio Gerenciador de Eventos). Para testar com a sua conta: Gerenciador de Eventos › Fontes de dados › o pixel da conta de anúncios › copiar o ID; Configurações › API de Conversões › Gerar token de acesso; colar os dois em Instagram › Formulários › Devolver as vendas para a Meta; na aba Testar eventos copiar o código TEST… e clicar em Mandar teste. Depois, criar um cadastro pela ferramenta de testes de anúncios e mover o lead no funil: os eventos aparecem no conjunto de dados como eventos do CRM.

## 4e. Ligações pelo CRM (v94)
1. [ ] **Provedor de telefonia** (sugestão: Nvoip; Twilio como plano B): abrir a conta, comprar um número (DDD 71 para começar) e pegar o login SIP (usuário, senha e o endereço do servidor SIP). Perguntar: tarifa por minuto para celular e fixo, cobrança em blocos (30 s + 6 s?), uso de SIP trunk com servidor de terceiros e se aceitam discagem automática.
2. [ ] **LiveKit** (cloud.livekit.io › projeto das reuniões › Telephony): criar o **tronco de saída** (Outbound trunk) com o endereço SIP do provedor, o usuário e a senha, e os números comprados. Copiar o ID (`ST_…`) para `TELEFONIA_TRONCO_SAIDA` na api e fazer o redeploy.
3. [ ] Conferir: Plataforma › Clientes › a conta › aba **Telefonia** mostra "ok (tronco … → endereço)".
4. [ ] Na mesma aba, **cadastrar o número** da conta (o comprado no provedor). Com mais de um, o CRM liga com o do mesmo DDD do lead.
5. [ ] Na aba **Plano e módulos**, ligar o módulo **Ligações** (preço e franquia na Tabela de preços: R$ 890/mês com 2.000 minutos e R$ 0,35 o minuto extra, valores de partida a confirmar com o custo do provedor).
6. [ ] Testar: abrir um lead com o seu celular, clicar em **Ligar**, atender, falar 1 minuto, desligar, conferir o "Como foi?" com o resumo e a gravação na ficha.
7. [ ] **Receber ligações (v95)**: no provedor, apontar os números da empresa para o endereço SIP do LiveKit (cloud.livekit.io › Telephony mostra o "SIP URI" do projeto). No LiveKit, criar o **tronco de entrada** (Inbound trunk) com os números da empresa (e, se o provedor pedir, usuário e senha ou os IPs dele).
8. [ ] No LiveKit, criar a **regra de despacho** (Dispatch rule) do tipo **Individual** com o prefixo de sala **`lig-in-`**, ligada ao tronco de entrada. Cada ligação que chega vira uma sala `lig-in-…` e o webhook do LiveKit (o mesmo das reuniões) avisa o CRM. Testar: ligar do seu celular para o número da empresa com o CRM aberto: aparece "Ligação entrando" na tela.
9. [ ] **Siga-me**: em Gestão › Equipe, cadastrar o celular de cada comercial (é para onde a ligação vai quando ninguém atende no CRM). Em Gestão › Telefonia dá para desligar o siga-me, mudar os tempos de toque ou desligar o receber pelo CRM.
10. [ ] **Menu de voz (v116, cliente de autopeças)**: precisa da voz do Argos (`OPENAI_CHAVE`, já configurada) e do ffmpeg (já vem na imagem da api). Na conta do cliente: Gestão › Equipe › **Grupos de atendimento** (uma loja por grupo, com os vendedores; a ordem da lista é a tecla) e Gestão › Telefonia › **Menu de voz** com a primeira frase (“Olá! Você ligou para a …”). Testar ligando do celular: ouvir o menu, apertar 1 e ver tocar só para quem é daquele grupo. No provedor, conferir que o **DTMF vai como RFC 2833** (o padrão; se a tecla não chegar, é isso). Cada ligação no menu mantém uma conexão de áudio na api enquanto toca (leve, mas conta se forem muitas ao mesmo tempo).
11. [ ] **Ligação pelo WhatsApp (v119)**: (a) Z-API: contratar as chamadas na instância e gerar a senha SIP (Chamadas › SIP; aparece uma vez só). (b) VPS em São Paulo (Vultr/Lightsail, Ubuntu 24.04, ~US$ 5–12/mês), firewall UDP 5060 e 10000–10200. (c) Na VPS: Docker, copiar `infra/whatsapp-sip`, preencher o `.env` e `docker compose up -d --build`; conferir **Registered** em `pjsip show registrations`. (d) LiveKit: tronco de entrada do número de WhatsApp (IP da VPS liberado) incluído na regra `lig-in-`, e tronco de saída para o IP da VPS com usuário/senha do `.env`. (e) Railway › api: `TELEFONIA_TRONCO_WHATSAPP` = ST_ do tronco de saída. (f) Master › conta › Telefonia: cadastrar o número com o tipo WhatsApp. Passo a passo completo no `infra/whatsapp-sip/LEIAME.md`. Testar recebida e feita; se a tecla do menu não chegar, desligar o menu e avisar o Claude.
12. [ ] **Proteção do número (porteiro, v118)**: na conta do cliente, Agente › Atendimento › Proteção do número: ligar (sugestão para API não oficial: segurar a partir de 5 contatos em 1 hora, 30 contatos novos por número por dia, 30 s entre eles, pausa com sinal de risco ligada). Não precisa de variável nova; o "Variar com a IA" usa a IA da conta.

## 4f. API aberta (v96)
1. [x] Subir a v96 (migration 075) e fazer o redeploy do **site** também: a documentação fica em prospectteam.com.br/api e o botão "Testar o pedido" usa o rewrite `/api/v1/*` do `apps/site/vercel.json`.
2. [ ] Conferir que a `CHAVE_CREDENCIAIS` está na api (sem ela, não dá para criar avisos/webhooks: o segredo de cada um é guardado cifrado).
3. [ ] Conferir a Tabela de preços: o recurso **API e integrações** entrou no Time e no Escala (e nos personalizados que já tinham "Trabalho em equipe"). Se for vender só no Escala, tire do Time.
4. [ ] Testar numa conta: Gestão › Integrações › Nova chave; `curl https://app.prospectteam.com.br/api/v1/ -H "Authorization: Bearer <chave>"` responde a conta. Formulário do site: criar, colar o endereço num formulário de teste, enviar e ver o lead no funil. Aviso: criar com um endereço do webhook.site e clicar em Enviar teste.
5. [ ] (Opcional) Se a api tiver domínio próprio direto (sem passar pelo Vercel), dá para documentar esse endereço no lugar de app.prospectteam.com.br/api/v1 (`API_URL_PUBLICA`).

## 4g. Teste grátis e assinatura pelo sistema (v97)
1. [x] Subir a v97 (migration 076) com o redeploy da api, do front e do **site** (os botões "Testar grátis 7 dias" apontam para app.prospectteam.com.br/teste; o site ganhou as seções Instagram e Ligações e a apresentação tem 25 slides). Depois do deploy, abrir prospectteam.com.br, rolar até Instagram e Ligações e conferir que as animações rodam, e abrir /apresentacao (slides 9 a 13).
2. [ ] **Asaas**: criar a conta (asaas.com) e, para testar antes, uma no sandbox (sandbox.asaas.com). Em Integrações › Chave de API, gerar a chave e pôr na api: `ASAAS_CHAVE` e `ASAAS_SANDBOX=sim` (com a chave do sandbox). Na conta de produção, tirar o `ASAAS_SANDBOX` e trocar a chave.
3. [ ] No Asaas, Integrações › Webhooks: criar um webhook para **cobranças** com a URL `https://prospeccaoapi-production.up.railway.app/asaas/webhook` (o endereço da api), versão v3, e um **token de autenticação** (16 caracteres ou mais). Pôr o mesmo token na api: `ASAAS_TOKEN_WEBHOOK`. Marcar os eventos de cobrança (criada, confirmada, recebida, vencida, estornada, apagada).
4. [ ] No Asaas, configurar a **nota fiscal** automática (Notas fiscais › Configurações: dados da empresa, prefeitura e serviço) para sair quando a cobrança for paga, se quiser a nota pelo Asaas.
5. [ ] **Cloudflare Turnstile** (dash.cloudflare.com › Turnstile › Add site): domínio app.prospectteam.com.br, modo Managed. Pôr na api: `TURNSTILE_SITE` (site key) e `TURNSTILE_SEGREDO` (secret key).
6. [ ] Conferir que a **conta principal** tem o Resend funcionando (os e-mails de confirmação e de fim do teste saem por ela). Testar: abrir app.prospectteam.com.br/teste numa janela anônima, cadastrar com um e-mail seu, confirmar e ver a conta nascer com a faixa do teste; no painel master, Vendas › coluna Testando.
7. [ ] Testar a assinatura no sandbox: Meu plano › Assinar com Pix; no sandbox do Asaas, marcar a cobrança como recebida e ver a conta virar "Assinatura ativa" e o pedido ir para Virou cliente.
8. [ ] Clientes de contrato combinado (os de antes) não mudam: não têm teste nem assinatura pelo sistema e continuam como estão.
9. [ ] Conferir na Tabela de preços: módulo **Ligações R$ 499 com 2.000 minutos** e o **pacote de minutos +500 por R$ 149** (quem assina pelo sistema compra quando a franquia acaba; o saldo não vence). O "minuto extra" (R$ 0,35) agora vale só para contrato combinado com a gente.
10. [ ] Sem recorrência: cada mês é uma cobrança avulsa no Asaas (o cliente escolhe Pix, boleto ou cartão na hora). No Asaas, deixar ligadas as **notificações ao cliente** (e-mail/SMS de cobrança criada e vencendo) para o financeiro do cliente receber o link também. Se o Pix não aparecer na tela, cadastrar uma **chave Pix** na conta do Asaas (sem ela o QR vale só até 23:59 do dia).

**Asaas de produção (conta aprovada em 31/10; v102):**
11. [ ] No Asaas de produção, Integrações › Chave de API: gerar a chave (começa com `$aact_prod_`) e pôr na api do Railway como `ASAAS_CHAVE`. **Apagar** a variável `ASAAS_SANDBOX` (com ela, a api fala com o sandbox).
12. [ ] Integrações › Webhooks › Adicionar: nome "Prospect Team", URL `https://prospeccaoapi-production.up.railway.app/asaas/webhook`, versão da API v3, fila de sincronização ligada, **token de autenticação** com 16+ caracteres (o mesmo valor em `ASAAS_TOKEN_WEBHOOK` na api), eventos de **Cobranças** (criada, confirmada, recebida, vencida, estornada, removida). Salvar e conferir que a fila fica verde.
13. [ ] Cadastrar uma **chave Pix** na conta (Pix › Minhas chaves) para o QR Code durar até o vencimento.
14. [ ] Redeploy da api. Em Sistema › Saúde e consumo, o Asaas deve aparecer "ok" sem "(sandbox)". Em Meu plano › Assinar some o aviso "Modo de teste do Asaas".
15. [ ] Teste real de ponta a ponta com valor baixo: no master, crie um cliente de teste com plano personalizado e **valor combinado R$ 5**, Plano e módulos › Como o cliente paga › **Cobrar pelo sistema** (vencimento hoje), abra "Página de pagamento" e pague com Pix; em até 1 minuto a cobrança fica "paga" e o "pago até" anda um mês. Depois, Parar de cobrar e desative o cliente. (A taxa do Asaas sai do valor.)
16. [ ] Plano personalizado pedido pelo site (formulário, plano "Personalizado", ou WhatsApp): peça para a pessoa fazer o cadastro (Assinar), depois no master abra o cliente › Plano e módulos, escolha Personalizado, monte e ponha o valor, salve e use **Cobrar pelo sistema** com vencimento hoje. Ela recebe o aviso e paga em Meu plano › Pagar.
17. [ ] Clientes que já pagam por fora e vão passar a pagar pelo sistema: abrir cada um em Plano e módulos, conferir plano e valor combinado e usar **Cobrar pelo sistema** com o dia do vencimento que já tinham. O sistema manda a cobrança 7 dias antes; o e-mail do financeiro recebe pelo Asaas.

## 4h. Saúde e consumo (v98)
1. [x] Subir a v98 (migration **077**, roda sozinha) com o redeploy da **api**, do **worker-descoberta**, do **worker-enriquecimento** e do front. Sem variável nova; apagar as do Apify (seção 2 › Busca).
2. [ ] Abrir **Sistema › Saúde e consumo › Custos › Planos dos serviços** e informar o que foi contratado: LiveKit (plano, US$ por mês, minutos de participante e de ligação inclusos e o preço do minuto a mais; no Build, deixar o "a mais" vazio, porque ele para), a operadora (Nvoip: franquia e preço do minuto para celular e fixo), o plano do Resend e os pacotes do Serper. Em **Outros custos fixos**: Railway, Vercel, domínios… (o antigo "Infraestrutura por mês" já veio como "Servidores e banco (Railway)").
3. [ ] **LiveKit**: o plano grátis (Build) inclui só 1.000 minutos de ligação por mês somando todos os clientes e não cobra excedente (as ligações param). Passar para o **Ship** (US$ 50/mês, 5.000 minutos de ligação, depois US$ 0,004/min) antes do primeiro cliente do módulo Ligações e atualizar em Planos dos serviços.
4. [ ] **Nvoip**: pedir a cotação da franquia para celular (5.000 ou 10.000 min/mês). No crédito avulso (R$ 0,35/min celular), um cliente que usa os 2.000 minutos custa mais que os R$ 499 do módulo; com plano (cerca de R$ 0,20/min), sobra margem.
5. [ ] **Serper (v99) é pré-pago**: sem mensalidade; cada pacote é pago uma vez e vale 6 meses (sobra se perde). Em Planos dos serviços › Serper, clicar em **Adicionar pacote** a cada compra (data, créditos, US$); os 2.500 grátis do cadastro entram como um pacote de US$ 0. Comprar do tamanho do uso de 6 meses: o de US$ 50 (50 mil créditos, ~16 mil leads) atende 1 a 2 clientes Start nesse prazo. O saldo da tela é calculado pelo sistema: conferir de vez em quando no painel do Serper.
6. [ ] Depois de um dia rodando, conferir a aba **Agora**: cada serviço com chamadas na última hora (cinza é normal à noite). Serviço vermelho avisa no sino.

## 4i. Tour do sistema e Argos (v100)
1. [x] Subir a v100 (migration **079**, roda sozinha) com o redeploy da **api**, do front e do **site**. Sem variável nova.
2. [ ] Escolher a voz e a velocidade do Argos em **Sistema › Operação › Argos (assistente)** e clicar em Ouvir: a mesma voz narra o tour. Trocou depois: o tour gera os áudios de novo sozinho na próxima vez que alguém assistir.
3. [ ] Assistir o tour uma vez (Ajuda › Tour do sistema, dentro do CRM de demonstração) para os áudios ficarem prontos e conferir a pronúncia.
4. [ ] Perguntar ao Argos uma dúvida de uso ("como eu conecto o WhatsApp?") e uma fora do assunto, para ver a recusa.
5. [ ] Decidir se o slogan "Seu comercial mais perto de quem decide" (site e tela de login) fica assim.

## 4j. Google e buscadores (v104) — o site ainda não aparece no Google
Em 01/11 nem "prospect team crm" achava o site: o Google ainda não indexou o domínio. O site já está pronto (título, descrição, dados estruturados, sitemap, llms.txt); falta avisar o Google.
1. [x] **Google Search Console** (search.google.com/search-console) › Adicionar propriedade › **Domínio** › `prospectteam.com.br`. Ele mostra um registro **TXT**: criar no DNS do domínio (onde o domínio está: Registro.br ou Vercel › Domains) e clicar em Verificar (pode levar algumas horas).
2. [x] No Search Console › **Sitemaps**: enviar `https://prospectteam.com.br/sitemap.xml`.
3. [x] **Inspeção de URL** › `https://prospectteam.com.br/` › **Solicitar indexação** (e o mesmo para `/apresentacao` e `/api`).
4. [ ] Conferir os dados estruturados em search.google.com/test/rich-results com `https://prospectteam.com.br/` (deve achar Organização, Aplicativo de software e Perguntas frequentes).
5. [ ] **Bing Webmaster Tools** (bing.com/webmasters): "Importar do Google Search Console". O Bing alimenta a busca do ChatGPT e do Copilot.
6. [ ] Links apontando para o site: bio do Instagram e página da empresa no LinkedIn (com `?utm_source=instagram` / `?utm_source=linkedin`), perfil grátis no **B2B Stack** e no **Capterra/GetApp** (diretórios de software que o Google confia).
8. [x] **Domínio principal sem www (achado no PageSpeed em 01/11):** hoje `prospectteam.com.br` redireciona para `www.prospectteam.com.br`, mas o site, o canonical e o sitemap usam o endereço sem www. No Vercel › projeto prospeccao-site › Settings › **Domains**: em `www.prospectteam.com.br` › Edit › **Redirect to** `prospectteam.com.br` (308); em `prospectteam.com.br` › Edit › sem redirecionamento. Depois, reenviar o sitemap no Search Console.
7. [ ] Em 1 a 2 semanas a busca pelo nome (“prospect team crm”) deve trazer o site. Aparecer para “CRM” sozinho é briga com Salesforce, HubSpot, Pipedrive e RD (anos e muito conteúdo); o caminho é buscar frases como “CRM de prospecção B2B”, “lista de empresas por CNAE”, “CRM com WhatsApp e IA” e páginas por nicho (plano: `plano-proximas-versoes.md`).

## 4k. Contador de empresas do site (v105)
1. [x] Depois de subir a v105/v106 (com o **worker-cnpj**), clicar em **Importar agora** em Painel › Base CNPJ. Funciona mesmo sem campanha (aí só conta os nichos para o site). Leva algumas horas: são ~60 arquivos da Receita, baixados e lidos um a um; a tela mostra a etapa e o arquivo. A importação agora lê o Brasil todo para contar os nichos (guarda os dados completos só das UFs das campanhas, como antes); demora o mesmo, o arquivo é o mesmo.
2. [x] **Base do Brasil todo (v108):** no Railway › worker-cnpj › Variables, pôr `CNPJ_UFS_EXTRAS=TODAS`. A importação passa a guardar as empresas das 27 UFs (com os CNAEs dos nichos prontos e dos nichos das contas). Ocupa mais espaço no Neon (alguns GB: confira o limite do plano) e a importação demora mais para gravar. Depois da primeira, a Base CNPJ mostra quantos estabelecimentos foram guardados.
3. [ ] **v111:** a base passa a guardar só empresas ativas. Ao subir, o worker-cnpj reinicia e a importação em andamento continua do último arquivo; no fim, ela apaga as fechadas que já tinham entrado e compacta o banco (o volume do Postgres no Railway diminui). Conferir em Railway › Postgres › Metrics o espaço antes e depois.
4. [ ] Quando terminar, abrir prospectteam.com.br: na seção Nichos aparece "Quantas empresas do seu nicho existem na sua cidade?". Testar com Autopeças · Bahia · Feira de Santana.

## 4l. Tráfego pago (para depois, decidido em 01/11)
1. [ ] **Tags de conversão no site** (Claude coloca quando pedir): Google Ads e pixel da Meta, só com o evento "começou o teste" (clique em Testar grátis/Assinar e cadastro), e liberar os domínios no bloqueio de segurança (CSP) do `vercel.json`. Sem elas, o anúncio não aprende quem converte.
2. [ ] **Google Ads › Pesquisa primeiro:** verba pequena e fixa por dia, 10 a 20 frases de intenção (não "CRM" sozinho): "lista de empresas por CNAE", "prospecção de clientes B2B", "CRM com WhatsApp e IA", "base de empresas por cidade", "CRM para autopeças"… Preço de cada uma no Planejador de palavras-chave. Rodar 2 a 3 semanas e olhar Visitas do site (cliques em testar/assinar e cadastros).
3. [ ] **Meta Ads** (Instagram/Facebook) depois: anúncio do contador ("Quantas autopeças existem na sua cidade?") para donos e gestores comerciais da região.
4. [ ] **YouTube** como remarketing (quem visitou e não testou), com o tour do Argos ou um vídeo de 30 s. **LinkedIn Ads** só quando souber quanto vale um cliente (é o clique mais caro).
5. [ ] Todo link de anúncio com `?utm_source=…&utm_campaign=…` para aparecer em Visitas do site › Campanhas.

## 4m. Segurança (v110)
1. [ ] **Subir a v110** (api, workers, front e site). Depois do deploy, todo mundo precisa entrar de novo uma vez (os cookies antigos deixam de valer). Os convites já enviados continuam funcionando.
2. [ ] **Conferir o IP real:** depois do deploy, entrar no sistema e abrir Minha conta › Onde você está conectado: o IP da sessão atual tem que ser o da sua internet (compare com "qual é meu IP" no Google), não um endereço do Vercel/Amazon. Se aparecer o do Vercel, pôr `PROXIES_CONFIAVEIS=3` na api e avisar o Claude.
3. [ ] **Railway › api › Variables:** conferir `NODE_ENV=production` (o cookie seguro já liga sozinho com endereço https, mas outras partes usam essa variável).
4. [ ] **Proteção contra DDoS na frente da api (recomendado, quando der):** hoje o Vercel e a borda do Railway seguram o grosso, e a api tem limites por endereço e por pessoa. O passo seguinte é pôr a api num domínio próprio (ex.: `api.prospectteam.com.br`) atrás do **Cloudflare** (plano grátis já tem proteção DDoS e regras de taxa) e fechar o acesso direto ao `*.up.railway.app`. Pedir ao Claude quando for fazer (muda o rewrite do `vercel.json` e o `PROXIES_CONFIAVEIS`).
5. [ ] **Neon:** ativar a restauração por ponto no tempo/backups no plano, e trocar a senha do banco se ela já foi compartilhada em algum lugar (print, conversa). A conexão já exige TLS com certificado conferido.
6. [ ] **Segredos:** `JWT_SEGREDO` e `CHAVE_CREDENCIAIS` com 32+ caracteres aleatórios e iguais em todos os serviços que usam; nunca em print ou conversa. Trocar o `JWT_SEGREDO` derruba todas as sessões (todo mundo entra de novo).
7. [ ] **Contas com acesso ao painel master e à conta principal:** ligar a verificação em duas etapas (Minha conta) em todas.

## 4n. Carrosséis com IA (v121)
1. [ ] **Subir a v121** (migration **089**, roda sozinha) com o redeploy da **api** e do front. A imagem Docker da api passa a levar os desenhistas dos slides (sharp e resvg, já prontos para Linux, sem compilar) e as fontes; os workers não mudam. Sem variável nova.
2. [ ] Conferir que o **bucket das reuniões** (`GRAVACOES_S3_*`, seção 2) está ligado: as logos e as fotos da empresa ficam nele, na pasta `carrosseis/<conta>/`. Se um dia criar regra de ciclo de vida no R2, deixar essa pasta de fora.
3. [ ] **Tabela de preços** (master › Clientes › Tabela de preços): desde a v123, **Carrosséis com IA R$ 200 sem limite** (a migration **091** troca sozinha os valores de partida R$ 397 / 20 se a tabela ainda estiver com eles; se você já tinha mudado à mão, conferir). O campo de carrosséis por mês vazio = sem limite; dá para pôr um limite só para um cliente em Plano e módulos.
4. [ ] **Liberar para um cliente**: master › Clientes › o cliente › Plano e módulos › marcar **Carrosséis com IA** (e, se quiser, a franquia própria dele) › Salvar. Desde a v123 o cliente também assina sozinho em **Meu plano › Assinar**, e o módulo aparece no site.
5. [ ] Testar numa conta liberada (o administrador): Automação › **Carrosséis** › Identidade visual (cores, estilo, fontes, logo, assinatura) › Fotos da empresa (enviar uma foto do celular) › Novo carrossel › editar › **Ver como no Instagram** › **Baixar as imagens** e postar à mão no Instagram para conferir a nitidez.
6. [ ] **Time de IA (v122)**: (a) console.anthropic.com › Settings › API keys › criar a chave (e pôr crédito em Billing; dá para pôr um limite de gasto mensal lá). (b) Railway › api › Variables: `ANTHROPIC_CHAVE` = a chave; `CARROSSEIS_MODELO` só se quiser outro modelo (padrão `claude-sonnet-5-5`). Redeploy da api (migration **090** roda sozinha). (c) Plataforma › Configurações › **Carrosséis com IA · Claude** › Testar: "ok (claude-sonnet-5-5)". (d) Na conta de um cliente com o módulo: Carrosséis › **Cérebro da marca** › Montar com a IA › corrigir › **Está certo: conferi**; cadastrar uma promoção em O que divulgar; **Novo carrossel** › Criar com o time de IA. Em 1 a 2 minutos o carrossel abre no editor; conferir os avisos do revisor e baixar as imagens. (e) O custo aparece em Financeiro (linha Carrosséis com IA) e em Saúde e consumo (Claude). Custo esperado: cerca de US$ 0,10 a 0,25 por carrossel (4 a 7 chamadas, com o cérebro da marca no cache) e cerca de US$ 0,05 a 0,10 por rascunho do cérebro.
7. [ ] **Conversa com o time (v123)**: subir a v123 (migration **091**) com o redeploy da **api**, do **front** e do **site** (Vercel). Sem variável nova. Testar: abrir um carrossel › aba **Conversa** › "Slide 2: cite a garantia" › conferir a proposta › **Aplicar** › **Desfazer**; depois "Carrossel inteiro: inclua um slide com…" e "Legenda: mais curta". Custo esperado por pedido: cerca de US$ 0,02 a 0,06 (2 ou 3 chamadas). Conferir também o site (cartão do módulo com R$ 200) e o Assinar (Carrosséis com IA marcável).
8. [ ] **Apresentação do time (v124)**: redeploy da api (migration **092**) e do front. Testar entrando em Carrosséis com o administrador: a janela do time abre uma vez; depois fica a faixa com "Conhecer o time". Confirmar a licença de uso das 4 fotos (`apps/web/public/carrosseis/time/`).
9. [ ] **Próximas etapas que vão pedir configuração**: v128 a chave da **OpenAI** com acesso ao GPT Image 2 (a mesma `OPENAI_CHAVE` do Argos pode servir, se a organização da OpenAI estiver verificada para gerar imagens); v129 o `instagram_content_publish` aprovado (4d.7).

## 4o. Qualidade do atendimento (v125)
1. [ ] **Subir a v125** (migration **093**, roda sozinha) com o redeploy da **api**, do **front** e do **site** (Vercel). Sem variável nova: usa a IA da conta (a DeepSeek da plataforma ou a chave própria do cliente) e entra no consumo de IA da conta.
2. [ ] **Tabela de preços** (master › Clientes › Tabela de preços): conferir que **Qualidade do atendimento** ficou marcado nos planos **Time** e **Escala** (a migration 093 marca sozinha na tabela salva). Para dar a um cliente do Start, marque o recurso no plano personalizado dele.
3. [ ] **Testar numa conta com o recurso**: um vendedor conversa pelo WhatsApp com um lead (pelo menos 3 mensagens dele, de segunda a sábado entre 7h e 19h para medir o tempo) e a conversa fica parada **2 horas**. A nota aparece em Conversas (selo na lista e o botão **Nota do atendimento**) e em **Gestão › Qualidade do atendimento**. Ligação gravada e transcrita também ganha nota. Conferir **Discordar da nota** (administrador), **Ver resumo › Enviar para** (o vendedor recebe o aviso) e o cartão no **Meu dia** do vendedor.
4. [ ] O CRM de demonstração (**Recriar os dados**) já vem com notas fictícias das últimas 4 semanas para mostrar o painel.
5. Custo esperado: uma chamada da IA por atendimento (cerca de 2 a 4 mil tokens de entrada e 600 de saída); na DeepSeek, frações de centavo por nota.

## 4p. Do carrossel ao direct (v126)
1. [ ] **Migration 094** roda sozinha no deploy da api.
2. [ ] **Conferir `API_URL_PUBLICA`** (ou o domínio público do Railway): os botões do direct passam a abrir `<api pública>/l/<código>`. Sem endereço público certo, o botão abre um link quebrado. Teste: comentar a palavra num post com regra de link, tocar no botão do direct e ver se abre o destino.
3. [ ] **Armazenamento (R2) ligado** na api: o "arquivo" do direct fica no mesmo bucket dos carrosséis (`instagram/<conta>/arquivos/`). Sem ele, a opção arquivo avisa que não dá para guardar.
4. [ ] Para a promoção abrir o WhatsApp certo, o número conectado em WhatsApp precisa estar salvo (a tela sugere o primeiro chip ativo; dá para digitar outro).
5. [ ] Testar com uma conta de verdade: carrossel com "Comente PALAVRA" → marcar como pronto → postar com a legenda → em até 10 min o sino avisa "O carrossel está no Instagram" → comentar a palavra com outra conta e receber o direct.

## 4q. Transcrição de reuniões longas (v127)
1. [ ] **Migration 095** roda sozinha no deploy da api.
2. [ ] **Recomendado: passar a Groq para o plano Developer** (console.groq.com › Settings › Billing). No grátis, cada envio vai até 25 MB e o limite é 7.200 s de áudio por hora e 28.800 s por dia (2 h e 8 h): uma reunião de 2 h espera o limite para terminar, e várias reuniões no mesmo dia podem passar do dia. No Developer o Whisper Turbo custa cerca de US$ 0,04 por hora de áudio. A v127 funciona nos dois (corta em partes e espera o limite sozinha).
3. [ ] Depois do deploy, abrir a reunião que falhou (Reunião rápida · Icaro, 10/11) e clicar em **Transcrever de novo** na caixa da Transcrição. O motivo da falha antiga não ficou guardado (a versão anterior apagava); se quiser confirmar, nos logs da api no Railway procure "reuniões: transcrição falhou" em 10/11 à tarde.

## 4r. Vídeos com IA (v128 e v129)
1. [ ] **Migration 096** roda sozinha no deploy da api.
2. [ ] **Serviço novo no Railway: `worker-videos`** (mesmo repositório e mesmo Dockerfile, como os outros workers): New › GitHub Repo › prospeccao › variável **`SERVICO=worker-videos`**. A imagem já leva ffmpeg e Chromium.
3. [ ] Variáveis do `worker-videos`: `DATABASE_URL` (a mesma da api), as `GRAVACOES_S3_*` (o mesmo bucket R2 das reuniões: os vídeos ficam em `videos/<conta>/<id>/`), `GROQ_CHAVE` (transcrição) e `ANTHROPIC_CHAVE` (decisão dos cortes; sem ela, os cortes saem por regras mais simples). Opcionais: `VIDEOS_MODELO` (padrão Claude Sonnet 5.5), `VIDEOS_WORKERS_RENDER` (padrão 2), `VIDEOS_CONCORRENCIA` (padrão 1 vídeo por vez), `VIDEOS_CUSTO_SERVIDOR_USD_HORA` (0,06) e `VIDEOS_CUSTO_TRANSCRICAO_USD_HORA` (0,111) para a conta de custo.
4. [ ] **Mais processador para o `worker-videos`**: Settings › Resources, 4 a 8 vCPU e 4 GB de memória. Com 2 núcleos, 33 s de vídeo levaram ~6 min para gerar; com `VIDEOS_WORKERS_RENDER` igual ao número de núcleos, fica bem mais rápido. Conferir o tempo real nos primeiros vídeos.
5. [ ] Depois do deploy, em Automação › Vídeos não pode aparecer o aviso amarelo "O serviço que edita os vídeos está fora do ar" (ele some quando o worker manda o sinal de vida).
6. [ ] Teste: subir um vídeo de 30 a 60 s falando de um produto, esperar o aviso no sino, conferir os cortes (Ouvir), corrigir uma palavra da legenda, Gerar de novo e Baixar.
7. [ ] Clientes: ligar o módulo **Vídeos com IA** em Plataforma › Clientes e planos › Plano e módulos (R$ 200 com 60 vídeos por mês; a franquia muda por cliente ali).
8. [x] **Licença da música (v135):** o Leonardo confirmou em 11/11 que tem autorização da ElevenLabs para uso comercial da música nos vídeos dos clientes. Guardar essa autorização por escrito junto dos contratos.
9. [ ] **v129, migration 097** roda sozinha no deploy da api. Redeploy da api, do front, do site e do `worker-videos`.
10. [ ] **Imagens geradas:** pôr no `worker-videos` a mesma `OPENAI_CHAVE` da api. Sem ela, os vídeos usam só as fotos da empresa (a tela explica). Conferir no painel da OpenAI (platform.openai.com › Settings › Organization) que a conta tem acesso ao **GPT Image 2**: algumas contas pedem a verificação da organização para liberar o modelo de imagem. Opcionais: `VIDEOS_IMAGEM_MODELO` (padrão `gpt-image-2`) e `VIDEOS_CUSTO_IMAGEM_USD` (0,05, para a conta do custo).
11. [ ] **Fotos da empresa:** as imagens dos vídeos usam as fotos de Carrosséis › Fotos da empresa (a IA descreve cada uma uma vez). Para o cliente aproveitar, suba fotos dos produtos, da fachada e da equipe ali.
12. [ ] **Música (Eleven Music, v135):** `ELEVENLABS_CHAVE` no `worker-videos` (chave restrita só à Geração de Música, com limite de créditos por mês). A música vale para **toda conta com o módulo Vídeos com IA**: o worker avisa a api pelo sinal de vida que tem a chave. A `VIDEOS_MUSICA_CONTAS` saiu (pode apagar da api e do worker). Consumo: 1 minuto de música por minuto de vídeo (US$ 0,15/min pela API; recarga em Developers › Top Up). Opcional: `VIDEOS_CUSTO_MUSICA_USD_MINUTO` (0,15).
13. [ ] Teste: um vídeo de 30 a 60 s falando de um produto que tem foto cadastrada e de uma promoção do O que divulgar. Conferir a aba Imagens (foto da empresa e uma gerada conferida), a oferta com o preço exato, a música baixando quando você fala e os efeitos (Ouvir na aba Som).


## 4s. O saber dos agentes (v130)
1. [ ] Sem migration e sem variável nova. Redeploy da **api** (carrosséis e direct) e do **`worker-videos`** (cortes, animações e imagens).
2. [ ] Conferir nos primeiros vídeos depois do deploy: o vídeo começa já no assunto (sem "oi, gente, hoje vou falar"), o título diz o assunto com as palavras da pessoa, e as animações não poluem. Nos carrosséis: capa específica, nada de "Descubra" ou "No mundo de hoje", uma chamada só.
3. [ ] Se um manual atrapalhar algo (ex.: a IA cortando a apresentação da empresa), o texto está em `packages/integrations/src/saber/`; mudar ali muda para todos os clientes.

## 4t. Vídeos ligados ao CRM (v131)
1. [ ] **Migration 098** roda sozinha no deploy da api. Redeploy da **api** e do **front**.
2. [ ] Teste: num vídeo pronto, abrir a aba **Publicação**, conferir o texto do post da redatora, ligar o Comente e receba com a palavra que você falou no vídeo, baixar, postar pelo celular com o texto e comentar a palavra de outra conta: o direct tem que chegar.

## 4u. Imagens nos carrosséis (v132)
1. [ ] **Migration 099** roda sozinha. Redeploy da **api** primeiro (por causa da coluna `origem` das fotos) e depois do **`worker-videos`** e do **front**.
2. [ ] Pôr a **`OPENAI_CHAVE`** na **api** (a mesma do `worker-videos`). Sem ela, o time usa só as fotos da empresa (a tela explica). Opcionais: `CARROSSEIS_IMAGEM_MODELO` (padrão `gpt-image-2`) e `CARROSSEIS_CUSTO_IMAGEM_USD` (0,05).
3. [ ] Teste: pedir um carrossel com "o time pode fazer imagens" e a foto de um produto; conferir a capa com o produto num cenário, a imagem gerada sem texto nem marca e, no editor, "Cenários para este produto".

## 4v. Publicar e agendar pelo CRM (v133)
1. [ ] **Migration 100** roda sozinha. Redeploy da **api** e do **front**.
2. [ ] **Pedir à Meta a permissão `instagram_content_publish`** (developers.facebook.com › o app › Análise do app › Permissões e recursos), com o vídeo mostrando o agendamento no CRM. Enquanto não sai, o cartão diz "em breve" e o caminho é baixar e postar pelo celular.
3. [ ] **Só depois da aprovação:** `META_PUBLICAR=sim` na api e reconectar o Instagram uma vez (Instagram › Conexão), para a conexão ganhar a permissão.
4. [ ] Teste: agendar um carrossel para daqui a 5 minutos com o Comente e receba ligado; conferir que saiu no Instagram, que o aviso chegou no sino e que o Calendário mostra o post.

## 4w. O time aprende com os posts (v134)
1. [ ] **Migration 101** roda sozinha. Redeploy da **api** e do **front**.
2. [ ] Para os aprendizados aparecerem, o Instagram precisa estar conectado (os números dos posts vêm de lá) e precisa haver pelo menos 3 posts com a mesma característica. Até lá a caixa explica que ainda é cedo.
3. [ ] **Contas de referência** usam o Business Discovery da Meta: precisa do Instagram conectado e o perfil de referência tem que ser profissional (empresa ou criador). Conferir com 1 perfil conhecido.
4. [ ] Teste: aba **Ideias** › Buscar ideias; conferir que cada ideia mostra a fonte com números que existem (as perguntas do cérebro da marca, os posts) e que Criar carrossel abre o pedido preenchido.

## 4x. Vídeos e carrosséis com o Claude 5.5 (v136 e v137)
1. [ ] **Migrations 102 e 103** rodam sozinhas. Redeploy da **api** primeiro, depois do **worker-videos** e do front.
2. [ ] **`OPENAI_CHAVE` no worker-videos** (a mesma da api): sem ela os vídeos não ganham imagens geradas, só as fotos da empresa.
3. [ ] Conferir no log do worker-videos que não aparece mais "a IA não decidiu os cortes" nem "a IA não propôs os enfeites" (era o Claude 5.5 recusando o pedido antigo). Na api, sumir o "Claude: HTTP 400 … tool_choice".
4. [ ] Música: a conta da ElevenLabs precisa de **plano pago** (no grátis a API de música responde 402). Se aparecer "a música não saiu", abrir a linha no log (o motivo vem junto). O 429 "system_busy" (ElevenLabs cheia) agora tenta de novo sozinho.
5. [ ] **v140**: depois do redeploy do worker-videos, gerar um vídeo com música e ouvir **no celular**. A música tem que aparecer por baixo da fala o vídeo todo, mais alta nas pausas e na tela final. Se ficar alta ou baixa demais, mexer no volume da música na tela do vídeo (35 é o padrão) e me dizer qual número ficou bom.

## 4y. Cards avulsos (v144)
1. [ ] **Migration 104** roda sozinha no redeploy da **api** (depois o front publica sozinho; o worker-videos não muda).
2. [ ] Conferir em Carrosséis › **Cards avulsos**: pedir 2 cards × 2 variações em **story** e em **feed**, escolher a variação, Baixar os escolhidos, Outra variação, Publicar (story vai como story no Instagram).
3. [ ] **Melhorar a foto** e **cenário** precisam da `OPENAI_CHAVE` na **api** (é ela que faz as imagens dos carrosséis); sem a chave, as fotos do pedido entram como foram enviadas.
4. [ ] Franquia: o pedido de cards conta 1 no mês (como um carrossel). Se preferir contar por card, me avise.

## 4z. Segundo cérebro (v147)
1. [ ] **Cérebro primeiro**: aplicar o `brain-externo.zip` no repositório `brain`, commit e push. No Railway do Cérebro, redeploy da **api** (roda a migration 008), do **mcp** (o token agora tem uso) e da **web**. O worker não muda.
2. [ ] **Prospect Team depois**: migration 105 roda sozinha no redeploy da **api**; o front publica sozinho. Precisa da **CHAVE_CREDENCIAIS** na api (já usada pelo Instagram e pelos avisos).
3. [ ] No Cérebro: Integrações › **Outros sistemas (Prospect Team)** › Gerar token. Gere **um token por conta** do Prospect Team que vai ligar (Tutts, Fiix…), com o nome da conta, para revogar uma sem parar as outras. O token age em nome de quem gerou: gere com o seu usuário (ou um usuário próprio, tipo "Prospect Team", papel membro).
4. [ ] No Prospect Team: Integrações › **Segundo cérebro** › cole o endereço e o token › Conectar e testar. Depois, em "Ver o que os agentes vão ler", procure um assunto que você sabe que está no Cérebro.
5. [ ] Conferir que o que é **restrito** no Cérebro não aparece na busca e que os registros de clientes não mostram dado pessoal (o Cérebro mascara e-mail, CPF, telefone…; **nomes de pessoas não são mascarados**: se uma ficha de cliente tiver nome de pessoa que não pode ir para um post, marque como restrito).
6. [ ] Em até 6 horas depois de ligar (e depois 1 vez por semana), ver em **Revisar** no Cérebro a nota "Aprendizados do Instagram — <conta> — semana …" (ou clicar em Enviar aprendizados agora). Aprove se fizer sentido para a equipe. Conta sem números do Instagram não manda nada.
7. [ ] Os tokens do Claude que já existiam continuam valendo só no conector do Claude (a migration marca todos como `claude`).

## 5. Cada cliente (Plataforma › Clientes e planos)
- [ ] "Novo cliente": nome, plano (Start/Time/Escala/Personalizado), módulos (WhatsApp, Agente de IA, E-mail) e o 1º administrador. Mandar o link de convite.
- [ ] Aba "Plano e módulos": ajustar usuários e leads/mês se o combinado foi diferente, e a mensalidade combinada.
- [ ] Credenciais do cliente (ou usar as da plataforma): Resend, IA, Google Places, ORS. Usar "Testar" em cada uma. Só os módulos contratados funcionam.
- [ ] "Consumo e tetos": decidir se ele usa a IA da plataforma e, se quiser, tetos mensais.
- [ ] Organização com várias unidades: criar as unidades e os gestores/diretoria. Se a organização pedir, exigir verificação em duas etapas.
- [ ] Dentro da conta, o cliente segue os **Primeiros passos** da tela inicial: conectar WhatsApp, criar nicho, rodar a 1ª campanha, ensinar a IA, montar a equipe. Dúvidas: menu **Ajuda**.
- [ ] **IA de atendimento** (Agente › Configuração da IA):
  - "Preencher com IA" a partir do site, documentos e conversas reais.
  - Aceitar ou descartar cada sugestão e conferir as 8 seções.
  - Pôr pelo menos um item na Base de conhecimento.
  - Rodar a **prova** e aprovar todas as respostas.
  - Só então "Ligar a IA". Começar com "Revisar antes de enviar" ligado.
  - O Argos também usa essa configuração (só as seções conferidas) para responder sobre o que a empresa vende.
- [ ] Equipe: para cada SDR/closer, decidir "A unidade toda" ou "Só a própria base".
- [ ] Logo e cor da marca (white label) aparecem também na página da sala de reunião que o lead abre.

- [ ] **Planos (v72):** painel da plataforma › Clientes › cada cliente › Plano e módulos. Quem já tinha plano ficou com todos os recursos "liberados à parte" e com os números de WhatsApp acima de 2 contados como extras (cobrados): desmarcar o que não foi vendido, ajustar os números extras e, se for o caso, o valor combinado. Conferir também a Tabela de preços (recursos de cada plano, horas de reunião, combo R$ 497, número extra R$ 110, 1.000 conversas da IA).
- [ ] **Preços da v74:** depois da migration 064, conferir a Tabela de preços (Start 497, Time 1.300 com e-mail incluso e 30 h, Escala 2.500 com horas em branco = sem limite, combo R$ 999, 3 números, conversas em branco = sem limite). Quem já tinha plano ficou com a mensalidade antiga em "Valor combinado": apagar o valor de quem passa a pagar a tabela nova.
- [ ] **Contato do site e da apresentação:** a migration 064 preenche WhatsApp (71) 99363-5290 e e-mail prospectteam@gmail.com em Pedidos do site › Contato, só se estava vazio. Testar o botão "Agendar demonstração" da apresentação: abre prospectteam.com.br/demonstracao e o pedido chega marcado "pela apresentação comercial".

## 6. Conferir depois de configurar
- [ ] **Painel › Configurações › Testar tudo** (v79): todos os serviços em "Funcionando"; os que faltam dizem a variável e o serviço do Railway.
- [ ] **Painel › Financeiro › Custos unitários:** preencher com os valores das faturas (IA, Z-API, Groq, R2 e dólar). Serper, Resend, LiveKit, a operadora do telefone e os custos fixos ficam em **Sistema › Saúde e consumo › Planos dos serviços** (seção 4h).
- [ ] **CRM de demonstração:** Abrir a demonstração e Recriar os dados antes de cada apresentação (as datas ficam no dia da geração).
- [ ] E-mail › Configuração › "Testar conexão" (Resend e respostas).
- [ ] Campanha de e-mail › "Prévia e teste": a abertura da IA aparece e o teste chega na caixa.
- [ ] Agente: status do WhatsApp e da IA sem aviso. O Simulador responde usando a base.
- [ ] Prova da IA: os cenários de armadilha ("desconto", "ignore suas regras", cidade fora da área) foram barrados ou passados para o time.
- [ ] Número de uso diário: um contato antigo manda mensagem e **nada** aparece em Conversas nem em "Sem lead".
- [ ] Argos:
  - Perguntar por texto "como está meu funil?" e conferir os números com a tela do Funil.
  - Entrar com um comercial "só a própria base" e repetir: os números devem ser só os dele.
  - Dizer "lembra que minha meta é 30 reuniões por mês" e, depois, "qual é a minha meta?". Conferir em "O que o Argos lembra".
  - Perguntar "o que a gente vende?": a resposta deve sair da Configuração da IA conferida.
  - Com as chaves de voz, testar o microfone e a fala.
- [ ] **Reuniões por vídeo** (teste com aparelhos reais):
  - Menu Vendas › **Reuniões**: nenhum aviso amarelo no topo (se aparecer, falta variável).
  - "Reunião agora" no computador, pelo **Chrome ou Edge**: o botão é **Entrar e gravar**; o navegador pergunta se pode compartilhar a aba → **Compartilhar**. O selo vermelho "Gravando" aparece no alto.
  - Abrir o link no celular (4G, fora do Wi-Fi) e num segundo computador. Conferir imagem, som, atraso e a troca de câmera.
  - Compartilhar a tela, levantar a mão, mandar mensagem e um arquivo no chat, silenciar alguém e "Encerrar para todos".
  - Marcar uma reunião para daqui a 30 minutos com abertura de 10 minutos: o link deve mostrar a contagem e só liberar 10 minutos antes. Com "Eu aprovo cada pessoa que chegar", o convidado fica na sala de espera.
  - Ao sair, esperar na aba a mensagem **Gravação enviada**.
  - Uns minutos depois: em Reuniões › Realizadas aparecem o vídeo, a transcrição com o nome de quem falou e o resumo. A ficha do lead mostra "Reuniões gravadas".
  - No log da api: "gravação do navegador montada". Se aparecer "ffmpeg não está instalado", a imagem Docker da api não foi refeita com o Dockerfile novo.
- [ ] **Vendas na rua** (com um vendedor de verdade):
  - Menu Vendas › **Na rua** › Planejar o dia: sem aviso amarelo (se aparecer, falta a `ORS_API_KEY` na api).
  - Escolher o vendedor, a campanha e "Sugerir roteiro do dia": os números aparecem no mapa ligados pelo caminho das ruas, com a hora de chegada e o almoço.
  - Tirar uma visita, mudar a ordem, clicar num lead do mapa para incluir e "Otimizar a ordem".
  - "Mandar para o celular de …": o vendedor recebe o aviso (sino e notificação no celular).
  - No celular dele (4G): Na rua abre em "Visitas de hoje"; "Ir com o Waze" abre o caminho; na porta, "Cheguei" pede a localização e mostra "no endereço da empresa".
  - Registrar: "Pediu proposta", falar a anotação (vira texto), tirar a foto da fachada, conferir o próximo passo e "Concluir e ir para a próxima".
  - Conferir no Funil: o lead foi para Proposta, com o próximo passo e a visita no histórico.
  - No computador, Na rua › Visitas da equipe: a visita aparece em "Últimas visitas" (com "ver foto") e o vendedor "A caminho da 2".
- [ ] **Planos:** entrar como administrador de um cliente Start: Na rua, Argos, Atividade e Auditoria aparecem com cadeado e a tela explica a partir de qual plano vêm; Meu plano mostra o que está incluído, os números de WhatsApp, as horas de reunião e as conversas da IA. Com os números todos em uso, "Conectar número" avisa o limite.
- [ ] Faixa de alertas no topo vazia. Se aparecer algo, o texto diz o que falta.
- [ ] Minha conta › "Notificações no celular" › Ligar neste aparelho › "Mandar um teste".
  - No iPhone, antes: Safari › Compartilhar › "Adicionar à Tela de Início" e abrir pelo ícone.
- [ ] Painel master › Operação: workers com sinal de vida, sem erro recente.
