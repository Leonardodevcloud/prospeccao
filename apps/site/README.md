# Site institucional (Prospect Team)

Página estática (HTML, CSS e JS puros, sem build) que apresenta o CRM: funcionalidades com as telas reais, simulador de ganho, planos, dúvidas e contato.

```
apps/site/
  index.html          página única
  css/site.css        estilos da página (tokens do design system "CRM de Prospecção")
  css/componentes.css cópia dos estilos dos componentes do CRM usados na página (nota, fonte, decisor, trilha)
  js/site.js          interações: menu, revelar ao rolar, tour das telas, simulador, contato
  img/                telas do sistema (.webp), og.png e ícone
  fonts/              Geist e Geist Mono (woff2)
  vercel.json         cabeçalhos de segurança (CSP) e cache
```

## Antes de publicar

1. O WhatsApp e o e-mail do comercial ficam no sistema: painel da plataforma → **Vendas → Contato do site**. Cada pedido do formulário cai no quadro de Vendas do painel (não no CRM). O `vercel.json` repassa `/api/site/*` para a API (troque o endereço se a API mudar de domínio).
2. Quando tiver o domínio, troque `app.prospectteam.com.br` (barra das telas) e acrescente a URL completa em `og:image` / `canonical` no `index.html`.

## Rodar localmente

```
cd apps/site
python -m http.server 4321
```

Abra http://localhost:4321.

## Deploy (Vercel)

Novo projeto no Vercel apontando para o mesmo repositório:

- **Root Directory:** `apps/site`
- **Framework Preset:** Other (o `vercel.json` desta pasta já desliga instalação e build e publica a própria pasta)

Não precisa de variável de ambiente. O `vercel.json` desta pasta aplica os cabeçalhos.

> Se mudar o script inline do `<head>` (`document.documentElement.classList.add('js');`), atualize o hash `sha256-…` da CSP no `vercel.json`.

## Trocar as telas

As imagens em `img/` são capturas do sistema rodando com dados de demonstração (1440×900, 2x, convertidas para WebP).
Para trocar uma, mantenha o mesmo nome de arquivo e a mesma proporção.

## Domínio e prévia de links

As URLs absolutas (canonical, og:url, og:image, twitter:image, sitemap.xml e robots.txt) apontam para `https://prospectteam.com.br`. Se o domínio mudar, troque nesses quatro arquivos: `index.html`, `sitemap.xml`, `robots.txt` e este README.

Para testar a prévia depois do deploy:
- Facebook/Instagram/WhatsApp: https://developers.facebook.com/tools/debug/ (clique em "Extrair novamente" para limpar o cache)
- LinkedIn: https://www.linkedin.com/post-inspector/
- Telegram: mande o link para @WebpageBot para atualizar o cache
