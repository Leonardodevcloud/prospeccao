import { IDENTIDADE_PADRAO } from '@prospeccao/shared/carrosseis';
import { pedidoTimeEntrada } from '@prospeccao/shared/carrosseis-time';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type ClienteClaude,
  criarClaude,
  custoUsd,
  type EntradaTime,
  type PedidoClaude,
  refazerSlide,
  semDadosPessoais,
  trabalharNoCarrossel,
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

/** Claude de mentira: responde pelo agente, e guarda o que recebeu. */
function claudeFalso(respostas: Record<string, Record<string, unknown>[]>) {
  const pedidos: PedidoClaude[] = [];
  const contagem: Record<string, number> = {};
  const c: ClienteClaude = {
    modelo: 'claude-sonnet-5-5',
    async pedir(p) {
      pedidos.push(p);
      const i = contagem[p.agente] ?? 0;
      contagem[p.agente] = i + 1;
      const lista = respostas[p.agente] ?? [];
      const dados = lista[Math.min(i, lista.length - 1)] ?? {};
      return { dados, uso: { ...USO_ZERO, entrada: 1000, saida: 200 }, custoUsd: 0.004 };
    },
  };
  return { c, pedidos };
}

const entrada = (extra: Partial<EntradaTime> = {}): EntradaTime => ({
  empresa: 'Auto Peças Horizonte',
  dossieTexto: 'EMPRESA: Auto Peças Horizonte\nO QUE VENDE: Peças de freio e suspensão',
  fontes: [
    { rotulo: 'Cérebro da marca', texto: 'Peças de freio e suspensão. Garantia de 6 meses em pastilhas.' },
    { rotulo: 'O que divulgar', texto: 'Promoção: Pastilha\nPreço por: R$ 139,90\nValidade: até 30/11' },
  ],
  identidade: { ...IDENTIDADE_PADRAO, assinatura: '@horizonte' },
  estilo: 'editorial',
  pedido: pedidoTimeEntrada.parse({
    assunto: 'Promoção da pastilha',
    objetivo: 'vender',
    slides: 4,
    chamada: 'comentar',
    palavra: 'freio',
  }),
  divulgar: {
    id: 7,
    tipo: 'promocao',
    titulo: 'Pastilha com instalação grátis',
    detalhes: '',
    produto: 'Pastilha',
    precoDe: '',
    precoPor: 'R$ 139,90',
    validade: 'até 30/11',
    condicoes: '',
    ate: null,
  },
  postsQueFuncionaram: [
    {
      legenda: 'Dica de freio',
      tipo: 'carousel_album',
      alcance: 900,
      salvos: 40,
      compartilhamentos: 12,
      leads: 3,
    },
  ],
  anteriores: ['5 sinais de que o freio está no fim'],
  fotos: [{ id: 11, nome: 'Loja' }],
  hoje: 'domingo, 8 de novembro de 2026',
  ...extra,
});

const estrategia = {
  titulo: 'Promoção da pastilha',
  angulo: 'Quem ouve o freio chiar adia a troca: a promoção tira a desculpa do preço.',
  ganchos: [
    'Freio chiando? Troca com instalação grátis',
    'A pastilha não avisa duas vezes',
    'R$ 139,90 e o chiado some',
  ],
  escolhido: 0,
  porque: 'Os clientes perguntam quando trocar a pastilha.',
  fontes: ['O que divulgar', 'Perguntas dos clientes', 'Inventada'],
  slides: [
    { modelo: 'capa', ideia: 'gancho', fotoId: 11 },
    { modelo: 'texto', ideia: 'o sinal' },
    { modelo: 'numero', ideia: 'o preço' },
    { modelo: 'chamada', ideia: 'comente' },
  ],
};

const redacao = (precoErrado = false) => ({
  slides: [
    {
      modelo: 'capa',
      sobretitulo: 'Freios',
      titulo: 'Freio chiando? Troca com instalação grátis',
      texto: 'Só este mês.',
    },
    {
      modelo: 'texto',
      titulo: 'O chiado é o aviso',
      texto: 'A pastilha gasta faz barulho antes de parar de frear bem.',
    },
    {
      modelo: 'numero',
      destaque: precoErrado ? 'R$ 129,90' : 'R$ 139,90',
      titulo: 'A pastilha com instalação',
      texto: 'Válido até 30/11.',
    },
    {
      modelo: 'chamada',
      titulo: 'Quer garantir a sua?',
      botao: 'Fale com a gente',
      texto: 'A gente te chama no direct.',
    },
  ],
  legenda: 'Freio chiando? Não espere parar de frear.\n\nGarantia de 6 meses.',
  hashtags: ['#autopecas', 'freios', 'salvador', 'freios'],
});

