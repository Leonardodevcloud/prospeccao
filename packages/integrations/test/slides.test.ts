import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  arquivoDaFonte,
  contarLinhas,
  ESTILOS,
  FONTES_SLIDES,
  IDENTIDADE_PADRAO,
  MODELOS,
  montarSlide,
  slideNovo,
} from '@prospeccao/shared/carrosseis';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { dataUrl, desenharSlide, prepararImagem } from '../src/slides/index.js';

const exigir = createRequire(import.meta.url);

describe('desenho dos slides', () => {
  it('todo modelo, em todo estilo, sai em JPEG 1080 × 1350', async () => {
    const foto = await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#7a8b99' } })
      .jpeg()
      .toBuffer();
    for (const estilo of ESTILOS)
      for (const [i, modelo] of MODELOS.entries()) {
        const m = montarSlide({
          slide: { ...slideNovo(modelo, `s${i}`), fotoId: 1 },
          indice: i,
          total: MODELOS.length,
          identidade: { ...IDENTIDADE_PADRAO, assinatura: '@empresa', marcaTexto: 'Empresa' },
          estilo,
          foto: dataUrl(foto, 'image/jpeg'),
        });
        const jpeg = await desenharSlide(m.no, { largura: estilo === 'editorial' ? 1080 : 270 });
        const meta = await sharp(jpeg).metadata();
        expect(meta.format).toBe('jpeg');
        expect(meta.width! / meta.height!).toBeCloseTo(1080 / 1350, 2);
        if (estilo === 'editorial') expect(meta).toMatchObject({ width: 1080, height: 1350 });
      }
  }, 60_000);

  it('a conta das linhas bate com o que o motor desenha', async () => {
    const frases = [
      'Quem pediu orçamento ontem já falou com outro fornecedor hoje.',
      'Pastilha cerâmica dianteira, com instalação grátis na compra do par, até 30/11.',
      'O follow-up depende da memória do vendedor e ninguém sabe quem é o dono de cada lead.',
    ];
    const casos = [
      { familia: 'Inter', peso: 400, tamanho: 40, largura: 888 },
      { familia: 'Fraunces', peso: 600, tamanho: 80, largura: 888 },
      { familia: 'Archivo', peso: 900, tamanho: 72, largura: 888, caixaAlta: true },
      { familia: 'Playfair Display', peso: 700, tamanho: 64, largura: 600 },
    ];
    let iguais = 0;
    let total = 0;
    for (const c of casos) {
      const f = FONTES_SLIDES.find((x) => x.familia === c.familia && x.peso === c.peso)!;
      const fontes = [
        {
          name: f.familia,
          data: readFileSync(exigir.resolve(arquivoDaFonte(f))),
          weight: f.peso as 400,
          style: 'normal' as const,
        },
      ];
      for (const t of frases) {
        // Altura da linha = 1 tamanho: o número de linhas é a altura da caixa dividida pelo tamanho.
        const svg = await satori(
          {
            type: 'div',
            props: {
              style: { display: 'flex', width: 2000, height: 1600, alignItems: 'flex-start' },
              children: {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    width: c.largura,
                    fontFamily: c.familia,
                    fontWeight: c.peso,
                    fontSize: c.tamanho,
                    lineHeight: 1.5,
                    backgroundColor: '#000',
                    ...(c.caixaAlta ? { textTransform: 'uppercase' } : {}),
                  },
                  children: t,
                },
              },
            },
          } as never,
          { width: 2000, height: 1600, fonts: fontes },
        );
        const caixa = new Resvg(svg).getBBox();
        const desenhadas = Math.round((caixa?.height ?? 0) / (c.tamanho * 1.5));
        const previstas = contarLinhas(
          t,
          { familia: c.familia, peso: c.peso, caixaAlta: c.caixaAlta },
          c.tamanho,
          c.largura,
        );
        total += 1;
        if (desenhadas === previstas) iguais += 1;
        // Nunca prever menos linhas do que sai (o texto estouraria a caixa).
        expect(previstas).toBeGreaterThanOrEqual(desenhadas);
      }
    }
    expect(iguais / total).toBeGreaterThanOrEqual(0.9);
  }, 60_000);

  it('prepara a foto: gira pela câmera, tira os dados do aparelho e reduz', async () => {
    const original = await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: '#336699' },
    })
      .withMetadata({ orientation: 6, exif: { IFD0: { Make: 'Celular', Model: 'Teste' } } })
      .jpeg()
      .toBuffer();
    const p = await prepararImagem(original, { maxLado: 2160 });
    expect(p.tipo).toBe('image/jpeg');
    // Orientação 6 = girada 90°: a foto em pé fica em pé.
    expect(p.altura).toBe(2160);
    expect(p.largura).toBe(1440);
    const meta = await sharp(p.dados).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    await expect(prepararImagem(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow();
  });

  it('logo com transparência continua PNG', async () => {
    const png = await sharp({
      create: { width: 400, height: 120, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const p = await prepararImagem(png, { maxLado: 1200, manterTransparencia: true });
    expect(p).toMatchObject({ tipo: 'image/png', largura: 400, altura: 120 });
  });
});
