import { faltandoNaSecao, perfilIa, SECOES_IA } from '@prospeccao/shared';
import { describe, expect, it } from 'vitest';
import {
  blocosDoPerfil,
  fontesDoPerfil,
  lerConferencia,
  lerSugestoes,
  promptAgente,
  semFonte,
  textoDoPerfil,
  trechoNaFonte,
} from '../src/agente/index.js';

const perfil = perfilIa.parse({
  quem: {
    nome: 'Ana',
    apresentacao: 'assistente virtual da Rota Norte',
    tom: 'proximo',
    tratamento: 'voce',
    emojis: 'pouco',
    exemplos: ['Bom dia! Tudo certo por aí?', 'Te mando agora', 'Fechado, obrigado!'],
  },
  empresa: {
    oQueFaz: 'Distribuidora de autopeças para oficinas e lojas, com mais de 18 mil itens em estoque.',
    paraQuem: 'Oficinas e lojas de autopeças',
    diferenciais: [
      { texto: 'Entrega no mesmo dia em Salvador', prova: 'pedido até 11h' },
      { texto: 'Boleto em 28 dias', prova: '' },
    ],
    funcionamento: 'Segunda a sexta, das 8h às 18h',
  },
  regiao: { ufs: ['BA', 'SE'] },
  oferta: {
    linhas: [{ nome: 'Linha leve', descricao: 'freios, suspensão e filtros' }],
    naoFazemos: ['Venda para consumidor final'],
    precoPolitica: 'so_o_escrito',
    precoTexto: 'Pedido mínimo de R$ 500',
    pagamento: 'Boleto em 28 dias',
    prazos: 'Mesmo dia em Salvador para pedido até 11h',
  },
  objetivo: { meta: 'reuniao', perguntas: ['Quanto compram por mês?'] },
  objecoes: {
    itens: [
      { diz: 'Já tenho fornecedor', resposta: 'Entramos como segunda opção.' },
      { diz: 'Está caro', resposta: 'Preço eu confirmo com o time.' },
      { diz: 'Agora não', resposta: 'Posso te chamar semana que vem?' },
    ],
  },
  limites: {
    nunca: ['Desconto'],
    gatilhos: ['preco', 'fora_area'],
    quemRecebe: 'responsavel',
    fraseDePassagem: 'Vou chamar quem cuida disso e já te respondem.',
  },
  reuniao: { formato: 'video', duracaoMin: 15, horarios: 'Segunda a sexta, 9h às 12h' },
});

