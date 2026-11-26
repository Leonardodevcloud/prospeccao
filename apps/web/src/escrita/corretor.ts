import { useEffect, useState } from 'react';

/*
 * O corretor ortográfico do sistema na tela: separa as palavras do texto, pergunta ao worker
 * (Hunspell + dicionário pt-BR) quais estão erradas e guarda as respostas. Ignora o que não é
 * erro de digitação: links, e-mails, números, variáveis ({nome}), siglas, nomes próprios no meio
 * da frase, as abreviações de WhatsApp e as palavras que a pessoa adicionou ao dicionário.
 */

export interface PalavraErrada {
  inicio: number;
  fim: number;
  palavra: string;
}

/** Abreviações e palavras de conversa que não são erro no WhatsApp. */
const DE_CONVERSA = new Set(
  (
    'vc vcs pq tb tbm blz obg obgd msg msgs hj td tds ok okay kk kkk kkkk rs rsrs pfv pf pfvr dps cmg qdo qnd ' +
    'ta tá pra pro pros pras né ne ai aí ae oq tô to num mt mto mta mtos mtas tmj vlw valeu opa eae eai oie uai oxe ' +
    'show whatsapp zap wpp whats pix cnpj cpf nf nfe link links site email emails online app delivery login ' +
    'orçamento orcamento cep sms ia ok'
  ).split(' '),
);

const CHAVE_PROPRIAS = 'corretor:palavras';

function lerProprias(): Set<string> {
  try {
    const t = localStorage.getItem(CHAVE_PROPRIAS);
    return new Set(t ? (JSON.parse(t) as string[]) : []);
  } catch {
    return new Set();
  }
}
const proprias = lerProprias();
const ouvintes = new Set<() => void>();

/** "Adicionar ao dicionário": a palavra deixa de ser marcada neste navegador. */
export function adicionarAoDicionario(palavra: string): void {
  proprias.add(palavra.toLowerCase());
  try {
    localStorage.setItem(CHAVE_PROPRIAS, JSON.stringify([...proprias].slice(-2000)));
  } catch {
    // Sem armazenamento (navegação privada): vale só até fechar a tela.
  }
  for (const o of ouvintes) o();
}

/* ───────────────────────────── Worker ───────────────────────────── */

let worker: Worker | null = null;
let seq = 0;
const pendentes = new Map<number, (r: { erradas?: string[]; sugestoes?: string[]; erro?: string }) => void>();
/** Cada palavra já conferida (true = certa). */
const conferidas = new Map<string, boolean>();
let indisponivel = false;

function pedir(msg: { tipo: 'conferir'; palavras: string[] } | { tipo: 'sugerir'; palavra: string }) {
  if (!worker) {
    worker = new Worker(new URL('./corretor.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const f = pendentes.get(e.data.id);
      pendentes.delete(e.data.id);
      f?.(e.data);
    };
    worker.onerror = () => {
      indisponivel = true;
      for (const f of pendentes.values()) f({ erro: 'indisponível' });
      pendentes.clear();
    };
  }
  const id = ++seq;
  return new Promise<{ erradas?: string[]; sugestoes?: string[]; erro?: string }>((resolve) => {
    pendentes.set(id, resolve);
    worker!.postMessage({ id, ...msg });
  });
}

export async function sugestoesPara(palavra: string): Promise<string[]> {
  const r = await pedir({ tipo: 'sugerir', palavra });
  return r.sugestoes ?? [];
}

/* ───────────────────────────── Palavras do texto ───────────────────────────── */

const PALAVRA = /\p{L}+(?:['’-]\p{L}+)*/gu;
const NAO_CONFERIR = /https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+|\{[^}]*\}|\/\S*/g;

function palavrasDoTexto(texto: string): PalavraErrada[] {
  const fora: [number, number][] = [];
  for (const m of texto.matchAll(NAO_CONFERIR)) fora.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  const lista: PalavraErrada[] = [];
  for (const m of texto.matchAll(PALAVRA)) {
    const inicio = m.index ?? 0;
    const palavra = m[0];
    const fim = inicio + palavra.length;
    if (palavra.length < 2) continue;
    if (fora.some(([a, b]) => inicio >= a && inicio < b)) continue;
    // Sigla (CNPJ, SP) e nome próprio no meio da frase (Maria, Cobreq) não são conferidos.
    if (palavra === palavra.toUpperCase()) continue;
    const antes = texto.slice(0, inicio).trimEnd();
    const comecoDeFrase = !antes || /[.!?\n:]$/.test(antes);
    if (!comecoDeFrase && palavra[0] !== palavra[0]!.toLowerCase()) continue;
    const baixa = palavra.toLowerCase();
    if (DE_CONVERSA.has(baixa) || proprias.has(baixa)) continue;
    lista.push({ inicio, fim, palavra });
  }
  return lista;
}

/**
 * As palavras erradas do texto (confere depois de a pessoa parar de digitar um pouco). Na primeira
 * vez o navegador baixa o dicionário (uns 2 MB, guardado no cache depois).
 */
export function usePalavrasErradas(texto: string, ligado = true): PalavraErrada[] {
  const [erradas, setErradas] = useState<PalavraErrada[]>([]);
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    const o = () => setVersao((v) => v + 1);
    ouvintes.add(o);
    return () => {
      ouvintes.delete(o);
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: versao refaz a conferência depois de "adicionar ao dicionário"
  useEffect(() => {
    if (!ligado || indisponivel || !texto.trim()) {
      setErradas([]);
      return;
    }
    let vivo = true;
    const t = setTimeout(async () => {
      const palavras = palavrasDoTexto(texto);
      const novas = [...new Set(palavras.map((p) => p.palavra))].filter((p) => !conferidas.has(p));
      if (novas.length) {
        const r = await pedir({ tipo: 'conferir', palavras: novas });
        if (r.erro) return;
        const erradasSet = new Set(r.erradas ?? []);
        for (const p of novas) conferidas.set(p, !erradasSet.has(p));
      }
      if (vivo) setErradas(palavras.filter((p) => conferidas.get(p.palavra) === false));
    }, 450);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [texto, ligado, versao]);
  return erradas;
}
