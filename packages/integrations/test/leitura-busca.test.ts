import { describe, expect, it } from 'vitest';
import { conferirLeitura, promptLeituraBusca } from '../src/enriquecimento/leitura-busca.js';

const resultados = [
  {
    titulo: 'Norte Diesel SSA (@norte.diesel.ssa) • Instagram',
    url: 'https://www.instagram.com/norte.diesel.ssa/',
    descricao:
      'Peças diesel em Salvador. Atendimento com Marcos Lima, gerente de compras. WhatsApp (71) 98877-6655',
  },
  {
    titulo: 'CEAVE NORTE DIESEL LTDA - Econodata',
    url: 'https://www.econodata.com.br/empresa/ceave',
    descricao:
      'Telefone (71) 3244-9744 · e-mail vendas@ceavenortediesel.com.br · site ceavenortediesel.com.br',
  },
];

describe('IA lendo a busca do Google', () => {
  it('aceita o que está escrito nos resultados, mesmo com Instagram de nome diferente', () => {
    const l = conferirLeitura(
      {
        mesmaEmpresa: true,
        instagram: '@norte.diesel.ssa',
        site: 'ceavenortediesel.com.br',
        telefones: ['(71) 98877-6655', '71 3244 9744'],
        emails: ['vendas@ceavenortediesel.com.br'],
        pessoas: [
          { nome: 'Marcos Lima', cargo: 'gerente de compras', trecho: 'Marcos Lima, gerente de compras' },
        ],
      },
      resultados,
    );
    expect(l).toMatchObject({
      mesmaEmpresa: true,
      instagram: 'norte.diesel.ssa',
      site: expect.stringContaining('ceavenortediesel.com.br'),
      telefones: ['71988776655', '7132449744'],
      emails: ['vendas@ceavenortediesel.com.br'],
    });
    expect(l.pessoas.map((p) => p.nome)).toEqual(['Marcos Lima']);
  });

  it('joga fora o que a IA inventou ou que é do diretório', () => {
    const l = conferirLeitura(
      {
        mesmaEmpresa: true,
        instagram: 'ceave_oficial',
        site: 'econodata.com.br',
        telefones: ['(71) 99999-0000'],
        emails: ['dono@ceave.com.br'],
        pessoas: [{ nome: 'João Inventado', cargo: 'sócio', trecho: 'João Inventado, sócio' }],
      },
      resultados,
    );
    expect(l).toMatchObject({ instagram: null, site: null, telefones: [], emails: [], pessoas: [] });
  });

  it('o prompt leva a empresa e os resultados numerados', () => {
    const p = promptLeituraBusca({
      empresa: {
        nome: 'Ceave',
        razaoSocial: 'CEAVE NORTE DIESEL LTDA',
        cidade: 'SALVADOR',
        uf: 'BA',
        endereco: null,
      },
      resultados,
    });
    expect(p).toContain('[2] CEAVE NORTE DIESEL LTDA - Econodata');
    expect(p).toContain('Não complete nem deduza');
  });
});
