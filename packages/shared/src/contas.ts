import { z } from 'zod';
import { planoContaEntrada } from './planos.js';

/* ───────────────────────────── Contas (painel master) ───────────────────────────── */

export const contaNova = z.object({
  nome: z.string().trim().min(2, 'Informe o nome da empresa.').max(80),
  observacoes: z.string().trim().max(1000).optional(),
  /** Primeiro administrador da conta: recebe o link para criar a senha. */
  admin: z.object({
    nome: z.string().trim().min(2, 'Informe o nome do administrador.').max(80),
    email: z.string().trim().toLowerCase().email('E-mail do administrador inválido.'),
  }),
  /** Plano já na criação (pode mudar depois). */
  plano: planoContaEntrada.optional(),
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

/** Tetos do mês de uma conta (null = sem teto). */
const teto = z.number().int().min(0).max(10_000_000).nullable().optional();
export const limitesConta = z.object({
  /** Sem IA própria, a conta pode usar a IA da plataforma (a sua chave). */
  usaIaPlataforma: z.boolean().optional(),
  /** Chamadas à IA da plataforma por mês. */
  iaMes: teto,
  /** E-mails automáticos por mês. */
  emailsMes: teto,
  /** Mensagens automáticas de WhatsApp por mês. */
  whatsappMes: teto,
});
export type LimitesConta = z.infer<typeof limitesConta>;

export const filtrosAuditoria = z.object({
  usuarioId: z.coerce.number().int().positive().optional(),
  acao: z.string().trim().max(40).optional(),
  busca: z.string().trim().max(120).optional(),
  empresaId: z.coerce.number().int().positive().optional(),
  dias: z.coerce.number().int().min(1).max(3650).optional(),
  antesDe: z.coerce.number().int().positive().optional(),
});

/** Senha esquecida: o e-mail de quem pede o link. */
export const esqueciSenha = z.object({
  email: z.string().trim().toLowerCase().email('E-mail inválido.'),
});

/** Chip de WhatsApp (instância da Evolution da conta). */
export const chipEntrada = z.object({
  nome: z.string().trim().min(1, 'Dê um nome ao chip (ex.: Comercial 2).').max(60),
  instancia: z
    .string()
    .trim()
    .min(1, 'Informe o nome da instância na Evolution.')
    .max(100)
    .regex(/^[\w.@-]+$/, 'A instância tem só letras, números, ponto, hífen e sublinhado.'),
  limiteDia: z.number().int().min(1).max(1000).default(40),
  /** Número novo começa mandando pouco e vai subindo (aquecimento). */
  aquecer: z.boolean().default(true),
  /** Há quantos dias o número já é usado no WhatsApp (o aquecimento conta a partir daí). */
  diasDeUso: z.number().int().min(0).max(3650).default(0),
});
export const chipAtualizar = z
  .object({
    nome: z.string().trim().min(1).max(60).optional(),
    ativo: z.boolean().optional(),
    limiteDia: z.number().int().min(1).max(1000).optional(),
    aquecer: z.boolean().optional(),
    diasDeUso: z.number().int().min(0).max(3650).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nada para atualizar.');

/** Inscrição de um aparelho para receber notificações (Web Push). */
export const inscricaoPush = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
  aparelho: z.string().trim().max(120).nullable().optional(),
});
