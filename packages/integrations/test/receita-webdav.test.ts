import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  baixarArquivo,
  credencialCompartilhamento,
  extrairMeses,
  listarMesesPublicados,
  URL_RECEITA_PADRAO,
  urlArquivo,
} from '../src/receita/index.js';

const TOKEN = 'YggdBLfdninEJX9';
const AUTH = `Basic ${Buffer.from(`${TOKEN}:`).toString('base64')}`;

/** Resposta PROPFIND no formato do Nextcloud. */
const MULTISTATUS = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:response><d:href>/public.php/dav/files/${TOKEN}/</d:href></d:response>
  <d:response><d:href>/public.php/dav/files/${TOKEN}/2026-08/</d:href></d:response>
  <d:response><d:href>/public.php/dav/files/${TOKEN}/2026-09/</d:href></d:response>
  <d:response><d:href>/public.php/dav/files/${TOKEN}/LEIAME.pdf</d:href></d:response>
</d:multistatus>`;

describe('Receita: compartilhamento WebDAV (Nextcloud)', () => {
  let servidor: Server;
  let base: string;
  let exigeAuth = false;
  const metodos: string[] = [];

  beforeAll(async () => {
    servidor = createServer((req, res) => {
      metodos.push(`${req.method} ${req.url}`);
      if (exigeAuth && req.headers.authorization !== AUTH) {
        res.writeHead(401).end();
        return;
      }
      if (req.url === `/public.php/dav/files/${TOKEN}/` && req.method === 'PROPFIND') {
        res.writeHead(207, { 'Content-Type': 'application/xml' }).end(MULTISTATUS);
        return;
      }
      if (req.url === '/html/' && req.method === 'PROPFIND') {
        res.writeHead(405).end();
        return;
      }
      if (req.url === '/html/' && req.method === 'GET') {
        res.writeHead(200).end('<a href="2026-07/">2026-07/</a> <a href="2026-06/">2026-06/</a>');
        return;
      }
      if (req.url === `/public.php/dav/files/${TOKEN}/2026-09/Cnaes.zip`) {
        res.writeHead(200).end('PK conteudo');
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((ok) => servidor.close(() => ok())));

  it('endereço padrão é o compartilhamento oficial', () => {
    expect(URL_RECEITA_PADRAO).toBe(`https://arquivos.receitafederal.gov.br/public.php/dav/files/${TOKEN}`);
    expect(credencialCompartilhamento(URL_RECEITA_PADRAO)).toBe(AUTH);
    expect(credencialCompartilhamento('https://espelho.exemplo.com/arquivos')).toBeNull();
  });

  it('lê os meses do PROPFIND, do mais novo ao mais antigo', async () => {
    expect(await listarMesesPublicados(`${base}/public.php/dav/files/${TOKEN}`)).toEqual([
      '2026-09',
      '2026-08',
    ]);
  });

  it('repete com a credencial do link quando o servidor pede (401)', async () => {
    exigeAuth = true;
    try {
      expect(await listarMesesPublicados(`${base}/public.php/dav/files/${TOKEN}/`)).toEqual([
        '2026-09',
        '2026-08',
      ]);
      const destino = join(tmpdir(), `cnaes-${Date.now()}.zip`);
      const url = urlArquivo(`${base}/public.php/dav/files/${TOKEN}`, '2026-09', 'Cnaes.zip');
      await baixarArquivo(url, destino, `${base}/public.php/dav/files/${TOKEN}`);
      expect(await readFile(destino, 'utf8')).toBe('PK conteudo');
    } finally {
      exigeAuth = false;
    }
  });

  it('sem WebDAV, cai para a listagem HTML (espelhos)', async () => {
    expect(await listarMesesPublicados(`${base}/html`)).toEqual(['2026-07', '2026-06']);
  });

  it('erro diz o motivo: HTTP e DNS', async () => {
    await expect(listarMesesPublicados(`${base}/nao-existe`)).rejects.toThrow(/HTTP 404/);
    await expect(listarMesesPublicados('https://dominio-inexistente.invalid/x')).rejects.toThrow(
      /não consegui listar .*\(/,
    );
  });

  it('extrairMeses ignora arquivos e a própria raiz', () => {
    expect(extrairMeses(MULTISTATUS)).toEqual(['2026-09', '2026-08']);
  });
});
