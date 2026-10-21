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
const WHATSAPP_URL = /wa\.me\/\+?(\d{10,13})|whatsapp\.com\/send\/?\?(?:[^"'\s<>]*&)?phone=\+?(\d{10,13})/gi;
/** Encurtadores que costumam esconder o link do WhatsApp (wa.link/xyz → wa.me/55…). */
const ENCURTADOR =
  /^https?:\/\/(www\.)?(wa\.link|bit\.ly|tinyurl\.com|abre\.ai|abrir\.link|encurtador\.com\.br|cutt\.ly|l\.ead\.me|whts\.co|zap\.link|linkwhats\.app)\//i;
const CNPJ = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
/** Caminhos do próprio Instagram que não são perfis (páginas de tópico, posts, ajuda...). */
const RESERVADOS_INSTAGRAM = new Set([
  'p',
  'reel',
  'reels',
  'explore',
  'stories',
  'tv',
  'accounts',
  'direct',
  'popular',
  'about',
  'legal',
  'developer',
  'web',
  'locations',
  'tags',
  'directory',
  'privacy',
  'help',
  'sessions',
  'emails',
  'challenge',
  'oauth',
  'press',
  'blog',
  'instagram',
  'share',
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

  // Botões de WhatsApp em qualquer formato: href comum, JSON da página (páginas de links
  // como Linktree guardam os botões num JSON, com "\/" escapado) ou texto corrido.
  const semEscape = decodificado.replace(/\\\//g, '/').replace(/%3D/gi, '=').replace(/%3F/gi, '?');
  const whatsapps = unicos([
    ...hrefs
      .filter((h) => /wa\.me|whatsapp\.com/i.test(h))
      .map((h) => normalizarTelefone(h.match(/wa\.me\/(\d+)/i)?.[1] ?? h.match(/phone=(\d+)/i)?.[1])),
    ...[...semEscape.matchAll(WHATSAPP_URL)].map((m) => normalizarTelefone(m[1] ?? m[2])),
  ]);

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
  // Muitos sites pequenos só respondem sem https ou só com "www.": tenta as variações.
  let home: { html: string; urlFinal: string } | null = null;
  for (const tentativa of variacoesDoSite(url)) {
    home = await baixarHtml(tentativa, timeoutMs);
    if (home) break;
  }
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

export function variacoesDoSite(url: string): string[] {
  const u = new URL(url);
  const semWww = u.host.replace(/^www\./, '');
  const caminho = u.pathname === '/' ? '' : u.pathname;
  return [
    ...new Set([
      url,
      `https://www.${semWww}${caminho}`,
      `http://${u.host}${caminho}`,
      `http://www.${semWww}${caminho}`,
    ]),
  ];
}

function tituloDe(html: string): string | null {
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return t ? textoVisivel(t).slice(0, 160) : null;
}

/** Para onde um link curto leva (segue os redirecionamentos). */
async function destinoFinal(url: string, timeoutMs: number): Promise<string | null> {
  try {
    const r = await fetch(url, {
      headers: { 'user-agent': UA },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    await r.body?.cancel();
    return r.url || null;
  } catch {
    return null;
  }
}

/**
 * Página do link da bio do Instagram (Linktree, Beacons, Taplink, página própria…). Não depende
 * do modelo da página: junta todos os links e o texto e tira WhatsApp, telefone e e-mail, e
 * segue os links curtos (wa.link, bit.ly) até o destino.
 */
export async function lerPaginaDeLinks(
  link: string,
  opcoes: { timeoutMs?: number } = {},
): Promise<ResultadoSite | null> {
  const timeoutMs = opcoes.timeoutMs ?? 12_000;
  const url = normalizarSite(link) ?? link;
  // Link direto para o WhatsApp: nem precisa abrir.
  const direto = extrairContatos(`<a href="${url}">`);
  if (direto.whatsapps.length) {
    return { urlFinal: url, paginas: [], texto: '', ...direto };
  }
  if (ENCURTADOR.test(url)) {
    const destino = await destinoFinal(url, timeoutMs);
    const doDestino = destino ? extrairContatos(`<a href="${destino}">`) : null;
    if (doDestino?.whatsapps.length)
      return { urlFinal: destino ?? url, paginas: [], texto: '', ...doDestino };
  }
  const pagina = await baixarHtml(url, timeoutMs);
  if (!pagina) return null;
  const contatos = extrairContatos(pagina.html);
  const hrefs = [...pagina.html.replace(/\\\//g, '/').matchAll(/https?:\/\/[^"'\s<>\\]+/gi)].map((m) => m[0]);
  const curtos = [...new Set(hrefs.filter((h) => ENCURTADOR.test(h)))].slice(0, 5);
  for (const curto of curtos) {
    const destino = await destinoFinal(curto, timeoutMs);
    if (!destino) continue;
    for (const w of extrairContatos(`<a href="${destino}">`).whatsapps)
      if (!contatos.whatsapps.includes(w)) contatos.whatsapps.push(w);
  }
  contatos.telefones = contatos.telefones.filter((t) => !contatos.whatsapps.includes(t));
  return {
    urlFinal: pagina.urlFinal,
    paginas: [{ url: pagina.urlFinal, titulo: tituloDe(pagina.html) }],
    texto: textoVisivel(pagina.html).slice(0, LIMITE_TEXTO),
    ...contatos,
  };
}
