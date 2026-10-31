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

describe('análise do conteúdo', () => {
  it('marca os comentários com interesse', async () => {
    const { interesseDoComentario } = await import('../src/instagram.js');
    expect(interesseDoComentario('quanto custa pra 3 vendedores?')).toBe('preco');
    expect(interesseDoComentario('me chama no direct 🙏')).toBe('contato');
    expect(interesseDoComentario('vocês atendem construtora?')).toBe('informacao');
    expect(interesseDoComentario('o erro 3 é o que mais vejo')).toBeNull();
    expect(interesseDoComentario('@fulano olha isso kkk')).toBeNull();
  });

  it('tira os achados dos números', async () => {
    const { achadosDoConteudo } = await import('../src/instagram.js');
    const p = (
      midiaId: string,
      tipo: string,
      alcance: number,
      leads: number,
      valorVendas = 0,
      interesse = 0,
    ) => ({
      midiaId,
      legenda: `Post ${midiaId}`,
      tipo,
      alcance,
      leads,
      reunioes: Math.floor(leads / 3),
      vendas: valorVendas ? 1 : 0,
      valorVendas,
      interesse,
    });
    const a = achadosDoConteudo([
      p('1', 'CAROUSEL_ALBUM', 12_100, 19, 2780),
      p('2', 'CAROUSEL_ALBUM', 9_000, 6),
      p('3', 'REELS', 31_200, 16, 1390),
      p('4', 'REELS', 41_000, 0, 0, 23),
    ]);
    expect(a.map((x) => x.tipo)).toEqual(['formato', 'destaque', 'atencao']);
    expect(a[0]!.titulo).toMatch(/^Carrossel traz .*× mais leads por alcance que reels$/);
    expect(a[1]!.midiaId).toBe('1');
    expect(a[2]).toMatchObject({ midiaId: '4' });
    expect(a[2]!.texto).toMatch(/^23 pessoas demonstraram interesse/);
  });
});
