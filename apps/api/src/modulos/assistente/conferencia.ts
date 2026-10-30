/**
 * Conferência dos números da resposta do Argos: todo número que ele fala precisa ter vindo de algum
 * lugar desta conversa (resultado de consulta, pergunta, histórico, memória, perfil da empresa) ou
 * ser uma conta simples sobre eles (soma, diferença, razão, percentual, média de uma coluna).
 * Sem isso, a resposta volta para ele corrigir. Não depende da IA: é aritmética.
 */

export interface NumeroNoTexto {
  /** Como apareceu no texto ("1.234,50", "87%", "12 mil"). */
  bruto: string;
  valor: number;
  /** Casas decimais mostradas (define a tolerância do arredondamento). */
  casas: number;
  /** Veio com "mil"/"milhões": arredondado, tolerância relativa. */
  aproximado: boolean;
}

const RE_NUMERO =
  /(?<![\p{L}\d/:.,-])(-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+(?:,\d+)?|-?\d+\.\d+)(\s*(?:%|mil\b|milh(?:ão|ões|oes)\b|bilh(?:ão|ões|oes)\b|k\b))?(?![\d/:]|[.,]\d)/giu;

/** Números de um texto em português (1.234,56 · 87% · 12 mil · 3,5 milhões). Datas e horas ficam de fora. */
export function numerosDoTexto(texto: string): NumeroNoTexto[] {
  const saida: NumeroNoTexto[] = [];
  for (const m of texto.matchAll(RE_NUMERO)) {
    const corpo = m[1]!;
    const sufixo = (m[2] ?? '').trim().toLowerCase();
    let num: number;
    let casas = 0;
    if (/^-?\d+\.\d+$/.test(corpo) && !/^-?\d{1,3}(\.\d{3})+$/.test(corpo)) {
      // 12.5 (ponto decimal, raro em pt-BR mas aparece).
      num = Number(corpo);
      casas = corpo.split('.')[1]!.length;
    } else {
      const [inteiro, dec] = corpo.replaceAll('.', '').split(',');
      num = Number(`${inteiro}${dec ? `.${dec}` : ''}`);
      casas = dec?.length ?? 0;
    }
    if (!Number.isFinite(num)) continue;
    // Ano solto (2025, 2026) é data, não dado.
    if (!sufixo && casas === 0 && num >= 1990 && num <= 2100 && !corpo.includes('.')) continue;
    let mult = 1;
    if (sufixo === 'mil' || sufixo === 'k') mult = 1_000;
    else if (sufixo.startsWith('milh')) mult = 1_000_000;
    else if (sufixo.startsWith('bilh')) mult = 1_000_000_000;
    saida.push({ bruto: m[0].trim(), valor: num * mult, casas, aproximado: mult > 1 });
  }
  return saida;
}

const RE_DATA_ISO = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)?)?$/;

/**
 * O que dá para falar de uma data: dia, mês, hora, minuto e há quantos dias/horas (ou daqui a
 * quantos) em relação a agora. Isso entra direto, sem virar base de outras contas.
 */
