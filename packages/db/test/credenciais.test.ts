import { describe, expect, it } from 'vitest';
import { cifrar, decifrar, dicaDoSegredo, resolverCredenciais } from '../src/credenciais.js';

const conta = (over: Partial<Parameters<typeof resolverCredenciais>[0] & object> = {}) => ({
  contaId: 2,
  principal: false,
  usaIaPlataforma: true,
  emailRemetente: null,
  resendDominioRespostas: null,
  evolutionUrl: null,
  evolutionInstancia: null,
  iaProvedor: null,
  iaModelo: null,
  iaBaseUrl: null,
  segredos: {},
  dicas: {},
  atualizadoEm: null,
  erro: null,
  ...over,
});

const ambiente = {
  placesKey: 'AIza-plataforma',
  resendKey: 're_plataforma',
  emailRemetente: 'comercial@tutts.com.br',
  iaProvedor: 'deepseek',
  iaKey: 'sk-plataforma',
  evolutionUrl: 'https://evo.tutts.com.br',
  evolutionKey: 'k',
  evolutionInstancia: 'tutts',
};

describe('credenciais das contas', () => {
  it('cifra e decifra; outra chave não abre e o texto não aparece cifrado', () => {
    const c = cifrar('chave-um-com-mais-de-32-caracteres!!', '{"placesKey":"AIza-segredo"}');
    expect(c).toMatch(/^v1:/);
    expect(c).not.toContain('AIza');
    expect(decifrar('chave-um-com-mais-de-32-caracteres!!', c)).toBe('{"placesKey":"AIza-segredo"}');
    expect(() => decifrar('outra-chave-com-mais-de-32-caracteres', c)).toThrow();
    // Duas cifras do mesmo texto são diferentes (IV aleatório).
    expect(cifrar('k'.repeat(32), 'x')).not.toBe(cifrar('k'.repeat(32), 'x'));
  });

  it('mostra só o final do segredo', () => {
    expect(dicaDoSegredo('re_123456789abcd')).toBe('…abcd');
    expect(dicaDoSegredo('curta')).toBe('…');
  });

  it('conta parceira: usa só o que cadastrou; a IA cai na da plataforma', () => {
    const r = resolverCredenciais(conta({ segredos: { placesKey: 'AIza-parceira' } }), ambiente, 2);
    expect(r.places).toEqual({ apiKey: 'AIza-parceira' });
    expect(r.resend).toBeNull();
    expect(r.evolution).toBeNull();
    expect(r.ia).toMatchObject({ apiKey: 'sk-plataforma', provedor: 'deepseek' });
    expect(r.origem).toEqual({ places: 'conta', ors: null, resend: null, evolution: null, ia: 'plataforma' });
  });

  it('conta parceira sem chave do Google usa a da plataforma (busca é serviço da plataforma)', () => {
    const r = resolverCredenciais(conta(), { ...ambiente, orsKey: 'ors-plataforma' }, 2);
    expect(r.places).toEqual({ apiKey: 'AIza-plataforma' });
    expect(r.ors).toEqual({ apiKey: 'ors-plataforma' });
    expect(r.origem).toMatchObject({
      places: 'plataforma',
      ors: 'plataforma',
      resend: null,
      evolution: null,
    });
  });

  it('conta principal: o ambiente completa o que ela não cadastrou, grupo a grupo', () => {
    const r = resolverCredenciais(
      // Só a chave do Resend sem remetente não forma o grupo: vale o Resend inteiro do ambiente.
      conta({ principal: true, segredos: { resendKey: 're_so_chave' } }),
      ambiente,
      1,
    );
    expect(r.resend).toMatchObject({ apiKey: 're_plataforma', remetente: 'comercial@tutts.com.br' });
    expect(r.evolution).toMatchObject({ instancia: 'tutts' });
    expect(r.origem).toMatchObject({ places: 'plataforma', resend: 'plataforma', evolution: 'plataforma' });
  });

  it('IA própria da conta, com o provedor e o modelo dela', () => {
    const r = resolverCredenciais(
      conta({ iaProvedor: 'gemini', iaModelo: 'gemini-x', segredos: { iaKey: 'g-key' } }),
      ambiente,
      2,
    );
    expect(r.ia).toEqual({ provedor: 'gemini', apiKey: 'g-key', modelo: 'gemini-x', baseUrl: null });
    expect(r.origem.ia).toBe('conta');
  });

  it('conta que não pode usar a IA da plataforma fica sem IA (a principal sempre pode)', () => {
    expect(resolverCredenciais(conta({ usaIaPlataforma: false }), ambiente, 2).ia).toBeNull();
    expect(resolverCredenciais(conta({ usaIaPlataforma: true }), ambiente, 2).origem.ia).toBe('plataforma');
    expect(
      resolverCredenciais(conta({ principal: true, usaIaPlataforma: false }), ambiente, 1).origem.ia,
    ).toBe('plataforma');
  });
});
