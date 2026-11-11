import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { clienteDoCerebro, ErroDoCerebro, enderecoDaApi } from '../src/segundo-cerebro/index.js';

describe('segundo cérebro: o cliente do Cérebro', () => {
  it('completa o endereço até /api/externo, venha como vier', () => {
    expect(enderecoDaApi('cerebro.tutts.com.br')).toBe('https://cerebro.tutts.com.br/api/externo');
    expect(enderecoDaApi('https://cerebro.tutts.com.br/')).toBe('https://cerebro.tutts.com.br/api/externo');
    expect(enderecoDaApi('https://cerebro.tutts.com.br/api')).toBe(
      'https://cerebro.tutts.com.br/api/externo',
    );
    expect(enderecoDaApi('https://cerebro.tutts.com.br/api/externo/?x=1#a')).toBe(
      'https://cerebro.tutts.com.br/api/externo',
    );
    expect(() => enderecoDaApi('https://')).toThrow(ErroDoCerebro);
  });

  it('só https e nada de rede interna fora dos testes', async () => {
    const c = clienteDoCerebro({ url: 'http://cerebro.exemplo/api/externo', token: 'cbr_x' });
    await expect(c.testar()).rejects.toThrow('https');
    const interno = clienteDoCerebro({ url: 'https://127.0.0.1/api/externo', token: 'cbr_x' });
    await expect(interno.testar()).rejects.toBeInstanceOf(ErroDoCerebro);
  });

  it('não segue redirecionamento (o token não vai para outro endereço) e explica o 401', async () => {
    const vistos: string[] = [];
    const s = createServer((req, res) => {
      vistos.push(req.url ?? '');
      if (req.url?.startsWith('/desvio')) {
        res.writeHead(302, { location: 'http://outro.exemplo/' });
        return res.end();
      }
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ erro: { mensagem: 'Token do Cérebro inválido ou revogado.' } }));
    }).listen(0);
    const base = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
    try {
      const desvio = clienteDoCerebro({ url: `${base}/desvio`, token: 'cbr_x' }, { redeLocal: true });
      await expect(desvio.testar()).rejects.toThrow('redireciona');
      const recusado = clienteDoCerebro({ url: base, token: 'cbr_x' }, { redeLocal: true });
      await expect(recusado.buscar('prazo de entrega')).rejects.toMatchObject({
        status: 401,
        message: 'Token do Cérebro inválido ou revogado.',
      });
      expect(await recusado.buscar('a')).toEqual([]);
      expect(vistos).toEqual(['/desvio/saude', '/buscar']);
    } finally {
      s.close();
    }
  });
});
