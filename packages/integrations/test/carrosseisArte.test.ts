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

describe('v152: peça em camadas, imagens e Claude', () => {
  it('apara o recorte e reprova quando o fundo não saiu ou o assunto sumiu', async () => {
    const { apararRecorte, avaliarRecorte } = await import('../src/carrosseis/camadas.js');
    const sharp = (await import('sharp')).default;
    const svg = (corpo: string) =>
      sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600">${corpo}</svg>`))
        .png()
        .toBuffer();
    const bom = await apararRecorte(
      new Uint8Array(await svg('<rect x="100" y="150" width="200" height="400" fill="#c00"/>')),
    );
    expect(bom).toMatchObject({ largura: 200, altura: 400 });
    expect(bom!.transparente).toBeGreaterThan(0.6);
    // Fundo inteiro pintado (a IA não tirou o fundo) e imagem quase vazia: reprovam.
    expect(
      await apararRecorte(new Uint8Array(await svg('<rect width="400" height="600" fill="#fff"/>'))),
    ).toBeNull();
    expect(
      await apararRecorte(
        new Uint8Array(await svg('<rect x="0" y="0" width="20" height="20" fill="#c00"/>')),
      ),
    ).toBeNull();
    const ok = {
      assunto_igual: true,
      inteiro: true,
      fundo_limpo: true,
      defeito: false,
      texto_novo: false,
      isolavel: true,
      problemas: [],
    };
    expect(avaliarRecorte(ok).aprovada).toBe(true);
    expect(avaliarRecorte({ ...ok, isolavel: false }).aprovada).toBe(false);
    expect(avaliarRecorte({ ...ok, assunto_igual: false }).problemas.length).toBeGreaterThan(0);
  });

  it('imagem: família nova aceita transparente e xhigh; uso vira custo; moderação não repete', async () => {
    const im = await import('../src/videos/imagens.js');
    expect(im.aceitaTransparente('gpt-image-2.6-sunburst')).toBe(true);
    expect(im.aceitaTransparente('gpt-image-2')).toBe(false);
    expect(im.qualidadeDoModelo('gpt-image-2', 'max')).toBe('high');
    expect(im.qualidadeDoModelo('gpt-image-2.6-flare', 'max')).toBe('max');
    expect(
      im.lerUso('gpt-image-2.6-sunburst', {
        input_tokens: 1200,
        output_tokens: 6000,
        input_tokens_details: { text_tokens: 200, image_tokens: 1000 },
      })?.usd,
    ).toBeCloseTo(0.189, 3);
    expect(im.lerUso('gpt-image-2', { output_tokens: 6000 })?.usd).toBeNull();
    const corpos: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
      const c = JSON.parse(String(init.body));
      corpos.push(c);
      // O modelo novo ainda não existe na conta: cai no de reserva.
      if (c.model !== 'gpt-image-2')
        return new Response(JSON.stringify({ error: { code: 'model_not_found', message: 'x' } }), {
          status: 404,
        });
      return new Response(JSON.stringify({ data: [{ b64_json: 'AAAA' }], usage: { output_tokens: 10 } }), {
        status: 200,
      });
    });
    const dados = await im.pedirImagem(
      { chave: 'x', modelo: 'gpt-image-2.6-sunburst', qualidade: 'max' },
      { prompt: 'p', largura: 1088, altura: 1360 },
    );
    expect(corpos.map((c) => [c.model, c.quality])).toEqual([
      ['gpt-image-2.6-sunburst', 'max'],
      ['gpt-image-2', 'high'],
    ]);
    expect(im.usoDaImagem(dados)).toMatchObject({ saida: 10, usd: null });
    await expect(
      im.pedirImagem(
        { chave: 'x', modelo: 'gpt-image-2' },
        { prompt: 'p', largura: 1024, altura: 1536, transparente: true },
      ),
    ).rejects.toMatchObject({ codigo: 'sem_transparencia' });
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ error: { code: 'moderation_blocked', message: 'no' } }), {
          status: 400,
        }),
    );
    await expect(
      im.pedirImagem({ chave: 'x', modelo: 'gpt-image-2' }, { prompt: 'p', largura: 1024, altura: 1536 }),
    ).rejects.toMatchObject({ codigo: 'imagem_recusada', repetivel: false });
    vi.unstubAllGlobals();
  });

  it('Claude: ferramenta estrita, esforço por agente e a volta ao jeito antigo quando o esquema é recusado', async () => {
    const { criarClaude, custoUsd, esquemaEstrito, pensamentoDo } = await import(
      '../src/carrosseis/claude.js'
    );
    expect(
      esquemaEstrito({
        type: 'object',
        properties: { a: { type: 'array', items: { type: 'object', properties: {} } } },
      }),
    ).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: {
        a: { type: 'array', items: { type: 'object', properties: {}, additionalProperties: false } },
      },
    });
    expect(pensamentoDo('claude-sonnet-5-5', 'alto')).toEqual({
      thinking: { type: 'between_tools' },
      output_config: { effort: 'high' },
    });
    // Ler do cache no Sonnet 5.5: US$ 0,10 por milhão.
    expect(
      custoUsd('claude-sonnet-5-5', { entrada: 0, saida: 0, cacheEscrita: 0, cacheLeitura: 1e6 }),
    ).toBeCloseTo(0.1, 6);
    const corpos: { tools: { strict?: boolean }[] }[] = [];
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
      const c = JSON.parse(String(init.body));
      corpos.push(c);
      if (c.tools[0].strict) return new Response('{"error":{"message":"schema"}}', { status: 400 });
      return new Response(
        JSON.stringify({
          content: [{ type: 'tool_use', name: 'so_teste_v152', input: { ok: true } }],
          usage: {},
        }),
        { status: 200 },
      );
    });
    const c = criarClaude({ chave: 'x'.repeat(30), modelo: 'claude-sonnet-5-5' });
    const pedido = {
      agente: 't',
      sistema: [{ texto: 's' }],
      mensagem: 'm',
      ferramenta: {
        nome: 'so_teste_v152',
        descricao: 'd',
        esquema: { type: 'object', properties: { ok: { type: 'boolean' } } },
      },
    };
    expect((await c.pedir(pedido)).dados).toEqual({ ok: true });
    expect(corpos.map((x) => !!x.tools[0]!.strict)).toEqual([true, false]);
    await c.pedir(pedido);
    expect(corpos.length).toBe(3);
    vi.unstubAllGlobals();
  });

  it('música: as partes somam o vídeo, cada uma com 3 s ou mais, e o plano recusado cai na faixa única', async () => {
    const som = await import('../src/videos/som.js');
    const p = som.partesDaMusica({ total: 42, ofertaEm: 24, chamadaEm: 35 });
    expect(p.map((x) => x.nome)).toEqual(['gancho', 'explicacao', 'oferta', 'chamada']);
    expect(p.reduce((s, x) => s + x.segundos, 0)).toBe(42);
    expect(som.partesDaMusica({ total: 10 })).toEqual([]);
    for (const total of [14, 30, 95, 180])
      for (const x of som.partesDaMusica({ total, ofertaEm: total / 2, chamadaEm: total - 2 })) {
        expect(x.segundos).toBeGreaterThanOrEqual(3);
        expect(x.segundos).toBeLessThanOrEqual(120);
      }
    expect(som.partesDaMusica({ total: 180 }).reduce((s, x) => s + x.segundos, 0)).toBe(180);
    const corpos: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
      const c = JSON.parse(String(init.body));
      corpos.push(c);
      return c.composition_plan
        ? new Response('{"detail":{"status":"bad_composition_plan"}}', { status: 422 })
        : new Response(new Uint8Array([7]), { status: 200 });
    });
    const mp3 = await som.comporMusica(
      { chave: 'x' },
      { clima: 'confiante', descricao: '', estilo: '', segundos: 42, partes: p },
      [1],
    );
    expect([...mp3]).toEqual([7]);
    expect(corpos[0]).toMatchObject({ model_id: 'music_v2_5' });
    expect((corpos[0]!.composition_plan as { chunks: unknown[] }).chunks).toHaveLength(4);
    expect(corpos[1]).toMatchObject({
      model_id: 'music_v2_5',
      music_length_ms: 42_000,
      force_instrumental: true,
    });
    vi.unstubAllGlobals();
  });

  it('v153: o sharp nunca é importado no topo (o worker-videos empacota este pacote e não tem o sharp)', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    for (const pasta of ['carrosseis', 'videos', 'saber']) {
      const dir = new URL(`../src/${pasta}/`, import.meta.url);
      for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts')))
        expect(readFileSync(new URL(f, dir), 'utf8'), `${pasta}/${f}`).not.toMatch(/^import .*from 'sharp'/m);
    }
  });

  it('v153: notas das opções (a preferida é a maior) e o pedido do elemento em 3D', async () => {
    const c = await import('../src/carrosseis/camadas.js');
    const notas = c.lerNotasDasOpcoes(
      {
        opcoes: [
          { opcao: 2, nota: 4.64, comentario: ' b ' },
          { opcao: 1, nota: 9, comentario: 'a' },
        ],
      },
      2,
    );
    expect(notas).toEqual([
      { nota: 5, comentario: 'a' },
      { nota: 4.6, comentario: 'b' },
    ]);
    expect(c.opcaoPreferida(notas!)).toBe(0);
    expect(c.lerNotasDasOpcoes({ opcoes: [{ opcao: 1, nota: 4, comentario: '' }] }, 2)).toBeNull();
    const p = c.promptDoElemento('a car brake disc', '#FACC15');
    expect(p).toContain('a car brake disc');
    expect(p).toContain('#FACC15');
    expect(p).toContain('transparent background');
  });
});
