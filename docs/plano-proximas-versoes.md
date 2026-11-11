# Prospect Team — plano das próximas versões (a partir da v92)

Definido em 31/10/2026 com o Leonardo. Ordem combinada: **1) devolver as vendas para a Meta** (topo, v93 feita), depois **ligações pelo CRM** (v94 e v95 feitas), **API aberta com documentação** (v96 feita), **teste grátis e assinatura sozinho pelo site** (v97 feita). Fora da ordem, a v98 trouxe **Saúde e consumo** (painel master: cada serviço externo agora, consumo do mês contra os planos e custos fixos + excedentes) e tirou o **Apify** (o enriquecimento é só pelo Serper e o Maps pelo Places); a v99 tratou o **Serper como pré-pago** (pacotes com saldo e vencimento, sem mensalidade) e a v100 trouxe o **tour do sistema** narrado pelo Argos no primeiro acesso, o **Argos que conhece a Central de Ajuda** e fica só no assunto do CRM, e "possíveis decisores" no lugar de "quem decide". A v102 abriu o **Assinar direto pelo site** (sem passar pelo teste) e o **Cobrar pelo sistema** no master para os clientes de contrato combinado; a v103 trouxe o **plano personalizado** no site (a partir do preço do Start, montado com o nosso time e cobrado pelo sistema) e o cadastro para autônomos (CPF, empresa opcional). (As ligações passaram na frente da API em 31/10.) Cada etapa começa com mockup (regra do projeto) e termina com ajuda, docs e zip.

Coisas que dependem do Leonardo e demoram (começar já, em paralelo):
- [ ] App da Meta aprovado (doc de pendências, 4d). A etapa 1 (v93) não precisa de permissão nova: cada cliente usa o token do próprio Gerenciador de Eventos.
- [x] Conta no Asaas aprovada (31/10). Falta só pôr a chave de produção e o webhook (pendências, 4g, itens 11 a 16).
- [ ] Telefonia (etapa 4): recomendação = LiveKit (já usado nas reuniões) + tronco SIP brasileiro; abrir conta de teste na Nvoip (1º candidato) e pedir cotação à Api4Com; Twilio como plano B.
- [ ] Termos de uso e política de privacidade revisados para teste grátis, API e gravação de ligações.

---

## 1. Devolver as vendas para a Meta (API de Conversões) — v93 ✅ feito

**O que é:** quando um lead que veio de anúncio da Meta anda no funil (respondeu, reunião, proposta, ganho), o CRM avisa a Meta. Ela passa a mostrar o anúncio para gente parecida com quem **compra**, não só com quem preenche formulário. Isso tende a baixar o custo por cliente.

**Como funciona:**
- Vale para os cadastros dos **formulários dos anúncios** (eles trazem o `lead_id` da Meta, que é o que a integração de leads de CRM da Meta usa). Leads de comentário e direct orgânico não vêm de anúncio: não entram (dizer isso na tela, sem prometer o que não acontece).
- Em Instagram › Formulários, o cliente cola o **ID do conjunto de dados (pixel)** e o **token** gerado no Gerenciador de Eventos (feito assim na v93: sem depender da Análise do app). Cada mudança de etapa vira um evento (`event_name` com o nome da etapa, `action_source = system_generated`, `custom_data.event_source = crm`, `lead_event_source = Prospect Team`, `user_data.lead_id`), mandado na hora e com nova tentativa se falhar. A Meta pede que todas as etapas anteriores sejam enviadas antes de "Convertido".
- Tela: em Instagram › Formulários, um bloco "Devolver para a Meta" (ligar/desligar, qual etapa conta como qualificado, o último envio de cada etapa e erros). Na ficha do lead, "Avisado à Meta: reunião, ganho".
- Depois (se fizer sentido): anúncios de clique para o direct/WhatsApp, quando o lead chega com o identificador do anúncio.

**Pronto quando:** cadastro de anúncio que vira ganho aparece no Gerenciador de Eventos da Meta com todas as etapas; teste automático com a Meta simulada.

## 2. API aberta com documentação — v96 (feita)

**Para que serve:** ligar ao CRM o que não é CRM: formulário do site (WordPress, Elementor, Google Forms, Typeform), landing page do RD Station Marketing, ERP e loja virtual (pedido → "Ganho"), e o resto via Make/Zapier.

