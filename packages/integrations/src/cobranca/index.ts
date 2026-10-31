import { AppError } from '@prospeccao/shared';

/**
 * Cobranças avulsas pelo Asaas (cada mês, mudança de plano ou pacote de minutos é uma cobrança; o
 * cliente escolhe Pix, boleto ou cartão na hora de pagar, sem recorrência) e o captcha do cadastro
 * do teste (Cloudflare Turnstile). Sem as chaves, a tela explica que falta configurar.
 */

export interface ConfigAsaas {
  /** Chave da API ($aact_…). */
  chave: string;
  /** Sandbox (api-sandbox.asaas.com) para testar sem dinheiro de verdade. */
  sandbox: boolean;
}

export type SituacaoCobranca = 'pendente' | 'paga' | 'atrasada' | 'cancelada' | 'estornada';

export interface CobrancaAsaas {
  id: string;
  valor: number;
  vencimento: string;
  situacao: SituacaoCobranca;
  forma: string | null;
  link: string | null;
  pagoEm: string | null;
  descricao: string | null;
  referencia: string | null;
}

export interface ServicoCobranca {
  readonly sandbox: boolean;
  criarCliente(c: {
    nome: string;
    documento: string;
    email: string;
    telefone: string | null;
    referencia: string;
  }): Promise<string>;
  atualizarCliente(id: string, c: { nome: string; documento: string; email: string }): Promise<void>;
  /** Cobrança avulsa: o cliente escolhe Pix, boleto ou cartão na página do Asaas (ou paga o Pix na tela). */
  criarCobranca(c: {
    cliente: string;
    valor: number;
    vencimento: string;
    descricao: string;
    referencia: string;
  }): Promise<CobrancaAsaas>;
  /** Apaga uma cobrança que não foi paga. */
  cancelarCobranca(id: string): Promise<void>;
  cobranca(id: string): Promise<CobrancaAsaas>;
  /** QR Code (imagem em base64) e o "copia e cola" do Pix da cobrança. */
  pix(cobrancaId: string): Promise<{ imagem: string; copiaECola: string; expiraEm: string | null }>;
  testar(): Promise<string>;
}

/** Situação da cobrança no Asaas → a nossa. */
export function situacaoDoAsaas(status: string): SituacaoCobranca {
  if (['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED'].includes(status)) return 'paga';
  if (status === 'OVERDUE' || status === 'DUNNING_REQUESTED') return 'atrasada';
  if (/REFUND|CHARGEBACK/.test(status)) return 'estornada';
  if (status === 'DELETED') return 'cancelada';
  return 'pendente';
}

interface PagamentoAsaas {
  id: string;
  value: number;
  dueDate: string;
  status: string;
  billingType?: string | null;
  invoiceUrl?: string | null;
  paymentDate?: string | null;
  clientPaymentDate?: string | null;
  confirmedDate?: string | null;
  description?: string | null;
  externalReference?: string | null;
  deleted?: boolean;
}

export function cobrancaDoAsaas(p: PagamentoAsaas): CobrancaAsaas {
  return {
    id: p.id,
    valor: Number(p.value),
    vencimento: p.dueDate,
    situacao: p.deleted ? 'cancelada' : situacaoDoAsaas(p.status),
    forma: p.billingType ?? null,
    link: p.invoiceUrl ?? null,
    pagoEm: p.paymentDate ?? p.clientPaymentDate ?? p.confirmedDate ?? null,
    descricao: p.description ?? null,
    referencia: p.externalReference ?? null,
  };
}

export function criarServicoCobranca(c: ConfigAsaas): ServicoCobranca {
  const base = c.sandbox ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3';
  const pedir = async <T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> => {
    let r: Response;
    try {
      r = await fetch(`${base}${caminho}`, {
        method: metodo,
        headers: {
          access_token: c.chave,
          'Content-Type': 'application/json',
          'User-Agent': 'ProspectTeam',
        },
        body: corpo ? JSON.stringify(corpo) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw AppError.externo('Asaas', 'O Asaas não respondeu agora. Tente de novo em alguns minutos.', e);
    }
    const texto = await r.text();
    const json = texto ? (JSON.parse(texto) as unknown) : {};
    if (!r.ok) {
      const erros = (json as { errors?: { description?: string }[] }).errors;
      const msg =
        erros
          ?.map((x) => x.description)
          .filter(Boolean)
          .join(' ') || `HTTP ${r.status}`;
      throw new AppError(r.status >= 500 ? 502 : 422, 'cobranca', `Asaas: ${msg}`, {
        repetivel: r.status >= 500 || r.status === 429,
      });
    }
    return json as T;
  };
  return {
    sandbox: c.sandbox,
    async criarCliente(x) {
      const r = await pedir<{ id: string }>('POST', '/customers', {
        name: x.nome,
        cpfCnpj: x.documento,
        email: x.email,
        mobilePhone: x.telefone ?? undefined,
        externalReference: x.referencia,
        notificationDisabled: false,
      });
      return r.id;
    },
    async atualizarCliente(id, x) {
      await pedir('PUT', `/customers/${encodeURIComponent(id)}`, {
        name: x.nome,
        cpfCnpj: x.documento,
        email: x.email,
      });
    },
    async criarCobranca(x) {
      return cobrancaDoAsaas(
        await pedir<PagamentoAsaas>('POST', '/payments', {
          customer: x.cliente,
          billingType: 'UNDEFINED',
          value: x.valor,
          dueDate: x.vencimento,
          description: x.descricao.slice(0, 500),
          externalReference: x.referencia,
        }),
      );
    },
    async cancelarCobranca(id) {
      await pedir('DELETE', `/payments/${encodeURIComponent(id)}`);
    },
    async cobranca(id) {
      return cobrancaDoAsaas(await pedir<PagamentoAsaas>('GET', `/payments/${encodeURIComponent(id)}`));
    },
    async pix(cobrancaId) {
      const r = await pedir<{ encodedImage: string; payload: string; expirationDate?: string | null }>(
        'GET',
        `/payments/${encodeURIComponent(cobrancaId)}/pixQrCode`,
      );
      return { imagem: r.encodedImage, copiaECola: r.payload, expiraEm: r.expirationDate ?? null };
    },
    async testar() {
      await pedir('GET', '/customers?limit=1');
      return `ok (${c.sandbox ? 'sandbox' : 'produção'})`;
    },
  };
}

/* ───────────────────────────── Captcha ───────────────────────────── */

/** Confere o token do Cloudflare Turnstile (o widget do formulário). */
export async function conferirCaptcha(segredo: string, token: string, ip?: string): Promise<boolean> {
  try {
    const corpo = new URLSearchParams({ secret: segredo, response: token });
    if (ip) corpo.set('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: corpo,
      signal: AbortSignal.timeout(10_000),
    });
    const j = (await r.json()) as { success?: boolean };
    return !!j.success;
  } catch {
    return false;
  }
}
