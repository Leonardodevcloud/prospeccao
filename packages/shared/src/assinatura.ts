import { z } from 'zod';
import { cnpjDoTexto } from './importacao.js';
import { normalizarTelefone } from './normalizar.js';
import { MODULOS_NA_ASSINATURA, type Modulo, type PlanoDaConta, type PlanoPronto } from './planos.js';

/**
 * Teste grátis de 7 dias pelo site e a assinatura que a própria empresa contrata: cada mês é uma
 * cobrança avulsa no Asaas (sem recorrência no cartão), paga com Pix, boleto ou cartão na hora.
 * Pagou, vale por um mês; venceu, mais 3 dias normais e depois só leitura até pagar.
 */

export const DIAS_TESTE = 7;
export const USUARIOS_TESTE = 2;
export const LEADS_TESTE = 100;
/** Teste vencido sem assinar: só leitura por estes dias, depois arquiva (quem já pagou não arquiva). */
export const DIAS_SO_LEITURA = 15;
/** O mês pago venceu: continua normal por estes dias, depois fica só leitura até pagar. */
export const DIAS_TOLERANCIA_ATRASO = 3;
/** A cobrança do mês seguinte é gerada (e o aviso aparece) estes dias antes de vencer. */
export const DIAS_AVISO_VENCIMENTO = 7;
/** Diferença de um aumento de plano abaixo disso não vira cobrança (vale na hora, sem custo). */
export const DIFERENCA_MINIMA = 5;
/** Conta arquivada: os dados ficam guardados por estes dias. */
export const DIAS_GUARDA_ARQUIVADA = 90;

export type SituacaoAssinatura = 'teste' | 'ativa' | 'atrasada' | 'cancelada' | 'so_leitura' | 'arquivada';

export const ROTULO_ASSINATURA: Record<SituacaoAssinatura, string> = {
  teste: 'Teste grátis',
  ativa: 'Assinatura ativa',
  atrasada: 'Pagamento atrasado',
  cancelada: 'Renovação desligada (vale até o fim do mês pago)',
  so_leitura: 'Só leitura',
  arquivada: 'Arquivada',
};

/** O que cada cobrança paga. */
export type TipoCobranca = 'mensalidade' | 'diferenca' | 'minutos';
export const ROTULO_TIPO_COBRANCA: Record<TipoCobranca, string> = {
  mensalidade: 'Mensalidade',
  diferenca: 'Mudança de plano',
  minutos: 'Minutos de ligação',
};

/* ───────────────────────────── Documentos ───────────────────────────── */

export function cpfValido(v: string): boolean {
  const d = v.replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dig = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dig(9) === Number(d[9]) && dig(10) === Number(d[10]);
}

/** CNPJ ou CPF só com os dígitos, ou null se não for válido. */
export function documentoDoTexto(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = v.replace(/\D/g, '');
  if (d.length === 11) return cpfValido(d) ? d : null;
  return cnpjDoTexto(d);
}

/** E-mails descartáveis mais comuns (o teste é um por empresa). */
const DESCARTAVEIS = new Set([
  'mailinator.com',
  'yopmail.com',
  'guerrillamail.com',
  'guerrillamail.info',
  'sharklasers.com',
  '10minutemail.com',
  '10minutemail.net',
  'tempmail.com',
  'temp-mail.org',
  'tempmail.net',
  'tempail.com',
  'throwawaymail.com',
  'getnada.com',
  'nada.email',
  'maildrop.cc',
  'dispostable.com',
  'trashmail.com',
  'fakeinbox.com',
  'mintemail.com',
  'emailondeck.com',
  'mohmal.com',
  'mailnesia.com',
  'moakt.com',
  'tmail.ws',
  'burnermail.io',
  'spamgourmet.com',
  'mytemp.email',
  'inboxkitten.com',
  'emailfake.com',
  'tempr.email',
]);

export function emailDescartavel(email: string): boolean {
  const dominio = email.split('@')[1]?.toLowerCase().trim() ?? '';
  return DESCARTAVEIS.has(dominio) || /(^|\.)(temp|trash|fake|throwaway)[-\w]*mail/.test(dominio);
}

/* ───────────────────────────── Entradas ───────────────────────────── */

/** Os planos que a empresa assina sozinha (o personalizado é combinado com o nosso time). */
export const planoParaAssinar = z.enum(['start', 'time', 'escala']);

/** Senha do cadastro (teste e assinar): a tela mostra cada regra marcando conforme a pessoa digita. */
export const REGRAS_SENHA_CADASTRO: { id: string; texto: string; ok: (s: string) => boolean }[] = [
  { id: 'tamanho', texto: '6 caracteres ou mais', ok: (s) => s.length >= 6 },
  { id: 'maiuscula', texto: 'Uma letra maiúscula', ok: (s) => /\p{Lu}/u.test(s) },
  {
    id: 'especial',
    texto: 'Um caractere especial (! @ # $ % & * …)',
    ok: (s) => /[^\p{L}\p{N}\s]/u.test(s),
  },
];

export const senhaDoCadastro = z
  .string()
  .max(200)
  .refine((s) => s.length >= 6, 'A senha precisa de 6 caracteres ou mais.')
  .refine((s) => /\p{Lu}/u.test(s), 'Use ao menos uma letra maiúscula na senha.')
  .refine((s) => /[^\p{L}\p{N}\s]/u.test(s), 'Use ao menos um caractere especial na senha (! @ # $ % & *).');

/**
 * Nome e empresa do cadastro aparecem nos e-mails do sistema: sem link, sem quebra de linha e sem
 * os símbolos que montam botão ou HTML (ninguém se cadastra como "Clique aqui www.golpe.com").
 */
