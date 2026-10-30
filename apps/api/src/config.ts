import { carregarEnv, envBase, opcional } from '@prospeccao/config';
import { z } from 'zod';

export const esquemaEnvApi = envBase.extend({
  PORT: z.coerce.number().int().default(3000),
  /** Origem(ns) do web, separadas por vírgula. Requisições que alteram dados de outra origem são recusadas. */
  APP_ORIGENS: z
    .string({ message: 'Informe APP_ORIGENS, ex.: https://prospeccao.vercel.app' })
    .transform((v) =>
      v
        .split(',')
        .map((o) => o.trim().replace(/\/$/, '').toLowerCase())
        .filter(Boolean),
    )
    .refine((l) => l.length > 0, 'Informe APP_ORIGENS, ex.: https://prospeccao.vercel.app'),
  JWT_SEGREDO: z.string().min(32, 'JWT_SEGREDO precisa ter pelo menos 32 caracteres'),
  ADMIN_EMAIL: z
    .string()
    .email()
    .transform((v) => v.toLowerCase()),
  /** Hash bcrypt da senha. Gere com: pnpm --filter @prospeccao/api hash-senha */
  ADMIN_SENHA_HASH: z
    .string()
    .regex(/^\$2[aby]\$\d{2}\$.{53}$/, 'ADMIN_SENHA_HASH precisa ser um hash bcrypt'),
  SESSAO_HORAS: z.coerce.number().int().min(1).max(720).default(12),
  /** Opcional: geocodifica o endereço das bases de operação. */
  ORS_API_KEY: opcional(z.string().min(10)),
  /**
   * Chave que cifra as credenciais das contas no banco (32+ caracteres; a mesma no worker-descoberta
   * e no worker-enriquecimento). Sem ela, só a conta principal funciona, pelas variáveis abaixo.
   */
  CHAVE_CREDENCIAIS: opcional(z.string().min(32, 'CHAVE_CREDENCIAIS precisa ter pelo menos 32 caracteres')),
  /*
   * As variáveis abaixo são as credenciais da conta principal (as outras contas cadastram as suas
   * no painel master). A conta principal também pode cadastrar no painel: o painel vale mais.
   */
  /** WhatsApp pelo chip (Evolution). */
  /** Z-API (WhatsApp): token de parceiro (cria as instâncias dos clientes) e token de segurança da conta. */
  ZAPI_PARCEIRO_TOKEN: opcional(z.string().min(10)),
  ZAPI_CLIENT_TOKEN: opcional(z.string().min(10)),
  /** IA da plataforma (vale para todas as contas que não têm a sua): deepseek, gemini ou openai. */
  IA_PROVEDOR: z.enum(['deepseek', 'gemini', 'openai']).optional().catch(undefined),
  IA_API_KEY: opcional(z.string().min(10)),
  IA_MODELO: opcional(z.string().min(2)),
  /** Só para IA_PROVEDOR=openai (OpenRouter, Groq…): endereço da API. */
  IA_BASE_URL: opcional(z.string().url()),
  /** Argos (assistente de voz): ouvir pelo Whisper (Groq por padrão) e falar pelo gpt-4o-mini-tts. */
  GROQ_CHAVE: opcional(z.string().min(10)),
  VOZ_BASE_URL: z.string().url().default('https://api.groq.com/openai/v1'),
  VOZ_MODELO: z.string().default('whisper-large-v3-turbo'),
  OPENAI_CHAVE: opcional(z.string().min(10)),
  FALA_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  FALA_MODELO: z.string().default('gpt-4o-mini-tts'),
  /**
   * Reuniões por vídeo (LiveKit Cloud ou servidor próprio): endereço wss://… e as chaves do projeto.
   * Sem elas, a sala de reunião fica desligada.
   */
  LIVEKIT_URL: opcional(z.string().regex(/^wss?:\/\//, 'LIVEKIT_URL começa com wss://')),
  LIVEKIT_API_KEY: opcional(z.string().min(3)),
  LIVEKIT_API_SECRET: opcional(z.string().min(10)),
  /**
   * Onde as gravações das reuniões ficam (qualquer serviço compatível com S3; ex.: Cloudflare R2).
   * Sem isso, as reuniões funcionam sem gravar. A transcrição usa a GROQ_CHAVE do Argos.
   */
  GRAVACOES_S3_ENDPOINT: opcional(z.string().url()),
  GRAVACOES_S3_REGIAO: z.string().default('auto'),
  /**
   * "sim": as reuniões são gravadas pelo LiveKit (na nuvem, pago por minuto, precisa de plano pago
   * do LiveKit). Sem ela (padrão), quem grava é o navegador de quem conduz, sem custo.
   */
  GRAVACAO_NA_NUVEM: z
    .string()
    .optional()
    .transform((v) => /^(sim|true|1)$/i.test(v?.trim() ?? '')),
  /** Opcional: outra página para a gravação filmar (padrão: <APP_ORIGENS[0]>/gravacao). */
  GRAVACOES_MODELO_URL: opcional(z.string().url()),
  GRAVACOES_S3_BUCKET: opcional(z.string().min(3)),
  GRAVACOES_S3_CHAVE: opcional(z.string().min(3)),
  GRAVACOES_S3_SEGREDO: opcional(z.string().min(10)),
  /** Raciocínio da IA antes de responder (desligado = mais rápido). */
  ARGOS_RACIOCINIO: z.enum(['desligado', 'baixo', 'alto']).catch('desligado').default('desligado'),
  /** Legado: sem IA_API_KEY, a IA é o Gemini com esta chave. */
  GEMINI_API_KEY: opcional(z.string().min(10)),
  GEMINI_MODELO: z.string().default('gemini-3.5-flash-lite'),
  /** Google Places da conta principal (a API só usa para o botão "Testar" do painel). */
  GOOGLE_PLACES_KEY: opcional(z.string().min(10)),
  /** E-mail de prospecção pelo Resend. */
  RESEND_API_KEY: opcional(z.string().startsWith('re_', 'RESEND_API_KEY começa com re_')),
  /** Remetente, de um domínio verificado no Resend (ex.: comercial@suaempresa.com.br). */
  EMAIL_REMETENTE: opcional(z.string().email()),
  /** Domínio de recebimento no Resend (ex.: respostas.suaempresa.com.br ou xxxx.resend.app). */
  RESEND_DOMINIO_RESPOSTAS: opcional(
    z
      .string()
      .transform((v) => v.trim().toLowerCase().replace(/^@/, ''))
      .pipe(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, 'Domínio inválido')),
  ),
  /** Segredo do webhook do Resend (whsec_…). */
  RESEND_WEBHOOK_SEGREDO: opcional(z.string().startsWith('whsec_', 'O segredo do webhook começa com whsec_')),
});

export type EnvApi = z.infer<typeof esquemaEnvApi>;

/** Credenciais do ambiente: as da conta principal (e a IA da plataforma, para todas). */
export function credenciaisDoAmbiente(env: EnvApi) {
  const iaLegada = !env.IA_API_KEY && env.GEMINI_API_KEY;
  return {
    placesKey: env.GOOGLE_PLACES_KEY ?? null,
    orsKey: env.ORS_API_KEY ?? null,
    resendKey: env.RESEND_API_KEY ?? null,
    emailRemetente: env.EMAIL_REMETENTE ?? null,
    resendDominioRespostas: env.RESEND_DOMINIO_RESPOSTAS ?? null,
    resendWebhookSegredo: env.RESEND_WEBHOOK_SEGREDO ?? null,
    zapiParceiroToken: env.ZAPI_PARCEIRO_TOKEN ?? null,
    zapiClientToken: env.ZAPI_CLIENT_TOKEN ?? null,
    iaProvedor: iaLegada ? 'gemini' : (env.IA_PROVEDOR ?? null),
    iaKey: env.IA_API_KEY ?? env.GEMINI_API_KEY ?? null,
    iaModelo: iaLegada ? env.GEMINI_MODELO : (env.IA_MODELO ?? null),
    iaBaseUrl: env.IA_BASE_URL ?? null,
  };
}

export function carregarEnvApi(): EnvApi {
  return carregarEnv(esquemaEnvApi);
}
