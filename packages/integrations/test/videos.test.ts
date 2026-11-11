import type { PalavraVideo } from '@prospeccao/shared/videos';
import { trechosQueFicam } from '@prospeccao/shared/videos';
import { describe, expect, it } from 'vitest';
import {
  aplicarVocabulario,
  blocosDaLegenda,
  conferirJuncoes,
  conferirSobreposicao,
  cortesDePausa,
  decisaoPelasRegras,
  diagramar,
  falaNumerada,
  lerDecisao,
  lerPalavras,
  montarComposicao,
  montarCortes,
  palavrasNoEditado,
  partirBlocos,
  planosDoVideo,
  type QuadroRosto,
  recorteDoPlano,
  rostosNoEditado,
  silencios,
  tituloEmLinhas,
} from '../src/videos/index.js';

/** Régua de mentira: cada letra vale 0,62 do tamanho. */
const medir = (t: string, tam: number) => t.length * tam * 0.62;

const fala = (texto: string, passo = 0.4): PalavraVideo[] =>
  texto.split(' ').map((t, k) => ({
    t,
    i: Math.round(k * passo * 100) / 100,
    f: Math.round((k * passo + passo * 0.8) * 100) / 100,
  }));

/** Um rosto parado: cabeça de 400 a 1400 px. */
const rostoParado = (ate: number, caixa = { x0: 260, x1: 860, y0: 400, y1: 1400 }): QuadroRosto[] =>
  Array.from({ length: Math.ceil(ate * 6) + 1 }, (_, k) => ({ t: k / 6, caixas: [caixa] }));

describe('silêncios e pausas', () => {
  it('acha o silêncio do áudio pela energia, não pelo texto', () => {
    const taxa = 16_000;
    const pcm = new Int16Array(taxa * 3);
    // fala (ruído alto) 0–1 s, silêncio 1–1,8 s, fala 1,8–3 s.
    for (let k = 0; k < pcm.length; k++) {
      const t = k / taxa;
      pcm[k] = t < 1 || t >= 1.8 ? Math.round(Math.sin(k * 0.3) * 9000) : Math.round(Math.sin(k) * 40);
    }
    const s = silencios(pcm, taxa);
    expect(s).toHaveLength(1);
    expect(s[0]!.inicio).toBeCloseTo(1, 1);
    expect(s[0]!.fim).toBeCloseTo(1.8, 1);
  });

  it('encurta a pausa até a respiração do ritmo e ignora o começo e o fim', () => {
    const cortes = cortesDePausa(
      [
        { inicio: 0, fim: 0.9 },
        { inicio: 4, fim: 4.8 },
        { inicio: 7, fim: 7.2 },
        { inicio: 9, fim: 10 },
      ],
      'dinamico',
      10,
    );
    expect(cortes).toHaveLength(1);
    expect(cortes[0]).toMatchObject({ tipo: 'pausa', inicio: 4.09, fim: 4.74 });
    // Natural deixa respirar mais e só encurta pausa a partir de 0,6 s.
    expect(cortesDePausa([{ inicio: 4, fim: 4.5 }], 'natural', 10)).toHaveLength(0);
  });
});

