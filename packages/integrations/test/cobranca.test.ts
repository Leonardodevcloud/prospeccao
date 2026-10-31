import { afterEach, describe, expect, it, vi } from 'vitest';
import { cobrancaDoAsaas, criarServicoCobranca, situacaoDoAsaas } from '../src/cobranca/index.js';

describe('cobrança avulsa no Asaas', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('cria a cobrança sem forma fixa (Pix, boleto ou cartão na hora) e lê a resposta', async () => {
    const pedidos: { url: string; metodo: string; corpo: unknown; token: string | null }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        pedidos.push({
          url,
          metodo: init.method ?? 'GET',
          corpo: init.body ? JSON.parse(String(init.body)) : null,
          token: (init.headers as Record<string, string>).access_token ?? null,
        });
        return new Response(
          JSON.stringify({
            id: 'pay_1',
            value: 149,
            dueDate: '2026-11-02',
            status: 'PENDING',
            billingType: 'UNDEFINED',
            invoiceUrl: 'https://sandbox.asaas.com/i/1',
            description: 'x',
            externalReference: 'org:7',
          }),
          { status: 200 },
        );
      }),
    );
    const s = criarServicoCobranca({ chave: '$aact_teste', sandbox: true });
    const c = await s.criarCobranca({
      cliente: 'cus_1',
      valor: 149,
      vencimento: '2026-11-02',
      descricao: '+500 minutos',
      referencia: 'org:7',
    });
    expect(pedidos[0]).toMatchObject({
      url: 'https://api-sandbox.asaas.com/v3/payments',
      metodo: 'POST',
      token: '$aact_teste',
      corpo: {
        customer: 'cus_1',
        billingType: 'UNDEFINED',
        value: 149,
        dueDate: '2026-11-02',
        externalReference: 'org:7',
      },
    });
    expect(c).toMatchObject({ id: 'pay_1', situacao: 'pendente', link: 'https://sandbox.asaas.com/i/1' });
    await s.cancelarCobranca('pay_1');
    expect(pedidos[1]).toMatchObject({
      url: 'https://api-sandbox.asaas.com/v3/payments/pay_1',
      metodo: 'DELETE',
    });
  });

  it('traduz a situação do Asaas', () => {
    expect(situacaoDoAsaas('RECEIVED')).toBe('paga');
    expect(situacaoDoAsaas('CONFIRMED')).toBe('paga');
    expect(situacaoDoAsaas('OVERDUE')).toBe('atrasada');
    expect(situacaoDoAsaas('REFUNDED')).toBe('estornada');
    expect(situacaoDoAsaas('PENDING')).toBe('pendente');
    expect(
      cobrancaDoAsaas({ id: 'p', value: 10, dueDate: '2026-11-02', status: 'PENDING', deleted: true })
        .situacao,
    ).toBe('cancelada');
  });
});
