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
