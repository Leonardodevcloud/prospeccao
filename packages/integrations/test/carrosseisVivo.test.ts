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
    const marcada = t.find((x) => x.t === '40 minutos');
    const resto = t.find((x) => x.t.includes('Entrega em'));
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
    ).toContain('NÃO PERGUNTE');
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
