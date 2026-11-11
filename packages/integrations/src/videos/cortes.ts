import {
  type CorteVideo,
  type OpcoesVideo,
  PAUSA_MINIMA,
  PAUSA_QUE_FICA,
  type PalavraVideo,
  type RitmoCortes,
  type TipoCorte,
} from '@prospeccao/shared/videos';
import type { ClienteClaude } from '../carrosseis/claude.js';

/**
 * O que sai do vídeo. Duas fontes: os silêncios (medidos no áudio, não no tempo que o Whisper dá
 * às palavras, que costuma esticar a palavra por cima da pausa) e as palavras que a IA decide
 * tirar (muletas, frase recomeçada, fala para outra pessoa, o começo e o fim fora do assunto).
 */

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export interface Silencio {
  inicio: number;
  fim: number;
}

/**
 * Silêncios do áudio (mono, 16 kHz, 16 bits): janelas de 20 ms abaixo do piso de ruído + 8 dB
 * (entre -50 e -32 dB), com pelo menos `minimo` segundos.
 */
export function silencios(pcm: Int16Array, taxa = 16_000, minimo = 0.18): Silencio[] {
  const janela = Math.round(taxa * 0.02);
  const n = Math.floor(pcm.length / janela);
  if (!n) return [];
  const db = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let soma = 0;
    for (let j = k * janela; j < (k + 1) * janela; j++) {
      const v = pcm[j]! / 32768;
      soma += v * v;
    }
    db[k] = 20 * Math.log10(Math.sqrt(soma / janela) + 1e-9);
  }
  const ordenado = [...db].sort((a, b) => a - b);
  const piso = ordenado[Math.floor(n * 0.1)] ?? -60;
  const limiar = Math.min(-32, Math.max(-50, piso + 8));
  const out: Silencio[] = [];
  let k = 0;
  while (k < n) {
    if (db[k]! < limiar) {
      let j = k;
      while (j < n && db[j]! < limiar) j++;
      if ((j - k) * 0.02 >= minimo) out.push({ inicio: r3(k * 0.02), fim: r3(j * 0.02) });
      k = j;
    } else k++;
  }
  return out;
}

/** Encurta as pausas até sobrar a pausa do ritmo (parte antes, parte depois da fala). */
export function cortesDePausa(
  sil: Silencio[],
  ritmo: RitmoCortes,
  duracao: number,
): Omit<CorteVideo, 'id'>[] {
  const fica = PAUSA_QUE_FICA[ritmo];
  const minimo = PAUSA_MINIMA[ritmo];
  const out: Omit<CorteVideo, 'id'>[] = [];
  for (const s of sil) {
    // Começo e fim do vídeo são tratados à parte (cortes "inicio" e "fim").
    if (s.inicio <= 0.02 || s.fim >= duracao - 0.02) continue;
    const d = s.fim - s.inicio;
    if (d < minimo || d <= fica + 0.04) continue;
    out.push({
      inicio: r3(s.inicio + fica * 0.6),
      fim: r3(s.fim - fica * 0.4),
      tipo: 'pausa',
      motivo: `Pausa de ${d.toFixed(1).replace('.', ',')} s encurtada`,
      trecho: '',
      duvida: false,
      decisao: 'cortar',
      conferido: true,
    });
  }
  return out;
}

/* ───────────────────────────── A IA decide ───────────────────────────── */

export interface DecisaoDaIa {
  /** Primeira e última palavra que fazem parte do vídeo (antes/depois: fala fora do assunto). */
  inicio: number;
  fim: number;
  motivoInicio: string;
  motivoFim: string;
  cortes: {
    de: number;
    ate: number;
    tipo: Exclude<TipoCorte, 'pausa' | 'inicio' | 'fim'>;
    motivo: string;
    duvida: boolean;
  }[];
  fortes: number[];
  titulo: string;
}