describe('o time de IA', () => {
  it('estratégia, redação, revisão com uma volta ao redator e o relatório', async () => {
    const { c, pedidos } = claudeFalso({
      estrategista: [estrategia],
      redator: [redacao(true), redacao(false)],
      revisor: [
        {
          notas: { ...notas(4), gancho: 2 },
          comentario: 'Gancho fraco.',
          ajustes: [
            {
              slide: 1,
              campo: 'titulo',
              tipo: 'outro',
              problema: 'Gancho genérico',
              sugestao: 'A pastilha não avisa duas vezes',
            },
          ],
          fatos: [
            {
              slide: 0,
              frase: 'Garantia de 6 meses',
              fonte: 'Cérebro da marca',
              trecho: 'Garantia de 6 meses em pastilhas',
            },
          ],
        },
        {
          notas: notas(5),
          ajustes: [],
          fatos: [
            {
              slide: 0,
              frase: 'Garantia de 6 meses',
              fonte: 'Cérebro da marca',
              trecho: 'Garantia de 6 meses em pastilhas',
            },
            // Citação que não está na fonte: não vale.
            {
              slide: 2,
              frase: 'Instalação em 15 minutos',
              fonte: 'Cérebro da marca',
              trecho: 'instalação em 15 minutos',
            },
          ],
        },
        { notas: notas(5), ajustes: [], fatos: [] },
      ],
    });
    const etapas: string[] = [];
    const r = await trabalharNoCarrossel(c, entrada(), (e, d) => {
      etapas.push(d ? `${e}: ${d}` : e);
    });

    expect(r.slides.map((s) => s.modelo)).toEqual(['capa', 'texto', 'numero', 'chamada']);
    expect(r.slides[0]!.fotoId).toBe(11);
    // A palavra do "comente" vai no botão, do jeito que a regra procura.
    expect(r.slides[3]!.botao).toBe('Comente FREIO');
    expect(r.legenda).toContain('#autopecas #freios #salvador');
    expect(r.relatorio).toMatchObject({
      gancho: 'Freio chiando? Troca com instalação grátis',
      fontes: ['O que divulgar', 'Perguntas dos clientes'],
      divulgarId: 7,
      palavra: 'FREIO',
      hashtags: ['autopecas', 'freios', 'salvador'],
    });
    // 1ª revisão: preço errado (do diretor de arte) e gancho fraco → volta ao redator.
    // 2ª: o fato citado com trecho que não existe → volta de novo. 3ª: aprovado.
    expect(r.relatorio.voltas).toBe(2);
    expect(r.relatorio.aprovado).toBe(true);
    expect(r.relatorio.avisos).toEqual([]);
    expect(pedidos.filter((p) => p.agente === 'revisor')).toHaveLength(3);
    // A reescrita leva os ajustes e o problema do preço.
    const reescrita = pedidos.filter((p) => p.agente === 'redator')[1]!.mensagem;
    expect(reescrita).toContain('Gancho genérico');
    expect(reescrita).toContain('R$ 129,90');
    // O cérebro da marca vai no começo do prompt, marcado para o cache.
    expect(pedidos[0]!.sistema[0]).toMatchObject({ cache: true });
    expect(pedidos[0]!.sistema[0]!.texto).toContain('Peças de freio e suspensão');
    expect(etapas).toContain('estrategista: Gancho escolhido: “Freio chiando? Troca com instalação grátis”');
    expect(r.custoUsd).toBeCloseTo(0.004 * pedidos.length, 6);
  });

  it('depois de 2 voltas, o que sobrou vira aviso com a sugestão para a pessoa decidir', async () => {
    const { c } = claudeFalso({
      estrategista: [{ ...estrategia, slides: estrategia.slides }],
      redator: [redacao(false)],
      revisor: [
        {
          notas: { ...notas(4), tom: 2 },
          ajustes: [
            {
              slide: 2,
              campo: 'texto',
              tipo: 'tom',
              problema: 'Formal demais',
              sugestao: 'O chiado é a pastilha pedindo troca.',
            },
          ],
          fatos: [{ slide: 0, frase: '98% dos clientes voltam', fonte: null, trecho: null }],
        },
      ],
    });
    const r = await trabalharNoCarrossel(c, entrada());
    expect(r.relatorio.voltas).toBe(2);
    expect(r.relatorio.aprovado).toBe(false);
    const tom = r.relatorio.avisos.find((a) => a.tipo === 'tom')!;
    expect(tom).toMatchObject({
      slideId: 's2',
      sugestao: { campo: 'texto', valor: 'O chiado é a pastilha pedindo troca.' },
      resolvido: null,
    });
    const fato = r.relatorio.avisos.find((a) => a.tipo === 'fato')!;
    expect(fato.slideId).toBeNull();
    expect(fato.texto).toContain('98% dos clientes voltam');
  });

  it('o roteiro sai com a capa no começo, a chamada no fim e o número de slides pedido', async () => {
    const { c } = claudeFalso({
      estrategista: [
        {
          ...estrategia,
          slides: [
            { modelo: 'texto', ideia: 'a' },
            { modelo: 'foto', ideia: 'sem foto', fotoId: 999 },
            { modelo: 'inexistente', ideia: 'b' },
          ],
        },
      ],
      redator: [{ slides: [], legenda: 'x', hashtags: [] }],
      revisor: [{ notas: notas(5), ajustes: [], fatos: [] }],
    });
    const r = await trabalharNoCarrossel(
      c,
      entrada({ divulgar: null, pedido: pedidoTimeEntrada.parse({ assunto: 'Freio', slides: 6 }) }),
    );
    expect(r.slides).toHaveLength(6);
    expect(r.slides[0]!.modelo).toBe('capa');
    expect(r.slides.at(-1)!.modelo).toBe('chamada');
    // "Foto" com uma foto que não existe vira texto.
    expect(r.slides.some((s) => s.modelo === 'foto')).toBe(false);
  });

  it('pedido ao redator num slide: mesmo modelo, a foto e o fundo continuam', async () => {
    const { c, pedidos } = claudeFalso({
      redator: [{ slide: { modelo: 'texto', titulo: 'Chiou, trocou', texto: 'Simples assim.' } }],
    });
    const e = entrada();
    const slides = [
      {
        ...(
          await trabalharNoCarrossel(
            claudeFalso({
              estrategista: [estrategia],
              redator: [redacao()],
              revisor: [{ notas: notas(5), ajustes: [], fatos: [] }],
            }).c,
            e,
          )
        ).slides[1]!,
        fundo: 'escuro' as const,
      },
    ];
    const r = await refazerSlide(c, {
      ...e,
      pedido: { objetivo: 'vender', chamada: 'comentar', palavra: 'freio', assunto: 'Promoção' },
      slides,
      indice: 0,
      instrucao: 'Deixe o slide bem mais curto.',
    });
    expect(r.slide).toMatchObject({ id: 's2', modelo: 'texto', titulo: 'Chiou, trocou', fundo: 'escuro' });
    expect(r.avisos).toEqual([]);
    expect(pedidos[0]!.mensagem).toContain('Deixe o slide bem mais curto.');
  });
});