describe('a IA decide os cortes', () => {
  const palavras = fala(
    'Ó Claude é o seguinte esse aqui é o vídeo de teste né? para a gente testar então faça aí',
  );

  it('numera a fala com as pausas longas no meio', () => {
    const t = falaNumerada(palavras.slice(0, 3), [{ inicio: 0.25, fim: 0.75 }]);
    expect(t).toContain('0: Ó');
    expect(t).toContain('[pausa 0.5 s]');
  });

  it('lê a decisão e descarta índices fora da fala', () => {
    const d = lerDecisao(
      {
        inicio: 5,
        fim: 17,
        motivo_inicio: 'Fala para quem vai editar',
        cortes: [
          { de: 12, ate: 12, tipo: 'muleta', motivo: '"né?" de muleta', duvida: false },
          { de: 99, ate: 120, tipo: 'fora', motivo: 'x', duvida: false },
          { de: 3, ate: 4, tipo: 'fora', motivo: 'antes do início', duvida: false },
        ],
        fortes: [11, 11, 400],
        titulo: '  vídeo   de teste ',
      },
      palavras.length,
    );
    expect(d.cortes).toEqual([{ de: 12, ate: 12, tipo: 'muleta', motivo: '"né?" de muleta', duvida: false }]);
    expect(d.fortes).toEqual([11]);
    expect(d.titulo).toBe('VÍDEO DE TESTE');
  });

  it('sem a IA, as regras tiram a muleta e a palavra repetida', () => {
    const d = decisaoPelasRegras(fala('então é é eh o preço é R$ 89,90'));
    expect(d.cortes.map((c) => c.tipo)).toEqual(['recomeco', 'muleta']);
    expect(d.fortes).toEqual([7, 8]);
  });

  it('monta os cortes: começo, fim, a muleta e as pausas fora dos cortes de palavras', () => {
    const duracao = palavras.at(-1)!.f + 1;
    const d = lerDecisao(
      {
        inicio: 5,
        fim: 16,
        cortes: [{ de: 12, ate: 12, tipo: 'muleta', motivo: 'né', duvida: false }],
        fortes: [],
        titulo: '',
      },
      palavras.length,
    );
    const cortes = montarCortes(palavras, [{ inicio: 4.75, fim: 5.1 }], d, 'dinamico', duracao);
    expect(cortes.map((c) => c.tipo)).toEqual(['inicio', 'muleta', 'fim']);
    expect(cortes[0]).toMatchObject({ inicio: 0, trecho: 'Ó Claude é o seguinte' });
    expect(cortes[2]!.trecho).toBe('então faça aí');
    expect(cortes.every((c) => c.id && c.decisao === 'cortar')).toBe(true);
    // O corte da muleta vai da borda da palavra anterior à da próxima, sem comer palavra.
    const m = cortes[1]!;
    expect(m.inicio).toBeGreaterThanOrEqual(palavras[11]!.f);
    expect(m.fim).toBeLessThanOrEqual(palavras[13]!.i);
    // Ritmo "só pausas": nenhuma palavra sai.
    expect(montarCortes(palavras, [], d, 'pausas', duracao).some((c) => c.tipo === 'muleta')).toBe(false);
  });

  it('vira dúvida a junção em que a palavra do lado não foi ouvida de novo', () => {
    const p = fala('preço baixo aquele produto aquele conteúdo bom demais', 0.5);
    const cortes = montarCortes(
      p,
      [],
      lerDecisao(
        {
          inicio: 0,
          fim: 7,
          cortes: [{ de: 2, ate: 3, tipo: 'recomeco', motivo: 'Recomeço', duvida: false }],
          fortes: [],
          titulo: '',
        },
        p.length,
      ),
      'dinamico',
      p.at(-1)!.f + 0.3,
    );
    const ficam = trechosQueFicam(p.at(-1)!.f + 0.3, cortes);
    const novoTempo = (t: number) => {
      let acc = 0;
      for (const s of ficam) {
        if (t <= s.fim) return acc + Math.max(0, t - s.inicio);
        acc += s.fim - s.inicio;
      }
      return acc;
    };
    const ouvidasBem = p
      .filter((_, k) => k !== 2 && k !== 3)
      .map((x) => ({ ...x, i: novoTempo(x.i), f: novoTempo(x.f) }));
    expect(conferirJuncoes(cortes, p, ficam, ouvidasBem).find((c) => c.tipo === 'recomeco')!.duvida).toBe(
      false,
    );
    const semConteudo = ouvidasBem.filter((x) => x.t !== 'aquele');
    const r = conferirJuncoes(cortes, p, ficam, semConteudo).find((c) => c.tipo === 'recomeco')!;
    expect(r).toMatchObject({ duvida: true, conferido: false });
    expect(r.motivo).toMatch(/pedaço de palavra/);
  });
});

describe('a fala do Whisper', () => {
  it('lê as palavras e marca as do trecho inseguro', () => {
    const p = lerPalavras({
      words: [
        { word: ' Oi', start: 0, end: 0.2 },
        { word: ' gente', start: 0.2, end: 0.5 },
        { word: ' xpto', start: 3, end: 3.4 },
      ],
      segments: [
        { start: 0, end: 0.5, avg_logprob: -0.2 },
        { start: 3, end: 3.4, avg_logprob: -1.1 },
      ],
    });
    expect(p).toEqual([
      { t: 'Oi', i: 0, f: 0.2 },
      { t: 'gente', i: 0.2, f: 0.5 },
      { t: 'xpto', i: 3, f: 3.4, conferir: true },
    ]);
  });

  it('o vocabulário da empresa corrige a escrita (sem acento e sem maiúscula), mantendo a pontuação', () => {
    const p = aplicarVocabulario(fala('o 5w30 da horizonte, bosch.'), ['5W30', 'Horizonte', 'Bosch']);
    expect(p.map((x) => x.t)).toEqual(['o', '5W30', 'da', 'Horizonte,', 'Bosch.']);
  });
});

