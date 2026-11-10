import { afterEach, describe, expect, it, vi } from 'vitest';
import { esperaDoLimite, LimiteDaTranscricao, transcreverArquivo } from '../src/reuniao/index.js';

afterEach(() => vi.unstubAllGlobals());

const cfg = {
  baseUrl: 'https://api.groq.com/openai/v1',
  chave: 'gsk_teste',
  modelo: 'whisper-large-v3-turbo',
};

describe('limite do serviço de transcrição', () => {
  it('lê a espera do retry-after ou da mensagem da Groq', () => {
    expect(esperaDoLimite('120', '')).toBe(120);
    expect(esperaDoLimite(null, 'Rate limit reached ... Please try again in 12m30.5s. Need more?')).toBe(751);
    expect(esperaDoLimite(null, 'Please try again in 1h2m3s')).toBe(3723);
    expect(esperaDoLimite(null, 'sem dica')).toBe(600);
  });

  it('HTTP 429 vira LimiteDaTranscricao (esperar, não falhar)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":{"message":"Please try again in 2m"}}', { status: 429 })),
    );
    const e = await transcreverArquivo(cfg, new Uint8Array([1, 2, 3])).catch((x) => x);
    expect(e).toBeInstanceOf(LimiteDaTranscricao);
    expect((e as LimiteDaTranscricao).esperaS).toBe(120);
  });

  it('manda o arquivo (não o link) e lê os trechos', async () => {
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      const form = init.body as FormData;
      expect(form.get('file')).toBeInstanceOf(Blob);
      expect(form.get('url')).toBeNull();
      return new Response(JSON.stringify({ segments: [{ start: 1, end: 2, text: 'Oi, tudo bem?' }] }), {
        status: 200,
      });
    });
    vi.stubGlobal('fetch', f);
    expect(await transcreverArquivo(cfg, new Uint8Array([1, 2, 3]))).toEqual([
      { inicioMs: 1000, fimMs: 2000, texto: 'Oi, tudo bem?' },
    ]);
  });

  it('parte maior que 24 MB não vai', async () => {
    await expect(transcreverArquivo(cfg, new Uint8Array(25 * 1024 * 1024))).rejects.toThrow('24 MB');
  });
});
