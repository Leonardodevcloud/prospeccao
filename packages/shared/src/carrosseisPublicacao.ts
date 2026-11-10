import { z } from 'zod';
import type { SlideCarrossel } from './carrosseis.js';
import { conferirPromocao, type DivulgarEntrada } from './carrosseisTime.js';
import { semAcentoMinusculo } from './instagram.js';

/**
 * Do carrossel ao direct: a regra do "comente e receba" nasce com o carrossel, espera o post
 * aparecer no Instagram e se liga sozinha quando o CRM reconhece o post pela legenda. Aqui ficam
 * o reconhecimento, o que vai no direct (link, arquivo, promoção ou só a conversa) e os textos
 * padrão para quando o time de IA não está ligado.
 */

/* ───────────────────────────── O que vai no direct ───────────────────────────── */

export const ENTREGAS = ['link', 'arquivo', 'promocao', 'conversa'] as const;
export type Entrega = (typeof ENTREGAS)[number];
export const ENTREGA: Record<Entrega, { nome: string; dica: string; botao: string }> = {
  link: { nome: 'Um link', dica: 'site, catálogo, página da promoção', botao: 'Abrir o link' },
  arquivo: {
    nome: 'Um arquivo',
    dica: 'PDF ou imagem: checklist, tabela, catálogo',
    botao: 'Baixar o arquivo',
  },
  promocao: {
    nome: 'Uma promoção',
    dica: 'a do cadastro, com botão para o WhatsApp',
    botao: 'Pedir no WhatsApp',
  },
  conversa: { nome: 'Só a conversa', dica: 'uma pergunta; a IA ou a equipe segue', botao: '' },
};

/** O arquivo do direct: PDF, JPG ou PNG até 10 MB. */
export const TIPOS_ARQUIVO_DIRECT = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export const LIMITE_ARQUIVO_DIRECT = 10 * 1024 * 1024;
export const EXTENSAO_ARQUIVO: Record<(typeof TIPOS_ARQUIVO_DIRECT)[number], string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/** Depois de pronto, quantos dias sem o post aparecer até avisar. */
export const DIAS_SEM_POST = 3;

/* ───────────────────────────── A palavra do último slide ───────────────────────────── */

