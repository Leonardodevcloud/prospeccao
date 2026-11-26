/// <reference lib="webworker" />
import { loadModule } from 'hunspell-asm';

/*
 * Corretor ortográfico do sistema (português do Brasil), num worker para não travar a tela. Usa o
 * Hunspell (o mesmo dos editores de texto) com o dicionário VERO (LGPL/MPL), servido em
 * /dicionario. Vale em qualquer navegador, sem depender do corretor de cada um.
 */

interface Hunspell {
  spell(palavra: string): boolean;
  suggest(palavra: string): string[];
}

let carregando: Promise<Hunspell> | null = null;

function carregar(): Promise<Hunspell> {
  if (carregando) return carregando;
  carregando = (async () => {
    const [fabrica, aff, dic] = await Promise.all([
      loadModule(),
      fetch('/dicionario/pt-BR.aff').then((r) => r.arrayBuffer()),
      fetch('/dicionario/pt-BR.dic').then((r) => r.arrayBuffer()),
    ]);
    const a = fabrica.mountBuffer(new Uint8Array(aff), 'pt-BR.aff');
    const d = fabrica.mountBuffer(new Uint8Array(dic), 'pt-BR.dic');
    return fabrica.create(a, d) as Hunspell;
  })();
  carregando.catch(() => {
    carregando = null;
  });
  return carregando;
}

/** Trocas comuns de quem digita rápido (s/z, ç/ss, u/o no fim, ch/x…): o Hunspell às vezes não as sugere. */
const TROCAS: [RegExp, string][] = [
  [/z/g, 's'],
  [/s/g, 'z'],
  [/ss/g, 'ç'],
  [/ç/g, 'ss'],
  [/x/g, 'ch'],
  [/ch/g, 'x'],
  [/u$/g, 'o'],
  [/i$/g, 'e'],
  [/ao$/g, 'ão'],
  [/oes$/g, 'ões'],
  [/cao$/g, 'ção'],
  [/a$/g, 'á'],
  [/e$/g, 'ê'],
];

function variacoes(palavra: string): string[] {
  const um = new Set<string>();
  for (const [de, para] of TROCAS) {
    const v = palavra.replace(de, para);
    if (v !== palavra) um.add(v);
  }
  const dois = new Set<string>(um);
  for (const p of um)
    for (const [de, para] of TROCAS) {
      const v = p.replace(de, para);
      if (v !== p) dois.add(v);
    }
  return [...dois];
}

/** Distância de edição (com troca de letras vizinhas), para pôr as sugestões mais parecidas primeiro. */
function distancia(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array<number>(n).fill(0)]);
  for (let j = 0; j <= n; j++) (d[0] as number[])[j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(
        (d[i - 1] as number[])[j]! + 1,
        (d[i] as number[])[j - 1]! + 1,
        (d[i - 1] as number[])[j - 1]! + c,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        v = Math.min(v, (d[i - 2] as number[])[j - 2]! + 1);
      (d[i] as number[])[j] = v;
    }
  return (d[m] as number[])[n]!;
}

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '');

function sugerir(h: Hunspell, palavra: string): string[] {
  const baixa = palavra.toLowerCase();
  const candidatas = new Set<string>();
  for (const v of variacoes(baixa)) if (h.spell(v)) candidatas.add(v);
  for (const s of h.suggest(palavra)) if (!s.includes(' ')) candidatas.add(s);
  const peso = (s: string) =>
    distancia(semAcento(baixa), semAcento(s.toLowerCase())) + distancia(baixa, s.toLowerCase()) / 10;
  const lista = [...candidatas].sort((x, y) => peso(x) - peso(y)).slice(0, 5);
  // Mantém a maiúscula do começo, se a palavra tinha.
  return palavra[0] && palavra[0] !== palavra[0].toLowerCase()
    ? lista.map((s) => s[0]!.toUpperCase() + s.slice(1))
    : lista;
}

type Pedido =
  | { id: number; tipo: 'conferir'; palavras: string[] }
  | { id: number; tipo: 'sugerir'; palavra: string };

self.onmessage = async (e: MessageEvent<Pedido>) => {
  const p = e.data;
  try {
    const h = await carregar();
    if (p.tipo === 'conferir')
      postMessage({
        id: p.id,
        erradas: p.palavras.filter((w) => !h.spell(w) && !h.spell(w.toLowerCase())),
      });
    else postMessage({ id: p.id, sugestoes: sugerir(h, p.palavra) });
  } catch (erro) {
    postMessage({ id: p.id, erro: erro instanceof Error ? erro.message : 'falhou' });
  }
};