const ESQUEMA_DECISAO = {
  type: 'object',
  properties: {
    inicio: { type: 'integer', description: 'Índice da primeira palavra que entra no vídeo.' },
    fim: { type: 'integer', description: 'Índice da última palavra que entra no vídeo.' },
    motivo_inicio: { type: 'string', description: 'Se inicio > 0: por que a fala antes saiu (uma frase).' },
    motivo_fim: { type: 'string', description: 'Se fim < última: por que a fala depois saiu (uma frase).' },
    cortes: {
      type: 'array',
      description: 'Trechos de palavras a tirar no meio do vídeo.',
      items: {
        type: 'object',
        properties: {
          de: { type: 'integer' },
          ate: { type: 'integer' },
          tipo: { type: 'string', enum: ['muleta', 'recomeco', 'fora', 'outro'] },
          motivo: { type: 'string', description: 'Por que saiu, em uma frase curta para o dono do vídeo.' },
          duvida: {
            type: 'boolean',
            description: 'true se não tem certeza (a pessoa decide): ex. a segunda versão da frase difere.',
          },
        },
        required: ['de', 'ate', 'tipo', 'motivo', 'duvida'],
      },
    },
    fortes: {
      type: 'array',
      description:
        'Índices das palavras-chave para destacar na legenda (preço, produto, benefício). No máximo 1 a cada 6 palavras.',
      items: { type: 'integer' },
    },
    titulo: {
      type: 'string',
      description: 'Título de abertura com 2 a 5 palavras, em maiúsculas, tirado do que a pessoa fala.',
    },
  },
  required: ['inicio', 'fim', 'cortes', 'fortes', 'titulo'],
} as const;

const SISTEMA_CORTES = `Você é o editor de vídeos curtos (Reels, TikTok) de uma empresa brasileira. Recebe a fala de um vídeo palavra por palavra, cada uma com um índice e o tempo, e as pausas medidas no áudio.

Decida o que sai para o vídeo ficar ágil e profissional, sem mudar o que a pessoa quis dizer:
- muleta: "é", "éé", "hã", "hum", "né" e "tipo" soltos, que não fazem parte da frase.
- recomeco: a pessoa começou uma frase, parou e falou de novo. Tire a primeira tentativa e fique com a última, a mais completa. Se as duas versões dizem coisas diferentes, marque duvida.
- fora: fala dirigida a quem está gravando ou a outra pessoa ("pode gravar?", "pera aí", "ficou bom?"), pedido para quem vai editar, ou algo fora do assunto do vídeo.
- inicio/fim: fala antes do vídeo começar de verdade (combinação, contagem, "tá gravando?") ou depois que terminou ("é isso", "corta", "faz aí").
- Nunca corte no meio de uma ideia, número, preço, nome de produto ou chamada para a ação.
- Na dúvida, não corte; se cortar com dúvida, marque duvida = true.
- Pausas não entram nos cortes: elas são encurtadas à parte.

Destaques (fortes): as palavras que carregam a mensagem (preço, produto, benefício, número), no máximo uma a cada 6 palavras, nunca artigos ou preposições.
Título: 2 a 5 palavras em maiúsculas, com as palavras da própria pessoa, que digam do que o vídeo trata.`;

/** A fala numerada para a IA, com as pausas longas marcadas no meio. */
export function falaNumerada(palavras: PalavraVideo[], sil: Silencio[]): string {
  const linhas: string[] = [];
  let s = 0;
  palavras.forEach((p, k) => {
    while (s < sil.length && sil[s]!.fim <= p.i + 0.05) {
      const d = sil[s]!.fim - sil[s]!.inicio;
      if (d >= 0.4) linhas.push(`  [pausa ${d.toFixed(1)} s]`);
      s++;
    }
    linhas.push(`${k}: ${p.t}  (${p.i.toFixed(2)})`);
  });
  return linhas.join('\n');
}

const inteiro = (v: unknown): number | null => (Number.isInteger(v) ? (v as number) : null);

/** Confere o que a IA mandou (índices dentro da fala, nada absurdo). */
export function lerDecisao(dados: Record<string, unknown>, total: number): DecisaoDaIa {
  const ultimo = Math.max(0, total - 1);
  const ini = Math.min(Math.max(0, inteiro(dados.inicio) ?? 0), ultimo);
  const fim = Math.min(Math.max(ini, inteiro(dados.fim) ?? ultimo), ultimo);
  const cortes: DecisaoDaIa['cortes'] = [];
  for (const c of Array.isArray(dados.cortes) ? dados.cortes : []) {
    const o = c as Record<string, unknown>;
    const de = inteiro(o.de);
    const ate = inteiro(o.ate);
    if (de == null || ate == null || de > ate || de < ini || ate > fim) continue;
    const tipo = ['muleta', 'recomeco', 'fora', 'outro'].includes(String(o.tipo))
      ? (o.tipo as DecisaoDaIa['cortes'][number]['tipo'])
      : 'outro';
    // Corte grande demais (mais de 25 palavras) nunca vai sem a pessoa conferir.
    cortes.push({
      de,
      ate,
      tipo,
      motivo: String(o.motivo ?? '').slice(0, 160),
      duvida: !!o.duvida || ate - de >= 25,
    });
  }
  const fortes = [
    ...new Set((Array.isArray(dados.fortes) ? dados.fortes : []).map(inteiro).filter((n) => n != null)),
  ].filter((n) => n! >= 0 && n! < total) as number[];
  return {
    inicio: ini,
    fim,
    motivoInicio: String(dados.motivo_inicio ?? '').slice(0, 160),
    motivoFim: String(dados.motivo_fim ?? '').slice(0, 160),
    cortes,
    fortes,
    titulo: String(dados.titulo ?? '')
      .toUpperCase()
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40),
  };
}

