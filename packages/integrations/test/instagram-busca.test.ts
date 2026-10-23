import { describe, expect, it } from 'vitest';
import { instagramNosResultados } from '../src/enriquecimento/apify.js';
import { nomeDeBusca } from '../src/enriquecimento/nome.js';

const r = (titulo: string, url: string, descricao = '') => ({ titulo, url, descricao });

describe('Instagram pela busca no Google', () => {
  it('"Bar" é palavra do ramo: não entra no nome da busca', () => {
    expect(nomeDeBusca('Matheus & Rosaria Bar').nucleo).toBe('Matheus Rosaria');
  });

  it('sem aspas: aceita o perfil com as palavras do nome no @ (caso Matheus e Rosária)', () => {
    const res = [
      r(
        'Matheus e Rosária (@matheuserosaria)',
        'https://www.instagram.com/matheuserosaria/',
        'A casa da Cremosinha e do Chopp gelado! Terça à Domingo a partir das 11h.',
      ),
    ];
    expect(instagramNosResultados(res, 'Matheus & Rosaria Bar', { estrito: true })).toBe('matheuserosaria');
  });

  it('sem aspas: o telefone da loja no trecho basta', () => {
    const res = [
      r(
        'Casa do Chopp (@casadochoppfranca)',
        'https://www.instagram.com/casadochoppfranca/',
        'Pedidos (16) 99249-0094',
      ),
    ];
    expect(
      instagramNosResultados(res, 'Matheus & Rosaria Bar', { estrito: true, telefones: ['(16) 99249-0094'] }),
    ).toBe('casadochoppfranca');
  });

  it('sem aspas: perfil parecido com só uma palavra do nome fica de fora', () => {
    const res = [
      r('Matheus Barbearia (@matheusbarber)', 'https://www.instagram.com/matheusbarber/', 'Cortes'),
    ];
    expect(instagramNosResultados(res, 'Matheus & Rosaria Bar', { estrito: true })).toBeNull();
    // Na busca entre aspas (frase exata), uma palavra basta, como antes.
    expect(instagramNosResultados(res, 'Matheus & Rosaria Bar')).toBe('matheusbarber');
  });

  it('nome com uma palavra própria: precisa estar no @', () => {
    const res = [
      r('Lojão do Zé (@outraloja)', 'https://www.instagram.com/outraloja/', 'Gefpel autopeças? não'),
      r('Gefpel (@gefpel.pecas)', 'https://www.instagram.com/gefpel.pecas/'),
    ];
    expect(instagramNosResultados(res, 'Gefpel Auto Peças', { estrito: true })).toBe('gefpel.pecas');
  });
});
