import { Readable } from 'node:stream';
import iconv from 'iconv-lite';
import { describe, expect, it } from 'vitest';
import { ufDoEstado } from '../src/apify/estados.js';
import { converterItem, detectarEntrega } from '../src/apify/index.js';
import { lerCsvReceita } from '../src/receita/index.js';
import { lerEmpresa, lerEstabelecimento, lerSocio } from '../src/receita/layout.js';

const linhaEstab = [
  '11222333',
  '0001',
  '81',
  '1',
  'LADEIRA NOVA PEÇAS',
  '02',
  '20140312',
  '00',
  '',
  '',
  '20140301',
  '4530703',
  '4530701,4789004',
  'RUA',
  'DA LADEIRA NOVA',
  '120',
  'LOJA 2',
  'BONFIM',
  '40415000',
  'BA',
  '3849',
  '71',
  '32410098',
  '71',
  '998124410',
  '',
  '',
  'CONTATO@LADEIRA.COM.BR',
  '',
  '',
];

describe('layout da Receita', () => {
  it('lê estabelecimento', () => {
    const e = lerEstabelecimento(linhaEstab);
    expect(e).toMatchObject({
      cnpj: '11222333000181',
      matriz: true,
      situacao: '02',
      cnaePrincipal: '4530703',
      cnaesSecundarios: ['4530701', '4789004'],
      uf: 'BA',
      municipioCodigo: '3849',
      telefones: ['7132410098', '71998124410'],
      email: 'contato@ladeira.com.br',
      dataInicio: '2014-03-01',
    });
  });

  it('descarta estabelecimento sem dados essenciais', () => {
    expect(lerEstabelecimento(['11222333'])).toBeNull();
  });

  it('lê empresa e sócio', () => {
    expect(lerEmpresa(['11222333', 'LADEIRA NOVA LTDA', '2062', '49', '50000,00', '03', ''])).toEqual({
      cnpjBasico: '11222333',
      razaoSocial: 'LADEIRA NOVA LTDA',
      naturezaJuridica: '2062',
      capitalSocial: 50000,
      porte: 'epp',
    });
    expect(
      lerSocio(['11222333', '2', 'CARLOS MENEZES', '***123456**', '49', '20140301', '', '', '', '', '5']),
    ).toMatchObject({
      tipo: 'pf',
      nome: 'CARLOS MENEZES',
      qualificacaoCodigo: '49',
      dataEntrada: '2014-03-01',
    });
  });

  it('decodifica CSV latin1 com aspas e ponto e vírgula', async () => {
    const csv = iconv.encode('"1";"AÇOUGUE SÃO JOÃO";"x"\n"2";"PEÇAS ""TOP""";"y"\n', 'latin1');
    const linhas: string[][] = [];
    for await (const l of lerCsvReceita(Readable.from([csv]))) linhas.push(l);
    expect(linhas).toEqual([
      ['1', 'AÇOUGUE SÃO JOÃO', 'x'],
      ['2', 'PEÇAS "TOP"', 'y'],
    ]);
  });
});

describe('Apify Maps', () => {
  it('converte item e detecta entrega', () => {
    const item = converterItem({
      placeId: 'ChIJ123',
      title: 'Autopeças Ladeira Nova',
      phone: '(71) 3241-0098',
      postalCode: '40415-000',
      city: 'Salvador',
      state: 'State of Bahia',
      location: { lat: -12.93, lng: -38.5 },
      totalScore: 4.6,
      reviewsCount: 412,
      additionalInfo: { 'Opções de serviço': [{ Entrega: true }, { 'Retirada na loja': true }] },
    });
    expect(item).toMatchObject({
      telefone: '7132410098',
      cep: '40415000',
      uf: 'BA',
      entrega: true,
      fechada: false,
    });
  });

  it('entrega desmarcada é false; ausente é null', () => {
    expect(detectarEntrega({ Serviços: [{ Delivery: false }] })).toBe(false);
    expect(detectarEntrega({ Acessibilidade: [{ Rampa: true }] })).toBeNull();
    expect(detectarEntrega(null)).toBeNull();
  });

  it('ignora item sem placeId', () => {
    expect(converterItem({ title: 'Sem id' })).toBeNull();
  });

  it('converte estados para UF', () => {
    expect(ufDoEstado('Bahia')).toBe('BA');
    expect(ufDoEstado('Estado de São Paulo')).toBe('SP');
    expect(ufDoEstado('RN')).toBe('RN');
    expect(ufDoEstado('Narnia')).toBeNull();
  });
});
