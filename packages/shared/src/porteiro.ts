import { z } from 'zod';

/*
 * Porteiro do WhatsApp: protege o número da conta contra o que mais derruba número (sobretudo em API
 * não oficial). Fica SEMPRE ligado (v178): não tem como desligar. Segura o mesmo texto indo para
 * muitos contatos em pouco tempo (e sugere variar com a IA), põe ritmo nos contatos novos (quantos
 * por dia e uma espera entre um e outro) e, com sinais de risco (gente pedindo para parar, quase
 * ninguém respondendo), para de abordar contatos novos por algumas horas e avisa.
 *
 * O mesmo texto tem duas réguas:
 * - para quem nunca respondeu (contato frio), é rígida: a partir de N contatos na janela, segura e
 *   não deixa mandar mesmo assim (vale também para os envios automáticos: cadência e sequência);
 * - para quem já conversa, é um aviso: a partir de 15 contatos na mesma hora, pergunta e deixa mandar.
 */

export const porteiroEntrada = z.object({
  /** Legado: a proteção fica sempre ligada (o valor mandado é ignorado). */
  ativo: z.boolean().optional().default(true),
  /** Mesmo texto para tantos contatos diferentes dentro da janela: segura (ou avisa). */
  repetidasContatos: z.number().int().min(2).max(100),
  repetidasJanelaMin: z.number().int().min(10).max(1440),
  /** Legado: para contato frio sempre segura; para quem conversa sempre avisa (ver o topo). */
  repetidasAcao: z.enum(['segurar', 'avisar']).optional().default('segurar'),
  /** Contatos novos (primeira mensagem para quem nunca conversou) por número por dia, pela equipe. */
  novosDia: z.number().int().min(1).max(500),
  /** Espera mínima entre um contato novo e outro no mesmo número. */
  novosIntervaloSeg: z.number().int().min(0).max(600),
  /** Com sinais de risco, para os contatos novos do número por algumas horas e avisa. */
  pausarRisco: z.boolean(),
});
export type PorteiroEntrada = z.infer<typeof porteiroEntrada>;

export const PORTEIRO_PADRAO: PorteiroEntrada = {
  ativo: true,
  repetidasContatos: 5,
  repetidasJanelaMin: 60,
  repetidasAcao: 'segurar',
  novosDia: 30,
  novosIntervaloSeg: 30,
  pausarRisco: true,
};

/** Horas que o número fica sem abordar contatos novos depois de um sinal de risco. */
export const PAUSA_RISCO_HORAS = 6;
/** Texto curto ("bom dia", "ok, obrigado") se repete naturalmente: não conta. */
export const MIN_PALAVRAS_REPETICAO = 6;
/** Quão parecidos dois textos precisam ser para contar como o mesmo (pares de palavras em comum). */
export const SEMELHANCA_REPETICAO = 0.7;

/** Quem já conversa: o mesmo texto para tantos contatos dentro de 1 hora vira aviso (dá para mandar). */
export const REPETIDAS_CONVERSA = 15;
export const REPETIDAS_CONVERSA_JANELA_MIN = 60;

export const variarEntrada = z.object({ texto: z.string().trim().min(1).max(4000) });

/* ───────────────────────────── Versões do texto ───────────────────────────── */

/** Até 3 versões por mensagem (a principal e mais 2): o sistema sorteia uma a cada envio. */
export const MAX_VERSOES = 3;
export const versoesExtras = z
  .array(z.string().trim().max(2000))
  .max(MAX_VERSOES - 1)
  .default([]);

/**
 * Duas versões parecidas demais (contam como o mesmo texto para o porteiro)? Devolve o par. Texto
 * curto ("ok, obrigado") não conta.
 */
export function versoesParecidas(textos: string[]): [number, number] | null {
  const palavras = textos.map((t) => palavrasDoTexto(t));
  for (let i = 0; i < textos.length; i++)
    for (let j = i + 1; j < textos.length; j++) {
      const a = palavras[i] as string[];
      const b = palavras[j] as string[];
      if (new Set(a).size < MIN_PALAVRAS_REPETICAO || new Set(b).size < MIN_PALAVRAS_REPETICAO) continue;
      if (semelhanca(a, b) >= SEMELHANCA_REPETICAO) return [i, j];
    }
  return null;
}

/** Para os esquemas: as versões não podem ser parecidas demais entre si (nem com a principal). */
export function conferirVersoes(
  ctx: z.RefinementCtx,
  texto: string | undefined,
  versoes: string[],
  caminho: (string | number)[],
): void {
  const par = versoesParecidas([texto ?? '', ...versoes]);
  if (!par) return;
  const nome = (i: number) => (i === 0 ? 'a mensagem principal' : `a versão ${i + 1}`);
  ctx.addIssue({
    code: 'custom',
    path: [...caminho, Math.max(0, par[1] - 1)],
    message: `${nome(par[1]).replace(/^a /, 'A ')} está parecida demais com ${nome(par[0])}: para o WhatsApp, conta como o mesmo texto. Mude mais as palavras (a IA ajuda).`,
  });
}

