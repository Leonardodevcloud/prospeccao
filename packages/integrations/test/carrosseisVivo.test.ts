import { IDENTIDADE_PADRAO, montarSlide, type No, semMarcas, slideNovo } from '@prospeccao/shared/carrosseis';
import { pedidoCardsEntrada } from '@prospeccao/shared/carrosseis-time';
import { describe, expect, it } from 'vitest';
import {
  CARTAO_POSTAL,
  type ClienteClaude,
  type EntradaCards,
  FUNDOS_DAS_VARIACOES,
  lerJeitoDePostar,
  lerPerguntas,
  lerRedacaoCards,
  lerRodada,
  mensagemDasPerguntas,
  perguntarAntes,
  USO_ZERO,
} from '../src/carrosseis/index.js';

/** Todos os textos da árvore do slide, com o estilo de quem os escreve. */
function textos(no: No | string, cor = ''): { t: string; cor: string }[] {
  if (typeof no === 'string') return [{ t: no, cor }];
  const c = (no.props.style as { color?: string } | undefined)?.color ?? cor;
  const filhos =
    no.props.children == null
      ? []
      : Array.isArray(no.props.children)
        ? no.props.children
        : [no.props.children];
  return filhos.flatMap((f) => textos(f as No | string, c));
}

const claudeFalso = (dados: Record<string, unknown>) => {
  const pedidos: Parameters<ClienteClaude['pedir']>[0][] = [];
  const c: ClienteClaude = {
    modelo: 'claude-sonnet-5-5',
    async pedir(p) {
      pedidos.push(p);
      return { dados, uso: USO_ZERO, custoUsd: 0.001 };
    },
  };
  return { c, pedidos };
};

const identidade = {
  ...IDENTIDADE_PADRAO,
  cores: { principal: '#2B3A8C', destaque: '#E8505B', claro: '#F4F1EA', texto: '#141414' },
  marcaTexto: 'ACME',
};

describe('v148: cards mais vivos', () => {
  it('a palavra marcada sai na cor de destaque e a marca some', () => {
    const slide = {
      ...slideNovo('capa', 's1'),
      titulo: 'Entrega em *40 minutos* na sua loja',
      sobretitulo: 'Novidade',
    };
    const m = montarSlide({ slide, indice: 0, total: 1, identidade, estilo: 'vivo' });
    const t = textos(m.no);
    expect(t.map((x) => x.t).join('')).not.toContain('*');
    // v157: cada palavra marcada é um pedaço próprio (a quebra de linha é decidida pelo código).
    const marcada = t.find((x) => x.t === '40');
    expect(t.find((x) => x.t === 'minutos')?.cor).toBe(marcada?.cor);
    const resto = t.find((x) => x.t.includes('Entrega'));
    expect(marcada?.cor).toBeTruthy();
    expect(marcada?.cor).not.toBe(resto?.cor);
    expect(semMarcas('a *b* c')).toBe('a b c');
  });

  it('no card, a logo e o botão aparecem em qualquer modelo; no carrossel, não', () => {
    const slide = {
      ...slideNovo('numero', 's1'),
      destaque: '15/12',
      titulo: 'A loja nova abre',
      botao: 'Chame no WhatsApp',
    };
    const card = textos(montarSlide({ slide, indice: 0, total: 1, identidade, estilo: 'vivo' }).no).map(
      (x) => x.t,
    );
    expect(card).toContain('ACME');
    expect(card).toContain('Chame no WhatsApp');
    const slideDoCarrossel = textos(
      montarSlide({ slide, indice: 2, total: 6, identidade, estilo: 'vivo' }).no,
    ).map((x) => x.t);
    expect(slideDoCarrossel).not.toContain('Chame no WhatsApp');
  });

  it('o redator dos cards: selo e botão em todo modelo e cada variação num fundo da marca', () => {
    const e = {
      pedido: pedidoCardsEntrada.parse({
        assunto: 'Loja nova',
        quantidade: 1,
        variacoes: 3,
        chamada: 'whatsapp',
      }),
      outra: null,
    } as unknown as EntradaCards;
    const plano = {
      titulo: 'Loja nova',
      cards: [
        {
          titulo: 'Abertura',
          ideia: 'abre dia 15',
          variacoes: ['numero', 'capa', 'citacao'].map((m) => ({ modelo: m, abordagem: 'x', fotoId: null })),
        },
      ],
    } as never;
    const r = lerRedacaoCards(
      {
        cards: [
          {
            variacoes: [0, 1, 2].map(() => ({
              titulo: 'Abre *dia 15*',
              destaque: '15',
              sobretitulo: 'Novidade',
              botao: 'Chame agora',
            })),
            legenda: 'x',
            hashtags: [],
          },
        ],
      },
      plano,
      e,
    );
    const v = r.cards[0]!.variacoes;
    expect(v.map((s) => s.fundo)).toEqual([...FUNDOS_DAS_VARIACOES]);
    for (const s of v) {
      expect(s.sobretitulo).toBe('Novidade');
      expect(s.botao).toBe('Chame agora');
    }
  });

  it('as perguntas: só as boas, no máximo 4, sem repetir', () => {
    const p = lerPerguntas({
      perguntas: [
        {
          pergunta: 'Tem condição de lançamento?',
          porque: 'Só entra o que você confirmar.',
          sugestoes: ['1ª semana grátis', 'Não tem', 'Não tem'],
        },
        { pergunta: 'Tem condição de lançamento?', porque: 'repetida', sugestoes: [] },
        { pergunta: 'oi', porque: '', sugestoes: [] },
        ...[1, 2, 3, 4].map((i) => ({ pergunta: `Pergunta número ${i}?`, porque: '', sugestoes: ['a'] })),
      ],
    });
    expect(p).toHaveLength(4);
    expect(p[0]).toEqual({
      pergunta: 'Tem condição de lançamento?',
      porque: 'Só entra o que você confirmar.',
      sugestoes: ['1ª semana grátis', 'Não tem'],
    });
  });

  it('a estrategista recebe o pedido e o cérebro da marca para perguntar', async () => {
    const { c, pedidos } = claudeFalso({
      perguntas: [{ pergunta: 'O que o cliente ganha?', porque: 'x', sugestoes: ['Rapidez'] }],
    });
    const r = await perguntarAntes(c, {
      tipo: 'cards',
      empresa: 'ACME',
      dossieTexto: 'EMPRESA: ACME. Vende peças.',
      assunto: 'Card do lançamento da loja nova',
      objetivo: 'Lançamento',
      chamada: 'Chamar no WhatsApp',
      formato: 'Feed 4:5',
      divulgar: null,
      fotos: 0,
    });
    expect(r.perguntas[0]!.pergunta).toBe('O que o cliente ganha?');
    expect(pedidos[0]!.mensagem).toContain('Card do lançamento da loja nova');
    expect(pedidos[0]!.mensagem).toContain('EMPRESA: ACME');
    expect(
      mensagemDasPerguntas({
        tipo: 'carrossel',
        empresa: 'X',
        dossieTexto: '',
        assunto: '',
        objetivo: '',
        chamada: '',
        formato: 'Feed',
        divulgar: null,
        fotos: 0,
      }),
    ).toContain('Nunca repita uma pergunta');
  });

  it('o cartão-postal: a cena da cidade tem que ser reconhecível, pelo nome', () => {
    expect(CARTAO_POSTAL).toContain('cartão-postal');
    expect(CARTAO_POSTAL).toContain('reconhecer');
  });

  it('aprender com o Instagram: cores, estilo e fontes válidos (o que vier errado fica como estava)', async () => {
    const { c, pedidos } = claudeFalso({
      principal: '#5b21b6',
      destaque: 'laranja',
      claro: '#F5F0FF',
      texto: '#1E1B3A',
      estilo: 'vivo',
      fontes: 'nao-existe',
      jeito: 'Fundo roxo forte, foto de ponta a ponta com pessoas, título grosso com uma palavra em laranja.',
      motivo: 'Quase todos os posts têm fundo roxo.',
    });
    const r = await lerJeitoDePostar(
      c,
      [{ jpeg: new Uint8Array([1, 2, 3]) }, { jpeg: new Uint8Array([4]) }],
      identidade.cores,
    );
    expect(r.cores).toEqual({
      principal: '#5B21B6',
      destaque: '#E8505B',
      claro: '#F5F0FF',
      texto: '#1E1B3A',
    });
    expect(r.estilo).toBe('vivo');
    expect(r.fontes).toBe('moderno');
    expect(r.jeito).toContain('Fundo roxo');
    expect(pedidos[0]!.imagens).toHaveLength(2);
  });
});

