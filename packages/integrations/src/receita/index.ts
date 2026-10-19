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

/**
 * Endereço oficial (desde 2026): compartilhamento público Nextcloud da Receita, lido por WebDAV.
 * Os meses ficam na raiz (`2026-09/`), com os mesmos nomes de arquivo de sempre.
 */
export const URL_RECEITA_PADRAO =
  'https://arquivos.receitafederal.gov.br/public.php/dav/files/YggdBLfdninEJX9';

/**
 * Credencial Basic de um compartilhamento público Nextcloud: usuário = token do link, senha vazia.
 * Alguns servidores pedem, outros não; só é enviada depois de um 401.
 */
export function credencialCompartilhamento(baseUrl: string): string | null {
  const token = baseUrl.match(/\/(?:dav\/files|s)\/([A-Za-z0-9]{8,})/)?.[1];
  return token ? `Basic ${Buffer.from(`${token}:`).toString('base64')}` : null;
}

/** Explica a falha de rede em português curto (DNS, recusa, timeout, TLS). */
export function descreverFalha(erro: unknown): string {
  const e = erro as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  const codigo = e?.cause?.code;
  if (e?.name === 'TimeoutError') return 'tempo esgotado';
  if (codigo === 'ENOTFOUND') return 'domínio não encontrado (DNS)';
  if (codigo === 'ECONNREFUSED' || codigo === 'ECONNRESET') return `conexão recusada (${codigo})`;
  if (codigo?.startsWith('CERT_') || codigo?.includes('CERT') || codigo === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE')
    return `certificado TLS (${codigo})`;
  return codigo ?? e?.cause?.message ?? e?.message ?? String(erro);
}

/** fetch que tenta sem credencial e, num 401, repete com a do compartilhamento. */
async function requisitar(url: string, baseUrl: string, init: RequestInit): Promise<Response> {
  const r = await fetch(url, init);
  if (r.status !== 401) return r;
  const auth = credencialCompartilhamento(baseUrl);
  if (!auth) return r;
  await r.body?.cancel();
  return fetch(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), Authorization: auth },
  });
}

/** Extrai os meses (AAAA-MM) de uma resposta WebDAV (PROPFIND) ou de uma listagem HTML. */
export function extrairMeses(corpo: string): string[] {
  const meses = new Set<string>();
  // WebDAV: <d:href>/public.php/dav/files/TOKEN/2026-09/</d:href>
  for (const m of corpo.matchAll(/<(?:\w+:)?href>[^<]*?\/(\d{4}-\d{2})\/?<\/(?:\w+:)?href>/g)) {
    if (m[1]) meses.add(m[1]);
  }
  // HTML (espelhos e o formato antigo): <a href="2026-09/">
  for (const m of corpo.matchAll(/href="(?:[^"]*\/)?(\d{4}-\d{2})\/?"/g)) {
    if (m[1]) meses.add(m[1]);
  }
  return [...meses].sort().reverse();
}

/** Meses publicados (AAAA-MM), do mais novo ao mais antigo. WebDAV primeiro; listagem HTML se não houver. */
export async function listarMesesPublicados(baseUrl: string): Promise<string[]> {
  const raiz = `${baseUrl.replace(/\/$/, '')}/`;
  let corpo: string;
  try {
    let r = await requisitar(raiz, baseUrl, {
      method: 'PROPFIND',
      headers: { Depth: '1', 'Content-Type': 'application/xml' },
      signal: AbortSignal.timeout(30_000),
    });
    // Servidor sem WebDAV (pasta HTML comum): cai para GET.
    if (r.status === 405 || r.status === 501) {
      await r.body?.cancel();
      r = await requisitar(raiz, baseUrl, { signal: AbortSignal.timeout(30_000) });
    }
    if (!r.ok) {
      await r.body?.cancel();
      throw new AppError(502, 'falha_externa', `Receita: não consegui listar ${baseUrl} (HTTP ${r.status})`, {
        repetivel: r.status >= 500 || r.status === 429,
      });
    }
    corpo = await r.text();
  } catch (erro) {
    if (erro instanceof AppError) throw erro;
    throw AppError.externo('Receita', `não consegui listar ${baseUrl} (${descreverFalha(erro)})`, erro);
  }
  return extrairMeses(corpo);
}

export function urlArquivo(baseUrl: string, mes: string, nome: string): string {
  return `${baseUrl.replace(/\/$/, '')}/${mes}/${nome}`;
}

/** Baixa um arquivo grande direto para o disco, sem passar pela memória. */
export async function baixarArquivo(url: string, destino: string, baseUrl = url): Promise<number> {
  await mkdir(dirname(destino), { recursive: true });
  let resposta: Response;
  try {
    resposta = await requisitar(url, baseUrl, { signal: AbortSignal.timeout(60 * 60_000) });
  } catch (erro) {
    throw AppError.externo('Receita', `download falhou: ${url} (${descreverFalha(erro)})`, erro);
  }
  if (!resposta.ok || !resposta.body) {
    await resposta.body?.cancel();
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
