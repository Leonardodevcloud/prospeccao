import { describe, expect, it } from 'vitest';
import { provarPessoa } from '../src/enriquecimento/pessoas.js';

/** Bloco de depoimentos como o da N.F Acessórios (avaliações do Google copiadas no site). */
const SITE_DEPOIMENTOS = `Tudo que você precisa Média de 5 estrelas com +250 reviews no Google
"Estabelecimento com preço muito bom, a única insatisfação e a demora no atendimento mesmo com muitos
funcionários demora muito, mais fora isso muito vale apena eu recomendo!" Emmanuel Junior Salvador
"Passei lá com outra pessoa, mas pude notar o excelente atendimento e a disponibilidade dos funcionários
em querer ajudar. Muito bom!" Petronio Torres Moreira Salvador
"Ótimo atendimento, produtos de qualidade e bons preços." Vanderlei Gomes Salvador`;

const SITE_EQUIPE = `Sobre nós. A Auto Peças São Caetano foi fundada em 1994 por José Almeida Santos.
Hoje a loja conta com Carla Nunes, gerente de compras, e uma equipe de 12 vendedores.
Fale com a gente pelo WhatsApp.`;

describe('provarPessoa: nome do site só vira pessoa com cargo comprovado', () => {
  it('recusa autores de depoimentos, mesmo que a IA invente um cargo', () => {
    for (const nome of ['Emmanuel Junior', 'Petronio Torres Moreira', 'Vanderlei Gomes']) {
      expect(provarPessoa({ nome, cargo: 'Gerente' }, [SITE_DEPOIMENTOS]).aceita).toBe(false);
    }
  });

  it('recusa nome sem cargo', () => {
    expect(provarPessoa({ nome: 'Emmanuel Junior', cargo: null }, [SITE_DEPOIMENTOS])).toMatchObject({
      aceita: false,
      motivo: 'sem cargo',
    });
    expect(provarPessoa({ nome: 'Vanderlei Gomes', cargo: 'Cliente' }, [SITE_DEPOIMENTOS]).aceita).toBe(
      false,
    );
  });

  it('recusa nome que não está no texto (a IA não pode inventar)', () => {
    expect(provarPessoa({ nome: 'Marcos Pereira', cargo: 'Gerente' }, [SITE_EQUIPE]).aceita).toBe(false);
  });

  it('aceita quem o site apresenta com cargo, guardando o trecho de prova', () => {
    const carla = provarPessoa(
      {
        nome: 'Carla Nunes',
        cargo: 'Gerente de compras',
        trecho: 'Hoje a loja conta com Carla Nunes, gerente de compras',
      },
      [SITE_EQUIPE],
    );
    expect(carla).toMatchObject({
      aceita: true,
      evidencia: 'Hoje a loja conta com Carla Nunes, gerente de compras',
    });
    expect(provarPessoa({ nome: 'José Almeida Santos', cargo: 'Fundador' }, [null, SITE_EQUIPE]).aceita).toBe(
      true,
    );
  });

  it('aceita pela bio do Instagram', () => {
    expect(
      provarPessoa({ nome: 'Rafael Costa', cargo: 'Proprietário' }, [
        null,
        'Peças para linha leve 🚗 | Proprietário: Rafael Costa | Entregamos em Salvador',
      ]).aceita,
    ).toBe(true);
  });
});
