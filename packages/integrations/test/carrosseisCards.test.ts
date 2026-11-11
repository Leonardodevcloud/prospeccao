import { IDENTIDADE_PADRAO, montarSlide, slideNovo } from '@prospeccao/shared/carrosseis';
import { pedidoCardsEntrada, pedidoTimeEntrada } from '@prospeccao/shared/carrosseis-time';
import { describe, expect, it } from 'vitest';
import {
  type ClienteClaude,
  type EntradaCards,
  type EntradaTime,
  lerPlano,
  type PedidoClaude,
  promptDaFotoMelhorada,
  tamanhoDaImagem,
  trabalharNoCarrossel,
  trabalharNosCards,
  USO_ZERO,
} from '../src/carrosseis/index.js';

const notas = (n: number) => ({
  gancho: n,
  umaIdeia: n,
  clareza: n,
  especifico: n,
  tamanho: n,
  chamada: n,
  tom: n,
  portugues: n,
});

/** Claude de mentira: responde pelo nome da ferramenta (em ordem, quando há mais de uma resposta). */
function claudeFalso(respostas: Record<string, Record<string, unknown>[]>) {
  const pedidos: PedidoClaude[] = [];
  const contagem: Record<string, number> = {};
  const c: ClienteClaude = {
    modelo: 'claude-sonnet-5-5',
    async pedir(p) {
      pedidos.push(p);
      const chave = p.ferramenta.nome;
      const i = contagem[chave] ?? 0;
      contagem[chave] = i + 1;
      const lista = respostas[chave] ?? [];
      return {
        dados: lista[Math.min(i, lista.length - 1)] ?? {},
        uso: { ...USO_ZERO, entrada: 1000, saida: 200 },
        custoUsd: 0.004,
      };
    },
  };
  return { c, pedidos };
}

const entradaCards = (
  extra: Partial<EntradaCards> = {},
  pedido: Record<string, unknown> = {},
): EntradaCards => ({
  empresa: 'Auto Peças Horizonte',
  dossieTexto: 'EMPRESA: Auto Peças Horizonte',
  fontes: [{ rotulo: 'Cérebro da marca', texto: 'Peças de freio. Garantia de 6 meses em pastilhas.' }],
  identidade: { ...IDENTIDADE_PADRAO, assinatura: '@horizonte' },
  estilo: 'impacto',
  pedido: pedidoCardsEntrada.parse({
    assunto: 'Pastilha e óleo da semana',
    quantidade: 2,
    variacoes: 2,
    formato: 'story',
    ...pedido,
  }),
  divulgar: null,
  postsQueFuncionaram: [],
  anteriores: [],
  fotos: [{ id: 11, nome: 'Loja' }],
  fotosDoPedido: [],
  hoje: 'quarta-feira, 11 de novembro de 2026',
  ...extra,
});

const plano = {
  titulo: 'Semana de ofertas',
  cards: [
    {
      titulo: 'Pastilha',
      ideia: 'Pastilha com preço bom',
      variacoes: [
        { modelo: 'numero', abordagem: 'O preço grande' },
        { modelo: 'capa', abordagem: 'Com a foto da loja', fotoId: 11 },
      ],
    },
    {
      titulo: 'Óleo',
      ideia: 'O óleo certo',
      variacoes: [
        { modelo: 'citacao', abordagem: 'Frase' },
        { modelo: 'chamada', abordagem: 'Ação direta' },
      ],
    },
  ],
};

const redacao = (tituloLongo = false) => ({
  cards: [
    {
      variacoes: [
        { modelo: 'numero', destaque: 'R$ 139,90', titulo: 'Pastilha com instalação', texto: 'Até sexta.' },
        {
          modelo: 'capa',
          titulo: tituloLongo
            ? 'Freio chiando de manhã, de tarde e de noite? A pastilha está pedindo troca faz tempo, e a gente resolve hoje mesmo com instalação grátis'
            : 'Freio chiando? Hora da pastilha',
        },
      ],
      legenda: 'Pastilha com instalação.',
      hashtags: ['#freios', 'salvador'],
    },
    {
      variacoes: [
        { modelo: 'citacao', titulo: 'Óleo certo, motor feliz' },
        { modelo: 'chamada', titulo: 'Troque o óleo hoje', botao: 'Chame no WhatsApp' },
      ],
      legenda: 'Óleo 5W30 na troca.',
      hashtags: ['oleo'],
    },
  ],
});

