import type { TransicaoApoio, TratamentoImagem } from '@prospeccao/shared/videos';

/**
 * Vídeos de apoio (v162): os trechos entram em tela cheia por cima do vídeo já cortado, antes do
 * render (a legenda e as animações são desenhadas depois, por cima). A voz do principal continua:
 * o apoio entra sem som, em corte seco (o "flash").
 */

export interface TrechoDeApoio {
  /** O apoio já preparado (1080×1920, sem som). */
  arquivo: string;
  /** O segundo do apoio em que o trecho começa. */
  de: number;
  /** Onde entra e sai no vídeo editado. */
  ini: number;
  fim: number;
  /** v165: como entra e sai (a aproximação e o clarão são desenhados no render, por cima). */
  estilo?: Exclude<TransicaoApoio, 'variada'>;
}

const n3 = (n: number) => (Math.round(n * 1000) / 1000).toFixed(3);

/** Quanto dura a entrada e a saída do deslize e da fusão (s). */
export const TEMPO_DA_TRANSICAO_DO_APOIO = 0.26;

/**
 * v165: o tratamento da imagem do vídeo (a fala e o apoio juntos), antes de a legenda e as
 * animações serem desenhadas: elas ficam com a cor exata da marca.
 */
export const FILTRO_DA_IMAGEM: Record<TratamentoImagem, string | null> = {
  original: null,
  vivo: 'eq=contrast=1.06:saturation=1.14:gamma=0.98,unsharp=5:5:0.45:5:5:0',
  cinema:
    'eq=contrast=1.11:saturation=1.06:gamma=0.96,colorbalance=rs=-0.035:bs=0.045:rh=0.045:bh=-0.04,unsharp=5:5:0.5:5:5:0,vignette=angle=PI/6',
};

/**
 * Os argumentos do ffmpeg que põem os trechos de apoio por cima do vídeo editado e tratam a
 * imagem. Sem trecho e sem tratamento não há o que fazer: devolve null.
 */
export function argumentosDoApoio(e: {
  editado: string;
  saida: string;
  trechos: TrechoDeApoio[];
  imagem?: TratamentoImagem;
}): string[] | null {
  const trechos = e.trechos.filter((t) => t.fim - t.ini >= 0.3);
  const tratamento = FILTRO_DA_IMAGEM[e.imagem ?? 'original'];
  if (!trechos.length && !tratamento) return null;
  const args = ['-v', 'error', '-y', '-i', e.editado];
  for (const t of trechos) args.push('-ss', n3(Math.max(0, t.de)), '-t', n3(t.fim - t.ini), '-i', t.arquivo);
  const filtros: string[] = [];
  let base = '0:v';
  const T = TEMPO_DA_TRANSICAO_DO_APOIO;
  trechos.forEach((t, k) => {
    const dur = t.fim - t.ini;
    const d = Math.min(T, dur / 3);
    // Fusão: o trecho ganha transparência no começo e no fim (o vídeo de baixo aparece através).
    const fusao =
      t.estilo === 'fusao'
        ? `format=yuva420p,fade=t=in:st=0:d=${n3(d)}:alpha=1,fade=t=out:st=${n3(dur - d)}:d=${n3(d)}:alpha=1,`
        : '';
    // O trecho é carimbado no tempo em que entra; fora da janela, o vídeo principal aparece.
    filtros.push(`[${k + 1}:v]${fusao}setpts=PTS-STARTPTS+${n3(t.ini)}/TB[a${k}]`);
    // Deslize: entra pela direita desacelerando e sai pela esquerda acelerando.
    const x =
      t.estilo === 'deslize'
        ? `x='if(lt(t,${n3(t.ini + d)}),W*pow(1-(t-${n3(t.ini)})/${n3(d)},3),if(gt(t,${n3(t.fim - d)}),-W*pow((t-${n3(t.fim - d)})/${n3(d)},3),0))':`
        : '';
    filtros.push(
      `[${base}][a${k}]overlay=${x}enable='between(t,${n3(t.ini)},${n3(t.fim)})':eof_action=pass:shortest=0[v${k}]`,
    );
    base = `v${k}`;
  });
  if (tratamento) {
    filtros.push(`[${base}]${tratamento}[cor]`);
    base = 'cor';
  }
  args.push(
    '-filter_complex',
    filtros.join(';'),
    '-map',
    `[${base}]`,
    '-map',
    '0:a?',
    '-c:a',
    'copy',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '16',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    e.saida,
  );
  return args;
}

/** Deixa o apoio no formato do vídeo (em pé, 1080×1920, 30 quadros, sem som), cortando as sobras. */
export function argumentosDeNormalizarApoio(e: {
  entrada: string;
  saida: string;
  maxSegundos: number;
}): string[] {
  return [
    '-v',
    'error',
    '-y',
    '-i',
    e.entrada,
    '-t',
    String(e.maxSegundos),
    '-an',
    '-vf',
    'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-movflags',
    '+faststart',
    e.saida,
  ];
}
