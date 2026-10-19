import { describe, expect, it } from 'vitest';
import { detectarColunas, lerCsv, linhaParaItem, temCabecalho } from '../src/planilha.js';

// Formato típico do Instant Data Scraper no Google Maps: colunas com nomes de classe.
const CSV = `hfpxzc href,qBF1Pd,MW4etd,UY7F9,W4Efsd,W4Efsd 2,UsdlK,lcr4fd href
https://www.google.com/maps/place/Fort+Auto+Pe%C3%A7as/data=!4m7,Fort Auto Peças,"4,8",(219),Loja de autopeças,"Loja de autopeças · Av. Getúlio Vargas, 1200",(75) 3024-4242,https://forteautopecas.com.br/
https://www.google.com/maps/place/Ceav%C3%AA/data=!4m7,Ceavê Norte Diesel,"4,3",(28),Loja de autopeças,"Loja de autopeças · Av. Barros Reis, 312",(71) 3244-9744,
https://www.google.com/maps/place/Moto/data=!4m7,"Moto Peças ""Nova Era""",5,(1.204),Loja de peças para motos,"Loja de peças para motos · R. do Sossego, 10",(71) 99999-0000,`;

describe('planilha do Maps (Instant Data Scraper)', () => {
  it('lê o CSV com aspas e vírgula dentro do campo', () => {
    const l = lerCsv(CSV);
    expect(l).toHaveLength(4);
    expect(l[3]?.[1]).toBe('Moto Peças "Nova Era"');
    expect(temCabecalho(l)).toBe(true);
  });

  it('reconhece as colunas pelo conteúdo e monta os itens', () => {
    const linhas = lerCsv(CSV).slice(1);
    const m = detectarColunas(linhas);
    expect(m).toMatchObject({ url: 0, nome: 1, nota: 2, avaliacoes: 3, telefone: 6, site: 7, endereco: 5 });
    const itens = linhas.map((l) => linhaParaItem(l, m));
    expect(itens[0]).toEqual({
      nome: 'Fort Auto Peças',
      telefone: '(75) 3024-4242',
      endereco: 'Av. Getúlio Vargas, 1200',
      categoria: 'Loja de autopeças',
      nota: 4.8,
      avaliacoes: 219,
      url: 'https://www.google.com/maps/place/Fort+Auto+Pe%C3%A7as/data=!4m7',
      site: 'https://forteautopecas.com.br/',
    });
    expect(itens[2]).toMatchObject({ nota: 5, avaliacoes: 1204, site: null });
  });

  it('aceita ponto e vírgula e ignora linha sem nome', () => {
    const l = lerCsv('Nome;Telefone\nLoja A;(71) 3333-0000\n;(71) 3333-1111\n');
    const m = { ...detectarColunas(l.slice(1)), nome: 0, telefone: 1 };
    expect(l.slice(1).map((x) => linhaParaItem(x, m))).toEqual([
      expect.objectContaining({ nome: 'Loja A', telefone: '(71) 3333-0000' }),
      null,
    ]);
  });
});
