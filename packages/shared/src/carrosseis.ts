import { z } from 'zod';
import { chaveFonte } from './carrosseisFontes.js';
import { METRICAS_FONTES } from './carrosseisMetricas.gerada.js';

import type { RelatorioTime } from './carrosseisTime.js';

export { arquivoDaFonte, chaveFonte, FONTES_SLIDES, type FonteSlide } from './carrosseisFontes.js';

/*
 * Carrosséis do Instagram. O slide é montado por código (modelo + texto + cores + fontes da marca):
 * a IA de imagem, quando entra, só faz a foto ou o fundo, nunca o texto. Cada modelo vira uma árvore
 * de elementos (flexbox) que o servidor desenha com o Satori (o JPEG que vai para o Instagram) e o
 * navegador desenha como HTML (a prévia ao vivo): a mesma árvore, as mesmas fontes e os mesmos
 * tamanhos, calculados aqui com a largura medida de cada letra.
 */

export const LARGURA_SLIDE = 1080;
export const ALTURA_SLIDE = 1350;

/**
 * v144: o formato da peça. Feed (4:5, 1080 × 1350, o dos carrosséis) ou story (9:16, 1080 × 1920).
 * No story, o topo e a base guardam a área que o Instagram cobre (a barra do perfil em cima e a
 * caixa de resposta embaixo): o texto e a logo nunca ficam ali.
 */
export const FORMATOS_PECA = ['feed', 'story'] as const;
export type FormatoPeca = (typeof FORMATOS_PECA)[number];
export const FORMATO_PECA: Record<
  FormatoPeca,
  { nome: string; dica: string; largura: number; altura: number }
> = {
  feed: { nome: 'Feed 4:5', dica: '1080 × 1350, o post do feed', largura: 1080, altura: 1350 },
  story: { nome: 'Story 9:16', dica: '1080 × 1920, a tela cheia do story', largura: 1080, altura: 1920 },
};
export const alturaDoFormato = (f: FormatoPeca | null | undefined) => FORMATO_PECA[f ?? 'feed'].altura;
/** O Instagram aceita até 10 imagens por carrossel pela API (no app são 20). */
export const MAX_SLIDES = 10;
export const MAX_CARROSSEIS_CONTA = 500;
export const MAX_FOTOS_CONTA = 60;

/* ───────────────────────────── Estilos, fontes e modelos ───────────────────────────── */

export const ESTILOS = ['editorial', 'impacto', 'clean', 'foto', 'vivo'] as const;
export type EstiloCarrossel = (typeof ESTILOS)[number];
export const ESTILO: Record<EstiloCarrossel, { nome: string; descricao: string }> = {
  editorial: {
    nome: 'Editorial',
    descricao: 'Fundo claro, títulos com serifa, linhas finas e muito respiro.',
  },
  impacto: {
    nome: 'Impacto',
    descricao: 'Fundo na cor principal, títulos grandes e diretos, blocos de cor.',
  },
  clean: { nome: 'Clean', descricao: 'Fundo branco, limpo e moderno, cantos arredondados.' },
  foto: {
    nome: 'Foto',
    descricao: 'A foto conta a história: capa e fotos de ponta a ponta, texto por cima.',
  },
  vivo: {
    nome: 'Vivo',
    descricao:
      'O jeito da maioria das marcas: cor forte de fundo, foto de ponta a ponta, palavra-chave colorida, selo e botão.',
  },
};

export const PARES_FONTES = ['editorial', 'impacto', 'moderno', 'tecnologia', 'elegante'] as const;
export type ParFontes = (typeof PARES_FONTES)[number];

export interface FonteTitulo {
  familia: string;
  /** Peso dos títulos. */
  peso: number;
  /** Peso dos números grandes e das aspas. */
  pesoForte: number;
  caixaAlta: boolean;
  /** Espaço entre letras, em "em" (negativo aproxima). */
  espacamento: number;
  alturaLinha: number;
}
export interface FontesDoPar {
  nome: string;
  titulo: FonteTitulo;
  /** Texto corrido, rodapé e rótulos (pesos 400 a 700). */
  corpo: string;
  pesosCorpo: { texto: number; medio: number; forte: number };
}

export const FONTES_DO_PAR: Record<ParFontes, FontesDoPar> = {
  editorial: {
    nome: 'Fraunces + Inter (editorial)',
    titulo: {
      familia: 'Fraunces',
      peso: 600,
      pesoForte: 700,
      caixaAlta: false,
      espacamento: -0.01,
      alturaLinha: 1.06,
    },
    corpo: 'Inter',
    pesosCorpo: { texto: 400, medio: 500, forte: 700 },
  },
  impacto: {
    nome: 'Archivo + Inter (impacto)',
    titulo: {
      familia: 'Archivo',
      peso: 900,
      pesoForte: 900,
      caixaAlta: true,
      espacamento: -0.005,
      alturaLinha: 0.98,
    },
    corpo: 'Inter',
    pesosCorpo: { texto: 400, medio: 500, forte: 700 },
  },
  moderno: {
    nome: 'Plus Jakarta Sans + Inter (moderno)',
    titulo: {
      familia: 'Plus Jakarta Sans',
      peso: 800,
      pesoForte: 800,
      caixaAlta: false,
      espacamento: -0.012,
      alturaLinha: 1.08,
    },
    corpo: 'Inter',
    pesosCorpo: { texto: 400, medio: 500, forte: 700 },
  },
  tecnologia: {
    nome: 'Space Grotesk + Inter (tecnologia)',
    titulo: {
      familia: 'Space Grotesk',
      peso: 700,
      pesoForte: 700,
      caixaAlta: false,
      espacamento: -0.012,
      alturaLinha: 1.06,
    },
    corpo: 'Inter',
    pesosCorpo: { texto: 400, medio: 500, forte: 700 },
  },
  elegante: {
    nome: 'Playfair Display + Lato (elegante)',
    titulo: {
      familia: 'Playfair Display',
      peso: 700,
      pesoForte: 800,
      caixaAlta: false,
      espacamento: -0.01,
      alturaLinha: 1.1,
    },
    corpo: 'Lato',
    pesosCorpo: { texto: 400, medio: 700, forte: 700 },
  },
};

export const MODELOS = [
  'capa',
  'item',
  'texto',
  'lista',
  'numero',
  'citacao',
  'comparacao',
  'foto',
  'chamada',
  'camadas',
  'arte',
] as const;
export type ModeloSlide = (typeof MODELOS)[number];
/**
 * v150: os modelos montados por código (o time e o editor escolhem entre eles). A "Arte da IA" não
 * entra: ela nasce desenhada pela IA de imagem, a partir do texto aprovado.
 */
export const MODELOS_A_MAO = MODELOS.filter((m) => m !== 'arte' && m !== 'camadas') as Exclude<
  ModeloSlide,
  'arte' | 'camadas'
>[];

/**
 * v152: a peça "em camadas". A IA faz só o que não tem letra (a foto da empresa com o fundo tirado);
 * o texto, a cor e a logo são do sistema, como nos outros modelos. Duas composições: a foto ao lado
 * do texto ou embaixo dele.
 */
export const COMPOSICOES_CAMADAS = ['lado', 'base'] as const;
export type ComposicaoCamadas = (typeof COMPOSICOES_CAMADAS)[number];
export const ROTULO_COMPOSICAO: Record<ComposicaoCamadas, string> = {
  lado: 'Foto ao lado do texto',
  base: 'Foto embaixo do texto',
};

/** Campos que cada modelo usa, com o limite de letras que cabe bem no slide. */
export interface CampoModelo {
  campo: 'sobretitulo' | 'titulo' | 'texto' | 'destaque' | 'botao';
  rotulo: string;
  limite: number;
  dica?: string;
}
export const MODELO: Record<
  ModeloSlide,
  {
    nome: string;
    descricao: string;
    campos: CampoModelo[];
    itens?: { max: number; limite: number };
    colunas?: boolean;
    foto?: boolean;
  }
> = {
  capa: {
    nome: 'Capa',
    descricao: 'O primeiro slide: o gancho que faz parar de rolar.',
    campos: [
      { campo: 'sobretitulo', rotulo: 'Assunto (em cima)', limite: 32, dica: 'Ex.: COMERCIAL B2B' },
      { campo: 'titulo', rotulo: 'Título', limite: 90 },
      { campo: 'texto', rotulo: 'Subtítulo', limite: 110 },
    ],
    foto: true,
  },
  item: {
    nome: 'Item numerado',
    descricao: 'Um ponto de uma lista, com número grande.',
    campos: [
      { campo: 'destaque', rotulo: 'Número', limite: 4, dica: 'Ex.: 1, 02' },
      { campo: 'titulo', rotulo: 'Título', limite: 80 },
      { campo: 'texto', rotulo: 'Texto', limite: 220 },
    ],
  },
  texto: {
    nome: 'Texto',
    descricao: 'Uma ideia explicada em poucas linhas.',
    campos: [
      { campo: 'sobretitulo', rotulo: 'Assunto (em cima)', limite: 32 },
      { campo: 'titulo', rotulo: 'Título', limite: 70 },
      { campo: 'texto', rotulo: 'Texto', limite: 320 },
    ],
  },
  lista: {
    nome: 'Lista',
    descricao: 'Até 5 itens curtos num slide só.',
    campos: [
      { campo: 'sobretitulo', rotulo: 'Assunto (em cima)', limite: 32 },
      { campo: 'titulo', rotulo: 'Título', limite: 60 },
    ],
    itens: { max: 5, limite: 90 },
  },
  numero: {
    nome: 'Número grande',
    descricao: 'Um número, preço ou dado em destaque.',
    campos: [
      { campo: 'destaque', rotulo: 'Número ou preço', limite: 12, dica: 'Ex.: 3x, R$ 139,90, 2 horas' },
      { campo: 'titulo', rotulo: 'O que o número diz', limite: 70 },
      { campo: 'texto', rotulo: 'Texto', limite: 180 },
    ],
  },
  citacao: {
    nome: 'Citação',
    descricao: 'Uma frase forte, entre aspas.',
    campos: [
      { campo: 'titulo', rotulo: 'Frase', limite: 140 },
      { campo: 'texto', rotulo: 'Complemento ou autor', limite: 90 },
    ],
  },
  comparacao: {
    nome: 'Antes e depois',
    descricao: 'Dois lados lado a lado: o jeito comum e o certo.',
    campos: [{ campo: 'titulo', rotulo: 'Título', limite: 56 }],
    colunas: true,
  },
  foto: {
    nome: 'Foto',
    descricao: 'Uma foto da empresa (ou gerada) com uma frase.',
    campos: [
      { campo: 'titulo', rotulo: 'Título', limite: 60 },
      { campo: 'texto', rotulo: 'Texto', limite: 140 },
    ],
    foto: true,
  },
  camadas: {
    nome: 'Em camadas',
    descricao: 'A sua foto com o fundo tirado pela IA, sobre a cor da marca; o texto é escrito pelo sistema.',
    campos: [
      { campo: 'sobretitulo', rotulo: 'Selo', limite: 24 },
      { campo: 'destaque', rotulo: 'Número ou preço', limite: 16 },
      { campo: 'titulo', rotulo: 'Título', limite: 60 },
      { campo: 'texto', rotulo: 'Texto', limite: 90 },
      { campo: 'botao', rotulo: 'Botão', limite: 22 },
    ],
    foto: true,
  },
  arte: {
    nome: 'Arte da IA',
    descricao: 'A peça inteira desenhada pela IA de imagem, com o texto conferido letra por letra.',
    campos: [
      { campo: 'sobretitulo', rotulo: 'Selo', limite: 24 },
      { campo: 'destaque', rotulo: 'Número ou preço', limite: 16 },
      { campo: 'titulo', rotulo: 'Título', limite: 80 },
      { campo: 'texto', rotulo: 'Texto', limite: 140 },
      { campo: 'botao', rotulo: 'Botão', limite: 22 },
    ],
    foto: true,
  },
  chamada: {
    nome: 'Chamada final',
    descricao: 'O último slide: o que a pessoa deve fazer agora.',
    campos: [
      { campo: 'titulo', rotulo: 'Título', limite: 80 },
      { campo: 'botao', rotulo: 'Ação em destaque', limite: 30, dica: 'Ex.: Comente CHECKLIST' },
      { campo: 'texto', rotulo: 'Texto', limite: 90 },
    ],
  },
};