describe('montagem no tempo do editado', () => {
  const ficam = [
    { inicio: 1, fim: 3 },
    { inicio: 4, fim: 6 },
  ];
  const rostos = rostoParado(6);

  it('alterna a aproximação e ancora no queixo', () => {
    const planos = planosDoVideo(ficam, rostos, 'alternada');
    expect(planos.map((p) => p.zoom)).toEqual([1, 1.08]);
    expect(planos[1]).toMatchObject({ editadoIni: 2, editadoFim: 4, ax: 560, ay: 1400 });
    expect(planosDoVideo(ficam, rostos, 'seco').every((p) => p.zoom === 1)).toBe(true);
    // O ponto âncora (queixo) fica parado no recorte.
    const r = recorteDoPlano(planos[1]!);
    expect((planos[1]!.ay - r.y) * planos[1]!.zoom).toBeCloseTo(planos[1]!.ay, -1);
  });

  it('a palavra esticada por cima de um corte fica no plano que tem mais dela', () => {
    const planos = planosDoVideo(ficam, rostos, 'seco');
    const p = palavrasNoEditado(
      [
        { t: 'antes', i: 0.2, f: 0.6 },
        { t: 'esticada', i: 2.7, f: 3.8 },
        { t: 'depois', i: 4.2, f: 4.6 },
      ],
      planos,
    );
    expect(p.map((x) => x.t)).toEqual(['esticada', 'depois']);
    expect(p[0]).toMatchObject({ k: 1, i: 1.7, f: 2 });
    expect(p[1]).toMatchObject({ k: 2, i: 2.2, f: 2.6 });
  });

  it('o rosto acompanha a aproximação do plano', () => {
    const planos = planosDoVideo(ficam, rostos, 'alternada');
    const r = rostosNoEditado(rostos, planos);
    const noZoom = r.find((q) => q.t > 2.5)!;
    expect(noZoom.caixas[0]!.y1).toBe(1400); // âncora no queixo
    expect(noZoom.caixas[0]!.y0).toBeLessThan(400); // cresce para cima
  });

  it('o título cabe em duas linhas no maior tamanho possível', () => {
    expect(tituloEmLinhas('teste de edição', medir)).toEqual({ linhas: ['TESTE DE', 'EDIÇÃO'], tam: 112 });
    const longo = tituloEmLinhas('como escolher a bateria certa do carro', medir);
    expect(longo.linhas.length).toBeLessThanOrEqual(2);
    expect(longo.linhas.every((l) => medir(l, longo.tam) <= 900)).toBe(true);
  });
});

describe('diagramação: nada em cima do rosto', () => {
  const palavras = fala('o óleo certo para o seu carro dura mais e protege o motor no calor', 0.35).map(
    (p, k) => ({ ...p, k }),
  );
  const blocos = blocosDaLegenda(palavras, 'acesa');

  it('forma blocos curtos em maiúsculas, quebrando na pontuação', () => {
    expect(blocos.every((b) => b.palavras.length <= 3)).toBe(true);
    expect(blocos[0]!.palavras[0]!.t).toBe('O');
    const b = blocosDaLegenda(
      [
        { t: 'perfeita,', i: 0, f: 0.4, k: 0 },
        { t: 'coloque', i: 0.45, f: 0.7, k: 1 },
      ],
      'acesa',
    );
    expect(b).toHaveLength(2);
    expect(b[0]!.palavras[0]!.t).toBe('PERFEITA');
  });

  it('a legenda fica embaixo do queixo e o título acima da cabeça', () => {
    const d = diagramar({
      rostos: rostoParado(6),
      planos: [{ inicio: 0, fim: 6 }],
      blocos,
      graficos: [{ id: 'abertura', ini: 0, fim: 2.3, altura: 120 }],
      estilo: 'acesa',
      medir,
    });
    expect(d.legendas.every((l) => l.topo >= 1400 + 34 && l.topo + l.altura <= 1700)).toBe(true);
    // Mesmo tamanho dentro do plano.
    expect(new Set(d.legendas.map((l) => l.tam)).size).toBe(1);
    const t = d.cartoes[0]!;
    expect(t.s).toBe(1);
    expect(t.topo + t.altura * t.escala).toBeLessThanOrEqual(400 - 34);
  });

  it('sem espaço acima da cabeça, o vídeo não encolhe: o título vai para baixo do queixo e a legenda espera', () => {
    const d = diagramar({
      rostos: rostoParado(6, { x0: 260, x1: 860, y0: 300, y1: 1400 }),
      planos: [{ inicio: 0, fim: 6 }],
      blocos,
      graficos: [{ id: 'abertura', ini: 0, fim: 2.3, altura: 240 }],
      estilo: 'acesa',
      medir,
    });
    const c = d.cartoes[0]!;
    expect(c).toMatchObject({ s: 1, tx: 0, ty: 0, lugar: 'abaixo', topo: 1434 });
    expect(c.topo + c.altura * c.escala).toBeLessThanOrEqual(1700);
    // A legenda não aparece junto com o título (os dois embaixo não cabem).
    expect(d.legendas.some((l) => l.ini < 2.3 && l.fim > 0)).toBe(false);
    expect(d.legendas.length).toBeGreaterThan(0);
    expect(
      conferirSobreposicao(d, rostoParado(6, { x0: 260, x1: 860, y0: 300, y1: 1400 }), 6).sobreposicoes,
    ).toBe(0);
  });

  it('pouco espaço acima: o título diminui até a metade, acima da cabeça; sem espaço nenhum, fica de fora', () => {
    const acima = diagramar({
      rostos: rostoParado(6, { x0: 260, x1: 860, y0: 400, y1: 1100 }),
      planos: [{ inicio: 0, fim: 6 }],
      blocos,
      graficos: [{ id: 'abertura', ini: 0, fim: 2.3, altura: 240 }],
      estilo: 'acesa',
      medir,
    }).cartoes[0]!;
    expect(acima).toMatchObject({ s: 1, lugar: 'acima', topo: 210 });
    expect(acima.escala).toBeCloseTo(156 / 240, 3);
    const fora = diagramar({
      rostos: rostoParado(6, { x0: 100, x1: 980, y0: 250, y1: 1650 }),
      planos: [{ inicio: 0, fim: 6 }],
      blocos,
      graficos: [{ id: 'abertura', ini: 0, fim: 2.3, altura: 240 }],
      estilo: 'acesa',
      medir,
    }).cartoes[0]!;
    expect(fora).toMatchObject({ s: 1, lugar: 'fora', escala: 0 });
  });

  it('faixa apertada embaixo do queixo: os blocos se partem para a letra continuar grande', () => {
    const queixoBaixo = rostoParado(6, { x0: 260, x1: 860, y0: 420, y1: 1530 });
    const d = diagramar({
      rostos: queixoBaixo,
      planos: [{ inicio: 0, fim: 6 }],
      blocos,
      graficos: [],
      estilo: 'acesa',
      medir,
    });
    expect(d.legendas.every((l) => l.linhas.length === 1 && l.topo >= 1530)).toBe(true);
    expect(d.legendas.length).toBeGreaterThan(blocos.length);
    expect(partirBlocos([{ palavras: blocos[0]!.palavras, ini: 0, fim: 1 }])).toHaveLength(2);
  });

  it('a conferência acusa texto em cima do rosto', () => {
    const d = diagramar({
      rostos: rostoParado(6),
      planos: [{ inicio: 0, fim: 6 }],
      blocos,
      graficos: [],
      estilo: 'acesa',
      medir,
    });
    const subiu = rostoParado(6, { x0: 260, x1: 860, y0: 900, y1: 1650 });
    expect(conferirSobreposicao(d, subiu, 6).sobreposicoes).toBeGreaterThan(0);
  });
});

