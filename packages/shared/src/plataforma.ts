import { z } from 'zod';

/**
 * Custos unitários da plataforma (painel master), para estimar quanto cada cliente custa no mês e
 * comparar com a mensalidade. São estimativas de partida: o master ajusta para os valores da fatura
 * de cada fornecedor. Tudo em reais, exceto o que o fornecedor cobra em dólar (convertido pelo dólar
 * informado).
 */
export interface CustosPlataforma {
  /** Cotação usada para o que é cobrado em dólar (Google Maps). */
  dolar: number;
  /** Serper: cada 1.000 buscas no Google (enriquecimento). */
  serperMil: number;
  /** IA da plataforma: cada 1 milhão de tokens enviados e recebidos. */
  iaEntradaMilhao: number;
  iaSaidaMilhao: number;
  /** E-mail (Resend da plataforma): cada 1.000 enviados. */
  emailMil: number;
  /** WhatsApp (Z-API da plataforma): cada número conectado, por mês. */
  whatsappNumeroMes: number;
  /** Reuniões por vídeo (LiveKit): cada 1.000 minutos de participante. */
  reuniaoMilMinutos: number;
  /** Transcrição das reuniões (Groq): cada hora de áudio. */
  transcricaoHora: number;
  /** Gravações e fotos guardadas (R2): cada GB por mês. */
  armazenamentoGbMes: number;
}

export const CUSTOS_PADRAO: CustosPlataforma = {
  dolar: 5.5,
  serperMil: 5.5,
  iaEntradaMilhao: 1.6,
  iaSaidaMilhao: 6.1,
  emailMil: 2.2,
  whatsappNumeroMes: 99.99,
  reuniaoMilMinutos: 2.75,
  transcricaoHora: 0.22,
  armazenamentoGbMes: 0.08,
};

const valor = z.number().min(0).max(1_000_000);
export const custosPlataformaEntrada = z.object({
  dolar: valor,
  serperMil: valor,
  iaEntradaMilhao: valor,
  iaSaidaMilhao: valor,
  emailMil: valor,
  whatsappNumeroMes: valor,
  reuniaoMilMinutos: valor,
  transcricaoHora: valor,
  armazenamentoGbMes: valor,
});

/** Junta o que veio do banco com os padrões (campo faltando = padrão). */
export function custosCompletos(c: unknown): CustosPlataforma {
  const r = custosPlataformaEntrada.partial().safeParse(c ?? {});
  return { ...CUSTOS_PADRAO, ...(r.success ? r.data : {}) };
}

/** O que uma conta consumiu no mês e que a plataforma paga (chaves da plataforma). */
export interface UsoPago {
  serper: number;
  iaTokensEntrada: number;
  iaTokensSaida: number;
  emails: number;
  numerosWhatsapp: number;
  placesUsd: number;
  /** Minutos de participante nas reuniões por vídeo (soma de todas as pessoas na sala). */
  reuniaoMinutos?: number;
  /** Horas de reunião transcritas. */
  transcricaoHoras?: number;
  /** GB guardados (gravações e fotos). */
  armazenamentoGb?: number;
  /** Minutos de ligação cobrados pela operadora no mês (já na cadência dela), para celular e fixo. */
  ligacaoCelularMin?: number;
  ligacaoFixoMin?: number;
  /** Carrosséis com IA: o que o Claude cobrou no mês (US$, já calculado por chamada). */
  carrosseisUsd?: number;
  /** Vídeos com IA: transcrição, Claude e o servidor que edita (US$, já calculado por vídeo). */
  videosUsd?: number;
}

export interface CustoEstimado {
  buscas: number;
  ia: number;
  maps: number;
  email: number;
  whatsapp: number;
  /** Reuniões por vídeo: sala, transcrição e o que fica guardado. */
  reunioes: number;
  /** Ligações: o minuto da operadora (celular e fixo). */
  ligacoes: number;
  /** Carrosséis com IA: o Claude do time de IA. */
  carrosseis: number;
  /** Vídeos com IA: transcrição, Claude e o tempo do servidor que edita. */
  videos: number;
  /** Custos fixos do mês (planos dos serviços e servidores), divididos entre os clientes pagantes. */
  infra: number;
  total: number;
}

/** Custo estimado do mês de uma conta (reais, duas casas). */
export function custoEstimado(
  u: UsoPago,
  c: CustosPlataforma,
  infraPorConta: number,
  telefone: { celularMin: number; fixoMin: number } = { celularMin: 0, fixoMin: 0 },
): CustoEstimado {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const buscas = r2((u.serper / 1000) * c.serperMil);
  const ia = r2((u.iaTokensEntrada / 1e6) * c.iaEntradaMilhao + (u.iaTokensSaida / 1e6) * c.iaSaidaMilhao);
  const maps = r2(u.placesUsd * c.dolar);
  const email = r2((u.emails / 1000) * c.emailMil);
  const whatsapp = r2(u.numerosWhatsapp * c.whatsappNumeroMes);
  const reunioes = r2(
    ((u.reuniaoMinutos ?? 0) / 1000) * c.reuniaoMilMinutos +
      (u.transcricaoHoras ?? 0) * c.transcricaoHora +
      (u.armazenamentoGb ?? 0) * c.armazenamentoGbMes,
  );
  const ligacoes = r2(
    (u.ligacaoCelularMin ?? 0) * telefone.celularMin + (u.ligacaoFixoMin ?? 0) * telefone.fixoMin,
  );
  const carrosseis = r2((u.carrosseisUsd ?? 0) * c.dolar);
  const videos = r2((u.videosUsd ?? 0) * c.dolar);
  const infra = r2(infraPorConta);
  return {
    buscas,
    ia,
    maps,
    email,
    whatsapp,
    reunioes,
    ligacoes,
    carrosseis,
    videos,
    infra,
    total: r2(buscas + ia + maps + email + whatsapp + reunioes + ligacoes + carrosseis + videos + infra),
  };
}

/** Saúde do cliente: o que olhar primeiro. */
export type SinalSaude = 'parado' | 'pouco_uso' | 'no_limite' | 'novo' | 'ok';
