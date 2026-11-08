# Prospect Team — Carrosséis com IA (plano em etapas)

Definido em 08/11/2026 com o Leonardo, a partir da v120 (commit 9358d96). Mockup: canvas "Prospect Team — Carrosséis com IA (mockup)" (https://claude.ai/artifact/5SxKvqUbZj3rmWFvTv4fDb), 8 telas: lista, identidade visual, novo carrossel (o time de IA), editor, publicar/agendar, o carrossel de exemplo em dois estilos, ideias e o que o time aprendeu, promoção com imagem de referência. **As 8 telas foram aprovadas em 08/11.** Este doc fica no repositório (`docs/plano-carrosseis.md`) e nos docs do projeto (`claude/plano-carrosseis.md`), com o mesmo texto.

**Situação: v121 (fundação visual) feita em 08/11.** Próxima: v122.

## O que é
Um "time de IA" dentro do CRM que cria carrosséis do Instagram com a identidade da empresa do cliente: o **estrategista** escolhe o tema e o gancho, o **redator** escreve slide a slide, a legenda e as hashtags, o **diretor de arte** escolhe o modelo de cada slide e as imagens, o **revisor** confere ortografia, tamanho do texto, promessa sem fonte e o tom da marca, e o **publicador** posta ou agenda. Só o **administrador** da conta usa (menu Automação › Carrosséis com `admin: true`, rotas com `exigirAdmin`).

## Decisões (08/11)
- **Cobrança: módulo à parte**, como Ligações: `carrosseis` em `MODULOS` (`packages/shared/src/planos.ts`) com preço próprio e **franquia de carrosséis feitos pela IA por mês** (`carrosseisMes` na tabela de preços e por cliente). Valor de partida no código: R$ 397 com 20 por mês, **preço a decidir** com o custo real (Saúde e consumo). Fica fora do Assinar e do site (`MODULOS_NA_ASSINATURA`) até a v122.
- **Texto: Claude Sonnet** (estratégia, redação e revisão). O Leonardo aceita custo maior para ter qualidade de agência.
- **Imagens: GPT Image 2 em qualidade média** ("não precisa ser no máximo").
- **Visão** (ler os posts, conferir as imagens geradas e os slides prontos): o modelo de visão mais barato que der conta, escolhido na v123.

## Custo estimado por carrossel (08/11, dólar a R$ 5,40; conferir com o consumo real)
- Texto com o Sonnet (estrategista, redator, revisor e até 2 voltas de reescrita): cerca de **US$ 0,27** num carrossel de 8 slides.
- Revisão visual dos slides prontos: cerca de **US$ 0,08**.
- Imagem gerada (GPT Image 2 médio): cerca de **US$ 0,05 cada**, contando 1,6 tentativa por imagem aproveitada (as recusadas pelo revisor são geradas de novo).
- Um carrossel conta como **1 post** no limite do Instagram e cada um é contado inteiro na franquia (não cada imagem).

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
- **Modelos de ponta só para isso**, escolhidos em Configurações da plataforma e medidos no consumo: Claude Sonnet (Anthropic) para estratégia, texto e revisão; GPT Image 2 (qualidade média) para imagens. Provedor novo `anthropic` em `packages/integrations/src/ia`.
- **Escrever → avaliar → reescrever**: o redator faz opções de gancho, o revisor dá nota por uma régua (gancho, uma ideia por slide, clareza, especificidade, tamanho, chamada final, tom) e devolve para reescrever até passar (máx. 2 voltas).
- **Fatos conferidos** frase a frase contra o dossiê (o mesmo `conferirFatos` da v59): número ou promessa sem fonte vira aviso.
- **Texto que cabe**: o diretor de arte usa os mesmos limites e a mesma medida do editor (`MODELO`, `contarLinhas`, `caberBlocos`); não coube, pede para o redator encurtar.
- **Revisor visual**: um modelo de visão olha cada imagem gerada (produto igual, sem texto nem marca estranha, sem defeito) e, no fim, os slides prontos como um designer olharia (leitura, equilíbrio, ritmo entre slides).

## Decisões de arquitetura (feitas na v121)
- **O texto nunca é desenhado pela IA de imagem.** O slide é montado por código (modelo + texto + cores + fontes da marca); a IA de imagem gera só a foto ou o fundo, sem texto.
- **Um modelo só, duas saídas:** cada modelo de slide é uma árvore flexbox no shared (`montarSlide` em `packages/shared/src/carrosseis.ts`). O navegador desenha como HTML na prévia ao vivo (`apps/web/src/carrossel/SlideHtml.tsx`, com CSS que imita o Yoga do Satori); o servidor desenha a mesma árvore com **Satori → Resvg → Sharp** (sem Chromium) em JPEG 1080 × 1350, mozjpeg qualidade 92 (o Instagram só aceita JPEG pela API). Pacotes: satori 0.63.2, @resvg/resvg-js 2.6.2, sharp 0.35.5, fflate, @fontsource/* 5.3.0.
- **Regras do Satori** (aprendidas na v121): toda div com `display: flex`; nada de largura/altura em % junto com padding (estoura); nada de `marginTop: 'auto'`; a raiz é coluna com um quadro interno `flexGrow: 1`.
- **Fontes embarcadas** (licença aberta): Fraunces + Inter, Archivo + Inter, Plus Jakarta Sans + Inter, Space Grotesk + Inter, Playfair Display + Lato. As larguras de cada letra são medidas no próprio Resvg (`pnpm --filter @prospeccao/integrations medir-fontes` → `carrosseisMetricas.gerada.ts`); o teste confere que a conta das linhas bate com o desenho.
- **Estilos**: Editorial, Impacto, Clean e Foto; em cada um os modelos capa, item numerado, texto, lista, número grande, citação, antes e depois, foto, chamada final.
- **Cores** com conferência de leitura (texto ≥ 4,5:1 em cada fundo, destaque grande ≥ 3), ajustando o tom só o bastante e avisando, como a v88.
- **Arquivos** no bucket R2 das reuniões (`carrosseis/<conta>/logos` e `/fotos`); a Meta vai buscar as imagens por link assinado ao publicar (v124).

## Etapas
1. **v121: fundação visual (feita em 08/11).** Identidade visual (cores com "Usar as cores de Marca e domínio", estilo, par de fontes, logos para fundo claro e escuro ou as de Marca e domínio, assinatura, número do slide, como a empresa fala), fotos da empresa (até 60), motor de slides (4 estilos × 9 modelos), editor (roteiro pronto ou só a capa, trocar modelo, subir/descer/duplicar/tirar, foto da empresa, fundo por slide, legenda com os 2.200 caracteres, salva sozinho com conflito entre abas, prévia como no Instagram, baixar as imagens em .zip com a legenda, marcar como pronto) e o módulo na cobrança. Já dá para postar à mão. Migration 089.
2. **v122: cérebro da marca + o time de IA escrevendo.** Dossiê automático, "o que divulgar este mês", leitura das perguntas reais dos clientes, provedor Anthropic (Sonnet), ciclo escrever → avaliar → reescrever, conferência de fatos, legenda e hashtags, pedidos ao redator por slide, fila com progresso, franquia contando. O módulo entra no Assinar e no site.
3. **v123: imagens.** GPT Image 2 médio: foto do produto em cenários, referência de estilo, imagens geradas sem texto na paleta da marca, revisor visual, custo por imagem em Saúde e consumo.
4. **v124: publicar e agendar.** `instagram_content_publish` (revisão do app na Meta: pedir já), publicar agora ou agendar, calendário, Comente e receba ligado ao post, aviso se a Meta recusar, DNA de cada post. Limites: até 10 imagens por carrossel, JPEG, 1 post no limite diário.
5. **v125: aprender.** Aba Ideias com a fonte de cada ideia, aprendizados com evidência, 2 em 10 como teste, edições do admin como sinal, contas de referência, resultados por carrossel, o Argos sabe dos carrosséis.

## Em aberto
- Preço do módulo e franquia (partida: R$ 397 com 20 carrosséis da IA por mês).
