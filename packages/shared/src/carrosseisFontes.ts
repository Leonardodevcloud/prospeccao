/**
 * Fontes dos carrosséis. Todas de licença aberta (SIL OFL), dos pacotes @fontsource na mesma versão
 * no servidor (que desenha o JPEG final) e no navegador (que mostra a prévia): a mesma letra, a
 * mesma largura, o mesmo lugar de quebra da linha.
 */

export interface FonteSlide {
  /** Nome da família (o mesmo no CSS do navegador e no desenho do servidor). */
  familia: string;
  peso: number;
  /** Pacote @fontsource e o nome do arquivo (subconjunto latino: português completo). */
  pacote: string;
}

/** Arquivo .woff da fonte dentro do pacote @fontsource. */
export function arquivoDaFonte(f: FonteSlide): string {
  const base = f.pacote.replace('@fontsource/', '');
  return `${f.pacote}/files/${base}-latin-${f.peso}-normal.woff`;
}

/** Todas as fontes que algum modelo de slide usa (o servidor carrega estas, uma vez). */
export const FONTES_SLIDES: FonteSlide[] = [
  { familia: 'Inter', peso: 400, pacote: '@fontsource/inter' },
  { familia: 'Inter', peso: 500, pacote: '@fontsource/inter' },
  { familia: 'Inter', peso: 600, pacote: '@fontsource/inter' },
  { familia: 'Inter', peso: 700, pacote: '@fontsource/inter' },
  { familia: 'Inter', peso: 800, pacote: '@fontsource/inter' },
  { familia: 'Fraunces', peso: 600, pacote: '@fontsource/fraunces' },
  { familia: 'Fraunces', peso: 700, pacote: '@fontsource/fraunces' },
  { familia: 'Archivo', peso: 800, pacote: '@fontsource/archivo' },
  { familia: 'Archivo', peso: 900, pacote: '@fontsource/archivo' },
  { familia: 'Plus Jakarta Sans', peso: 700, pacote: '@fontsource/plus-jakarta-sans' },
  { familia: 'Plus Jakarta Sans', peso: 800, pacote: '@fontsource/plus-jakarta-sans' },
  { familia: 'Space Grotesk', peso: 600, pacote: '@fontsource/space-grotesk' },
  { familia: 'Space Grotesk', peso: 700, pacote: '@fontsource/space-grotesk' },
  { familia: 'Playfair Display', peso: 700, pacote: '@fontsource/playfair-display' },
  { familia: 'Playfair Display', peso: 800, pacote: '@fontsource/playfair-display' },
  { familia: 'Lato', peso: 400, pacote: '@fontsource/lato' },
  { familia: 'Lato', peso: 700, pacote: '@fontsource/lato' },
  // v156: três pares a mais, os que mais aparecem em post de marca no Brasil.
  { familia: 'Poppins', peso: 700, pacote: '@fontsource/poppins' },
  { familia: 'Poppins', peso: 800, pacote: '@fontsource/poppins' },
  { familia: 'Montserrat', peso: 800, pacote: '@fontsource/montserrat' },
  { familia: 'Montserrat', peso: 900, pacote: '@fontsource/montserrat' },
  { familia: 'Bebas Neue', peso: 400, pacote: '@fontsource/bebas-neue' },
];

/** Chave da fonte nas tabelas de medida ("Inter 400"). */
export const chaveFonte = (familia: string, peso: number) => `${familia} ${peso}`;

/**
 * Caracteres medidos. Acentos usam a largura da letra sem acento (a diferença é desprezível) e o
 * que não está aqui conta como "m" (o mais largo comum): a conta erra para o lado seguro.
 */
export const CARACTERES_MEDIDOS =
  ' abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,;:!?-–—\'"“”‘’()[]%/$&@#+*=…•ºª°<>_|';