describe('dados de clientes antes de ir para a IA', () => {
  it('telefone, e-mail, documento e site saem', () => {
    expect(
      semDadosPessoais(
        'Oi, meu zap é (71) 99876-5432, email joao@empresa.com.br, cnpj 12.345.678/0001-90 e site https://x.com.br/a',
      ),
    ).toBe('Oi, meu zap é [telefone], email [e-mail], cnpj [documento] e site [site]');
  });
});

describe('o cliente do Claude', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('pede pela ferramenta, marca o cache, mede o uso e tenta de novo quando está sobrecarregado', async () => {
    const chamadas: { url: string; init: RequestInit }[] = [];
    let vez = 0;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      chamadas.push({ url, init });
      vez++;
      if (vez === 1)
        return new Response('{"type":"error","error":{"type":"overloaded_error"}}', { status: 529 });
      return Response.json({
        content: [{ type: 'tool_use', name: 'resposta', input: { ok: true } }],
        stop_reason: 'tool_use',
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_creation_input_tokens: 2000,
          cache_read_input_tokens: 0,
        },
      });
    });
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const medidas: { custo: number; ok: boolean }[] = [];
    const c = criarClaude({
      chave: 'sk-ant-teste',
      modelo: 'claude-sonnet-5-5',
      medidor: { depois: async (_u, custo, ok) => void medidas.push({ custo, ok }) },
    });
    const p = c.pedir({
      agente: 'teste',
      sistema: [{ texto: 'marca', cache: true }, { texto: 'sem cache' }],
      mensagem: 'oi',
      ferramenta: { nome: 'resposta', descricao: 'x', esquema: { type: 'object' } },
    });
    await vi.runAllTimersAsync();
    const r = await p;
    vi.useRealTimers();
    expect(r.dados).toEqual({ ok: true });
    expect(chamadas).toHaveLength(2);
    expect(chamadas[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    const h = chamadas[1]!.init.headers as Record<string, string>;
    expect(h['x-api-key']).toBe('sk-ant-teste');
    expect(h['anthropic-version']).toBe('2023-06-01');
    const corpo = JSON.parse(String(chamadas[1]!.init.body));
    expect(corpo.tool_choice).toEqual({ type: 'tool', name: 'resposta' });
    expect(corpo.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(corpo.system[1].cache_control).toBeUndefined();
    expect(r.uso).toEqual({ entrada: 100, saida: 20, cacheEscrita: 2000, cacheLeitura: 0 });
    // US$: (100 + 2000×1,25)/1e6 × 2 + 20/1e6 × 10
    expect(r.custoUsd).toBeCloseTo(0.0054, 6);
    expect(medidas).toEqual([{ custo: r.custoUsd, ok: true }]);
  });

  it('resposta cortada no teto vira erro (o JSON pela metade não serve)', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({
        content: [],
        stop_reason: 'max_tokens',
        usage: { input_tokens: 10, output_tokens: 4000 },
      }),
    );
    const c = criarClaude({ chave: 'k'.repeat(30), modelo: 'claude-sonnet-5-5' });
    await expect(
      c.pedir({
        agente: 'redator',
        sistema: [],
        mensagem: 'x',
        ferramenta: { nome: 'f', descricao: 'x', esquema: {} },
      }),
    ).rejects.toThrow(/cortada/);
    expect(custoUsd('claude-opus-5', { entrada: 1e6, saida: 0, cacheEscrita: 0, cacheLeitura: 0 })).toBe(5);
  });
});