**O que entra:**
- **Tokens por conta**, criados pelo administrador em Gestão › Integrações: nome, permissões (ler leads, criar leads, mudar etapa, ler funil, webhooks), validade opcional. O token aparece **uma vez**; no banco fica só o hash; dá para revogar; mostra o último uso.
- **Isolamento entre clientes:** o token resolve a conta e toda consulta passa pelo mesmo filtro de conta do sistema (o que já protege as telas). Nenhum endpoint aceita id de conta vindo de fora. Teste automático tentando ler dados de outra conta com o token errado.
- **Endpoints v1** (REST, JSON, paginado): criar lead (com deduplicação por telefone/CNPJ), buscar/listar leads, mudar etapa e responsável, registrar atividade e nota, listar funis e etapas, listar usuários.
- **Receber de qualquer formulário:** um endereço por conta (`/v1/entrada/<chave>`) que aceita o envio do formulário como vier e guarda o mapa de campos (como os formulários da Meta).
- **Webhooks** (o CRM avisa o sistema do cliente): lead criado, etapa mudou, ganho, perdido, mensagem recebida, reunião marcada. Assinatura HMAC em cada envio, até 6 novas tentativas com espera crescente, histórico das entregas na tela e botão "Reenviar".
- **Segurança:** HTTPS, limite de chamadas por token (e por conta), chave de idempotência na criação, tokens nunca no log, auditoria de tudo o que a API altera, respostas sem dados que a permissão não cobre.
- **Documentação** em `prospectteam.com.br/api` (OpenAPI 3.1 + página bonita com exemplos em curl, JavaScript, Python e PHP, botão "Testar" com o CRM de demonstração), guia "conecte seu formulário em 5 minutos" e "Make/Zapier".
- Plano: **Time em diante** (decidido com o Leonardo em 31/10).

**Feito na v96:** tudo acima. Ficou para depois: chave de teste (sandbox) por conta, eventos de "reunião feita" e de proposta, SDKs prontos e apps oficiais no Make/Zapier (hoje é pelo módulo HTTP/Webhooks deles).

## 3. Teste grátis de 7 dias e assinatura sozinho — v97 (feita)

**Fluxo:** site › "Testar grátis 7 dias" → cadastro (nome, empresa, e-mail, WhatsApp, senha; CNPJ opcional) → confirma o e-mail → a conta nasce com o plano **Teste** e o "Primeiros passos" já aberto.

**Limites do Teste:** 7 dias, **100 leads** para enriquecer e trabalhar, 2 usuários (a decidir quais recursos: sugestão = os do Time, sem WhatsApp + IA, ou com 1 número e poucas conversas da IA para provar).

**Antiabuso:** confirmação de e-mail, captcha (Cloudflare Turnstile), um teste por e-mail, telefone e CNPJ, limite por IP, e-mails descartáveis bloqueados.

**Assinar:** tela Meu plano › Assinar (plano, usuários e módulos com o preço calculado, que já existe) → cobrança recorrente no gateway (Pix, boleto ou cartão) → o aviso de pagamento ativa o plano na hora. Avisos no dia 5, 6 e 7 do teste. Venceu sem pagar: fica só leitura por 15 dias (não perde nada) e depois arquiva. Inadimplência: aviso, 7 dias de tolerância e só leitura.

**Painel master:** testes em andamento no funil de Vendas (quem usou o quê, para o comercial ligar), conversão de teste em cliente no Financeiro, notas fiscais (a decidir: emissão pelo gateway).

**Feito na v97** (decisões do Leonardo: teste = Time completo sem WhatsApp+IA, 2 usuários e 100 leads; gateway Asaas; venceu = só leitura 15 dias e depois arquiva): cadastro com Turnstile, confirmação por e-mail e antiabuso; faixa do teste no topo e e-mails nos dias 5, 6 e 7; aviso de fim do teste com o resumo do que a empresa fez; Meu plano › Assinar (plano, usuários e módulos com o preço na hora; Pix, boleto ou cartão) e Pagar (Pix na tela, página do Asaas, "Já paguei", cobranças); aviso do Asaas libera o plano; atraso com 7 dias de tolerância; cancelar; só leitura e arquivamento automáticos; Vendas do master com a coluna Testando e os números. Ajustado em 31/10 com o Leonardo: **sem recorrência** (cada mês é uma cobrança avulsa; cartão na recorrência custa mais), aviso na tela do admin 7 dias antes, venceu = **3 dias normais e depois só leitura até pagar** (quem já pagou nunca perde os contatos: vê e exporta), mudar para mais paga a diferença proporcional, para menos vale na renovação; **Ligações R$ 499 com 2.000 min** e **pacotes de +500 min por R$ 149** (saldo não vence; acabou, as ligações param até comprar). Ficou para depois: cupom/desconto, plano anual ou trimestral pago à vista (com desconto, combina bem com o pré-pago), conversão por mês no Financeiro e reabrir conta arquivada pela tela (hoje pelo master).

## 4. Ligações pelo CRM — v94 e v95 (feitas)

Decidido com o Leonardo: quem liga e fala é sempre o humano; a IA só transcreve depois de desligar (mais barato que ao vivo), resume e dá o clima da conversa.

