/**
 * Prévia dos links no domínio próprio do cliente (WhatsApp, LinkedIn, Telegram…). O robô que monta a
 * prévia não roda o sistema (só lê o HTML), então para ele devolvemos uma página mínima com o nome, a
 * descrição e a imagem de divulgação da empresa. Pessoas seguem direto para o sistema, sem custo.
 * Roda no Vercel antes das regras do vercel.json (Routing Middleware).
 */

export const config = {
  // Telas do sistema (fora a api, os arquivos estáticos e qualquer coisa com extensão).
  matcher: ['/((?!api/|assets/|.*\\.[A-Za-z0-9]+$).*)'],
};

const ROBOS =
  /whatsapp|facebookexternalhit|facebot|twitterbot|slackbot|telegrambot|linkedinbot|discordbot|skypeuripreview|iframely|embedly|pinterestbot|vkshare|redditbot|google-inspectiontool/i;
const DA_PLATAFORMA = /(^|\.)(prospectteam\.com\.br|vercel\.app)$/;
const API = (process.env.API_URL || 'https://prospeccaoapi-production.up.railway.app').replace(/\/+$/, '');

interface Marca {
  nome: string;
  cor: string | null;
  logo: string | null;
  imagem: string | null;
}

const escapar = (t: string) =>
  t.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

async function buscar<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(2500),
      headers: { accept: 'application/json' },
    });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

const quando = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

/** Título e descrição pela tela do link. */
async function textos(caminho: string, nome: string): Promise<{ titulo: string; descricao: string }> {
  const sala = /^\/r\/([A-Za-z0-9-]+)\/?$/.exec(caminho)?.[1];
  if (sala) {
    const info = await buscar<{ titulo: string; inicio: string }>(`${API}/salas/${encodeURIComponent(sala)}`);
    const dia = info ? quando.format(new Date(info.inicio)) : '';
    return {
      titulo: info ? `Reunião com ${nome} · ${info.titulo}` : `Reunião com ${nome}`,
      descricao: `${dia ? `${dia.charAt(0).toUpperCase()}${dia.slice(1)} · ` : ''}entre pelo navegador, sem instalar nada.`,
    };
  }
  if (caminho.startsWith('/convite/'))
    return { titulo: `Convite · ${nome}`, descricao: 'Crie a sua senha e entre no sistema comercial.' };
  if (caminho.startsWith('/redefinir/') || caminho.startsWith('/esqueci'))
    return { titulo: `Senha nova · ${nome}`, descricao: 'Crie a senha nova para entrar no sistema.' };
  return { titulo: nome, descricao: 'Acesso da equipe comercial.' };
}

export default async function middleware(request: Request): Promise<Response | undefined> {
  if (!ROBOS.test(request.headers.get('user-agent') ?? '')) return;
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  if (!host || host === 'localhost' || DA_PLATAFORMA.test(host)) return;
  const marca = (
    await buscar<{ marca: Marca | null }>(`${API}/publico/marca?host=${encodeURIComponent(host)}`)
  )?.marca;
  if (!marca) return;
  const { titulo, descricao } = await textos(url.pathname, marca.nome);
  const figura = marca.imagem ?? marca.logo;
  const imagem = figura ? `https://${host}/api${figura}` : null;
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${escapar(titulo)}</title>
<meta name="description" content="${escapar(descricao)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapar(marca.nome)}">
<meta property="og:title" content="${escapar(titulo)}">
<meta property="og:description" content="${escapar(descricao)}">
<meta property="og:url" content="${escapar(url.href)}">
${
  imagem
    ? `<meta property="og:image" content="${escapar(imagem)}">
<meta property="og:image:alt" content="${escapar(marca.nome)}">
<meta name="twitter:card" content="${marca.imagem ? 'summary_large_image' : 'summary'}">
<meta name="twitter:image" content="${escapar(imagem)}">`
    : '<meta name="twitter:card" content="summary">'
}
<meta name="twitter:title" content="${escapar(titulo)}">
<meta name="twitter:description" content="${escapar(descricao)}">
<meta name="theme-color" content="${escapar(marca.cor ?? '#0b6b63')}">
</head>
<body><h1>${escapar(titulo)}</h1><p>${escapar(descricao)}</p></body>
</html>`;
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}
