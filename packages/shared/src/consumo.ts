import { z } from 'zod';

/**
 * Saúde e consumo dos serviços externos (painel master). Os planos que a plataforma contratou em
 * cada serviço: quanto custa por mês (fixo), o que vem incluso e quanto custa o que passar disso
 * (excedente). O sistema mede o uso e compara.
 */

/** Serviços externos que o medidor de chamadas conhece (pelo endereço chamado). */
export const SERVICOS_EXTERNOS = [
  'ia',
  'whatsapp',
  'livekit',
  'groq',
  'voz',
  'email',
  'serper',
  'places',
  'ors',
  'asaas',
  'meta',
  'r2',
  'brasilapi',
  'directd',
  'vercel',
  'claude',
] as const;
export type ServicoExterno = (typeof SERVICOS_EXTERNOS)[number];

export const NOME_SERVICO: Record<ServicoExterno, string> = {
  ia: 'IA da plataforma',
  whatsapp: 'WhatsApp · Z-API',
  livekit: 'LiveKit · reuniões e ligações',
  groq: 'Transcrição · Groq',
  voz: 'Voz do Argos · OpenAI',
  email: 'E-mail · Resend',
  serper: 'Busca no Google · Serper',
  places: 'Google Maps · Places',
  ors: 'Rotas · OpenRouteService',
  asaas: 'Cobrança · Asaas',
  meta: 'Instagram e anúncios · Meta',
  r2: 'Gravações · R2',
  brasilapi: 'CNPJ · BrasilAPI',
  directd: 'Base paga · Direct Data',
  vercel: 'Domínios · Vercel',
  claude: 'Carrosséis · Claude (Anthropic)',
};

export const PAPEL_SERVICO: Record<ServicoExterno, string> = {
  ia: 'respostas do agente, notas dos leads, resumos e Argos',
  whatsapp: 'mensagens e números dos clientes',
  livekit: 'salas de reunião e a ponte das ligações',
  groq: 'transcrição das reuniões, das ligações e da voz do Argos',
  voz: 'a voz com que o Argos responde e o aviso de gravação',
  email: 'sequências e e-mails do sistema',
  serper: 'site, Instagram, LinkedIn e contatos dos leads',
  places: 'busca das empresas nas campanhas',
  ors: 'roteiros de visita',
  asaas: 'teste grátis e assinaturas',
  meta: 'comente e receba, direct e formulários',
  r2: 'arquivos das gravações',
  brasilapi: 'confere o CNPJ de quem veio só do Maps',
  directd: 'telefones atualizados por CNPJ',
  vercel: 'domínio próprio dos clientes',
  claude: 'o time de IA dos carrosséis (estratégia, texto e revisão)',
};

/**
 * Qual serviço é pelo endereço chamado (null = não é um serviço que a plataforma paga, como o site
 * de um lead). A IA da plataforma pode ser DeepSeek, Gemini ou OpenAI; na OpenAI, o caminho
 * /audio/speech é a voz do Argos.
 */
export function servicoDoEndereco(url: string): ServicoExterno | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const h = u.hostname.toLowerCase();
  const fim = (s: string) => h === s || h.endsWith(`.${s}`);
  if (fim('api.openai.com')) return u.pathname.includes('/audio/speech') ? 'voz' : 'ia';
  if (fim('api.deepseek.com') || fim('generativelanguage.googleapis.com')) return 'ia';
  if (fim('groq.com')) return 'groq';
  if (fim('z-api.io')) return 'whatsapp';
  if (fim('livekit.cloud')) return 'livekit';
  if (fim('resend.com')) return 'email';
  if (fim('serper.dev')) return 'serper';
  if (fim('places.googleapis.com') || fim('maps.googleapis.com')) return 'places';
  if (fim('openrouteservice.org')) return 'ors';
  if (fim('asaas.com')) return 'asaas';
  if (fim('graph.facebook.com') || fim('graph.instagram.com')) return 'meta';
  if (fim('r2.cloudflarestorage.com')) return 'r2';
  if (fim('brasilapi.com.br')) return 'brasilapi';
  if (fim('directd.com.br')) return 'directd';
  if (fim('api.vercel.com')) return 'vercel';
  if (fim('api.anthropic.com')) return 'claude';
  return null;
}

/* ---------------- Planos dos serviços ---------------- */

const n = z.number().min(0).max(100_000_000);
const opcional = n.nullable();
const texto = z.string().trim().max(60);
const dataIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a data no formato AAAA-MM-DD.')
  .refine(
    (d) =>
      !Number.isNaN(Date.parse(`${d}T12:00:00Z`)) && new Date(`${d}T12:00:00Z`).toISOString().startsWith(d),
    'Data inválida.',
  );