**v94 (feita):** ligar pela ficha (números de todas as fontes na ordem), painel da ligação (mudo, teclado, desligar, anotações, aviso de gravação falado ou lido), gravação no navegador, "Como foi?" com resumo, clima e sugestões (etapa, reunião, contatos, retorno), histórico na ficha, tela Ligações, Gestão › Telefonia, números no master, módulo no plano com franquia.

**v95 (feita):** lista de ligação (um de cada vez ou paralelo até 3, recado de retorno para quem atende junto, outro número para quem não atende, pausa entre ligações, só no horário de ligar), receber ligações (toca para o dono do lead e depois para todo o time, "Passar para o time", siga-me para o celular, perdida vira aviso + tarefa, número desconhecido vira lead no "Como foi?"), relatório (totais, por pessoa, mapa de quando o lead atende) e aviso de 80%/100% da franquia.

**Ficou para depois (se o cliente pedir):** caixa postal fora do horário com recado transcrito, menu de voz ("1 para comercial"), rodízio em vez de tocar para todos, recado gravado na caixa postal do lead, avisos por websocket no lugar da consulta a cada 3 s.

**Plano original (referência) — ligar com um clique, gravar e transcrever:**
- Botão "Ligar" na ficha, no funil e em Conversas, pelo navegador (fone e microfone; sem aparelho). Celular e fixo, com número de saída brasileiro da empresa (DDD à escolha).
- **Vários números no lead:** o CRM escolhe a ordem — confirmado pelo time e WhatsApp primeiro, depois o principal, celulares antes de fixos — e pula os marcados como errados. No fim de cada tentativa o comercial marca (ou o sistema detecta): atendeu, não atendeu, caixa postal, número errado, ocupado. Na próxima, vai para o número seguinte.
- Gravação, transcrição e resumo da IA com o próximo passo (o mesmo das reuniões), registrados na ficha. Aviso de gravação no início da ligação (LGPD).
- Custo por minuto do provedor: **módulo pago à parte** com franquia de minutos, cobrando o excedente.

**Receber ligações (entra na fase 1):**
- O provedor dá um ou mais números da empresa (DDD à escolha), ou traz o número fixo que ela já usa (portabilidade, quando o provedor atende a região).
- Quem ligou é reconhecido pelo número: se é lead, toca no navegador do **dono do lead** com a ficha aberta; se ele não atende em X segundos, toca para o time (rodízio ou todos). Número desconhecido: a ligação entra em "Sem lead" e dá para criar o lead com um clique.
- Menu de voz opcional ("1 para comercial, 2 para suporte") e horário de atendimento: fora do horário, recado na caixa postal, transcrito e enviado como aviso para o responsável.
- Ligação perdida vira aviso + tarefa "retornar", com o botão de ligar de volta.
- Sem o CRM aberto: siga-me para o celular do comercial (a ligação chega no celular normal, com o número da empresa), e o registro, a gravação e a transcrição continuam no CRM.
- Gravação, transcrição e resumo valem igual para as recebidas.

**Fase 2 (v97) — lista de ligação (discagem automática):**
- O comercial monta uma lista (ex.: 10 leads de "A abordar") e clica "Começar".
- **Modo automático (padrão):** liga para um, terminou (ou não atendeu em 25 s / caiu na caixa postal), já liga para o próximo. A ficha do lead aparece **em destaque** quando atende.
- **Modo paralelo (opcional, até 3 linhas por comercial):** chama 3 ao mesmo tempo; o primeiro que atende vai para o comercial com a ficha em destaque; os outros são encerrados **antes** de atender. Se dois atenderem juntos, o segundo ouve uma mensagem curta gravada ("Oi, aqui é Fulano da Empresa, te retorno em instantes") e entra na fila de retorno — nunca uma ligação muda.
- Por que não 10 de uma vez: com 10 linhas, quase sempre mais de uma pessoa atende e é desligada sem ninguém do outro lado — é o que a Anatel chama de chamada abusiva (ligação de até 6 segundos encerrada; bloqueio de linha para quem passa de 100 mil por dia com 85% curtas) e queima o número da empresa. Com 3 linhas e a mensagem, o ganho de tempo é quase o mesmo sem esse risco.
- Respeita horário comercial, "não ligar de novo" e a lista de quem pediu para não ser contatado.
- Origem verificada (identificação da empresa na tela de quem recebe): exigência da Anatel que o provedor cuida (empresas pequenas têm até 3 anos).

**Provedor:** comparar Api4Com, Nvoip e Twilio em preço do minuto (celular e fixo), número brasileiro, ligação pelo navegador, gravação, detecção de caixa postal e chamadas em paralelo. O módulo fica preparado para trocar de provedor.

---

