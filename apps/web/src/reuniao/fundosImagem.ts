import {
  CENAS_FUNDO,
  type ConfigFundos,
  type EstiloLogo,
  type LugarLogo,
  lugarDaLogo,
} from '@prospeccao/shared/fundos';

/**
 * Monta a imagem de um fundo (cenário ou foto da empresa, com a logo no lugar escolhido) num canvas.
 * Separado do resto para a tela do gestor usar sem carregar o motor da câmera.
 */

/** Dados para montar a imagem (a cor e a logo da marca, as fotos e onde a logo vai). */
export interface MarcaDoFundo {
  cor: string | null;
  logo: string | null;
  config: ConfigFundos;
  fotos: { id: number; url: string }[];
}

/* ---------- Montar a imagem do fundo (cenário + logo) ---------- */

const imagens = new Map<string, Promise<HTMLImageElement>>();

function carregar(url: string): Promise<HTMLImageElement> {
  let p = imagens.get(url);
  if (!p) {
    p = new Promise((ok, falhou) => {
      const i = new Image();
      i.decoding = 'async';
      i.onload = () => ok(i);
      i.onerror = () => falhou(new Error(`imagem ${url}`));
      i.src = url;
    });
    imagens.set(url, p);
    p.catch(() => imagens.delete(url));
  }
  return p;
}

/** A logo tem fundo transparente? (O adesivo na cor só funciona com transparência.) */
const transparencia = new WeakMap<HTMLImageElement, boolean>();
function temTransparencia(img: HTMLImageElement): boolean {
  const ja = transparencia.get(img);
  if (ja !== undefined) return ja;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  let r = false;
  if (ctx) {
    ctx.drawImage(img, 0, 0, 64, 64);
    const d = ctx.getImageData(0, 0, 64, 64).data;
    for (let i = 3; i < d.length; i += 4)
      if (d[i]! < 200) {
        r = true;
        break;
      }
  }
  transparencia.set(img, r);
  return r;
}

