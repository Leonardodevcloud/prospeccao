import { describe, expect, it } from 'vitest';
import { MODELO, slideNovo } from '../src/carrosseis.js';
import {
  type AvisoTime,
  aplicarSugestao,
  botaoDaChamada,
  conferirPromocao,
  DOSSIE_VAZIO,
  dossieCompleto,
  faltandoNoDossie,
  limitesParaORedator,
  pedidoTimeEntrada,
  precosDoTexto,
  revisaoAprovada,
  slideDoTime,
  textoDoDossie,
} from '../src/carrosseisTime.js';

const promo = {
  tipo: 'promocao' as const,
  titulo: 'Pastilha com instalação grátis',
  detalhes: '',
  produto: 'Pastilha de freio dianteira',
  precoDe: 'R$ 189,90',
  precoPor: 'R$ 139,90',
  validade: 'até 30/11',
  condicoes: 'na compra do par',
  ate: null,
};

describe('o cérebro da marca', () => {
  it('dado estragado num campo não derruba os outros', () => {
    const d = dossieCompleto({
      publico: 'Oficinas de Salvador',
      diferenciais: 'não é lista',
      pilares: ['Freios'],
    });
    expect(d.publico).toBe('Oficinas de Salvador');
    expect(d.diferenciais).toEqual([]);
    expect(d.pilares).toEqual(['Freios']);
    expect(dossieCompleto(null)).toEqual(DOSSIE_VAZIO);
  });

  it('diz o que falta para o time escrever e monta o texto sem os vazios', () => {
    expect(faltandoNoDossie(DOSSIE_VAZIO)).toEqual([
      'O que a empresa vende',
      'Para quem vende',
      'O tom de voz',
    ]);
    const t = textoDoDossie(
      {
        ...DOSSIE_VAZIO,
        oQueVende: 'Peças de freio e suspensão',
        provas: [{ texto: 'Garantia de 6 meses', fonte: 'Site' }],
      },
      'Auto Peças Horizonte',
    );
    expect(t).toContain('EMPRESA: Auto Peças Horizonte');
    expect(t).toContain('Garantia de 6 meses [fonte: Site]');
    expect(t).not.toContain('DORES');
  });
});

describe('a promoção sai exatamente como foi digitada', () => {
  const slides = [
    { ...slideNovo('capa', 's1'), titulo: 'Pastilha com instalação grátis' },
    {
      ...slideNovo('numero', 's2'),
      destaque: 'R$ 139,90',
      titulo: 'De R$ 189,90 por',
      texto: 'Válido até 30/11.',
    },
  ];

  it('acha os preços de um texto', () => {
    expect(precosDoTexto('De R$ 189,90 por R$139,90 ou R$ 1.299')).toEqual([
      'R$ 189,90',
      'R$139,90',
      'R$ 1.299',
    ]);
  });

  it('tudo certo: nenhum problema', () => {
    expect(conferirPromocao(promo, slides, 'Na compra do par.')).toEqual([]);
  });

  it('preço inventado e validade faltando viram problema', () => {
    const errado = [{ ...slides[0]! }, { ...slides[1]!, destaque: 'R$ 129,90', texto: 'Só nesta semana.' }];
    const p = conferirPromocao(promo, errado, '');
    expect(p.some((x) => x.includes('R$ 129,90'))).toBe(true);
    expect(p.some((x) => x.includes('Validade'))).toBe(true);
  });
});

describe('o pedido', () => {
  it('precisa de assunto ou do que divulgar; o comente precisa de uma palavra', () => {
    expect(pedidoTimeEntrada.safeParse({}).success).toBe(false);
    expect(pedidoTimeEntrada.safeParse({ divulgarId: 3 }).success).toBe(true);
    expect(pedidoTimeEntrada.safeParse({ assunto: 'Freio chiando', chamada: 'comentar' }).success).toBe(
      false,
    );
    expect(
      pedidoTimeEntrada.safeParse({ assunto: 'Freio chiando', chamada: 'comentar', palavra: 'DUAS PALAVRAS' })
        .success,
    ).toBe(false);
    const ok = pedidoTimeEntrada.parse({ assunto: 'Freio chiando', chamada: 'comentar', palavra: 'FREIO' });
    expect(ok).toMatchObject({ objetivo: 'ensinar', slides: null, estilo: null, usarFotos: true });
    expect(botaoDaChamada('comentar', 'freio')).toBe('Comente FREIO');
    expect(botaoDaChamada('whatsapp', '')).toBeNull();
  });
});

describe('o revisor', () => {
  it('passa com média 4 e nenhuma nota abaixo de 3', () => {
    const base = {
      gancho: 4,
      umaIdeia: 4,
      clareza: 4,
      especifico: 4,
      tamanho: 4,
      chamada: 4,
      tom: 4,
      portugues: 4,
    };
    expect(revisaoAprovada(base)).toBe(true);
    expect(revisaoAprovada({ ...base, gancho: 2, clareza: 5, tom: 5 })).toBe(false);
    expect(revisaoAprovada({ ...base, gancho: 3 })).toBe(false);
    expect(revisaoAprovada({ ...base, gancho: 3, clareza: 5 })).toBe(true);
  });

  it('a sugestão entra no campo certo do slide certo (ou na legenda)', () => {
    const slides = [slideNovo('capa', 'a'), slideNovo('texto', 'b')];
    const aviso: AvisoTime = {
      id: 'a1',
      slideId: 'b',
      tipo: 'fato',
      texto: 'Sem fonte',
      sugestao: { campo: 'texto', valor: 'Quem responde primeiro costuma levar a conversa.' },
      resolvido: null,
    };
    const r = aplicarSugestao(aviso, slides, 'legenda');
    expect(r.slides[1]!.texto).toBe('Quem responde primeiro costuma levar a conversa.');
    expect(r.slides[0]).toEqual(slides[0]);
    const l = aplicarSugestao(
      { ...aviso, slideId: null, sugestao: { campo: 'legenda', valor: 'Nova legenda' } },
      slides,
      'x',
    );
    expect(l.legenda).toBe('Nova legenda');
  });
});

describe('o slide que o redator devolve', () => {
  it('fica só com os campos do modelo, cortados no tamanho do editor', () => {
    const s = slideDoTime(
      {
        titulo: 'T'.repeat(300),
        botao: 'não usa',
        itens: ['um', 'dois', '', 'três', 'quatro', 'cinco', 'seis'],
      },
      'lista',
      's3',
    );
    expect(s).toMatchObject({ id: 's3', modelo: 'lista', botao: '', destaque: '' });
    expect(s.titulo).toHaveLength(160);
    expect(s.itens).toEqual(['um', 'dois', 'três', 'quatro', 'cinco']);
    const c = slideDoTime(
      { titulo: 'Antes e depois', colunas: [{ rotulo: 'Hoje', texto: 'Demora' }] },
      'comparacao',
      's4',
    );
    expect(c.colunas).toHaveLength(2);
  });

  it('os limites do redator são os do editor', () => {
    const t = limitesParaORedator(['capa']);
    expect(t).toContain(
      `titulo (Título, até ${MODELO.capa.campos.find((c) => c.campo === 'titulo')!.limite} letras)`,
    );
  });
});