## Decisões em aberto
1. Teste grátis: quais recursos (Time sem WhatsApp + IA, ou com um gostinho da IA)?
2. Gateway: Asaas (decidido; conta aprovada em 31/10).
3. Ligações: o módulo ficou em R$ 499 com 2.000 min (v97). Falta a cotação da franquia de celular da Nvoip: no crédito avulso (R$ 0,35/min), um cliente que usa os 2.000 minutos custa mais que o módulo; com plano (~R$ 0,20/min), sobra margem. A Saúde e consumo mostra o custo real do mês.
4. LiveKit: passar do Build (grátis, 1.000 min de ligação no total e para ao acabar) para o Ship (US$ 50, 5.000 min, excedente US$ 0,004/min) antes do primeiro cliente de Ligações; o Scale (US$ 500) só compensa acima de ~115 mil min de ligação por mês.


---

## Revisão da landing page (01/11/2026, com os números da v104)

Medido no navegador: a página inicial tem **17,5 telas no computador e 25 no celular**. Só "Como funciona" ocupa 4,4 telas (6 passos com muito espaço vazio). As funções aparecem três vezes (Instagram, Ligações, Telas reais e de novo em Funções). Até a v104 não havia número para saber onde as pessoas desistem; agora Master › Visitas do site › "Até onde chegam" mostra.

O que está bom: abertura clara com tela real e "7 dias grátis, sem cartão"; a seção Nichos é concreta (CNAE + Maps na cidade da pessoa); preços abertos; dúvidas.

O que falta ou atrapalha (a v105 fez 1, 3, 4 e 5; a prova social ficou para depois, decisão do Leonardo):
1. **O diferencial não está dito em uma frase.** O que nenhum CRM comum faz: *a lista vem de dentro* (CRM comum começa vazio; aqui as empresas do nicho, em qualquer cidade, chegam com nota, possíveis decisores e contato com a fonte) e *tudo num lugar só* (WhatsApp com IA, ligação gravada, Instagram, e-mail). Proposta: bloco logo depois da abertura, "CRM comum × Prospect Team" ou "o que você deixa de pagar" (lista comprada + CRM + WhatsApp API + discador + gravador).
2. **Prova social zero.** Sem depoimento, logo, número de uso ou caso. Começar pela própria Central Tutts (caso real de prospecção) e pedir depoimento aos primeiros clientes. Nunca inventar.
3. **Página longa e repetida.** Cortar "Como funciona" para uma faixa de 6 passos numa tela; juntar Instagram, Ligações e Telas reais num bloco só com abas; Funções vira uma grade compacta ou some (os planos já listam).
4. **CTA.** O botão flutuante diz "Agendar demonstração"; com o Assinar e o teste no site, o principal deveria ser "Testar grátis" (demonstração como segunda opção). Seções sem botão nenhum: Como funciona, Ligações, Telas reais, Funções.
5. **Gatilho que só o Prospect Team tem:** uma caixa "Quantas empresas do seu nicho existem na sua cidade?" (nicho + cidade → número contado na base de CNPJ, sem mostrar os dados) com o botão "Ver essas empresas: teste grátis". É curiosidade + prova do produto na primeira tela.
6. **SEO de longo prazo:** páginas por nicho ("CRM para distribuidoras de autopeças", "prospecção de clínicas", com o número de empresas por estado) e por uso ("lista de empresas por CNAE", "CRM com WhatsApp e IA"). É o que traz busca de quem ainda não conhece a marca.

## Segurança — o que ficou para depois da v110 (01/11/2026)
A v110 fechou os achados críticos, altos e médios da auditoria (login e sessões, isolamento entre contas, superfície pública, front e dependências). Ficaram, por ordem de valor:
1. **Cloudflare na frente da api** (domínio `api.prospectteam.com.br`, acesso direto ao Railway fechado): proteção DDoS de borda e regras de taxa fora do processo. Ver pendências 4m.4.
2. **Segredo separado por tipo de token** (sessão, desafio, sala de reunião, estado do Instagram, TOTP): hoje é um só `JWT_SEGREDO` com audiências diferentes; derivar uma chave por uso (HKDF) e trocar sem derrubar as sessões.
3. **CSP completa no app** (`script-src` com a lista de origens: Turnstile, LiveKit, modelos do desfoque de fundo): começar como Report-Only com um endereço de relatório e só depois travar.
4. **Limites com armazenamento comum** (Postgres ou Redis) se a api passar a ter mais de uma réplica: hoje cada réplica contaria separado.
5. **Planilha e PDF lidos num processo à parte** (worker) com limite de memória: a leitura de `.xlsx` e PDF ainda acontece dentro da api (só para administrador logado).
6. **RLS no banco** como segunda barreira do isolamento entre contas (hoje o isolamento está todo no código, conferido rota a rota).
7. Pequenos: deduplicar o `svix-id` do webhook do Resend; mensagem igual para "e-mail já cadastrado" no cadastro do teste (não revelar quem tem conta); tirar o `public` do caminho do papel do Argos e revogar `pg_stat_activity` dele.