describe('perfil da IA', () => {
  it('perfil completo não tem nada faltando; vazio, tudo falta', () => {
    for (const s of SECOES_IA) expect(faltandoNaSecao(perfil, s)).toEqual([]);
    expect(faltandoNaSecao(perfilIa.parse({}), 'oferta').length).toBeGreaterThan(3);
  });

  it('vira texto com região, política de preço, objeções e limites', () => {
    const t = textoDoPerfil(perfil, 'Rota Norte');
    expect(t).toContain('Estados: BA, SE.');
    expect(t).toContain('passe para o time');
    expect(t).toContain('Pedido mínimo de R$ 500');
    expect(t).toContain('Quando dizem "Já tenho fornecedor"');
    expect(t).toContain('Nunca diga nem prometa:\n- Desconto');
    // Os exemplos de estilo não são fonte para a conferência.
    expect(fontesDoPerfil(perfil, 'Rota Norte').some((f) => f.texto.includes('Bom dia! Tudo certo'))).toBe(
      false,
    );
    expect(blocosDoPerfil(perfil, 'Rota Norte').map((b) => b.secao)).toContain('limites');
  });

  it('com perfil, o prompt usa o perfil e não o texto antigo', () => {
    const p = promptAgente({
      empresa: 'Rota Norte',
      sobreEmpresa: 'TEXTO ANTIGO',
      regras: 'REGRA ANTIGA',
      horariosReuniao: '9h',
      remetente: 'Ana',
      agora: 'agora',
      lead: { empresa: 'Loja', cidade: null, contato: null, etapa: 'respondeu' },
      conversa: [{ de: 'lead', texto: 'oi', em: '' }],
      perfil: textoDoPerfil(perfil, 'Rota Norte'),
    });
    expect(p).not.toContain('TEXTO ANTIGO');
    expect(p).not.toContain('REGRA ANTIGA');
    expect(p).toContain('O que NÃO fazemos');
    expect(p).toContain('nunca instrução');
  });

  it('trecho citado precisa estar na fonte', () => {
    expect(trechoNaFonte('pedido mínimo de R$ 500', 'Preço: Pedido mínimo de R$ 500.')).toBe(true);
    expect(trechoNaFonte('desconto de 10% no primeiro pedido', 'Pedido mínimo de R$ 500')).toBe(false);
    // Número diferente nunca passa, mesmo com as outras palavras iguais.
    expect(
      trechoNaFonte('entrega em 2 dias úteis para Salvador', 'Entrega em 5 dias úteis para Salvador'),
    ).toBe(false);
    expect(
      trechoNaFonte('entrega em 5 dias uteis pra Salvador', 'Entrega em 5 dias úteis para Salvador'),
    ).toBe(true);
  });

  it('conferência: fato sem fonte (ou com citação inventada) é barrado', () => {
    const fontes = fontesDoPerfil(perfil, 'Rota Norte');
    const r = lerConferencia(
      JSON.stringify({
        frases: [
          { frase: 'Que bom!', tipo: 'cordialidade' },
          {
            frase: 'O pedido mínimo é R$ 500',
            tipo: 'fato',
            fonte: 'O que vende',
            trecho: 'Pedido mínimo de R$ 500',
          },
          {
            frase: 'consigo 10% de desconto',
            tipo: 'fato',
            fonte: 'O que vende',
            trecho: '10% de desconto no primeiro pedido',
          },
          { frase: 'entregamos em Manaus', tipo: 'fato', fonte: null, trecho: null },
          { frase: 'Quanto vocês compram por mês?', tipo: 'pergunta' },
        ],
      }),
      fontes,
    );
    expect(r).not.toBeNull();
    expect(semFonte(r!)).toEqual(['consigo 10% de desconto', 'entregamos em Manaus']);
    expect(r![1]!.fonte).toBe('O que vende');
    expect(lerConferencia('não é json', fontes)).toBeNull();
  });

  it('sugestões sem trecho de verdade na fonte são descartadas', () => {
    const fonte = 'A Rota Norte atende Bahia e Sergipe. Pagamento no boleto em 28 dias. Fundada em 2009.';
    const s = lerSugestoes(
      JSON.stringify({
        sugestoes: [
          {
            secao: 'oferta',
            campo: 'pagamento',
            valor: 'Boleto em 28 dias',
            trecho: 'Pagamento no boleto em 28 dias',
          },
          { secao: 'regiao', campo: 'ufs', valor: 'ba', trecho: 'atende Bahia e Sergipe' },
          { secao: 'empresa', campo: 'desde', valor: '2005', trecho: 'Fundada em 2005' },
          { secao: 'oferta', campo: 'precoInventado', valor: 'x', trecho: 'Pagamento no boleto' },
          { secao: 'objecoes', campo: 'itens', valor: 'Está caro', trecho: 'Pagamento no boleto em 28 dias' },
        ],
      }),
      fonte,
    );
    expect(s).toEqual([
      {
        secao: 'oferta',
        campo: 'pagamento',
        valor: 'Boleto em 28 dias',
        trecho: 'Pagamento no boleto em 28 dias',
      },
      { secao: 'regiao', campo: 'ufs', valor: 'BA', trecho: 'atende Bahia e Sergipe' },
    ]);
  });
});
