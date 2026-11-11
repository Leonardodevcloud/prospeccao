import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { QuadroRosto } from '@prospeccao/integrations/videos';

/**
 * Mapa do rosto: onde está a cabeça (testa e cabelo acima da sobrancelha, barba abaixo do queixo)
 * em cada quadro. Detector de rosto com os 68 pontos do rosto (face-api, modelos do TensorFlow),
 * rodando no próprio servidor (WebAssembly), sem mandar o vídeo para fora.
 */

const require = createRequire(import.meta.url);
// biome-ignore lint/suspicious/noExplicitAny: bibliotecas sem tipos completos para o Node
type Qualquer = any;

let pronto: Promise<{ tf: Qualquer; faceapi: Qualquer }> | null = null;

function carregar() {
  pronto ??= (async () => {
    const tf = require('@tensorflow/tfjs');
    require('@tensorflow/tfjs-backend-wasm');
    const faceapi = require('@vladmandic/face-api/dist/face-api.node-wasm.js');
    await tf.setBackend('wasm');
    await tf.ready();
    const pasta = join(dirname(require.resolve('@vladmandic/face-api/package.json')), 'model');
    await faceapi.nets.ssdMobilenetv1.loadFromDisk(pasta);
    await faceapi.nets.faceLandmark68Net.loadFromDisk(pasta);
    return { tf, faceapi };
  })();
  return pronto;
}

/** Quadros do vídeo, pequenos (largura × altura), na taxa pedida. */
async function* quadros(
  arquivo: string,
  fps: number,
  largura: number,
  altura: number,
): AsyncGenerator<Buffer> {
  const ff = spawn(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      arquivo,
      '-vf',
      `fps=${fps},scale=${largura}:${altura}`,
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const tam = largura * altura * 3;
  let buf: Buffer = Buffer.alloc(0);
  for await (const pedaco of ff.stdout as AsyncIterable<Buffer>) {
    buf = buf.length ? Buffer.concat([buf, pedaco]) : pedaco;
    while (buf.length >= tam) {
      yield buf.subarray(0, tam);
      buf = buf.subarray(tam);
    }
  }
}

/**
 * Detecta o rosto num vídeo. `largura`/`altura` do vídeo de verdade: as caixas voltam nessa escala.
 * O vídeo é lido reduzido (360 px de largura), o bastante para um rosto de quem fala para a câmera.
 */
export async function mapearRosto(
  arquivo: string,
  opcoes: {
    fps: number;
    largura: number;
    altura: number;
    aoAndar?: (fracao: number) => void;
    duracao?: number;
  },
): Promise<QuadroRosto[]> {
  const { tf, faceapi } = await carregar();
  const w = 360;
  const h = Math.round(((opcoes.altura / opcoes.largura) * w) / 2) * 2;
  const escala = opcoes.largura / w;
  const detector = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.4 });
  const out: QuadroRosto[] = [];
  let k = 0;
  const total = opcoes.duracao ? Math.max(1, Math.ceil(opcoes.duracao * opcoes.fps)) : 0;
  for await (const q of quadros(arquivo, opcoes.fps, w, h)) {
    const t = tf.tensor3d(new Uint8Array(q.buffer, q.byteOffset, q.length), [h, w, 3], 'int32');
    let achados: Qualquer[] = [];
    try {
      achados = await faceapi.detectAllFaces(t, detector).withFaceLandmarks();
    } finally {
      t.dispose();
    }
    const caixas = achados
      .filter((a: Qualquer) => a.detection.box.width * escala >= 80)
      .map((a: Qualquer) => {
        const b = a.detection.box;
        const pts = a.landmarks.positions as { x: number; y: number }[];
        const ys = pts.map((p) => p.y);
        const xs = pts.map((p) => p.x);
        const queixo = Math.max(...ys);
        const sobrancelha = Math.min(...ys);
        const alturaRosto = queixo - sobrancelha;
        return {
          x0: Math.round((Math.min(...xs, b.x) - 0.08 * b.width) * escala),
          x1: Math.round((Math.max(...xs, b.x + b.width) + 0.08 * b.width) * escala),
          // Testa e cabelo acima da sobrancelha; barba abaixo do queixo.
          y0: Math.round((sobrancelha - 0.5 * alturaRosto) * escala),
          y1: Math.round((queixo + 0.12 * alturaRosto) * escala),
        };
      });
    out.push({ t: Math.round((k / opcoes.fps) * 1000) / 1000, caixas });
    k++;
    if (total && k % 10 === 0) opcoes.aoAndar?.(Math.min(1, k / total));
  }
  return out;
}

/**
 * Remenda buracos curtos (um quadro sem rosto entre dois com rosto: piscada, mão na frente),
 * repetindo a caixa do vizinho, para a diagramação não achar que o rosto sumiu.
 */
export function remendarBuracos(rostos: QuadroRosto[], maxQuadros = 3): QuadroRosto[] {
  const out = rostos.map((q) => ({ ...q, caixas: [...q.caixas] }));
  for (let k = 0; k < out.length; k++) {
    if (out[k]!.caixas.length) continue;
    let j = k;
    while (j < out.length && !out[j]!.caixas.length) j++;
    const antes = out[k - 1]?.caixas;
    const depois = out[j]?.caixas;
    if (j - k <= maxQuadros && (antes?.length || depois?.length))
      for (let m = k; m < j; m++) out[m]!.caixas = [...((antes?.length ? antes : depois) ?? [])];
    k = j;
  }
  return out;
}

/** Centro horizontal típico do rosto (para enquadrar em pé um vídeo gravado deitado). */
export function centroDoRosto(rostos: QuadroRosto[], largura: number): number {
  const xs = rostos.flatMap((q) => q.caixas.map((c) => (c.x0 + c.x1) / 2)).sort((a, b) => a - b);
  return xs.length ? xs[Math.floor(xs.length / 2)]! : largura / 2;
}
