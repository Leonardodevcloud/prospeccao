import { describe, expect, it } from 'vitest';
import {
  acharCabecalho,
  campoPeloCabecalho,
  detectarCampos,
  lerLeads,
  linhaParaLead,
  separarCidadeUf,
  telefonesDoTexto,
} from '../src/importacao.js';

describe('importação de leads: reconhecer as colunas', () => {
  it('pelo cabeçalho, com e sem acento, em qualquer ordem', () => {
    expect(campoPeloCabecalho('Razão Social')).toBe('empresa');
    expect(campoPeloCabecalho('NOME FANTASIA')).toBe('empresa');
    expect(campoPeloCabecalho('Responsável')).toBe('contato');
    expect(campoPeloCabecalho('E-mail comercial')).toBe('email');
    expect(campoPeloCabecalho('WhatsApp')).toBe('whatsapp');
    expect(campoPeloCabecalho('Tel. fixo')).toBe('telefone');
    expect(campoPeloCabecalho('Município')).toBe('cidade');
    expect(campoPeloCabecalho('Estado')).toBe('uf');
    expect(campoPeloCabecalho('Cidade/UF')).toBe('cidade');
    expect(campoPeloCabecalho('CNPJ')).toBe('cnpj');
    expect(campoPeloCabecalho('Data do cadastro')).toBeNull();
  });

  it('acha o cabeçalho depois do título da planilha', () => {
    const linhas = [
      ['Relatório de clientes - Outubro', '', ''],
      ['', '', ''],
      ['Cliente', 'Telefone', 'Cidade'],
      ['Auto Peças Silva', '(71) 99999-1111', 'Salvador'],
    ];
    expect(acharCabecalho(linhas)).toBe(2);
    expect(acharCabecalho([['Auto Peças Silva', '71999991111', 'a@b.com']])).toBeNull();
  });

  it('sem cabeçalho, pelo conteúdo; e o conteúdo corrige cabeçalho genérico', () => {
    const dados = [
      ['Auto Peças Silva', 'João', '71 99999-1111', 'joao@silva.com.br', '12.345.678/0001-95'],
      ['Moto Center', 'Ana', '(75) 3222-1000', 'ana@motocenter.com', '11.222.333/0001-81'],
    ];
    expect(detectarCampos(null, dados)).toEqual(['empresa', 'contato', 'telefone', 'email', 'cnpj']);
    // "Contato" com telefones dentro vira telefone; a 2ª coluna "Empresa" repetida vira observação.
    expect(
      detectarCampos(
        ['Empresa', 'Contato', 'Empresa'],
        [
          ['Loja A', '71999991111', 'x'],
          ['Loja B', '71988881111', 'y'],
        ],
      ),
    ).toEqual(['empresa', 'telefone', 'observacao']);
  });
});

describe('importação de leads: linha → lead', () => {
  it('normaliza telefone, e-mail, CNPJ (inclusive o que o Excel tirou o zero), cidade/UF e nomes em caixa alta', () => {
    const l = linhaParaLead(
      [
        'AUTO PEÇAS DO JOÃO LTDA',
        'maria souza',
        '71 99999-1111 / 3333-2222',
        'Compras@Joao.com.br',
        '1234567000195',
        'Salvador - BA',
      ],
      ['empresa', 'contato', 'telefone', 'email', 'cnpj', 'cidade'],
    );
    expect(l).toMatchObject({
      empresa: 'Auto Peças do João LTDA',
      contato: 'maria souza',
      telefones: [
        { numero: '71999991111', whatsapp: false },
        { numero: '7133332222', whatsapp: false },
      ],
      emails: ['compras@joao.com.br'],
      cidade: 'Salvador',
      uf: 'BA',
      semEmpresa: false,
    });
    expect(l?.cnpj).toBe('01234567000195'); // o zero que o Excel tirou volta
    expect(linhaParaLead(['X', '11222333000182'], ['empresa', 'cnpj'])?.cnpj).toBeNull(); // dígito errado
    const ok = linhaParaLead(['X', '11222333000181'], ['empresa', 'cnpj']);
    expect(ok?.cnpj).toBe('11222333000181');
  });

  it('sem coluna de empresa usa o nome do contato; sem nome nenhum, a linha fica de fora', () => {
    expect(linhaParaLead(['Carlos Lima', '71988887777'], ['contato', 'whatsapp'])).toMatchObject({
      empresa: 'Carlos Lima',
      contato: null,
      semEmpresa: true,
      telefones: [{ numero: '71988887777', whatsapp: true }],
    });
    expect(linhaParaLead(['', '71988887777'], ['empresa', 'telefone'])).toBeNull();
  });

  it('junta a mesma empresa repetida e conta o que falta', () => {
    const r = lerLeads(
      [
        ['Loja A', '71999991111', ''],
        ['LOJA A', '', 'a@lojaa.com'],
        ['Loja B', '', ''],
        ['', '', ''],
      ],
      ['empresa', 'telefone', 'email'],
      { cidade: 'Feira de Santana', uf: 'BA' },
    );
    expect(r.leads).toHaveLength(2);
    expect(r.leads[0]).toMatchObject({
      telefones: [{ numero: '71999991111' }],
      emails: ['a@lojaa.com'],
      linhas: [1, 2],
    });
    expect(r).toMatchObject({ repetidas: 1, semContato: 1, semCidade: 0, semNome: [] });
  });

  it('separa cidade e UF e lê vários telefones da mesma célula', () => {
    expect(separarCidadeUf('Feira de Santana/BA')).toEqual({ cidade: 'Feira de Santana', uf: 'BA' });
    expect(separarCidadeUf('Recife (PE)')).toEqual({ cidade: 'Recife', uf: 'PE' });
    expect(linhaParaLead(['Loja', 'Franca/SP'], ['empresa', 'uf'])).toMatchObject({
      cidade: 'Franca',
      uf: 'SP',
    });
    expect(telefonesDoTexto('(71) 99999-1111 ou 98888-2222')).toEqual(['71999991111', '71988882222']);
  });
});
