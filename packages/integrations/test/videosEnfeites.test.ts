import {
  juntarPropostas,
  opcoesVideoEntrada,
  type PalavraVideo,
  tempoNoOriginal,
  trechosQueFicam,
} from '@prospeccao/shared/videos';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClienteClaude } from '../src/carrosseis/claude.js';
import {
  aplicarRegras,
  argumentosDaMistura,
  type ContextoDoPedido,
  comporMusica,
  conferirImagem,
  conferirSobreposicao,
  contextoParaAEditora,
  cortesDePausa,
  cortesDeTropeco,
  type DecisaoEnfeites,
  efeitosDoVideo,
  enfeitesNaTela,
  falaDoEditado,
  ganhoDaMusica,
  gerarImagem,
  htmlDoMomento,
  lerEnfeites,
  lerPedido,
  listasDaFala,
  montarComposicao,
  montarCortes,
  noEditado,
  type Plano,
  promptDaImagem,
  promptDaMusica,
  tempoComImagens,
} from '../src/videos/index.js';

const medir = (t: string, tam: number) => t.length * tam * 0.62;
/** 100 palavras de 0,4 s: 40 s de fala. */
const palavras: PalavraVideo[] = Array.from({ length: 100 }, (_, k) => ({
  t: `p${k}`,
  i: Math.round(k * 0.4 * 100) / 100,
  f: Math.round((k * 0.4 + 0.32) * 100) / 100,
}));
const ficam = [{ inicio: 0, fim: 40 }];
const base = {
  palavras,
  ficam,
  duracaoEditado: 40,
  comTitulo: true,
  modo: 'ia' as const,
  fotos: [{ id: 7, nome: 'fachada.jpg', descricao: 'A fachada da loja' }],
  promocoes: [
    {
      id: 3,
      titulo: 'Pastilha',
      produto: 'Pastilha cerâmica',
      precoDe: 'R$ 129,90',
      precoPor: 'R$ 89,90',
      validade: 'Até sábado',
    },
  ],
};
const decisao = (d: Partial<DecisaoEnfeites>): DecisaoEnfeites => ({
  momentos: [],
  imagens: [],
  semImagem: [],
  musica: { clima: 'confiante', estilo: '' },
  ...d,
});
const img = (de: number, ate: number, extra: Partial<DecisaoEnfeites['imagens'][number]> = {}) => ({
  de,
  ate,
  motivo: 'teste',
  fotoId: null,
  gerar: 'oficina de carro',
  encaixe: 'cheia' as const,
  ...extra,
});

describe('tempo no editado e no original', () => {
  it('volta do editado para o original e encosta no próximo trecho quando cai num corte', () => {
    const f = [
      { inicio: 0, fim: 2 },
      { inicio: 5, fim: 8 },
    ];
    expect(tempoNoOriginal(1, f)).toBe(1);
    expect(tempoNoOriginal(3, f)).toBe(6);
    expect(tempoNoOriginal(9, f)).toBeNull();
    expect(noEditado(3.5, f)).toBe(2);
    expect(noEditado(6, f)).toBe(3);
  });

  it('a fala do editado só tem as palavras que ficaram, com o tempo do editado', () => {
    const f = trechosQueFicam(4, [{ inicio: 0.8, fim: 2.0, decisao: 'cortar' }]);
    const texto = falaDoEditado(palavras.slice(0, 10), f);
    expect(texto).toMatch(/^0: p0 {2}\(0\.\d s\)/);
    expect(texto).not.toContain('3: p3');
    expect(texto).toContain('5: p5');
  });
});