export async function pedirDecisao(
  claude: ClienteClaude,
  entrada: { palavras: PalavraVideo[]; silencios: Silencio[]; opcoes: OpcoesVideo },
): Promise<DecisaoDaIa> {
  const { opcoes } = entrada;
  const mensagem = [
    opcoes.assunto ? `Assunto do vídeo: ${opcoes.assunto}` : '',
    opcoes.instrucoes ? `Pedido da empresa (siga se não contrariar as regras): ${opcoes.instrucoes}` : '',
    opcoes.ritmo === 'natural'
      ? 'Ritmo: natural. Corte só muletas claras, recomeços e fala fora do vídeo.'
      : 'Ritmo: dinâmico (Reels).',
    `A fala (${entrada.palavras.length} palavras):`,
    falaNumerada(entrada.palavras, entrada.silencios),
  ]
    .filter(Boolean)
    .join('\n\n');
  const r = await claude.pedir({
    agente: 'editor de vídeo',
    sistema: [{ texto: SISTEMA_CORTES }],
    mensagem,
    ferramenta: {
      nome: 'decidir_cortes',
      descricao: 'O que sai do vídeo e o que destacar.',
      esquema: ESQUEMA_DECISAO,
    },
    maxTokens: 4000,
    temperatura: 0.2,
    timeoutMs: 180_000,
  });
  return lerDecisao(r.dados, entrada.palavras.length);
}

/* ───────────────────── Sem a IA: o básico pelas regras ───────────────────── */

// "é" sozinho é o verbo: só "éé" (esticado) conta como muleta.
const MULETA = /^(é{2,}|éh+|eh+|hã+|ãh+|hum+|hm+|uh+)[.,…!?]*$/i;
const norm = (t: string) =>
  t
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');

/** Muletas soltas e palavra repetida em seguida ("que que"), quando a IA não está ligada. */
export function decisaoPelasRegras(palavras: PalavraVideo[]): DecisaoDaIa {
  const cortes: DecisaoDaIa['cortes'] = [];
  palavras.forEach((p, k) => {
    if (MULETA.test(p.t))
      cortes.push({ de: k, ate: k, tipo: 'muleta', motivo: `"${p.t}" de muleta`, duvida: false });
    else if (k > 0 && norm(p.t) && norm(p.t) === norm(palavras[k - 1]!.t) && p.i - palavras[k - 1]!.f < 0.6)
      cortes.push({ de: k - 1, ate: k - 1, tipo: 'recomeco', motivo: `"${p.t}" repetido`, duvida: false });
  });
  const fortes = palavras.flatMap((p, k) => (/\d|r\$/i.test(p.t) ? [k] : []));
  return {
    inicio: 0,
    fim: Math.max(0, palavras.length - 1),
    motivoInicio: '',
    motivoFim: '',
    cortes,
    fortes,
    titulo: '',
  };
}

/* ───────────────────────────── Juntando tudo ───────────────────────────── */

/** O começo e o fim de um corte de palavras: das bordas da fala vizinha, sem comer palavra. */
function bordas(palavras: PalavraVideo[], de: number, ate: number, duracao: number): [number, number] {
  const ant = palavras[de - 1];
  const prox = palavras[ate + 1];
  const a = ant ? Math.min(palavras[de]!.i, ant.f + 0.06) : 0;
  const b = prox ? Math.max(palavras[ate]!.f, prox.i - 0.04) : duracao;
  return [r3(Math.max(0, a)), r3(Math.min(duracao, Math.max(a, b)))];
}

const trechoDe = (palavras: PalavraVideo[], de: number, ate: number) =>
  palavras
    .slice(de, ate + 1)
    .map((p) => p.t)
    .join(' ')
    .slice(0, 200);

/**
 * A lista final de cortes, em ordem: começo e fim, o que a IA tirou e as pausas (as que ficam
 * dentro de um corte de palavras somem da lista). Ritmo "só pausas": nenhuma palavra sai.
 */
