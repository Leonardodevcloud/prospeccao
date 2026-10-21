import { z } from 'zod';

/* ───────────────────────────── Contas (painel master) ───────────────────────────── */

export const contaNova = z.object({
  nome: z.string().trim().min(2, 'Informe o nome da empresa.').max(80),
  observacoes: z.string().trim().max(1000).optional(),
  /** Primeiro administrador da conta: recebe o link para criar a senha. */
  admin: z.object({
    nome: z.string().trim().min(2, 'Informe o nome do administrador.').max(80),
    email: z.string().trim().toLowerCase().email('E-mail do administrador inválido.'),
  }),
});
export type ContaNova = z.infer<typeof contaNova>;

export const contaAtualizar = z
  .object({
    nome: z.string().trim().min(2).max(80).optional(),
    ativa: z.boolean().optional(),
    observacoes: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nada para atualizar.');
export type ContaAtualizar = z.infer<typeof contaAtualizar>;

export const PROVEDORES_IA_TELA = ['deepseek', 'gemini', 'openai'] as const;

/** Segredo: ausente = mantém; '' ou null = apaga; texto = troca. */
const segredo = z.string().trim().max(500).nullable().optional();
const textoOpcional = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null));

export const credenciaisEntrada = z.object({
  emailRemetente: z
    .string()
    .trim()
    .toLowerCase()
    .email('Remetente inválido (ex.: comercial@suaempresa.com.br).')
    .or(z.literal(''))
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null)),
  resendDominioRespostas: z
    .string()
    .trim()
    .toLowerCase()
    .transform((v) => v.replace(/^@/, '').replace(/^https?:\/\//, ''))
    .pipe(
      z
        .string()
        .regex(
          /^$|^[a-z0-9.-]+\.[a-z]{2,}$/,
          'Domínio de respostas inválido (ex.: respostas.suaempresa.com.br).',
        ),
    )
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null)),
  evolutionUrl: z
    .string()
    .trim()
    .url('Endereço da Evolution inválido (ex.: https://evolution.suaempresa.com.br).')
    .or(z.literal(''))
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null)),
  evolutionInstancia: textoOpcional(100),
  iaProvedor: z.enum(PROVEDORES_IA_TELA).nullable().optional(),
  iaModelo: textoOpcional(120),
  iaBaseUrl: z
    .string()
    .trim()
    .url('Endereço da API de IA inválido.')
    .or(z.literal(''))
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null)),
  segredos: z
    .object({
      placesKey: segredo,
      resendKey: segredo.refine((v) => !v || v.startsWith('re_'), 'A chave do Resend começa com re_.'),
      resendWebhookSegredo: segredo.refine(
        (v) => !v || v.startsWith('whsec_'),
        'O segredo do webhook do Resend começa com whsec_.',
      ),
      evolutionKey: segredo,
      iaKey: segredo,
      orsKey: segredo,
    })
    .partial()
    .optional(),
});
export type CredenciaisEntrada = z.infer<typeof credenciaisEntrada>;

export const SERVICOS_TESTAVEIS = ['resend', 'evolution', 'ia', 'places', 'ors'] as const;
export type ServicoTestavel = (typeof SERVICOS_TESTAVEIS)[number];