describe('as regras das imagens e animações', () => {
  it('nada nos 2 primeiros segundos: a imagem começa em 2 s', () => {
    const r = aplicarRegras(decisao({ imagens: [img(0, 8)] }), base);
    expect(r.imagens).toHaveLength(1);
    expect(noEditado(r.imagens[0]!.inicio, ficam)).toBeGreaterThanOrEqual(2);
    expect(r.imagens[0]!.fim - r.imagens[0]!.inicio).toBeLessThanOrEqual(4.001);
  });

  it('no máximo 30% do vídeo com imagem', () => {
    const muitas = Array.from({ length: 8 }, (_, k) => img(10 + k * 11, 10 + k * 11 + 9));
    const r = aplicarRegras(decisao({ imagens: muitas }), base);
    expect(tempoComImagens(r.imagens, ficam)).toBeLessThanOrEqual(12.01);
    expect(r.imagens.length).toBeLessThan(8);
  });

  it('a foto da empresa vale; só fotos não gera; sem imagens não põe nada', () => {
    const d = decisao({ imagens: [img(10, 14, { fotoId: 7, encaixe: 'acima' }), img(40, 45)] });
    const ia = aplicarRegras(d, base);
    expect(ia.imagens.map((i) => i.origem)).toEqual(['empresa', 'gerada']);
    expect(ia.imagens[0]!.descricao).toBe('A fachada da loja');
    expect(aplicarRegras(d, { ...base, modo: 'fotos' }).imagens.map((i) => i.origem)).toEqual(['empresa']);
    expect(aplicarRegras(d, { ...base, modo: 'nenhuma' }).imagens).toHaveLength(0);
  });

  it('foto que não existe e imagem por cima de uma animação ficam de fora', () => {
    const d = decisao({
      momentos: [{ tipo: 'selo', de: 20, ate: 24, titulo: 'dica', numero: '', itens: [], divulgarId: null }],
      imagens: [img(10, 14, { fotoId: 99, gerar: '' }), img(20, 24)],
    });
    const r = aplicarRegras(d, base);
    expect(r.momentos).toHaveLength(1);
    expect(r.momentos[0]!.titulo).toBe('DICA');
    expect(r.imagens).toHaveLength(0);
  });

  it('a oferta usa a promoção cadastrada, exatamente como foi digitada; sem promoção, sai', () => {
    const oferta = {
      tipo: 'oferta' as const,
      de: 30,
      ate: 36,
      titulo: '',
      numero: '',
      itens: [],
      divulgarId: 3,
    };
    const r = aplicarRegras(decisao({ momentos: [oferta] }), base);
    expect(r.momentos[0]!.oferta).toEqual({
      produto: 'Pastilha cerâmica',
      precoDe: 'R$ 129,90',
      precoPor: 'R$ 89,90',
      validade: 'Até sábado',
    });
    expect(aplicarRegras(decisao({ momentos: [{ ...oferta, divulgarId: 8 }] }), base).momentos).toHaveLength(
      0,
    );
  });

  it('a lista precisa de 2 itens; animações não se encostam nem invadem o título', () => {
    const lista = {
      tipo: 'lista' as const,
      de: 10,
      ate: 20,
      titulo: '3 sinais',
      numero: '',
      itens: [
        { texto: 'chiado', palavra: 12 },
        { texto: 'pedal mole', palavra: 16 },
      ],
      divulgarId: null,
    };
    const r = aplicarRegras(
      decisao({
        momentos: [
          { tipo: 'selo', de: 0, ate: 3, titulo: 'cedo', numero: '', itens: [], divulgarId: null },
          lista,
          { tipo: 'numero', de: 14, ate: 16, titulo: '', numero: '2×', itens: [], divulgarId: null },
          { ...lista, de: 50, ate: 55, itens: [{ texto: 'só um', palavra: 51 }] },
        ],
      }),
      base,
    );
    expect(r.momentos.map((m) => m.tipo)).toEqual(['lista']);
    expect(r.momentos[0]!.itens.map((i) => i.texto)).toEqual(['CHIADO', 'PEDAL MOLE']);
  });

  it('o começo entra em "onde não pôr imagem"', () => {
    const r = aplicarRegras(decisao({ semImagem: [{ de: 50, ate: 55, motivo: 'olho no olho' }] }), base);
    expect(r.semImagem.map((s) => s.motivo)).toEqual([expect.stringContaining('começo'), 'olho no olho']);
  });

  it('lerEnfeites descarta índice fora da fala e tipo desconhecido', () => {
    const d = lerEnfeites(
      {
        momentos: [
          { tipo: 'confete', de: 1, ate: 2 },
          { tipo: 'selo', de: 5, ate: 500, titulo: 'x' },
          { tipo: 'selo', de: 5, ate: 6, titulo: 'ok' },
        ],
        imagens: [{ de: 3, ate: 2, motivo: 'x', encaixe: 'cheia' }],
        sem_imagem: [],
        musica: { clima: 'jazz', estilo: 'x' },
      },
      100,
    );
    expect(d.momentos).toHaveLength(1);
    expect(d.imagens).toHaveLength(0);
    expect(d.musica.clima).toBe('confiante');
  });
});

