import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { AppError } from '@prospeccao/shared';
import { parse } from 'csv-parse';
import iconv from 'iconv-lite';
import yauzl from 'yauzl';

export * from './layout.js';

/** Arquivos da publicação mensal. Os grandes vêm divididos em 10 partes (0 a 9). */
export const ARQUIVOS = {
  municipios: ['Municipios.zip'],
  qualificacoes: ['Qualificacoes.zip'],
  cnaes: ['Cnaes.zip'],
  estabelecimentos: Array.from({ length: 10 }, (_, i) => `Estabelecimentos${i}.zip`),
  empresas: Array.from({ length: 10 }, (_, i) => `Empresas${i}.zip`),
  socios: Array.from({ length: 10 }, (_, i) => `Socios${i}.zip`),
} as const;

/** Lê a listagem do diretório e devolve os meses publicados (AAAA-MM), do mais novo ao mais antigo. */
export async function listarMesesPublicados(baseUrl: string): Promise<string[]> {
  let html: string;
  try {
    const r = await fetch(`${baseUrl.replace(/\/$/, '')}/`, { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    html = await r.text();
  } catch (erro) {
    throw AppError.externo('Receita', `não consegui listar ${baseUrl}`, erro);
  }
  const meses = new Set<string>();
  for (const m of html.matchAll(/href="(?:[^"]*\/)?(\d{4}-\d{2})\/?"/g)) {
    if (m[1]) meses.add(m[1]);
  }
  return [...meses].sort().reverse();
}

export function urlArquivo(baseUrl: string, mes: string, nome: string): string {
  return `${baseUrl.replace(/\/$/, '')}/${mes}/${nome}`;
}

/** Baixa um arquivo grande direto para o disco, sem passar pela memória. */
export async function baixarArquivo(url: string, destino: string): Promise<number> {
  await mkdir(dirname(destino), { recursive: true });
  let resposta: Response;
  try {
    resposta = await fetch(url, { signal: AbortSignal.timeout(60 * 60_000) });
  } catch (erro) {
    throw AppError.externo('Receita', `download falhou: ${url}`, erro);
  }
  if (!resposta.ok || !resposta.body) {
    throw new AppError(502, 'falha_externa', `Receita: HTTP ${resposta.status} em ${url}`, {
      repetivel: resposta.status >= 500 || resposta.status === 429,
    });
  }
  await pipeline(Readable.fromWeb(resposta.body as unknown as WebReadableStream), createWriteStream(destino));
  return (await stat(destino)).size;
}

/**
 * Lê um CSV da Receita (latin1, separador ";", sem cabeçalho) a partir de um
 * stream de bytes e entrega linha a linha como arrays de colunas.
 */
export async function* lerCsvReceita(bytes: NodeJS.ReadableStream): AsyncGenerator<string[]> {
  const parser = parse({
    delimiter: ';',
    quote: '"',
    relax_quotes: true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: false,
  });
  const fluxo = bytes.pipe(iconv.decodeStream('latin1')).pipe(parser);
  for await (const linha of fluxo) yield linha as string[];
}

function abrirZip(caminho: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) =>
    yauzl.open(caminho, { lazyEntries: true, autoClose: true }, (e, zip) =>
      e || !zip ? reject(e) : resolve(zip),
    ),
  );
}

function primeiraEntrada(zip: yauzl.ZipFile): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zip.once('error', reject);
    zip.once('end', () => reject(new Error('zip vazio')));
    zip.once('entry', (entrada: yauzl.Entry) => {
      zip.openReadStream(entrada, (e, stream) => (e || !stream ? reject(e) : resolve(stream)));
    });
    zip.readEntry();
  });
}

/** Cada zip da Receita traz um único CSV; lê esse CSV em streaming. */
export async function* lerZipReceita(caminhoZip: string): AsyncGenerator<string[]> {
  const zip = await abrirZip(caminhoZip);
  const stream = await primeiraEntrada(zip);
  yield* lerCsvReceita(stream);
}
