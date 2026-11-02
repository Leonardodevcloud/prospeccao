import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buscarNaInternet, EnderecoRecusado, enderecoInterno } from '../src/rede.js';

describe('buscas em endereços de fora', () => {
  let servidor: Server;
  let base = '';
  beforeAll(async () => {
    servidor = createServer((req, res) => {
      if (req.url === '/grande') return res.writeHead(200).end('x'.repeat(50_000));
      if (req.url === '/volta') return res.writeHead(302, { location: 'http://169.254.169.254/' }).end();
      if (req.url === '/segue') return res.writeHead(301, { location: '/fim' }).end();
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((ok) => servidor.close(() => ok())));

  it('reconhece endereços internos (inclusive IPv4 escrito como IPv6)', () => {
    for (const ip of [
      '10.0.0.5',
      '127.0.0.1',
      '169.254.169.254',
      '172.20.1.1',
      '192.168.0.9',
      '100.64.3.2',
      '::1',
      'fd12::1',
      'fe80::1',
      '::ffff:10.0.0.1',
      '::ffff:a00:1',
      '0.0.0.0',
      '198.18.0.1',
    ])
      expect(enderecoInterno(ip), ip).toBe(true);
    for (const ip of ['8.8.8.8', '200.160.2.3', '2001:4860:4860::8888'])
      expect(enderecoInterno(ip), ip).toBe(false);
  });

  it('não busca na rede interna nem em nome interno', async () => {
    await expect(buscarNaInternet(`${base}/`)).rejects.toBeInstanceOf(EnderecoRecusado);
    await expect(buscarNaInternet('http://localhost/')).rejects.toBeInstanceOf(EnderecoRecusado);
    await expect(buscarNaInternet('http://api.railway.internal/')).rejects.toBeInstanceOf(EnderecoRecusado);
    await expect(buscarNaInternet('ftp://exemplo.com/')).rejects.toBeInstanceOf(EnderecoRecusado);
    await expect(buscarNaInternet('http://exemplo.com/', { soHttps: true })).rejects.toBeInstanceOf(
      EnderecoRecusado,
    );
  });

  it('confere cada redirecionamento e corta no limite de bytes', async () => {
    // O servidor de teste é local: libera a rede local só para ele, mas o salto conferido continua.
    const segue = await buscarNaInternet(`${base}/segue`, { redeLocal: true });
    expect(segue.url).toBe(`${base}/fim`);
    expect(segue.corpo.toString()).toBe('ok');
    const grande = await buscarNaInternet(`${base}/grande`, { redeLocal: true, limiteBytes: 1000 });
    expect(grande.cortado).toBe(true);
    expect(grande.corpo.length).toBe(1000);
    const parado = await buscarNaInternet(`${base}/volta`, { redeLocal: true, redirecionamentos: 0 });
    expect(parado.status).toBe(302);
  });
});