describe('na tela', () => {
  const planos: Plano[] = [
    { inicio: 0, fim: 10, editadoIni: 0, editadoFim: 10, zoom: 1, ax: 540, ay: 1300 },
    { inicio: 12, fim: 20, editadoIni: 10, editadoFim: 18, zoom: 1, ax: 540, ay: 1300 },
  ];
  it('leva para o editado e dá a altura de cada gráfico acima da cabeça', () => {
    const r = enfeitesNaTela({
      momentos: [
        {
          id: 'm1',
          tipo: 'lista',
          inicio: 3,
          fim: 8,
          fala: '',
          usar: true,
          titulo: 'X',
          numero: '',
          itens: [
            { texto: 'A', em: 4 },
            { texto: 'B', em: 6 },
          ],
          divulgarId: null,
          oferta: null,
          manual: false,
        },
        {
          id: 'm2',
          tipo: 'destaque',
          inicio: 13,
          fim: 15,
          fala: '',
          usar: true,
          titulo: '',
          numero: '',
          itens: [],
          divulgarId: null,
          oferta: null,
          manual: false,
        },
      ],
      imagens: [
        {
          id: 'i1',
          inicio: 11,
          fim: 15,
          fala: '',
          motivo: '',
          origem: 'gerada',
          fotoId: null,
          chave: 'k',
          descricao: '',
          encaixe: 'acima',
          usar: true,
          pedido: null,
          conferencia: null,
          posta: null,
          manual: false,
          arquivo: 'assets/img-i1.jpg',
        },
      ],
      planos,
      rostos: [{ t: 11.5, caixas: [{ x0: 300, x1: 800, y0: 500, y1: 1250 }] }],
      duracao: 18,
    });
    expect(r.imagens[0]).toMatchObject({ ini: 10, fim: 13 });
    expect(r.graficos.map((g) => g.id)).toEqual(['m1', 'img:i1']);
    expect(r.momentos.find((m) => m.id === 'm2')!.ancora).toEqual({ x: 550, y: 1250 });
  });

  it('a oferta escreve o preço exato e o HTML não aceita marcação', () => {
    const h = htmlDoMomento(
      {
        id: 'm1',
        tipo: 'oferta',
        ini: 1,
        fim: 3,
        titulo: '',
        numero: '',
        itens: [],
        oferta: {
          produto: 'Pastilha <b>',
          precoDe: 'R$ 129,90',
          precoPor: 'R$ 89,90',
          validade: 'Até sábado',
        },
        ancora: null,
      },
      medir,
    );
    expect(h).toContain('por R$ 89,90');
    expect(h).toContain('de R$ 129,90');
    expect(h).toContain('Pastilha &lt;b&gt;');
  });

  it('a composição leva as imagens e as animações', () => {
    const html = montarComposicao({
      diagrama: { cartoes: [], legendas: [], transicao: 0.4 },
      estilo: 'acesa',
      marca: { primaria: '#7c3aed', destaque: '#f97316' },
      duracao: 10,
      titulo: null,
      chamada: null,
      arquivos: { video: 'v.mp4', gsap: 'g.js', fonte800: 'a', fonte900: 'b', ultimoQuadro: 'u.png' },
      momentos: [
        {
          id: 'm1',
          tipo: 'numero',
          ini: 2,
          fim: 4,
          titulo: 'MAIS',
          numero: '2×',
          itens: [],
          oferta: null,
          ancora: null,
        },
      ],
      imagens: [{ id: 'i1', ini: 5, fim: 8, arquivo: 'assets/img-i1.jpg', encaixe: 'cheia' }],
      transicao: 'deslizar',
      medir,
    });
    expect(html).toContain('id="g-m1"');
    expect(html).toContain('id="c-img-i1"');
    expect(html).toContain('assets/img-i1.jpg');
    expect(html).toContain('"deslizar":true');
  });

  it('um rosto dentro da imagem não conta como sobreposição; tela cheia não conta', () => {
    const diagrama = {
      cartoes: [{ id: 'img:i1', ini: 0, fim: 5, s: 1, tx: 0, ty: 0, topo: 220, escala: 1, altura: 590 }],
      legendas: [],
      transicao: 0.4,
    };
    const rostos = [
      { t: 1, caixas: [{ x0: 400, x1: 600, y0: 300, y1: 500 }] },
      { t: 6, caixas: [{ x0: 400, x1: 600, y0: 300, y1: 500 }] },
    ];
    expect(conferirSobreposicao(diagrama, rostos, 10).sobreposicoes).toBe(1);
    const imagens = [
      { ini: 0, fim: 5, caixa: { x0: 110, x1: 970, y0: 220, y1: 772 } },
      { ini: 5.5, fim: 7, caixa: null },
    ];
    expect(conferirSobreposicao(diagrama, rostos, 10, imagens)).toMatchObject({
      quadros: 0,
      sobreposicoes: 0,
    });
  });
});

