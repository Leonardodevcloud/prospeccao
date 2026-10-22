import { describe, expect, it } from 'vitest';
import { consultaPrincipal, nomeDeBusca, semFilial } from '../src/enriquecimento/nome.js';

describe('nome de busca, como uma pessoa digitaria', () => {
  it('tira a filial do nome do Maps', () => {
    expect(semFilial('GEFPEL Autopeças - Salvador LJ 04')).toBe('GEFPEL Autopeças');
    expect(semFilial('Farmácia Boa Saúde Loja 3')).toBe('Farmácia Boa Saúde');
    expect(semFilial('Pet Feliz (Filial Pituba)')).toBe('Pet Feliz');
    expect(semFilial('Alcoolmaq')).toBe('Alcoolmaq');
  });

  it('a marca entre aspas e o ramo solto', () => {
    expect(
      nomeDeBusca('GEFPEL Autopeças - Salvador LJ 04', 'GEFPEL BA DISTRIBUIDORA DE AUTO PECAS LTDA'),
    ).toEqual({
      nucleo: 'GEFPEL',
      contexto: 'autopeças',
    });
    expect(
      consultaPrincipal(
        'GEFPEL Autopeças - Salvador LJ 04',
        'GEFPEL BA DISTRIBUIDORA DE AUTO PECAS LTDA',
        'SALVADOR',
      ),
    ).toBe('"GEFPEL" autopeças salvador');
    expect(nomeDeBusca('Alcoolmaq', 'ALCOOLMAQ ROLAMENTOS E PECAS LTDA').nucleo).toBe('Alcoolmaq');
    // Sem palavra própria: o nome inteiro.
    expect(nomeDeBusca('Auto Peças', null).nucleo).toBe('Auto Peças');
  });
});
