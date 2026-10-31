/**
 * Gera o que o Argos sabe sobre o sistema a partir da Central de Ajuda (Ajuda.tsx): cada artigo vira
 * texto simples em apps/api/src/modulos/assistente/ajuda.gerada.ts. Rode sempre que mudar a ajuda:
 *
 *   pnpm --filter @prospeccao/web saber
 *
 * O teste da api confere que o arquivo gerado tem todos os artigos da ajuda.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { ARTIGOS } from '../src/componentes/Ajuda';

const aqui = dirname(fileURLToPath(import.meta.url));
const destino = resolve(aqui, '../../api/src/modulos/assistente/ajuda.gerada.ts');

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };

/** HTML do artigo → texto com listas e parágrafos (o que a IA lê). */
function paraTexto(html: string): string {
  return html
    .replace(/<li[^>]*>/g, '\n- ')
    .replace(/<\/(p|h\d|ol|ul|div|tr)>/g, '\n')
    .replace(/<h\d[^>]*>/g, '\n## ')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<td[^>]*>/g, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(
      /&(#?\w+);/g,
      (m, e: string) => ENTIDADES[e] ?? (e.startsWith('#') ? String.fromCharCode(Number(e.slice(1))) : m),
    )
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const artigos = ARTIGOS.map((a) => ({
  id: a.id,
  area: a.area,
  titulo: a.titulo,
  resumo: a.resumo,
  onde: a.onde ? `${a.onde.rotulo} (${a.onde.para})` : null,
  termos: a.termos ?? '',
  soMaster: !!a.soMaster,
  texto: paraTexto(renderToStaticMarkup(<MemoryRouter>{a.corpo}</MemoryRouter>)),
}));

const conteudo = `// Gerado por apps/web/scripts/saber-argos.tsx a partir da Central de Ajuda. Não edite à mão:
// mude a ajuda (apps/web/src/componentes/Ajuda.tsx) e rode \`pnpm --filter @prospeccao/web saber\`.

export interface ArtigoDoArgos {
  id: string;
  area: string;
  titulo: string;
  resumo: string;
  onde: string | null;
  termos: string;
  soMaster: boolean;
  texto: string;
}

export const ARTIGOS_AJUDA: ArtigoDoArgos[] = ${JSON.stringify(artigos, null, 2)};
`;
writeFileSync(destino, conteudo);
console.log(`${artigos.length} artigos → ${destino}`);