describe('som', () => {
  it('efeitos com id estável: cada item da lista, número, imagem, título e chamada', () => {
    const e = efeitosDoVideo({
      titulo: true,
      momentos: [
        { id: 'm1', tipo: 'lista', ini: 3, itens: [{ em: 3.5 }, { em: 5 }] },
        { id: 'm2', tipo: 'numero', ini: 7, itens: [] },
      ],
      imagens: [{ id: 'i1', ini: 9, posta: 'cheia' }],
      chamadaEm: 12.4,
    });
    expect(e.map((x) => x.id)).toEqual(['titulo', 'm1:0', 'm1:1', 'm2', 'img:i1', 'chamada']);
    expect(e.map((x) => x.tipo)).toEqual(['sopro', 'tique', 'tique', 'sopro', 'sopro', 'estalo']);
  });

  it('a mistura baixa a música pela voz e põe cada efeito no instante certo', () => {
    const a = argumentosDaMistura({
      pronto: 'p.mp4',
      saida: 's.mp4',
      total: 20,
      musica: { arquivo: 'm.mp3', volume: 40 },
      efeitos: [{ arquivo: 'tique.wav', em: 3.25, ganho: 0.3 }],
    });
    const filtro = a[a.indexOf('-filter_complex') + 1]!;
    expect(filtro).toContain('sidechaincompress');
    // Nivelada e uns 10 dB abaixo da voz no padrão, já contando o abaixa-música (leve, 2:1).
    expect(filtro).toContain('loudnorm=I=-16');
    expect(filtro).toContain('volume=0.720');
    expect(filtro).toContain('ratio=2');
    expect(ganhoDaMusica(35)).toBeCloseTo(0.63, 3);
    expect(ganhoDaMusica(0)).toBe(0);
    expect(ganhoDaMusica(100)).toBe(1.4);
    expect(filtro).toContain('adelay=3250:all=1');
    expect(filtro).toContain('amix=inputs=3');
    expect(a).toContain('copy');
    const so = argumentosDaMistura({ pronto: 'p', saida: 's', total: 5, musica: null, efeitos: [] });
    expect(so[so.indexOf('-filter_complex') + 1]).toContain('anullsink');
  });

  it('o pedido de música é sempre instrumental e usa a descrição da pessoa quando há', () => {
    expect(promptDaMusica('calma', '')).toContain('piano');
    expect(promptDaMusica('calma', 'rock leve com guitarra')).toContain('rock leve com guitarra');
    expect(promptDaMusica('animada', '')).toContain('Instrumental only');
  });

  afterEach(() => vi.unstubAllGlobals());

  it('compõe pela ElevenLabs; pedido recusado não tenta de novo', async () => {
    const chamadas: { url: string; corpo: Record<string, unknown> }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      chamadas.push({ url, corpo: JSON.parse(String(init.body)) });
      return chamadas.length === 1
        ? new Response(new Uint8Array([1, 2, 3]), { status: 200 })
        : new Response('{"detail":{"status":"bad_prompt"}}', { status: 400 });
    });
    const mp3 = await comporMusica(
      { chave: 'x' },
      { clima: 'confiante', descricao: '', estilo: '', segundos: 31.2 },
    );
    expect([...mp3]).toEqual([1, 2, 3]);
    expect(chamadas[0]!.url).toContain('output_format=mp3_44100_128');
    expect(chamadas[0]!.corpo).toMatchObject({ music_length_ms: 31_200, force_instrumental: true });
    await expect(
      comporMusica(
        { chave: 'x' },
        { clima: 'confiante', descricao: 'como a banda X', estilo: '', segundos: 10 },
      ),
    ).rejects.toMatchObject({ repetivel: false, detalhes: { pedidoRecusado: true } });
  });

  it('ElevenLabs ocupada (429) espera e tenta de novo; sem plano pago (402) não repete', async () => {
    let n = 0;
    vi.stubGlobal('fetch', async () => {
      n++;
      return n < 3
        ? new Response('{"detail":{"code":"system_busy"}}', { status: 429 })
        : new Response(new Uint8Array([9]), { status: 200 });
    });
    const e = { clima: 'confiante' as const, descricao: '', estilo: '', segundos: 12 };
    expect([...(await comporMusica({ chave: 'x' }, e, [1, 1, 1]))]).toEqual([9]);
    expect(n).toBe(3);
    n = 0;
    vi.stubGlobal('fetch', async () => {
      n++;
      return new Response('{"detail":{"code":"paid_plan_required"}}', { status: 402 });
    });
    await expect(comporMusica({ chave: 'x' }, e, [1, 1, 1])).rejects.toMatchObject({ repetivel: false });
    expect(n).toBe(1);
  });
});

