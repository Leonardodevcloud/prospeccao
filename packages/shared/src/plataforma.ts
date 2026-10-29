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
  /** Apify: cada 1.000 perfis do Instagram lidos. */
  apifyInstagramMil: number;
  /** Apify: cada 1.000 buscas no Google (só quando não há Serper). */
  apifyGoogleMil: number;
  /** IA da plataforma: cada 1 milhão de tokens enviados e recebidos. */
  iaEntradaMilhao: number;
  iaSaidaMilhao: number;
  /** E-mail (Resend da plataforma): cada 1.000 enviados. */
  emailMil: number;
  /** WhatsApp (Z-API da plataforma): cada número conectado, por mês. */
  whatsappNumeroMes: number;
  /** Infraestrutura (servidores, banco) rateada igualmente entre os clientes ativos, por mês. */
  infraMes: number;
}

export const CUSTOS_PADRAO: CustosPlataforma = {
  dolar: 5.5,
  serperMil: 5.5,
  apifyInstagramMil: 12.65,
  apifyGoogleMil: 19.25,
  iaEntradaMilhao: 1.6,
  iaSaidaMilhao: 6.1,
  emailMil: 2.2,
  whatsappNumeroMes: 99.99,
  infraMes: 250,
};

const valor = z.number().min(0).max(1_000_000);
export const custosPlataformaEntrada = z.object({
  dolar: valor,
  serperMil: valor,
  apifyInstagramMil: valor,
  apifyGoogleMil: valor,
  iaEntradaMilhao: valor,
  iaSaidaMilhao: valor,
  emailMil: valor,
  whatsappNumeroMes: valor,
  infraMes: valor,
});

/** Junta o que veio do banco com os padrões (campo faltando = padrão). */
export function custosCompletos(c: unknown): CustosPlataforma {
  const r = custosPlataformaEntrada.partial().safeParse(c ?? {});
  return { ...CUSTOS_PADRAO, ...(r.success ? r.data : {}) };
}

/** O que uma conta consumiu no mês e que a plataforma paga (chaves da plataforma). */
export interface UsoPago {
  serper: number;
  apifyInstagram: number;
  apifyGoogle: number;
  iaTokensEntrada: number;
  iaTokensSaida: number;
  emails: number;
  numerosWhatsapp: number;
  placesUsd: number;
}

export interface CustoEstimado {
  buscas: number;
  ia: number;
  maps: number;
  email: number;
  whatsapp: number;
  infra: number;
  total: number;
}

/** Custo estimado do mês de uma conta (reais, duas casas). */
export function custoEstimado(u: UsoPago, c: CustosPlataforma, infraPorConta: number): CustoEstimado {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const buscas = r2(
    (u.serper / 1000) * c.serperMil +
      (u.apifyInstagram / 1000) * c.apifyInstagramMil +
      (u.apifyGoogle / 1000) * c.apifyGoogleMil,
  );
  const ia = r2((u.iaTokensEntrada / 1e6) * c.iaEntradaMilhao + (u.iaTokensSaida / 1e6) * c.iaSaidaMilhao);
  const maps = r2(u.placesUsd * c.dolar);
  const email = r2((u.emails / 1000) * c.emailMil);
  const whatsapp = r2(u.numerosWhatsapp * c.whatsappNumeroMes);
  const infra = r2(infraPorConta);
  return {
    buscas,
    ia,
    maps,
    email,
    whatsapp,
    infra,
    total: r2(buscas + ia + maps + email + whatsapp + infra),
  };
}

/** Saúde do cliente: o que olhar primeiro. */
export type SinalSaude = 'parado' | 'pouco_uso' | 'no_limite' | 'novo' | 'ok';