## Cliente de autopeças: carteira, central com menu, gatilhos e anti-repetição (07/11/2026)
Pedido: um número de WhatsApp para a empresa toda (Z-API; o cliente sabe do risco de banimento), 19 vendedores em ~5 grupos (lojas). Hoje usam o Neyap, com ligações de WhatsApp por API não oficial.
1. **v115 — Carteira com fila + grupos de atendimento** (feito): lead sem dono numa fila que todos veem; puxar ou responder primeiro fica com o lead; grupos com os vendedores de cada loja.
2. **v116 — Menu de voz e toque no grupo na linha telefônica** (feito): “para a Loja Centro, digite 1” na ordem dos grupos de Equipe (até 9; com um grupo só, não pergunta), toca ao mesmo tempo para o grupo escolhido, quem atende primeiro leva; o dono do lead toca primeiro se for do grupo; sem tecla ou tecla errada → todos; perdida avisa o grupo. Ficou para depois: horário de atendimento (fora do horário, recado e retorno) e mandar a perdida de um grupo para outro.
3. **v117 — Quadros com gatilhos da IA** (feito): quadros e colunas do cliente (até 10 × 12), gatilho em português por coluna; a IA lê a conversa parada há 3 min com mensagem nova e sugere (ou já move) com o trecho palavra por palavra, conferido pelo sistema; o dono confirma ou descarta; arrastar e pôr à mão. Para depois: gatilho que também lê o resumo das ligações e reuniões, ação na coluna (mudar etapa do funil, criar tarefa, mandar mensagem), relatório por coluna (quantos “achou caro” no mês) e trava por plano se o custo da IA pesar.
4. **v118 — Porteiro anti-repetição** (feito): por conta, desligado por padrão. Segura o mesmo texto (pares de palavras, ≥ 70%) para N contatos na janela e oferece “Variar com a IA” (ou deixa mandar mesmo assim no modo avisar); contatos novos por número por dia (com o aquecimento) e espera entre eles; pausa de 6 h dos contatos novos com 3 pedidos para parar ou < 5% de resposta, com alerta. Para depois: aplicar a repetição também na cadência automática e um relatório de saúde do número.
5. **v119 — Ligação pelo WhatsApp (Z-API)** (feito, falta testar com a Z-API de verdade): ponte Asterisk em `infra/whatsapp-sip` (VPS em São Paulo) registrada em `sip.z-api.io`, troncos de entrada e saída do WhatsApp no LiveKit, número do tipo WhatsApp na conta, botão “Ligar pelo WhatsApp”. Perguntas que continuam abertas para a Z-API: DTMF passa (se não, menu por voz), formato do número para discar, codecs; limite de 3 chamadas simultâneas confirmado na documentação. Alternativa sem VPS, se a ponte não servir: SDK de navegador `@z-api/call` (sem menu de voz nem gravação pelo nosso fluxo).

## Carrosséis com IA (08/11/2026)
Plano completo em `docs/plano-carrosseis.md` (e no doc `claude/plano-carrosseis.md` do projeto). Módulo à parte, só para o administrador da conta: um time de IA que cria carrosséis do Instagram com a identidade visual da empresa. Decidido com o Leonardo: texto com **Claude Sonnet**, imagens com **GPT Image 2 em qualidade média**, qualidade de agência mesmo com custo maior.
1. **v121 — fundação visual** (feito): identidade visual, motor de slides (4 estilos × 9 modelos), fotos da empresa, editor à mão, prévia como no Instagram, baixar as imagens, módulo na cobrança (fora do Assinar e do site por enquanto).
2. **v122 — cérebro da marca e o time de IA escrevendo** (feito): dossiê montado pela IA e conferido pelo administrador, o que divulgar (promoção exata), perguntas reais dos clientes sem dado pessoal, Claude Sonnet 5.5, estrategista → redator → diretor de arte (código) → revisor com até 2 voltas, fatos conferidos com o trecho da fonte, legenda e hashtags, pedido ao redator por slide, avisos do revisor no editor, franquia e custo medido.
3. **v123 — preço e a conversa com o time** (feito): **R$ 200 por mês, sem limite de carrosséis**, no Assinar e no site; aba **Conversa** no editor (este slide, o carrossel inteiro ou a legenda; o time propõe, o diretor de arte e o revisor conferem, a pessoa aplica, descarta ou desfaz); o campo da criação virou **Instruções para o time**. Sem comandos com barra (decisão do Leonardo).
4. **v124 — a apresentação do time** (feito): na primeira entrada no módulo, uma janela apresenta Estrategista, Redatora, Diretor de arte e Revisora com foto, função e o que fazem; depois o time fica numa faixa no topo da lista.
5. **v126 — do carrossel ao direct** (feito): a regra do Comente e receba nasce com o carrossel (a redatora escreve o direct), espera o post e liga sozinha quando o CRM reconhece o post pela legenda (ou a pessoa escolhe); o direct entrega um link, um arquivo, uma promoção (botão para o WhatsApp) ou só a conversa, e o botão conta quem abriu; aba Publicação no editor e "Ver no celular" (post, comentários e direct).
6. **v127 — transcrição de reuniões longas** (feito, fora do plano dos carrosséis): faixas acima de 20 min são divididas em partes, o limite do Groq adia sem gastar tentativa, motivo da falha na tela e "Transcrever de novo".
7. **v128, v129 e v131 — Vídeos com IA** (fora do plano dos carrosséis; seção abaixo). **v130 — o saber dos agentes** (seção "O saber dos agentes", abaixo): vale para os carrosséis também.
8. **v132 — imagens (feita em 11/11)**: foto do produto em cenários, imagem de referência, imagens sem texto na paleta da marca, revisor visual, custo por imagem em Saúde e consumo.
9. **v133 — publicar e agendar (feita em 11/11, desligada até a Meta aprovar)** (depende de `instagram_content_publish` aprovado na Meta; a regra liga direto no post publicado).
10. **v134 — aprender (feita em 11/11)**: ideias com a fonte, aprendizados com evidência, 2 em 10 testam algo novo, as edições do administrador ensinam.
Preço decidido em 08/11: R$ 200 sem limite (acompanhar o custo do Claude por conta em Saúde e consumo).