describe('imagens', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('o pedido proíbe texto e marca; pessoas podem, menos famosa e criança (v156)', () => {
    const p = promptDaImagem('oficina de carro', 'cheia');
    expect(p).toContain('vertical');
    expect(p).toMatch(/texto/);
    expect(p).toMatch(/logotipo/);
    expect(p).toMatch(/Pessoas podem aparecer/);
    expect(p).toMatch(/Nunca uma pessoa real ou famosa, nunca crianças/);
    expect(p).not.toMatch(/Sem rosto/);
  });

  it('gera pelo GPT Image 2 em qualidade média, no tamanho do encaixe', async () => {
    let corpo: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      corpo = JSON.parse(String(init.body));
      return Response.json({ data: [{ b64_json: Buffer.from('jpeg').toString('base64') }] });
    });
    const r = await gerarImagem(
      { chave: 'x', modelo: 'gpt-image-2' },
      { descricao: 'estrada', formato: 'cheia' },
    );
    expect(Buffer.from(r).toString()).toBe('jpeg');
    expect(corpo).toMatchObject({
      model: 'gpt-image-2',
      quality: 'medium',
      size: '1088x1920',
      output_format: 'jpeg',
    });
  });

  it('limite da OpenAI dá para tentar de novo; recusa não', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ error: { message: 'devagar' } }, { status: 429 }));
    await expect(
      gerarImagem({ chave: 'x', modelo: 'm' }, { descricao: 'a', formato: 'acima' }),
    ).rejects.toMatchObject({
      repetivel: true,
    });
    vi.stubGlobal('fetch', async () =>
      Response.json({ error: { message: 'não', code: 'moderation' } }, { status: 400 }),
    );
    await expect(
      gerarImagem({ chave: 'x', modelo: 'm' }, { descricao: 'a', formato: 'acima' }),
    ).rejects.toMatchObject({
      repetivel: false,
    });
  });

  it('a conferência reprova texto ou marca, mesmo que o modelo esqueça de explicar', async () => {
    const claude = (dados: Record<string, unknown>): ClienteClaude => ({
      modelo: 'x',
      async pedir() {
        return { dados, uso: { entrada: 0, saida: 0, cacheEscrita: 0, cacheLeitura: 0 }, custoUsd: 0 };
      },
    });
    const ok = {
      tem_texto: false,
      tem_marca: false,
      pessoa_com_defeito: false,
      pessoa_conhecida: false,
      defeito: false,
      combina: true,
      problemas: [],
    };
    expect(await conferirImagem(claude(ok), { jpeg: new Uint8Array([1]), descricao: 'x' })).toEqual({
      aprovada: true,
      problemas: [],
    });
    const r = await conferirImagem(claude({ ...ok, tem_texto: true }), {
      jpeg: new Uint8Array([1]),
      descricao: 'x',
    });
    expect(r.aprovada).toBe(false);
    expect(r.problemas[0]).toContain('texto');
  });
});

describe('opções', () => {
  it('vídeo antigo ganha os padrões novos sem quebrar', () => {
    const o = opcoesVideoEntrada.parse({ estilo: 'simples', transicao: 'seco' });
    expect(o).toMatchObject({ imagens: 'ia', musica: 'ia', efeitos: true, transicao: 'seco' });
  });
});

describe('v138: biblioteca de efeitos (ElevenLabs Sound Effects)', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('pede cada efeito curto e sutil, com o modelo v2; o título entra com sopro, não subida', async () => {
    const { gerarEfeito, BIBLIOTECA_EFEITOS, GANHO_EFEITO } = await import('../src/videos/som.js');
    const corpos: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      expect(url).toContain('/v1/sound-generation');
      corpos.push(JSON.parse(String(init.body)));
      return new Response(new Uint8Array([7]), { status: 200 });
    });
    expect([...(await gerarEfeito({ chave: 'x' }, BIBLIOTECA_EFEITOS.sopro))]).toEqual([7]);
    expect(corpos[0]).toMatchObject({ model_id: 'eleven_text_to_sound_v2', duration_seconds: 0.8 });
    expect(String(corpos[0]!.text)).toMatch(/subtle/i);
    expect(Math.max(...Object.values(GANHO_EFEITO))).toBeLessThanOrEqual(0.16);
  });
});

