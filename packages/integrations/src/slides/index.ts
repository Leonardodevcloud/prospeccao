import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  alturaDoFormato,
  arquivoDaFonte,
  FONTES_SLIDES,
  type FormatoPeca,
  LARGURA_SLIDE,
  type No,
} from '@prospeccao/shared/carrosseis';

/**
 * Desenho dos slides dos carrosséis no servidor: a árvore do slide (montada no shared) vira SVG no
 * Satori, PNG no Resvg e JPEG no Sharp (o Instagram só aceita JPEG pela API). Sem navegador: cerca
 * de 150 ms por slide de 1080 × 1350.
 *
 * Os três pacotes são carregados só na primeira vez (a api sobe sem eles na memória) e ficam fora do
 * empacotamento (Satori traz o motor de layout em WebAssembly; Resvg e Sharp são nativos).
 */

type Satori = typeof import('satori').default;
type ResvgClasse = typeof import('@resvg/resvg-js').Resvg;
type Sharp = typeof import('sharp').default;

interface Motor {
  satori: Satori;
  Resvg: ResvgClasse;
  sharp: Sharp;
  fontes: { name: string; data: Buffer; weight: 400 | 500 | 600 | 700 | 800 | 900; style: 'normal' }[];
}

let motor: Promise<Motor> | null = null;

function carregarMotor(): Promise<Motor> {
  if (motor) return motor;
  motor = (async (): Promise<Motor> => {
    const [satori, resvg, sharp] = await Promise.all([
      import('satori'),
      import('@resvg/resvg-js'),
      import('sharp'),
    ]);
    const exigir = createRequire(import.meta.url);
    const fontes = FONTES_SLIDES.map((f) => ({
      name: f.familia,
      data: readFileSync(exigir.resolve(arquivoDaFonte(f))),
      weight: f.peso as 400,
      style: 'normal' as const,
    }));
    return { satori: satori.default, Resvg: resvg.Resvg, sharp: sharp.default, fontes };
  })().catch((e) => {
    motor = null;
    throw e;
  });
  return motor;
}

export type FormatoSlide = 'jpeg' | 'png';

/**
 * Desenha a árvore de um slide (1080 × 1350 no feed, 1080 × 1920 no story). `largura` menor serve
 * para miniaturas.
 */
export async function desenharSlide(
  no: No,
  opcoes: { formato?: FormatoSlide; largura?: number; qualidade?: number; peca?: FormatoPeca } = {},
): Promise<Buffer> {
  const m = await carregarMotor();
  const svg = await m.satori(no as never, {
    width: LARGURA_SLIDE,
    height: alturaDoFormato(opcoes.peca),
    fonts: m.fontes,
  });
  const largura = Math.min(LARGURA_SLIDE, Math.max(120, Math.round(opcoes.largura ?? LARGURA_SLIDE)));
  const png = new m.Resvg(svg, { fitTo: { mode: 'width', value: largura }, background: '#ffffff' })
    .render()
    .asPng();
  if (opcoes.formato === 'png') return Buffer.from(png);
  return m
    .sharp(png)
    .jpeg({ quality: opcoes.qualidade ?? 92, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toBuffer();
}

export interface ImagemPreparada {
  /** JPEG (foto) ou PNG (logo com transparência), já no tamanho de trabalho. */
  dados: Buffer;
  tipo: 'image/jpeg' | 'image/png';
  largura: number;
  altura: number;
}

/**
 * Prepara uma imagem enviada: confere que é imagem de verdade, gira pela orientação da câmera, tira
 * os dados do aparelho (EXIF/GPS) e reduz para o maior lado em `maxLado` px.
 */
export async function prepararImagem(
  bytes: Uint8Array,
  opcoes: { maxLado?: number; manterTransparencia?: boolean } = {},
): Promise<ImagemPreparada> {
  const { sharp } = await carregarMotor();
  const img = sharp(bytes, { failOn: 'error', limitInputPixels: 60_000_000 }).rotate();
  const meta = await img.metadata();
  if (!meta.width || !meta.height) throw new Error('imagem inválida');
  const max = opcoes.maxLado ?? 2160;
  const reduzida = img.resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true });
  const png = opcoes.manterTransparencia && meta.hasAlpha;
  const { data, info } = png
    ? await reduzida.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
    : await reduzida
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
  return { dados: data, tipo: png ? 'image/png' : 'image/jpeg', largura: info.width, altura: info.height };
}

/** Data URL de uma imagem (o Satori lê a foto e a logo assim, sem buscar na rede). */
export const dataUrl = (dados: Uint8Array, tipo: string) =>
  `data:${tipo};base64,${Buffer.from(dados).toString('base64')}`;
