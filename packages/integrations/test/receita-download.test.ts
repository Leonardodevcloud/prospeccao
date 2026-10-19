import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { baixarArquivo } from '../src/receita/index.js';

const CONTEUDO = Buffer.from(Array.from({ length: 200_000 }, (_, i) => i % 251));

/**
 * Servidor que imita a Receita lenta: a primeira resposta para no meio (cai ou trava),
 * as seguintes respeitam o Range.
 */
describe('Receita: download que cai ou trava no meio', () => {
  let servidor: Server;
  let base: string;
  let modo: 'cai' | 'trava' | 'sem_range' = 'cai';
  let pedidos: (string | undefined)[] = [];

  beforeAll(async () => {
    servidor = createServer((req, res) => {
      pedidos.push(req.headers.range);
      const range = req.headers.range?.match(/bytes=(\d+)-/);
      const primeira = pedidos.length === 1;
      if (range && modo !== 'sem_range') {
        const inicio = Number(range[1]);
        res.writeHead(206, {
          'Content-Length': CONTEUDO.length - inicio,
          'Content-Range': `bytes ${inicio}-${CONTEUDO.length - 1}/${CONTEUDO.length}`,
        });
        res.end(CONTEUDO.subarray(inicio));
        return;
      }
      res.writeHead(200, { 'Content-Length': CONTEUDO.length });
      if (primeira) {
        res.write(CONTEUDO.subarray(0, 80_000));
        if (modo === 'trava') return; // fica parado sem mandar nada
        setTimeout(() => res.destroy(), 20); // conexão derrubada
        return;
      }
      res.end(CONTEUDO);
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    servidor.closeAllConnections();
    return new Promise<void>((ok) => servidor.close(() => ok()));
  });

  beforeEach(() => {
    pedidos = [];
  });

  const opcoes = { semDadosMs: 300, esperaMs: 10 };

  it('conexão derrubada: continua de onde parou e entrega o arquivo inteiro', async () => {
    modo = 'cai';
    const destino = join(await mkdtemp(join(tmpdir(), 'dl-')), 'Estabelecimentos0.zip');
    const avisos: number[] = [];
    const bytes = await baixarArquivo(`${base}/a.zip`, destino, base, (b) => avisos.push(b), opcoes);
    expect(bytes).toBe(CONTEUDO.length);
    expect((await readFile(destino)).equals(CONTEUDO)).toBe(true);
    expect(pedidos[0]).toBeUndefined();
    expect(pedidos[1]).toMatch(/^bytes=\d+-$/);
    expect(Number(pedidos[1]!.slice(6, -1))).toBeGreaterThan(0);
    expect(avisos.at(-1)).toBe(CONTEUDO.length);
  });

  it('conexão travada sem dados: reconecta sozinha em vez de esperar para sempre', async () => {
    modo = 'trava';
    const destino = join(await mkdtemp(join(tmpdir(), 'dl-')), 'Socios0.zip');
    const bytes = await baixarArquivo(`${base}/b.zip`, destino, base, undefined, opcoes);
    expect(bytes).toBe(CONTEUDO.length);
    expect((await readFile(destino)).equals(CONTEUDO)).toBe(true);
    expect(pedidos).toHaveLength(2);
  });

  it('servidor sem Range: baixa tudo de novo sem corromper o arquivo', async () => {
    modo = 'sem_range';
    const destino = join(await mkdtemp(join(tmpdir(), 'dl-')), 'Empresas0.zip');
    await baixarArquivo(`${base}/c.zip`, destino, base, undefined, opcoes);
    expect((await stat(destino)).size).toBe(CONTEUDO.length);
    expect((await readFile(destino)).equals(CONTEUDO)).toBe(true);
  });

  it('desiste com mensagem clara depois do limite de reconexões', async () => {
    const destino = join(await mkdtemp(join(tmpdir(), 'dl-')), 'X.zip');
    await expect(
      baixarArquivo(`http://127.0.0.1:1/x.zip`, destino, 'http://127.0.0.1:1', undefined, {
        ...opcoes,
        reconexoes: 2,
      }),
    ).rejects.toThrow(/depois de 2 reconexões/);
  });
});
