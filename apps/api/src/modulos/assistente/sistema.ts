import { ARTIGOS_AJUDA, type ArtigoDoArgos } from './ajuda.gerada.js';

/**
 * O que o Argos sabe sobre o próprio sistema: a Central de Ajuda inteira (gerada da ajuda das
 * telas), para explicar como cada função funciona, e as travas do que ele não fala.
 */

const semAcento = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const PALAVRAS_VAZIAS = new Set(
  'a o e de da do das dos em no na nos nas um uma para pra por com que como eu me meu minha voce se isso esse essa este esta ao aos as os qual quais onde quando tem ter ser sao faz fazer fica ficar posso pode consigo sobre mais menos ja nao sim'.split(
    ' ',
  ),
);

const tokens = (s: string) =>
  semAcento(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !PALAVRAS_VAZIAS.has(t));

const visiveis = (master: boolean) => ARTIGOS_AJUDA.filter((a) => master || !a.soMaster);

/** Uma linha por artigo, para a IA escolher qual ler (vai no contexto fixo). */
export function indiceDaAjuda(master: boolean): string {
  return visiveis(master)
    .map((a) => `- ${a.id}: ${a.titulo} — ${a.resumo}`)
    .join('\n');
}

export function artigoDaAjuda(id: string, master: boolean): ArtigoDoArgos | null {
  return visiveis(master).find((a) => a.id === id) ?? null;
}

/** Os artigos que mais combinam com a pergunta (título e termos pesam mais que o texto). */
export function buscarNaAjuda(pergunta: string, master: boolean, n = 2): ArtigoDoArgos[] {
  const p = [...new Set(tokens(pergunta))];
  if (!p.length) return [];
  const pontos = visiveis(master).map((a) => {
    const titulo = new Set(tokens(`${a.titulo} ${a.termos} ${a.area}`));
    const resumo = new Set(tokens(a.resumo));
    const texto = semAcento(a.texto);
    let s = 0;
    for (const t of p) {
      // Prefixo também vale ("campanha" acha "campanhas", "conectar" acha "conecte").
      const raiz = t.slice(0, Math.max(4, t.length - 2));
      if ([...titulo].some((x) => x.startsWith(raiz))) s += 3;
      if ([...resumo].some((x) => x.startsWith(raiz))) s += 1.5;
      if (texto.includes(raiz)) s += 0.5;
    }
    return { a, s };
  });
  return pontos
    .filter((x) => x.s >= 3)
    .sort((x, y) => y.s - x.s)
    .slice(0, n)
    .map((x) => x.a);
}

/** Pergunta sobre como usar o sistema (e não sobre os números do comercial). */
export const PARECE_DUVIDA =
  /\b(como (eu )?(fa[cç]o|faz|funciona|uso|usar|configur|cri[oa]|conect|mand[oa]|envi|import|export|ativ|lig[oa]|marc|vej[oa]|acess|cadastr|troc|mud|coloc|adicion|apag|exclu)|onde (fica|vejo|encontro|est[aá]|acho)|o que (é|e|significa|quer dizer)|pra que serve|para que serve|tem como|d[aá] (pra|para)|consigo|posso|passo a passo|tutorial|n[aã]o (sei|entendi) (como|onde|o que))/i;

/** O texto de um artigo para a IA (com limite, para não estourar o contexto). */
export const artigoParaIa = (a: ArtigoDoArgos, limite = 6000) =>
  `### ${a.titulo} (artigo "${a.id}"${a.onde ? `, tela: ${a.onde}` : ''})\n${a.texto.slice(0, limite)}`;

/* ───────────── Travas: assunto, custos e bastidores ───────────── */

const FORNECEDORES =
  /\b(serper|openai|open ai|chat ?gpt|gpt[- ]?\d|deepseek|gemini|groq|whisper|livekit|z-?api|nvoip|resend|railway|neon|vercel|cloudflare|anthropic|claude|apify|asaas|direct ?data|openrouteservice|amazon|aws)\b/i;
const DINHEIRO =
  /(r\$|us\$|d[oó]lar|custo|custa|pre[cç]o|cobra|cobran[cç]a|gasto|gasta|fatura|por mil|por minuto|tokens?)/i;
const BASTIDORES =
  /(instru[cç][oõ]es (do sistema|internas|que (eu )?recebi)|meu prompt|prompt do sistema|system prompt|minhas regras internas|chave de api|api key)/i;

/**
 * Fala que não pode sair: custo de serviço/fornecedor (preço de API, tokens, voz, telefonia...) ou
 * os bastidores do próprio Argos (instruções, prompt, chaves). Conferido na resposta final.
 */
export function falaProibida(texto: string): boolean {
  const t = texto.replace(/\s+/g, ' ');
  if (BASTIDORES.test(t)) return true;
  if (FORNECEDORES.test(t) && DINHEIRO.test(t)) return true;
  if (
    /\bcusto d[aeo]s? (api|apis|ia|intelig[eê]ncia artificial|servidor|servidores|infraestrutura)\b/i.test(t)
  )
    return true;
  return false;
}

export const FALA_FORA_DO_ESCOPO =
  'Isso eu não consigo responder. Posso te ajudar com o seu comercial e com o uso do Prospect Team: é só perguntar.';

/** Views que o Argos nunca usa (consumo e custos da plataforma). */
export const FORA_DO_ARGOS = new Set(['consumo_ia', 'plataforma_consumo_buscas']);
