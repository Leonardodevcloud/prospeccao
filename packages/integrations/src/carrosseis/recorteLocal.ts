import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, renameSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * v155: o recorte feito no próprio servidor, sem pagar por imagem. Um modelo aberto de separação de
 * fundo (formato ONNX) devolve só a máscara: a foto não é redesenhada, então a pessoa ou o produto
 * ficam idênticos ao original. É opcional (`RECORTE_LOCAL_MODELO`): sem a variável, ou se o modelo
 * falhar ou o revisor reprovar o resultado, o recorte segue pela IA de imagem, como antes.
 *
 * Medido em 11/11 numa máquina de 2 núcleos com o `isnet-general-use` (178 MB): cerca de 2 s por foto
 * e 1,2 GB de memória durante o recorte. O BiRefNet (mais preciso) passou de 6 GB e não coube. Por
 * isso roda um recorte por vez, e a api precisa de memória sobrando para ligar isto.
 *
 * A licença dos pesos do modelo é de quem o publica (não é a deste código): confira antes de usar.
 */
export interface ConfigRecorteLocal {
  /** Caminho de um arquivo .onnx no servidor ou um endereço https de onde baixá-lo (uma vez). */
  modelo: string;
  /** Lado da entrada do modelo (padrão 1024). */
  lado?: number;
}

interface Tensor {
  data: Float32Array;
  dims: number[];
}
interface Sessao {
  inputNames: string[];
  outputNames: string[];
  run(entrada: Record<string, unknown>): Promise<Record<string, Tensor>>;
}

let sessao: {
  modelo: string;
  pronta: Promise<{ s: Sessao; ort: { Tensor: new (...a: unknown[]) => unknown } }>;
} | null = null;
let fila: Promise<unknown> = Promise.resolve();

async function arquivoDoModelo(modelo: string): Promise<string> {
  if (!/^https:\/\//.test(modelo)) return modelo;
  const destino = join(
    tmpdir(),
    `recorte-${createHash('sha1').update(modelo).digest('hex').slice(0, 12)}.onnx`,
  );
  if (existsSync(destino) && statSync(destino).size > 1_000_000) return destino;
  const r = await fetch(modelo, { signal: AbortSignal.timeout(10 * 60_000) });
  if (!r.ok || !r.body) throw new Error(`não deu para baixar o modelo de recorte (HTTP ${r.status})`);
  const parcial = `${destino}.baixando`;
  await pipeline(Readable.fromWeb(r.body as never), createWriteStream(parcial));
  renameSync(parcial, destino);
  return destino;
}

async function carregar(cfg: ConfigRecorteLocal) {
  if (sessao?.modelo !== cfg.modelo)
    sessao = {
      modelo: cfg.modelo,
      pronta: (async () => {
        // Carregado só aqui: o pacote é opcional e só a api o tem instalado.
        const nome = 'onnxruntime-node';
        const ort = (await import(nome)) as {
          InferenceSession: { create(caminho: string, o: object): Promise<Sessao> };
          Tensor: new (...a: unknown[]) => unknown;
        };
        const s = await ort.InferenceSession.create(await arquivoDoModelo(cfg.modelo), {
          intraOpNumThreads: 2,
          executionMode: 'sequential',
        });
        return { s, ort };
      })(),
    };
  try {
    return await sessao.pronta;
  } catch (erro) {
    sessao = null;
    throw erro;
  }
}

/** Tira o fundo da foto no servidor e devolve o PNG transparente, no tamanho da foto (um por vez). */
export function recortarLocal(cfg: ConfigRecorteLocal, foto: Uint8Array): Promise<Uint8Array> {
  const vez = fila.then(() => recortar(cfg, foto));
  fila = vez.catch(() => undefined);
  return vez;
}

async function recortar(cfg: ConfigRecorteLocal, foto: Uint8Array): Promise<Uint8Array> {
  const sharp = (await import('sharp')).default;
  const { s, ort } = await carregar(cfg);
  const N = cfg.lado ?? 1024;
  const reta = await sharp(Buffer.from(foto), { failOn: 'error' }).rotate().removeAlpha().toBuffer();
  const meta = await sharp(reta).metadata();
  const L = meta.width ?? 0;
  const A = meta.height ?? 0;
  if (!L || !A) throw new Error('imagem inválida');
  const rgb = await sharp(reta).resize(N, N, { fit: 'fill' }).raw().toBuffer();
  const entrada = new Float32Array(3 * N * N);
  for (let i = 0; i < N * N; i++)
    for (let c = 0; c < 3; c++) entrada[c * N * N + i] = rgb[i * 3 + c]! / 255 - 0.5;
  const saida = await s.run({ [s.inputNames[0]!]: new ort.Tensor('float32', entrada, [1, 3, N, N]) });
  const o = saida[s.outputNames[0]!]!;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const v of o.data) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const mascara = Buffer.alloc(N * N);
  const faixa = max - min || 1;
  // Abaixo de 10% é resto de fundo: zera, para não sobrar véu nem pontinho em volta do assunto.
  for (let i = 0; i < N * N; i++) {
    const v = Math.round((255 * (o.data[i]! - min)) / faixa);
    mascara[i] = v < 26 ? 0 : v;
  }
  const alfa = await sharp(mascara, { raw: { width: N, height: N, channels: 1 } })
    .resize(L, A, { fit: 'fill' })
    .toColourspace('b-w')
    .raw()
    .toBuffer();
  const cru = await sharp(reta).raw().toBuffer();
  const png = await sharp(cru, { raw: { width: L, height: A, channels: 3 } })
    .joinChannel(alfa, { raw: { width: L, height: A, channels: 1 } })
    .png({ compressionLevel: 8 })
    .toBuffer();
  return new Uint8Array(png);
}