/* ───────────────────────────── v160 ───────────────────────────── */

const fala = (texto: string, passo = 0.4): PalavraVideo[] =>
  texto.split(' ').map((t, k) => ({
    t,
    i: Math.round(k * passo * 100) / 100,
    f: Math.round((k * passo + passo * 0.8) * 100) / 100,
  }));

describe('v160: tropeços de fala que o código acha', () => {
  it('tira a palavra pela metade e a expressão repetida, sem mexer em ênfase nem em palavra curta', () => {
    const p = fala('a gente a gente faz entre- entrega de moto motorista muito muito bom de dezembro');
    const c = cortesDeTropeco(p, 10);
    expect(c.map((x) => x.trecho)).toEqual(['a gente', 'entre-', 'moto']);
    expect(c.map((x) => x.duvida)).toEqual([false, false, true]);
    expect(c.every((x) => x.tipo === 'recomeco')).toBe(true);
  });
  it('entra na lista final de cortes sem duplicar o que a IA já tirou', () => {
    const p = fala('oi para o para o cliente chega rápido');
    const d = {
      inicio: 0,
      fim: p.length - 1,
      motivoInicio: '',
      motivoFim: '',
      cortes: [],
      fortes: [],
      titulo: '',
    };
    const cortes = montarCortes(p, [], d, 'dinamico', 4);
    expect(cortes.filter((c) => c.tipo === 'recomeco').map((c) => c.trecho)).toEqual(['para o']);
    expect(montarCortes(p, [], d, 'pausas', 4).some((c) => c.tipo === 'recomeco')).toBe(false);
  });
  it('pausa curta já é encurtada no ritmo dinâmico', () => {
    expect(cortesDePausa([{ inicio: 2, fim: 2.24 }], 'dinamico', 10)).toHaveLength(1);
    expect(cortesDePausa([{ inicio: 2, fim: 2.24 }], 'natural', 10)).toHaveLength(0);
  });
});

