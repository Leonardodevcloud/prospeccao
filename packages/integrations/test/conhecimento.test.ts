import { describe, expect, it } from 'vitest';
import { dividirEmTrechos, termosDaBusca } from '../src/agente/conhecimento.js';

describe('base de conhecimento em trechos', () => {
  it('texto curto fica inteiro; longo vira trechos que se sobrepõem', () => {
    expect(dividirEmTrechos('Atendemos Salvador e Feira.')).toEqual(['Atendemos Salvador e Feira.']);
    const paragrafos = Array.from(
      { length: 12 },
      (_, i) => `Parágrafo ${i}: ${'palavra '.repeat(30)}fim ${i}.`,
    );
    const trechos = dividirEmTrechos(paragrafos.join('\n\n'));
    expect(trechos.length).toBeGreaterThan(3);
    for (const t of trechos) expect(t.length).toBeLessThanOrEqual(900 + 160);
    // Nada se perde: todo parágrafo aparece em algum trecho.
    for (let i = 0; i < 12; i++) expect(trechos.some((t) => t.includes(`fim ${i}.`))).toBe(true);
  });

  it('termos da busca: sem saudação, sem acento, sem repetir', () => {
    expect(
      termosDaBusca('Oi, bom dia! Vocês atendem Camaçari? Qual o preço do frete para Camaçari?'),
    ).toEqual([
      'atendem',
      'camacari',
      'qual',
      'preco',
      'frete',
      'para',
      // assunto: preço e região
      'valor',
      'plano',
      'custa',
      'atendemos',
      'cidades',
      'regiao',
      'entrega',
    ]);
  });
});