function partesDaData(d: Date, agora: number, em: Set<number>): void {
  if (Number.isNaN(d.getTime())) return;
  const sp = new Date(d.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  em.add(sp.getDate());
  em.add(sp.getMonth() + 1);
  em.add(sp.getHours());
  em.add(sp.getMinutes());
  const dif = Math.abs(agora - d.getTime());
  em.add(Math.round(dif / 86_400_000));
  em.add(Math.floor(dif / 86_400_000));
  em.add(Math.round(dif / 3_600_000));
  em.add(Math.round(dif / 604_800_000));
  em.add(Math.round(dif / 2_592_000_000));
}

/** Números soltos dentro de qualquer valor (linha de consulta, totais, texto). Datas vão para `datas`. */
function coletar(v: unknown, em: Set<number>, datas: Set<number>, agora: number, profundidade = 0): void {
  if (v === null || v === undefined || profundidade > 4) return;
  if (typeof v === 'number') {
    if (Number.isFinite(v)) em.add(v);
  } else if (typeof v === 'bigint') em.add(Number(v));
  else if (typeof v === 'string') {
    const t = v.trim();
    if (/^-?\d+(\.\d+)?$/.test(t)) em.add(Number(t));
    else if (RE_DATA_ISO.test(t)) partesDaData(new Date(t), agora, datas);
    else for (const n of numerosDoTexto(v)) em.add(n.valor);
  } else if (v instanceof Date) partesDaData(v, agora, datas);
  else if (Array.isArray(v)) for (const x of v) coletar(x, em, datas, agora, profundidade + 1);
  else if (typeof v === 'object')
    for (const x of Object.values(v)) coletar(x, em, datas, agora, profundidade + 1);
}

export interface FonteDeNumeros {
  /** Linhas de uma consulta (todas, não só a amostra que foi para a IA). */
  linhas?: Record<string, unknown>[];
  totais?: Record<string, unknown>;
  /** Texto livre: pergunta, histórico, memória, perfil. */
  texto?: string;
}

/**
 * Tudo o que dá para afirmar: os números das fontes, a contagem de linhas, soma e média de cada
 * coluna numérica e as contas entre pares (soma, diferença, razão e percentual).
 */
export function numerosConhecidos(fontes: FonteDeNumeros[], agora = Date.now()): Set<number> {
  const base = new Set<number>();
  const derivados = new Set<number>();
  const datas = new Set<number>();
  for (const f of fontes) {
    if (f.texto) for (const n of numerosDoTexto(f.texto)) base.add(n.valor);
    if (f.totais) coletar(f.totais, base, datas, agora);
    if (f.linhas) {
      base.add(f.linhas.length);
      coletar(f.linhas, base, datas, agora);
      const colunas = new Map<string, number[]>();
      for (const l of f.linhas)
        for (const [c, v] of Object.entries(l)) {
          const n =
            typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : NaN;
          if (!Number.isFinite(n)) continue;
          const lista = colunas.get(c) ?? [];
          lista.push(n);
          colunas.set(c, lista);
        }
      for (const lista of colunas.values()) {
        const soma = lista.reduce((s, x) => s + x, 0);
        derivados.add(soma);
        derivados.add(soma / lista.length);
        derivados.add(Math.max(...lista));
        derivados.add(Math.min(...lista));
        // Quantas linhas têm valor acima de zero ("3 campanhas com resposta").
        derivados.add(lista.filter((x) => x > 0).length);
      }
    }
  }
  // Contas entre pares (limitado para não pesar).
  const lista = [...base, ...derivados].filter((x) => Number.isFinite(x)).slice(0, 400);
  // 0, 1 e 100 valem soltos ("nenhuma", "uma", "100%"), mas não entram nas contas.
  const todos = new Set<number>([...lista, ...datas, 0, 1, 100]);
  for (let i = 0; i < lista.length; i++) {
    const a = lista[i]!;
    todos.add(a * 100);
    todos.add(a / 1000);
    for (let j = 0; j < lista.length; j++) {
      if (i === j) continue;
      const b = lista[j]!;
      todos.add(a + b);
      todos.add(a - b);
      if (b !== 0) {
        todos.add(a / b);
        todos.add((a / b) * 100);
        todos.add(((a - b) / b) * 100);
      }
    }
  }
  return todos;
}

function bate(n: NumeroNoTexto, k: number): boolean {
  if (n.aproximado) return Math.abs(k - n.valor) <= Math.max(Math.abs(n.valor) * 0.06, 1);
  // Arredondado para as casas mostradas (87% aceita 86,5…87,49; 1.234,5 aceita 1.234,45…1.234,549).
  const tolerancia = 0.5 * 10 ** -n.casas + 1e-9;
  return Math.abs(k - n.valor) <= tolerancia || Math.abs(Math.abs(k) - Math.abs(n.valor)) <= tolerancia;
}

/** Os números do texto que não saíram de nenhuma fonte (vazio: tudo confere). */
export function numerosSemFonte(texto: string, conhecidos: Set<number>): string[] {
  const valores = [...conhecidos];
  const soltos: string[] = [];
  for (const n of numerosDoTexto(texto)) {
    if (conhecidos.has(n.valor)) continue;
    if (!valores.some((k) => bate(n, k))) soltos.push(n.bruto);
  }
  return [...new Set(soltos)];
}
