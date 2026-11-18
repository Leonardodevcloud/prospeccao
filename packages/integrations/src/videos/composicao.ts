import type { EstiloLegenda, TransicaoCortes } from '@prospeccao/shared/videos';
import type { ImagemNaTela, MomentoNaTela } from './cena.js';
import { type Diagrama, espacoEntre, type Medir } from './diagramacao.js';

/**
 * A composição do HyperFrames (HTML + GSAP) que o worker renderiza: o vídeo editado embaixo, a
 * legenda palavra por palavra, o título de abertura e a tela final com a chamada, nas posições que
 * a diagramação decidiu; desde a v129 também as animações que acompanham a fala (lista que se
 * marca, número grande, selo, oferta, aproximação na frase forte) e as imagens (acima da cabeça ou
 * em tela cheia). Tudo determinístico (nada de relógio nem sorteio): o HyperFrames avança a
 * linha do tempo quadro a quadro.
 */

export interface MarcaDoVideo {
  /** Cor principal (fundo do cartão, pílula da palavra acesa). */
  primaria: string;
  /** Cor de destaque (palavras-chave, traço do título, botão da chamada). */
  destaque: string;
}

export interface EntradaComposicao {
  diagrama: Diagrama;
  /**
   * v138: em cada plano, a câmera vai chegando devagar (até 4%), com o queixo parado: o vídeo não
   * fica estático e a legenda (embaixo do queixo) não se mexe.
   */
  empurroes?: { ini: number; fim: number; ox: number; oy: number }[];
  /**
   * v166: o ajuste da pessoa na legenda. As cores (null: as do estilo) e, para cada trecho na ordem
   * do diagrama, o deslocamento para o lado e a escala (o topo já vem ajustado no diagrama).
   */
  legenda?: {
    corTexto: string | null;
    corAcesa: string | null;
    corContorno: string | null;
    /** v167: a cor das palavras em destaque (null: a de destaque da marca). */
    corForte?: string | null;
    trechos: { dx: number; escala: number }[];
  };
  /** v166: o quanto o título e as animações saíram para o lado (o topo já vem no diagrama). */
  desloc?: { titulo: number; animacoes: number };
  /** v167: granulação de película e vinheta por cima da imagem do vídeo. */
  acabamento?: 'limpo' | 'filme';
  /** v167: a tarja com o nome e o cargo de quem fala (o lugar vem do cartão "tarja" do diagrama). */
  tarja?: { nome: string; cargo: string; ini: number; fim: number } | null;
  /** v165: os trechos de vídeo de apoio (já no vídeo): a aproximação e o clarão são desenhados aqui. */
  apoios?: { ini: number; fim: number; estilo: string }[];
  estilo: EstiloLegenda;
  marca: MarcaDoVideo;
  /** Duração do vídeo editado (s). */
  duracao: number;
  titulo: { usar: boolean; linhas: string[]; tam: number } | null;
  chamada: { frase: string; botao: string } | null;
  /** Caminhos dentro do projeto (assets/…). */
  arquivos: {
    video: string;
    gsap: string;
    fonte800: string;
    fonte900: string;
    ultimoQuadro: string;
    /** v166: a fonte escolhida para a legenda (o título e as animações seguem na Montserrat). */
    fonteLegenda800?: string;
    fonteLegenda900?: string;
  };
  momentos?: MomentoNaTela[];
  imagens?: ImagemNaTela[];
  transicao?: TransicaoCortes;
  /** Mede o texto na fonte 900 (para o texto das animações caber); sem ela, uma estimativa. */
  medir?: Medir;
}

/** O maior tamanho (da lista) em que o texto cabe na largura. */
export function caber(medir: Medir, texto: string, largura: number, tamanhos: number[]): number {
  // 4% de folga para o contorno e o sombreado que o texto ganha na tela.
  for (const t of tamanhos) if (medir(texto, t) <= largura * 0.96) return t;
  return tamanhos.at(-1)!;
}
const estimar: Medir = (t, tam) => t.length * tam * 0.64;

/** Segundos da tela final com a chamada. */
export const DURACAO_CHAMADA = 2.8;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** JSON seguro dentro de <script>. */
const jsonNoScript = (v: unknown) =>
  JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

const COR = /^#[0-9a-f]{6}$/i;
const cor = (c: string, padrao: string) => (COR.test(c) ? c : padrao);

/** Escurece uma cor (#rrggbb) por um fator (0..1). */
export function escurecer(hex: string, fator: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.round(v * (1 - fator))));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function duracaoTotal(e: Pick<EntradaComposicao, 'duracao' | 'chamada'>): number {
  return Math.round((e.duracao + (e.chamada ? DURACAO_CHAMADA : 0)) * 1000) / 1000;
}

