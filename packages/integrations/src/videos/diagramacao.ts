import type { EstiloLegenda, PalavraVideo } from '@prospeccao/shared/videos';

/**
 * Diagramação automática: decide onde a legenda e cada gráfico entram, olhando onde o rosto está em
 * cada momento do vídeo editado. Nada pode cobrir o rosto:
 * - a legenda fica embaixo do queixo, com o maior tamanho que cabe, igual dentro de cada plano
 *   (o trecho entre dois cortes), para não ficar pulando;
 * - o gráfico fica acima da cabeça; quando não cabe nem reduzido, o vídeo vira um cartão na cor da
 *   marca e abre espaço em cima.
 * Medidas em px de um vídeo 1080 × 1920.
 */

export const LARGURA = 1080;
export const ALTURA = 1920;
/** Abaixo disso fica o cabeçalho do Instagram. */
export const TOPO = 210;
/** Acima disso fica o nome do perfil, a legenda do post e os ícones do Instagram. */
export const BASE = 1700;
/** Largura útil da legenda (sem encostar nos ícones da direita). */
export const LARGURA_LEGENDA = 860;
/** Distância mínima entre texto e rosto. */
export const FOLGA = 34;
/** Sem rosto (ou rosto alto), a legenda não sobe acima disto. */
export const LEGENDA_MAIS_ALTA = 1180;

