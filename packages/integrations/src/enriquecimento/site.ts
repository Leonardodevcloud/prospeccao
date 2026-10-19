import { cnpjValido, normalizarTelefone } from '@prospeccao/shared';

/**
 * Leitura do site da empresa: home + até 3 páginas internas que costumam ter contato
 * ("contato", "quem somos", "sobre"...). Só HTML: sites montados 100% em JavaScript
 * trazem pouco texto (a IA e o Instagram compensam).
 */

export interface ContatosExtraidos {
  emails: string[];
  telefones: string[];
  whatsapps: string[];
  instagram: string | null;
  facebook: string | null;
  linkedinEmpresa: string | null;
  linkedinPessoas: string[];
  cnpjs: string[];
}

export interface PaginaLida {
  url: string;
  titulo: string | null;
}

export interface ResultadoSite extends ContatosExtraidos {
  urlFinal: string;
  paginas: PaginaLida[];
  /** Texto visível das páginas, cortado para caber no pedido à IA. */
  texto: string;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36';
const LIMITE_BYTES = 1_500_000;
const LIMITE_TEXTO = 8_000;
const PAGINAS_EXTRAS = 3;
const LINK_INTERNO_UTIL =
  /contat|fale|atendimento|sobre|quem-somos|quemsomos|empresa|institucional|lojas|unidades/i;

/** Redes, plataformas e hospedagens: links para eles não são o site da empresa. */
const NAO_E_SITE =
  /(instagram|facebook|fb|linkedin|wa\.me|whatsapp|google|goo\.gl|youtube|tiktok|twitter|x\.com|linktr\.ee|ifood|mercadolivre)\./i;

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const EMAIL_LIXO =
  /\.(png|jpe?g|gif|webp|svg)$|@(example|exemplo|sentry|wixpress|domain|email)\.|^(nome|seu|your)@/i;
const TELEFONE = /(?:\+?55[\s.-]?)?\(?\b([1-9]{2})\)?[\s.-]?(9?\d{4})[\s.-]?(\d{4})\b/g;
const CNPJ = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const RESERVADOS_INSTAGRAM = new Set([
  'p',
  'reel',
  'reels',
  'explore',
  'stories',
  'tv',
  'accounts',
  'direct',
]);

export function normalizarSite(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    if (NAO_E_SITE.test(`${u.hostname}.`)) return null;
    return `${u.protocol}//${u.host}${u.pathname === '/' ? '' : u.pathname}`.replace(/\/$/, '');
  } catch {
    return null;
  }
}

/** "@loja", "instagram.com/loja/" → "loja". */
export function usuarioInstagram(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const m = valor.match(/instagram\.com\/([A-Za-z0-9._]{2,30})/i) ?? valor.match(/^@?([A-Za-z0-9._]{2,30})$/);
  const u = m?.[1]?.replace(/\.$/, '').toLowerCase();
  return u && !RESERVADOS_INSTAGRAM.has(u) ? u : null;
}

function unicos<T>(itens: (T | null | undefined)[]): T[] {
  return [...new Set(itens.filter((i): i is T => i != null))];
}

