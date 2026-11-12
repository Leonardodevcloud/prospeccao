import { describe, expect, it } from 'vitest';
import {
  caberBlocos,
  contarLinhas,
  contraste,
  ESTILOS,
  geometriaCamadas,
  IDENTIDADE_PADRAO,
  identidadeCompleta,
  limparParaSlide,
  MODELOS,
  montarSlide,
  type No,
  PARES_FONTES,
  paletaDaIdentidade,
  roteiroInicial,
  slideNovo,
  textoForaDaFonte,
} from '../src/carrosseis.js';
import { planoEfetivo, TABELA_PADRAO, tabelaCompleta } from '../src/planos.js';

const cores = (principal: string, destaque: string, claro: string, texto: string) => ({
  principal,
  destaque,
  claro,
  texto,
});

describe('paleta dos carrosséis', () => {
  // Combinações difíceis: principal clara, destaque pálido, fundo claro escuro demais, texto claro.
  const casos = [
    cores('#14213D', '#F2A541', '#F6F1E9', '#101828'),
    cores('#F4D35E', '#FFF3B0', '#FFFFFF', '#FAFAFA'),
    cores('#0B6B63', '#3CC4B3', '#E2F1EE', '#18181B'),
    cores('#E63946', '#F1FAEE', '#A8DADC', '#457B9D'),
    cores('#FFFFFF', '#FFFFFF', '#000000', '#FFFFFF'),
  ];
  it('todo texto tem leitura (≥ 4,5) e todo número grande ≥ 3, em qualquer fundo', () => {
    for (const c of casos) {
      const p = paletaDaIdentidade(c);
      for (const f of [p.claro, p.escuro, p.branco, p.destaque]) {
        expect(contraste(f.texto, f.fundo)).toBeGreaterThanOrEqual(4.5);
        expect(contraste(f.suave, f.fundo)).toBeGreaterThanOrEqual(4.5);
        expect(contraste(f.acentoTexto, f.fundo)).toBeGreaterThanOrEqual(4.5);
        expect(contraste(f.acento, f.fundo)).toBeGreaterThanOrEqual(3);
        expect(contraste(f.botaoTexto, f.botaoFundo)).toBeGreaterThanOrEqual(4.5);
        expect(contraste(f.cartaoTexto, f.cartao)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it('avisa o que ajustou para dar leitura', () => {
    expect(paletaDaIdentidade(IDENTIDADE_PADRAO.cores).ajustes.length).toBeGreaterThan(0);
    expect(paletaDaIdentidade(cores('#0B2545', '#13315C', '#EEF4ED', '#0B2545')).ajustes).toEqual([]);
  });
});

describe('medir e caber o texto', () => {
  const inter = { familia: 'Inter', peso: 400 };
  it('quebra em mais linhas quanto maior a fonte e menor a caixa', () => {
    const t = 'Quem pediu orçamento ontem já falou com outro fornecedor hoje.';
    expect(contarLinhas(t, inter, 40, 900)).toBeLessThan(contarLinhas(t, inter, 80, 900));
    expect(contarLinhas(t, inter, 40, 300)).toBeGreaterThan(contarLinhas(t, inter, 40, 900));
    expect(contarLinhas('a\nb\nc', inter, 40, 900)).toBe(3);
  });
  it('diminui o bloco mais longe do mínimo até caber, e diz quando não cabe', () => {
    const blocos = [
      {
        id: 't',
        texto: 'Um título razoavelmente longo para o slide',
        fonte: inter,
        largura: 888,
        min: 48,
        max: 96,
        alturaLinha: 1.1,
        antes: 0,
        peso: 2,
      },
      {
        id: 'x',
        texto: 'Texto de apoio com algumas palavras a mais. '.repeat(3),
        fonte: inter,
        largura: 888,
        min: 28,
        max: 40,
        alturaLinha: 1.4,
        antes: 40,
      },
    ];
    const folgado = caberBlocos(blocos, 2000);
    expect(folgado).toMatchObject({ cabe: true, tamanhos: { t: 96, x: 40 } });
    const apertado = caberBlocos(blocos, 360);
    expect(apertado.tamanhos.t).toBeLessThan(96);
    expect(apertado.tamanhos.x).toBeLessThanOrEqual(40);
    expect(caberBlocos([{ ...blocos[1]!, texto: 'palavra '.repeat(400) }], 300).cabe).toBe(false);
  });
});

describe('texto que a fonte não desenha', () => {
  it('tira emoji e troca setas', () => {
    expect(textoForaDaFonte('Promoção 🔥')).toBe(true);
    expect(textoForaDaFonte('Promoção já: ação')).toBe(false);
    expect(limparParaSlide('Arraste → para ver 🔥')).toBe('Arraste › para ver');
  });
});

/** Procura no slide um elemento com largura em % e espaçamento (o Satori soma por fora e estoura). */
function largurasPerigosas(no: No | string, achados: string[] = []): string[] {
  if (typeof no === 'string') return achados;
  const s = no.props.style ?? {};
  if (typeof s.width === 'string' && s.width.endsWith('%') && (s.padding || s.paddingLeft || s.paddingRight))
    achados.push(JSON.stringify(s));
  if (typeof s.height === 'string' && s.height.endsWith('%') && (s.padding || s.paddingTop))
    achados.push(JSON.stringify(s));
  const filhos = no.props.children;
  for (const f of Array.isArray(filhos) ? filhos : filhos ? [filhos] : []) largurasPerigosas(f, achados);
  return achados;
}

describe('montar os slides', () => {
  it('todo modelo, em todo estilo e par de fontes, monta sem largura perigosa e sem aviso no exemplo', () => {
    for (const estilo of ESTILOS)
      for (const fontes of PARES_FONTES)
        for (const [i, modelo] of MODELOS.entries()) {
          const slide = slideNovo(modelo, `s${i}`);
          const m = montarSlide({
            slide,
            indice: i,
            total: MODELOS.length,
            identidade: { ...IDENTIDADE_PADRAO, fontes, assinatura: '@empresa' },
            estilo,
            foto: ['foto', 'capa', 'arte', 'camadas'].includes(modelo) ? 'data:image/jpeg;base64,AAAA' : null,
          });
          expect(m.no.props.style).toMatchObject({ width: 1080, height: 1350 });
          expect(largurasPerigosas(m.no)).toEqual([]);
          expect(m.avisos).toEqual([]);
        }
  });
  it('texto longo demais vira aviso (e não estoura o slide)', () => {
    const m = montarSlide({
      slide: { ...slideNovo('texto', 'a'), texto: 'Uma frase comprida de exemplo. '.repeat(13) },
      indice: 1,
      total: 3,
      identidade: IDENTIDADE_PADRAO,
      estilo: 'editorial',
    });
    expect(m.avisos.join(' ')).toMatch(/passou de 320 letras/);
    const enorme = montarSlide({
      slide: {
        ...slideNovo('capa', 'a'),
        titulo: 'Um título de capa muito comprido mesmo '.repeat(4).slice(0, 160),
      },
      indice: 0,
      total: 3,
      identidade: IDENTIDADE_PADRAO,
      estilo: 'impacto',
    });
    expect(enorme.avisos.join(' ')).toMatch(/passou de 90 letras/);
  });
  it('slide de foto sem foto pede a foto; emoji avisa', () => {
    const m = montarSlide({
      slide: { ...slideNovo('foto', 'a'), titulo: 'Bastidores 📸' },
      indice: 1,
      total: 3,
      identidade: IDENTIDADE_PADRAO,
      estilo: 'clean',
    });
    expect(m.avisos).toContain('Escolha uma foto para este slide.');
    expect(m.avisos.join(' ')).toMatch(/Emoji/);
  });
  it('o roteiro inicial começa na capa e termina na chamada', () => {
    const r = roteiroInicial();
    expect(r[0]!.modelo).toBe('capa');
    expect(r[r.length - 1]!.modelo).toBe('chamada');
    expect(new Set(r.map((s) => s.id)).size).toBe(r.length);
  });
  it('identidade salva antes de um campo novo ganha o padrão nele', () => {
    const i = identidadeCompleta({ cores: { principal: '#112233' }, estilo: 'impacto' });
    expect(i.cores).toMatchObject({ principal: '#112233', destaque: IDENTIDADE_PADRAO.cores.destaque });
    expect(i).toMatchObject({ estilo: 'impacto', numeroDoSlide: true });
    expect(identidadeCompleta('lixo')).toEqual(IDENTIDADE_PADRAO);
  });
});

describe('módulo Carrosséis com IA no plano', () => {
  it('franquia do módulo, do contrato próprio ou zero sem o módulo', () => {
    const base = {
      plano: 'time' as const,
      limiteUsuarios: null,
      limiteLeadsMes: null,
      mensalidadeManual: null,
    };
    expect(planoEfetivo({ ...base, modulos: [] }).carrosseisMes).toBe(0);
    const com = planoEfetivo({ ...base, modulos: ['carrosseis'] });
    expect(com.carrosseisMes).toBe(TABELA_PADRAO.carrosseisMes);
    expect(
      com.itens.some((i) => i.rotulo === 'Carrosséis com IA' && i.valor === TABELA_PADRAO.modulos.carrosseis),
    ).toBe(true);
    expect(planoEfetivo({ ...base, modulos: ['carrosseis'], carrosseisMes: 50 }).carrosseisMes).toBe(50);
    expect(
      planoEfetivo({
        plano: null,
        limiteUsuarios: null,
        limiteLeadsMes: null,
        modulos: [],
        mensalidadeManual: null,
      }).carrosseisMes,
    ).toBeNull();
  });
  it('tabela salva antes do módulo ganha o preço e a franquia padrão', () => {
    const t = tabelaCompleta({ modulos: { whatsapp: 300 } });
    expect(t.modulos).toMatchObject({ whatsapp: 300, carrosseis: TABELA_PADRAO.modulos.carrosseis });
    expect(t.carrosseisMes).toBe(TABELA_PADRAO.carrosseisMes);
  });

  describe('v152/v153: a peça em camadas', () => {
    const base = {
      ...slideNovo('camadas', 'a'),
      sobretitulo: 'Só esta semana',
      destaque: 'R$ 89,90',
      titulo: 'Pastilha de *cerâmica* instalada',
      botao: 'Chame no WhatsApp',
      fotoId: 1,
    };
    const montar = (extra: object, formato: 'feed' | 'story' = 'feed') =>
      montarSlide({
        slide: { ...base, ...extra },
        indice: 0,
        total: 1,
        identidade: IDENTIDADE_PADRAO,
        estilo: 'vivo',
        foto: 'data:image/png;base64,AAAA',
        fotoMedidas: { largura: 600, altura: 900 },
        elementos: [{ src: 'data:image/png;base64,BBBB' }],
        formato,
      });
    const imagens = (no: unknown): { src: string; style: Record<string, number> }[] => {
      const n = no as {
        type: string;
        props: { src?: string; style?: Record<string, number>; children?: unknown };
      };
      if (!n || typeof n !== 'object') return [];
      const filhos = Array.isArray(n.props?.children) ? n.props.children : [n.props?.children];
      return [
        ...(n.type === 'img' && n.props.src ? [{ src: n.props.src, style: n.props.style ?? {} }] : []),
        ...filhos.flatMap(imagens),
      ];
    };
    it('monta nos dois formatos e nas duas composições, sem aviso, com o recorte encostado na base', () => {
      for (const formato of ['feed', 'story'] as const)
        for (const composicao of ['lado', 'base'] as const) {
          const m = montar({ composicao }, formato);
          expect(m.avisos, `${formato} ${composicao}`).toEqual([]);
          const recorte = imagens(m.no).find((i) => i.src.endsWith('AAAA'))!;
          expect(recorte.style.top! + recorte.style.height!).toBe(formato === 'story' ? 1920 : 1350);
          // A proporção da foto é respeitada (600 × 900).
          expect(Math.round((recorte.style.width! / recorte.style.height!) * 100)).toBe(67);
        }
    });
    it('v154: em qualquer foto, formato e composição, texto, foto e elemento não se encostam', () => {
      const cruza = (p: { x: number; y: number; l: number; a: number }, q: typeof p) =>
        p.x < q.x + q.l && q.x < p.x + p.l && p.y < q.y + q.a && q.y < p.y + p.a;
      for (const formato of ['feed', 'story'] as const)
        for (const composicao of ['lado', 'esquerda', 'base', 'centro', 'topo'] as const)
          for (const [largura, altura] of [
            [420, 1000],
            [600, 900],
            [800, 800],
            [1200, 780],
            [1600, 600],
          ] as const) {
            const g = geometriaCamadas(formato, { largura, altura }, composicao);
            const onde = `${formato} ${composicao} ${largura}x${altura}`;
            expect(cruza(g.texto, g.foto), onde).toBe(false);
            expect(g.foto.x, onde).toBeGreaterThanOrEqual(0);
            expect(g.foto.x + g.foto.l, onde).toBeLessThanOrEqual(1080);
            expect(g.foto.y + g.foto.a, onde).toBeLessThanOrEqual(formato === 'story' ? 1920 : 1350);
            expect(g.texto.l, onde).toBeGreaterThanOrEqual(400);
            // A foto deitada vai sempre embaixo, grande (mais de 60% da largura; a quadrada, quase metade).
            if (largura / altura >= 0.95) {
              expect(g.naBase, onde).toBe(true);
              expect(g.foto.l, onde).toBeGreaterThan(1080 * (largura / altura >= 1.3 ? 0.6 : 0.45));
            }
            if (g.elemento) {
              const e = { x: g.elemento.x, y: g.elemento.y, l: g.elemento.lado, a: g.elemento.lado };
              expect(cruza(e, g.foto), onde).toBe(false);
              expect(cruza(e, g.texto), onde).toBe(false);
              expect(e.l, onde).toBeGreaterThanOrEqual(150);
            }
          }
    });
    it('v154: título com palavra comprida não quebra a palavra, e selo e botão ficam numa linha', () => {
      const m = montar({
        titulo: 'Alugue sua moto *sem burocracia*',
        sobretitulo: 'Novidade: aluguel de moto',
      });
      const textos = JSON.stringify(m.no);
      expect(textos).toContain('"whiteSpace":"nowrap"');
      expect(m.avisos.filter((a) => /longo demais/.test(a))).toEqual([]);
    });
    it('o elemento em 3D entra sobre a cor principal e some sobre a cor de destaque', () => {
      expect(imagens(montar({}).no).some((i) => i.src.endsWith('BBBB'))).toBe(true);
      expect(imagens(montar({ fundo: 'destaque' }).no).some((i) => i.src.endsWith('BBBB'))).toBe(false);
    });
    it('v155: as quatro formas de fundo montam, a peça se mede e a margem do acabamento não tira a foto do lugar', () => {
      for (const forma of ['circulo', 'mancha', 'faixa', 'reticula'] as const) {
        const m = montar({ forma });
        expect(m.avisos, forma).toEqual([]);
        expect(m.camadas).toMatchObject({ cabe: true });
        expect(m.camadas!.titulo).toBeGreaterThanOrEqual(40);
        expect(m.camadas!.foto).toBeGreaterThan(0.15);
      }
      const sem = imagens(montar({}).no).find((i) => i.src.endsWith('AAAA'))!.style;
      const com = imagens(
        montarSlide({
          slide: base,
          indice: 0,
          total: 1,
          identidade: IDENTIDADE_PADRAO,
          estilo: 'vivo',
          foto: 'data:image/png;base64,AAAA',
          fotoMedidas: { largura: 600, altura: 900 },
          fotoFolga: 45,
        }).no,
      ).find((i) => i.src.endsWith('AAAA'))!.style;
      // 45 px de margem numa foto de 600 de largura: a imagem cresce igual para os dois lados.
      expect(com.width! - sem.width!).toBe(2 * (sem.left! - com.left!));
      expect(sem.left! - com.left!).toBeGreaterThan(0);
    });
    it('sem o recorte, cai na capa com um aviso', () => {
      const m = montarSlide({
        slide: base,
        indice: 0,
        total: 1,
        identidade: IDENTIDADE_PADRAO,
        estilo: 'vivo',
        foto: null,
      });
      expect(m.avisos.join(' ')).toContain('recorte');
    });
  });
});

describe('v157: selo que repete, título com palavras marcadas e composições novas', () => {
  it('o selo que só repete o título é reconhecido; o que acrescenta, não', async () => {
    const { seloRepete } = await import('../src/carrosseisTime.js');
    expect(seloRepete('Aluguel de moto', 'Motoboy, a Tutts tem *moto para alugar*')).toBe(true);
    expect(seloRepete('Entrega rápida', 'Entregas rápidas para a sua loja')).toBe(true);
    expect(seloRepete('Só esta semana', 'Rode amanhã sem comprar moto')).toBe(false);
    expect(seloRepete('Para motoboys', 'Rode amanhã sem comprar moto')).toBe(false);
    expect(seloRepete('', 'Qualquer título')).toBe(false);
  });

  it('título com duas palavras marcadas é desenhado no número de linhas que o código mediu', () => {
    const s = {
      ...slideNovo('camadas', 'c'),
      sobretitulo: 'Para motoboys',
      titulo: 'Rode amanhã *sem comprar* moto',
      texto: 'Moto revisada e baú incluso.',
      botao: 'Chame no WhatsApp',
      destaque: '',
      composicao: 'base' as const,
    };
    const m = montarSlide({
      slide: s,
      indice: 0,
      total: 1,
      identidade: IDENTIDADE_PADRAO,
      estilo: 'impacto',
      foto: 'recorte',
      fotoMedidas: { largura: 900, altura: 560 },
      formato: 'feed',
    });
    expect(m.camadas?.cabe).toBe(true);
    // Cada linha do título é uma caixa sem quebra, com as palavras marcadas em pedaços próprios.
    const linhas: string[] = [];
    const andar = (no: unknown) => {
      if (!no || typeof no !== 'object') return;
      const n = no as { props?: { style?: Record<string, unknown>; children?: unknown } };
      const filhos = Array.isArray(n.props?.children) ? n.props.children : [n.props?.children];
      if (
        n.props?.style?.whiteSpace === 'nowrap' &&
        filhos.some((f) => (f as { type?: string })?.type === 'span')
      )
        linhas.push(
          filhos
            .map((f) =>
              typeof f === 'string' ? f : String((f as { props: { children: string } }).props.children),
            )
            .join(''),
        );
      for (const f of filhos) andar(f);
    };
    andar(m.no);
    expect(linhas.join(' ').replace(/\s+/g, ' ')).toContain('sem comprar');
    expect(linhas.length).toBeGreaterThanOrEqual(1);
  });

  it('"Foto em cima" põe o produto deitado antes do texto e a logo solta no canto; "centro" centraliza', () => {
    const topo = geometriaCamadas('feed', { largura: 900, altura: 560 }, 'topo');
    expect(topo.logo).toBeTruthy();
    expect(topo.texto.y).toBeGreaterThan(topo.foto.y + topo.foto.a);
    expect(topo.foto.y).toBeGreaterThan(topo.logo!.y + topo.logo!.altura);
    const centro = geometriaCamadas('feed', { largura: 600, altura: 900 }, 'centro');
    expect(centro.centrado).toBe(true);
    expect(Math.abs(centro.foto.x + centro.foto.l / 2 - 540)).toBeLessThan(2);
    expect(centro.elemento).toBeNull();
    // Pessoa em pé não flutua no meio da peça: "topo" cai na foto embaixo.
    const pessoa = geometriaCamadas('feed', { largura: 600, altura: 900 }, 'topo');
    expect(pessoa.logo).toBeUndefined();
    expect(pessoa.foto.y + pessoa.foto.a).toBe(1350);
  });
});