describe('v160: enumeração vira gráfico', () => {
  const p = fala(
    'aqui você aluga sem taxa, sem fidelidade e sem burocracia nenhuma, fala com a gente hoje mesmo pelo zap',
  );
  const f = [{ inicio: 0, fim: 9 }];
  it('acha "sem X, sem Y, sem Z" e "primeiro, segundo" só pelas palavras', () => {
    const l = listasDaFala(p, f);
    expect(l).toHaveLength(1);
    expect(l[0]!.tipo).toBe('nomes');
    expect(l[0]!.itens.map((i) => i.texto)).toEqual(['sem taxa', 'sem fidelidade', 'sem burocracia']);
    const o = listasDaFala(
      fala('primeiro você chama no zap, segundo a gente separa a peça, terceiro o motoboy leva'),
      [{ inicio: 0, fim: 9 }],
    );
    expect(o[0]!.itens).toHaveLength(3);
    expect(o[0]!.tipo).toBe('lista');
  });
  it('entra mesmo quando a IA só propôs um selo ali, e não entra quando ela já fez a lista', () => {
    const selo = {
      tipo: 'selo' as const,
      de: 3,
      ate: 5,
      titulo: 'SEM TAXA',
      numero: '',
      itens: [],
      divulgarId: null,
    };
    const r = aplicarRegras(decisao({ momentos: [selo] }), {
      ...base,
      palavras: p,
      ficam: f,
      duracaoEditado: 9,
      comTitulo: false,
    });
    expect(r.momentos.map((m) => m.tipo)).toEqual(['nomes']);
    expect(r.momentos[0]!.itens.map((i) => i.texto)).toEqual(
      ['SEM TAXA', 'SEM FIDELIDADE', 'SEM BUROCRACIA'].slice(0, 3),
    );
    const lista = {
      ...selo,
      tipo: 'lista' as const,
      titulo: '',
      itens: [
        { texto: 'Sem taxa', palavra: 3 },
        { texto: 'Sem fidelidade', palavra: 5 },
      ],
    };
    const r2 = aplicarRegras(decisao({ momentos: [lista] }), {
      ...base,
      palavras: p,
      ficam: f,
      duracaoEditado: 9,
      comTitulo: false,
    });
    expect(r2.momentos.map((m) => m.tipo)).toEqual(['lista']);
  });
  it('nome comprido vira lista; compara e troca levam exatamente dois itens', () => {
    const m = (tipo: 'nomes' | 'compara' | 'troca', textos: string[]) => ({
      tipo,
      de: 10,
      ate: 20,
      titulo: 'X',
      numero: '',
      itens: textos.map((texto, n) => ({ texto, palavra: 10 + n * 3 })),
      divulgarId: null,
    });
    const r = aplicarRegras(
      decisao({
        momentos: [
          m('nomes', ['Entrega no mesmo dia garantida', 'Salvador']),
          {
            ...m('compara', ['Antes', 'Agora', 'Sobra']),
            de: 40,
            ate: 50,
            itens: [40, 43, 46].map((k, n) => ({ texto: ['Antes', 'Agora', 'Sobra'][n]!, palavra: k })),
          },
          { ...m('troca', ['Gasto']), de: 70, ate: 75, itens: [{ texto: 'Gasto', palavra: 70 }] },
        ],
      }),
      base,
    );
    expect(r.momentos.map((x) => [x.tipo, x.itens.length, x.titulo])).toEqual([
      ['lista', 2, 'X'],
      ['compara', 2, ''],
    ]);
  });
  it('desenha os três tipos novos e dá som a cada entrada', () => {
    const tela = (tipo: 'nomes' | 'compara' | 'troca', textos: string[]) => ({
      id: 'm1',
      tipo,
      ini: 3,
      fim: 7,
      titulo: '',
      numero: '',
      itens: textos.map((texto, n) => ({ texto, em: 3.5 + n })),
      oferta: null,
      ancora: null,
    });
    expect(
      htmlDoMomento(tela('nomes', ['SALVADOR', 'RECIFE', 'NATAL']), medir).match(/class="nome"/g),
    ).toHaveLength(3);
    expect(htmlDoMomento(tela('compara', ['ANTES', 'AGORA']), medir)).toContain('class="lado depois"');
    expect(htmlDoMomento(tela('troca', ['GASTO', 'INVESTIMENTO']), medir)).toContain('class="risco"');
    const sons = efeitosDoVideo({
      titulo: false,
      momentos: [tela('nomes', ['A', 'B', 'C']), { ...tela('troca', ['A', 'B']), id: 'm2' }],
      imagens: [],
      chamadaEm: null,
    });
    expect(sons.map((s) => s.id)).toEqual(
      ['m1:0', 'm2', 'm1:1', 'm2:1', 'm1:2'].sort(
        (a, b) => sons.findIndex((s) => s.id === a) - sons.findIndex((s) => s.id === b),
      ),
    );
    expect(sons).toHaveLength(5);
  });
});

