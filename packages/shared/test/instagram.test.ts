import { describe, expect, it } from 'vitest';
import { campoSugerido, comentarioBate, comNome, leadDoCadastro } from '../src/instagram.js';

describe('instagram', () => {
  it('acha a palavra sem acento e sem maiúscula, mas não pedaço de palavra', () => {
    expect(comentarioBate('PROSPECCAO por favor', ['Prospecção'])).toBe('Prospecção');
    expect(comentarioBate('Prospecção 🙋‍♀️', ['PROSPECÇÃO'])).toBe('PROSPECÇÃO');
    expect(comentarioBate('quero!!', ['QUERO'])).toBe('QUERO');
    expect(comentarioBate('sou especialista', ['lista'])).toBeNull();
    expect(comentarioBate('quero a lista de leads', ['lista de leads'])).toBe('lista de leads');
  });

  it('troca {nome} pelo primeiro nome, ou tira quando não há nome', () => {
    expect(comNome('Oi, {nome}! Tudo bem?', 'Marina Souza')).toBe('Oi, Marina! Tudo bem?');
    expect(comNome('Oi, {nome}! Tudo bem?', null)).toBe('Oi! Tudo bem?');
    expect(comNome('Te mandei no direct, {nome} 📩', '')).toBe('Te mandei no direct 📩');
  });

  it('monta o lead pelas respostas do formulário', () => {
    const perguntas = [
      {
        chave: 'full_name',
        rotulo: 'Nome completo',
        tipo: 'FULL_NAME',
        campo: campoSugerido('FULL_NAME', 'full_name'),
      },
      {
        chave: 'phone_number',
        rotulo: 'Telefone',
        tipo: 'PHONE',
        campo: campoSugerido('PHONE', 'phone_number'),
      },
      {
        chave: 'company_name',
        rotulo: 'Empresa',
        tipo: 'COMPANY_NAME',
        campo: campoSugerido('COMPANY_NAME', 'x'),
      },
      {
        chave: 'quantos_vendedores',
        rotulo: 'Quantos vendedores?',
        tipo: 'CUSTOM',
        campo: campoSugerido('CUSTOM', 'q'),
      },
    ];
    const l = leadDoCadastro(
      [
        { chave: 'full_name', valores: ['Fernanda Rocha'] },
        { chave: 'phone_number', valores: ['+5571988124410'] },
        { chave: 'company_name', valores: ['Clínica Sorriso Pleno'] },
        { chave: 'quantos_vendedores', valores: ['3 a 5'] },
      ],
      perguntas,
    );
    expect(l).toMatchObject({
      contato: 'Fernanda Rocha',
      telefone: '+5571988124410',
      empresa: 'Clínica Sorriso Pleno',
      anotacao: 'Quantos vendedores?: 3 a 5',
    });
  });
});
