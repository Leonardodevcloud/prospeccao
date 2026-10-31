import { describe, expect, it } from 'vitest';
import {
  assinarEntrada,
  cadastroTesteEntrada,
  contratoDoPedido,
  cpfValido,
  documentoDoTexto,
  emailDescartavel,
} from './assinatura.js';
import { planoEfetivo } from './planos.js';

describe('teste grátis e assinatura', () => {
  it('confere CPF e CNPJ', () => {
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido('529.982.247-24')).toBe(false);
    expect(cpfValido('111.111.111-11')).toBe(false);
    expect(documentoDoTexto('11.222.333/0001-81')).toBe('11222333000181');
    expect(documentoDoTexto('52998224725')).toBe('52998224725');
    expect(documentoDoTexto('123')).toBeNull();
  });

  it('recusa e-mail temporário', () => {
    expect(emailDescartavel('a@mailinator.com')).toBe(true);
    expect(emailDescartavel('a@tempmailbox.xyz')).toBe(true);
    expect(emailDescartavel('diego@nexosistemas.com.br')).toBe(false);
    const r = cadastroTesteEntrada.safeParse({
      nome: 'Diego',
      empresa: 'Nexo',
      email: 'x@yopmail.com',
      whatsapp: '71 99876-5432',
      senha: 'senha-bem-forte',
      aceite: true,
    });
    expect(r.success).toBe(false);
  });

  it('o Agente de IA pede o WhatsApp e o preço sai da tabela', () => {
    const base = {
      plano: 'time',
      usuarios: 5,
      forma: 'PIX',
      documento: '52998224725',
      nome: 'Nexo',
      email: 'f@nexo.com.br',
    };
    expect(assinarEntrada.safeParse({ ...base, modulos: ['agente_ia'] }).success).toBe(false);
    const ok = assinarEntrada.parse({ ...base, modulos: ['whatsapp', 'agente_ia'] });
    expect(planoEfetivo(contratoDoPedido(ok)).mensalidade).toBe(2358);
    // Números extras só contam com o WhatsApp.
    expect(
      contratoDoPedido({ plano: 'start', usuarios: 1, modulos: [], numerosExtras: 3 }).numerosExtras,
    ).toBe(0);
  });
});