describe('v161: peça à editora', () => {
  const p = fala('oi a gente a gente atende Salvador Recife e Natal com entrega rápida todo dia');
  const corte = {
    id: 'c1',
    inicio: 0.38,
    fim: 1.18,
    tipo: 'manual' as const,
    motivo: '',
    trecho: 'a gente',
    duvida: false,
    decisao: 'cortar' as const,
    conferido: true,
  };
  const ctx = (extra: Partial<ContextoDoPedido> = {}): ContextoDoPedido => ({
    palavras: p,
    cortes: [],
    ficam: [{ inicio: 0, fim: 6 }],
    animacoes: {
      titulo: { usar: true, texto: 'T' },
      chamada: { usar: true, tipo: 'comente', palavra: 'MOTO', texto: '' },
      momentos: [
        {
          id: 'm1',
          tipo: 'lista',
          inicio: 2,
          fim: 4,
          fala: '',
          usar: true,
          titulo: 'ONDE',
          numero: '',
          itens: [
            { texto: 'A', em: 2 },
            { texto: 'B', em: 3 },
          ],
          divulgarId: null,
          oferta: null,
          manual: false,
        },
      ],
    },
    som: {
      musica: {
        usar: false,
        clima: 'confiante',
        descricao: '',
        estiloIa: '',
        volume: 35,
        chave: null,
        segundos: null,
        pedirOutra: false,
        erro: null,
      },
      efeitos: { ligados: true, desligados: [], lista: [] },
    },
    estilo: 'acesa',
    musicaLiberada: false,
    ...extra,
  });
  it('monta cada mudança no formato da revisão e descarta o que não fecha', () => {
    const r = lerPedido(
      {
        resposta: 'Pronto.',
        mudancas: [
          { acao: 'cortar', resumo: 'Tirar o repetido', de: 1, ate: 2 },
          {
            acao: 'editar_animacao',
            resumo: 'Trocar os itens',
            animacao_id: 'm1',
            itens: [{ texto: 'Salvador' }, { texto: 'Recife' }],
          },
          {
            acao: 'editar_animacao',
            resumo: 'Quantidade errada',
            animacao_id: 'm1',
            itens: [{ texto: 'Um só' }],
          },
          {
            acao: 'nova_animacao',
            resumo: 'Nome comprido vira lista',
            tipo: 'nomes',
            de: 5,
            ate: 8,
            itens: [
              { texto: 'Salvador e região metropolitana', palavra: 5 },
              { texto: 'Recife', palavra: 6 },
            ],
          },
          {
            acao: 'nova_animacao',
            resumo: 'Comparação com um lado só',
            tipo: 'compara',
            de: 5,
            ate: 8,
            itens: [{ texto: 'Antes', palavra: 5 }],
          },
          { acao: 'musica', resumo: 'Ligar a música', usar: true },
          { acao: 'musica', resumo: 'Volume', volume: 250 },
          { acao: 'chamada', resumo: 'Frase da chamada', texto: 'Chama no zap' },
          { acao: 'legenda', resumo: 'Corrigir palavra', de: 6, texto: 'Salvador' },
          { acao: 'legenda', resumo: 'Corrigir palavra', de: 6, texto: 'Salvadô' },
          { acao: 'estilo_legenda', resumo: 'Mesmo estilo', estilo: 'acesa' },
        ],
      },
      ctx(),
    );
    expect(r.propostas.map((x) => x.titulo)).toEqual([
      'Tirar o repetido',
      'Trocar os itens',
      'Nome comprido vira lista',
      'Volume',
      'Frase da chamada',
      'Corrigir palavra',
    ]);
    expect(r.propostas[0]!.revisao.trechos![0]).toMatchObject({ acao: 'cortar', inicio: 0.38, fim: 1.16 });
    expect(r.propostas[1]!.revisao.momentos![0]).toEqual({
      id: 'm1',
      usar: true,
      itens: ['Salvador', 'Recife'],
    });
    expect(r.propostas[2]!.revisao.novosMomentos![0]!.tipo).toBe('lista');
    expect(r.propostas[3]!.revisao.musica).toEqual({ volume: 100 });
    expect(r.propostas[4]!.revisao.chamada).toEqual({
      usar: true,
      tipo: 'comente',
      palavra: 'MOTO',
      texto: 'Chama no zap',
    });
    expect(r.propostas[5]!.revisao.palavras).toEqual([{ indice: 6, texto: 'Salvadô' }]);
    expect(juntarPropostas(r.propostas).momentos).toHaveLength(1);
  });
  it('devolve só o que está cortado e conta o contexto para a IA', () => {
    const c = ctx({
      cortes: [corte],
      ficam: [
        { inicio: 0, fim: 0.38 },
        { inicio: 1.18, fim: 6 },
      ],
    });
    const r = lerPedido(
      {
        resposta: '',
        mudancas: [
          { acao: 'devolver', resumo: 'Devolver', de: 0, ate: 4 },
          { acao: 'cortar', resumo: 'Já cortado', de: 1, ate: 2 },
        ],
      },
      c,
    );
    expect(r.propostas).toHaveLength(1);
    expect(r.propostas[0]!.revisao.trechos![0]!.acao).toBe('devolver');
    expect(r.resposta).toContain('Marque');
    const texto = contextoParaAEditora(c, {
      texto: 'devolve',
      em: 1.5,
      historico: [{ de: 'voce', texto: 'oi' }],
    });
    expect(texto).toContain('1: a  (CORTADA)');
    expect(texto).toContain('id m1: Lista que se marca');
    expect(texto).toContain('não está liberada');
    expect(texto).toContain('Pessoa: oi');
    expect(
      lerPedido({ resposta: 'Qual trecho?', opcoes: ['O começo', 'O fim'], mudancas: [] }, c),
    ).toMatchObject({ resposta: 'Qual trecho?', opcoes: ['O começo', 'O fim'], propostas: [] });
  });
});
