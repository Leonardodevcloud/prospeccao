import { describe, expect, it } from 'vitest';
import { CUSTOS_PADRAO, custoEstimado, custosCompletos } from '../src/plataforma.js';

describe('custos da plataforma', () => {
  it('soma o que a plataforma paga e rateia a infraestrutura', () => {
    const c = {
      ...CUSTOS_PADRAO,
      serperMil: 5,
      iaEntradaMilhao: 2,
      iaSaidaMilhao: 8,
      dolar: 5,
      whatsappNumeroMes: 100,
    };
    const r = custoEstimado(
      {
        serper: 2000,
        apifyInstagram: 0,
        apifyGoogle: 0,
        iaTokensEntrada: 1_000_000,
        iaTokensSaida: 500_000,
        emails: 0,
        numerosWhatsapp: 1,
        placesUsd: 2,
      },
      c,
      50,
    );
    expect(r).toEqual({ buscas: 10, ia: 6, maps: 10, email: 0, whatsapp: 100, infra: 50, total: 176 });
  });
  it('campo faltando ou inválido volta para o padrão', () => {
    expect(custosCompletos({ serperMil: 9 })).toEqual({ ...CUSTOS_PADRAO, serperMil: 9 });
    expect(custosCompletos({ serperMil: -1 })).toEqual(CUSTOS_PADRAO);
    expect(custosCompletos(null)).toEqual(CUSTOS_PADRAO);
  });
});
