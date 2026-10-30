# Convenções do projeto

- **Páginas de ajuda**: toda funcionalidade nova ou mudada atualiza o artigo da área em
  `apps/web/src/componentes/Ajuda.tsx` (lista `ARTIGOS`, rota `/ajuda/:artigo`). Se a área não tem
  artigo, crie um. Nas telas, aponte para ele com `<LinkAjuda artigo="…">`.
- Texto do sistema e da ajuda em português, para quem usa (sem termos técnicos).
