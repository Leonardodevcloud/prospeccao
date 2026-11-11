import { IDENTIDADE_PADRAO, slideNovo } from '@prospeccao/shared/carrosseis';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  avaliarArte,
  desenharArte,
  lerDirecao,
  porLogo,
  promptDaArte,
  textoDaArte,
} from '../src/carrosseis/arte.js';

const identidade = {
  ...IDENTIDADE_PADRAO,
  cores: { principal: '#3D0A5C', destaque: '#F07A12', claro: '#FFF7EF', texto: '#1B0A26' },
  jeitoDePostar: 'Fundo roxo forte, motoboy recortado por cima, ícones 3D e o preço em laranja.',
};
const slide = {
  ...slideNovo('numero', 'c1v1'),
  sobretitulo: 'Plano Conquista',
  destaque: '24 meses',
  titulo: 'A moto *fica com você*',
  texto: 'Paga por semana, com manutenção inclusa.',
  botao: 'Chame no WhatsApp',
};
const direcao = lerDirecao({
  ideia: 'Motoboy cutout bursting out of a purple background toward the viewer',
  cena: 'Deep purple gradient with soft orange glow',
  assunto: 'Image 1 courier cut out, large on the right, looking at camera',
  composicao: 'Huge orange "24 meses" top-left, headline under it, button bottom-left, courier right side',
  elementos: ['orange 3D coin', 'speed lines', '', 'small sparkles'],
  tipografia: 'Extra-bold condensed sans, white headline, orange number',
  luz_e_cor: 'Rim light on the courier',
  canto_da_logo: 'base-direita',
});
const base = {
  empresa: 'Tutts',
  identidade,
  formato: 'feed' as const,
  slide,
  objetivo: 'Promoção',
  fotos: 1,
  posts: 2,
  direcao,
};