export const planosConsumoEntrada = z.object({
  /** LiveKit: o plano (Build, Ship, Scale…), quanto custa e o que inclui por mês. */
  livekit: z.object({
    plano: texto,
    mensalUsd: n,
    /** Minutos de participante em sala (reuniões e quem liga pelo navegador). */
    participanteMin: n,
    /** US$ por minuto acima do incluso; null = o plano não cobra excedente (para de funcionar). */
    participanteExtraUsd: opcional,
    /** Minutos de ligação (SIP: o lado do lead, feitas e recebidas). */
    ligacaoMin: n,
    ligacaoExtraUsd: opcional,
  }),
  /** Operadora do telefone (tronco SIP): a franquia e o preço do minuto em reais. */
  telefone: z.object({
    operadora: texto,
    mensal: n,
    /** Minutos incluídos na mensalidade (0 = sem franquia, tudo pela tarifa). */
    franquiaMin: n,
    celularMin: n,
    fixoMin: n,
  }),
  /**
   * Serper: pré-pago. Cada pacote é pago uma vez e os créditos valem alguns meses (6 no Serper);
   * o que não for usado até lá se perde. Não tem mensalidade.
   */
  serper: z.object({
    pacotes: z.array(z.object({ compradoEm: dataIso, creditos: n, usd: n })).max(40),
    validadeMeses: z.number().int().min(1).max(36),
  }),
  /** Resend: plano, e-mails inclusos e o preço por mil acima disso. */
  resend: z.object({ plano: texto, mensalUsd: n, emails: n, extraUsdMil: opcional }),
  /** R2: GB grátis (o preço do GB fica em Custos unitários). */
  r2: z.object({ gbGratis: n }),
  /** Limite de gasto que você definiu (só para avisar), em reais e em dólar. */
  ia: z.object({ limiteMes: opcional }),
  places: z.object({ limiteUsd: opcional }),
  /** OpenRouteService: chamadas por dia do plano grátis. */
  ors: z.object({ porDia: n }),
  /** Outros custos fixos por mês (servidores, Vercel, domínios…), em reais. */
  fixos: z.array(z.object({ nome: z.string().trim().min(1).max(80), valor: n })).max(30),
});
export type PlanosConsumo = z.infer<typeof planosConsumoEntrada>;

export const PLANOS_PADRAO: PlanosConsumo = {
  livekit: {
    plano: 'Ship',
    mensalUsd: 50,
    participanteMin: 150_000,
    participanteExtraUsd: 0.0005,
    ligacaoMin: 5_000,
    ligacaoExtraUsd: 0.004,
  },
  telefone: { operadora: 'Nvoip', mensal: 0, franquiaMin: 0, celularMin: 0.35, fixoMin: 0.07 },
  serper: { pacotes: [], validadeMeses: 6 },
  resend: { plano: 'Pro', mensalUsd: 20, emails: 50_000, extraUsdMil: 0.9 },
  r2: { gbGratis: 10 },
  ia: { limiteMes: null },
  places: { limiteUsd: null },
  ors: { porDia: 2_000 },
  fixos: [],
};

/** Junta o que veio do banco com os padrões (bloco faltando ou inválido = padrão). */
export function planosCompletos(dados: unknown): PlanosConsumo {
  const d = (dados && typeof dados === 'object' ? dados : {}) as Record<string, unknown>;
  const saida = { ...PLANOS_PADRAO } as Record<string, unknown>;
  for (const [k, esquema] of Object.entries(planosConsumoEntrada.shape)) {
    if (!(k in d)) continue;
    const r = (esquema as z.ZodType).safeParse(
      k === 'fixos' ? d[k] : { ...(PLANOS_PADRAO as Record<string, object>)[k], ...(d[k] as object) },
    );
    if (r.success) saida[k] = r.data;
  }
  return saida as PlanosConsumo;
}

/** Custo fixo do mês: os planos pagos dos serviços e os outros fixos, em reais (o Serper é pré-pago: não entra). */
export function fixosDoMes(
  p: PlanosConsumo,
  dolar: number,
): { nome: string; valor: number; plano: boolean }[] {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const lista: { nome: string; valor: number; plano: boolean }[] = [];
  if (p.livekit.mensalUsd > 0)
    lista.push({
      nome: `LiveKit · plano ${p.livekit.plano}`,
      valor: r2(p.livekit.mensalUsd * dolar),
      plano: true,
    });
  if (p.resend.mensalUsd > 0)
    lista.push({
      nome: `Resend · plano ${p.resend.plano}`,
      valor: r2(p.resend.mensalUsd * dolar),
      plano: true,
    });
  if (p.telefone.mensal > 0)
    lista.push({ nome: `${p.telefone.operadora} · franquia`, valor: r2(p.telefone.mensal), plano: true });
  for (const f of p.fixos) lista.push({ nome: f.nome, valor: r2(f.valor), plano: false });
  return lista;
}

