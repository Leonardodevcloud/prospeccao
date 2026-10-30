import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, open, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Armazenamento } from '@prospeccao/integrations/reuniao';
import type { Logger } from '@prospeccao/shared';

/**
 * Monta o arquivo final de uma gravação feita pelo navegador.
 *
 * O navegador manda a gravação em pedaços de poucos segundos (cada um continua o anterior, como
 * pedaços de um mesmo arquivo). Aqui os pedaços são juntados num arquivo temporário e o ffmpeg
 * reorganiza o arquivo sem recodificar o vídeo ("-c copy", leva segundos): ele ganha a duração e o
 * índice, e o player consegue pular para qualquer momento. O resultado sobe em partes de 8 MB.
 *
 * Sem ffmpeg na máquina (ambiente de testes, por exemplo), sobe os pedaços juntados como estão:
 * o vídeo toca, só pular para um momento fica mais lento.
 */

const PARTE = 8 * 1024 * 1024;

/** Chave do pedaço n no armazenamento. */
export const chaveDoPedaco = (chaveBase: string, n: number) => `${chaveBase}/p/${String(n).padStart(6, '0')}`;

interface Formato {
  extensao: string;
  tipo: string;
  argumentos: string[];
}

/** Formato do arquivo final a partir do que o navegador gravou. */
export function formatoFinal(mime: string | null, tipo: 'sala' | 'audio'): Formato {
  if (tipo === 'audio')
    // O microfone de cada pessoa (só para a transcrição): Opus em Ogg, sem mexer no som.
    return { extensao: 'ogg', tipo: 'audio/ogg', argumentos: ['-vn', '-c:a', 'copy'] };
  if (/h264|avc1/i.test(mime ?? ''))
    // Vídeo H.264: MP4 com o índice no começo (toca em qualquer navegador e celular, inclusive iPhone).
    // O áudio vira AAC (o que todo player aceita); o vídeo não é recodificado.
    return {
      extensao: 'mp4',
      tipo: 'video/mp4',
      argumentos: ['-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'],
    };
  return { extensao: 'webm', tipo: 'video/webm', argumentos: ['-c', 'copy'] };
}

function rodar(programa: string, argumentos: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(programa, argumentos, { stdio: ['ignore', 'pipe', 'pipe'] });
    let saida = '';
    let erro = '';
    p.stdout.on('data', (b: Buffer) => {
      saida += b.toString();
    });
    p.stderr.on('data', (b: Buffer) => {
      erro = (erro + b.toString()).slice(-2000);
    });
    p.on('error', reject);
    p.on('close', (codigo) =>
      codigo === 0 ? resolve(saida) : reject(new Error(`${programa} saiu com ${codigo}: ${erro.trim()}`)),
    );
  });
}

const semPrograma = (erro: unknown) => (erro as NodeJS.ErrnoException)?.code === 'ENOENT';

async function duracao(arquivo: string): Promise<number | null> {
  try {
    const s = await rodar('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      arquivo,
    ]);
    const n = Number.parseFloat(s.trim());
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  } catch {
    return null;
  }
}

/** Sobe um arquivo do disco em partes de 8 MB (todas do mesmo tamanho, como o R2 exige). */
async function subirEmPartes(
  arm: Armazenamento,
  arquivo: string,
  chave: string,
  tipo: string,
): Promise<void> {
  const envioId = await arm.iniciarEmPartes(chave, tipo);
  const partes: { numero: number; etag: string }[] = [];
  try {
    let acumulado: Buffer[] = [];
    let tamanho = 0;
    const mandar = async (b: Buffer) => {
      const numero = partes.length + 1;
      partes.push({ numero, etag: await arm.enviarParte(chave, envioId, numero, b) });
    };
    for await (const pedaco of createReadStream(arquivo, { highWaterMark: 1024 * 1024 })) {
      acumulado.push(pedaco as Buffer);
      tamanho += (pedaco as Buffer).length;
      while (tamanho >= PARTE) {
        const tudo = Buffer.concat(acumulado);
        await mandar(tudo.subarray(0, PARTE));
        const resto = tudo.subarray(PARTE);
        acumulado = resto.length ? [resto] : [];
        tamanho = resto.length;
      }
    }
    if (tamanho || !partes.length) await mandar(Buffer.concat(acumulado));
    await arm.concluirEmPartes(chave, envioId, partes);
  } catch (erro) {
    await arm.cancelarEmPartes(chave, envioId);
    throw erro;
  }
}

export interface Montada {
  chave: string;
  bytes: number;
  segundos: number | null;
}

/**
 * Junta os pedaços (na ordem), arruma o arquivo com o ffmpeg e sobe o resultado.
 * Os pedaços não são apagados aqui (só depois que o banco registrar o arquivo final).
 */
export async function montarArquivo(
  arm: Armazenamento,
  g: { chave: string; mime: string | null; tipo: 'sala' | 'audio' },
  pedacos: number[],
  log: Logger,
): Promise<Montada> {
  if (!pedacos.length) throw new Error('Nenhum pedaço da gravação chegou.');
  const pasta = await mkdtemp(join(tmpdir(), 'gravacao-'));
  try {
    const entrada = join(pasta, 'entrada');
    const arquivo = await open(entrada, 'w');
    try {
      for (const n of pedacos) await arquivo.write(await arm.ler(chaveDoPedaco(g.chave, n)));
    } finally {
      await arquivo.close();
    }

    const f = formatoFinal(g.mime, g.tipo);
    let final = join(pasta, `final.${f.extensao}`);
    let tipo = f.tipo;
    let extensao = f.extensao;
    try {
      await rodar('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-fflags',
        '+genpts+igndts',
        '-i',
        entrada,
        ...f.argumentos,
        final,
      ]);
    } catch (erro) {
      if (!semPrograma(erro)) throw erro;
      // Sem ffmpeg: o arquivo como o navegador gravou.
      log.warn('reuniões: ffmpeg não está instalado; a gravação sobe sem o índice para pular no vídeo');
      final = entrada;
      tipo = (g.mime ?? 'video/webm').split(';')[0]!;
      extensao = tipo.includes('mp4') ? 'mp4' : tipo.startsWith('audio/') ? 'webm' : 'webm';
    }
    const chave = `${g.chave}.${extensao}`;
    const bytes = (await stat(final)).size;
    const segundos = await duracao(final);
    await subirEmPartes(arm, final, chave, tipo);
    return { chave, bytes, segundos };
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}
