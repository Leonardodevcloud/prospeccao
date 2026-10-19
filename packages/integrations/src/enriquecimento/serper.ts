import { normalizarTelefone } from '@prospeccao/shared';
import type { ItemMaps } from '../apify/index.js';
import { requisitarJson } from '../http.js';
import { type EmpresaParaAchar, type LugarAchado, mesmoLugar, textoParaAchar } from '../places/index.js';
import type { ResultadoGoogle } from './apify.js';
import { extrairContatos } from './site.js';

/**
 * Busca no Google pelo Serper (serper.dev): alternativa ao ator do Apify para achar perfis do
 * LinkedIn e do Instagram. Cada consulta custa 1 crédito (2.500 grátis na conta nova, depois
 * a partir de ~US$ 1 por mil), mais barato e mais rápido que o Apify.
 */

export interface ConfigSerper {
  apiKey: string;
}

interface RespostaSerper {
  searchParameters?: { q?: string };
  organic?: { title?: string; link?: string; snippet?: string }[];
}

/** Converte a resposta do Serper no mesmo formato da busca do Apify. */
export function resultadosSerper(r: RespostaSerper): ResultadoGoogle[] {
  return (r.organic ?? [])
    .filter((o) => o.link)
    .map((o) => ({ titulo: o.title ?? '', url: o.link ?? '', descricao: o.snippet ?? '' }));
}

/** Várias consultas em paralelo; devolve consulta → resultados (como buscarNoGoogle do Apify). */
export async function buscarNoGoogleSerper(
  cfg: ConfigSerper,
  consultas: string[],
): Promise<Map<string, ResultadoGoogle[]>> {
  const respostas = await Promise.all(
    consultas.map((q) =>
      requisitarJson<RespostaSerper>('https://google.serper.dev/search', {
        servico: 'Serper',
        method: 'POST',
        headers: { 'X-API-KEY': cfg.apiKey },
        body: { q, gl: 'br', hl: 'pt-br', num: 10 },
        timeoutMs: 20_000,
      }),
    ),
  );
  return new Map(consultas.map((q, i) => [q, resultadosSerper(respostas[i] ?? {})]));
}

/* ───────────── Lugares do Google Maps pelo Serper (achar a empresa) ───────────── */

interface LugarSerper {
  title?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  rating?: number;
  ratingCount?: number;
  category?: string;
  phoneNumber?: string;
  website?: string;
  cid?: string;
  placeId?: string;
}

/** "Av. Barros Reis, 312 - Pau Miúdo, Salvador - BA, 40310-005" → cidade, UF e CEP. */
export function partesDoEndereco(endereco: string | null | undefined): {
  cidade: string | null;
  uf: string | null;
  cep: string | null;
} {
  const e = endereco ?? '';
  const cep = e.match(/\b(\d{5})-?(\d{3})\b/);
  const cidadeUf = e.match(/,\s*([^,\d][^,]*?)\s+-\s+([A-Z]{2})\b(?!.*\s-\s[A-Z]{2}\b)/);
  return {
    cidade: cidadeUf?.[1]?.trim() ?? null,
    uf: cidadeUf?.[2] ?? null,
    cep: cep ? `${cep[1]}${cep[2]}` : null,
  };
}

export function converterLugarSerper(l: LugarSerper): ItemMaps | null {
  if (!l.title) return null;
  const { cidade, uf, cep } = partesDoEndereco(l.address);
  const id = l.placeId || (l.cid ? `cid:${l.cid}` : `serper:${l.title}`);
  return {
    placeId: id,
    nome: l.title,
    categoria: l.category ?? null,
    telefone: normalizarTelefone(l.phoneNumber),
    endereco: l.address ?? null,
    cep,
    cidade,
    uf,
    lat: l.latitude ?? null,
    lng: l.longitude ?? null,
    nota: l.rating ?? null,
    avaliacoes: l.ratingCount ?? null,
    site: l.website ?? null,
    url: l.cid ? `https://maps.google.com/?cid=${l.cid}` : null,
    fechada: false,
    entrega: null,
    dados: l as Record<string, unknown>,
  };
}

async function lugaresSerper(cfg: ConfigSerper, q: string): Promise<ItemMaps[]> {
  const r = await requisitarJson<{ places?: LugarSerper[] }>('https://google.serper.dev/places', {
    servico: 'Serper',
    method: 'POST',
    headers: { 'X-API-KEY': cfg.apiKey },
    body: { q, gl: 'br', hl: 'pt-br' },
    timeoutMs: 20_000,
  });
  return (r.places ?? []).map(converterLugarSerper).filter((l): l is ItemMaps => !!l);
}

