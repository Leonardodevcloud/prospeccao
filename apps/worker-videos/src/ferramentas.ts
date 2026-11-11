import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

/** Programas de fora (ffmpeg, ffprobe, HyperFrames) com saída de erro curta no log. */

export class ErroDoVideo extends Error {
  /** Mensagem para quem usa (vai para a tela); a técnica fica no log. */
  constructor(
    readonly paraQuemUsa: string,
    readonly definitivo = true,
    detalhe?: string,
  ) {
    super(detalhe ? `${paraQuemUsa} (${detalhe})` : paraQuemUsa);
    this.name = 'ErroDoVideo';
  }
}

export function rodar(
  programa: string,
  args: string[],
  opcoes: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; saida?: 'texto' | 'bytes' } = {},
): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((ok, falha) => {
    const p = spawn(programa, args, {
      cwd: opcoes.cwd,
      env: opcoes.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const saida: Buffer[] = [];
    let erro = '';
    p.stdout.on('data', (d: Buffer) => saida.push(d));
    p.stderr.on('data', (d: Buffer) => {
      erro = (erro + d.toString()).slice(-8000);
    });
    const relogio = opcoes.timeoutMs
      ? setTimeout(() => {
          p.kill('SIGKILL');
        }, opcoes.timeoutMs)
      : null;
    p.on('error', (e) => {
      if (relogio) clearTimeout(relogio);
      falha(e);
    });
    p.on('close', (codigo, sinal) => {
      if (relogio) clearTimeout(relogio);
      if (codigo === 0) ok({ stdout: Buffer.concat(saida), stderr: erro });
      else
        falha(
          new Error(
            `${programa} terminou com ${sinal ? `sinal ${sinal}` : `código ${codigo}`}: ${erro.trim().split('\n').slice(-6).join(' | ')}`,
          ),
        );
    });
  });
}

export interface InfoDoVideo {
  duracao: number;
  largura: number;
  altura: number;
  /** Rotação gravada pelo celular (o vídeo "deitado" que toca em pé). */
  rotacao: number;
  temSom: boolean;
}

/** Duração, tamanho já com a rotação aplicada, e se tem som. */
export async function lerInfo(arquivo: string): Promise<InfoDoVideo> {
  const { stdout } = await rodar(
    'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', arquivo],
    {
      timeoutMs: 60_000,
    },
  );
  const j = JSON.parse(stdout.toString()) as {
    format?: { duration?: string };
    streams?: {
      codec_type?: string;
      width?: number;
      height?: number;
      duration?: string;
      tags?: { rotate?: string };
      side_data_list?: { rotation?: number }[];
    }[];
  };
  const v = j.streams?.find((s) => s.codec_type === 'video');
  if (!v?.width || !v.height) throw new ErroDoVideo('O arquivo não tem imagem de vídeo que dê para ler.');
  const rot = Number(v.tags?.rotate ?? v.side_data_list?.find((x) => x.rotation != null)?.rotation ?? 0);
  const deitado = Math.abs(rot) % 180 === 90;
  const duracao = Number(j.format?.duration ?? v.duration ?? 0);
  return {
    duracao: Number.isFinite(duracao) ? duracao : 0,
    largura: deitado ? v.height : v.width,
    altura: deitado ? v.width : v.height,
    rotacao: rot,
    temSom: !!j.streams?.some((s) => s.codec_type === 'audio'),
  };
}

/** Duração do vídeo de um arquivo já montado (o stream de vídeo, mais preciso que o do contêiner). */
export async function duracaoDoVideo(arquivo: string): Promise<number> {
  const { stdout } = await rodar(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=duration', '-of', 'csv=p=0', arquivo],
    { timeoutMs: 30_000 },
  );
  return Number(stdout.toString().trim()) || 0;
}

/** Áudio cru (mono, 16 kHz, 16 bits) para medir os silêncios. */
export async function lerAudioCru(arquivo: string): Promise<Int16Array> {
  const { stdout } = await rodar(
    'ffmpeg',
    ['-v', 'error', '-i', arquivo, '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', '-'],
    {
      timeoutMs: 120_000,
    },
  );
  return new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 2));
}

/** Lê um arquivo em pedaços (para subir em partes sem segurar tudo na memória). */
export async function* pedacos(arquivo: string, tamanho: number): AsyncGenerator<Uint8Array> {
  const { size } = await stat(arquivo);
  if (!size) return;
  const leitura = createReadStream(arquivo, { highWaterMark: tamanho });
  let acumulado: Buffer[] = [];
  let bytes = 0;
  for await (const d of leitura as AsyncIterable<Buffer>) {
    acumulado.push(d);
    bytes += d.length;
    while (bytes >= tamanho) {
      const tudo = Buffer.concat(acumulado);
      yield new Uint8Array(tudo.subarray(0, tamanho));
      const resto = tudo.subarray(tamanho);
      acumulado = resto.length ? [resto] : [];
      bytes = resto.length;
    }
  }
  if (bytes) yield new Uint8Array(Buffer.concat(acumulado));
}
