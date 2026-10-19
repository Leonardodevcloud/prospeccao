import { normalizarTelefone } from '@prospeccao/shared';
import { requisitarJson } from '../http.js';
import { extrairContatos, normalizarSite, usuarioInstagram } from './site.js';

const API = 'https://api.apify.com/v2';

export interface ConfigApifyEnriq {
  token: string;
  /** Ator de resultados do Google (para achar LinkedIn e Instagram). */
  atorGoogle: string;
  /** Ator de perfis do Instagram. */
  atorInstagram: string;
}

/** Roda um ator e espera os itens (até ~2 min). Para buscas curtas, sem fila de coleta. */
async function rodarSincrono<T>(cfg: ConfigApifyEnriq, ator: string, input: unknown): Promise<T[]> {
  return requisitarJson<T[]>(
    `${API}/acts/${encodeURIComponent(ator)}/run-sync-get-dataset-items?timeout=120`,
    {
      servico: 'Apify',
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.token}` },
      body: input,
      timeoutMs: 150_000,
    },
  );
}

/* ---------------- Google ---------------- */

export interface ResultadoGoogle {
  titulo: string;
  url: string;
  descricao: string;
}

interface PaginaGoogleBruta {
  searchQuery?: { term?: string };
  organicResults?: { title?: string; url?: string; description?: string }[];
}

/** Várias consultas numa rodada só (o ator cobra por página de resultado). */
export async function buscarNoGoogle(
  cfg: ConfigApifyEnriq,
  consultas: string[],
): Promise<Map<string, ResultadoGoogle[]>> {
  const saida = new Map<string, ResultadoGoogle[]>(consultas.map((c) => [c, []]));
  if (!consultas.length) return saida;
  const paginas = await rodarSincrono<PaginaGoogleBruta>(cfg, cfg.atorGoogle, {
    queries: consultas.join('\n'),
    maxPagesPerQuery: 1,
    resultsPerPage: 10,
    countryCode: 'br',
    languageCode: 'pt-BR',
    mobileResults: false,
  });
  for (const p of paginas) {
    const termo = p.searchQuery?.term ?? '';
    const lista = saida.get(termo) ?? [];
    for (const r of p.organicResults ?? []) {
      if (r.url) lista.push({ titulo: r.title ?? '', url: r.url, descricao: r.description ?? '' });
    }
    saida.set(termo, lista);
  }
  return saida;
}

export interface PessoaLinkedin {
  nome: string;
  cargo: string | null;
  empresa: string | null;
  url: string;
}

/**
 * Título de resultado do LinkedIn → pessoa. Formatos comuns:
 * "Maria Souza - Compradora - Auto Peças X | LinkedIn" e "João Lima – Auto Peças X | LinkedIn".
 */
export function interpretarLinkedin(r: ResultadoGoogle): PessoaLinkedin | null {
  if (!/linkedin\.com\/in\//i.test(r.url)) return null;
  const limpo = r.titulo.replace(/\s*[|–-]\s*LinkedIn.*$/i, '').trim();
  const partes = limpo
    .split(/\s+[-–|]\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const nome = partes[0];
  if (!nome || nome.split(' ').length < 2 || /\d/.test(nome)) return null;
  return {
    nome,
    cargo: partes.length >= 3 ? (partes[1] ?? null) : null,
    empresa: partes.length >= 3 ? (partes[2] ?? null) : (partes[1] ?? null),
    url: r.url.split('?')[0] ?? r.url,
  };
}

const GENERICAS = new Set([
  'auto',
  'pecas',
  'peca',
  'autopecas',
  'comercio',
  'loja',
  'lojas',
  'distribuidora',
  'pet',
  'shop',
  'farmacia',
  'drogaria',
  'moto',
  'motos',
  'ltda',
  'store',
  'salvador',
  'bahia',
  'oficial',
  'baixa',
  'centro',
  // Palavras do ramo: aparecem no nome de qualquer concorrente, não identificam a empresa.
  'bateria',
  'baterias',
  'pneu',
  'pneus',
  'acessorios',
  'eletrica',
  'eletricas',
  'diesel',
  'import',
  'imports',
  'importados',
  'motopecas',
  'veiculos',
  'servicos',
  'comercial',
  'industria',
  'center',
  'express',
  'horas',
  'car',
  'cars',
  'brasil',
  'nordeste',
  'filial',
]);

/** Palavras do nome que identificam a empresa ("Lojão Auto Peças" → ["lojao"]). */
export function palavrasDoNome(nome: string): string[] {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 3 && !GENERICAS.has(p));
}

/**
 * Perfil de Instagram nos resultados do Google que é mesmo da empresa: ignora posts, páginas
 * de tópico (instagram.com/popular/...) e perfis cujo nome não tem nenhuma palavra da empresa.
 */
export function instagramNosResultados(resultados: ResultadoGoogle[], nomeEmpresa?: string): string | null {
  const palavras = nomeEmpresa ? palavrasDoNome(nomeEmpresa) : [];
  for (const r of resultados) {
    if (!/instagram\.com\//i.test(r.url)) continue;
    const u = usuarioInstagram(r.url);
    if (!u) continue;
    if (palavras.length) {
      const texto = `${u.replace(/[._]/g, ' ')} ${r.titulo} ${r.descricao}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
      const juntos = texto.replace(/\s+/g, '');
      if (!palavras.some((p) => texto.includes(p) || juntos.includes(p))) continue;
    }
    return u;
  }
  return null;
}

/* ---------------- Instagram ---------------- */

export interface PerfilInstagram {
  usuario: string;
  nome: string | null;
  bio: string;
  link: string | null;
  categoria: string | null;
  seguidores: number | null;
  email: string | null;
  telefone: string | null;
  whatsapps: string[];
  emailsNaBio: string[];
  telefonesNaBio: string[];
  cnpjs: string[];
}

export function converterPerfil(item: Record<string, unknown>): PerfilInstagram | null {
  const usuario = typeof item.username === 'string' ? item.username.toLowerCase() : null;
  if (!usuario) return null;
  const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const bio = texto(item.biography) ?? '';
  const links = Array.isArray(item.externalUrls)
    ? (item.externalUrls as { url?: string }[]).map((l) => l.url).filter((u): u is string => !!u)
    : [];
  const link = texto(item.externalUrl) ?? links[0] ?? null;
  const todosLinks = [...new Set([link, ...links].filter((l): l is string => !!l))];
  const daBio = extrairContatos(`${bio}\n${todosLinks.map((l) => `<a href="${l}">`).join('')}`);
  return {
    usuario,
    nome: texto(item.fullName),
    bio,
    link: normalizarSite(link) ?? link,
    categoria: texto(item.businessCategoryName),
    seguidores: typeof item.followersCount === 'number' ? item.followersCount : null,
    email: texto(item.businessEmail ?? item.publicEmail)?.toLowerCase() ?? null,
    telefone: normalizarTelefone(texto(item.businessPhoneNumber ?? item.publicPhoneNumber)),
    whatsapps: daBio.whatsapps,
    emailsNaBio: daBio.emails,
    telefonesNaBio: daBio.telefones,
    cnpjs: daBio.cnpjs,
  };
}

export async function lerPerfilInstagram(
  cfg: ConfigApifyEnriq,
  usuario: string,
): Promise<PerfilInstagram | null> {
  const itens = await rodarSincrono<Record<string, unknown>>(cfg, cfg.atorInstagram, {
    usernames: [usuario],
  });
  return itens.map(converterPerfil).find((p) => p != null) ?? null;
}
