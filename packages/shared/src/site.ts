import { z } from 'zod';
import { normalizarTelefone } from './normalizar.js';

/**
 * Formulário "Agendar demonstração" do site institucional e o contato comercial que o site mostra
 * (configurado no painel master).
 */

export const PLANOS_DO_SITE = ['Ainda não sei', 'Start', 'Time', 'Escala', 'Personalizado'] as const;

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

/* ───────────────────────────── Visitas do site ───────────────────────────── */

/** O que o site manda a cada página aberta, clique num botão principal e saída (sem cookie). */
export const visitaSiteEntrada = z.object({
  evento: z.enum(['visita', 'clique', 'saida']),
  pagina: z.string().trim().max(200).default('/'),
  /** Botão clicado: teste, assinar:start, demonstracao, whatsapp, entrar, apresentacao… */
  alvo: z.string().trim().max(60).nullish(),
  /** Domínio de onde a pessoa veio (só o domínio). */
  referencia: z.string().trim().max(200).nullish(),
  utmOrigem: z.string().trim().max(100).nullish(),
  utmMeio: z.string().trim().max(100).nullish(),
  utmCampanha: z.string().trim().max(100).nullish(),
  /** Até onde rolou a página (0 a 100). */
  profundidade: z.number().int().min(0).max(100).nullish(),
  segundos: z.number().int().min(0).max(86_400).nullish(),
  /** As seções que apareceram na tela (ids do site). */
  secoes: z.array(z.string().trim().max(40)).max(30).nullish(),
});
export type VisitaSiteEntrada = z.infer<typeof visitaSiteEntrada>;

/** Nome legível do botão clicado no site. */
export const ROTULO_CLIQUE_SITE: Record<string, string> = {
  teste: 'Testar grátis',
  'assinar:start': 'Assinar o Start',
  'assinar:time': 'Assinar o Time',
  'assinar:escala': 'Assinar o Escala',
  personalizado: 'Plano personalizado',
  demonstracao: 'Agendar demonstração',
  whatsapp: 'WhatsApp',
  entrar: 'Entrar no sistema',
  apresentacao: 'Ver a apresentação',
  api: 'Documentação da API',
};

/** Nome das seções da página inicial (para o "até onde chegam"). */
export const SECOES_DO_SITE: { id: string; rotulo: string }[] = [
  { id: 'inicio', rotulo: 'Abertura' },
  { id: 'nichos', rotulo: 'Nichos e cidades' },
  { id: 'como', rotulo: 'Como funciona' },
  { id: 'instagram', rotulo: 'Instagram' },
  { id: 'ligacoes', rotulo: 'Ligações' },
  { id: 'recursos', rotulo: 'Telas do sistema' },
  { id: 'funcoes', rotulo: 'Funções' },
  { id: 'planos', rotulo: 'Planos' },
  { id: 'duvidas', rotulo: 'Dúvidas' },
  { id: 'contato', rotulo: 'Contato' },
];

/** De onde a pessoa veio, pelo domínio (ou pela utm_source do link). */
export function origemDaVisita(referencia: string | null | undefined, utm?: string | null): string {
  if (utm) {
    const u = utm.toLowerCase();
    if (/insta/.test(u)) return 'Instagram';
    if (/face|fb|meta/.test(u)) return 'Facebook';
    if (/whats|wpp|zap/.test(u)) return 'WhatsApp';
    if (/linkedin/.test(u)) return 'LinkedIn';
    if (/google/.test(u)) return 'Google';
    if (/mail/.test(u)) return 'E-mail';
    return utm.slice(0, 40);
  }
  const r = (referencia ?? '').toLowerCase().replace(/^www\./, '');
  if (!r) return 'Direto';
  if (/(^|\.)prospectteam\.com\.br$/.test(r)) return 'Interno';
  const mapa: [RegExp, string][] = [
    [/(^|\.)google\./, 'Google'],
    [/(^|\.)bing\.com$/, 'Bing'],
    [/(^|\.)(instagram\.com|l\.instagram\.com)$/, 'Instagram'],
    [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, 'Facebook'],
    [/(^|\.)(linkedin\.com|lnkd\.in)$/, 'LinkedIn'],
    [/(^|\.)(whatsapp\.com|wa\.me)$/, 'WhatsApp'],
    [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube'],
    [/(^|\.)(chatgpt\.com|openai\.com)$/, 'ChatGPT'],
    [/(^|\.)perplexity\.ai$/, 'Perplexity'],
    [/(^|\.)(t\.co|x\.com|twitter\.com)$/, 'X (Twitter)'],
    [/(^|\.)duckduckgo\.com$/, 'DuckDuckGo'],
    [/(^|\.)yahoo\./, 'Yahoo'],
  ];
  return mapa.find(([re]) => re.test(r))?.[1] ?? r.slice(0, 60);
}

/** Celular, tablet ou computador, pelo navegador. */
export function dispositivoDoNavegador(ua: string | null | undefined): 'celular' | 'tablet' | 'computador' {
  const u = ua ?? '';
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(u)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android/i.test(u)) return 'celular';
  return 'computador';
}

/** Robôs e pré-visualizações (não contam como visita). */
export const NAVEGADOR_ROBO =
  /bot|crawl|spider|slurp|preview|headless|lighthouse|pagespeed|facebookexternalhit|whatsapp|telegram|curl|wget|python|axios|node-fetch|go-http|monitor|uptime|vercel-screenshot/i;