describe('v149: a conversa da estrategista em rodadas', () => {
  const base = {
    tipo: 'cards' as const,
    empresa: 'Loja X',
    dossieTexto: 'Vende pneus.',
    assunto: 'Promoção de pneus',
    objetivo: 'Promoção',
    chamada: 'WhatsApp',
    formato: 'Feed',
    divulgar: null,
    fotos: 0,
  };

  it('não repete pergunta já feita e para quando não sobra pergunta', () => {
    const r = lerRodada(
      {
        pronto: false,
        entendi: 'Promoção de pneus para quem roda muito.',
        perguntas: [
          { pergunta: 'Qual o desconto?', porque: 'O título vende o número.', sugestoes: ['10%'] },
          { pergunta: 'Até quando vale?', porque: 'Urgência.', sugestoes: [] },
        ],
      },
      { ...base, conversa: [{ pergunta: 'Qual o desconto?', resposta: '15%' }], rodada: 1 },
    );
    expect(r.perguntas.map((p) => p.pergunta)).toEqual(['Até quando vale?']);
    expect(r.pronto).toBe(false);
    expect(r.rodada).toBe(1);
    const fim = lerRodada(
      { pronto: false, entendi: 'x', perguntas: [{ pergunta: 'Qual o desconto?' }] },
      {
        ...base,
        conversa: [{ pergunta: 'Qual o desconto?', resposta: '' }],
        rodada: 1,
      },
    );
    expect(fim).toMatchObject({ pronto: true, perguntas: [] });
  });

  it('na última rodada só resume', () => {
    const r = lerRodada(
      {
        pronto: false,
        entendi: 'Resumo.',
        perguntas: [{ pergunta: 'Mais uma?', porque: '', sugestoes: [] }],
      },
      { ...base, rodada: 3 },
    );
    expect(r).toEqual({ pronto: true, entendi: 'Resumo.', perguntas: [], rodada: 3 });
    expect(mensagemDasPerguntas({ ...base, rodada: 3 })).toContain('ÚLTIMA RODADA');
  });

  it('leva o que já foi respondido, e marca o que ficou em branco', () => {
    const m = mensagemDasPerguntas({
      ...base,
      rodada: 1,
      conversa: [
        { pergunta: 'Qual o desconto?', resposta: '15%' },
        { pergunta: 'Para qual cidade?', resposta: '' },
      ],
    });
    expect(m).toContain('Qual o desconto? → 15%');
    expect(m).toContain('Para qual cidade? → (não respondeu)');
    expect(m).toContain('aprofundando');
  });
});
