import { z } from 'zod';

/*
 * Porteiro do WhatsApp: protege o número da conta contra o que mais derruba número (sobretudo em API
 * não oficial). Segura o mesmo texto indo para muitos contatos em pouco tempo (e sugere variar com a
 * IA), põe ritmo nos contatos novos que a equipe aborda (quantos por dia e uma espera entre um e
 * outro) e, com sinais de risco (gente pedindo para parar, quase ninguém respondendo), para de
 * abordar contatos novos por algumas horas e avisa. Responder quem já conversa continua livre.
 */

export const porteiroEntrada = z.object({
  ativo: z.boolean(),
  /** Mesmo texto para tantos contatos diferentes dentro da janela: segura (ou avisa). */
  repetidasContatos: z.number().int().min(2).max(100),
  repetidasJanelaMin: z.number().int().min(10).max(1440),
  /** "segurar": não manda (sugere variar); "avisar": pergunta e deixa mandar mesmo assim. */
  repetidasAcao: z.enum(['segurar', 'avisar']),
  /** Contatos novos (primeira mensagem para quem nunca conversou) por número por dia, pela equipe. */
  novosDia: z.number().int().min(1).max(500),
  /** Espera mínima entre um contato novo e outro no mesmo número. */
  novosIntervaloSeg: z.number().int().min(0).max(600),
  /** Com sinais de risco, para os contatos novos do número por algumas horas e avisa. */
  pausarRisco: z.boolean(),
});
export type PorteiroEntrada = z.infer<typeof porteiroEntrada>;

export const PORTEIRO_PADRAO: PorteiroEntrada = {
  ativo: false,
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

export const variarEntrada = z.object({ texto: z.string().trim().min(1).max(4000) });
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
