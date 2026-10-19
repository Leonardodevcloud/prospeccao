import { describe, expect, it } from 'vitest';
import { campanhaEntrada, nichoEntrada } from '../src/dominio.js';
import { baseMaisProxima, haversineKm } from '../src/geo.js';
import {
  cnpjCompleto,
  cnpjValido,
  dataReceita,
  decimalReceita,
  formatarCnae,
  formatarCnpj,
  formatarTelefone,
  normalizarCidade,
  normalizarCnae,
  normalizarNome,
  normalizarTelefone,
  telefoneReceita,
} from '../src/normalizar.js';

describe('telefones', () => {
  it('normaliza formatos comuns para DDD + número', () => {
    expect(normalizarTelefone('(71) 99812-4410')).toBe('71998124410');
    expect(normalizarTelefone('+55 71 99812-4410')).toBe('71998124410');
    expect(normalizarTelefone('071 3241-0098')).toBe('7132410098');
    expect(normalizarTelefone('5571998124410')).toBe('71998124410');
  });

  it('rejeita números que não são confiáveis', () => {
    expect(normalizarTelefone('99812-4410')).toBeNull();
    expect(normalizarTelefone('(71) 3241-00981')).toBeNull(); // 11 dígitos sem o 9
    expect(normalizarTelefone('')).toBeNull();
    expect(normalizarTelefone(null)).toBeNull();
  });

  it('junta DDD e número da Receita', () => {
    expect(telefoneReceita('71', '32410098')).toBe('7132410098');
    expect(telefoneReceita('071', '998124410')).toBe('71998124410');
    expect(telefoneReceita('', '32410098')).toBeNull();
  });

  it('formata para exibição', () => {
    expect(formatarTelefone('71998124410')).toBe('(71) 99812-4410');
    expect(formatarTelefone('7132410098')).toBe('(71) 3241-0098');
  });
});

describe('CNPJ e CNAE', () => {
  it('monta, formata e valida CNPJ', () => {
    const cnpj = cnpjCompleto('11222333', '1', '81');
    expect(cnpj).toBe('11222333000181');
    expect(formatarCnpj(cnpj)).toBe('11.222.333/0001-81');
    expect(cnpjValido(cnpj)).toBe(true);
    expect(cnpjValido('11222333000182')).toBe(false);
    expect(cnpjValido('11111111111111')).toBe(false);
  });

  it('normaliza e formata CNAE', () => {
    expect(normalizarCnae('4530-7/03')).toBe('4530703');
    expect(normalizarCnae('4530703')).toBe('4530703');
    expect(normalizarCnae('4530-7')).toBeNull();
    expect(formatarCnae('4530703')).toBe('4530-7/03');
  });
});

describe('nomes, cidades, datas e valores', () => {
  it('normaliza nomes para comparação', () => {
    expect(normalizarNome('AUTO PEÇAS LADEIRA NOVA LTDA - ME')).toBe('auto pecas ladeira nova');
    expect(normalizarNome('Pet & Cia Maré EIRELI')).toBe('pet e mare');
  });

  it('normaliza cidade como a Receita grava', () => {
    expect(normalizarCidade('Lauro de Freitas')).toBe('LAURO DE FREITAS');
    expect(normalizarCidade('Simões Filho')).toBe('SIMOES FILHO');
  });

  it('lê datas e decimais da Receita', () => {
    expect(dataReceita('20140312')).toBe('2014-03-12');
    expect(dataReceita('00000000')).toBeNull();
    expect(decimalReceita('1.500,75')).toBe(1500.75);
    expect(decimalReceita('')).toBeNull();
  });
});

describe('geo', () => {
  it('calcula distância e base mais próxima', () => {
    const pelourinho = { lat: -12.9714, lng: -38.5108 };
    const barra = { lat: -13.0103, lng: -38.5326 };
    const km = haversineKm(pelourinho, barra);
    expect(km).toBeGreaterThan(4.5);
    expect(km).toBeLessThan(5.2);
    const r = baseMaisProxima(barra, [
      { ...pelourinho, id: 1 },
      { lat: -12.9, lng: -38.3, id: 2 },
    ]);
    expect(r?.base.id).toBe(1);
  });
});

describe('contratos de entrada', () => {
  it('nicho normaliza CNAEs e remove duplicados', () => {
    const n = nichoEntrada.parse({
      nome: 'Pet shop',
      cnaes: ['4789-0/04', '4789004'],
      termosMaps: ['pet shop'],
    });
    expect(n.cnaes).toEqual(['4789004']);
    expect(n.portes.length).toBe(4);
  });

  it('nicho rejeita CNAE inválido com mensagem clara', () => {
    const r = nichoEntrada.safeParse({ nome: 'X', cnaes: ['123'], termosMaps: ['a'] });
    expect(r.success).toBe(false);
  });

  it('campanha aplica padrões', () => {
    const c = campanhaEntrada.parse({
      nome: 'Teste',
      nichoId: '3',
      cidades: [{ cidade: 'Salvador', uf: 'ba' }],
    });
    expect(c.nichoId).toBe(3);
    expect(c.cidades[0]?.uf).toBe('BA');
    expect(c.raioKm).toBe(12);
    expect(c.modo).toBe('semi');
  });
});
