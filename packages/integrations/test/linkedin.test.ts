import { describe, expect, it } from 'vitest';
import type { ResultadoGoogle } from '../src/enriquecimento/apify.js';
import { interpretarLinkedin } from '../src/enriquecimento/apify.js';
import {
  mesmoNome,
  palavrasDaEmpresa,
  perfilDoSocio,
  pessoasDaEmpresa,
  trabalhaNaEmpresa,
} from '../src/enriquecimento/linkedin.js';

const r = (titulo: string, url: string, descricao = ''): ResultadoGoogle => ({ titulo, url, descricao });

/** Caso real: sócio da Adual Baterias e um homônimo operador de produção em outra empresa. */
const HOMONIMO = r(
  'Antonio Carlos dos Santos Caldas - OPERADOR DE PRODUÇÃO, MANTENEDOR E BRIGADISTA | LinkedIn',
  'https://br.linkedin.com/in/antonio-carlos-caldas',
  'Salvador, Bahia, Brasil · Experiência: Tronox · Formação: Colégio Luiz Vianna',
);

describe('LinkedIn sem homônimos', () => {
  const adual = palavrasDaEmpresa('Adual Baterias', 'ADUAL BATERIAS 24 HORAS LTDA');

  it('palavras próprias da empresa, sem as do ramo', () => {
    expect(adual).toEqual(['adual']);
    expect(palavrasDaEmpresa('Js Pecas', null)).toEqual([]);
    expect(palavrasDaEmpresa('Auto Peças Ladeira', 'LADEIRA COMERCIO DE PECAS LTDA')).toEqual(['ladeira']);
  });

  it('nome: o perfil pode abreviar, mas não pode ter sobrenome que o sócio não tem', () => {
    expect(mesmoNome('ANTONIO CARLOS DOS SANTOS', 'Antonio Carlos dos Santos Caldas')).toBe(false);
    expect(mesmoNome('ANTONIO CARLOS DOS SANTOS', 'Antonio Santos')).toBe(true);
    expect(mesmoNome('ANTONIO CARLOS DOS SANTOS', 'Antônio Carlos dos Santos')).toBe(true);
    expect(mesmoNome('ANTONIO CARLOS DOS SANTOS', 'Carlos Santos')).toBe(false);
    expect(mesmoNome('ANTONIO CARLOS DOS SANTOS', 'Antonio')).toBe(false);
  });

  it('homônimo de outra empresa nunca vira o sócio', () => {
    expect(perfilDoSocio('ANTONIO CARLOS DOS SANTOS', [HOMONIMO], adual)).toBeNull();
    // Mesmo com o nome idêntico: sem citar a empresa, não liga.
    const mesmoNomeOutraEmpresa = r(
      'Antonio Carlos dos Santos - Motorista - Transportes Rápidos | LinkedIn',
      'https://br.linkedin.com/in/acs-motorista',
    );
    expect(perfilDoSocio('ANTONIO CARLOS DOS SANTOS', [mesmoNomeOutraEmpresa], adual)).toBeNull();
  });

  it('liga o sócio quando o perfil cita a empresa no emprego atual', () => {
    const certo = r(
      'Antonio Santos - Sócio-diretor - Adual Baterias 24h | LinkedIn',
      'https://br.linkedin.com/in/antonio-adual',
    );
    expect(perfilDoSocio('ANTONIO CARLOS DOS SANTOS', [HOMONIMO, certo], adual)?.url).toBe(
      'https://br.linkedin.com/in/antonio-adual',
    );
    const pelaExperiencia = r(
      'Antonio Carlos dos Santos | LinkedIn',
      'https://br.linkedin.com/in/acs',
      'Salvador · Experiência: Adual Baterias · Localidade: Salvador',
    );
    expect(perfilDoSocio('ANTONIO CARLOS DOS SANTOS', [pelaExperiencia], adual)).not.toBeNull();
  });

  it('busca por cargo: só quem trabalha hoje na empresa (não quem só aparece no texto)', () => {
    const pessoas = pessoasDaEmpresa(
      [
        r('Maria Souza - Compradora - Adual Baterias | LinkedIn', 'https://br.linkedin.com/in/maria'),
        r('Pedro Alves - Comprador - Moura Baterias | LinkedIn', 'https://br.linkedin.com/in/pedro'),
        r(
          'Rita Lima - Gerente - Bosch | LinkedIn',
          'https://br.linkedin.com/in/rita',
          'Experiência: Bosch · Já trabalhou com a Adual Baterias como fornecedora',
        ),
      ],
      adual,
    );
    expect(pessoas.map((p) => p.nome)).toEqual(['Maria Souza']);
  });

  it('nome curto só vale como palavra inteira; sem palavra própria, não confirma ninguém', () => {
    const p = interpretarLinkedin(
      r('Ana Paz - Gerente - Lojão Sol | LinkedIn', 'https://linkedin.com/in/ana'),
    )!;
    expect(trabalhaNaEmpresa(p, r('', ''), ['sol'])).toBe(true);
    expect(trabalhaNaEmpresa(p, r('', ''), [])).toBe(false);
    const solar = interpretarLinkedin(
      r('Ana Paz - Gerente - Solaris | LinkedIn', 'https://linkedin.com/in/ana2'),
    )!;
    expect(trabalhaNaEmpresa(solar, r('', ''), ['sol'])).toBe(false);
  });
});

describe('MEI', () => {
  it('reconhece o MEI pela razão social com CPF e natureza 213-5', async () => {
    const { pareceMei, lerSimples } = await import('../src/receita/layout.js');
    expect(pareceMei('2135', 'JOAO DA SILVA 12345678901')).toBe(true);
    expect(pareceMei('2135', 'JOAO DA SILVA')).toBe(false);
    expect(pareceMei('2062', 'PECAS LTDA 12345678901')).toBe(false);
    expect(lerSimples(['123', 'S', '', '', 'S', '', ''])).toEqual({
      cnpjBasico: '00000123',
      simples: true,
      mei: true,
    });
  });
});