/** "Comente FREIO" no botão do último slide → FREIO (null se a chamada não é de comentar). */
export function palavraDaChamada(slides: readonly Pick<SlideCarrossel, 'modelo' | 'botao'>[]): string | null {
  const ultimo = slides.at(-1);
  if (ultimo?.modelo !== 'chamada') return null;
  const m = /comente\s*[“"']?\s*([\p{L}\p{N}]{2,20})/iu.exec(ultimo.botao ?? '');
  return m ? m[1]!.toUpperCase() : null;
}

/* ───────────────────────────── Reconhecer o post pela legenda ───────────────────────────── */

/** As palavras de uma legenda (sem link, hashtag, @, acento e pontuação; só as de 3 letras ou mais). */
export function palavrasDaLegenda(texto: string | null | undefined): string[] {
  const t = semAcentoMinusculo(
    String(texto ?? '')
      .replace(/https?:\/\/\S+/gi, ' ')
      .replace(/[#@][\p{L}\p{N}_.]+/gu, ' '),
  ).replace(/[^\p{L}\p{N}]+/gu, ' ');
  return t.split(' ').filter((p) => p.length >= 3);
}

/** Com menos palavras que isso a legenda não serve para reconhecer o post (escolher à mão). */
export const MIN_PALAVRAS_RECONHECER = 5;
/** Quantas das primeiras palavras da legenda do carrossel precisam estar no post. */
export const PARTE_QUE_BATE = 0.7;

export function podeReconhecer(legenda: string | null | undefined): boolean {
  return palavrasDaLegenda(legenda).length >= MIN_PALAVRAS_RECONHECER;
}

/**
 * O post tem a legenda do carrossel? Compara as 40 primeiras palavras do carrossel com as do post:
 * trocar uma palavra ou outra, tirar as hashtags ou pôr emoji ao postar não atrapalha.
 */
export function legendaBate(
  doCarrossel: string | null | undefined,
  doPost: string | null | undefined,
): boolean {
  const a = palavrasDaLegenda(doCarrossel).slice(0, 40);
  if (a.length < MIN_PALAVRAS_RECONHECER) return false;
  const b = new Set(palavrasDaLegenda(doPost));
  if (!b.size) return false;
  const achou = a.filter((p) => b.has(p)).length;
  return achou / a.length >= PARTE_QUE_BATE;
}

/* ───────────────────────────── WhatsApp da promoção ───────────────────────────── */

/** Só o DDD + número (tira o 55 do Brasil, espaço, traço e parênteses). */
export function numeroWhatsapp(t: string | null | undefined): string {
  const d = String(t ?? '').replace(/\D/g, '');
  return (d.length === 12 || d.length === 13) && d.startsWith('55') ? d.slice(2) : d;
}

export function linkWhatsapp(numero: string, texto: string): string {
  return `https://wa.me/55${numeroWhatsapp(numero)}?text=${encodeURIComponent(texto)}`;
}

/** O texto que já vem escrito quando a pessoa toca em "Pedir no WhatsApp". */
export function pedidoDaPromocao(titulo: string): string {
  return `Oi! Vi no Instagram e quero a promoção: ${titulo.trim()}`;
}

/* ───────────────────────────── A entrada da aba Publicação ───────────────────────────── */

const palavra = z
  .string()
  .trim()
  .min(2, 'Palavra muito curta.')
  .max(40)
  .refine((v) => /[\p{L}\p{N}]/u.test(v), 'Use letras ou números.');

export const publicacaoEntrada = z
  .object({
    palavras: z.array(palavra).min(1, 'Informe a palavra.').max(10),
    respostas: z.array(z.string().trim().min(1).max(300)).max(3).default([]),
    entrega: z.enum(ENTREGAS),
    mensagem: z.string().trim().min(5, 'Escreva o direct.').max(900, 'Use até 900 letras no direct.'),
    botaoTexto: z.string().trim().max(20, 'Até 20 letras no botão.').default(''),
    link: z.string().trim().max(500).default(''),
    divulgarId: z.number().int().positive().nullable().default(null),
    whatsapp: z.string().trim().max(30).default('').transform(numeroWhatsapp),
    iaContinua: z.boolean().default(false),
    etapaId: z.number().int().positive().nullable().default(null),
    responsavelId: z.number().int().positive().nullable().default(null),
    ligada: z.boolean().default(true),
  })
  .transform((d) => ({
    ...d,
    palavras: [...new Set(d.palavras.map((p) => p.toUpperCase()))],
    link: d.link && !/^https?:\/\//i.test(d.link) ? `https://${d.link}` : d.link,
    botaoTexto: d.entrega === 'conversa' ? '' : d.botaoTexto || ENTREGA[d.entrega].botao,
  }))
  .superRefine((d, ctx) => {
    if (d.entrega === 'link' && !z.string().url().safeParse(d.link).success)
      ctx.addIssue({ code: 'custom', path: ['link'], message: 'Coloque o endereço do link.' });
    if (d.entrega === 'promocao') {
      if (!d.divulgarId)
        ctx.addIssue({ code: 'custom', path: ['divulgarId'], message: 'Escolha a promoção.' });
      if (!/^\d{10,11}$/.test(d.whatsapp))
        ctx.addIssue({ code: 'custom', path: ['whatsapp'], message: 'Coloque o WhatsApp com DDD.' });
    }
  });
export type PublicacaoEntrada = z.infer<typeof publicacaoEntrada>;

export const escolherPostEntrada = z.object({ midiaId: z.string().trim().min(1).max(60) });

/* ───────────────────────────── Textos padrão (sem o time de IA) ───────────────────────────── */

export interface PromocaoDoDirect {
  titulo: string;
  produto?: string;
  precoDe?: string;
  precoPor?: string;
  validade?: string;
}

/** O preço e o prazo como a promoção foi digitada ("de R$ 162,00 por R$ 139,90 até sábado"). */
export function frasePromocao(p: PromocaoDoDirect): string {
  return [
    p.precoDe && p.precoPor ? `de ${p.precoDe} por ${p.precoPor}` : p.precoPor ? `por ${p.precoPor}` : '',
    p.validade ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** O direct de partida para cada entrega (a pessoa edita; com o time ligado, a redatora escreve). */
export function directPadrao(entrega: Entrega, assunto: string, promo?: PromocaoDoDirect | null): string {
  const tema = assunto.trim() || 'o que você pediu';
  switch (entrega) {
    case 'link':
      return `Oi, {nome}! Aqui está o link sobre ${tema}. Qualquer dúvida, é só responder aqui.`;
    case 'arquivo':
      return `Oi, {nome}! Aqui está o material sobre ${tema}. Qualquer dúvida, é só responder aqui.`;
    case 'promocao': {
      const frase = promo ? frasePromocao(promo) : '';
      const nome = promo?.produto || promo?.titulo || 'a promoção';
      return `Oi, {nome}! ${nome}${frase ? ` está ${frase}` : ' está em promoção'}. Toque no botão para pedir pelo WhatsApp.`;
    }
    case 'conversa':
      return `Oi, {nome}! Vi seu comentário sobre ${tema}. Me conta o que você precisa que eu te ajudo por aqui.`;
  }
}

/** O direct da promoção leva o preço e a validade exatamente como foram digitados (e nenhum outro preço). */
export function conferirDirectDaPromocao(p: DivulgarEntrada, mensagem: string): string[] {
  return conferirPromocao(p, [], mensagem);
}

/* ───────────────────────────── O que a aba mostra ───────────────────────────── */

export type SituacaoPublicacao =
  /** O carrossel não pede para comentar e não tem regra: só o passo a passo para postar. */
  | 'sem_regra'
  /** Tem regra, mas o Instagram não está conectado (ou não está no plano): a regra fica parada. */
  | 'sem_instagram'
  /** Rascunho: a regra começa a esperar o post quando marcar como pronto. */
  | 'rascunho'
  | 'esperando'
  /** Pronto há 3 dias e o post não apareceu. */
  | 'nao_achado'
  | 'publicado';

export function situacaoDaPublicacao(e: {
  temRegra: boolean;
  instagram: boolean;
  carrossel: 'rascunho' | 'pronto' | 'agendado' | 'publicado' | 'falhou';
  postLigado: boolean;
  esperandoDesde: Date | string | null;
  agora?: Date;
}): SituacaoPublicacao {
  if (e.postLigado || e.carrossel === 'publicado') return 'publicado';
  if (!e.temRegra) return 'sem_regra';
  if (!e.instagram) return 'sem_instagram';
  if (e.carrossel !== 'pronto') return 'rascunho';
  const desde = e.esperandoDesde ? new Date(e.esperandoDesde).getTime() : null;
  const agora = (e.agora ?? new Date()).getTime();
  return desde != null && agora - desde >= DIAS_SEM_POST * 86_400_000 ? 'nao_achado' : 'esperando';
}

export interface RegraDoCarrossel {
  id: number;
  palavras: string[];
  respostas: string[];
  entrega: Entrega;
  mensagem: string;
  botaoTexto: string;
  link: string;
  arquivo: { nome: string; tipo: string; bytes: number } | null;
  divulgarId: number | null;
  whatsapp: string;
  iaContinua: boolean;
  etapaId: number | null;
  responsavelId: number | null;
  ligada: boolean;
  criadoEm: string;
}

export interface PostDoCarrossel {
  midiaId: string;
  link: string | null;
  imagem: string | null;
  tipo: string | null;
  legenda: string | null;
  em: string | null;
}

export interface NumerosDoCarrossel {
  comentaram: number;
  receberam: number;
  abriram: number;
  responderam: number;
  leads: number;
}

export interface PublicacaoCarrossel {
  situacao: SituacaoPublicacao;
  /** O Instagram no plano e conectado (o @ da conta, quando há). */
  instagram: {
    noPlano: boolean;
    conectado: boolean;
    usuario: string | null;
    nome: string | null;
    foto: string | null;
  };
  regra: RegraDoCarrossel | null;
  post: PostDoCarrossel | null;
  numeros: NumerosDoCarrossel | null;
  /** A palavra do botão do último slide (o que a regra sugere). */
  palavraDoSlide: string | null;
  /** A legenda tem palavras suficientes para o CRM reconhecer o post sozinho. */
  podeReconhecer: boolean;
  esperandoDesde: string | null;
  /** Quando as imagens foram baixadas pela última vez. */
  baixadoEm: string | null;
  promocoes: {
    id: number;
    titulo: string;
    produto: string;
    precoDe: string;
    precoPor: string;
    validade: string;
    ate: string | null;
  }[];
  /** O WhatsApp conectado no CRM (para o botão da promoção). */
  whatsappDaEmpresa: string | null;
  /** A redatora pode reescrever o direct (o time de IA está ligado). */
  redatora: boolean;
}