/** Sorteia uma das versões (as vazias não contam). */
export function escolherVersao(textos: (string | null | undefined)[], sorteio = Math.random): string {
  const validas = textos.map((t) => t?.trim() ?? '').filter(Boolean);
  if (!validas.length) return '';
  return validas[Math.floor(sorteio() * validas.length)] ?? validas[0]!;
}

export const versoesEntrada = z.object({
  texto: z.string().trim().min(1).max(2000),
  /** As versões que já existem (a IA não repete nenhuma). */
  evitar: z.array(z.string().trim().max(2000)).max(5).default([]),
  quantas: z
    .number()
    .int()
    .min(1)
    .max(MAX_VERSOES - 1)
    .default(2),
});

/* ───────────────────────────── Melhorar com IA ───────────────────────────── */

export const MODOS_MELHORAR = ['corrigir', 'clareza', 'cordial', 'curto'] as const;
export type ModoMelhorar = (typeof MODOS_MELHORAR)[number];
export const ROTULO_MODO_MELHORAR: Record<ModoMelhorar, { nome: string; dica: string }> = {
  corrigir: { nome: 'Corrigir', dica: 'Ortografia, acentos, vírgulas e concordância, sem mudar o jeito' },
  clareza: { nome: 'Mais claro', dica: 'Frases mais diretas, na ordem certa' },
  cordial: { nome: 'Mais cordial', dica: 'Mais educado e simpático, sem exagero' },
  curto: { nome: 'Mais curto', dica: 'Só o essencial, com a mesma informação' },
};

export const melhorarEntrada = z.object({
  texto: z.string().trim().min(1, 'Escreva a mensagem.').max(4000),
  modo: z.enum(MODOS_MELHORAR),
});

/* ───────────────────────────── Prévia (aviso antes de mandar) ───────────────────────────── */

export const previaPorteiroEntrada = z.object({
  empresaId: z.number().int().positive(),
  texto: z.string().trim().min(1).max(4000),
});

/**
 * O que acontece se mandar este texto agora: ok; atenção (falta pouco para segurar); aviso (quem
 * conversa: vai perguntar); segura (contato frio: não vai sair).
 */
export interface PreviaPorteiro {
  nivel: 'ok' | 'atencao' | 'aviso' | 'segura';
  /** Para quantos contatos um texto igual ou quase igual já foi na janela. */
  contatos: number;
  limite: number;
  janelaMin: number;
  /** O destinatário nunca respondeu (régua rígida). */
  frio: boolean;
  mensagem: string | null;
}
export const enviarMensagemEntrada = z.object({
  texto: z.string().trim().min(1, 'Escreva a mensagem.').max(4000),
  /** Mandar mesmo depois do aviso do porteiro (só quando a conta deixa: "avisar"). */
  mesmoAssim: z.boolean().optional(),
});

/** Códigos do porteiro nos erros 409 (a tela de conversa mostra o que fazer em cada um). */
export type CodigoPorteiro = 'porteiro_repetida' | 'porteiro_limite' | 'porteiro_espera' | 'porteiro_pausado';

export interface DetalhesPorteiro {
  porteiro: true;
  /** Repetida: para quantos contatos o mesmo texto já foi na janela. */
  contatos?: number;
  janelaMin?: number;
  /** Repetida no modo "avisar": dá para mandar mesmo assim. */
  podeForcar?: boolean;
  /** Quando volta a dar (fim da janela, da espera, do dia ou da pausa). */
  liberaEm?: string;
  /** Espera: segundos que faltam. */
  segundos?: number;
  limite?: number;
}

/** Palavras do texto para comparar: sem acento, caixa, pontuação; números viram "#". */
export function palavrasDoTexto(texto: string): string[] {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' link ')
    .replace(/\d+([.,]\d+)*/g, ' # ')
    .split(/[^\p{L}#]+/u)
    .filter((p) => p.length >= 2 || p === '#');
}

/** Pares de palavras seguidas (pegam o jeito de escrever, não só o assunto). */
function pares(p: string[]): Set<string> {
  if (p.length < 2) return new Set(p);
  const s = new Set<string>();
  for (let i = 1; i < p.length; i++) s.add(`${p[i - 1]} ${p[i]}`);
  return s;
}

/**
 * Semelhança entre dois textos (0 a 1): pares de palavras em comum sobre os do texto menor. Trocar
 * a saudação ou o nome não engana (o resto continua igual); reescrever de verdade baixa bem.
 */
export function semelhanca(a: string[], b: string[]): number {
  const A = pares(a);
  const B = pares(b);
  if (!A.size || !B.size) return 0;
  let comum = 0;
  for (const p of A) if (B.has(p)) comum++;
  return comum / Math.min(A.size, B.size);
}

/** O lead pediu para parar ou ameaçou denunciar: sinal de risco para o número. */
export const PEDIU_PARA_PARAR =
  /\b(par[ae] de (me )?(mandar|enviar|ligar)|n[aã]o (me )?(mand[ae]|envi[ae]) mais|n[aã]o tenho interesse|(vou )?(te |lhe )?(denunciar|bloquear)|denuncia|spam|me tir[ae] (da|dessa) lista|sai[r]? da lista|quem (te|lhe) deu (meu|o meu) (n[uú]mero|contato)|n[aã]o autorizei)\b/i;