const CHECK =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** O HTML de uma animação acima da cabeça (o texto já no maior tamanho que cabe). */
export function htmlDoMomento(m: MomentoNaTela, medir: Medir): string {
  const id = `g-${esc(m.id)}`;
  if (m.tipo === 'lista') {
    const tamItem = Math.min(
      ...m.itens.map((i) => caber(medir, i.texto, 860 - 56 - 54 - 22, [46, 42, 38, 34, 30])),
    );
    const cab = m.titulo
      ? `<div class="cab" style="font-size: ${caber(medir, m.titulo, 860, [62, 56, 50, 44])}px">${esc(m.titulo)}</div>`
      : '';
    const itens = m.itens
      .map(
        (i) =>
          `<div class="item" style="font-size: ${tamItem}px"><span class="marca">${CHECK}</span><span>${esc(i.texto)}</span></div>`,
      )
      .join('');
    return `<div class="grafico" id="${id}">${cab}<div class="itens">${itens}</div></div>`;
  }
  if (m.tipo === 'nomes') {
    const tam = Math.min(...m.itens.map((i) => caber(medir, i.texto, 420 - 64, [44, 40, 36, 32, 28, 24])));
    const cab = m.titulo
      ? `<div class="cab" style="font-size: ${caber(medir, m.titulo, 860, [62, 56, 50, 44])}px">${esc(m.titulo)}</div>`
      : '';
    const nomes = m.itens
      .map((i) => `<div class="nome" style="font-size: ${tam}px"><span>${esc(i.texto)}</span></div>`)
      .join('');
    return `<div class="grafico" id="${id}">${cab}<div class="nomes">${nomes}</div></div>`;
  }
  if (m.tipo === 'compara' || m.tipo === 'troca') {
    const [a, b] = m.itens;
    if (!a || !b) return '';
    if (m.tipo === 'compara') {
      const tam = Math.min(...[a, b].map((i) => caber(medir, i.texto, 372 - 48, [52, 46, 40, 34, 28, 24])));
      return `<div class="grafico" id="${id}"><div class="compara" style="font-size: ${tam}px">
    <div class="lado antes"><span>${esc(a.texto)}</span></div>
    <div class="seta"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
    <div class="lado depois"><span>${esc(b.texto)}</span></div>
  </div></div>`;
    }
    return `<div class="grafico" id="${id}"><div class="troca">
    <div class="sai" style="font-size: ${caber(medir, a.texto, 860 - 80, [56, 50, 44, 38, 32])}px"><span>${esc(a.texto)}<i class="risco"></i></span></div>
    <div class="entra" style="font-size: ${caber(medir, b.texto, 860 - 92, [76, 68, 60, 52, 44, 36])}px">${esc(b.texto)}</div>
  </div></div>`;
  }
  if (m.tipo === 'numero') {
    const tamValor = caber(medir, m.numero, 860, [250, 220, 190, 160, 130]);
    const linha = m.titulo
      ? `<div class="linha-num" style="font-size: ${caber(medir, m.titulo, 860, [58, 52, 46, 40])}px">${esc(m.titulo)}</div>`
      : '';
    return `<div class="grafico" id="${id}"><div class="valor" style="font-size: ${tamValor}px">${esc(m.numero)}</div>${linha}</div>`;
  }
  if (m.tipo === 'selo')
    return `<div class="grafico" id="${id}"><div class="selo" style="font-size: ${caber(medir, m.titulo, 860 - 92, [64, 56, 48, 42])}px">${esc(m.titulo)}</div></div>`;
  const o = m.oferta;
  if (!o) return '';
  const largura = 860 - 88;
  return `<div class="grafico" id="${id}"><div class="oferta">
    ${o.produto ? `<div class="produto" style="font-size: ${caber(medir, o.produto, largura * 1.8, [56, 50, 44, 38])}px">${esc(o.produto)}</div>` : ''}
    ${o.precoDe ? `<div class="de">de ${esc(o.precoDe)}</div>` : ''}
    ${o.precoPor ? `<div class="por" style="font-size: ${caber(medir, `por ${o.precoPor}`, largura, [120, 104, 90, 76])}px">por ${esc(o.precoPor)}</div>` : ''}
    ${o.validade ? `<div class="validade">${esc(o.validade)}</div>` : ''}
  </div></div>`;
}