export interface Caixa {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface QuadroRosto {
  t: number;
  caixas: Caixa[];
}

export interface PalavraNaTela {
  /** Índice da palavra na fala (para a revisão achar). */
  k: number;
  t: string;
  i: number;
  f: number;
  forte: boolean;
}

export interface BlocoLegenda {
  palavras: PalavraNaTela[];
  ini: number;
  fim: number;
}

export interface LegendaPosta extends BlocoLegenda {
  topo: number;
  tam: number;
  /** Cada linha com as posições das palavras do bloco. */
  linhas: number[][];
  altura: number;
  lugar: 'abaixo' | 'acima' | 'apertado';
}

export interface Grafico {
  id: string;
  ini: number;
  fim: number;
  altura: number;
}

export interface Cartao {
  id: string;
  ini: number;
  fim: number;
  /** Escala e deslocamento do vídeo (s = 1: tela cheia, sem cartão). */
  s: number;
  tx: number;
  ty: number;
  /** Onde o gráfico entra e a escala dele. */
  topo: number;
  escala: number;
  altura: number;
}

export interface Diagrama {
  cartoes: Cartao[];
  legendas: LegendaPosta[];
  transicao: number;
}

export type Medir = (texto: string, tamanho: number) => number;

const r1 = (n: number) => Math.round(n * 10) / 10;
const TRANSICAO = 0.4;

/* ───────────────────────────── Blocos da legenda ───────────────────────────── */

const PONTUACAO_FIM = /[.,;:!…]+$/;

/** Como a palavra aparece na tela (sem a pontuação do fim; a pergunta fica). */
export function textoNaTela(t: string, estilo: EstiloLegenda): string {
  const limpo = t.replace(PONTUACAO_FIM, '').replace(/^["“”']+|["“”']+$/g, '');
  return estilo === 'acesa' ? limpo.toUpperCase() : limpo;
}

/**
 * Agrupa as palavras (já no tempo do vídeo editado) em blocos curtos: até 3 palavras na "palavra
 * acesa", até 6 nos outros; quebra na pontuação e nas pausas.
 */
export function blocosDaLegenda(
  palavras: (PalavraVideo & { k: number })[],
  estilo: EstiloLegenda,
): BlocoLegenda[] {
  const maxPal = estilo === 'acesa' ? 3 : 6;
  const maxLetras = estilo === 'acesa' ? 18 : 34;
  const blocos: PalavraNaTela[][] = [];
  let atual: PalavraNaTela[] = [];
  let letras = 0;
  palavras.forEach((p, n) => {
    const texto = textoNaTela(p.t, estilo);
    if (!texto) return;
    const anterior = palavras[n - 1];
    const pausa = anterior ? p.i - anterior.f : 0;
    if (atual.length && (atual.length >= maxPal || letras + texto.length > maxLetras || pausa > 0.35)) {
      blocos.push(atual);
      atual = [];
      letras = 0;
    }
    atual.push({ k: p.k, t: texto, i: p.i, f: Math.max(p.f, p.i + 0.08), forte: !!p.forte });
    letras += texto.length + 1;
    if (/[.!?…]$/.test(p.t) || (/[,;:]$/.test(p.t) && (atual.length >= 2 || texto.length >= 6))) {
      blocos.push(atual);
      atual = [];
      letras = 0;
    }
  });
  if (atual.length) blocos.push(atual);
  return blocos.map((b, n) => {
    const ini = b[0]!.i;
    const prox = blocos[n + 1]?.[0]?.i;
    const fim = Math.min(prox ?? Number.POSITIVE_INFINITY, b[b.length - 1]!.f + 0.35);
    return { palavras: b, ini, fim: Math.max(fim, ini + 0.2) };
  });
}

/* ───────────────────────────── Rosto no tempo ───────────────────────────── */

function rostosEntre(rostos: QuadroRosto[], a: number, b: number): (Caixa & { t: number })[] {
  return rostos
    .filter((q) => q.t >= a - 0.12 && q.t <= b + 0.12)
    .flatMap((q) => q.caixas.map((c) => ({ ...c, t: q.t })));
}

function uniao(cs: Caixa[]): Caixa | null {
  if (!cs.length) return null;
  return {
    x0: Math.min(...cs.map((c) => c.x0)),
    y0: Math.min(...cs.map((c) => c.y0)),
    x1: Math.max(...cs.map((c) => c.x1)),
    y1: Math.max(...cs.map((c) => c.y1)),
  };
}

/* ───────────────────────────── Medir e quebrar ───────────────────────────── */

const ESCALA_ATIVA: Record<EstiloLegenda, number> = { acesa: 1.12, simples: 1, balao: 1 };
const ALTURA_LINHA: Record<EstiloLegenda, number> = { acesa: 1.12, simples: 1.18, balao: 1.25 };
const TAMANHOS: Record<EstiloLegenda, number[]> = {
  acesa: [84, 80, 76, 72, 68, 64, 60, 56],
  simples: [66, 62, 58, 54, 50, 46],
  balao: [58, 54, 50, 46, 42],
};
/** Espaço entre palavras (proporcional ao tamanho). */
export const espacoEntre = (tam: number) => Math.round(tam * 0.32);

function larguraPalavra(medir: Medir, t: string, tam: number, estilo: EstiloLegenda) {
  const enfeite = estilo === 'acesa' ? 28 + tam * 0.15 : 4;
  return (medir(t, tam) + enfeite) * ESCALA_ATIVA[estilo];
}

export function quebrarLinhas(
  medir: Medir,
  palavras: PalavraNaTela[],
  tam: number,
  estilo: EstiloLegenda,
): number[][] {
  const linhas: number[][] = [];
  let atual: number[] = [];
  let w = 0;
  const gap = espacoEntre(tam);
  const largura = estilo === 'balao' ? LARGURA_LEGENDA - 56 : LARGURA_LEGENDA;
  palavras.forEach((p, n) => {
    const lp = larguraPalavra(medir, p.t, tam, estilo);
    if (atual.length && w + gap + lp > largura) {
      linhas.push(atual);
      atual = [];
      w = 0;
    }
    w += (atual.length ? gap : 0) + lp;
    atual.push(n);
  });
  if (atual.length) linhas.push(atual);
  return linhas;
}

export function alturaDoBloco(linhas: number, tam: number, estilo: EstiloLegenda) {
  return Math.round(linhas * tam * ALTURA_LINHA[estilo] + (estilo === 'balao' ? 40 : 12));
}

/** Cada bloco com mais de uma palavra vira dois (metade das palavras em cada), com os tempos certos. */
export function partirBlocos(blocos: BlocoLegenda[]): BlocoLegenda[] {
  return blocos.flatMap((b) => {
    if (b.palavras.length < 2) return [b];
    const meio = Math.ceil(b.palavras.length / 2);
    const p1 = b.palavras.slice(0, meio);
    const p2 = b.palavras.slice(meio);
    return [
      { palavras: p1, ini: b.ini, fim: p2[0]!.i },
      { palavras: p2, ini: p2[0]!.i, fim: b.fim },
    ];
  });
}

/* ───────────────────────────── A diagramação ───────────────────────────── */

export function diagramar(entrada: {
  rostos: QuadroRosto[];
  /** Os planos do vídeo editado (cada trecho entre dois cortes). */
  planos: { inicio: number; fim: number }[];
  blocos: BlocoLegenda[];
  graficos: Grafico[];
  estilo: EstiloLegenda;
  medir: Medir;
}): Diagrama {
  const { rostos, estilo, medir } = entrada;

  // 1. Gráficos: acima da cabeça; se não couber nem reduzindo, o vídeo vira cartão.
  const cartoes: Cartao[] = entrada.graficos.map((g) => {
    const u = uniao(rostosEntre(rostos, g.ini, g.fim));
    if (!u)
      return {
        id: g.id,
        ini: g.ini,
        fim: g.fim,
        s: 1,
        tx: 0,
        ty: 0,
        topo: TOPO,
        escala: 1,
        altura: g.altura,
      };
    const livre = u.y0 - FOLGA - TOPO;
    if (livre >= g.altura * 0.72)
      return {
        id: g.id,
        ini: g.ini,
        fim: g.fim,
        s: 1,
        tx: 0,
        ty: 0,
        topo: TOPO,
        escala: Math.round(Math.min(1, livre / g.altura) * 1000) / 1000,
        altura: g.altura,
      };
    const queixoMax = BASE - 120 - FOLGA;
    // O cartão diminui até 58% da tela: abaixo disso o rosto fica pequeno demais; acima, o gráfico.
    const s = Math.max(0.58, Math.min(0.9, (queixoMax - (TOPO + g.altura + 24)) / u.y1));
    const ty = queixoMax - s * u.y1;
    const escala = Math.min(1, (ty - 24 - TOPO) / g.altura);
    return {
      id: g.id,
      ini: g.ini,
      fim: g.fim,
      s: Math.round(s * 10_000) / 10_000,
      tx: r1((LARGURA - LARGURA * s) / 2),
      ty: r1(ty),
      topo: Math.round(TOPO + Math.max(0, (ty - 24 - TOPO - g.altura * escala) / 2)),
      escala: Math.round(Math.max(0.5, escala) * 1000) / 1000,
      altura: g.altura,
    };
  });

  const transformacao = (t: number) => {
    const c = cartoes.find((x) => x.s < 1 && x.ini <= t && t <= x.fim);
    return c ? { s: c.s, ty: c.ty } : { s: 1, ty: 0 };
  };
  const queixoEm = (a: number, b: number) => {
    let pior = 0;
    for (const q of rostos) {
      if (q.t < a - 0.12 || q.t > b + 0.12) continue;
      const { s, ty } = transformacao(q.t);
      for (const c of q.caixas) pior = Math.max(pior, ty + s * c.y1);
    }
    return pior;
  };
  const cabecaEm = (a: number, b: number) => {
    let topo = ALTURA;
    for (const q of rostos) {
      if (q.t < a - 0.12 || q.t > b + 0.12) continue;
      const { s, ty } = transformacao(q.t);
      for (const c of q.caixas) topo = Math.min(topo, ty + s * c.y0);
    }
    return topo;
  };

  // 2. Legenda por plano: mesma altura e mesmo tamanho dentro do plano.
  const planoDe = (t: number) => {
    const k = entrada.planos.findIndex((p) => t >= p.inicio - 1e-3 && t < p.fim);
    return k < 0 ? entrada.planos.length - 1 : k;
  };
  const porPlano = new Map<number, BlocoLegenda[]>();
  for (const b of entrada.blocos) {
    const k = planoDe(b.ini);
    porPlano.set(k, [...(porPlano.get(k) ?? []), b]);
  }
  const legendas: LegendaPosta[] = [];
  const cabe = (blocos: BlocoLegenda[], livre: number) => {
    for (const tam of TAMANHOS[estilo]) {
      const ok = blocos.every((b) => {
        const l = quebrarLinhas(medir, b.palavras, tam, estilo);
        return l.length <= 2 && alturaDoBloco(l.length, tam, estilo) <= livre;
      });
      if (ok) return tam;
    }
    return null;
  };
  for (const [, inteiros] of [...porPlano.entries()].sort((a, b) => a[0] - b[0])) {
    const a = Math.min(...inteiros.map((b) => b.ini));
    const z = Math.max(...inteiros.map((b) => b.fim));
    let topo = Math.max(LEGENDA_MAIS_ALTA, queixoEm(a, z) + FOLGA);
    let lugar: LegendaPosta['lugar'] = 'abaixo';
    let blocos = inteiros;
    let tam = cabe(blocos, BASE - topo);
    // Faixa apertada: blocos menores (metade das palavras) deixam a letra maior numa linha só.
    const minimoBom = TAMANHOS[estilo][2]!;
    if (tam == null || tam < minimoBom) {
      const partidos = partirBlocos(inteiros);
      const tamPartido = cabe(partidos, BASE - topo);
      if (tamPartido != null && (tam == null || tamPartido > tam)) {
        blocos = partidos;
        tam = tamPartido;
      }
    }
    if (tam == null) {
      const acima = cabe(blocos, cabecaEm(a, z) - FOLGA - TOPO);
      if (acima != null) {
        tam = acima;
        topo = TOPO;
        lugar = 'acima';
      }
    }
    for (const b of blocos) {
      const t = tam ?? TAMANHOS[estilo].at(-1)!;
      const linhas = quebrarLinhas(medir, b.palavras, t, estilo);
      const altura = alturaDoBloco(linhas.length, t, estilo);
      legendas.push({
        ...b,
        tam: t,
        linhas,
        altura,
        topo: Math.round(tam == null ? BASE - altura : topo),
        lugar: tam == null ? 'apertado' : lugar,
      });
    }
  }
  legendas.sort((x, y) => x.ini - y.ini);
  return { cartoes, legendas, transicao: TRANSICAO };
}

/* ───────────────────────────── Conferência ───────────────────────────── */

/**
 * Confere no vídeo pronto: em cada quadro com rosto, nenhum texto visível encosta nele. Devolve
 * quantos quadros foram vistos, quantos tiveram sobreposição e a menor distância.
 */
export function conferirSobreposicao(
  diagrama: Diagrama,
  rostosDoPronto: QuadroRosto[],
  ateSegundos: number,
  /**
   * Onde há imagem na tela (v129): um rosto dentro da imagem é da imagem, não da pessoa; com a
   * imagem em tela cheia (caixa null), a pessoa não aparece e o quadro não conta.
   */
  imagens: { ini: number; fim: number; caixa: Caixa | null }[] = [],
): { quadros: number; sobreposicoes: number; menorDistancia: number | null } {
  const caixas = [
    ...diagrama.legendas.map((l) => ({ ini: l.ini, fim: l.fim, y0: l.topo, y1: l.topo + l.altura })),
    ...diagrama.cartoes.map((c) => ({
      ini: c.ini,
      fim: c.s < 1 ? c.fim - diagrama.transicao - 0.05 : c.fim,
      y0: c.topo,
      y1: c.topo + c.altura * c.escala,
    })),
  ];
  let quadros = 0;
  let sobreposicoes = 0;
  let menor: number | null = null;
  for (const q of rostosDoPronto) {
    if (q.t >= ateSegundos - 0.05 || !q.caixas.length) continue;
    const naTela = imagens.filter((im) => q.t >= im.ini && q.t <= im.fim);
    if (naTela.some((im) => !im.caixa)) continue;
    const daPessoa = q.caixas.filter((r) => {
      const cx = (r.x0 + r.x1) / 2;
      const cy = (r.y0 + r.y1) / 2;
      return !naTela.some(
        (im) => im.caixa && cx >= im.caixa.x0 && cx <= im.caixa.x1 && cy >= im.caixa.y0 && cy <= im.caixa.y1,
      );
    });
    if (!daPessoa.length) continue;
    quadros++;
    let bateu = false;
    for (const r of daPessoa)
      for (const c of caixas) {
        if (q.t < c.ini || q.t > c.fim) continue;
        if (c.y1 <= r.y0) menor = Math.min(menor ?? 1e9, r.y0 - c.y1);
        else if (c.y0 >= r.y1) menor = Math.min(menor ?? 1e9, c.y0 - r.y1);
        else bateu = true;
      }
    if (bateu) sobreposicoes++;
  }
  return { quadros, sobreposicoes, menorDistancia: menor == null ? null : Math.round(menor) };
}