/** Texto visível de um HTML: sem scripts, estilos e tags; entidades básicas resolvidas. */
export function textoVisivel(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/** Contatos e perfis num pedaço de HTML (ou texto puro, como a bio do Instagram). */
export function extrairContatos(conteudo: string): ContatosExtraidos {
  const decodificado = conteudo.replace(/%40/g, '@').replace(/&#64;/g, '@');
  const texto = textoVisivel(decodificado);
  const hrefs = [...decodificado.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1] ?? '');

  const emails = unicos(
    [...(decodificado.match(EMAIL) ?? [])].map((e) => e.toLowerCase().replace(/^mailto:/, '')),
  ).filter((e) => !EMAIL_LIXO.test(e));

  const whatsapps = unicos(
    hrefs
      .filter((h) => /wa\.me|whatsapp\.com/i.test(h))
      .map((h) => {
        const n = h.match(/wa\.me\/(\d+)/i)?.[1] ?? h.match(/phone=(\d+)/i)?.[1];
        return normalizarTelefone(n);
      }),
  );

  const telefones = unicos([
    ...hrefs.filter((h) => /^tel:/i.test(h)).map((h) => normalizarTelefone(h.slice(4))),
    ...[...texto.matchAll(TELEFONE)].map((m) => normalizarTelefone(`${m[1]}${m[2]}${m[3]}`)),
  ]).filter((t) => !whatsapps.includes(t));

  const instagram =
    unicos(hrefs.map((h) => (/instagram\.com/i.test(h) ? usuarioInstagram(h) : null)))[0] ??
    usuarioInstagram(texto.match(/instagram\.com\/[A-Za-z0-9._]+/i)?.[0]) ??
    null;
  const facebook = hrefs.find((h) => /facebook\.com\/(?!sharer|share|dialog|tr\b)[^"'?]+/i.test(h)) ?? null;
  const linkedinEmpresa = hrefs.find((h) => /linkedin\.com\/company\//i.test(h)) ?? null;
  const linkedinPessoas = unicos(hrefs.filter((h) => /linkedin\.com\/in\//i.test(h)));

  const cnpjs = unicos(
    [...texto.matchAll(CNPJ)]
      .map((m) => m[0].replace(/\D/g, ''))
      .filter((c) => c.length === 14 && cnpjValido(c)),
  );

  return { emails, telefones, whatsapps, instagram, facebook, linkedinEmpresa, linkedinPessoas, cnpjs };
}

async function baixarHtml(
  url: string,
  timeoutMs: number,
): Promise<{ html: string; urlFinal: string } | null> {
  try {
    const r = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'pt-BR,pt' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('html')) {
      await r.body?.cancel();
      return null;
    }
    const buf = await r.arrayBuffer();
    return { html: new TextDecoder().decode(buf.slice(0, LIMITE_BYTES)), urlFinal: r.url || url };
  } catch {
    return null;
  }
}

function linksInternos(html: string, base: string): string[] {
  const origem = new URL(base);
  const vistos = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const [, href = '', rotulo = ''] = m;
    if (!LINK_INTERNO_UTIL.test(href) && !LINK_INTERNO_UTIL.test(textoVisivel(rotulo))) continue;
    try {
      const u = new URL(href, origem);
      if (u.hostname.replace(/^www\./, '') !== origem.hostname.replace(/^www\./, '')) continue;
      u.hash = '';
      if (u.href !== origem.href) vistos.add(u.href);
    } catch {
      // link quebrado: ignora
    }
    if (vistos.size >= PAGINAS_EXTRAS) break;
  }
  return [...vistos];
}

/** Lê o site: null quando nem a home responde. */
export async function lerSite(
  site: string,
  opcoes: { timeoutMs?: number } = {},
): Promise<ResultadoSite | null> {
  const timeoutMs = opcoes.timeoutMs ?? 12_000;
  const url = normalizarSite(site);
  if (!url) return null;
  const home = await baixarHtml(url, timeoutMs);
  if (!home) return null;

  const htmls = [home.html];
  const paginas: PaginaLida[] = [{ url: home.urlFinal, titulo: tituloDe(home.html) }];
  for (const extra of linksInternos(home.html, home.urlFinal)) {
    const p = await baixarHtml(extra, timeoutMs);
    if (!p) continue;
    htmls.push(p.html);
    paginas.push({ url: p.urlFinal, titulo: tituloDe(p.html) });
  }

  const juntos = htmls.join('\n');
  const contatos = extrairContatos(juntos);
  const texto = htmls
    .map((h) => textoVisivel(h))
    .join('\n---\n')
    .slice(0, LIMITE_TEXTO);
  return { urlFinal: home.urlFinal, paginas, texto, ...contatos };
}

function tituloDe(html: string): string | null {
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return t ? textoVisivel(t).slice(0, 160) : null;
}