/* ---------------- Serper: créditos pré-pagos ---------------- */

/** US$ por crédito quando nenhum pacote pago foi informado (o pacote de 50 mil por US$ 50). */
export const PRECO_CREDITO_SERPER_USD = 0.001;

/** Quanto custa um crédito: o do pacote pago mais recente (o grátis do cadastro não conta). */
export function precoCreditoSerper(s: PlanosConsumo['serper']): number {
  const pagos = s.pacotes.filter((p) => p.usd > 0 && p.creditos > 0);
  const ultimo = pagos.sort((a, b) => a.compradoEm.localeCompare(b.compradoEm)).at(-1);
  return ultimo ? ultimo.usd / ultimo.creditos : PRECO_CREDITO_SERPER_USD;
}

/** A data (AAAA-MM-DD) somada de alguns meses (31/08 + 6 meses = 28/02). */
export function somarMeses(data: string, meses: number): string {
  const [a, m, d] = data.split('-').map(Number) as [number, number, number];
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimoDia = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimoDia));
  return alvo.toISOString().slice(0, 10);
}

export interface PacoteSerper {
  compradoEm: string;
  /** Primeiro dia em que o pacote já não vale. */
  venceEm: string;
  creditos: number;
  usd: number;
  usados: number;
  restante: number;
  vencido: boolean;
}

export interface SaldoSerper {
  /** Pacotes do mais antigo para o mais novo, com o que cada um já gastou. */
  pacotes: PacoteSerper[];
  /** Créditos que ainda valem (pacotes que não venceram). */
  saldo: number;
  /** Total dos pacotes que ainda valem (para a barra). */
  totalValendo: number;
  /** Buscas feitas quando não havia pacote informado com saldo. */
  semPacote: number;
  /** Créditos usados neste mês e quanto eles custaram (ao preço de cada pacote). */
  usadosMes: number;
  custoMesUsd: number;
  /** Créditos que venceram sem uso neste mês e quanto tinham custado. */
  perdidosMes: number;
  perdidosMesUsd: number;
  /** Créditos por dia no ritmo do mês (ou dos últimos 30 dias no começo do mês). */
  ritmoDia: number;
  precoCreditoUsd: number;
}

/**
 * Saldo dos créditos do Serper a partir dos pacotes comprados e das buscas de cada dia. Cada dia
 * gasta primeiro o pacote que vence antes. O Serper não informa o saldo pela API: é uma conta do
 * sistema (confira de vez em quando no painel do Serper).
 */
export function saldoSerper(
  s: PlanosConsumo['serper'],
  uso: { dia: string; buscas: number }[],
  hoje: string,
  inicioMes: string,
): SaldoSerper {
  const pacotes: PacoteSerper[] = [...s.pacotes]
    .sort((a, b) => a.compradoEm.localeCompare(b.compradoEm))
    .map((p) => ({
      compradoEm: p.compradoEm,
      venceEm: somarMeses(p.compradoEm, s.validadeMeses),
      creditos: p.creditos,
      usd: p.usd,
      usados: 0,
      restante: p.creditos,
      vencido: false,
    }));
  const preco = precoCreditoSerper(s);
  let semPacote = 0;
  let usadosMes = 0;
  let custoMesUsd = 0;
  for (const { dia, buscas } of [...uso].sort((a, b) => a.dia.localeCompare(b.dia))) {
    if (dia > hoje) continue;
    let falta = buscas;
    const valendo = pacotes
      .filter((p) => p.compradoEm <= dia && dia < p.venceEm && p.restante > 0)
      .sort((a, b) => a.venceEm.localeCompare(b.venceEm));
    for (const p of valendo) {
      if (falta <= 0) break;
      const gasto = Math.min(falta, p.restante);
      p.restante -= gasto;
      p.usados += gasto;
      falta -= gasto;
      if (dia >= inicioMes) custoMesUsd += gasto * (p.creditos ? p.usd / p.creditos : 0);
    }
    if (falta > 0) {
      semPacote += falta;
      if (dia >= inicioMes) custoMesUsd += falta * preco;
    }
    if (dia >= inicioMes) usadosMes += buscas;
  }
  let perdidosMes = 0;
  let perdidosMesUsd = 0;
  for (const p of pacotes) {
    p.vencido = p.venceEm <= hoje;
    if (p.vencido && p.venceEm >= inicioMes && p.restante > 0) {
      perdidosMes += p.restante;
      perdidosMesUsd += p.restante * (p.creditos ? p.usd / p.creditos : 0);
    }
  }
  const valendo = pacotes.filter((p) => !p.vencido && p.compradoEm <= hoje);
  // Ritmo: o mês até hoje; no comecinho do mês, os últimos 30 dias.
  const diasMes = Math.max(1, Math.round((Date.parse(hoje) - Date.parse(inicioMes)) / 86_400_000) + 1);
  const desde30 = new Date(Date.parse(hoje) - 29 * 86_400_000).toISOString().slice(0, 10);
  const ultimos30 = uso.filter((u) => u.dia >= desde30 && u.dia <= hoje).reduce((t, u) => t + u.buscas, 0);
  const ritmoDia = diasMes >= 7 ? usadosMes / diasMes : ultimos30 / 30;
  return {
    pacotes,
    saldo: valendo.reduce((t, p) => t + p.restante, 0),
    totalValendo: valendo.reduce((t, p) => t + p.creditos, 0),
    semPacote,
    usadosMes,
    custoMesUsd,
    perdidosMes,
    perdidosMesUsd,
    ritmoDia,
    precoCreditoUsd: preco,
  };
}

