import { describe, expect, it } from 'vitest';
import {
  caberBlocos,
  contarLinhas,
  contraste,
  ESTILOS,
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
            foto: modelo === 'foto' || modelo === 'capa' ? 'data:image/jpeg;base64,AAAA' : null,
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
});