describe('composição do HyperFrames', () => {
  it('monta o HTML com a marca, escapando o texto, e soma a tela final', () => {
    const palavras = [{ t: '<b>oi</b>', i: 0, f: 0.4, k: 0 }];
    const d = diagramar({
      rostos: rostoParado(3),
      planos: [{ inicio: 0, fim: 3 }],
      blocos: blocosDaLegenda(palavras, 'acesa'),
      graficos: [{ id: 'abertura', ini: 0, fim: 2.3, altura: 120 }],
      estilo: 'acesa',
      medir,
    });
    const html = montarComposicao({
      diagrama: d,
      estilo: 'acesa',
      marca: { primaria: '#123456', destaque: 'vermelho' },
      duracao: 3,
      titulo: { usar: true, linhas: ['TESTE <x>'], tam: 96 },
      chamada: { frase: 'Quer saber mais?', botao: 'Comente QUERO' },
      arquivos: {
        video: 'assets/editado.mp4',
        gsap: 'assets/gsap.min.js',
        fonte800: 'a.woff2',
        fonte900: 'b.woff2',
        ultimoQuadro: 'u.png',
      },
    });
    expect(html).toContain('data-duration="5.8"');
    expect(html).toContain('#123456');
    expect(html).toContain('#f97316'); // cor inválida volta para o padrão
    expect(html).toContain('TESTE &lt;x&gt;');
    expect(html).not.toContain('<b>OI</b>');
    expect(html).toContain('\\u003cB\\u003eOI\\u003c/B\\u003e');
    expect(html).toContain("window.__timelines['main'] = tl");
  });
});

describe('v137: fala embolada', async () => {
  const { cortesDeFalaSemPalavra } = await import('../src/videos/cortes.js');
  const p = (t: string, i: number, f: number) => ({ t, i, f });
  it('vão com som entre duas palavras vira corte em dúvida; vão em silêncio fica para o corte de pausa', () => {
    const palavras = [p('a', 0, 0.4), p('pastilha', 0.5, 1), p('chia', 2.5, 3), p('muito', 4.4, 4.8)];
    const c = cortesDeFalaSemPalavra(palavras, [{ inicio: 3.1, fim: 4.3 }]);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ inicio: 1.05, fim: 2.45, tipo: 'outro', duvida: true, decisao: 'cortar' });
  });
});