describe('cards avulsos: o time (v144)', () => {
  it('o pedido recusa mais de 20 peças e pede o assunto', () => {
    expect(pedidoCardsEntrada.safeParse({ assunto: 'Promo', quantidade: 10, variacoes: 3 }).success).toBe(
      false,
    );
    expect(pedidoCardsEntrada.safeParse({ assunto: 'Promo', quantidade: 10, variacoes: 2 }).success).toBe(
      true,
    );
    expect(pedidoCardsEntrada.safeParse({ assunto: '' }).success).toBe(false);
  });

  it('o plano sai com N cards × V variações, mesmo quando o estrategista erra a conta', () => {
    const p = lerPlano(
      { titulo: 'X', cards: [plano.cards[0]] },
      entradaCards({}, { quantidade: 3, variacoes: 3 }),
    );
    expect(p.cards).toHaveLength(3);
    expect(p.cards.every((c) => c.variacoes.length === 3)).toBe(true);
    // Card que faltou: o modelo padrão da promoção (número).
    expect(p.cards[2]!.variacoes[0]!.modelo).toBe('numero');
    // Foto da empresa num modelo que não usa foto: sai.
    const s = lerPlano(
      { cards: [{ titulo: 'a', ideia: 'b', variacoes: [{ modelo: 'numero', abordagem: 'x', fotoId: 11 }] }] },
      entradaCards({}, { quantidade: 1, variacoes: 1 }),
    );
    expect(s.cards[0]!.variacoes[0]!.fotoId).toBeNull();
  });

  it('cada foto do pedido entra em pelo menos uma peça (vira capa se precisar)', () => {
    const e = entradaCards(
      {
        fotosDoPedido: [
          { id: 50, nome: 'Fachada melhorada' },
          { id: 51, nome: 'Pastilha num cenário' },
        ],
        fotos: [],
      },
      { quantidade: 1, variacoes: 2, usarFotos: false },
    );
    const p = lerPlano(
      {
        cards: [
          {
            titulo: 'a',
            ideia: 'b',
            variacoes: [
              { modelo: 'numero', abordagem: 'x' },
              { modelo: 'citacao', abordagem: 'y' },
            ],
          },
        ],
      },
      e,
    );
    const ids = p.cards[0]!.variacoes.map((v) => v.fotoId);
    expect(ids).toEqual([50, 51]);
    expect(p.cards[0]!.variacoes.map((v) => v.modelo)).toEqual(['capa', 'capa']);
  });

  it('o pedido inteiro: plano, redação, encaixe no story, revisão e os avisos de cada peça', async () => {
    const { c, pedidos } = claudeFalso({
      plano_cards: [plano],
      cards: [redacao(true), redacao(false)],
      revisao: [
        { notas: notas(5), ajustes: [], fatos: [] },
        {
          notas: notas(5),
          ajustes: [
            { slide: 4, campo: 'titulo', tipo: 'tom', problema: 'Mais direto', sugestao: 'Troque hoje' },
          ],
          fatos: [],
        },
      ],
    });
    const etapas: string[] = [];
    const r = await trabalharNosCards(c, entradaCards(), (etapa, detalhe) => {
      etapas.push(`${etapa}${detalhe ? `: ${detalhe}` : ''}`);
    });
    expect(r.titulo).toBe('Semana de ofertas');
    expect(r.cards).toHaveLength(2);
    expect(r.cards[0]!.variacoes.map((v) => v.slide.modelo)).toEqual(['numero', 'capa']);
    expect(r.cards[0]!.variacoes[1]!.slide.fotoId).toBe(11);
    expect(r.cards[0]!.legenda).toContain('#freios #salvador');
    // O título longo não coube no story: o diretor de arte pegou e o revisor devolveu (1 volta).
    expect(etapas.some((x) => /Story 9:16 · \d+ ponto/.test(x))).toBe(true);
    expect(etapas).toContain('revisor: Nota 5.0: devolveu 1 ajuste(s) à redatora (volta 1)');
    expect(r.cards[0]!.variacoes[1]!.slide.titulo).toBe('Freio chiando? Hora da pastilha');
    // O ajuste da peça 4 (card 2, variação 2) foi para o aviso dela, apontando o slide dela.
    const v = r.cards[1]!.variacoes[1]!;
    expect(v.relatorio.avisos).toHaveLength(1);
    expect(v.relatorio.avisos[0]).toMatchObject({
      slideId: v.slide.id,
      sugestao: { campo: 'titulo', valor: 'Troque hoje' },
    });
    expect(r.cards[0]!.variacoes[0]!.relatorio.avisos).toHaveLength(0);
    expect(r.cards[0]!.variacoes[0]!.relatorio).toMatchObject({
      objetivo: 'vender',
      gancho: 'Pastilha com instalação',
    });
    // O estrategista recebeu o pedido do jeito dos cards.
    const est = pedidos.find((p) => p.agente === 'estrategista')!.mensagem;
    expect(est).toContain('exatamente 2 cards, cada um com 2 variações');
    expect(est).toContain('Story 9:16');
    // O mesmo manual e cérebro do carrossel, em cache.
    expect(pedidos[0]!.sistema[0]!.cache).toBe(true);
  });

  it('a peça sozinha não tem "Arraste" nem 1/1; o story mede 1080 × 1920', () => {
    const m = montarSlide({
      slide: { ...slideNovo('capa', 'a'), titulo: 'Freio chiando? Hora da pastilha' },
      indice: 0,
      total: 1,
      identidade: IDENTIDADE_PADRAO,
      estilo: 'editorial',
      formato: 'story',
    });
    const texto = JSON.stringify(m.no);
    expect(texto).not.toContain('Arraste');
    expect(texto).not.toContain('1/1');
    expect(m.no.props.style).toMatchObject({ width: 1080, height: 1920 });
    const feed = montarSlide({
      slide: { ...slideNovo('capa', 'a'), titulo: 'Freio' },
      indice: 0,
      total: 5,
      identidade: IDENTIDADE_PADRAO,
      estilo: 'editorial',
    });
    expect(feed.no.props.style).toMatchObject({ width: 1080, height: 1350 });
    expect(JSON.stringify(feed.no)).toContain('Arraste');
  });

  it('a imagem gerada e a foto melhorada pedem o tamanho do formato', () => {
    expect(tamanhoDaImagem('story')).toEqual({ largura: 1088, altura: 1920 });
    expect(tamanhoDaImagem()).toEqual({ largura: 1088, altura: 1360 });
    expect(promptDaFotoMelhorada('story')).toContain('9:16');
    expect(promptDaFotoMelhorada()).toContain('EXATAMENTE igual');
  });
});

