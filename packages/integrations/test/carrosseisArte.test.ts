import { IDENTIDADE_PADRAO, slideNovo } from '@prospeccao/shared/carrosseis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { avaliarArte, desenharArte, promptDaArte, textoDaArte } from '../src/carrosseis/arte.js';

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
const base = {
  empresa: 'Tutts',
  identidade,
  formato: 'feed' as const,
  slide,
  objetivo: 'Promoção',
  temLogo: true,
  fotos: 1,
  posts: 2,
};

describe('v150: a arte da IA', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('o pedido leva o texto exato, as cores da marca, a logo e as referências na ordem', () => {
    const p = promptDaArte(base);
    expect(p).toContain('"A moto fica com você"');
    expect(p).toContain('"24 meses"');
    expect(p).toContain('"Chame no WhatsApp"');
    expect(p).toContain('"fica com você"');
    expect(p).not.toContain('*');
    expect(p).toContain('#3D0A5C');
    expect(p).toContain('#F07A12');
    expect(p).toContain('A imagem 1 é a LOGO');
    expect(p).toContain('A imagem 2 é uma foto');
    expect(p).toContain('As imagens 3, 4 são posts');
    expect(p).toContain('motoboy recortado');
    const story = promptDaArte({ ...base, formato: 'story', temLogo: false, fotos: 0, posts: 0 });
    expect(story).toContain('9:16');
    expect(story).toContain('13% de cima');
    expect(story).toContain('Escreva o nome "Tutts"');
    expect(promptDaArte({ ...base, corrigir: ['Faltou o botão.'] })).toContain('Faltou o botão.');
  });

  const lidoCerto = {
    textos: [
      'tutts',
      'PLANO CONQUISTA',
      '24 MESES',
      'A moto fica',
      'com você',
      'Paga por semana, com',
      'manutenção inclusa.',
      'Chame no WhatsApp',
    ],
    logo_da_marca: true,
    outra_marca: false,
    defeito: false,
    legivel: true,
    nota: 4,
    problemas: [],
  };

  it('aprova quando todo o texto está lá, mesmo quebrado em linhas e em caixa alta', () => {
    const r = avaliarArte(textoDaArte(slide), lidoCerto, { temLogo: true, empresa: 'Tutts' });
    expect(r).toMatchObject({ aprovada: true, problemas: [] });
  });

  it('reprova palavra faltando, acento errado, número inventado, logo faltando e nota baixa', () => {
    const esperado = textoDaArte(slide);
    const o = { temLogo: true, empresa: 'Tutts' };
    const semBotao = avaliarArte(esperado, { ...lidoCerto, textos: lidoCerto.textos.slice(0, -1) }, o);
    expect(semBotao.aprovada).toBe(false);
    expect(semBotao.problemas[0]).toContain('o botão');
    const semAcento = avaliarArte(
      esperado,
      { ...lidoCerto, textos: lidoCerto.textos.map((t) => t.replace('você', 'voce')) },
      o,
    );
    expect(semAcento.aprovada).toBe(false);
    const preco = avaliarArte(esperado, { ...lidoCerto, textos: [...lidoCerto.textos, 'R$ 199'] }, o);
    expect(preco.aprovada).toBe(false);
    expect(preco.problemas.join(' ')).toContain('199');
    expect(avaliarArte(esperado, { ...lidoCerto, logo_da_marca: false }, o).aprovada).toBe(false);
    expect(avaliarArte(esperado, { ...lidoCerto, nota: 2 }, o).aprovada).toBe(false);
    expect(avaliarArte(esperado, { ...lidoCerto, outra_marca: true }, o).aprovada).toBe(false);
    // Sem logo enviada, não cobra a logo.
    expect(
      avaliarArte(esperado, { ...lidoCerto, logo_da_marca: false }, { ...o, temLogo: false }).aprovada,
    ).toBe(true);
  });

  it('manda a logo, a foto e os posts juntos numa edição só', async () => {
    let campos: [string, unknown][] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      campos = [...(init.body as FormData).entries()];
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('jpeg').toString('base64') }] }), {
        status: 200,
      });
    });
    const img = (nome: string) => ({ dados: new Uint8Array([1, 2, 3]), tipo: 'image/png' as const, nome });
    const r = await desenharArte(
      { chave: 'k', modelo: 'gpt-image-2', qualidade: 'high', urlEdicao: 'https://img.test/edit' },
      { ...base, referencias: [img('logo.png'), img('foto-1.jpg'), img('post-1.jpg'), img('post-2.jpg')] },
    );
    expect(Buffer.from(r).toString()).toBe('jpeg');
    expect(campos.filter(([k]) => k === 'image[]')).toHaveLength(4);
    expect(campos.find(([k]) => k === 'quality')?.[1]).toBe('high');
    expect(campos.find(([k]) => k === 'size')?.[1]).toBe('1088x1360');
  });
});
