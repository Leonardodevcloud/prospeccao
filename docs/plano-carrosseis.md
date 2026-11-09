# Prospect Team — Carrosséis com IA (plano em etapas)

Definido em 08/11/2026 com o Leonardo, a partir da v120 (commit 9358d96). Mockup: canvas "Prospect Team — Carrosséis com IA (mockup)" (https://claude.ai/artifact/5SxKvqUbZj3rmWFvTv4fDb), 8 telas: lista, identidade visual, novo carrossel (o time de IA), editor, publicar/agendar, o carrossel de exemplo em dois estilos, ideias e o que o time aprendeu, promoção com imagem de referência. **As 8 telas foram aprovadas em 08/11.** Este doc fica no repositório (`docs/plano-carrosseis.md`) e nos docs do projeto (`claude/plano-carrosseis.md`), com o mesmo texto.

**Situação: v121 (fundação visual), v122 (o time de IA escrevendo), v123 (preço, Assinar, site e a conversa com o time) e v124 (a apresentação do time) feitas em 08/11.** Próxima: v125 (imagens).

## O que é
Um "time de IA" dentro do CRM que cria carrosséis do Instagram com a identidade da empresa do cliente: o **estrategista** escolhe o tema e o gancho, o **redator** escreve slide a slide, a legenda e as hashtags, o **diretor de arte** escolhe o modelo de cada slide e as imagens, o **revisor** confere ortografia, tamanho do texto, promessa sem fonte e o tom da marca, e o **publicador** posta ou agenda. Só o **administrador** da conta usa (menu Automação › Carrosséis com `admin: true`, rotas com `exigirAdmin`).

## Decisões (08/11)
- **Cobrança: módulo à parte**, como Ligações: `carrosseis` em `MODULOS` (`packages/shared/src/planos.ts`). **Decidido em 08/11 (v123): R$ 200 por mês, sem limite de carrosséis** (`carrosseisMes` = null na tabela; o master ainda pode pôr um limite por cliente em Plano e módulos). Está no Assinar e no site desde a v123.
- **Texto: Claude Sonnet 5.5** (`claude-sonnet-5-5`, estratégia, redação e revisão; trocar em `CARROSSEIS_MODELO`). O Leonardo aceita custo maior para ter qualidade de agência.
- **Imagens: GPT Image 2 em qualidade média** ("não precisa ser no máximo").
- **Visão** (ler os posts, conferir as imagens geradas e os slides prontos): o modelo de visão mais barato que der conta, escolhido na v125.

## Custo estimado por carrossel (08/11, dólar a R$ 5,40; conferir com o consumo real)
- Texto com o Sonnet 5.5 (US$ 2 / US$ 10 por milhão de tokens; estrategista, redator, revisor e até 2 voltas de reescrita, 4 a 7 chamadas, com o cérebro da marca no cache): cerca de **US$ 0,10 a 0,25** por carrossel (a estimativa antiga era US$ 0,27). O custo real de cada conta fica em `cadastro.consumo_carrosseis` e aparece no Financeiro.
- Revisão visual dos slides prontos: cerca de **US$ 0,08**.
- Imagem gerada (GPT Image 2 médio): cerca de **US$ 0,05 cada**, contando 1,6 tentativa por imagem aproveitada (as recusadas pelo revisor são geradas de novo).
- Um carrossel conta como **1 post** no limite do Instagram. Sem limite de carrosséis no módulo (v123); um pedido na Conversa do editor custa cerca de **US$ 0,02 a 0,06** (2 ou 3 chamadas).

## Como os agentes sabem o que fazer (o "cérebro da marca")
1. **Dossiê da marca**, montado sozinho e revisado pelo admin: nicho, público, o que vende, diferenciais, objeções, tom, o que nunca dizer. Fontes já no CRM: perfil da IA de atendimento (v59: quem, empresa, oferta, objeções, limites), base de conhecimento, nichos da conta, site da empresa, os posts do Instagram (texto + imagem lidos por um modelo de visão, para aprender também o visual). A v121 já guarda na identidade o que a empresa vende, o público, o tom, o que nunca dizer e os pilares (aba "Como a empresa fala").
2. **O que divulgar este mês** (briefing do admin): campanhas, promoções com preço e prazo, lançamentos, datas. Vem na frente de tudo.
3. **O que os clientes perguntam de verdade**: conversas do WhatsApp e do direct, comentários com interesse (v92), resumos de ligações e reuniões, colunas dos Quadros (v117, ex.: "achou caro"). Só padrões agregados ("23 perguntaram quando trocar a pastilha"), nunca dado de uma pessoa no post.
4. **O que funcionou**: os números de cada post (v92: alcance, salvos, compartilhamentos, visitas ao perfil, leads e vendas ligados ao post).
5. **Fora da conta**: contas de referência que o admin escolhe (Business Discovery da Graph API: números públicos de perfis profissionais; só para aprender o que funciona no nicho, nunca copiar) e datas do varejo e do nicho.
Cada ideia na aba Ideias mostra de onde veio (CAMPANHA, CONVERSAS, INSTAGRAM, OBJEÇÕES, LIGAÇÕES, TESTE, REFERÊNCIAS), como manda o design system ("todo dado mostra a fonte").

## Como o time aprende
- Cada carrossel publicado guarda o seu **DNA**: assunto/pilar, objetivo, tipo de gancho, estrutura, modelos usados, estilo, nº de slides, com foto ou não, foto real ou gerada, chamada final, dia e hora.
- Em 48 h e em 7 dias, os números do Instagram entram; o desempenho é medido **contra a mediana da própria conta** (seguidores diferentes não distorcem), com **peso maior para leads e vendas** do que para curtidas.
- Viram **aprendizados com evidência e confiança** ("Lista e passo a passo: 2,1× salvos · 6 posts · confiança média"; com poucos posts, diz "ainda testando").
- **2 de cada 10 carrosséis testam algo novo** (formato, estilo, horário) para o time não ficar preso no que já sabe.
- **As edições do admin também ensinam**: o que ele sempre muda no editor (encurta títulos, troca palavras) vira preferência do redator.

## Imagem de referência (pedido de 08/11)
- **Foto do produto**: o produto fica igual (edição com referência no GPT Image 2), a IA tira o fundo e põe em cenários na paleta da marca; o admin escolhe entre opções.
- **Referência de estilo**: um post de que o admin gostou; o modelo de visão lê a composição e o clima e o diretor de arte reproduz com as cores, as fontes e os modelos da marca (sem copiar a arte de outra empresa).
- **Promoção**: produto, preço de/por, validade e condições saem **exatamente como digitados** (a IA não muda nem inventa).

## Qualidade dos agentes (o que os deixa excepcionais)
- **Modelos de ponta só para isso**, escolhidos em Configurações da plataforma e medidos no consumo: Claude Sonnet 5.5 (Anthropic) para estratégia, texto e revisão, pela chave da plataforma (`ANTHROPIC_CHAVE`; cliente em `packages/integrations/src/carrosseis/claude.ts`, com a resposta por ferramenta forçada e o cérebro da marca no cache); GPT Image 2 (qualidade média) para imagens.
- **Escrever → avaliar → reescrever**: o redator faz opções de gancho, o revisor dá nota por uma régua (gancho, uma ideia por slide, clareza, especificidade, tamanho, chamada final, tom) e devolve para reescrever até passar (máx. 2 voltas).
- **Fatos conferidos**: o revisor lista cada afirmação sobre a empresa com o trecho exato da fonte (cérebro da marca, o que divulgar, o pedido, a configuração da IA) e o código confere o trecho com o `trechoNaFonte` da v59: número ou promessa sem fonte volta ao redator ou vira aviso.
- **Texto que cabe**: o diretor de arte usa os mesmos limites e a mesma medida do editor (`MODELO`, `contarLinhas`, `caberBlocos`); não coube, pede para o redator encurtar.
- **Revisor visual**: um modelo de visão olha cada imagem gerada (produto igual, sem texto nem marca estranha, sem defeito) e, no fim, os slides prontos como um designer olharia (leitura, equilíbrio, ritmo entre slides).

## Decisões de arquitetura (feitas na v121)
- **O texto nunca é desenhado pela IA de imagem.** O slide é montado por código (modelo + texto + cores + fontes da marca); a IA de imagem gera só a foto ou o fundo, sem texto.
- **Um modelo só, duas saídas:** cada modelo de slide é uma árvore flexbox no shared (`montarSlide` em `packages/shared/src/carrosseis.ts`). O navegador desenha como HTML na prévia ao vivo (`apps/web/src/carrossel/SlideHtml.tsx`, com CSS que imita o Yoga do Satori); o servidor desenha a mesma árvore com **Satori → Resvg → Sharp** (sem Chromium) em JPEG 1080 × 1350, mozjpeg qualidade 92 (o Instagram só aceita JPEG pela API). Pacotes: satori 0.63.2, @resvg/resvg-js 2.6.2, sharp 0.35.5, fflate, @fontsource/* 5.3.0.
- **Regras do Satori** (aprendidas na v121): toda div com `display: flex`; nada de largura/altura em % junto com padding (estoura); nada de `marginTop: 'auto'`; a raiz é coluna com um quadro interno `flexGrow: 1`.
- **Fontes embarcadas** (licença aberta): Fraunces + Inter, Archivo + Inter, Plus Jakarta Sans + Inter, Space Grotesk + Inter, Playfair Display + Lato. As larguras de cada letra são medidas no próprio Resvg (`pnpm --filter @prospeccao/integrations medir-fontes` → `carrosseisMetricas.gerada.ts`); o teste confere que a conta das linhas bate com o desenho.
- **Estilos**: Editorial, Impacto, Clean e Foto; em cada um os modelos capa, item numerado, texto, lista, número grande, citação, antes e depois, foto, chamada final.
- **Cores** com conferência de leitura (texto ≥ 4,5:1 em cada fundo, destaque grande ≥ 3), ajustando o tom só o bastante e avisando, como a v88.
- **Arquivos** no bucket R2 das reuniões (`carrosseis/<conta>/logos` e `/fotos`); a Meta vai buscar as imagens por link assinado ao publicar (v126).
- **Ajustes conversando (08/11, v123)**: a pessoa pede ao time o que mudar (um slide, o carrossel inteiro ou a legenda) e vê a proposta antes de aplicar. **Sem comandos com barra** (decisão do Leonardo).

## Etapas
1. **v121: fundação visual (feita em 08/11).** Identidade visual (cores com "Usar as cores de Marca e domínio", estilo, par de fontes, logos para fundo claro e escuro ou as de Marca e domínio, assinatura, número do slide, como a empresa fala), fotos da empresa (até 60), motor de slides (4 estilos × 9 modelos), editor (roteiro pronto ou só a capa, trocar modelo, subir/descer/duplicar/tirar, foto da empresa, fundo por slide, legenda com os 2.200 caracteres, salva sozinho com conflito entre abas, prévia como no Instagram, baixar as imagens em .zip com a legenda, marcar como pronto) e o módulo na cobrança. Já dá para postar à mão. Migration 089.
2. **v122: cérebro da marca + o time de IA escrevendo (feita em 08/11).** Migration 090.
   - **Cérebro da marca**: rascunho montado pelo Claude com a configuração da IA de atendimento, a base de conhecimento, o site, os posts com números, os comentários com interesse, até 150 mensagens de clientes (sem telefone, e-mail, documento e site), os quadros e os resumos de ligações e reuniões; nicho, público, o que vende, diferenciais, dores, desejos, objeções, provas com fonte, perguntas com quantas vezes, tom, palavras, nunca dizer e pilares. Só vale depois de "Está certo: conferi"; mudou, confere de novo.
   - **O que divulgar**: promoção, lançamento, campanha, data, novidade; preço de/por, validade e condições conferidos pelo sistema (`conferirPromocao`: o valor digitado aparece igual e nenhum preço não informado aparece).
   - **O time**: estrategista (ângulo, 3 ganchos, roteiro com modelos e fotos), redator (slides nos limites de cada modelo, legenda, hashtags), diretor de arte por código (`montarSlide` mede o texto com as fontes de verdade; "Comente PALAVRA" no botão), revisor (8 critérios de 1 a 5; passa com média 4 e nenhum abaixo de 3, sem fato sem fonte, preço errado ou texto que não cabe; fatos com o trecho exato da fonte, conferido por código). Até 2 voltas; o que sobra vira aviso com a sugestão no editor.
   - **Editor**: avisos do revisor no slide e na legenda (Usar a sugestão / Manter), Pedir ao redator (mais curto, mais direto, outro jeito, ou texto livre), aba Time de IA (ângulo, fontes, ganchos alternativos com "Usar na capa", notas, hashtags).
   - **Operação**: fila na api (2 ao mesmo tempo), aviso no sino quando fica pronto ou falha, franquia conta o pedido (falhou ou cancelado não conta), avisos de 80% e 100%, custo por conta no Financeiro e em Saúde e consumo, serviço com Testar nas Configurações.
   - Ficou de fora de propósito: o módulo no Assinar e no site (preço em aberto, resolvido na v123); a regra do Comente e receba criada sozinha (v126, junto com a publicação); imagens geradas (v125).
3. **v123: preço, Assinar, site e a conversa com o time (feita em 08/11).** Migration 091.
   - **Preço**: R$ 200 sem limite (migration 091 troca o valor salvo na tabela se ainda for o de partida); entra no Assinar (`MODULOS_NA_ASSINATURA` = todos), no site (cartão de módulo, seção de funções, `llms.txt`, JSON-LD) e na tela de módulo bloqueado ("Assinar o módulo").
   - **Conversa com o time** (aba Conversa do editor; tabela `comercial.carrossel_conversa`): alcance este slide, carrossel inteiro (incluir, tirar, reordenar, até 10) ou legenda; o redator propõe (`conversarComOTime`: slides com id, "igual" para os que ficam, novos com id null), o diretor de arte confere o que mudou e devolve uma vez para encurtar, o revisor confere só o que mudou (português, tom, nunca dizer, fatos com trecho conferido); as mudanças são calculadas por código (`mudancasEntre`). A resposta vem em segundo plano (a tela pergunta a cada 2 s; 5 min sem resposta vira erro). Aplicar troca no editor (que salva sozinho), Descartar, Desfazer; se a pessoa mexeu depois de pedir, a tela pergunta. Um pedido por vez. O time lê as últimas 6 mensagens.
   - **Atalho no slide**: "Pedir ao time" (Mais curto, Mais direto, Outro jeito de dizer ou texto) vai para a conversa daquele slide; o antigo "Pedir ao redator" (`refazerSlide`, `/slides/:n/pedir`) saiu.
   - **Criação**: o campo virou **Instruções para o time** (até 1.000 letras; o que tem que aparecer e o que não pode).
4. **v124: a apresentação do time (feita em 08/11).** Migration 092. Mockup aprovado: canvas "Prospect Team — Conheça o time de IA (mockup)" (https://claude.ai/artifact/E1pyKdQ2jjJR3vPWj6qG5F). Na primeira entrada no módulo (uma vez por pessoa, `cadastro.usuarios.time_carrosseis_visto_em`, `POST /carrosseis/time-visto`), uma janela apresenta o time com foto, nome, selo IA, função e o que faz: **Estrategista**, **Redatora**, **Diretor de arte** (é código, apresentado como parte do time a pedido do Leonardo; a descrição diz só o que ele faz) e **Revisora**. Depois o time fica numa faixa no topo da lista com "Conhecer o time". As fotos (enviadas pelo Leonardo, licença por conta dele) ficam em `apps/web/public/carrosseis/time/`, 256 px; também aparecem no andamento do pedido. Os textos para a pessoa passaram a dizer "a redatora" e "a revisora" (`ETAPA_TIME` no shared tem nome, função, apresentação e foto).
5. **v125: imagens.** GPT Image 2 médio: foto do produto em cenários, referência de estilo, imagens geradas sem texto na paleta da marca, revisor visual, custo por imagem em Saúde e consumo.
6. **v126: publicar e agendar.** `instagram_content_publish` (revisão do app na Meta: pedir já), publicar agora ou agendar, calendário, Comente e receba ligado ao post, aviso se a Meta recusar, DNA de cada post. Limites: até 10 imagens por carrossel, JPEG, 1 post no limite diário.
7. **v127: aprender.** Aba Ideias com a fonte de cada ideia, aprendizados com evidência, 2 em 10 como teste, edições do admin como sinal, contas de referência, resultados por carrossel, o Argos sabe dos carrosséis.

## Em aberto
- Sem limite de carrosséis: acompanhar o custo por conta em Saúde e consumo (Claude). Se algum cliente fugir muito da média, o master pode pôr um limite só para ele em Plano e módulos.