describe('carrossel: as fotos do pedido (v144)', () => {
  const base = (extra: Partial<EntradaTime> = {}): EntradaTime => ({
    empresa: 'Auto Peças Horizonte',
    dossieTexto: 'EMPRESA: Auto Peças Horizonte',
    fontes: [{ rotulo: 'Cérebro da marca', texto: 'Peças de freio.' }],
    identidade: { ...IDENTIDADE_PADRAO },
    estilo: 'editorial',
    pedido: pedidoTimeEntrada.parse({ assunto: 'Freios', slides: 5, usarFotos: false }),
    divulgar: null,
    postsQueFuncionaram: [],
    anteriores: [],
    fotos: [],
    hoje: 'hoje',
    ...extra,
  });

  it('as fotos enviadas vão para a capa e para um slide do meio, mesmo sem "usar fotos"', async () => {
    const { c, pedidos } = claudeFalso({
      estrategia: [
        {
          titulo: 'Freios',
          angulo: 'a',
          ganchos: ['g'],
          escolhido: 0,
          porque: 'p',
          slides: [
            { modelo: 'capa', ideia: 'gancho' },
            { modelo: 'texto', ideia: 'um' },
            { modelo: 'texto', ideia: 'dois' },
            { modelo: 'numero', ideia: 'três' },
            { modelo: 'chamada', ideia: 'fim' },
          ],
        },
      ],
      carrossel: [
        {
          slides: [
            { modelo: 'capa', titulo: 'Freio' },
            { modelo: 'texto', titulo: 'Um', texto: 'x' },
            { modelo: 'foto', titulo: 'Dois' },
            { modelo: 'numero', destaque: '3', titulo: 'Três' },
            { modelo: 'chamada', titulo: 'Fim' },
          ],
          legenda: 'L',
          hashtags: [],
        },
      ],
      revisao: [{ notas: notas(5), ajustes: [], fatos: [] }],
    });
    const r = await trabalharNoCarrossel(
      c,
      base({
        fotosDoPedido: [
          { id: 70, nome: 'Equipe' },
          { id: 71, nome: 'Balcão' },
        ],
      }),
    );
    expect(r.slides[0]!.fotoId).toBe(70);
    expect(r.slides[1]!.modelo).toBe('foto');
    expect(r.slides[1]!.fotoId).toBe(71);
    expect(pedidos.find((p) => p.agente === 'estrategista')!.mensagem).toContain(
      'FOTOS QUE A EMPRESA MANDOU PARA ESTE CARROSSEL',
    );
  });
});
