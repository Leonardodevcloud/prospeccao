import type { PalavraVideo, TransicaoCortes } from '@prospeccao/shared/videos';
import type { Caixa, Medir, QuadroRosto } from './diagramacao.js';

/**
 * Da fala e do mapa do rosto do vídeo original para o vídeo editado: o tempo de cada palavra
 * depois dos cortes, o enquadramento de cada plano (a aproximação alternada que disfarça o corte,
 * ancorada no queixo para o rosto crescer para cima e não invadir a legenda) e onde o rosto fica
 * em cada quadro do editado.
 */

type Trecho = { inicio: number; fim: number };
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Aproximação dos planos alternados. */
export const ZOOM_ALTERNADO = 1.08;
/** Plano mais curto que isso não troca de enquadramento (piscaria). */
const PLANO_MINIMO_ZOOM = 0.8;

export interface Plano {
  /** No original. */
  inicio: number;
  fim: number;
  /** No editado. */
  editadoIni: number;
  editadoFim: number;
  zoom: number;
  /** Ponto que fica parado na aproximação (px do vídeo em pé, 1080 × 1920). */
  ax: number;
  ay: number;
}

function rostosEntre(rostos: QuadroRosto[], a: number, b: number): Caixa[] {
  return rostos.filter((q) => q.t >= a && q.t <= b).flatMap((q) => q.caixas);
}

export function planosDoVideo(ficam: Trecho[], rostos: QuadroRosto[], transicao: TransicaoCortes): Plano[] {
  let acc = 0;
  let alterna = false;
  return ficam.map((s) => {
    const dur = s.fim - s.inicio;
    const rs = rostosEntre(rostos, s.inicio, s.fim);
    const ax = rs.length ? rs.reduce((t, r) => t + (r.x0 + r.x1) / 2, 0) / rs.length : 540;
    const ay = rs.length ? Math.max(...rs.map((r) => r.y1)) : 1100;
    let zoom = 1;
    if (transicao !== 'seco' && dur >= PLANO_MINIMO_ZOOM) {
      zoom = alterna ? ZOOM_ALTERNADO : 1;
      alterna = !alterna;
    }
    const p: Plano = {
      inicio: s.inicio,
      fim: s.fim,
      editadoIni: r3(acc),
      editadoFim: r3(acc + dur),
      zoom,
      ax: Math.round(ax),
      ay: Math.round(Math.min(1920, ay)),
    };
    acc += dur;
    return p;
  });
}

/** As palavras que ficaram, no tempo do editado (com o índice da fala original). */
export function palavrasNoEditado(
  palavras: PalavraVideo[],
  planos: Plano[],
): (PalavraVideo & { k: number })[] {
  const out: (PalavraVideo & { k: number })[] = [];
  palavras.forEach((p, k) => {
    // O Whisper estica a palavra por cima da pausa: vale o plano que tem mais da palavra.
    let pl: Plano | null = null;
    let melhor = 0;
    for (const x of planos) {
      const sobra = Math.min(x.fim, Math.max(p.f, p.i + 0.08)) - Math.max(x.inicio, p.i);
      if (sobra > melhor) {
        melhor = sobra;
        pl = x;
      }
    }
    if (!pl || melhor < 0.04) return;
    const i = Math.max(pl.inicio, p.i);
    const f = Math.min(pl.fim, p.f);
    out.push({ ...p, k, i: r3(pl.editadoIni + (i - pl.inicio)), f: r3(pl.editadoIni + (f - pl.inicio)) });
  });
  return out;
}

/** O rosto em cada quadro do editado, já com a aproximação do plano. */
export function rostosNoEditado(rostos: QuadroRosto[], planos: Plano[]): QuadroRosto[] {
  const out: QuadroRosto[] = [];
  for (const q of rostos) {
    const pl = planos.find((x) => q.t >= x.inicio && q.t <= x.fim);
    if (!pl) continue;
    const z = pl.zoom;
    const m = (v: number, a: number) => Math.round(a + (v - a) * z);
    out.push({
      t: r3(pl.editadoIni + (q.t - pl.inicio)),
      caixas: q.caixas.map((c) => ({
        x0: m(c.x0, pl.ax),
        x1: m(c.x1, pl.ax),
        y0: m(c.y0, pl.ay),
        y1: m(c.y1, pl.ay),
      })),
    });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** O recorte do ffmpeg para a aproximação do plano (no vídeo em pé de 1080 × 1920). */
export function recorteDoPlano(p: Plano): { w: number; h: number; x: number; y: number } {
  const w = Math.floor(1080 / p.zoom / 2) * 2;
  const h = Math.floor(1920 / p.zoom / 2) * 2;
  const x = Math.min(Math.max(Math.round(p.ax - p.ax / p.zoom), 0), 1080 - w);
  const y = Math.min(Math.max(Math.round(p.ay - p.ay / p.zoom), 0), 1920 - h);
  return { w, h, x, y };
}

/** O título de abertura em até 2 linhas, no maior tamanho que cabe em 900 px. */
export function tituloEmLinhas(texto: string, medir: Medir): { linhas: string[]; tam: number } {
  const palavras = texto.toUpperCase().split(/\s+/).filter(Boolean);
  if (!palavras.length) return { linhas: [], tam: 0 };
  for (const tam of [112, 104, 96, 88, 80, 72, 64]) {
    const linhas: string[] = [];
    let atual = '';
    for (const p of palavras) {
      const tentativa = atual ? `${atual} ${p}` : p;
      if (atual && medir(tentativa, tam) > 900) {
        linhas.push(atual);
        atual = p;
      } else atual = tentativa;
    }
    if (atual) linhas.push(atual);
    if (linhas.length <= 2 && linhas.every((l) => medir(l, tam) <= 900)) return { linhas, tam };
  }
  return { linhas: [palavras.slice(0, 3).join(' '), palavras.slice(3).join(' ')].filter(Boolean), tam: 64 };
}

/** Altura do bloco do título (para a diagramação abrir espaço). */
export const alturaDoTitulo = (t: { linhas: string[]; tam: number }) =>
  // Cada linha numa placa (v138): a altura da letra, o respiro da placa e o espaço entre as placas.
  Math.round(t.linhas.length * t.tam * 1.19 + Math.max(0, t.linhas.length - 1) * t.tam * 0.12 + 18 + 12);