export function montarComposicao(e: EntradaComposicao): string {
  const primaria = cor(e.marca.primaria, '#7c3aed');
  const destaque = cor(e.marca.destaque, '#f97316');
  const escura = escurecer(primaria, 0.55);
  const D = Math.round(e.duracao * 1000) / 1000;
  const total = duracaoTotal(e);
  const titulo = e.titulo?.usar && e.titulo.linhas.length ? e.titulo : null;
  const cartaoTitulo = e.diagrama.cartoes.find((c) => c.id === 'abertura');
  const tarja = e.tarja?.nome && e.diagrama.cartoes.some((c) => c.id === 'tarja') ? e.tarja : null;
  const usa = (estilo: string) => (e.apoios ?? []).some((x) => x.estilo === estilo);
  // v167: a cor das palavras em destaque da legenda (escolhida na revisão, ou a de destaque da marca).
  const forte = cor(e.legenda?.corForte ?? '', destaque);
  const dados = {
    D,
    T: e.diagrama.transicao,
    estilo: e.estilo,
    cores: { primaria, destaque },
    cartoes: e.diagrama.cartoes,
    legenda: {
      texto: e.legenda?.corTexto ?? null,
      contorno: e.legenda?.corContorno ?? null,
      forte: forte,
    },
    dxAnimacoes: Math.round(e.desloc?.animacoes ?? 0),
    dxTitulo: Math.round(e.desloc?.titulo ?? 0),
    legendas: e.diagrama.legendas.map((l, n) => ({
      ini: l.ini,
      fim: l.fim,
      topo: l.topo,
      dx: Math.round(e.legenda?.trechos[n]?.dx ?? 0),
      esc: e.legenda?.trechos[n]?.escala ?? 1,
      tam: l.tam,
      gap: espacoEntre(l.tam),
      linhas: l.linhas.map((ln) =>
        ln.map((n) => l.palavras[n]!).map((p) => [p.t, p.i, p.f, p.forte ? 1 : 0]),
      ),
    })),
    titulo: titulo && cartaoTitulo ? { ...titulo, ini: cartaoTitulo.ini, fim: cartaoTitulo.fim } : null,
    chamada: e.chamada,
    momentos: (e.momentos ?? []).map((m) => ({
      id: m.id,
      tipo: m.tipo,
      ini: m.ini,
      fim: m.fim,
      itens: m.itens,
      ancora: m.ancora,
    })),
    imagens: (e.imagens ?? []).map((i) => ({ id: i.id, ini: i.ini, fim: i.fim, encaixe: i.encaixe })),
    deslizar: e.transicao === 'deslizar',
    empurroes: e.empurroes ?? [],
    apoios: (e.apoios ?? []).filter((x) => ['zoom', 'clarao', 'chicote', 'luz', 'glitch'].includes(x.estilo)),
    filme: e.acabamento === 'filme',
    tarja: tarja ? { ini: tarja.ini, fim: tarja.fim } : null,
  };
  const medir = e.medir ?? estimar;
  const graficos = (e.momentos ?? [])
    .filter((m) => m.tipo !== 'destaque')
    .map((m) => htmlDoMomento(m, medir))
    .join('\n');
  const fotosAcima = (e.imagens ?? [])
    .filter((i) => i.encaixe === 'acima')
    .map(
      (i) =>
        `<div class="grafico" id="g-img-${esc(i.id)}"><div class="foto-acima"><img src="${esc(i.arquivo)}" alt="" /></div></div>`,
    )
    .join('\n');
  const fotosCheias = (e.imagens ?? [])
    .filter((i) => i.encaixe === 'cheia')
    .map(
      (i) => `<div class="foto-cheia" id="c-img-${esc(i.id)}"><img src="${esc(i.arquivo)}" alt="" /></div>`,
    )
    .join('\n');
  const a = e.arquivos;
  return `<!doctype html>
<html lang="pt-BR" data-resolution="portrait">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=1080, height=1920" />
<script src="${esc(a.gsap)}"></script>
<style>
@font-face { font-family: "Legenda"; font-weight: 800; src: url("${esc(a.fonte800)}") format("woff2"); }
@font-face { font-family: "Legenda"; font-weight: 900; src: url("${esc(a.fonte900)}") format("woff2"); }
${
  a.fonteLegenda800 && a.fonteLegenda900
    ? `@font-face { font-family: "LegendaEscolhida"; font-weight: 800; src: url("${esc(a.fonteLegenda800)}") format("woff2"); }
@font-face { font-family: "LegendaEscolhida"; font-weight: 900; src: url("${esc(a.fonteLegenda900)}") format("woff2"); }
#legendas { font-family: "LegendaEscolhida", "Legenda", sans-serif; }`
    : ''
}
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 1080px; height: 1920px; overflow: hidden; background: #000; }
#root { position: relative; width: 1080px; height: 1920px; overflow: hidden; font-family: "Legenda", sans-serif; }
.clip { position: absolute; inset: 0; }
#fundo-marca { position: absolute; inset: 0; background: radial-gradient(120% 70% at 50% 0%, ${primaria} 0%, ${escura} 100%); }
#camada-video { position: absolute; left: 0; top: 0; width: 1080px; height: 1920px; overflow: hidden; transform-origin: 0 0; isolation: isolate; }
#camada-video video { width: 1080px; height: 1920px; object-fit: cover; display: block; }
#pulso { width: 1080px; height: 1920px; transform-origin: 50% 42%; }
#clarao { position: absolute; inset: 0; background: #fff; opacity: 0; pointer-events: none; }
#sombra-baixo { position: absolute; left: 0; right: 0; bottom: 0; height: 620px; background: linear-gradient(to top, rgba(0,0,0,.5), rgba(0,0,0,0)); }
#legendas { position: absolute; inset: 0; }
.bloco { position: absolute; left: 110px; width: 860px; display: flex; flex-direction: column; align-items: center; opacity: 0; transform-origin: 50% 0; }
.linha { display: flex; justify-content: center; }
.pal { position: relative; display: inline-block; line-height: 1.12; color: #fff; isolation: isolate; }
.e-acesa .pal { font-weight: 900; text-transform: uppercase; letter-spacing: -.01em; padding: 0 14px; paint-order: stroke fill; filter: drop-shadow(0 8px 16px rgba(0,0,0,.45)); }
.e-acesa .pal.forte { color: ${forte}; }
.e-acesa .fundo { position: absolute; inset: 4px 0 4px 0; border-radius: 16px; background: ${cor(e.legenda?.corAcesa ?? '', primaria)}; z-index: -1; transform: scale(.6); opacity: 0; }
.e-acesa .pal.forte .fundo { background: ${forte}; }
.e-simples .pal { font-weight: 800; line-height: 1.18; paint-order: stroke fill; filter: drop-shadow(0 6px 12px rgba(0,0,0,.5)); }
.e-simples .pal.forte { color: ${forte}; }
/* v167: a caixa do balão e do karaokê é um elemento de dentro (o bloco tem a largura da legenda): antes a frase larga saía da caixa. */
.e-balao .caixa { background: #fff; border-radius: 28px; padding: 20px 28px; box-shadow: 0 16px 40px rgba(0,0,0,.3); }
.e-balao .pal { font-weight: 800; color: #18181b; line-height: 1.25; }
.e-balao .pal.forte { color: ${e.legenda?.corForte ? forte : primaria}; }
.e-pilula .caixa { background: rgba(12,10,20,.84); border-radius: 30px; padding: 20px 28px; box-shadow: 0 16px 40px rgba(0,0,0,.35); }
.e-pilula .pal { font-weight: 800; line-height: 1.3; padding: 0 12px; opacity: .55; }
.e-pilula .pal.forte { color: ${forte}; }
.e-pilula .fundo { position: absolute; inset: 5px 0 5px 0; border-radius: 14px; background: ${cor(e.legenda?.corAcesa ?? '', primaria)}; z-index: -1; opacity: 0; }
.e-impacto .pal { font-weight: 900; text-transform: uppercase; letter-spacing: -.02em; line-height: 1.02; paint-order: stroke fill; opacity: 0; filter: drop-shadow(0 10px 20px rgba(0,0,0,.5)); }
.e-impacto .pal.forte { color: ${forte}; }
#vinheta { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(ellipse at 50% 46%, transparent 52%, rgba(0,0,0,.5) 100%); }
#grao { position: absolute; inset: 0; overflow: hidden; pointer-events: none; mix-blend-mode: overlay; opacity: .34; }
#grao div { position: absolute; left: -50%; top: -50%; width: 200%; height: 200%; background: url("data:image/svg+xml,%3Csvg viewBox='0 0 320 320' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); background-size: 320px 320px; }
#luz { position: absolute; inset: -16%; opacity: 0; overflow: hidden; pointer-events: none; mix-blend-mode: screen; }
#luz div { position: absolute; inset: -20%; }
#luz .l1 { background: radial-gradient(ellipse 52% 110% at 10% 58%, rgba(255,241,197,.92), transparent 45%), radial-gradient(ellipse 72% 120% at 24% 54%, rgba(255,126,57,.78), transparent 66%); filter: blur(30px); }
#luz .l2 { background: radial-gradient(ellipse 58% 105% at 78% 34%, rgba(255,79,61,.72), rgba(255,44,92,.28) 48%, transparent 76%); filter: blur(44px); }
#luz .l3 { background: linear-gradient(104deg, transparent 24%, rgba(255,144,62,.3) 40%, rgba(255,247,205,.72) 51%, rgba(255,124,48,.22) 62%, transparent 78%); filter: blur(22px); }
#riscas { position: absolute; inset: 0; opacity: 0; pointer-events: none; mix-blend-mode: difference; background: repeating-linear-gradient(0deg, rgba(255,255,255,.16) 0 6px, transparent 6px 22px); }
.filtros { position: absolute; width: 0; height: 0; }
.tarja { align-self: flex-start; display: flex; align-items: stretch; gap: 16px; }
.tarja-barra { width: 12px; border-radius: 6px; background: ${destaque}; transform-origin: 50% 100%; }
.tarja-textos { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; overflow: hidden; }
.tarja-nome { padding: 12px 26px 14px; border-radius: 16px; background: rgba(12,10,20,.92); color: #fff; font-weight: 900; line-height: 1; white-space: nowrap; letter-spacing: -.01em; box-shadow: 0 12px 30px rgba(0,0,0,.3); }
.tarja-cargo { padding: 9px 22px 10px; border-radius: 12px; background: ${primaria}; color: #fff; font-weight: 800; line-height: 1; white-space: nowrap; box-shadow: 0 12px 30px rgba(0,0,0,.3); }
#abertura { position: absolute; left: 0; right: 0; display: flex; flex-direction: column; align-items: center; gap: 18px; transform-origin: 50% 0; }
.titulo { display: flex; flex-direction: column; align-items: center; gap: .12em; font-weight: 900; line-height: .95; color: #fff; text-align: center; letter-spacing: -.02em; }
/* v138: cada linha numa placa (lê em qualquer fundo: azulejo branco, céu, loja clara). */
.titulo span { display: inline-block; padding: .1em .3em .14em; border-radius: .2em; background: rgba(12,10,20,.9); box-shadow: 0 12px 34px rgba(0,0,0,.35); }
.titulo span:last-child { background: ${primaria}; }
.traco { width: 0; height: 12px; border-radius: 6px; background: ${destaque}; }
#fim { position: absolute; inset: 0; opacity: 0; }
#fim .fundo-img { position: absolute; inset: -40px; background: url("${esc(a.ultimoQuadro)}") center/cover; filter: blur(28px) brightness(.55) saturate(1.2); }
#fim .tinta { position: absolute; inset: 0; background: linear-gradient(160deg, ${primaria}d9, ${escura}eb); }
#fim .meio { position: absolute; left: 90px; right: 90px; top: 640px; display: flex; flex-direction: column; gap: 48px; }
.frase { font-weight: 900; font-size: 112px; line-height: 1.0; color: #fff; letter-spacing: -.02em; }
.cta { align-self: flex-start; display: flex; align-items: center; gap: 22px; background: #fff; color: ${escura}; border-radius: 999px; padding: 26px 44px; font-weight: 900; font-size: 54px; box-shadow: 0 20px 50px rgba(0,0,0,.35); }
.cta svg { width: 54px; height: 54px; }
#cheias, #enfeites { position: absolute; inset: 0; }
.foto-cheia { position: absolute; inset: 0; opacity: 0; overflow: hidden; }
.foto-cheia img, .foto-acima img { width: 100%; height: 100%; object-fit: cover; display: block; }
.grafico { position: absolute; left: 110px; width: 860px; display: flex; flex-direction: column; align-items: center; transform-origin: 50% 0; opacity: 0; }
.foto-acima { width: 860px; height: 540px; border-radius: 36px; overflow: hidden; border: 6px solid #fff; box-shadow: 0 24px 60px rgba(0,0,0,.4); }
.cab { font-weight: 900; color: #fff; text-align: center; line-height: 1; letter-spacing: -.01em; margin-bottom: 22px; text-shadow: 0 6px 24px rgba(0,0,0,.5); }
.itens { width: 100%; display: flex; flex-direction: column; gap: 16px; }
.item { display: flex; align-items: center; gap: 22px; height: 96px; padding: 0 28px; border-radius: 24px; background: rgba(255,255,255,.9); color: #18181b; border-left: 12px solid ${primaria}; font-weight: 900; box-shadow: 0 12px 30px rgba(0,0,0,.25); }
.marca { width: 54px; height: 54px; flex: none; border-radius: 50%; border: 5px solid #3f3f3b; display: grid; place-items: center; }
.marca svg { width: 30px; height: 30px; opacity: 0; }
.nomes { width: 100%; display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.nome { height: 96px; padding: 0 32px; border-radius: 999px; background: ${primaria}; color: #fff; font-weight: 900; display: grid; place-items: center; white-space: nowrap; overflow: hidden; box-shadow: 0 12px 30px rgba(0,0,0,.28); border-bottom: 8px solid ${destaque}; opacity: 0; }
.nome:last-child:nth-child(odd) { grid-column: 1 / -1; justify-self: center; width: 420px; }
.compara { width: 100%; display: grid; grid-template-columns: 372px 76px 372px; gap: 20px; align-items: center; font-weight: 900; }
.lado { height: 210px; border-radius: 32px; display: grid; place-items: center; text-align: center; padding: 0 24px; line-height: 1.05; box-shadow: 0 18px 44px rgba(0,0,0,.35); overflow: hidden; }
.lado.antes { background: #fff; color: #27272a; }
.lado.depois { background: ${primaria}; color: #fff; opacity: 0; }
.seta { width: 76px; height: 76px; border-radius: 50%; background: ${destaque}; display: grid; place-items: center; opacity: 0; box-shadow: 0 10px 26px rgba(0,0,0,.35); }
.seta svg { width: 44px; height: 44px; }
.troca { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 18px; font-weight: 900; }
.troca .sai { padding: 20px 40px; border-radius: 24px; background: #fff; color: #27272a; white-space: nowrap; box-shadow: 0 12px 30px rgba(0,0,0,.28); }
.troca .sai span { position: relative; display: inline-block; }
.troca .risco { position: absolute; left: -10px; right: -10px; top: 50%; height: 9px; margin-top: -4px; border-radius: 5px; background: ${destaque}; transform-origin: 0 50%; transform: scaleX(0); }
.troca .entra { padding: 24px 46px; border-radius: 28px; background: ${primaria}; color: #fff; white-space: nowrap; box-shadow: 0 18px 44px rgba(0,0,0,.35); opacity: 0; }
.valor { font-weight: 900; line-height: .9; color: ${destaque}; letter-spacing: -.04em; -webkit-text-stroke: 10px rgba(10,0,25,.9); paint-order: stroke fill; filter: drop-shadow(0 12px 30px rgba(0,0,0,.45)); }
.linha-num { font-weight: 900; color: #fff; text-align: center; margin-top: 10px; text-shadow: 0 6px 24px rgba(0,0,0,.5); }
.selo { padding: 22px 46px; border-radius: 999px; background: ${primaria}; color: #fff; font-weight: 900; transform: rotate(-4deg); box-shadow: 0 18px 44px rgba(0,0,0,.35); white-space: nowrap; }
.oferta { width: 100%; background: #fff; border-radius: 36px; padding: 32px 44px; display: flex; flex-direction: column; align-items: center; gap: 8px; box-shadow: 0 24px 60px rgba(0,0,0,.4); }
.oferta .produto { font-weight: 900; color: #18181b; text-align: center; line-height: 1.05; }
.oferta .de { font-weight: 800; font-size: 42px; color: #6b6b66; text-decoration: line-through; }
.oferta .por { font-weight: 900; color: ${primaria}; line-height: 1; }
.oferta .validade { font-weight: 800; font-size: 34px; color: ${escura}; background: ${destaque}33; padding: 6px 22px; border-radius: 999px; }
</style>
</head>
<body>
<svg class="filtros" aria-hidden="true"><defs>
  <filter id="f-chicote" x="-20%" y="0" width="140%" height="100%"><feGaussianBlur id="f-chicote-b" stdDeviation="0 0" /></filter>
  <filter id="f-rgb" x="-5%" y="0" width="110%" height="100%" color-interpolation-filters="sRGB">
    <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
    <feOffset id="f-rgb-r" in="r" dx="0" dy="0" result="r2" />
    <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" result="gb" />
    <feOffset id="f-rgb-gb" in="gb" dx="0" dy="0" result="gb2" />
    <feBlend in="r2" in2="gb2" mode="screen" />
  </filter>
</defs></svg>
<div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-width="1080" data-height="1920">
  <div id="fundo-marca" class="clip" data-start="0" data-duration="${D}" data-track-index="0"></div>
  <div id="camada-video">
    <div id="pulso"><video id="fala" src="${esc(a.video)}" data-start="0" data-duration="${D}" data-has-audio="true"></video></div>
    ${usa('luz') ? '<div id="luz"><div class="l1"></div><div class="l2"></div><div class="l3"></div></div>' : ''}
    ${usa('glitch') ? '<div id="riscas"></div>' : ''}
    ${e.acabamento === 'filme' ? '<div id="vinheta"></div><div id="grao"><div></div></div>' : ''}
    <div id="clarao"></div>
    <div id="sombra-baixo"></div>
  </div>
  ${
    titulo
      ? `<div id="abertura" data-start="0" data-duration="${Math.min(D, (cartaoTitulo?.fim ?? 2.3) + 0.3)}" data-track-index="2">
    <div class="titulo" style="font-size: ${titulo.tam}px">${titulo.linhas.map((l) => `<span>${esc(l)}</span>`).join('')}</div>
    <div class="traco"></div>
  </div>`
      : ''
  }
  ${fotosCheias ? `<div id="cheias" data-start="0" data-duration="${D}" data-track-index="3">\n${fotosCheias}\n</div>` : ''}
  ${
    tarja
      ? `<div id="camada-tarja" style="position: absolute; inset: 0" data-start="0" data-duration="${D}" data-track-index="3"><div class="grafico" id="g-tarja"><div class="tarja">
      <div class="tarja-barra"></div>
      <div class="tarja-textos">
        <div class="tarja-nome" style="font-size: ${caber(medir, tarja.nome, 760, [64, 58, 52, 46, 40])}px">${esc(tarja.nome)}</div>
        ${tarja.cargo ? `<div class="tarja-cargo" style="font-size: ${caber(medir, tarja.cargo, 780, [40, 36, 32, 28])}px">${esc(tarja.cargo)}</div>` : ''}
      </div>
    </div></div></div>`
      : ''
  }
  ${graficos || fotosAcima ? `<div id="enfeites" data-start="0" data-duration="${D}" data-track-index="3">\n${graficos}\n${fotosAcima}\n</div>` : ''}
  <div id="legendas" data-start="0" data-duration="${D}" data-track-index="4"></div>
  ${
    e.chamada
      ? `<div id="fim" data-start="${Math.max(0, D - 0.2)}" data-duration="${DURACAO_CHAMADA + 0.2}" data-track-index="5">
    <div class="fundo-img"></div>
    <div class="tinta"></div>
    <div class="meio">
      ${e.chamada.frase ? `<div class="frase">${esc(e.chamada.frase)}</div>` : ''}
      ${
        e.chamada.botao
          ? `<div class="cta"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H8l-4 4z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/></svg>${esc(e.chamada.botao)}</div>`
          : ''
      }
    </div>
  </div>`
      : ''
  }
</div>
<script id="dados" type="application/json">${jsonNoScript(dados)}</script>
<script>
const DADOS = JSON.parse(document.getElementById('dados').textContent);
const T = DADOS.T;
const tl = gsap.timeline({ paused: true });

// O vídeo vira cartão quando o gráfico precisa de espaço.
gsap.set('#camada-video', { x: 0, y: 0, scale: 1, borderRadius: 0 });
for (const c of DADOS.cartoes) {
  if (c.s >= 1) continue;
  const alvo = { x: c.tx, y: c.ty, scale: c.s, borderRadius: 44, boxShadow: '0 30px 80px rgba(0,0,0,.45)' };
  if (c.ini <= 0) tl.set('#camada-video', alvo, 0);
  else tl.to('#camada-video', { ...alvo, duration: T, ease: 'power3.inOut' }, c.ini);
  if (c.fim < DADOS.D - 0.05)
    tl.to('#camada-video', { x: 0, y: 0, scale: 1, borderRadius: 0, boxShadow: '0 0 0 rgba(0,0,0,0)', duration: T, ease: 'power3.inOut' }, c.fim - T);
}

// A câmera chegando devagar em cada plano (o queixo fica parado; nada encosta no rosto).
// v165: o corte para o vídeo de apoio e de volta. Aproximação: um impulso de zoom com desfoque que
// assenta em 0,3 s. Clarão: um flash de luz que some em 0,28 s.
for (const a of DADOS.apoios) {
  for (const t of [a.ini, a.fim]) {
    if (t >= DADOS.D - 0.2) continue;
    if (a.estilo === 'zoom')
      tl.fromTo('#pulso', { scale: 1.16, filter: 'blur(7px)' }, { scale: 1, filter: 'blur(0px)', duration: 0.3, ease: 'power3.out', immediateRender: false }, t);
    else if (a.estilo === 'chicote') {
      // v167: a câmera "vira" de lado: borrão horizontal forte que assenta em 0,34 s (entra por um
      // lado e sai pelo outro).
      const lado = t === a.ini ? 1 : -1;
      tl.set('#pulso', { filter: 'url(#f-chicote)' }, t);
      tl.fromTo('#f-chicote-b', { attr: { stdDeviation: '70 0' } }, { attr: { stdDeviation: '0 0' }, duration: 0.34, ease: 'power3.out', immediateRender: false }, t);
      tl.fromTo('#pulso', { x: lado * 150, scale: 1.3 }, { x: 0, scale: 1, duration: 0.34, ease: 'power4.out', immediateRender: false }, t);
      tl.set('#pulso', { filter: 'none' }, t + 0.35);
    } else if (a.estilo === 'luz') {
      // v167: uma luz quente atravessa a tela e o corte acontece no auge dela.
      const antes = Math.max(0, t - 0.22);
      tl.fromTo('#luz', { opacity: 0 }, { opacity: 0.95, duration: t - antes || 0.01, ease: 'sine.out', immediateRender: false }, antes);
      tl.to('#luz', { opacity: 0, duration: 0.5, ease: 'sine.in' }, t);
      tl.fromTo('#luz .l1', { xPercent: -24, rotation: -4 }, { xPercent: 20, rotation: 2, duration: 0.72, ease: 'sine.inOut', immediateRender: false }, antes);
      tl.fromTo('#luz .l2', { xPercent: 22, yPercent: -8 }, { xPercent: -16, yPercent: 8, duration: 0.72, ease: 'sine.inOut', immediateRender: false }, antes);
      tl.fromTo('#luz .l3', { xPercent: -30 }, { xPercent: 26, duration: 0.72, ease: 'sine.inOut', immediateRender: false }, antes);
    } else if (a.estilo === 'glitch') {
      // v167: por 0,2 s as cores se separam, a imagem treme e aparecem riscas.
      const passos = [[34, 0], [-26, 5], [18, -3], [-10, 2], [0, 0]];
      tl.set('#pulso', { filter: 'url(#f-rgb)' }, t);
      passos.forEach(([dx, inclina], n) => {
        const em = t + n * 0.045;
        tl.set('#f-rgb-r', { attr: { dx: dx } }, em);
        tl.set('#f-rgb-gb', { attr: { dx: -dx } }, em);
        tl.set('#pulso', { x: dx * 0.5, skewX: inclina }, em);
      });
      tl.fromTo('#riscas', { opacity: 1 }, { opacity: 0, duration: 0.2, ease: 'steps(4)', immediateRender: false }, t);
      tl.set('#pulso', { filter: 'none', x: 0, skewX: 0 }, t + 0.2);
    } else tl.fromTo('#clarao', { opacity: 0.85 }, { opacity: 0, duration: 0.28, ease: 'power2.out', immediateRender: false }, t);
  }
}
// v167: a granulação muda de lugar 12 vezes por segundo (sorteio fixo: o render sai sempre igual).
if (DADOS.filme) {
  let semente = 20261117;
  const sorte = () => ((semente = (semente * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let t = 0; t < DADOS.D; t += 1 / 12) tl.set('#grao div', { x: Math.round(sorte() * 300 - 150), y: Math.round(sorte() * 300 - 150) }, t);
}
for (const p of DADOS.empurroes) {
  tl.set('#camada-video', { transformOrigin: p.ox + 'px ' + p.oy + 'px', scale: 1 }, p.ini);
  tl.to('#camada-video', { scale: 1.04, duration: Math.max(0.1, p.fim - p.ini), ease: 'none' }, p.ini);
}

// Legenda.
const caixa = document.getElementById('legendas');
for (const L of DADOS.legendas) {
  const b = document.createElement('div');
  b.className = 'bloco e-' + DADOS.estilo;
  b.style.top = L.topo + 'px';
  const emCaixa = DADOS.estilo === 'balao' || DADOS.estilo === 'pilula';
  if (L.dx) b.style.left = (110 + L.dx) + 'px';
  const dentro = emCaixa ? b.appendChild(Object.assign(document.createElement('div'), { className: 'caixa' })) : b;
  caixa.appendChild(b);
  // v166: a cor do texto e do contorno escolhidas (o balão tem a letra escura dele).
  const corTexto = DADOS.estilo !== 'balao' && DADOS.legenda.texto ? DADOS.legenda.texto : '#ffffff';
  const corContorno = DADOS.legenda.contorno || 'rgba(10,0,25,.92)';
  const els = [];
  for (const linha of L.linhas) {
    const ln = document.createElement('div');
    ln.className = 'linha';
    ln.style.columnGap = L.gap + 'px';
    dentro.appendChild(ln);
    for (const [txt, i, f, forte] of linha) {
      const s = document.createElement('span');
      s.className = 'pal' + (forte ? ' forte' : '');
      s.style.fontSize = L.tam + 'px';
      if (DADOS.estilo === 'acesa') s.style.webkitTextStroke = Math.round(L.tam * 0.13) + 'px ' + corContorno;
      if (DADOS.estilo === 'impacto') s.style.webkitTextStroke = Math.round(L.tam * 0.1) + 'px ' + corContorno;
      if (DADOS.estilo === 'simples') s.style.webkitTextStroke = Math.round(L.tam * 0.09) + 'px ' + corContorno;
      if (DADOS.estilo !== 'balao' && !forte) s.style.color = corTexto;
      s.textContent = txt;
      const fundo = document.createElement('span');
      fundo.className = 'fundo';
      s.appendChild(fundo);
      ln.appendChild(s);
      els.push({ s, fundo, i, f, forte });
    }
  }
  tl.fromTo(b, { opacity: 0, y: 22, scale: 0.92 * L.esc }, { opacity: 1, y: 0, scale: L.esc, duration: 0.14, ease: 'back.out(2)' }, L.ini);
  tl.set(b, { opacity: 0 }, L.fim);
  // v167: karaokê (a palavra falada acende e as já ditas ficam claras) e impacto (cada palavra bate
  // na tela quando é falada).
  if (DADOS.estilo === 'pilula') {
    for (const { s, fundo, i, f } of els) {
      tl.to(s, { opacity: 1, duration: 0.06 }, i);
      tl.to(fundo, { opacity: 1, duration: 0.08 }, i);
      tl.to(fundo, { opacity: 0, duration: 0.1 }, f);
    }
    continue;
  }
  if (DADOS.estilo === 'impacto') {
    for (const { s, i, forte } of els)
      tl.fromTo(s, { opacity: 0, scale: forte ? 2.1 : 1.7 }, { opacity: 1, scale: 1, duration: 0.13, ease: 'power4.out', immediateRender: false }, Math.max(L.ini, i - 0.02));
    continue;
  }
  if (DADOS.estilo !== 'acesa') continue;
  for (const { s, fundo, i, f, forte } of els) {
    tl.to(fundo, { opacity: 1, scale: 1, duration: 0.09, ease: 'back.out(3)' }, i);
    tl.fromTo(s, { scale: 1 }, { scale: forte ? 1.12 : 1.06, duration: 0.09, ease: 'power2.out' }, i);
    tl.set(s, { color: corTexto }, i);
    tl.to(s, { scale: 1, duration: 0.12, ease: 'power2.inOut' }, Math.max(i + 0.09, f - 0.06));
    tl.to(fundo, { opacity: 0, scale: 0.85, duration: 0.08 }, f);
    tl.set(s, { color: forte ? DADOS.legenda.forte : corTexto }, f);
  }
}

// Título de abertura.
if (DADOS.titulo) {
  const c = DADOS.cartoes.find((x) => x.id === 'abertura');
  if (c && c.escala <= 0) gsap.set('#abertura', { display: 'none' });
  else if (c) gsap.set('#abertura', { top: c.topo, scale: c.escala, left: DADOS.dxTitulo, right: -DADOS.dxTitulo });
  tl.from('#abertura .titulo span', { opacity: 0, y: 36, duration: 0.45, ease: 'power3.out', stagger: 0.12 }, 0.1);
  tl.to('#abertura .traco', { width: 340, duration: 0.45, ease: 'power3.inOut' }, 0.45);
  // Sai antes do cartão voltar para a tela cheia, para nunca encostar na cabeça.
  tl.to('#abertura', { opacity: 0, y: -50, duration: 0.25, ease: 'power2.in' }, Math.max(0.8, DADOS.titulo.fim - T - 0.3));
}

// Animações e imagens acima da cabeça: entram depois do cartão (quando há) e saem antes dele voltar.
const cartaoDe = (id) => DADOS.cartoes.find((x) => x.id === id);
function porNoLugar(sel, id, ini, fim, deslizar) {
  const c = cartaoDe(id);
  const el = document.querySelector(sel);
  if (!el) return null;
  // Sem espaço nenhum na tela (v137): o gráfico fica de fora.
  if (c && c.escala <= 0) {
    gsap.set(el, { display: 'none' });
    return null;
  }
  if (c) gsap.set(el, { top: c.topo, scale: c.escala });
  // v166: as animações arrastadas para o lado (as imagens e a oferta acompanham).
  if (DADOS.dxAnimacoes) gsap.set(el, { left: 110 + DADOS.dxAnimacoes });
  const entra = ini + (c && c.s < 1 ? T * 0.7 : 0);
  const sai = c && c.s < 1 ? Math.max(entra + 0.4, fim - T - 0.3) : Math.max(entra + 0.4, fim - 0.25);
  if (deslizar) tl.fromTo(el, { opacity: 1, x: 1080 }, { x: 0, duration: 0.45, ease: 'power3.out' }, entra);
  else tl.fromTo(el, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.35, ease: 'back.out(1.8)' }, entra);
  if (deslizar) tl.to(el, { x: -1080, duration: 0.3, ease: 'power2.in' }, sai);
  else tl.to(el, { opacity: 0, y: -40, duration: 0.25, ease: 'power2.in' }, sai);
  return { el, entra, sai };
}
const comCartao = (a, b) => DADOS.cartoes.some((c) => c.s < 1 && c.ini < b && a < c.fim);
let zooms = 0;
for (const m of DADOS.momentos) {
  if (m.tipo === 'destaque') {
    if (comCartao(m.ini, m.fim) || !m.ancora) continue;
    tl.set('#fala', { transformOrigin: m.ancora.x + 'px ' + m.ancora.y + 'px' }, m.ini);
    // v166: três jeitos de aproximar, revezando: o impulso seco, o empurrão lento e os dois degraus.
    const jeito = zooms++ % 3;
    const volta = Math.max(m.ini + 0.4, m.fim - 0.3);
    if (jeito === 0) {
      tl.to('#fala', { scale: 1.15, duration: 0.16, ease: 'power3.out' }, m.ini);
    } else if (jeito === 1) {
      tl.to('#fala', { scale: 1.13, duration: Math.max(0.4, volta - m.ini), ease: 'none' }, m.ini);
    } else {
      tl.to('#fala', { scale: 1.08, duration: 0.14, ease: 'power2.out' }, m.ini);
      tl.to('#fala', { scale: 1.17, duration: 0.14, ease: 'power2.out' }, Math.min(volta - 0.15, m.ini + Math.max(0.3, (volta - m.ini) / 2)));
    }
    tl.to('#fala', { scale: 1, duration: 0.3, ease: 'power2.inOut' }, volta);
    continue;
  }
  const lugar = porNoLugar('#g-' + m.id, m.id, m.ini, m.fim, false);
  if (!lugar) continue;
  const { el, entra } = lugar;
  if (m.tipo === 'lista') {
    const itens = el.querySelectorAll('.item');
    tl.from(itens, { opacity: 0, x: -40, duration: 0.25, ease: 'power2.out', stagger: 0.08 }, entra + 0.1);
    m.itens.forEach((it, n) => {
      const item = itens[n];
      if (!item) return;
      const t = Math.max(entra + 0.15 + n * 0.08, it.em);
      tl.to(item, { backgroundColor: '#ffffff', duration: 0.15 }, t);
      tl.to(item.querySelector('.marca'), { backgroundColor: DADOS.cores.destaque, borderColor: DADOS.cores.destaque, duration: 0.15 }, t);
      tl.fromTo(item.querySelector('.marca svg'), { opacity: 0, scale: 0.3 }, { opacity: 1, scale: 1, duration: 0.25, ease: 'back.out(3)' }, t);
      tl.fromTo(item, { scale: 1 }, { scale: 1.04, duration: 0.12, yoyo: true, repeat: 1, ease: 'sine.inOut' }, t);
    });
  } else if (m.tipo === 'nomes') {
    // Cada etiqueta salta para a tela na hora em que o nome é falado.
    const nomes = el.querySelectorAll('.nome');
    m.itens.forEach((it, n) => {
      const nome = nomes[n];
      if (!nome) return;
      const t = Math.max(entra + 0.1 + n * 0.06, it.em - 0.05);
      tl.fromTo(nome, { opacity: 0, scale: 0.5, y: 26 }, { opacity: 1, scale: 1, y: 0, duration: 0.32, ease: 'back.out(2.4)' }, t);
    });
  } else if (m.tipo === 'compara') {
    const t2 = Math.max(entra + 0.5, m.itens[1] ? m.itens[1].em - 0.05 : entra + 0.9);
    tl.from(el.querySelector('.antes'), { x: -60, opacity: 0, duration: 0.3, ease: 'power3.out' }, entra + 0.05);
    tl.fromTo(el.querySelector('.seta'), { opacity: 0, scale: 0.3 }, { opacity: 1, scale: 1, duration: 0.25, ease: 'back.out(3)' }, t2 - 0.12);
    tl.fromTo(el.querySelector('.depois'), { opacity: 0, x: 60, scale: 0.9 }, { opacity: 1, x: 0, scale: 1, duration: 0.35, ease: 'back.out(1.8)' }, t2);
    tl.to(el.querySelector('.antes'), { scale: 0.94, opacity: 0.75, duration: 0.3, ease: 'power2.out' }, t2);
  } else if (m.tipo === 'troca') {
    const t2 = Math.max(entra + 0.6, m.itens[1] ? m.itens[1].em - 0.05 : entra + 1);
    tl.to(el.querySelector('.risco'), { scaleX: 1, duration: 0.22, ease: 'power2.inOut' }, t2 - 0.25);
    tl.to(el.querySelector('.sai'), { scale: 0.86, opacity: 0.7, duration: 0.25, ease: 'power2.out' }, t2 - 0.05);
    tl.fromTo(el.querySelector('.entra'), { opacity: 0, scale: 0.5, y: 20 }, { opacity: 1, scale: 1, y: 0, duration: 0.38, ease: 'back.out(2.2)' }, t2);
  } else if (m.tipo === 'numero') {
    tl.fromTo(el.querySelector('.valor'), { scale: 0.4 }, { scale: 1, duration: 0.45, ease: 'back.out(2.2)' }, entra);
    tl.from(el.querySelector('.linha-num'), { opacity: 0, y: 20, duration: 0.3, ease: 'power2.out' }, entra + 0.25);
  } else if (m.tipo === 'selo') {
    tl.fromTo(el.querySelector('.selo'), { scale: 0, rotation: -14 }, { scale: 1, rotation: -4, duration: 0.4, ease: 'back.out(2.4)' }, entra);
  } else if (m.tipo === 'oferta') {
    // Cresce de menor para o tamanho certo: nunca passa da borda do cartão.
    tl.fromTo(el.querySelector('.por'), { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, ease: 'back.out(1.6)' }, entra + 0.3);
  }
}
for (const im of DADOS.imagens) {
  if (im.encaixe === 'acima') {
    const lugar = porNoLugar('#g-img-' + im.id, 'img:' + im.id, im.ini, im.fim, DADOS.deslizar);
    if (lugar) tl.fromTo(lugar.el.querySelector('img'), { scale: 1 }, { scale: 1.08, duration: im.fim - im.ini, ease: 'none' }, im.ini);
    continue;
  }
  const el = document.getElementById('c-img-' + im.id);
  if (!el) continue;
  if (DADOS.deslizar) {
    tl.fromTo(el, { opacity: 1, x: 1080 }, { x: 0, duration: 0.35, ease: 'power3.out' }, im.ini);
    tl.to(el, { x: -1080, duration: 0.3, ease: 'power2.in' }, Math.max(im.ini + 0.4, im.fim - 0.3));
  } else {
    tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: 'power1.out' }, im.ini);
    tl.to(el, { opacity: 0, duration: 0.2, ease: 'power1.in' }, Math.max(im.ini + 0.3, im.fim - 0.2));
  }
  tl.fromTo(el.querySelector('img'), { scale: 1.02 }, { scale: 1.1, duration: im.fim - im.ini, ease: 'none' }, im.ini);
}

// v167: a tarja com o nome de quem fala: a barra sobe, o nome e o cargo deslizam de trás dela.
if (DADOS.tarja) {
  const lugar = porNoLugar('#g-tarja', 'tarja', DADOS.tarja.ini, DADOS.tarja.fim, false);
  if (lugar) {
    tl.fromTo('#g-tarja .tarja-barra', { scaleY: 0 }, { scaleY: 1, duration: 0.3, ease: 'power3.out' }, lugar.entra);
    tl.fromTo('#g-tarja .tarja-nome', { x: -60, opacity: 0 }, { x: 0, opacity: 1, duration: 0.4, ease: 'power3.out' }, lugar.entra + 0.12);
    if (document.querySelector('#g-tarja .tarja-cargo'))
      tl.fromTo('#g-tarja .tarja-cargo', { x: -60, opacity: 0 }, { x: 0, opacity: 1, duration: 0.4, ease: 'power3.out' }, lugar.entra + 0.26);
  }
}

// Tela final com a chamada.
if (DADOS.chamada) {
  const ini = Math.max(0, DADOS.D - 0.2);
  tl.fromTo('#fim', { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'power1.out' }, ini);
  tl.fromTo('#fim .fundo-img', { scale: 1.0 }, { scale: 1.08, duration: ${DURACAO_CHAMADA}, ease: 'none' }, ini);
  if (document.querySelector('#fim .frase')) tl.from('#fim .frase', { opacity: 0, y: 50, duration: 0.45, ease: 'power3.out' }, ini + 0.15);
  if (document.querySelector('#fim .cta')) {
    tl.from('#fim .cta', { opacity: 0, y: 40, scale: 0.85, duration: 0.45, ease: 'back.out(2)' }, ini + 0.6);
    tl.fromTo('#fim .cta', { scale: 1 }, { scale: 1.05, duration: 0.3, ease: 'sine.inOut', yoyo: true, repeat: 3 }, ini + 1.2);
  }
}

window.__timelines = window.__timelines || {};
window.__timelines['main'] = tl;
tl.seek(0);
</script>
</body>
</html>
`;
}
