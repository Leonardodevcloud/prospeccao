import type {
  EncaixeImagem,
  ImagemVideo,
  MomentoVideo,
  OfertaDoVideo,
  TipoMomento,
} from '@prospeccao/shared/videos';
import type { Caixa, Grafico, QuadroRosto } from './diagramacao.js';
import type { Plano } from './montagem.js';

/**
 * Leva as animações e as imagens (tempos do original) para o vídeo editado, com a altura que cada
 * uma ocupa acima da cabeça. A diagramação decide depois se cabem ali ou se o vídeo vira cartão.
 */

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export interface MomentoNaTela {
  id: string;
  tipo: TipoMomento;
  ini: number;
  fim: number;
  titulo: string;
  numero: string;
  itens: { texto: string; em: number }[];
  oferta: OfertaDoVideo | null;
  /** Só no destaque: o ponto que fica parado na aproximação (o queixo). */
  ancora: { x: number; y: number } | null;
}

export interface ImagemNaTela {
  id: string;
  ini: number;
  fim: number;
  /** Caminho dentro do projeto do render (assets/…). */
  arquivo: string;
  encaixe: EncaixeImagem;
}

/** Altura (px) de cada gráfico acima da cabeça. */
export const ALTURA_GRAFICO = {
  lista: (itens: number) => 130 + itens * 112,
  numero: 360,
  selo: 150,
  oferta: 470,
  imagem: 590,
};

/** Um instante do original no editado, pelos planos montados (no corte: o começo do plano seguinte). */
export function noEditadoPelosPlanos(t: number, planos: Plano[]): number | null {
  for (const p of planos) {
    if (t < p.inicio) return p.editadoIni;
    if (t <= p.fim) return r3(p.editadoIni + (t - p.inicio));
  }
  return null;
}

function ancoraDoRosto(rostos: QuadroRosto[], a: number, b: number): { x: number; y: number } {
  const cs: Caixa[] = rostos.filter((q) => q.t >= a && q.t <= b).flatMap((q) => q.caixas);
  if (!cs.length) return { x: 540, y: 1100 };
  return {
    x: Math.round(cs.reduce((s, c) => s + (c.x0 + c.x1) / 2, 0) / cs.length),
    y: Math.round(Math.max(...cs.map((c) => c.y1))),
  };
}

export function enfeitesNaTela(e: {
  momentos: MomentoVideo[];
  imagens: (ImagemVideo & { arquivo: string })[];
  planos: Plano[];
  rostos: QuadroRosto[];
  duracao: number;
}): { momentos: MomentoNaTela[]; imagens: ImagemNaTela[]; graficos: Grafico[] } {
  const ed = (t: number) => noEditadoPelosPlanos(t, e.planos);
  const momentos: MomentoNaTela[] = [];
  for (const m of e.momentos) {
    if (!m.usar) continue;
    const ini = ed(m.inicio);
    const fim = ed(m.fim);
    if (ini == null || fim == null || fim - ini < 0.5 || ini >= e.duracao - 0.3) continue;
    const itens = m.itens
      .map((i) => ({ texto: i.texto, em: ed(i.em) }))
      .filter((i): i is { texto: string; em: number } => i.em != null)
      .map((i) => ({ ...i, em: Math.max(ini, Math.min(fim - 0.3, i.em)) }));
    if (m.tipo === 'lista' && itens.length < 2) continue;
    momentos.push({
      id: m.id,
      tipo: m.tipo,
      ini,
      fim: Math.min(fim, e.duracao),
      titulo: m.titulo,
      numero: m.numero,
      itens,
      oferta: m.oferta,
      ancora: m.tipo === 'destaque' ? ancoraDoRosto(e.rostos, ini, fim) : null,
    });
  }
  const imagens: ImagemNaTela[] = [];
  for (const im of e.imagens) {
    if (!im.usar) continue;
    const ini = ed(im.inicio);
    const fim = ed(im.fim);
    if (ini == null || fim == null || fim - ini < 0.8 || ini >= e.duracao - 0.3) continue;
    imagens.push({ id: im.id, ini, fim: Math.min(fim, e.duracao), arquivo: im.arquivo, encaixe: im.encaixe });
  }
  const graficos: Grafico[] = [
    ...momentos
      .filter((m) => m.tipo !== 'destaque')
      .map((m) => ({
        id: m.id,
        ini: m.ini,
        fim: m.fim,
        altura:
          m.tipo === 'lista'
            ? ALTURA_GRAFICO.lista(m.itens.length)
            : m.tipo === 'numero'
              ? ALTURA_GRAFICO.numero
              : m.tipo === 'selo'
                ? ALTURA_GRAFICO.selo
                : ALTURA_GRAFICO.oferta,
      })),
    ...imagens
      .filter((i) => i.encaixe === 'acima')
      .map((i) => ({ id: `img:${i.id}`, ini: i.ini, fim: i.fim, altura: ALTURA_GRAFICO.imagem })),
  ];
  return { momentos, imagens, graficos };
}