/* ---------------- Ligações ---------------- */

/**
 * Segundos que a operadora cobra de uma ligação atendida, na cadência 3/30/6 (Nvoip): até 3 s não
 * cobra; depois, os primeiros 30 s inteiros e, passando disso, de 6 em 6 segundos.
 */
export function segundosCobrados(duracao: number): number {
  if (duracao <= 3) return 0;
  if (duracao <= 30) return 30;
  return 30 + Math.ceil((duracao - 30) / 6) * 6;
}

/* ---------------- Previsão ---------------- */

/** Quanto do mês já passou (0 a 1), no fuso de São Paulo. */
export function fracaoDoMes(agora: Date = new Date()): { fracao: number; dia: number; dias: number } {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(agora);
  const v = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  const ano = v('year');
  const mes = v('month');
  const dias = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const dia = v('day');
  const fracao = Math.min(1, Math.max(1 / (dias * 24), (dia - 1 + (v('hour') % 24) / 24) / dias));
  return { fracao, dia, dias };
}

/** Onde o mês fecha se continuar no ritmo de agora. */
export function preverMes(usadoAteAgora: number, fracao: number): number {
  return fracao > 0 ? usadoAteAgora / fracao : usadoAteAgora;
}

/* ---------------- O que a tela recebe ---------------- */

export type EstadoServicoAgora = 'ok' | 'aviso' | 'erro' | 'quieto';

export interface ServicoAgora {
  id: ServicoExterno;
  nome: string;
  papel: string;
  estado: EstadoServicoAgora;
  /** Chamadas e erros por minuto, da mais antiga para a mais nova (60 minutos). */
  serie: number[];
  serieErros: number[];
  chamadas: number;
  erros: number;
  /** Tempo médio de resposta (ms) na última hora; null sem chamadas. */
  msMedio: number | null;
  ultimoProblema: { em: string; texto: string } | null;
  /** Uma linha a mais (números conectados, salas abertas…). */
  detalhe: string | null;
}

export interface SaudeAgora {
  atualizadoEm: string;
  servicos: ServicoAgora[];
  aoVivo: { reunioes: number; pessoasEmSala: number; ligacoes: number; respostasIaHora: number };
  banco: { tamanhoGb: number; conexoes: number; maxConexoes: number; msConsulta: number };
  workers: { nome: string; vistoEm: string; parado: boolean }[];
  fila: { enriquecimento: number };
  resumo: { respondendo: number; total: number; chamadasHora: number; errosHora: number };
}

export interface CotaMes {
  id: string;
  grupo: 'livekit' | 'outros';
  nome: string;
  sub: string;
  /** Texto do número principal e do "de X" (já formatados). */
  valor: string;
  de: string | null;
  /** 0 a 1+ do que já foi usado e da previsão, para as barras (null = sem limite). */
  usado: number | null;
  previsao: number | null;
  estado: 'ok' | 'aviso' | 'erro';
  detalhe: string;
  fonte: 'medido' | 'provedor';
}

export interface CustoLinha {
  nome: string;
  detalhe: string;
  ate: number;
  previsao: number;
}

export interface SaudeMes {
  periodo: { dia: number; dias: number; fracao: number };
  alertas: { id: string; titulo: string; texto: string }[];
  cotas: CotaMes[];
  custos: {
    receita: number;
    pagantes: number;
    fixos: { nome: string; valor: number; plano: boolean }[];
    fixoTotal: number;
    variaveis: CustoLinha[];
    variavelAte: number;
    variavelPrevisao: number;
    totalAte: number;
    totalPrevisao: number;
  };
  planos: PlanosConsumo;
  /** Saldo e vencimento dos pacotes do Serper (pré-pago). */
  serper: SaldoSerper;
  dolar: number;
}
