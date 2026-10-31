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
  return null;
}

/* ---------------- Planos dos serviços ---------------- */

const n = z.number().min(0).max(100_000_000);
const opcional = n.nullable();
const texto = z.string().trim().max(60);

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
  /** Serper: créditos por mês (o pacote que você compra) e quanto custa. */
  serper: z.object({ mensalUsd: n, creditos: n }),
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
  serper: { mensalUsd: 50, creditos: 50_000 },
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

/** Custo fixo do mês: os planos pagos dos serviços e os outros fixos, em reais. */
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
  if (p.serper.mensalUsd > 0)
    lista.push({
      nome: `Serper · ${p.serper.creditos.toLocaleString('pt-BR')} créditos`,
      valor: r2(p.serper.mensalUsd * dolar),
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
  dolar: number;
}
