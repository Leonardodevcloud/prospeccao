import { z } from 'zod';
import { normalizarTelefone } from './normalizar.js';

/**
 * Formulário "Agendar demonstração" do site institucional e o contato comercial que o site mostra
 * (configurado no painel master).
 */

export const PLANOS_DO_SITE = ['Ainda não sei', 'Start', 'Time', 'Escala'] as const;

export const pedidoSiteEntrada = z.object({
  nome: z.string().trim().min(2, 'Informe o seu nome.').max(120),
  empresa: z.string().trim().min(2, 'Informe o nome da empresa.').max(160),
  whatsapp: z
    .string()
    .trim()
    .max(40)
    .refine((v) => !!normalizarTelefone(v), 'WhatsApp inválido: use DDD + número (ex.: 71 99999-1234).'),
  email: z.string().trim().toLowerCase().email('E-mail inválido.').max(200).nullish().or(z.literal('')),
  nicho: z.string().trim().max(200).nullish(),
  plano: z.enum(PLANOS_DO_SITE).nullish().catch(null),
  canal: z.enum(['whatsapp', 'email', 'formulario']).default('formulario'),
  /** De onde veio o pedido: o site ou o botão da apresentação comercial. */
  origem: z.enum(['site', 'apresentacao']).default('site').catch('site'),
  /** Campo escondido: gente não preenche, robô sim. */
  site: z.string().max(200).nullish(),
});
export type PedidoSiteEntrada = z.infer<typeof pedidoSiteEntrada>;

/** WhatsApp do comercial: só números, com 55 e DDD. */
export function whatsappComDdi(v: string | null | undefined): string | null {
  const n = normalizarTelefone(v);
  return n ? `55${n}` : null;
}

export const configSiteEntrada = z.object({
  whatsapp: z
    .string()
    .trim()
    .max(40)
    .nullish()
    .refine((v) => !v || !!normalizarTelefone(v), 'WhatsApp inválido: use DDD + número.'),
  email: z.string().trim().toLowerCase().email('E-mail inválido.').max(200).nullish().or(z.literal('')),
});

/** Quadro de vendas da plataforma (painel master): o caminho do pedido do site até virar cliente. */
export const ETAPAS_VENDA = [
  'novo',
  'contato',
  'demonstracao',
  'teste',
  'proposta',
  'cliente',
  'perdido',
] as const;
export type EtapaVenda = (typeof ETAPAS_VENDA)[number];
export const ROTULO_ETAPA_VENDA: Record<EtapaVenda, string> = {
  novo: 'Novo pedido',
  contato: 'Em contato',
  demonstracao: 'Demonstração marcada',
  teste: 'Testando',
  proposta: 'Proposta enviada',
  cliente: 'Virou cliente',
  perdido: 'Perdido',
};

export const pedidoSiteAtualizar = z.object({
  etapa: z.enum(ETAPAS_VENDA).optional(),
  nota: z.string().trim().max(2000).nullish(),
  motivoPerda: z.string().trim().max(300).nullish(),
  demonstracaoEm: z.string().datetime({ offset: true }).nullish(),
  contaId: z.number().int().positive().nullish(),
});
export type PedidoSiteAtualizar = z.infer<typeof pedidoSiteAtualizar>;

/** Pedido cadastrado à mão no quadro de vendas (indicação, contato que chegou por outro canal). */
export const pedidoVendaNovo = pedidoSiteEntrada
  .pick({ nome: true, empresa: true, whatsapp: true, email: true, nicho: true, plano: true })
  .extend({ nota: z.string().trim().max(2000).nullish() });