export function semLinkNoNome(v: string): boolean {
  return !/[[\]<>{}\r\n]|:\/\/|\bwww\.|\.(com|net|org|io|app|xyz|br|me|link|site|online|top|info)(\/|\b)/i.test(
    v,
  );
}

export const cadastroTesteEntrada = z
  .object({
    nome: z
      .string()
      .trim()
      .min(2, 'Informe o seu nome.')
      .max(120)
      .refine(semLinkNoNome, 'Use só o seu nome (sem links nem símbolos como [ ] < >).'),
    /** Opcional: autônomo deixa em branco e a conta fica no nome da pessoa. */
    empresa: z
      .string()
      .trim()
      .max(160)
      .refine(semLinkNoNome, 'Use só o nome da empresa (sem links nem símbolos como [ ] < >).')
      .nullish(),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email('E-mail inválido.')
      .max(200)
      .refine((e) => !emailDescartavel(e), 'Use um e-mail que você acessa (e-mail temporário não vale).'),
    whatsapp: z
      .string()
      .trim()
      .max(40)
      .refine((v) => !!normalizarTelefone(v), 'WhatsApp inválido: use DDD + número.'),
    /** CNPJ ou CPF (autônomo usa o CPF). */
    cnpj: z
      .string({ message: 'Informe o CNPJ ou o CPF.' })
      .trim()
      .max(30)
      .refine((v) => !!documentoDoTexto(v), 'CNPJ ou CPF inválido: confira os números.'),
    senha: senhaDoCadastro,
    aceite: z.literal(true, { message: 'Aceite os termos de uso para continuar.' }),
    /** Token do captcha (Cloudflare Turnstile). */
    captcha: z.string().max(4000).nullish(),
    /** Veio do "Assinar agora" do site: depois de confirmar o e-mail, abre a assinatura neste plano. */
    assinar: planoParaAssinar.nullish(),
  })
  .transform((v) => ({ ...v, empresa: v.empresa && v.empresa.length >= 2 ? v.empresa : v.nome }));
export type CadastroTesteEntrada = z.infer<typeof cadastroTesteEntrada>;

export const assinarEntrada = z
  .object({
    plano: planoParaAssinar,
    usuarios: z.number().int().min(1).max(200),
    modulos: z
      .array(z.enum(MODULOS_NA_ASSINATURA as [Modulo, ...Modulo[]]))
      .max(MODULOS_NA_ASSINATURA.length)
      .default([]),
    numerosExtras: z.number().int().min(0).max(50).default(0),
    documento: z
      .string()
      .trim()
      .max(30)
      .refine((v) => !!documentoDoTexto(v), 'CNPJ ou CPF inválido: confira os números.'),
    nome: z.string().trim().min(2, 'Informe a razão social (ou o nome).').max(160),
    email: z.string().trim().toLowerCase().email('E-mail do financeiro inválido.').max(200),
  })
  .refine((v) => !v.modulos.includes('agente_ia') || v.modulos.includes('whatsapp'), {
    message: 'O Agente de IA conversa pelo WhatsApp: escolha também o WhatsApp.',
    path: ['modulos'],
  });
export type AssinarEntrada = z.infer<typeof assinarEntrada>;

/** O pedido de assinatura como contrato (para calcular o preço com planoEfetivo). */
export function contratoDoPedido(
  d: Pick<AssinarEntrada, 'plano' | 'usuarios' | 'modulos' | 'numerosExtras'>,
): PlanoDaConta {
  return {
    plano: d.plano as PlanoPronto,
    limiteUsuarios: d.usuarios,
    limiteLeadsMes: null,
    modulos: d.modulos,
    mensalidadeManual: null,
    numerosExtras: d.modulos.includes('whatsapp') ? d.numerosExtras : 0,
  };
}

/** Painel master: cobrar pelo sistema um cliente de contrato combinado (o plano é o do painel). */
export const cobrarPeloSistemaEntrada = z.object({
  documento: z
    .string()
    .trim()
    .max(30)
    .refine((v) => !!documentoDoTexto(v), 'CNPJ ou CPF inválido: confira os números.'),
  nome: z.string().trim().min(2, 'Informe a razão social (ou o nome).').max(160),
  email: z.string().trim().toLowerCase().email('E-mail do financeiro inválido.').max(200),
  /** Vencimento da primeira mensalidade (AAAA-MM-DD). */
  vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe o dia do primeiro vencimento.'),
});
export type CobrarPeloSistemaEntrada = z.infer<typeof cobrarPeloSistemaEntrada>;

export const comprarMinutosEntrada = z.object({ pacotes: z.number().int().min(1).max(10).default(1) });

/** Situação da assinatura para a tela (faixa do teste, vencimento, só leitura). */
export interface AssinaturaDaConta {
  situacao: SituacaoAssinatura;
  testeAte: string | null;
  /** Pago até (o mês que vale). */
  acessoAte: string | null;
  /** Venceu: usa normal até aqui; depois, só leitura. */
  toleranciaAte: string | null;
  /** Teste vencido: só leitura até aqui, depois arquiva (quem já pagou fica só leitura sem prazo). */
  soLeituraAte: string | null;
  /** Há mensalidade ou mudança de plano esperando o pagamento. */
  esperandoPagamento: boolean;
  /** Já pagou alguma vez (não é mais teste). */
  jaPagou: boolean;
  /** Gera a cobrança do mês seguinte (desligado = não vai renovar). */
  renovar: boolean;
  leadsUsados: number;
  leadsLimite: number | null;
}