/** Acha a empresa no Google Maps pelo Serper (centavos por mil), com a mesma regra do Places. */
export async function acharLugarSerper(cfg: ConfigSerper, e: EmpresaParaAchar): Promise<LugarAchado> {
  const texto = textoParaAchar(e);
  const itens = await lugaresSerper(cfg, texto);
  let lugar = itens.find((l) => mesmoLugar(l, e)) ?? null;
  let candidatos = itens.length;
  if (!lugar && e.razaoSocial && e.razaoSocial.toLowerCase() !== e.nome.toLowerCase()) {
    const outros = await lugaresSerper(cfg, textoParaAchar({ ...e, nome: e.razaoSocial }));
    lugar = outros.find((l) => mesmoLugar(l, e)) ?? null;
    candidatos += outros.length;
  }
  return { lugar, candidatos, texto, fonte: 'serper' };
}

/* ───────────── Diretórios: o que o Google mostra quando busca a razão social ───────────── */

export interface ContatoDeDiretorio {
  canal: 'telefone' | 'email';
  valor: string;
  /** Site onde apareceu (autoguiabr.com.br, lavrale.com.br…). */
  dominio: string;
  url: string;
}

const dominioDe = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Telefones e e-mails citados nos trechos dos resultados que falam DESTA empresa (uma palavra
 * própria do nome no título ou no trecho). E-mail do próprio diretório (contato@econodata…)
 * fica de fora.
 */
export function contatosDosDiretorios(
  resultados: ResultadoGoogle[],
  palavras: string[],
): ContatoDeDiretorio[] {
  if (!palavras.length) return [];
  const saida: ContatoDeDiretorio[] = [];
  const vistos = new Set<string>();
  for (const r of resultados) {
    const texto = `${r.titulo} ${r.descricao}`;
    const comparavel = semAcento(texto);
    const junto = comparavel.replace(/[^a-z0-9]/g, '');
    if (!palavras.some((p) => comparavel.includes(p) || (p.length > 4 && junto.includes(p)))) continue;
    const dominio = dominioDe(r.url);
    if (/instagram\.com|facebook\.com|linkedin\.com/.test(dominio)) continue;
    const achados = extrairContatos(r.descricao);
    for (const t of achados.telefones) {
      if (vistos.has(`t:${t}`)) continue;
      vistos.add(`t:${t}`);
      saida.push({ canal: 'telefone', valor: t, dominio, url: r.url });
    }
    for (const em of achados.emails) {
      const dominioEmail = em.split('@')[1] ?? '';
      if (!dominioEmail || dominio.endsWith(dominioEmail) || dominioEmail.endsWith(dominio)) continue;
      if (vistos.has(`e:${em}`)) continue;
      vistos.add(`e:${em}`);
      saida.push({ canal: 'email', valor: em, dominio, url: r.url });
    }
  }
  return saida;
}

export interface BuscaDiretorios {
  consulta: string;
  resultados: ResultadoGoogle[];
  /** Painel do Google (lado direito), quando aparece. */
  painel: { telefone: string | null; site: string | null } | null;
}

/** Busca a razão social (ou o nome) com a cidade: 1 crédito do Serper. */
export async function buscarDiretorios(
  cfg: ConfigSerper,
  e: { nome: string; razaoSocial?: string | null; cidade: string },
): Promise<BuscaDiretorios> {
  const consulta = `"${(e.razaoSocial || e.nome).replace(/"/g, '')}" ${e.cidade.toLowerCase()}`;
  const r = await requisitarJson<
    RespostaSerper & {
      knowledgeGraph?: { website?: string; attributes?: Record<string, string> };
    }
  >('https://google.serper.dev/search', {
    servico: 'Serper',
    method: 'POST',
    headers: { 'X-API-KEY': cfg.apiKey },
    body: { q: consulta, gl: 'br', hl: 'pt-br', num: 10 },
    timeoutMs: 20_000,
  });
  const kg = r.knowledgeGraph;
  const telPainel = kg?.attributes
    ? Object.entries(kg.attributes).find(([k]) => /telefone|phone/i.test(k))?.[1]
    : undefined;
  return {
    consulta,
    resultados: resultadosSerper(r),
    painel: kg ? { telefone: normalizarTelefone(telPainel), site: kg.website ?? null } : null,
  };
}
