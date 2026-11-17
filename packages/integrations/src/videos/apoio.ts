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
}

const n3 = (n: number) => (Math.round(n * 1000) / 1000).toFixed(3);

/** Os argumentos do ffmpeg que põem os trechos de apoio por cima do vídeo editado. */
export function argumentosDoApoio(e: { editado: string; saida: string; trechos: TrechoDeApoio[] }): string[] {
  const trechos = e.trechos.filter((t) => t.fim - t.ini >= 0.3);
  const args = ['-v', 'error', '-y', '-i', e.editado];
  for (const t of trechos) args.push('-ss', n3(Math.max(0, t.de)), '-t', n3(t.fim - t.ini), '-i', t.arquivo);
  const filtros: string[] = [];
  let base = '0:v';
  trechos.forEach((t, k) => {
    // O trecho é carimbado no tempo em que entra; fora da janela, o vídeo principal aparece.
    filtros.push(`[${k + 1}:v]setpts=PTS-STARTPTS+${n3(t.ini)}/TB[a${k}]`);
    filtros.push(
      `[${base}][a${k}]overlay=enable='between(t,${n3(t.ini)},${n3(t.fim)})':eof_action=pass:shortest=0[v${k}]`,
    );
    base = `v${k}`;
  });
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