## Qualidade do atendimento e outras ideias de IA (08/11/2026)
Levantadas com o Leonardo em 08/11 ("oportunidades de IA em qualquer área"). A primeira escolhida foi a nota do atendimento, com a DeepSeek (a IA da conta, a mais barata).
1. **v125 — Qualidade do atendimento** (feito): mockup aprovado (canvas "Prospect Team — Nota do atendimento (mockup)", https://claude.ai/artifact/GcwAm4A3Zx1tgmwPNHcfuY). A IA dá nota de 0 a 10 a cada atendimento (conversa parada há 2 h com pelo menos 3 mensagens da equipe; ligação transcrita com pelo menos 3 falas) numa régua de 5 pontos: tempo de resposta (medido pelo sistema, seg. a sáb. das 7h às 19h), respondeu o que foi perguntado, conduziu a conversa, próximo passo combinado, tom e clareza; cada ponto com comentário, trecho conferido e "poderia ter sido". Painel do gestor (semana, loja, o que mais pesou, por pessoa), resumo semanal com ponto forte e o que treinar (Enviar para a pessoa / Copiar), nota na lista e no painel de Conversas, cartão no Meu dia; o vendedor vê só as próprias notas; o gestor corrige com motivo (a da IA fica guardada). Recurso "Qualidade do atendimento" nos planos Time e Escala.
2. **Ideias que ficaram para depois** (ordem de valor sugerida): resumo antes do contato (um parágrafo do que se sabe do lead, objeções prováveis e abertura sugerida); por que perdemos (motivo de perda sugerido pela IA e relatório mensal, alimentando o cérebro da marca e a IA de atendimento); reativar quem esfriou no Meu dia com a mensagem pronta; treino com cliente simulado por voz (Argos no papel do cliente, com nota); o que a IA de atendimento não soube responder vira sugestão para a base; empresas parecidas com os clientes (padrão de CNAE, porte e região na base de CNPJ); um carrossel vira e-mail e mensagem de WhatsApp; chance de fechar cada negócio (só com histórico suficiente).

## Vídeos com IA (10/11/2026)
Aprovado pelo Leonardo depois do teste com um vídeo real dele (33 s → 25 s editado). A pessoa sobe o vídeo falado e a IA corta, legenda, anima e fecha com a chamada, sem nada em cima do rosto. Decidido em 10/11: **módulo à parte, como Carrosséis (R$ 200 por mês com 60 vídeos)**, **até 3 minutos por vídeo**, música pela **ElevenLabs** (v129). Mockup aprovado (lista, novo vídeo, editando, revisar com as abas Cortes, Legenda, Animações e Som).

**Ferramentas (todas profissionais e de uso comercial livre, sem licença por vídeo):**
- **HyperFrames** (HeyGen, Apache 2.0) monta a composição em HTML e renderiza pelo Chromium; **GSAP** (grátis para uso comercial) anima; **ffmpeg** corta, enquadra e trata o som.
- **Whisper large-v3 pelo Groq** (o mesmo das reuniões) com o tempo de cada palavra; **Claude Sonnet 5.5** decide os cortes (sem a chave, regras: "éé", "né?", palavra repetida, pausas).
- **face-api** (modelos TensorFlow, roda no servidor) mapeia o rosto 6 vezes por segundo; a diagramação usa o mapa (legenda embaixo do queixo no maior tamanho que cabe, gráficos acima da cabeça ou o vídeo vira cartão). O MediaPipe da Google seria a alternativa, não testado aqui.
- Remotion ficou de fora (cobra por render para empresas com 4+ pessoas).

**Etapas:**
1. **v128 — a base do módulo** (feita em 10/11). Migration 096. Serviço novo `worker-videos` (Railway, `SERVICO=worker-videos`, ffmpeg + Chromium na imagem). Subir em partes de 8 MB (até 1 GB e 3:00), fila `video.editar`, etapas na tela, cortes pela fala com o motivo de cada um, junções conferidas (a duvidosa vira "1 corte para você decidir"), ritmo (dinâmico, natural, só pausas longas), legenda palavra por palavra (palavra acesa, simples, balão) nas cores da identidade visual dos Carrosséis (ou de Marca e domínio), título de abertura, chamada no fim (comente a palavra, WhatsApp, seguir, frase), aproximação alternada, som tratado, conferência quadro a quadro de que nenhum texto encostou no rosto. Revisar: Ouvir e Devolver cada corte, corrigir palavra da legenda, vocabulário da empresa ("palavras sempre escritas assim"), Gerar de novo com as mudanças. Franquia por mês (o master muda em Plano e módulos), aviso no sino, custo em Saúde e consumo e no Financeiro, site e Ajuda.
2. **v129 — imagens, animações, efeitos sonoros, transições e música** (feita em 11/11; decidido em 10/11 pôr as imagens aqui; mockup: telas 5 a 8 do canvas "Prospect Team — Vídeos com IA (mockup)", https://claude.ai/artifact/UKib17quK32B1k5CNFP3ku). **Imagens**: o Claude marca na fala onde uma imagem ajuda (produto, número, comparação, lugar); fotos da empresa (as dos Carrosséis) primeiro, **GPT Image 2** em qualidade média só para o que faltar (cerca de US$ 0,05 por imagem); regras por código: nada nos 2 primeiros segundos, no máximo ~30% do vídeo, 1,5 a 4 s cada, produto vendido só pela foto real (ou a foto real num cenário novo), preço e nome escritos pelo sistema, revisor de visão em cada imagem gerada; encaixe pelo mapa do rosto (cartão acima da cabeça, tela dividida ou tela cheia curta); opção na criação (A IA escolhe / Só fotos da empresa / Sem imagens) e aba Imagens na revisão (Ver, Trocar, Gerar outra, Usar foto minha, Tirar, onde a IA preferiu não pôr). A ligação com o GPT Image 2 fica pronta aqui e os carrosséis aproveitam na v132 (precisa da chave da OpenAI na plataforma). Também: biblioteca de animações (lista que se marca, número grande, selo, estrelas, seta; Lottie com a Lottie Simple License), efeitos sonoros (Kenney CC0 e sons CC0 do Freesound baixados e guardados; ElevenLabs SFX, US$ 0,12 por minuto, para o que faltar), transições (gl-transitions, MIT) e **música da ElevenLabs** (Eleven Music, US$ 0,15 por minuto) com o volume baixando sozinho quando a pessoa fala. **Antes de liberar a música para clientes: contrato Enterprise da ElevenLabs** (os planos comuns não deixam entregar a música para outra empresa usar).
   **Como saiu na v129 (diferente do plano):** os efeitos sonoros são **nossos, sintetizados** no repositório (`apps/worker-videos/sons/`, `scripts/gerar-sons.sh`): toque, sopro, estalo e subida, sem licença de terceiros; o Freesound, o Kenney e o ElevenLabs SFX ficaram de fora porque não fizeram falta. As animações são **GSAP** desenhadas por código (lista que se marca, número grande, selo, oferta, aproximação); o Lottie e o gl-transitions ficaram de fora (a transição "deslizar" é GSAP e vale para as imagens). A música é composta **enquanto o vídeo renderiza** e misturada depois com compressão guiada pela voz (sidechain), a −14 LUFS. Teste com o vídeo do Leonardo: lista, oferta com o preço exato, foto da empresa em cartão e imagem gerada em tela cheia (no teste, imagem e música de mentira, feitas pelo ffmpeg: aqui não há as chaves); na conferência, 2 de 84 quadros com um texto perto do rosto. A música só sai para as contas de `VIDEOS_MUSICA_CONTAS` (contrato Enterprise antes de liberar para clientes). Ficou para depois: foto do produto em cenário novo (edição com referência no GPT Image 2, junto da v132 dos carrosséis), escolher a imagem tocando o vídeo e reordenar o momento arrastando na linha do tempo.
3. **v131 — ligar ao resto do CRM (feita em 11/11)**: a chamada "Comente a palavra" cria a regra do Comente e receba (como os carrosséis da v126), publicar no Instagram junto com os carrosséis, o Argos sabe dos vídeos.
   **Como saiu na v131:** aba **Publicação** no vídeo, igual à do carrossel (a publicação ficou genérica por peça): a redatora escreve o texto do post com as hashtags e confere que "comente X" bate com a palavra que a pessoa falou; o Comente e receba nasce com o vídeo, espera o post e liga sozinho pela legenda (ou escolhendo o post à mão); o Argos lê os vídeos (view `cerebro.videos`, com o resultado do Comente e receba). Publicar direto pelo CRM veio na v133, junto com os carrosséis.
   **v135 (11/11):** a música passou a valer para toda conta com o módulo Vídeos (o Leonardo tem autorização da ElevenLabs para uso comercial); saiu a lista de contas liberadas.

**Em aberto:** o render leva ~6 min para 33 s numa máquina de 2 núcleos: dar mais vCPU ao `worker-videos` (4 a 8) e acompanhar o tempo real. Um "éééh" esticado dentro de uma palavra longa do Whisper ainda não é cortado.

## O saber dos agentes — v130 (11/11/2026, feita)
O Leonardo perguntou se as skills que as pessoas usam no Claude (edição de vídeo, copywriting) podiam ficar dentro do sistema. As skills da Anthropic rodam num contêiner sem internet e sem os nossos programas, então não servem para o nosso fluxo. Decidido: **garimpar as skills abertas mais completas e virar o conhecimento delas em manuais em português**, lidos pelos agentes antes de cada trabalho (no começo do prompt, no cache da Anthropic).
- **Fontes usadas** (só com licença que permite adaptar para uso comercial): Vyral content-skills (MIT), iart.ai tiktok-video-skills (MIT), Video-Editing-Skill de Muhammad Faizan (MIT), marketingskills de Corey Haines (MIT), HyperFrames da HeyGen (Apache 2.0) e as de copywriting de Rob Palmer (CC BY 4.0, com atribuição). Lidas e descartadas por não terem licença: JhontyBarreto, marcolang e as skills do Remotion.
- **Quatro manuais** em `packages/integrations/src/saber/` (créditos e licenças em `CREDITOS.md` ali): **editor de vídeo** (o começo é o gancho, cortar o aquecimento, o meio não esfria, o fim limpo, destaques para quem assiste sem som, título que promete o que o vídeo entrega), **motion** (cada enfeite com um trabalho, tempo de leitura, cada tipo no seu lugar, imagem de apoio que mostra o que a fala diz, música e efeitos discretos), **redação** (ganchos específicos e seus formatos, falar no nível de quem lê, a cadeia do "e daí?", específico sem inventar, sinais de texto de máquina, uma chamada só, legenda) e **revisão** (passadas, como dar cada nota, risco de publicidade enganosa pelo CDC e o CONAR, como escrever o ajuste).
- **Quem lê o quê:** o editor de vídeo (cortes), o editor de motion (animações, imagens e música, e a escolha de imagem quando a pessoa põe uma), o time inteiro dos carrosséis (redação + revisão, junto do manual do time e do cérebro da marca) e a redatora do direct (redação). O pedido de imagem ao GPT Image 2 também ganhou composição de foto de campanha e cenário brasileiro.
- **Regras do produto acima dos manuais:** nada de preço, número, prazo ou urgência que não esteja nas fontes; estatísticas e nomes de terceiros dos originais ficaram de fora. Custo: os manuais vão para o cache (do segundo pedido em cinco minutos em diante custam um décimo); cada pedido sem cache fica alguns décimos de centavo mais caro.
- **Não medido aqui:** sem a chave da Anthropic no ambiente de desenvolvimento, não deu para comparar vídeos e carrosséis com e sem os manuais. Conferir nos primeiros vídeos e carrosséis depois do deploy.

## Segundo cérebro — v147 (11/11/2026, feita)
O Leonardo pediu um endpoint para ligar o usuário do Prospect Team ao Cérebro dele (repositório `brain`, "Cérebro · Central Tutts"), para os vídeos, carrosséis e a Meta terem uma base boa e o cérebro da marca do Prospect Team ficar melhor. Decidido com ele: os dois lados conversam; qualquer conta liga em Integrações; o Prospect Team lê tudo o que não é restrito.
- **Cérebro**: `/api/externo` com token de sistema (separado do token do Claude), só o que está valendo e não é restrito, dados pessoais mascarados, o que chega vira rascunho em Revisar, auditoria no canal `externo`. Migration 008.
- **Prospect Team**: aba Integrações › Segundo cérebro; os agentes dos carrosséis, cards, ideias, vídeos e o rascunho do cérebro da marca leem o Cérebro; uma nota por semana com o que o Instagram ensinou volta para lá. Migration 105.
- **Para depois**: (1) o Argos do Prospect Team perguntar ao Cérebro; (2) levar ao Cérebro também o resumo das ligações e reuniões (hoje só os aprendizados do Instagram); (3) mascarar nomes de pessoas do lado do Cérebro antes de sair (hoje só e-mail, CPF, CNPJ, telefone, placa, conta e PIX); (4) busca por sentido no Cérebro depende do Gemini configurado lá: sem ele, a busca é por palavra.

