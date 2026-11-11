import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Medir } from '@prospeccao/integrations/videos';
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

let fonte900: fontkit.Font | null = null;
let fonte800: fontkit.Font | null = null;

function abrir(arquivo: string): fontkit.Font {
  const f = fontkit.openSync(arquivo);
  // Coleções (.ttc) não entram aqui: a Montserrat é uma fonte só.
  return 'fonts' in f ? (f as fontkit.FontCollection).fonts[0]! : (f as fontkit.Font);
}

/** Régua da fonte no peso dado, com o espaçamento entre letras da legenda (em em). */
export function regua(peso: 800 | 900, espacamento = -0.01): Medir {
  if (peso === 900 && !fonte900) fonte900 = abrir(ARQUIVOS_FONTE[900]);
  if (peso === 800 && !fonte800) fonte800 = abrir(ARQUIVOS_FONTE[800]);
  const f = (peso === 900 ? fonte900 : fonte800) as fontkit.Font;
  const cache = new Map<string, number>();
  return (texto, tamanho) => {
    let w = cache.get(texto);
    if (w == null) {
      w = f.layout(texto).advanceWidth / f.unitsPerEm;
      cache.set(texto, w);
    }
    return (w + espacamento * texto.length) * tamanho;
  };
}
