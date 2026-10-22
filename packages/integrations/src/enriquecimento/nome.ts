import { palavrasDoNome } from './apify.js';

/**
 * Como uma pessoa buscaria a empresa no Google. O nome do Maps costuma trazer a filial
 * ("GEFPEL Autopeças - Salvador LJ 04") e a razão social traz sufixos ("GEFPEL BA DISTRIBUIDORA DE
 * AUTO PECAS LTDA"): os dois atrapalham a busca. O núcleo é a marca ("GEFPEL"); o contexto é o
 * ramo, sem aspas, para o Google não confundir com outra coisa do mesmo nome.
 */
export interface NomeDeBusca {
  /** Marca, para ir entre aspas ("GEFPEL", "Nova Faísca"). */
  nucleo: string;
  /** Palavras do ramo que estavam no nome ("autopeças"), sem aspas. */
  contexto: string;
}

const FILIAL = /\s+(?:[-–|·]\s+.*|\(.*\)|(?:lj|loja|filial|unidade|matriz|un)\.?\s*\d+.*|\d+\s*$)$/i;

function semAcento(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** "GEFPEL Autopeças - Salvador LJ 04" → "GEFPEL Autopeças". */
export function semFilial(nome: string): string {
  let n = nome.trim();
  for (let i = 0; i < 3; i++) {
    const cortado = n.replace(FILIAL, '').trim();
    if (cortado === n || cortado.length < 2) break;
    n = cortado;
  }
  return n;
}

export function nomeDeBusca(nome: string, razaoSocial?: string | null): NomeDeBusca {
  const base = semFilial(nome);
  const palavras = base.split(/\s+/).filter(Boolean);
  const proprias = new Set(palavrasDoNome(base));
  const daRazao = new Set(palavrasDoNome(razaoSocial ?? ''));
  // Palavras próprias do nome (as que não são do ramo). Se alguma também está na razão social,
  // fica só com essas: é a marca de verdade ("GEFPEL").
  const marca = palavras.filter((p) => proprias.has(semAcento(p).replace(/[^a-z0-9]/g, '')));
  const naRazao = marca.filter((p) => daRazao.has(semAcento(p).replace(/[^a-z0-9]/g, '')));
  const nucleo = (naRazao.length ? naRazao : marca).join(' ').replace(/["]/g, '');
  const contexto = palavras
    .filter((p) => !marca.includes(p))
    .join(' ')
    .replace(/["]/g, '')
    .toLowerCase();
  // Nome só com palavras do ramo ("Auto Peças Salvador"): busca o nome inteiro.
  if (!nucleo) return { nucleo: base.replace(/["]/g, ''), contexto: '' };
  return { nucleo, contexto };
}

/** A busca principal: "GEFPEL" autopeças salvador. */
export function consultaPrincipal(
  nome: string,
  razaoSocial: string | null | undefined,
  cidade: string,
): string {
  const n = nomeDeBusca(nome, razaoSocial);
  return [`"${n.nucleo}"`, n.contexto, cidade.toLowerCase()].filter(Boolean).join(' ');
}