function retanguloArredondado(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Desenha a logo na caixa (sempre inteira, centralizada), no estilo escolhido. */
function desenharLogo(
  ctx: CanvasRenderingContext2D,
  logo: HTMLImageElement,
  caixa: { x: number; y: number; w: number; h: number },
  estilo: EstiloLogo,
  cor: string,
) {
  const transparente = temTransparencia(logo);
  const real = estilo === 'adesivo' && !transparente ? 'original' : estilo;
  const folga = real === 'placa' ? caixa.h * 0.16 : 0;
  const escala = Math.min(
    (caixa.w - folga * 2) / logo.naturalWidth,
    (caixa.h - folga * 2) / logo.naturalHeight,
  );
  const lw = logo.naturalWidth * escala;
  const lh = logo.naturalHeight * escala;
  const cx = caixa.x + caixa.w / 2;
  const cy = caixa.y + caixa.h / 2;
  ctx.save();
  if (real === 'placa') {
    const pw = lw + folga * 2;
    const ph = lh + folga * 2;
    ctx.shadowColor = 'rgba(0,0,0,.22)';
    ctx.shadowBlur = caixa.h * 0.18;
    ctx.shadowOffsetY = caixa.h * 0.05;
    ctx.fillStyle = '#ffffff';
    retanguloArredondado(ctx, cx - pw / 2, cy - ph / 2, pw, ph, Math.min(ph * 0.14, 18));
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.drawImage(logo, cx - lw / 2, cy - lh / 2, lw, lh);
  } else if (real === 'adesivo') {
    // A silhueta da logo na cor da marca, como um adesivo de vinil na parede.
    const t = document.createElement('canvas');
    t.width = Math.max(1, Math.round(lw));
    t.height = Math.max(1, Math.round(lh));
    const tc = t.getContext('2d')!;
    tc.drawImage(logo, 0, 0, t.width, t.height);
    tc.globalCompositeOperation = 'source-in';
    tc.fillStyle = cor;
    tc.fillRect(0, 0, t.width, t.height);
    ctx.globalAlpha = 0.94;
    ctx.drawImage(t, cx - lw / 2, cy - lh / 2, lw, lh);
  } else {
    ctx.shadowColor = 'rgba(0,0,0,.18)';
    ctx.shadowBlur = caixa.h * 0.12;
    ctx.shadowOffsetY = caixa.h * 0.03;
    if (!transparente) {
      retanguloArredondado(ctx, cx - lw / 2, cy - lh / 2, lw, lh, Math.min(lh * 0.1, 12));
      ctx.clip();
    }
    ctx.drawImage(logo, cx - lw / 2, cy - lh / 2, lw, lh);
  }
  ctx.restore();
}

/** Mistura duas cores #rrggbb (t: quanto da segunda). */
function misturar(a: string, b: string, t: number): string {
  const n = (h: string) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16) || 0);
  const [x, y] = [n(a), n(b)];
  return `#${x
    .map((v, i) =>
      Math.round(v + (y[i]! - v) * t)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** Parede pintada com a cor da marca (o cenário "Parede da marca"). */
function paredeDaMarca(ctx: CanvasRenderingContext2D, w: number, h: number, cor: string) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, misturar(cor, '#000000', 0.45));
  g.addColorStop(0.55, cor);
  g.addColorStop(1, misturar(cor, '#ffffff', 0.3));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,.06)';
  ctx.lineWidth = w * 0.025;
  for (let i = -6; i < 16; i++) {
    ctx.beginPath();
    ctx.moveTo(i * w * 0.09, h);
    ctx.lineTo(i * w * 0.09 + w * 0.32, 0);
    ctx.stroke();
  }
  const luz = ctx.createRadialGradient(w * 0.3, h * 0.25, 0, w * 0.3, h * 0.25, w * 0.7);
  luz.addColorStop(0, 'rgba(255,255,255,.14)');
  luz.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = luz;
  ctx.fillRect(0, 0, w, h);
}

function cobrir(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number) {
  const e = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const iw = img.naturalWidth * e;
  const ih = img.naturalHeight * e;
  ctx.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih);
}

const montadas = new Map<string, Promise<string>>();

/**
 * A imagem do fundo (data URL), já com a logo no lugar. `largura` 1280 para a câmera; menor para as
 * miniaturas. Guarda o resultado (a mesma escolha não é montada de novo).
 */
export function imagemDoFundo(id: string, m: MarcaDoFundo | null, largura = 1280): Promise<string> {
  const chave = JSON.stringify([id, largura, m?.cor, m?.logo, m?.config.lugares[id] ?? null]);
  let p = montadas.get(chave);
  if (!p) {
    p = montar(id, m, largura);
    montadas.set(chave, p);
    p.catch(() => montadas.delete(chave));
  }
  return p;
}

async function montar(id: string, m: MarcaDoFundo | null, largura: number): Promise<string> {
  const w = largura;
  const h = Math.round((largura * 9) / 16);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const [tipo, resto] = id.split(':') as [string, string];
  const cor = m?.cor ?? '#0b6b63';
  let lugar: LugarLogo | null = null;
  let estilo: EstiloLogo = 'placa';
  if (tipo === 'foto') {
    const foto = m?.fotos.find((f) => String(f.id) === resto);
    if (!foto) throw new Error('foto');
    cobrir(ctx, await carregar(foto.url), w, h);
    if (m) ({ lugar, estilo } = lugarDaLogo(m.config, id));
  } else {
    const cena = CENAS_FUNDO.find((x) => x.id === resto);
    if (!cena) throw new Error('cena');
    if (cena.arquivo) {
      // Um leve desfoque dá profundidade (como a lente faz com o que está atrás).
      ctx.filter = `blur(${Math.max(0.6, w / 900)}px)`;
      cobrir(ctx, await carregar(cena.arquivo), w, h);
      ctx.filter = 'none';
    } else paredeDaMarca(ctx, w, h, cor);
    if (tipo === 'logo' && m) ({ lugar, estilo } = lugarDaLogo(m.config, id));
  }
  if (lugar && m?.logo) {
    const logo = await carregar(m.logo).catch(() => null);
    if (logo) {
      if (lugar.base) {
        const b = lugar.base;
        ctx.fillStyle = b.cor;
        retanguloArredondado(ctx, b.x * w, b.y * h, b.w * w, b.h * h, (b.raio ?? 4) * (w / 1600));
        ctx.fill();
      }
      desenharLogo(
        ctx,
        logo,
        { x: lugar.x * w, y: lugar.y * h, w: lugar.w * w, h: lugar.h * h },
        estilo,
        cor,
      );
    }
  }
  return c.toDataURL('image/jpeg', 0.9);
}
