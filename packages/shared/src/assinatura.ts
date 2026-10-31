import { z } from 'zod';
import { cnpjDoTexto } from './importacao.js';
import { normalizarTelefone } from './normalizar.js';
import { LISTA_MODULOS, type Modulo, type PlanoDaConta, type PlanoPronto } from './planos.js';

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

export const cadastroTesteEntrada = z.object({
  nome: z.string().trim().min(2, 'Informe o seu nome.').max(120),
  empresa: z.string().trim().min(2, 'Informe o nome da empresa.').max(160),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('E-mail inválido.')
    .max(200)
    .refine((e) => !emailDescartavel(e), 'Use o e-mail da empresa (e-mail temporário não vale).'),
  whatsapp: z
    .string()
    .trim()
    .max(40)
    .refine((v) => !!normalizarTelefone(v), 'WhatsApp inválido: use DDD + número.'),
  cnpj: z
    .string()
    .trim()
    .max(30)
    .nullish()
    .refine((v) => !v || !!cnpjDoTexto(v), 'CNPJ inválido: confira os números.'),
  senha: z.string().min(10, 'A senha precisa de 10 caracteres ou mais.').max(200),
  aceite: z.literal(true, { message: 'Aceite os termos de uso para continuar.' }),
  /** Token do captcha (Cloudflare Turnstile). */
  captcha: z.string().max(4000).nullish(),
});
export type CadastroTesteEntrada = z.infer<typeof cadastroTesteEntrada>;

export const assinarEntrada = z
  .object({
    plano: z.enum(['start', 'time', 'escala']),
    usuarios: z.number().int().min(1).max(200),
    modulos: z
      .array(z.enum(LISTA_MODULOS as [Modulo, ...Modulo[]]))
      .max(LISTA_MODULOS.length)
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