export function montarCortes(
  palavras: PalavraVideo[],
  sil: Silencio[],
  decisao: DecisaoDaIa,
  ritmo: RitmoCortes,
  duracao: number,
): CorteVideo[] {
  const lista: Omit<CorteVideo, 'id'>[] = [];
  const base = { decisao: 'cortar' as const };
  if (palavras.length) {
    const tirarPalavras = ritmo !== 'pausas';
    const ini = tirarPalavras ? decisao.inicio : 0;
    const fim = tirarPalavras ? decisao.fim : palavras.length - 1;
    // Começo: o silêncio antes da primeira palavra (e a fala fora do vídeo, se a IA tirou).
    const comeco = Math.max(0, palavras[ini]!.i - 0.12);
    if (comeco >= 0.15)
      lista.push({
        ...base,
        inicio: 0,
        fim: r3(comeco),
        tipo: 'inicio',
        motivo: ini > 0 ? decisao.motivoInicio || 'Fala antes do vídeo começar' : 'Começo antes de falar',
        trecho: ini > 0 ? trechoDe(palavras, 0, ini - 1) : '',
        duvida: false,
        conferido: true,
      });
    const final = Math.min(duracao, palavras[fim]!.f + 0.3);
    if (duracao - final >= 0.15)
      lista.push({
        ...base,
        inicio: r3(final),
        fim: r3(duracao),
        tipo: 'fim',
        motivo:
          fim < palavras.length - 1
            ? decisao.motivoFim || 'Fala depois do vídeo terminar'
            : 'Fim depois de falar',
        trecho: fim < palavras.length - 1 ? trechoDe(palavras, fim + 1, palavras.length - 1) : '',
        duvida: false,
        conferido: true,
      });
    if (tirarPalavras)
      for (const c of decisao.cortes) {
        const [a, b] = bordas(palavras, c.de, c.ate, duracao);
        if (b - a < 0.08) continue;
        lista.push({
          ...base,
          inicio: a,
          fim: b,
          tipo: c.tipo,
          motivo: c.motivo || 'Trecho cortado',
          trecho: trechoDe(palavras, c.de, c.ate),
          duvida: c.duvida,
          conferido: !c.duvida,
        });
      }
  }
  const palavrasCortadas = lista.filter((c) => c.tipo !== 'pausa');
  for (const p of cortesDePausa(sil, ritmo, duracao))
    if (!palavrasCortadas.some((c) => p.inicio >= c.inicio - 0.05 && p.fim <= c.fim + 0.05)) lista.push(p);
  lista.sort((a, b) => a.inicio - b.inicio);
  return lista.map((c, k) => ({ ...c, id: `c${k + 1}` }));
}

/** Marca as palavras destacadas (as da IA). */
export function marcarFortes(palavras: PalavraVideo[], fortes: number[]): PalavraVideo[] {
  const s = new Set(fortes);
  return palavras.map((p, k) => (s.has(k) ? { ...p, forte: true } : p));
}

/* ───────────────────── Conferir as junções depois de montar ───────────────────── */

/**
 * Depois de montar, a fala do vídeo editado é ouvida de novo. Uma junção em que as palavras dos
 * dois lados não aparecem perto do lugar esperado (o corte comeu um pedaço da palavra) vira
 * dúvida para a pessoa ouvir.
 */
export function conferirJuncoes(
  cortes: CorteVideo[],
  palavras: PalavraVideo[],
  ficam: { inicio: number; fim: number }[],
  ouvidas: PalavraVideo[],
): CorteVideo[] {
  const noEditado = (t: number) => {
    let acc = 0;
    for (const s of ficam) {
      if (t < s.inicio) return null;
      if (t <= s.fim) return acc + (t - s.inicio);
      acc += s.fim - s.inicio;
    }
    return null;
  };
  const achou = (alvo: PalavraVideo) => {
    const t = noEditado((alvo.i + alvo.f) / 2);
    if (t == null) return true; // a palavra mesma saiu: nada a conferir
    const n = norm(alvo.t);
    if (n.length < 3) return true; // palavras curtas o Whisper junta ou some sem ser erro
    return ouvidas.some(
      (o) => Math.abs((o.i + o.f) / 2 - t) < 0.9 && (norm(o.t) === n || norm(o.t).startsWith(n.slice(0, 4))),
    );
  };
  return cortes.map((c) => {
    if (c.decisao !== 'cortar' || c.tipo === 'inicio' || c.tipo === 'fim') return c;
    const antes = [...palavras].reverse().find((p) => p.f <= c.inicio + 0.02);
    const depois = palavras.find((p) => p.i >= c.fim - 0.02);
    const ok = (!antes || achou(antes)) && (!depois || achou(depois));
    return ok
      ? c
      : {
          ...c,
          duvida: true,
          conferido: false,
          motivo: `${c.motivo}. Confira: a junção pode ter cortado um pedaço de palavra.`,
        };
  });
}