export const FUNDOS_SLIDE = ['auto', 'claro', 'escuro', 'destaque'] as const;
export type FundoSlide = (typeof FUNDOS_SLIDE)[number];
export const ROTULO_FUNDO: Record<FundoSlide, string> = {
  auto: 'Do estilo',
  claro: 'Claro',
  escuro: 'Cor principal',
  destaque: 'Cor de destaque',
};

/* ───────────────────────────── Entradas ───────────────────────────── */

const corHex = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use uma cor no formato #1a2b3c.')
  .transform((c) => c.toUpperCase());
const texto = (max: number) => z.string().trim().max(max, `Use até ${max} letras.`).default('');

export const identidadeCarrosselEntrada = z.object({
  cores: z.object({ principal: corHex, destaque: corHex, claro: corHex, texto: corHex }),
  fontes: z.enum(PARES_FONTES),
  estilo: z.enum(ESTILOS),
  /** Rodapé de cada slide (ex.: @empresa). */
  assinatura: texto(40),
  /** Nome escrito no lugar da logo, quando não há logo. */
  marcaTexto: texto(30),
  usarLogoDaMarca: z.boolean().default(true),
  logoNaCapa: z.boolean().default(true),
  logoNaChamada: z.boolean().default(true),
  numeroDoSlide: z.boolean().default(true),
  /* Como a empresa fala (o time de IA usa a partir da próxima etapa). */
  publico: texto(600),
  tom: texto(600),
  vende: texto(600),
  nuncaDizer: texto(400),
  pilares: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
  /** v148: como a empresa costuma postar (lido dos posts do Instagram dela; a pessoa pode editar). */
  jeitoDePostar: texto(1500),
});
export type IdentidadeCarrossel = z.infer<typeof identidadeCarrosselEntrada>;

export const IDENTIDADE_PADRAO: IdentidadeCarrossel = {
  cores: { principal: '#14213D', destaque: '#F2A541', claro: '#F6F1E9', texto: '#101828' },
  fontes: 'editorial',
  estilo: 'editorial',
  assinatura: '',
  marcaTexto: '',
  usarLogoDaMarca: true,
  logoNaCapa: true,
  logoNaChamada: true,
  numeroDoSlide: true,
  publico: '',
  tom: '',
  vende: '',
  nuncaDizer: '',
  pilares: [],
  jeitoDePostar: '',
};

/** Junta o que veio do banco com o padrão (campo novo ganha o padrão). */
export function identidadeCompleta(salvo: unknown): IdentidadeCarrossel {
  const o = salvo && typeof salvo === 'object' ? (salvo as Record<string, unknown>) : {};
  const cores = o.cores && typeof o.cores === 'object' ? (o.cores as Record<string, unknown>) : {};
  const r = identidadeCarrosselEntrada.safeParse({
    ...IDENTIDADE_PADRAO,
    ...o,
    cores: { ...IDENTIDADE_PADRAO.cores, ...cores },
  });
  return r.success ? r.data : IDENTIDADE_PADRAO;
}

export const slideEntrada = z.object({
  id: z.string().trim().min(1).max(40),
  modelo: z.enum(MODELOS),
  sobretitulo: texto(40),
  titulo: texto(160),
  texto: texto(400),
  destaque: texto(24),
  botao: texto(40),
  itens: z.array(z.string().trim().max(120)).max(5).default([]),
  colunas: z
    .array(z.object({ rotulo: texto(24), texto: texto(160) }))
    .max(2)
    .default([]),
  fotoId: z.number().int().positive().nullable().default(null),
  fundo: z.enum(FUNDOS_SLIDE).default('auto'),
  /** v152: só no modelo "Em camadas" (sem valor: a foto ao lado do texto). */
  composicao: z.enum(COMPOSICOES_CAMADAS).optional(),
});
export type SlideCarrossel = z.infer<typeof slideEntrada>;

export const SITUACOES_CARROSSEL = ['rascunho', 'pronto', 'agendado', 'publicado', 'falhou'] as const;
export type SituacaoCarrossel = (typeof SITUACOES_CARROSSEL)[number];
export const ROTULO_SITUACAO_CARROSSEL: Record<SituacaoCarrossel, string> = {
  rascunho: 'Rascunho',
  pronto: 'Pronto',
  agendado: 'Agendado',
  publicado: 'Publicado',
  falhou: 'Não publicou',
};

export const carrosselEntrada = z.object({
  titulo: z.string().trim().min(1, 'Dê um nome ao carrossel.').max(120),
  estilo: z.enum(ESTILOS),
  slides: z
    .array(slideEntrada)
    .min(1, 'O carrossel precisa de pelo menos um slide.')
    .max(MAX_SLIDES, `Até ${MAX_SLIDES} slides.`),
  legenda: z.string().max(2200, 'A legenda do Instagram vai até 2.200 letras.').default(''),
  situacao: z.enum(['rascunho', 'pronto']).default('rascunho'),
  /** Versão que a tela editou (outra pessoa salvou no meio: 409). */
  versao: z.number().int().min(1).optional(),
});
export type CarrosselEntrada = z.infer<typeof carrosselEntrada>;

export const carrosselNovoEntrada = z.object({
  titulo: z.string().trim().min(1, 'Dê um nome ao carrossel.').max(120),
  estilo: z.enum(ESTILOS).optional(),
  /** Começa do modelo pronto (capa, itens e chamada) ou de uma capa só. */
  comeco: z.enum(['roteiro', 'capa']).default('roteiro'),
});

export interface ResumoCarrossel {
  id: number;
  titulo: string;
  estilo: EstiloCarrossel;
  situacao: SituacaoCarrossel;
  slides: number;
  versao: number;
  /** Montado à mão ou pelo time de IA. */
  origem: 'manual' | 'ia';
  /** v144: carrossel ou card avulso (um slide só), no feed ou no story. */
  tipo: 'carrossel' | 'card';
  formato: FormatoPeca;
  /** v144: o card avulso: o pedido de onde saiu, o número do card e da variação, se é a escolhida. */
  pedidoId: number | null;
  card: number | null;
  variacao: number | null;
  escolhido: boolean;
  /** Avisos do revisor esperando alguém decidir. */
  avisosAbertos: number;
  criadoEm: string;
  atualizadoEm: string;
  criadoPor: string | null;
  /** A regra do Comente e receba (null: o carrossel não tem). */
  publicacao: {
    palavra: string | null;
    esperando: boolean;
    ligada: boolean;
    comentaram: number;
    leads: number;
    publicadoEm: string | null;
  } | null;
}
export interface Carrossel extends ResumoCarrossel {
  conteudo: SlideCarrossel[];
  legenda: string;
  /** O que o time de IA deixou: o porquê das escolhas e o que falta decidir (null: feito à mão). */
  relatorio: RelatorioTime | null;
}

/** De onde a foto veio (v132): enviada pela empresa ou feita pela IA (cena nova ou o produto num cenário). */
export type OrigemFoto =
  | 'enviada'
  | 'gerada'
  | 'cenario'
  | 'referencia'
  | 'melhorada'
  | 'arte'
  /** v152: a foto da empresa com o fundo tirado (PNG transparente), a camada da peça "Em camadas". */
  | 'recorte';
/** As origens que não são fotos da biblioteca (não aparecem para escolher num slide). */
export const ORIGENS_FORA_DA_BIBLIOTECA: OrigemFoto[] = ['referencia', 'arte', 'recorte'];

export interface FotoCarrossel {
  id: number;
  nome: string;
  largura: number;
  altura: number;
  criadoEm: string;
  /** v132 (fotos antigas: 'enviada'). */
  origem?: OrigemFoto;
  /** O cenário: a foto do produto de onde saiu. */
  baseFotoId?: number | null;
}

/** Slide novo de um modelo, já com um texto de exemplo para a pessoa trocar. */
export function slideNovo(modelo: ModeloSlide, id: string): SlideCarrossel {
  const base: SlideCarrossel = {
    id,
    modelo,
    sobretitulo: '',
    titulo: '',
    texto: '',
    destaque: '',
    botao: '',
    itens: [],
    colunas: [],
    fotoId: null,
    fundo: 'auto',
  };
  switch (modelo) {
    case 'capa':
      return { ...base, sobretitulo: 'Assunto', titulo: 'O título que faz a pessoa parar de rolar' };
    case 'item':
      return {
        ...base,
        destaque: '1',
        titulo: 'O primeiro ponto, dito em uma frase',
        texto: 'Explique em duas ou três linhas.',
      };
    case 'texto':
      return {
        ...base,
        titulo: 'Uma ideia por slide',
        texto: 'Explique em poucas linhas, com um exemplo concreto.',
      };
    case 'lista':
      return {
        ...base,
        titulo: 'O que você precisa saber',
        itens: ['Primeiro item', 'Segundo item', 'Terceiro item'],
      };
    case 'numero':
      return { ...base, destaque: '3x', titulo: 'O que esse número quer dizer' };
    case 'citacao':
      return { ...base, titulo: 'Uma frase forte, que vale um print.' };
    case 'comparacao':
      return {
        ...base,
        titulo: 'Como é hoje e como deveria ser',
        colunas: [
          { rotulo: 'Hoje', texto: 'O jeito comum de fazer.' },
          { rotulo: 'O certo', texto: 'O jeito que dá resultado.' },
        ],
      };
    case 'foto':
      return { ...base, titulo: 'Uma frase sobre a foto' };
    case 'arte':
      return { ...base, titulo: 'O título da arte' };
    case 'camadas':
      return { ...base, titulo: 'O título da peça' };
    case 'chamada':
      return {
        ...base,
        titulo: 'Gostou? Salve para ver depois',
        botao: 'Comente QUERO',
        texto: 'A gente te manda no direct.',
      };
  }
}

