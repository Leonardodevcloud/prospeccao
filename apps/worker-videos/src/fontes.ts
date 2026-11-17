import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Medir } from '@prospeccao/integrations/videos';
import { FONTES_LEGENDA, type FonteLegenda } from '@prospeccao/shared/videos';
import * as fontkit from 'fontkit';

/**
 * A fonte da legenda (Montserrat, a dos Reels profissionais) e a régua que mede o texto com as
 * mesmas métricas que o navegador do render usa: a diagramação quebra as linhas certo.
 */

const require = createRequire(import.meta.url);
const pasta = join(dirname(require.resolve('@fontsource/montserrat/package.json')), 'files');

export const ARQUIVOS_FONTE = {
  800: join(pasta, 'montserrat-latin-800-normal.woff2'),
  900: join(pasta, 'montserrat-latin-900-normal.woff2'),
};

/** v166: os arquivos da fonte escolhida para a legenda (o peso normal e o forte). */
export function arquivosDaLegenda(fonte: FonteLegenda): { 800: string; 900: string } {
  const f = FONTES_LEGENDA.find((x) => x.id === fonte) ?? FONTES_LEGENDA[0];
  const dir = join(dirname(require.resolve(`@fontsource/${f.pacote}/package.json`)), 'files');
  const arquivo = (peso: number) => join(dir, `${f.pacote}-latin-${peso}-normal.woff2`);
  return { 800: arquivo(f.normal), 900: arquivo(f.forte) };
}

const abertas = new Map<string, fontkit.Font>();

function abrir(arquivo: string): fontkit.Font {
  const f = fontkit.openSync(arquivo);
  // Coleções (.ttc) não entram aqui: cada arquivo é uma fonte só.
  return 'fonts' in f ? (f as fontkit.FontCollection).fonts[0]! : (f as fontkit.Font);
}

/**
 * Régua da fonte no peso dado, com o espaçamento entre letras da legenda (em em). Sem a fonte
 * dita, é a Montserrat (o título e as animações são sempre nela).
 */
export function regua(peso: 800 | 900, espacamento = -0.01, fonte: FonteLegenda = 'montserrat'): Medir {
  const arquivo = fonte === 'montserrat' ? ARQUIVOS_FONTE[peso] : arquivosDaLegenda(fonte)[peso];
  let f = abertas.get(arquivo);
  if (!f) {
    f = abrir(arquivo);
    abertas.set(arquivo, f);
  }
  const fonteAberta = f;
  const cache = new Map<string, number>();
  return (texto, tamanho) => {
    let w = cache.get(texto);
    if (w == null) {
      w = fonteAberta.layout(texto).advanceWidth / fonteAberta.unitsPerEm;
      cache.set(texto, w);
    }
    return (w + espacamento * texto.length) * tamanho;
  };
}
