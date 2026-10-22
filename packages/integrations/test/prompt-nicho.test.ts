import { describe, expect, it } from 'vitest';
import { type EntradaAvaliacao, montarPrompt } from '../src/enriquecimento/servicos.js';

const base: EntradaAvaliacao = {
  nicho: 'Lojas de tintas',
  empresa: {
    nome: 'Tintas Exemplo',
    razaoSocial: null,
    cidade: 'Recife',
    uf: 'PE',
    porte: null,
    abertaHaAnos: 8,
    categoriaMaps: 'Loja de tintas',
    notaMaps: 4.6,
    avaliacoesMaps: 120,
    sinalEntregaMaps: null,
    temSite: false,
    temInstagram: true,
    seguidoresInstagram: 900,
  },
  socios: [],
  cargosAlvo: [],
  textoSite: null,
  bioInstagram: null,
};

describe('prompt da nota do lead', () => {
  it('leva os sinais do nicho', () => {
    const p = montarPrompt({ ...base, sinais: ['tintas imobiliárias', 'automotiva'] });
    expect(p).toContain('Sinais de bom lead neste nicho');
    expect(p).toContain('tintas imobiliárias, automotiva');
  });
  it('sem funções escolhidas, qualquer pessoa da equipe serve', () => {
    const p = montarPrompt(base);
    expect(p).toContain('Qualquer pessoa da equipe serve');
    expect(p).not.toContain('Sinais de bom lead neste nicho');
    expect(montarPrompt({ ...base, cargosAlvo: ['comprador'] })).toContain(
      'Pessoas que mais interessam: comprador',
    );
  });
});
