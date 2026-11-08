# Convenções do projeto

- **Páginas de ajuda**: toda funcionalidade nova ou mudada atualiza o artigo da área em
  `apps/web/src/componentes/Ajuda.tsx` (lista `ARTIGOS`, rota `/ajuda/:artigo`). Se a área não tem
  artigo, crie um. Nas telas, aponte para ele com `<LinkAjuda artigo="…">`.
- Texto do sistema e da ajuda em português, para quem usa (sem termos técnicos).
- **O Argos sabe o que está na ajuda**: depois de mudar `Ajuda.tsx`, rode `pnpm --filter @prospeccao/web saber`
  (gera `apps/api/src/modulos/assistente/ajuda.gerada.ts`; o teste da api avisa se ficou para trás).
- **Tour do sistema**: as falas e os destaques ficam em `packages/shared/src/tour.ts`; as telas em
  `apps/web/public/tour/*.webp` (1600×1000, da conta de demonstração). Mudou uma tela que aparece no tour:
  troque a imagem e confira as posições dos destaques (`FOCOS`).
- **Site (SEO)**: o `index.html` do site tem os dados para o Google e as IAs num JSON-LD (`@graph` com
  Organization, WebSite, SoftwareApplication com os planos e FAQPage) e o resumo em `apps/site/llms.txt`.
  Mudou uma dúvida, um preço ou um plano no site: atualize os dois com o mesmo texto. Seção nova na página
  inicial com `id`: inclua em `SECOES_DO_SITE` (`packages/shared/src/site.ts`) para aparecer em Visitas do site.
- **Docs do projeto em `docs/`**: `continuidade-prospect-team.md` (contexto, combinados, histórico de versões),
  `pendencias-configuracao-crm.md` (variáveis e cadastros a fazer), `plano-proximas-versoes.md` e
  `plano-carrosseis.md`. Toda versão atualiza o que mudou neles (linha nova no histórico, migration, serviços
  para redeploy, configuração nova), com o mesmo texto dos docs `claude/*.md` do projeto no claude.ai.
- **Carrosséis (slides desenhados pelo Satori)**: toda div com `display: flex`; nada de largura/altura em % com
  padding; nada de `marginTop: 'auto'`. Mudou fonte ou par de fontes: rode
  `pnpm --filter @prospeccao/integrations medir-fontes` e confira com `galeria-slides`.