describe('v150/v151: a arte da IA', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('a direção de arte é lida com limites e o canto da logo é um dos quatro', () => {
    expect(direcao).toMatchObject({ cantoDaLogo: 'base-direita' });
    expect(direcao!.elementos).toEqual(['orange 3D coin', 'speed lines', 'small sparkles']);
    expect(lerDirecao({ ideia: 'x', composicao: 'y' })).toBeNull();
    expect(
      lerDirecao({
        ...direcao,
        ideia: 'Uma ideia boa e clara',
        composicao: 'Composição bem descrita aqui',
        canto_da_logo: 'meio',
      })!.cantoDaLogo,
    ).toBe('topo-direita');
  });

  it('o pedido segue o formato da OpenAI: texto literal, cores, papéis das referências, canto livre e sem logo desenhada', () => {
    const p = promptDaArte(base);
    expect(p).toContain('USE CASE:');
    expect(p).toContain('BIG IDEA: Motoboy cutout');
    expect(p).toContain('LAYOUT: Huge orange');
    expect(p).toContain('"A moto fica com você"');
    expect(p).toContain('"24 meses"');
    expect(p).toContain('"Chame no WhatsApp"');
    expect(p).toContain('"fica com você"');
    expect(p).not.toContain('*');
    expect(p).toContain('#3D0A5C');
    expect(p).toContain('#F07A12');
    expect(p).toContain('- Image 1: real photo of the company');
    expect(p).toContain('- Images 2, 3: posts this brand already published');
    expect(p).toContain('bottom-right corner');
    expect(p).toContain('Do NOT draw any logo');
    expect(p).toContain('motoboy recortado');
    const story = promptDaArte({ ...base, formato: 'story', fotos: 0, posts: 0, direcao: null });
    expect(story).toContain('9:16');
    expect(story).toContain('top 13%');
    expect(story).not.toContain('REFERENCE IMAGES');
    expect(promptDaArte({ ...base, corrigir: ['Faltou o botão.'] })).toContain(
      'FIX FROM THE LAST ATTEMPT: Faltou o botão.',
    );
  });

  const lidoCerto = {
    textos: [
      'PLANO CONQUISTA',
      '24 MESES',
      'A moto fica',
      'com você',
      'Paga por semana, com',
      'manutenção inclusa.',
      'Chame no WhatsApp',
    ],
    canto_livre: true,
    outra_marca: false,
    defeito: false,
    legivel: true,
    nota: 4,
    problemas: [],
  };
  const o = { empresa: 'Tutts' };

  it('aprova quando todo o texto está lá, mesmo quebrado em linhas e em caixa alta', () => {
    expect(avaliarArte(textoDaArte(slide), lidoCerto, o)).toMatchObject({ aprovada: true, problemas: [] });
  });

  it('reprova palavra faltando, acento errado, número inventado, canto ocupado, marca desenhada e nota baixa', () => {
    const esperado = textoDaArte(slide);
    const semBotao = avaliarArte(esperado, { ...lidoCerto, textos: lidoCerto.textos.slice(0, -1) }, o);
    expect(semBotao.aprovada).toBe(false);
    expect(semBotao.problemas[0]).toContain('o botão');
    expect(
      avaliarArte(
        esperado,
        { ...lidoCerto, textos: lidoCerto.textos.map((t) => t.replace('você', 'voce')) },
        o,
      ).aprovada,
    ).toBe(false);
    const preco = avaliarArte(esperado, { ...lidoCerto, textos: [...lidoCerto.textos, 'R$ 199'] }, o);
    expect(preco.aprovada).toBe(false);
    expect(preco.problemas.join(' ')).toContain('199');
    expect(avaliarArte(esperado, { ...lidoCerto, canto_livre: false }, o).aprovada).toBe(false);
    expect(avaliarArte(esperado, { ...lidoCerto, nota: 2 }, o).aprovada).toBe(false);
    expect(avaliarArte(esperado, { ...lidoCerto, outra_marca: true }, o).aprovada).toBe(false);
  });

  it('manda as fotos e os posts numa edição só, sem o input_fidelity que o GPT Image 2 recusa', async () => {
    let campos: [string, unknown][] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      campos = [...(init.body as FormData).entries()];
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('jpeg').toString('base64') }] }), {
        status: 200,
      });
    });
    const img = (nome: string) => ({ dados: new Uint8Array([1, 2, 3]), tipo: 'image/jpeg' as const, nome });
    await desenharArte(
      { chave: 'k', modelo: 'gpt-image-2', qualidade: 'high', urlEdicao: 'https://img.test/edit' },
      { ...base, referencias: [img('foto-1.jpg'), img('post-1.jpg'), img('post-2.jpg')] },
    );
    expect(campos.filter(([k]) => k === 'image[]')).toHaveLength(3);
    expect(campos.find(([k]) => k === 'quality')?.[1]).toBe('high');
    expect(campos.find(([k]) => k === 'input_fidelity')).toBeUndefined();
  });

  it('a logo de verdade vai no canto livre, e a versão certa para o fundo', async () => {
    const fundo = await sharp({ create: { width: 1088, height: 1360, channels: 3, background: '#1a0030' } })
      .jpeg()
      .toBuffer();
    const logo = (cor: string) =>
      sharp({ create: { width: 400, height: 120, channels: 4, background: cor } })
        .png()
        .toBuffer()
        .then((b) => ({ dados: new Uint8Array(b), tipo: 'image/png' as const, nome: 'logo.png' }));
    const saida = await porLogo(
      new Uint8Array(fundo),
      { claro: await logo('#000000'), escuro: await logo('#ffffff') },
      'base-direita',
      'feed',
    );
    // Fundo escuro: entrou a logo branca (para fundo escuro), no canto de baixo à direita.
    const medir = async (left: number, top: number) =>
      sharp(await sharp(Buffer.from(saida)).extract({ left, top, width: 10, height: 10 }).toBuffer()).stats();
    const px = await medir(1088 - 65 - 40, 1360 - 65 - 50);
    expect(px.channels[0]!.mean).toBeGreaterThan(200);
    const canto = await medir(10, 10);
    expect(canto.channels[0]!.mean).toBeLessThan(60);
    // Fundo claro no canto: entra a logo escura.
    const claroFundo = await sharp({
      create: { width: 1088, height: 1360, channels: 3, background: '#fff7ef' },
    })
      .jpeg()
      .toBuffer();
    const s2 = await porLogo(
      new Uint8Array(claroFundo),
      { claro: await logo('#000000'), escuro: await logo('#ffffff') },
      'topo-esquerda',
      'feed',
    );
    const px2 = await sharp(
      await sharp(Buffer.from(s2)).extract({ left: 75, top: 100, width: 10, height: 10 }).toBuffer(),
    ).stats();
    expect(px2.channels[0]!.mean).toBeLessThan(60);
  });
});