/** O roteiro de partida de um carrossel novo: capa, três itens e a chamada final. */
export function roteiroInicial(): SlideCarrossel[] {
  return [
    slideNovo('capa', 's1'),
    { ...slideNovo('item', 's2'), destaque: '1' },
    { ...slideNovo('item', 's3'), destaque: '2', titulo: 'O segundo ponto, dito em uma frase' },
    { ...slideNovo('item', 's4'), destaque: '3', titulo: 'O terceiro ponto, dito em uma frase' },
    slideNovo('chamada', 's5'),
  ];
}

/* ───────────────────────────── Cores e leitura ───────────────────────────── */

const rgb = (hex: string): [number, number, number] => {
  const c = hex.replace('#', '');
  return [0, 2, 4].map((i) => Number.parseInt(c.slice(i, i + 2), 16)) as [number, number, number];
};
const hexDe = (r: number, g: number, b: number) =>
  `#${[r, g, b]
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`.toUpperCase();

/** Mistura duas cores (t = quanto da segunda: 0 = só a primeira). */
export function misturar(a: string, b: string, t: number): string {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return hexDe(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

function luminancia(hex: string): number {
  const canal = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb(hex);
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

/** Contraste WCAG entre duas cores (1 a 21). Texto normal pede 4,5; texto grande, 3. */
export function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const BRANCO = '#FFFFFF';
const PRETO = '#111111';
const escuro = (hex: string) => luminancia(hex) < 0.22;

/** A cor puxada para o preto (fundo claro) ou para o branco (fundo escuro) até dar a leitura pedida. */
export function ajustarParaLer(cor: string, fundo: string, alvo: number): string {
  if (contraste(cor, fundo) >= alvo) return cor;
  const para = escuro(fundo) ? BRANCO : PRETO;
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const c = misturar(cor, para, t);
    if (contraste(c, fundo) >= alvo) return c;
  }
  return para;
}

/** A primeira das opções que dá a leitura pedida (senão, preto ou branco, o que ler melhor). */
function primeiraQueLe(fundo: string, alvo: number, ...opcoes: string[]): string {
  for (const o of opcoes) if (contraste(o, fundo) >= alvo) return o;
  return contraste(BRANCO, fundo) >= contraste(PRETO, fundo) ? BRANCO : PRETO;
}

/** As cores de um tipo de fundo: tudo o que vai em cima dele já com a leitura conferida. */
export interface CoresDoFundo {
  fundo: string;
  texto: string;
  /** Texto de apoio (um pouco mais suave, ainda ≥ 4,5). */
  suave: string;
  /** Números grandes e aspas (≥ 3, texto grande). */
  acento: string;
  /** Rótulos pequenos na cor de destaque (≥ 4,5). */
  acentoTexto: string;
  linha: string;
  cartao: string;
  cartaoTexto: string;
  botaoFundo: string;
  botaoTexto: string;
}
export type TipoFundo = 'claro' | 'escuro' | 'branco' | 'destaque';

export interface Paleta {
  claro: CoresDoFundo;
  escuro: CoresDoFundo;
  branco: CoresDoFundo;
  destaque: CoresDoFundo;
  /** O que foi ajustado para dar leitura (a tela mostra). */
  ajustes: string[];
}

/** Fundo de cartão um pouco diferente do fundo, sem perder a leitura do texto por cima. */
function cartaoSobre(fundo: string, texto: string): string {
  for (const [para, t] of [
    [texto, 0.09],
    [texto, 0.05],
    [escuro(fundo) ? PRETO : BRANCO, 0.12],
    [escuro(fundo) ? PRETO : BRANCO, 0.06],
  ] as const) {
    const c = misturar(fundo, para, t);
    if (contraste(texto, c) >= 4.5) return c;
  }
  return fundo;
}

/** Acento sobre um fundo: o destaque como está; se não lê, ele mais escuro/claro; se mudar demais, a principal. */
function acentoSobre(destaque: string, principal: string, fundo: string, alvo: number): string {
  if (contraste(destaque, fundo) >= alvo) return destaque;
  const ajustado = ajustarParaLer(destaque, fundo, alvo);
  const mudouPouco = contraste(ajustado, destaque) < 2.2;
  if (mudouPouco) return ajustado;
  return contraste(principal, fundo) >= alvo ? principal : ajustado;
}

export function paletaDaIdentidade(cores: IdentidadeCarrossel['cores']): Paleta {
  const { principal: P, destaque: D, claro: C, texto: T } = cores;
  const ajustes: string[] = [];

  const sobreClaro = (fundo: string): CoresDoFundo => {
    const texto = contraste(T, fundo) >= 7 ? T : contraste(P, fundo) >= 7 ? P : ajustarParaLer(T, fundo, 7);
    const suave = primeiraQueLe(
      fundo,
      4.5,
      misturar(texto, fundo, 0.28),
      misturar(texto, fundo, 0.15),
      texto,
    );
    const botaoFundo = escuro(P) ? P : ajustarParaLer(P, BRANCO, 4.5);
    return {
      fundo,
      texto,
      suave,
      acento: acentoSobre(D, P, fundo, 3),
      acentoTexto: acentoSobre(D, P, fundo, 4.5),
      linha: misturar(texto, fundo, 0.78),
      cartao: cartaoSobre(fundo, texto),
      cartaoTexto: texto,
      botaoFundo,
      botaoTexto: primeiraQueLe(botaoFundo, 4.5, C, BRANCO),
    };
  };

  // Fundo na cor principal com texto claro por cima: precisa ler bem com branco (≥ 4,5).
  const fundoEscuro = contraste(P, BRANCO) >= 4.5 ? P : ajustarParaLer(P, BRANCO, 4.5);
  if (fundoEscuro !== P)
    ajustes.push('A cor principal ficou mais escura nos fundos, para o texto claro ler bem.');
  const textoEscuro = primeiraQueLe(fundoEscuro, 7, C, BRANCO);
  const escuroCores: CoresDoFundo = {
    fundo: fundoEscuro,
    texto: textoEscuro,
    suave: primeiraQueLe(
      fundoEscuro,
      4.5,
      misturar(textoEscuro, fundoEscuro, 0.25),
      misturar(textoEscuro, fundoEscuro, 0.12),
      textoEscuro,
    ),
    acento: acentoSobre(D, C, fundoEscuro, 3),
    acentoTexto: acentoSobre(D, C, fundoEscuro, 4.5),
    linha: misturar(textoEscuro, fundoEscuro, 0.72),
    cartao: cartaoSobre(fundoEscuro, textoEscuro),
    cartaoTexto: textoEscuro,
    botaoFundo: D,
    botaoTexto: primeiraQueLe(D, 4.5, fundoEscuro, T, PRETO, BRANCO),
  };

  const textoDestaque = primeiraQueLe(D, 4.5, P, T, PRETO, BRANCO);
  const destaqueCores: CoresDoFundo = {
    fundo: D,
    texto: textoDestaque,
    suave: primeiraQueLe(D, 4.5, misturar(textoDestaque, D, 0.18), textoDestaque),
    acento: textoDestaque,
    acentoTexto: textoDestaque,
    linha: misturar(textoDestaque, D, 0.7),
    cartao: cartaoSobre(D, textoDestaque),
    cartaoTexto: textoDestaque,
    botaoFundo: primeiraQueLe(D, 3, fundoEscuro, PRETO),
    botaoTexto: primeiraQueLe(primeiraQueLe(D, 3, fundoEscuro, PRETO), 4.5, C, BRANCO),
  };

  const claroCores = sobreClaro(C);
  if (contraste(D, C) < 3)
    ajustes.push('O destaque ficou mais escuro nos números sobre o fundo claro, para dar leitura.');
  if (contraste(T, C) < 4.5) ajustes.push('O texto ficou mais escuro sobre o fundo claro, para dar leitura.');
  return {
    claro: claroCores,
    escuro: escuroCores,
    branco: sobreClaro(BRANCO),
    destaque: destaqueCores,
    ajustes,
  };
}

/* ───────────────────────────── Medir e caber o texto ───────────────────────────── */

export interface FonteMedida {
  familia: string;
  peso: number;
  caixaAlta?: boolean;
  /** Espaço entre letras, em "em". */
  espacamento?: number;
}

const semAcento = (c: string) => c.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Largura de uma linha de texto, em px, com a largura medida de cada letra. */
export function larguraTexto(t: string, f: FonteMedida, tamanho: number): number {
  const tabela = METRICAS_FONTES[chaveFonte(f.familia, f.peso)] ?? METRICAS_FONTES['Inter 400']!;
  const larga = tabela.m ?? 0.9;
  const s = f.caixaAlta ? t.toLocaleUpperCase('pt-BR') : t;
  let em = 0;
  for (const c of s) em += tabela[c] ?? tabela[semAcento(c)] ?? larga;
  return em * tamanho + (f.espacamento ?? 0) * tamanho * [...s].length;
}

/** Em quantas linhas o texto quebra numa largura (quebra nas palavras, como o navegador e o Satori). */
export function contarLinhas(t: string, f: FonteMedida, tamanho: number, largura: number): number {
  let total = 0;
  for (const paragrafo of t.split('\n')) {
    const palavras = paragrafo.split(/\s+/).filter(Boolean);
    if (!palavras.length) {
      total += 1;
      continue;
    }
    const espaco = larguraTexto(' ', f, tamanho);
    let linhas = 1;
    let atual = 0;
    for (const p of palavras) {
      const w = larguraTexto(p, f, tamanho);
      // Palavra maior que a linha: quebra no meio dela.
      if (w > largura) {
        if (atual > 0) linhas += 1;
        linhas += Math.ceil(w / largura) - 1;
        atual = w % largura;
        continue;
      }
      const com = atual === 0 ? w : atual + espaco + w;
      if (com > largura) {
        linhas += 1;
        atual = w;
      } else atual = com;
    }
    total += linhas;
  }
  return total;
}

/** Um bloco de texto que disputa a altura do slide com os outros. */
export interface BlocoTexto {
  id: string;
  texto: string;
  fonte: FonteMedida;
  largura: number;
  min: number;
  max: number;
  alturaLinha: number;
  /** Espaço antes do bloco (px). */
  antes: number;
  /** Quanto o bloco resiste a diminuir (maior = diminui por último). */
  peso?: number;
}

export interface Ajuste {
  tamanhos: Record<string, number>;
  /** Coube tudo no tamanho mínimo? (Não: o texto está longo demais para o slide.) */
  cabe: boolean;
  altura: number;
}

const alturaBloco = (b: BlocoTexto, tamanho: number) =>
  b.texto ? b.antes + contarLinhas(b.texto, b.fonte, tamanho, b.largura) * tamanho * b.alturaLinha : 0;

/**
 * Tamanho de cada bloco para tudo caber na altura: começa no maior e vai diminuindo, de 2 em 2 px,
 * o bloco que está mais longe do mínimo (o título resiste mais que o texto).
 */
export function caberBlocos(blocos: BlocoTexto[], alturaDisponivel: number): Ajuste {
  const tamanhos: Record<string, number> = Object.fromEntries(blocos.map((b) => [b.id, b.max]));
  const total = () => blocos.reduce((s, b) => s + alturaBloco(b, tamanhos[b.id]!), 0);
  let altura = total();
  for (let volta = 0; altura > alturaDisponivel && volta < 400; volta++) {
    const candidatos = blocos.filter((b) => b.texto && tamanhos[b.id]! > b.min);
    if (!candidatos.length) break;
    const folga = (b: BlocoTexto) => (tamanhos[b.id]! - b.min) / Math.max(1, b.max - b.min) / (b.peso ?? 1);
    const alvo = candidatos.reduce((a, b) => (folga(b) > folga(a) ? b : a));
    tamanhos[alvo.id] = Math.max(alvo.min, tamanhos[alvo.id]! - 2);
    altura = total();
  }
  return { tamanhos, cabe: altura <= alturaDisponivel, altura };
}

/** Emoji e símbolos fora das fontes dos slides (não aparecem na imagem). */
const FORA_DA_FONTE = /(?:\p{Extended_Pictographic}|\u{FE0F}|\u{200D}|[\u2190\u2192\u2794\u27A1])/gu;
export function textoForaDaFonte(t: string): boolean {
  FORA_DA_FONTE.lastIndex = 0;
  return FORA_DA_FONTE.test(t);
}
/** Limpa o que a fonte não desenha (setas viram ›; emoji sai). */
export function limparParaSlide(t: string): string {
  return t
    .replace(/[→➔➡]/g, '›')
    .replace(/←/g, '‹')
    .replace(FORA_DA_FONTE, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/* ───────────────────────────── A árvore do slide ───────────────────────────── */

/** Elemento do slide, no formato que o Satori lê (e que o navegador vira HTML). */
export interface No {
  type: 'div' | 'img' | 'svg' | 'path' | 'span';
  props: {
    style?: Record<string, string | number>;
    children?: (No | string)[] | No | string;
    src?: string;
    width?: number;
    height?: number;
    viewBox?: string;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    strokeLinecap?: string;
    strokeLinejoin?: string;
    d?: string;
  };
}

type Estilo = Record<string, string | number>;
const div = (style: Estilo, ...children: (No | string | null | false | undefined)[]): No => ({
  type: 'div',
  props: {
    style: { display: 'flex', ...style },
    children: children.filter((c): c is No | string => c != null && c !== false && c !== ''),
  },
});

/** Logo já pronta para ir no slide (data URL no servidor, endereço no navegador). */
export interface LogoSlide {
  src: string;
  largura: number;
  altura: number;
}

export interface EntradaMontar {
  slide: SlideCarrossel;
  indice: number;
  total: number;
  identidade: IdentidadeCarrossel;
  estilo: EstiloCarrossel;
  /** Foto do slide (data URL no servidor, endereço no navegador). */
  foto?: string | null;
  /** Logo para fundo claro e para fundo escuro (a que existir serve para os dois). */
  logoClaro?: LogoSlide | null;
  logoEscuro?: LogoSlide | null;
  /** v144: feed (padrão) ou story. */
  formato?: FormatoPeca;
  /** v152: o tamanho da foto (no modelo "Em camadas", o recorte encosta na base sem sobrar espaço). */
  fotoMedidas?: { largura: number; altura: number } | null;
}

export interface SlideMontado {
  no: No;
  /** Avisos para quem edita (texto longo demais, emoji que não aparece, foto faltando). */
  avisos: string[];
}

interface Tema {
  base: TipoFundo;
  citacao: TipoFundo;
  chamada: TipoFundo;
  capa: 'meio' | 'base';
  divisor: 'linha' | 'barra' | 'nenhum';
  cartoes: 'nenhum' | 'cheio' | 'borda';
  cantos: number;
  /** Foto ocupa o slide todo (com o texto numa caixa por cima) ou fica num quadro. */
  fotoCheia: boolean;
  /** v148: o rótulo de cima vira um selo (fundo na cor de destaque). */
  selo?: boolean;
}

const TEMAS: Record<EstiloCarrossel, Tema> = {
  editorial: {
    base: 'claro',
    citacao: 'escuro',
    chamada: 'destaque',
    capa: 'meio',
    divisor: 'linha',
    cartoes: 'nenhum',
    cantos: 0,
    fotoCheia: false,
  },
  impacto: {
    base: 'escuro',
    citacao: 'claro',
    chamada: 'destaque',
    capa: 'base',
    divisor: 'barra',
    cartoes: 'cheio',
    cantos: 0,
    fotoCheia: true,
  },
  clean: {
    base: 'branco',
    citacao: 'claro',
    chamada: 'escuro',
    capa: 'meio',
    divisor: 'barra',
    cartoes: 'borda',
    cantos: 28,
    fotoCheia: false,
  },
  foto: {
    base: 'branco',
    citacao: 'escuro',
    chamada: 'destaque',
    capa: 'base',
    divisor: 'barra',
    cartoes: 'cheio',
    cantos: 20,
    fotoCheia: true,
  },
  vivo: {
    base: 'escuro',
    citacao: 'destaque',
    chamada: 'destaque',
    capa: 'base',
    divisor: 'nenhum',
    cartoes: 'cheio',
    cantos: 24,
    fotoCheia: true,
    selo: true,
  },
};

/* Medidas do quadro (1080 × 1350 no feed; 1080 × 1920 no story). */
const LADO = 96;
const MIOLO = LARGURA_SLIDE - LADO * 2;
const RODAPE = 34;
const ESPACO_RODAPE = 40;

interface Medidas {
  largura: number;
  altura: number;
  topo: number;
  base: number;
  /** Altura que sobra para o conteúdo entre o topo e o rodapé. */
  conteudo: number;
  /** O que o formato tem a mais que o feed (0 no feed): fotos e quadros crescem com isso. */
  extra: number;
}

function medidasDo(formato: FormatoPeca): Medidas {
  const { largura, altura } = FORMATO_PECA[formato];
  // Story: 250 px em cima (perfil e barra de progresso) e 300 embaixo (caixa de resposta).
  const topo = formato === 'story' ? 250 : 100;
  const base = formato === 'story' ? 300 : 84;
  return {
    largura,
    altura,
    topo,
    base,
    conteudo: altura - topo - base - RODAPE - ESPACO_RODAPE,
    extra: altura - ALTURA_SLIDE - (topo - 100) - (base - 84),
  };
}

/** As medidas do slide que está sendo montado (o montarSlide é síncrono: uma de cada vez). */
let M: Medidas = medidasDo('feed');

interface Contexto {
  s: SlideCarrossel;
  indice: number;
  total: number;
  id: IdentidadeCarrossel;
  tema: Tema;
  par: FontesDoPar;
  cores: CoresDoFundo;
  tipoFundo: TipoFundo;
  foto: string | null;
  fotoMedidas: { largura: number; altura: number } | null;
  logo: LogoSlide | null;
  avisos: string[];
}

const fonteTitulo = (c: Contexto, forte = false): FonteMedida => ({
  familia: c.par.titulo.familia,
  peso: forte ? c.par.titulo.pesoForte : c.par.titulo.peso,
  caixaAlta: c.par.titulo.caixaAlta,
  espacamento: c.par.titulo.espacamento,
});
const fonteCorpo = (c: Contexto, peso: 'texto' | 'medio' | 'forte' = 'texto'): FonteMedida => ({
  familia: c.par.corpo,
  peso: c.par.pesosCorpo[peso],
});

/** Estilo do texto (fonte, tamanho, linha) a partir da fonte medida. */
const estiloTexto = (f: FonteMedida, tamanho: number, alturaLinha: number, cor: string): Estilo => ({
  fontFamily: f.familia,
  fontWeight: f.peso,
  fontSize: tamanho,
  lineHeight: alturaLinha,
  color: cor,
  ...(f.caixaAlta ? { textTransform: 'uppercase' } : {}),
  ...(f.espacamento ? { letterSpacing: Math.round(f.espacamento * tamanho * 100) / 100 } : {}),
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
});

const textoNo = (
  t: string,
  f: FonteMedida,
  tamanho: number,
  alturaLinha: number,
  cor: string,
  extra: Estilo = {},
) => div({ ...estiloTexto(f, tamanho, alturaLinha, cor), ...extra }, t);

/** A cor da palavra marcada: o destaque; no fundo da cor de destaque, a principal (ou a que ler). */
const corDoRealce = (c: Contexto) => (c.tipoFundo === 'destaque' ? c.cores.botaoFundo : c.cores.acento);

/** v148: o título com *palavras marcadas* (a marca some; a palavra fica na cor de destaque). */
export const semMarcas = (t: string) => t.replace(/\*/g, '');

function tituloNo(
  c: Contexto,
  t: string,
  f: FonteMedida,
  tamanho: number,
  alturaLinha: number,
  cor: string,
  extra: Estilo = {},
): No {
  const partes = t.split(/\*([^*\n]+)\*/g);
  if (partes.length < 3) return textoNo(semMarcas(t), f, tamanho, alturaLinha, cor, extra);
  // Satori e o navegador escrevem os pedaços em linha quando a caixa é "block".
  const filhos = partes
    .map((p, i) =>
      i % 2 === 1
        ? ({ type: 'span', props: { style: { color: corDoRealce(c) }, children: p } } as No)
        : semMarcas(p),
    )
    .filter((p) => p !== '');
  return {
    type: 'div',
    props: {
      style: { ...estiloTexto(f, tamanho, alturaLinha, cor), ...extra, display: 'block' },
      children: filhos,
    },
  };
}

/** Rótulo pequeno em caixa alta, na cor de destaque (no estilo Vivo, um selo). */
function sobretituloNo(c: Contexto, t: string, cor = c.cores.acentoTexto): No | null {
  if (!t) return null;
  if (c.tema.selo) {
    const fundo = c.tipoFundo === 'destaque' ? c.cores.botaoFundo : c.cores.acento;
    return div(
      {
        padding: '12px 26px',
        backgroundColor: fundo,
        borderRadius: 999,
        alignSelf: 'flex-start',
        flexShrink: 0,
      },
      textoNo(t, fonteCorpo(c, 'forte'), 26, 1.1, primeiraQueLe(fundo, 4.5, BRANCO, c.cores.fundo, PRETO), {
        letterSpacing: 2.4,
        textTransform: 'uppercase',
      }),
    );
  }
  return textoNo(t, fonteCorpo(c, 'forte'), 26, 1.2, cor, { letterSpacing: 3.6, textTransform: 'uppercase' });
}

/** Card avulso (peça de um slide só): a logo salva vai sempre, e o botão da ação também. */
const sozinho = (c: Contexto) => c.total <= 1;
const ALTURA_BOTAO_CARD = 38 * 1.2 + 52 + 48;

function botaoNo(c: Contexto, marginTop = 48): No | null {
  if (!c.s.botao) return null;
  return div(
    {
      marginTop,
      alignSelf: 'flex-start',
      padding: '24px 40px',
      backgroundColor: c.cores.botaoFundo,
      borderRadius: c.tema.cantos ? 999 : 0,
      flexShrink: 0,
    },
    textoNo(c.s.botao, fonteCorpo(c, 'forte'), 38, 1.2, c.cores.botaoTexto),
  );
}

/** O botão do card nos modelos que não são a chamada (no carrossel, o botão fica só na chamada). */
const botaoDoCard = (c: Contexto) => (sozinho(c) && c.s.modelo !== 'chamada' ? botaoNo(c) : null);
/** v149: nos modelos sem a logo no topo, o card guarda o lugar da logo grande do canto. */
const reservaDaLogo = (c: Contexto) =>
  sozinho(c) && c.s.modelo !== 'capa' && c.s.modelo !== 'chamada' ? ALTURA_LOGO_CARD : 0;
const reservaDoBotao = (c: Contexto) =>
  (sozinho(c) && c.s.modelo !== 'chamada' && c.s.botao ? ALTURA_BOTAO_CARD : 0) + reservaDaLogo(c);

/** A logo por cima, no canto, para os modelos que não têm a logo no topo. */
function logoNoCanto(c: Contexto): No | null {
  if (!sozinho(c)) return null;
  const l = logoNo(c, ALTURA_LOGO_CARD);
  if (!l) return null;
  return div(
    {
      position: 'absolute',
      top: M.topo - 24,
      right: LADO,
      alignItems: 'center',
      height: ALTURA_LOGO_CARD + 8,
    },
    l,
  );
}

/** v149: no card avulso a logo é a assinatura da peça: grande o bastante para ser vista no feed. */
const ALTURA_LOGO_CARD = 104;

function logoNo(c: Contexto, altura = 52): No | null {
  if (c.logo) {
    const largura = Math.min(
      altura > 60 ? 460 : 300,
      Math.round((c.logo.largura / Math.max(1, c.logo.altura)) * altura),
    );
    return {
      type: 'img',
      props: {
        src: c.logo.src,
        width: largura,
        height: altura,
        style: { width: largura, height: altura, objectFit: 'contain' },
      },
    };
  }
  const nome = c.id.marcaTexto.trim();
  if (!nome) return null;
  return textoNo(nome, fonteCorpo(c, 'forte'), altura > 60 ? 44 : 28, 1.1, c.cores.texto, {
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  });
}

function setaNo(cor: string): No {
  return {
    type: 'svg',
    props: {
      width: 30,
      height: 30,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: cor,
      strokeWidth: 2.4,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      style: { width: 30, height: 30 },
      children: [
        { type: 'path', props: { d: 'M5 12h14' } },
        { type: 'path', props: { d: 'm12 5 7 7-7 7' } },
      ],
    },
  };
}

function rodapeNo(
  c: Contexto,
  opcoes: { seta?: boolean; numero?: boolean; cor?: string; linha?: boolean } = {},
): No {
  const cor = opcoes.cor ?? c.cores.suave;
  // Peça de um slide só (card avulso): sem "Arraste", sem 1/1 e sem a assinatura solta no pé (a logo
  // grande no topo já assina a peça).
  const sozinho = c.total <= 1;
  const assinatura = sozinho ? '' : c.id.assinatura.trim();
  const direita = sozinho
    ? null
    : opcoes.seta
      ? div(
          { alignItems: 'center', gap: 10 },
          textoNo('Arraste', fonteCorpo(c, 'forte'), 24, 1, c.cores.acentoTexto),
          setaNo(c.cores.acentoTexto),
        )
      : opcoes.numero !== false && c.id.numeroDoSlide
        ? textoNo(`${c.indice + 1}/${c.total}`, fonteCorpo(c, 'medio'), 24, 1, cor)
        : null;
  const espaco = opcoes.linha ? 28 : ESPACO_RODAPE;
  return div(
    {
      flexShrink: 0,
      marginTop: opcoes.linha ? ESPACO_RODAPE - 12 : 0,
      paddingTop: espaco,
      ...(opcoes.linha ? { borderTop: `2px solid ${c.cores.texto}` } : {}),
      height: espaco + RODAPE,
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
    },
    assinatura ? textoNo(assinatura, fonteCorpo(c, 'medio'), 24, 1, cor) : div({}),
    direita ?? div({}),
  );
}

const ALINHAR = { inicio: 'flex-start', centro: 'center', fim: 'flex-end', entre: 'space-between' } as const;

/**
 * O quadro do slide: fundo, margens, o corpo (que cresce e ocupa o meio) e o rodapé embaixo.
 * `atras` fica por baixo de tudo (a foto de ponta a ponta e o véu).
 */
function quadro(
  c: Contexto,
  partes: {
    corpo: (No | string | null | false | undefined)[];
    alinhar?: keyof typeof ALINHAR;
    rodape?: No | null;
    atras?: No[];
    /** O modelo já põe a logo no topo (capa, chamada). */
    comLogo?: boolean;
    /** v149: o modelo já põe o botão junto do texto (capa do card). */
    comBotao?: boolean;
  },
): No {
  // O quadro cresce dentro da raiz (flexGrow): com altura fixa ou 100%, o Satori soma o espaçamento
  // por fora e o rodapé sai do slide.
  return div(
    { width: M.largura, height: M.altura, flexDirection: 'column' },
    div(
      {
        flexDirection: 'column',
        flexGrow: 1,
        padding: `${M.topo}px ${LADO}px ${M.base}px`,
        backgroundColor: c.cores.fundo,
        color: c.cores.texto,
        position: 'relative',
        overflow: 'hidden',
      },
      ...(partes.atras ?? []),
      partes.comLogo ? null : logoNoCanto(c),
      div(
        {
          flexDirection: 'column',
          flexGrow: 1,
          // Se o texto passar da conta, o corpo encolhe (e corta) em vez de empurrar o rodapé para fora.
          flexShrink: 1,
          minHeight: 0,
          overflow: 'hidden',
          justifyContent: ALINHAR[partes.alinhar ?? 'centro'],
          position: 'relative',
          width: '100%',
          paddingTop: partes.comLogo ? 0 : reservaDaLogo(c),
        },
        ...partes.corpo,
        partes.comBotao ? null : botaoDoCard(c),
      ),
      partes.rodape ?? null,
    ),
  );
}

function divisorNo(c: Contexto, cor = c.cores.texto): No | null {
  if (c.tema.divisor === 'nenhum') return null;
  return c.tema.divisor === 'linha'
    ? div({ width: 72, height: 3, backgroundColor: cor })
    : div({ width: 88, height: 10, backgroundColor: c.cores.acento, borderRadius: c.tema.cantos ? 5 : 0 });
}

const imagemCheia = (src: string): No => ({
  type: 'img',
  props: {
    src,
    width: M.largura,
    height: M.altura,
    style: {
      position: 'absolute',
      top: 0,
      left: 0,
      width: M.largura,
      height: M.altura,
      objectFit: 'cover',
    },
  },
});

/** Foto de ponta a ponta, com o véu da cor principal para o texto ler por cima. */
function fotoCheiaNo(c: Contexto, src: string): No[] {
  const cor = c.cores.fundo;
  return [
    imagemCheia(src),
    div({
      position: 'absolute',
      top: 0,
      left: 0,
      width: M.largura,
      height: M.altura,
      // v149: a foto aparece limpa em cima; a partir do meio vira a cor da marca, sólida onde mora o texto.
      backgroundImage: `linear-gradient(180deg, ${cor}80 0%, ${cor}00 16%, ${cor}00 32%, ${cor}CC 48%, ${cor}F7 58%, ${cor} 72%, ${cor} 100%)`,
    }),
  ];
}

const alturaLinhaTexto = 1.45;

/* ── Modelos ── */

function capa(c: Contexto): No {
  const { s } = c;
  const comFoto = !!c.foto && c.tema.fotoCheia;
  const naBase = c.tema.capa === 'base' || comFoto;
  const topo = div(
    {
      width: '100%',
      justifyContent: 'space-between',
      alignItems: 'center',
      minHeight: sozinho(c) ? ALTURA_LOGO_CARD : 52,
      flexShrink: 0,
    },
    sobretituloNo(c, s.sobretitulo) ?? div({}),
    sozinho(c) ? logoNo(c, ALTURA_LOGO_CARD) : c.id.logoNaCapa ? logoNo(c) : null,
  );
  // Estilos de foto em quadro (Editorial, Clean): a foto entra na capa como um quadro em cima do título.
  const fotoEmQuadro = !!c.foto && !c.tema.fotoCheia;
  const alturaQuadro = 500 + Math.round(M.extra * 0.5);
  const reservado =
    52 + (naBase ? 50 : 24) + (fotoEmQuadro ? alturaQuadro + 80 : 0) + (c.tema.divisor === 'linha' ? 16 : 0);
  const ajuste = caberBlocos(
    [
      {
        id: 't',
        texto: semMarcas(s.titulo),
        fonte: fonteTitulo(c),
        largura: MIOLO,
        min: 56,
        max: c.par.titulo.caixaAlta ? 108 : 124,
        alturaLinha: c.par.titulo.alturaLinha,
        antes: 0,
        peso: 2,
      },
      {
        id: 'x',
        texto: s.texto,
        fonte: fonteCorpo(c),
        largura: MIOLO,
        min: 30,
        max: 40,
        alturaLinha: 1.38,
        antes: 36,
      },
    ],
    M.conteudo -
      reservaDoBotao(c) -
      reservado -
      (comFoto ? 500 : 0) -
      (sozinho(c) ? ALTURA_LOGO_CARD - 52 : 0),
  );
  if (!ajuste.cabe) c.avisos.push('O título da capa está longo demais: encurte para caber sem apertar.');
  const titulo = tituloNo(
    c,
    s.titulo,
    fonteTitulo(c),
    ajuste.tamanhos.t!,
    c.par.titulo.alturaLinha,
    c.cores.texto,
  );
  const sub = s.texto
    ? textoNo(s.texto, fonteCorpo(c), ajuste.tamanhos.x!, 1.38, c.cores.suave, { marginTop: 36 })
    : null;
  const quadroFoto: No | null = fotoEmQuadro
    ? {
        type: 'img',
        props: {
          src: c.foto!,
          width: MIOLO,
          height: alturaQuadro,
          style: {
            width: MIOLO,
            height: alturaQuadro,
            objectFit: 'cover',
            borderRadius: c.tema.cantos,
            marginTop: 40,
            flexShrink: 0,
          },
        },
      }
    : null;
  // v149: no card, o botão vem colado no texto (o bloco todo na base), não solto no pé da peça.
  const botaoJunto = naBase && sozinho(c) ? botaoNo(c, 44) : null;
  const miolo = naBase
    ? div(
        { flexDirection: 'column', flexShrink: 0 },
        div({ marginBottom: 40 }, divisorNo(c)),
        titulo,
        sub,
        botaoJunto,
      )
    : div({ flexDirection: 'column', flexGrow: 1, justifyContent: 'center', paddingTop: 24 }, titulo, sub);
  if (quadroFoto)
    return quadro(c, {
      alinhar: 'inicio',
      corpo: [
        topo,
        quadroFoto,
        div({ flexDirection: 'column', flexGrow: 1, justifyContent: 'center', paddingTop: 40 }, titulo, sub),
      ],
      rodape: rodapeNo(c, { seta: true, linha: c.tema.divisor === 'linha' }),
      comLogo: true,
    });
  return quadro(c, {
    atras: comFoto ? fotoCheiaNo(c, c.foto!) : [],
    alinhar: naBase ? 'entre' : 'inicio',
    corpo: [topo, miolo],
    rodape: rodapeNo(c, { seta: true, linha: c.tema.divisor === 'linha' && !comFoto }),
    comLogo: true,
    comBotao: !!botaoJunto,
  });
}

function item(c: Contexto): No {
  const { s } = c;
  const numero = s.destaque || String(c.indice);
  const tamNumero = c.par.titulo.caixaAlta ? 240 : 200;
  const alturaNumero = Math.round(tamNumero * 0.86);
  const ajuste = caberBlocos(
    [
      {
        id: 't',
        texto: semMarcas(s.titulo),
        fonte: fonteTitulo(c),
        largura: MIOLO,
        min: 48,
        max: 96,
        alturaLinha: c.par.titulo.alturaLinha,
        antes: 44,
        peso: 2,
      },
      {
        id: 'x',
        texto: s.texto,
        fonte: fonteCorpo(c),
        largura: MIOLO,
        min: 28,
        max: 42,
        alturaLinha: alturaLinhaTexto,
        antes: 44 + 3 + 44,
      },
    ],
    M.conteudo - reservaDoBotao(c) - alturaNumero,
  );
  if (!ajuste.cabe) c.avisos.push('O texto deste slide está longo demais: encurte o título ou o texto.');
  return quadro(c, {
    corpo: [
      textoNo(numero, fonteTitulo(c, true), tamNumero, 0.86, c.cores.acento, { height: alturaNumero }),
      tituloNo(c, s.titulo, fonteTitulo(c), ajuste.tamanhos.t!, c.par.titulo.alturaLinha, c.cores.texto, {
        marginTop: 44,
      }),
      s.texto ? div({ marginTop: 44 }, divisorNo(c)) : null,
      s.texto
        ? textoNo(s.texto, fonteCorpo(c), ajuste.tamanhos.x!, alturaLinhaTexto, c.cores.suave, {
            marginTop: 44,
          })
        : null,
    ],
    rodape: rodapeNo(c),
  });
}

function textoModelo(c: Contexto): No {
  const { s } = c;
  const temSobre = !!s.sobretitulo;
  const ajuste = caberBlocos(
    [
      {
        id: 't',
        texto: semMarcas(s.titulo),
        fonte: fonteTitulo(c),
        largura: MIOLO,
        min: 48,
        max: 96,
        alturaLinha: c.par.titulo.alturaLinha,
        antes: temSobre ? 28 : 0,
        peso: 2,
      },
      {
        id: 'x',
        texto: s.texto,
        fonte: fonteCorpo(c),
        largura: MIOLO,
        min: 28,
        max: 42,
        alturaLinha: alturaLinhaTexto,
        antes: 44 + 3 + 44,
      },
    ],
    M.conteudo - reservaDoBotao(c) - (temSobre ? 32 : 0),
  );
  if (!ajuste.cabe) c.avisos.push('O texto deste slide está longo demais: divida em dois slides.');
  return quadro(c, {
    corpo: [
      sobretituloNo(c, s.sobretitulo),
      tituloNo(c, s.titulo, fonteTitulo(c), ajuste.tamanhos.t!, c.par.titulo.alturaLinha, c.cores.texto, {
        marginTop: temSobre ? 28 : 0,
      }),
      s.texto ? div({ marginTop: 44 }, divisorNo(c)) : null,
      s.texto
        ? textoNo(s.texto, fonteCorpo(c), ajuste.tamanhos.x!, alturaLinhaTexto, c.cores.suave, {
            marginTop: 44,
          })
        : null,
    ],
    rodape: rodapeNo(c),
  });
}

function lista(c: Contexto): No {
  const { s, tema } = c;
  const itens = s.itens.filter((i) => i.trim());
  const temSobre = !!s.sobretitulo;
  const cartao = tema.cartoes !== 'nenhum';
  const marcador = 72;
  const padH = cartao ? 36 : 0;
  const larguraItem = MIOLO - marcador - padH * 2;
  const espacoItem = cartao ? 20 : 0;
  const padV = cartao ? 32 : 30;
  const blocos: BlocoTexto[] = [
    {
      id: 't',
      texto: semMarcas(s.titulo),
      fonte: fonteTitulo(c),
      largura: MIOLO,
      min: 44,
      max: 76,
      alturaLinha: c.par.titulo.alturaLinha,
      antes: temSobre ? 24 : 0,
      peso: 2,
    },
    ...itens.map((t, i) => ({
      id: `i${i}`,
      texto: t,
      fonte: fonteCorpo(c, 'medio'),
      largura: larguraItem,
      min: 26,
      max: 38,
      alturaLinha: 1.38,
      antes: (i === 0 ? 52 : espacoItem) + padV * 2,
    })),
  ];
  const ajuste = caberBlocos(blocos, M.conteudo - (temSobre ? 32 : 0));
  // Todos os itens no mesmo tamanho (o menor), para a lista ficar uniforme.
  const tamItem = Math.min(38, ...itens.map((_, i) => ajuste.tamanhos[`i${i}`] ?? 38));
  if (!ajuste.cabe) c.avisos.push('A lista está longa demais: use até 5 itens curtos.');
  const linhas = itens.map((t, i) =>
    div(
      {
        alignItems: 'flex-start',
        padding: `${padV}px ${padH}px`,
        marginTop: i === 0 ? 52 : espacoItem,
        // Largura em px: com 100% o Satori soma o espaçamento por fora e o cartão passa da margem.
        width: MIOLO,
        ...(tema.cartoes === 'cheio' ? { backgroundColor: c.cores.cartao, borderRadius: tema.cantos } : {}),
        ...(tema.cartoes === 'borda'
          ? { border: `2px solid ${c.cores.linha}`, borderRadius: tema.cantos }
          : {}),
        ...(!cartao && i > 0 ? { borderTop: `2px solid ${c.cores.linha}` } : {}),
      },
      textoNo(String(i + 1), fonteTitulo(c, true), Math.round(tamItem * 1.25), 1.1, c.cores.acento, {
        width: marcador,
        flexShrink: 0,
        marginTop: -Math.round(tamItem * 0.08),
      }),
      textoNo(t, fonteCorpo(c, 'medio'), tamItem, 1.38, cartao ? c.cores.cartaoTexto : c.cores.texto, {
        width: larguraItem,
      }),
    ),
  );
  return quadro(c, {
    corpo: [
      sobretituloNo(c, s.sobretitulo),
      tituloNo(c, s.titulo, fonteTitulo(c), ajuste.tamanhos.t!, c.par.titulo.alturaLinha, c.cores.texto, {
        marginTop: temSobre ? 24 : 0,
      }),
      ...linhas,
    ],
    rodape: rodapeNo(c),
  });
}

function numero(c: Contexto): No {
  const { s } = c;
  const destaque = s.destaque || '0';
  // O número ocupa a largura: quanto mais curto, maior (até 320 px).
  const fonteNum = fonteTitulo(c, true);
  let tamNum = 320;
  while (tamNum > 96 && larguraTexto(destaque, fonteNum, tamNum) > MIOLO) tamNum -= 4;
  const alturaNum = Math.round(tamNum * 0.95);
  const ajuste = caberBlocos(
    [
      {
        id: 't',
        texto: semMarcas(s.titulo),
        fonte: fonteTitulo(c),
        largura: MIOLO,
        min: 44,
        max: 80,
        alturaLinha: c.par.titulo.alturaLinha,
        antes: 40,
        peso: 2,
      },
      {
        id: 'x',
        texto: s.texto,
        fonte: fonteCorpo(c),
        largura: MIOLO,
        min: 28,
        max: 38,
        alturaLinha: alturaLinhaTexto,
        antes: 32,
      },
    ],
    M.conteudo - reservaDoBotao(c) - alturaNum - (c.tema.selo && s.sobretitulo ? 100 : 0),
  );
  if (!ajuste.cabe) c.avisos.push('O texto deste slide está longo demais: encurte.');
  return quadro(c, {
    corpo: [
      c.tema.selo && s.sobretitulo
        ? div({ marginBottom: 44, flexShrink: 0 }, sobretituloNo(c, s.sobretitulo))
        : null,
      textoNo(destaque, fonteNum, tamNum, 0.95, c.cores.acento, { height: alturaNum, whiteSpace: 'nowrap' }),
      tituloNo(c, s.titulo, fonteTitulo(c), ajuste.tamanhos.t!, c.par.titulo.alturaLinha, c.cores.texto, {
        marginTop: 40,
      }),
      s.texto
        ? textoNo(s.texto, fonteCorpo(c), ajuste.tamanhos.x!, alturaLinhaTexto, c.cores.suave, {
            marginTop: 32,
          })
        : null,
    ],
    rodape: rodapeNo(c),
  });
}

function citacao(c: Contexto): No {
  const { s } = c;
  const alturaAspas = 140;
  const alturaLinha = Math.max(1.12, c.par.titulo.alturaLinha);
  const ajuste = caberBlocos(
    [
      {
        id: 't',
        texto: semMarcas(s.titulo),
        fonte: fonteTitulo(c),
        largura: MIOLO,
        min: 48,
        max: 96,
        alturaLinha,
        antes: 28,
        peso: 2,
      },
      {
        id: 'x',
        texto: s.texto,
        fonte: fonteCorpo(c),
        largura: MIOLO,
        min: 26,
        max: 36,
        alturaLinha: 1.4,
        antes: 48,
      },
    ],
    M.conteudo - reservaDoBotao(c) - alturaAspas,
  );
  if (!ajuste.cabe) c.avisos.push('A frase está longa demais para a citação: encurte.');
  return quadro(c, {
    corpo: [
      div(
        { height: alturaAspas, overflow: 'hidden', flexShrink: 0 },
        textoNo(
          '“',
          { familia: c.par.titulo.familia, peso: c.par.titulo.pesoForte },
          300,
          1,
          c.cores.acento,
          { marginTop: -30 },
        ),
      ),
      tituloNo(c, s.titulo, fonteTitulo(c), ajuste.tamanhos.t!, alturaLinha, c.cores.texto, {
        marginTop: 28,
      }),
      s.texto ? div({ marginTop: 48, width: 72, height: 3, backgroundColor: c.cores.acento }) : null,
      s.texto
        ? textoNo(s.texto, fonteCorpo(c, 'medio'), ajuste.tamanhos.x!, 1.4, c.cores.suave, { marginTop: 28 })
        : null,
    ],
    rodape: rodapeNo(c),
  });
}

function comparacao(c: Contexto): No {
  const { s, tema } = c;
  const colunas = [0, 1].map((i) => s.colunas[i] ?? { rotulo: '', texto: '' });
  const vao = 24;
  const larguraCol = Math.floor((MIOLO - vao) / 2);
  const pad = 40;
  const larguraTextoCol = larguraCol - pad * 2;
  const ajusteT = caberBlocos(
    [
      {
        id: 't',
        texto: semMarcas(s.titulo),
        fonte: fonteTitulo(c),
        largura: MIOLO,
        min: 44,
        max: 80,
        alturaLinha: c.par.titulo.alturaLinha,
        antes: 0,
      },
    ],
    380,
  );
  const alturaCol = M.conteudo - Math.min(380, ajusteT.altura) - 56;
  const tamCol = Math.min(
    ...colunas.map(
      (col) =>
        caberBlocos(
          [
            {
              id: 'x',
              texto: col.texto,
              fonte: fonteCorpo(c, 'medio'),
              largura: larguraTextoCol,
              min: 26,
              max: 40,
              alturaLinha: 1.4,
              antes: 0,
            },
          ],
          alturaCol - pad * 2 - 30 - 28,
        ).tamanhos.x!,
    ),
  );
  // A coluna da direita é "o certo": na cor do botão (destaque no fundo escuro, principal no claro).
  const coresCol = (i: number) =>
    i === 1
      ? { fundo: c.cores.botaoFundo, texto: c.cores.botaoTexto, rotulo: c.cores.botaoTexto }
      : { fundo: c.cores.cartao, texto: c.cores.cartaoTexto, rotulo: c.cores.suave };
  return quadro(c, {
    corpo: [
      tituloNo(c, s.titulo, fonteTitulo(c), ajusteT.tamanhos.t!, c.par.titulo.alturaLinha, c.cores.texto),
      div(
        { marginTop: 56, gap: vao, width: '100%', alignItems: 'stretch' },
        ...colunas.map((col, i) => {
          const k = coresCol(i);
          return div(
            {
              flexDirection: 'column',
              width: larguraCol,
              padding: `${pad}px`,
              backgroundColor: k.fundo,
              borderRadius: tema.cantos,
              minHeight: 420,
            },
            textoNo(
              col.rotulo || (i === 0 ? 'Antes' : 'Depois'),
              fonteCorpo(c, 'forte'),
              24,
              1.25,
              k.rotulo,
              {
                letterSpacing: 3,
                textTransform: 'uppercase',
              },
            ),
            textoNo(col.texto, fonteCorpo(c, 'medio'), tamCol, 1.4, k.texto, { marginTop: 28 }),
          );
        }),
      ),
    ],
    rodape: rodapeNo(c),
  });
}

function fotoModelo(c: Contexto): No {
  const { s, tema } = c;
  if (!c.foto) c.avisos.push('Escolha uma foto para este slide.');
  if (tema.fotoCheia && c.foto) {
    // Foto de ponta a ponta e o texto numa caixa da cor principal por cima.
    const larguraCaixa = MIOLO + 48 - 96;
    const ajuste = caberBlocos(
      [
        {
          id: 't',
          texto: semMarcas(s.titulo),
          fonte: fonteTitulo(c),
          largura: larguraCaixa,
          min: 40,
          max: 68,
          alturaLinha: c.par.titulo.alturaLinha,
          antes: 0,
          peso: 2,
        },
        {
          id: 'x',
          texto: s.texto,
          fonte: fonteCorpo(c),
          largura: larguraCaixa,
          min: 26,
          max: 34,
          alturaLinha: 1.42,
          antes: 20,
        },
      ],
      440 - (sozinho(c) && c.s.botao ? 110 : 0),
    );
    if (!ajuste.cabe) c.avisos.push('O texto sobre a foto está longo demais: encurte.');
    return div(
      { width: M.largura, height: M.altura, position: 'relative', backgroundColor: c.cores.fundo },
      imagemCheia(c.foto),
      div(
        {
          position: 'absolute',
          left: LADO - 24,
          right: LADO - 24,
          bottom: M.base,
          flexDirection: 'column',
          padding: '44px 48px',
          backgroundColor: c.cores.fundo,
          borderRadius: tema.cantos,
        },
        tituloNo(c, s.titulo, fonteTitulo(c), ajuste.tamanhos.t!, c.par.titulo.alturaLinha, c.cores.texto),
        s.texto
          ? textoNo(s.texto, fonteCorpo(c), ajuste.tamanhos.x!, 1.42, c.cores.suave, { marginTop: 20 })
          : null,
        sozinho(c) ? botaoNo(c, 28) : null,
      ),
      logoNoCanto(c),
    );
  }
  const alturaFoto = 720 + Math.round(M.extra * 0.6);
  const ajuste = caberBlocos(
    [
      {
        id: 't',
        texto: semMarcas(s.titulo),
        fonte: fonteTitulo(c),
        largura: MIOLO,
        min: 40,
        max: 68,
        alturaLinha: c.par.titulo.alturaLinha,
        antes: 48,
        peso: 2,
      },
      {
        id: 'x',
        texto: s.texto,
        fonte: fonteCorpo(c),
        largura: MIOLO,
        min: 26,
        max: 34,
        alturaLinha: 1.42,
        antes: 24,
      },
    ],
    M.conteudo - reservaDoBotao(c) - alturaFoto,
  );
  if (!ajuste.cabe) c.avisos.push('O texto abaixo da foto está longo demais: encurte.');
  const quadroFoto: No = c.foto
    ? {
        type: 'img',
        props: {
          src: c.foto,
          width: MIOLO,
          height: alturaFoto,
          style: {
            width: MIOLO,
            height: alturaFoto,
            objectFit: 'cover',
            borderRadius: tema.cantos,
            flexShrink: 0,
          },
        },
      }
    : div(
        {
          width: MIOLO,
          height: alturaFoto,
          flexShrink: 0,
          backgroundColor: c.cores.cartao,
          borderRadius: tema.cantos,
          alignItems: 'center',
          justifyContent: 'center',
        },
        textoNo('Escolha uma foto', fonteCorpo(c, 'medio'), 30, 1, c.cores.suave),
      );
  return quadro(c, {
    alinhar: 'inicio',
    corpo: [
      quadroFoto,
      tituloNo(c, s.titulo, fonteTitulo(c), ajuste.tamanhos.t!, c.par.titulo.alturaLinha, c.cores.texto, {
        marginTop: 48,
      }),
      s.texto
        ? textoNo(s.texto, fonteCorpo(c), ajuste.tamanhos.x!, 1.42, c.cores.suave, { marginTop: 24 })
        : null,
    ],
    rodape: rodapeNo(c),
  });
}

function chamada(c: Contexto): No {
  const { s, tema } = c;
  const botaoTam = 38;
  const temBotao = !!s.botao;
  const alturaBotao = temBotao ? Math.round(botaoTam * 1.2) + 52 + 52 : 0;
  const ajuste = caberBlocos(
    [
      {
        id: 't',
        texto: semMarcas(s.titulo),
        fonte: fonteTitulo(c),
        largura: MIOLO,
        min: 52,
        max: 120,
        alturaLinha: c.par.titulo.alturaLinha,
        antes: 0,
        peso: 2,
      },
      {
        id: 'x',
        texto: s.texto,
        fonte: fonteCorpo(c),
        largura: MIOLO,
        min: 28,
        max: 38,
        alturaLinha: 1.4,
        antes: 32,
      },
    ],
    M.conteudo - reservaDoBotao(c) - 52 - 24 - alturaBotao,
  );
  if (!ajuste.cabe) c.avisos.push('A chamada final está longa demais: encurte o título.');
  const botao = temBotao
    ? div(
        {
          marginTop: 52,
          alignSelf: 'flex-start',
          padding: '26px 40px',
          backgroundColor: c.cores.botaoFundo,
          borderRadius: tema.cantos ? 999 : 0,
        },
        textoNo(s.botao, fonteCorpo(c, 'forte'), botaoTam, 1.2, c.cores.botaoTexto),
      )
    : null;
  return quadro(c, {
    alinhar: 'inicio',
    corpo: [
      div(
        { minHeight: sozinho(c) ? ALTURA_LOGO_CARD : 52, alignItems: 'center', flexShrink: 0 },
        sozinho(c) ? logoNo(c, ALTURA_LOGO_CARD) : c.id.logoNaChamada ? logoNo(c) : null,
      ),
      div(
        { flexDirection: 'column', flexGrow: 1, justifyContent: 'center' },
        tituloNo(c, s.titulo, fonteTitulo(c), ajuste.tamanhos.t!, c.par.titulo.alturaLinha, c.cores.texto),
        botao,
        s.texto
          ? textoNo(s.texto, fonteCorpo(c), ajuste.tamanhos.x!, 1.4, c.cores.suave, { marginTop: 32 })
          : null,
      ),
    ],
    rodape: rodapeNo(c, { numero: false }),
    comLogo: true,
  });
}

/**
 * v150: a arte desenhada pela IA é a peça inteira (texto, logo e composição já estão nela): sai como
 * está, de ponta a ponta. Sem a imagem (apagada ou ainda não feita), a peça cai na capa, com o mesmo
 * texto, para nunca sair em branco.
 */
function arte(c: Contexto): No {
  if (!c.foto) {
    c.avisos.push(
      'A arte da IA não está disponível: a peça aparece no modelo Capa até ser desenhada de novo.',
    );
    return capa({ ...c, s: { ...c.s, modelo: 'capa' } });
  }
  return div(
    { width: M.largura, height: M.altura, position: 'relative', backgroundColor: c.cores.fundo },
    imagemCheia(c.foto),
  );
}

/**
 * v152: a peça em camadas. Fundo na cor da marca com uma forma em tom vizinho, a foto recortada (PNG
 * transparente) encostada na base, e o texto escrito pelo sistema na área que sobra. Sem o recorte
 * (apagado ou ainda não feito), a peça cai na capa, com o mesmo texto.
 */
function camadas(c: Contexto): No {
  if (!c.foto) {
    c.avisos.push('O recorte da foto não está disponível: a peça aparece no modelo Capa até ser refeito.');
    return capa({ ...c, s: { ...c.s, modelo: 'capa' } });
  }
  const { s } = c;
  const naBase = s.composicao === 'base';
  const story = M.altura > ALTURA_SLIDE;
  // A área do recorte: ao lado, metade da largura e 70% da altura; embaixo, 62% × 46%.
  const areaL = Math.round(M.largura * (naBase ? 0.62 : 0.5));
  const areaA = Math.round(M.altura * (naBase ? 0.46 : story ? 0.6 : 0.7));
  // O recorte encosta na base da peça nos dois formatos (cortado no ar, a borda de baixo apareceria).
  const pe = 0;
  const prop = c.fotoMedidas ? c.fotoMedidas.largura / Math.max(1, c.fotoMedidas.altura) : null;
  const fotoL = prop ? Math.round(Math.min(areaL, areaA * prop)) : areaL;
  const fotoA = prop ? Math.round(Math.min(areaA, areaL / prop)) : areaA;
  const recorte: No = {
    type: 'img',
    props: {
      src: c.foto,
      width: fotoL,
      height: fotoA,
      style: {
        position: 'absolute',
        left: M.largura - fotoL - (naBase ? 24 : 0),
        top: M.altura - fotoA - pe,
        width: fotoL,
        height: fotoA,
        objectFit: 'contain',
        ...(prop ? {} : { objectPosition: 'right bottom' }),
      },
    },
  };
  const claroSobre = contraste(c.cores.fundo, BRANCO) >= 3;
  const forma = Math.round(M.largura * (naBase ? 0.7 : 0.78));
  const circulo = div({
    position: 'absolute',
    left: M.largura - Math.round(forma * 0.8),
    top: M.altura - pe - Math.round(areaA * 0.86),
    width: forma,
    height: forma,
    borderRadius: forma,
    backgroundColor: misturar(c.cores.fundo, claroSobre ? BRANCO : PRETO, claroSobre ? 0.12 : 0.07),
  });
  const largura = naBase ? MIOLO : Math.round(M.largura * 0.5) - LADO + 44;
  const logo = logoNo(c, ALTURA_LOGO_CARD);
  const selo = sobretituloNo({ ...c, tema: { ...c.tema, selo: true } }, s.sobretitulo);
  const alturaTexto = M.altura - M.topo - M.base;
  const fixo =
    (logo ? ALTURA_LOGO_CARD + 44 : 0) +
    (selo ? 56 + 28 : 0) +
    (s.botao ? ALTURA_BOTAO_CARD : 0) +
    (naBase ? Math.round(areaA * 0.82) + pe - M.base : 0);
  // O número ou preço fica sempre numa linha só: o maior tamanho que cabe na largura.
  const maxDestaque = naBase ? 150 : 132;
  let tamanhoDestaque = maxDestaque;
  while (
    tamanhoDestaque > 56 &&
    s.destaque &&
    larguraTexto(s.destaque, fonteTitulo(c, true), tamanhoDestaque) > largura
  )
    tamanhoDestaque -= 2;
  const ajuste = caberBlocos(
    [
      {
        id: 'd',
        texto: s.destaque,
        fonte: fonteTitulo(c, true),
        largura,
        min: Math.min(64, tamanhoDestaque),
        max: tamanhoDestaque,
        alturaLinha: 1,
        antes: 0,
        peso: 2,
      },
      {
        id: 't',
        texto: semMarcas(s.titulo),
        fonte: fonteTitulo(c),
        largura,
        min: 40,
        max: s.destaque ? 68 : 92,
        alturaLinha: c.par.titulo.alturaLinha,
        antes: s.destaque ? 20 : 0,
        peso: 1.5,
      },
      {
        id: 'x',
        texto: s.texto,
        fonte: fonteCorpo(c),
        largura,
        min: 26,
        max: 34,
        alturaLinha: 1.38,
        antes: 24,
      },
    ],
    alturaTexto - fixo,
  );
  if (!ajuste.cabe)
    c.avisos.push('O texto está longo demais para a peça em camadas: encurte o título ou o texto.');
  const bloco = div(
    { flexDirection: 'column', width: largura, flexShrink: 0 },
    selo ? div({ marginBottom: 28, flexShrink: 0 }, selo) : null,
    s.destaque
      ? textoNo(s.destaque, fonteTitulo(c, true), ajuste.tamanhos.d!, 1, corDoRealce(c), {
          flexShrink: 0,
          whiteSpace: 'nowrap',
        })
      : null,
    tituloNo(c, s.titulo, fonteTitulo(c), ajuste.tamanhos.t!, c.par.titulo.alturaLinha, c.cores.texto, {
      marginTop: s.destaque ? 20 : 0,
    }),
    s.texto
      ? textoNo(s.texto, fonteCorpo(c), ajuste.tamanhos.x!, 1.38, c.cores.suave, { marginTop: 24 })
      : null,
    naBase ? null : botaoNo(c, 44),
  );
  const coluna = div(
    {
      position: 'absolute',
      left: LADO,
      top: M.topo,
      width: MIOLO,
      height: alturaTexto,
      flexDirection: 'column',
      justifyContent: naBase ? 'space-between' : 'flex-start',
    },
    div(
      { flexDirection: 'column', flexShrink: 0 },
      logo
        ? div({ height: ALTURA_LOGO_CARD, marginBottom: 44, alignItems: 'center', flexShrink: 0 }, logo)
        : null,
      bloco,
    ),
    naBase ? botaoNo(c, 0) : null,
  );
  return div(
    {
      width: M.largura,
      height: M.altura,
      position: 'relative',
      overflow: 'hidden',
      backgroundColor: c.cores.fundo,
    },
    circulo,
    recorte,
    coluna,
  );
}

const MONTAR: Record<ModeloSlide, (c: Contexto) => No> = {
  arte,
  camadas,
  capa,
  item,
  texto: textoModelo,
  lista,
  numero,
  citacao,
  comparacao,
  foto: fotoModelo,
  chamada,
};

/** O fundo do slide: o escolhido ou o do estilo para aquele modelo. */
export function fundoDoSlide(s: SlideCarrossel, estilo: EstiloCarrossel): TipoFundo {
  const tema = TEMAS[estilo];
  if (s.fundo === 'claro') return tema.base === 'branco' ? 'branco' : 'claro';
  if (s.fundo === 'escuro') return 'escuro';
  if (s.fundo === 'destaque') return 'destaque';
  if (s.modelo === 'citacao') return tema.citacao;
  if (s.modelo === 'chamada') return tema.chamada;
  // v152: a peça em camadas mora sobre a cor da marca (a principal; "destaque" troca pela de destaque).
  if (s.modelo === 'camadas') return 'escuro';
  // Capa e foto de ponta a ponta: o véu é da cor principal, então o texto é o do fundo escuro.
  if ((s.modelo === 'capa' || s.modelo === 'foto') && tema.fotoCheia && s.fotoId) return 'escuro';
  return tema.base;
}

/** Monta um slide: a árvore para desenhar e os avisos para quem edita. */
export function montarSlide(e: EntradaMontar): SlideMontado {
  M = medidasDo(e.formato ?? 'feed');
  const avisos: string[] = [];
  const campos = [
    e.slide.sobretitulo,
    e.slide.titulo,
    e.slide.texto,
    e.slide.destaque,
    e.slide.botao,
    ...e.slide.itens,
    ...e.slide.colunas.flatMap((c) => [c.rotulo, c.texto]),
  ];
  if (campos.some(textoForaDaFonte)) avisos.push('Emoji e setas não aparecem na imagem: foram tirados.');
  // Passou do tamanho que lê bem no celular: o slide ainda cabe (a letra diminui), mas avisa.
  const modelo = MODELO[e.slide.modelo];
  for (const cp of modelo.campos)
    if (semMarcas(e.slide[cp.campo]).trim().length > cp.limite)
      avisos.push(`${cp.rotulo}: passou de ${cp.limite} letras, o tamanho que lê bem no celular.`);
  if (modelo.itens && e.slide.itens.some((i) => i.trim().length > modelo.itens!.limite))
    avisos.push(`Itens da lista: use até ${modelo.itens.limite} letras em cada um.`);
  const s: SlideCarrossel = {
    ...e.slide,
    sobretitulo: limparParaSlide(e.slide.sobretitulo),
    titulo: limparParaSlide(e.slide.titulo),
    texto: e.slide.texto.split('\n').map(limparParaSlide).join('\n').trim(),
    destaque: limparParaSlide(e.slide.destaque),
    botao: limparParaSlide(e.slide.botao),
    itens: e.slide.itens.map(limparParaSlide),
    colunas: e.slide.colunas.map((c) => ({
      rotulo: limparParaSlide(c.rotulo),
      texto: limparParaSlide(c.texto),
    })),
  };
  const tema = TEMAS[e.estilo];
  const tipoFundo = fundoDoSlide(s, e.estilo);
  const paleta = paletaDaIdentidade(e.identidade.cores);
  const cores = paleta[tipoFundo];
  const fundoEscuro =
    tipoFundo === 'escuro' || (tipoFundo === 'destaque' && contraste(cores.fundo, BRANCO) >= 3);
  const logo = fundoEscuro ? (e.logoEscuro ?? e.logoClaro ?? null) : (e.logoClaro ?? e.logoEscuro ?? null);
  const ctx: Contexto = {
    s,
    indice: e.indice,
    total: e.total,
    id: e.identidade,
    tema,
    par: FONTES_DO_PAR[e.identidade.fontes],
    cores,
    tipoFundo,
    foto: MODELO[s.modelo].foto ? (e.foto ?? null) : null,
    fotoMedidas: e.fotoMedidas ?? null,
    logo,
    avisos,
  };
  return { no: MONTAR[s.modelo](ctx), avisos };
}

/** Avisos do carrossel inteiro (antes de baixar ou publicar). */
export function avisosDoCarrossel(slides: SlideCarrossel[]): string[] {
  const avisos: string[] = [];
  if (slides.length < 2) avisos.push('O Instagram pede pelo menos 2 slides num carrossel.');
  if (slides[0] && slides[0].modelo !== 'capa')
    avisos.push('O primeiro slide costuma ser a capa (o gancho).');
  if (slides.length > 1 && slides[slides.length - 1]!.modelo !== 'chamada')
    avisos.push('Termine com uma chamada final: diga o que a pessoa deve fazer.');
  return avisos;
}
