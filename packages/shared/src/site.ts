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

export const pedidoSiteStatusEntrada = z.object({ status: z.enum(['novo', 'atendido', 'descartado']) });
