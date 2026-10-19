import { describe, expect, it } from 'vitest';
import type { ItemMaps } from '../src/apify/index.js';
import { resultadosSerper } from '../src/enriquecimento/serper.js';
import { mesmoLugar, textoParaAchar } from '../src/places/index.js';

const lugar = (p: Partial<ItemMaps>): ItemMaps => ({
  placeId: 'x',
  nome: 'Ceavê Norte Diesel',
  categoria: 'Loja de autopeças',
  telefone: '7132449744',
  endereco: 'Av. Barros Reis, 312 - Pau Miúdo, Salvador - BA, 40310-005, Brasil',
  cep: '40310005',
  cidade: 'Salvador',
  uf: 'BA',
  lat: null,
  lng: null,
  nota: 4.3,
  avaliacoes: 28,
  site: null,
  url: null,
  fechada: false,
  entrega: null,
  dados: {},
  ...p,
});

const ceave = {
  nome: 'CEAVE NORTE DIESEL LTDA',
  razaoSocial: 'CEAVE NORTE DIESEL LTDA',
  logradouro: 'AVENIDA BARROS REIS',
  numero: '312',
  bairro: 'PAU MIUDO',
  cep: '40310010',
  cidade: 'SALVADOR',
  uf: 'BA',
};

describe('achar a empresa no Google pelo nome e endereço', () => {
  it('acha mesmo com acento diferente e CEP vizinho (número na rua bate)', () => {
    expect(mesmoLugar(lugar({}), ceave)).toBe(true);
    expect(textoParaAchar(ceave)).toBe('CEAVE NORTE DIESEL LTDA, AVENIDA BARROS REIS 312, SALVADOR - BA');
  });

  it('não aceita outra loja da mesma rua nem homônima em outra cidade', () => {
    expect(mesmoLugar(lugar({ nome: 'Atacadão Salvador Barros Reis' }), ceave)).toBe(false);
    expect(
      mesmoLugar(
        lugar({ endereco: 'Rua X, 10 - Feira de Santana - BA', cep: '44000000', cidade: 'Feira de Santana' }),
        ceave,
      ),
    ).toBe(false);
  });

  it('nome genérico só passa com CEP e número batendo', () => {
    const generica = { ...ceave, nome: 'AUTO PECAS LTDA', razaoSocial: 'AUTO PECAS LTDA' };
    expect(mesmoLugar(lugar({ nome: 'Auto Peças' }), generica)).toBe(false);
    expect(mesmoLugar(lugar({ nome: 'Auto Peças', cep: '40310010' }), generica)).toBe(true);
  });
});

describe('Serper', () => {
  it('converte resultados orgânicos no formato da busca do Apify', () => {
    expect(
      resultadosSerper({
        organic: [
          {
            title: 'Maria - Compradora - Ceavê | LinkedIn',
            link: 'https://br.linkedin.com/in/maria',
            snippet: 'Experiência: Ceavê Norte Diesel',
          },
          { title: 'sem link' },
        ],
      }),
    ).toEqual([
      {
        titulo: 'Maria - Compradora - Ceavê | LinkedIn',
        url: 'https://br.linkedin.com/in/maria',
        descricao: 'Experiência: Ceavê Norte Diesel',
      },
    ]);
  });
});
