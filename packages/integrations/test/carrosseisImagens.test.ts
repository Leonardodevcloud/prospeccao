import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CENAS_PRODUTO,
  gerarCenario,
  gerarImagemDoSlide,
  promptDaImagemDoSlide,
  promptDoCenario,
  TAMANHO_SLIDE,
} from '../src/carrosseis/index.js';

const cfg = {
  chave: 'k',
  modelo: 'gpt-image-2',
  url: 'https://img.test/gen',
  urlEdicao: 'https://img.test/edit',
};
const resposta = () =>
  new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('jpeg').toString('base64') }] }), {
    status: 200,
  });

describe('v132: as imagens dos carrosséis', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('o pedido do slide: sem texto, na paleta da marca, com espaço para o texto e a referência', () => {
    const p = promptDaImagemDoSlide('oficina limpa', {
      paleta: ['#14213D', '#F2A541'],
      referencia: 'luz lateral',
    });
    expect(p).toContain('#14213D');
    expect(p).toMatch(/texto/);
    expect(p).toMatch(/logotipo/);
    expect(p).toContain('luz lateral');
    expect(p).toMatch(/não copie/);
  });

  it('o cenário manda manter o produto exatamente igual', () => {
    const p = promptDoCenario(CENAS_PRODUTO[0], { paleta: [] });
    expect(p).toMatch(/EXATAMENTE igual/);
    expect(p).toContain(CENAS_PRODUTO[0]);
  });

  it('a imagem do slide sai em 4:5 pela geração; o cenário vai como edição com a foto', async () => {
    const corpos: { url: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      corpos.push({ url, body: init.body });
      return resposta();
    });
    await gerarImagemDoSlide(cfg, 'oficina', { paleta: [] });
    expect(corpos[0]!.url).toBe('https://img.test/gen');
    expect(JSON.parse(String(corpos[0]!.body))).toMatchObject({
      size: `${TAMANHO_SLIDE.largura}x${TAMANHO_SLIDE.altura}`,
      quality: 'medium',
    });
    await gerarCenario(cfg, new Uint8Array([1, 2, 3]), CENAS_PRODUTO[1], { paleta: [] });
    expect(corpos[1]!.url).toBe('https://img.test/edit');
    const form = corpos[1]!.body as FormData;
    expect(form.get('input_fidelity')).toBe('high');
    expect(form.get('image[]')).toBeInstanceOf(Blob);
    expect(String(form.get('prompt'))).toMatch(/EXATAMENTE igual/);
  });
});
