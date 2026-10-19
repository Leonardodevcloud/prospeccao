import type { ItemPlanilhaMaps } from './dominio.js';

/**
 * Leitura da planilha do Google Maps exportada pelo Instant Data Scraper (ou qualquer CSV com
 * nome, telefone, endereço…). A extensão dá nomes de coluna sem sentido ("qBF1Pd", "UsdlK"), então
 * cada coluna é reconhecida pelo conteúdo; a tela mostra o palpite e deixa trocar.
 */

export const CAMPOS_PLANILHA = [
  'nome',
  'telefone',
  'endereco',
  'categoria',
  'nota',
  'avaliacoes',
  'url',
  'site',
] as const;
export type CampoPlanilha = (typeof CAMPOS_PLANILHA)[number];
/** Campo → índice da coluna (ou null = não usar). */
export type MapaColunas = Record<CampoPlanilha, number | null>;

/** CSV com aspas, vírgula, ponto e vírgula ou tab (o separador mais frequente na 1ª linha). */
export function lerCsv(texto: string): string[][] {
  const limpo = texto.replace(/^﻿/, '');
  const primeira = limpo.split(/\r?\n/, 1)[0] ?? '';
  const sep = [',', ';', '\t'].sort(
    (a, b) => primeira.split(b).length - primeira.split(a).length,
  )[0] as string;
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = '';
  let aspas = false;
  for (let i = 0; i < limpo.length; i++) {
    const c = limpo[i] as string;
    if (aspas) {
      if (c === '"' && limpo[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) {
      linha.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && limpo[i + 1] === '\n') i++;
      linha.push(campo);
      if (linha.some((x) => x.trim())) linhas.push(linha);
      linha = [];
      campo = '';
    } else campo += c;
  }
  linha.push(campo);
  if (linha.some((x) => x.trim())) linhas.push(linha);
  return linhas;
}

const RUA =
  /\b(r\.|rua|av\.?|avenida|rod\.?|rodovia|travessa|tv\.|pra[çc]a|p[çc]a\.?|al\.|alameda|estrada|est\.|largo|loteamento|quadra|ladeira|via)\s/i;
const CEP = /\b\d{5}-?\d{3}\b/;
const digitos = (v: string) => v.replace(/\D/g, '');
const ehTelefone = (v: string) =>
  /^[+\d\s().-]{8,20}$/.test(v.trim()) && digitos(v).length >= 10 && digitos(v).length <= 13;
const ehNota = (v: string) => /^[1-5]([.,]\d)?$/.test(v.trim());
const ehAvaliacoes = (v: string) => /^\(?\d{1,3}([.,]?\d{3})*\)?$/.test(v.trim()) && !ehNota(v);
const ehMaps = (v: string) => /google\.[a-z.]+\/maps|maps\.google|goo\.gl\/maps|maps\.app\.goo/i.test(v);
const ehSite = (v: string) => /^https?:\/\//i.test(v.trim()) && !ehMaps(v);
const ehEndereco = (v: string) => RUA.test(v) || CEP.test(v);
const temLetras = (v: string) => /\p{L}{3,}/u.test(v);

/** Palpite de qual coluna é qual, pelo conteúdo das primeiras linhas. */
export function detectarColunas(linhas: string[][]): MapaColunas {
  const larg = Math.max(0, ...linhas.map((l) => l.length));
  const mapa: MapaColunas = {
    nome: null,
    telefone: null,
    endereco: null,
    categoria: null,
    nota: null,
    avaliacoes: null,
    url: null,
    site: null,
  };
  const usadas = new Set<number>();
  const amostra = (i: number) =>
    linhas
      .slice(0, 60)
      .map((l) => (l[i] ?? '').trim())
      .filter(Boolean);
  const fracao = (i: number, teste: (v: string) => boolean) => {
    const a = amostra(i);
    return a.length ? a.filter(teste).length / a.length : 0;
  };
  const escolher = (campo: CampoPlanilha, teste: (v: string) => boolean, minimo: number) => {
    let melhor: number | null = null;
    let nota = minimo;
    for (let i = 0; i < larg; i++) {
      if (usadas.has(i)) continue;
      const f = fracao(i, teste);
      if (f >= nota && f > 0) {
        nota = f;
        melhor = i;
      }
    }
    if (melhor != null) {
      mapa[campo] = melhor;
      usadas.add(melhor);
    }
  };
  escolher('url', ehMaps, 0.5);
  escolher('site', ehSite, 0.3);
  escolher('telefone', ehTelefone, 0.4);
  escolher('nota', ehNota, 0.5);
  escolher('avaliacoes', ehAvaliacoes, 0.5);
  escolher('endereco', ehEndereco, 0.3);

  // Nome: coluna de texto com valores quase todos diferentes (a mais à esquerda empata).
  // Categoria: texto que se repete muito ("Loja de autopeças").
  let nome: number | null = null;
  let categoria: number | null = null;
  let melhorNome = 0;
  let melhorCat = 0;
  for (let i = 0; i < larg; i++) {
    if (usadas.has(i)) continue;
    const a = amostra(i);
    if (a.length < Math.min(3, linhas.length)) continue;
    const letras = a.filter((v) => temLetras(v) && !/^https?:/i.test(v)).length / a.length;
    if (letras < 0.7) continue;
    const unicos = new Set(a.map((v) => v.toLowerCase())).size / a.length;
    const medio = a.reduce((s, v) => s + v.length, 0) / a.length;
    if (unicos >= 0.6 && medio <= 80 && unicos > melhorNome) {
      melhorNome = unicos;
      nome = i;
    } else if (unicos < 0.6 && medio <= 60 && 1 - unicos > melhorCat) {
      melhorCat = 1 - unicos;
      categoria = i;
    }
  }
  mapa.nome = nome;
  if (nome != null) usadas.add(nome);
  if (categoria != null && categoria !== nome) mapa.categoria = categoria;
  return mapa;
}

/** A 1ª linha é cabeçalho? (nenhuma célula parece telefone, nota ou link). */
export function temCabecalho(linhas: string[][]): boolean {
  const primeira = linhas[0] ?? [];
  return !primeira.some((v) => ehTelefone(v) || ehMaps(v) || ehSite(v) || ehNota(v));
}

const numero = (v: string | undefined) => {
  if (!v) return null;
  const n = Number(
    v
      .replace(/[()\s]/g, '')
      .replace(/\.(?=\d{3}\b)/g, '')
      .replace(',', '.'),
  );
  return Number.isFinite(n) ? n : null;
};

/** Uma linha no formato que a API aceita (null quando não tem nome). */
export function linhaParaItem(l: string[], m: MapaColunas): ItemPlanilhaMaps | null {
  const pega = (c: CampoPlanilha) => {
    const i = m[c];
    const v = i == null ? '' : (l[i] ?? '').trim();
    return v || undefined;
  };
  const nome = pega('nome');
  if (!nome) return null;
  let endereco = pega('endereco');
  let categoria = pega('categoria');
  // O Maps junta "Loja de autopeças · Rua X, 123": separa a categoria do endereço.
  if (endereco?.includes('·')) {
    const partes = endereco
      .split('·')
      .map((p) => p.trim())
      .filter(Boolean);
    const rua = partes.find(ehEndereco) ?? partes.find((p) => /\d/.test(p));
    const cat = partes.find((p) => p !== rua && !/\d/.test(p) && temLetras(p));
    endereco = rua;
    categoria ??= cat;
  }
  const nota = numero(pega('nota'));
  const avaliacoes = numero(pega('avaliacoes'));
  return {
    nome: nome.slice(0, 200),
    telefone: pega('telefone')?.slice(0, 40) ?? null,
    endereco: endereco?.slice(0, 300) ?? null,
    categoria: categoria?.slice(0, 120) ?? null,
    nota: nota != null && nota >= 0 && nota <= 5 ? nota : null,
    avaliacoes: avaliacoes != null && Number.isInteger(avaliacoes) && avaliacoes >= 0 ? avaliacoes : null,
    url: pega('url')?.slice(0, 1000) ?? null,
    site: pega('site')?.slice(0, 300) ?? null,
  };
}
