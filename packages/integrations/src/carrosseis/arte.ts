import {
  FONTES_DO_PAR,
  type FormatoPeca,
  type IdentidadeCarrossel,
  type SlideCarrossel,
  semMarcas,
} from '@prospeccao/shared/carrosseis';
import { MANUAL_DESIGN } from '../saber/design.js';
import { type ConfigImagem, pedirImagem, type ReferenciaImagem } from '../videos/imagens.js';
import type { ClienteClaude } from './claude.js';
import { CARTAO_POSTAL, tamanhoDaImagem } from './imagens.js';

/**
 * v150: a "Arte da IA" dos cards avulsos. O time de texto decide a mensagem (como sempre) e o GPT Image
 * desenha a peça inteira como um designer de agência: composição, tipografia, elementos, a foto da
 * empresa recortada sobre a cor, a logo de verdade. Vai junto, como referência: a logo, as fotos do
 * pedido e posts do próprio Instagram da conta (para seguir o jeito de postar dela, sem copiar).
 *
 * O texto é o ponto fraco de qualquer IA de imagem, por isso cada arte passa pela conferência: um modelo
 * de visão lê tudo o que está escrito na imagem e o código compara, palavra por palavra, com o texto
 * aprovado (acentos contam). Faltou palavra, sobrou número ou preço, apareceu marca estranha: reprova e
 * desenha de novo; reprovou duas vezes, a peça fica só nos modelos montados por código.
 *
 * v151 (do jeito das ferramentas profissionais): (1) o diretor de arte (Claude, com visão) planeja a peça
 * antes de desenhar, olhando as fotos e os posts da marca; (2) o pedido ao GPT Image vai no formato que a
 * OpenAI recomenda (uso, ideia, cena, herói, layout, elementos, tipografia, texto literal entre aspas,
 * papel de cada imagem de referência, restrições); (3) a logo NÃO é desenhada pela IA: ela deixa o canto
 * livre e o código põe o arquivo da logo por cima, pixel por pixel.
 */

export interface TextoDaArte {
  selo: string;
  destaque: string;
  titulo: string;
  texto: string;
  botao: string;
}

export const textoDaArte = (s: SlideCarrossel): TextoDaArte => ({
  selo: semMarcas(s.sobretitulo).trim(),
  destaque: semMarcas(s.destaque).trim(),
  titulo: semMarcas(s.titulo).trim(),
  texto: semMarcas(s.texto).replace(/\s+/g, ' ').trim(),
  botao: semMarcas(s.botao).trim(),
});

/** As palavras marcadas no título (as que ganham a cor de destaque), para a arte destacar igual. */
const marcadas = (titulo: string) => [...titulo.matchAll(/\*([^*]+)\*/g)].map((m) => m[1]!.trim());

export type CantoDaLogo = 'topo-esquerda' | 'topo-direita' | 'base-esquerda' | 'base-direita';
export const CANTOS_DA_LOGO: CantoDaLogo[] = [
  'topo-esquerda',
  'topo-direita',
  'base-esquerda',
  'base-direita',
];

/**
 * v151: a direção de arte de cada peça, decidida ANTES de desenhar (como fazem as ferramentas de design
 * com IA: primeiro o plano da composição, depois a imagem). O Claude olha as fotos e os posts da marca e
 * escreve fatos visuais concretos (onde fica cada coisa, que elemento, que luz), em vez de adjetivos.
 */
export interface DirecaoDeArte {
  ideia: string;
  cena: string;
  assunto: string;
  composicao: string;
  elementos: string[];
  tipografia: string;
  luzECor: string;
  cantoDaLogo: CantoDaLogo;
}

export interface EntradaArte {
  empresa: string;
  identidade: IdentidadeCarrossel;
  formato: FormatoPeca;
  slide: SlideCarrossel;
  /** O que o card quer (o objetivo do pedido), para o clima da peça. */
  objetivo: string;
  /** Quantas fotos da empresa vão como referência (as primeiras imagens). */
  fotos: number;
  /** Quantos posts do Instagram da conta vão como referência de estilo (depois das fotos). */
  posts: number;
  /** A direção de arte (sem ela, o pedido vai com uma direção simples, tirada só do texto). */
  direcao?: DirecaoDeArte | null;
  /** A segunda tentativa leva o que deu errado na primeira. */
  corrigir?: string[];
}

const NOME_DO_CANTO: Record<CantoDaLogo, string> = {
  'topo-esquerda': 'top-left',
  'topo-direita': 'top-right',
  'base-esquerda': 'bottom-left',
  'base-direita': 'bottom-right',
};

const direcaoSimples = (e: EntradaArte): DirecaoDeArte => ({
  ideia: `A bold promotional post that sells: ${textoDaArte(e.slide).titulo}`,
  cena: `A solid, saturated brand-color background (${e.identidade.cores.principal}) with subtle depth (soft gradient or light glow).`,
  assunto: e.fotos
    ? 'The company photo (image 1) as the hero, cut out cleanly and placed large on one side.'
    : 'One strong 3D object or scene that shows the benefit, large and well lit.',
  composicao:
    'Headline block on one side, hero subject on the other; big number or price as the strongest element; button below the text.',
  elementos: [
    'one accent shape in the highlight color behind the number',
    'subtle 3D icons related to the offer',
  ],
  tipografia: 'Heavy geometric sans-serif headline, tight leading; clean regular sans-serif support line.',
  luzECor: 'High contrast, vivid, clean studio light.',
  cantoDaLogo: 'topo-direita',
});

export function promptDaArte(e: EntradaArte): string {
  const t = textoDaArte(e.slide);
  const c = e.identidade.cores;
  const par = FONTES_DO_PAR[e.identidade.fontes];
  const realce = marcadas(e.slide.titulo);
  const d = e.direcao ?? direcaoSimples(e);
  const story = e.formato === 'story';
  const fotos = Array.from({ length: e.fotos }, (_, i) => i + 1);
  const posts = Array.from({ length: e.posts }, (_, i) => e.fotos + i + 1);
  const linha = (rotulo: string, x: string) => (x ? `- ${rotulo}: "${x}"` : '');
  return [
    `USE CASE: ${story ? 'Instagram story, vertical 9:16 full screen' : 'Instagram feed post, vertical 4:5'} for the Brazilian company ${e.empresa}. A finished, ready-to-publish promotional ad made by a top Brazilian advertising agency (${e.objetivo}). It must stop the scroll and look like a real brand campaign, not a template.`,
    `BIG IDEA: ${d.ideia}`,
    `SCENE / BACKGROUND: ${d.cena}`,
    `SUBJECT: ${d.assunto}`,
    `LAYOUT: ${d.composicao}`,
    d.elementos.length ? `GRAPHIC ELEMENTS:\n${d.elementos.map((x) => `- ${x}`).join('\n')}` : '',
    `TYPOGRAPHY: ${d.tipografia} Brand fonts for reference: headlines like "${par.titulo.familia}"${par.titulo.caixaAlta ? ' in uppercase' : ''}, body like "${par.corpo}". Strong hierarchy: the number and the headline read in one second on a phone.`,
    `LIGHT & COLOR: ${d.luzECor} Brand palette (use these exact colors, saturated): dominant ${c.principal}, accent ${c.destaque} (number, highlighted words, button), light ${c.claro}.`,
    e.identidade.jeitoDePostar
      ? `HOW THIS BRAND POSTS (follow it): ${e.identidade.jeitoDePostar.replace(/\s+/g, ' ').slice(0, 700)}`
      : '',
    'TEXT (render EXACTLY as written, in Brazilian Portuguese with every accent, each text once, nothing else):',
    linha('Small badge / pill', t.selo),
    linha('Big number or price, the largest element', t.destaque),
    linha('Headline', t.titulo),
    realce.length
      ? `  In the headline, color only these words with ${c.destaque}: ${realce.map((r) => `"${r}"`).join(', ')}.`
      : '',
    linha('Support line (smaller)', t.texto),
    linha('Rounded solid button', t.botao),
    fotos.length || posts.length ? 'REFERENCE IMAGES:' : '',
    fotos.length
      ? `- Image${fotos.length > 1 ? 's' : ''} ${fotos.join(', ')}: real photo${fotos.length > 1 ? 's' : ''} of the company. Use as the subject described above; keep the person or product identical (face, shape, colors, labels); you may cut it out and place it over the brand color.`
      : '',
    posts.length
      ? `- Image${posts.length > 1 ? 's' : ''} ${posts.join(', ')}: posts this brand already published. Borrow their visual language (composition, graphic elements, 3D icons, how they use color and photos). Ignore their text, logo and exact layout.`
      : '',
    `LOGO AREA: keep the ${NOME_DO_CANTO[d.cantoDaLogo]} corner (about 30% of the width and 12% of the height${story ? ', below the top 13%' : ''}) clean and flat: plain background, no text, no objects. The real logo is placed there afterwards. Do NOT draw any logo, wordmark or brand name anywhere.`,
    `CONSTRAINTS: no text besides TEXT; no numbers, prices, phone numbers, websites or @ handles besides TEXT; no logos or brand names; no watermark; no frame or border; no generic stock-template look; people and places look Brazilian. ${CARTAO_POSTAL} Safe margins: nothing touches the edges${story ? '; keep the top 13% and bottom 16% free of text (the story UI covers them)' : ''}.`,
    e.corrigir?.length ? `FIX FROM THE LAST ATTEMPT: ${e.corrigir.join(' ')}` : '',
  ]
    .filter((x) => x !== '')
    .join('\n');
}

/* ───────────────────────────── A direção de arte ───────────────────────────── */

const ESQUEMA_DIRECAO = {
  type: 'object',
  properties: {
    ideia: { type: 'string', description: 'A ideia visual da peça em uma frase (em inglês).' },
    cena: {
      type: 'string',
      description:
        'O fundo e o ambiente, com fatos visuais concretos: cor, textura, profundidade, lugar (em inglês).',
    },
    assunto: {
      type: 'string',
      description:
        'O que é o herói da imagem e como aparece: a foto da empresa (recortada, tamanho, lado) ou o objeto/cena a criar (em inglês).',
    },
    composicao: {
      type: 'string',
      description:
        'Onde fica cada coisa: herói, número/preço, título, texto, botão, selo; o que domina; o caminho do olho (em inglês).',
    },
    elementos: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Até 5 elementos gráficos concretos que servem à mensagem (forma, ícone 3D, seta, brilho) (em inglês).',
    },
    tipografia: {
      type: 'string',
      description: 'Peso, caixa, cor e tamanho relativo de cada texto (em inglês).',
    },
    luz_e_cor: { type: 'string', description: 'Luz e uso das cores da marca (em inglês).' },
    canto_da_logo: {
      type: 'string',
      enum: CANTOS_DA_LOGO,
      description: 'O canto que fica livre para a logo de verdade, onde não atrapalha a composição.',
    },
  },
  required: [
    'ideia',
    'cena',
    'assunto',
    'composicao',
    'elementos',
    'tipografia',
    'luz_e_cor',
    'canto_da_logo',
  ],
} as const;

const curto = (x: unknown, max: number) =>
  String(x ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

export function lerDirecao(d: Record<string, unknown>): DirecaoDeArte | null {
  const ideia = curto(d.ideia, 300);
  const composicao = curto(d.composicao, 700);
  if (ideia.length < 10 || composicao.length < 20) return null;
  const canto = String(d.canto_da_logo) as CantoDaLogo;
  return {
    ideia,
    cena: curto(d.cena, 500),
    assunto: curto(d.assunto, 500),
    composicao,
    elementos: (Array.isArray(d.elementos) ? d.elementos : [])
      .map((x) => curto(x, 160))
      .filter(Boolean)
      .slice(0, 5),
    tipografia: curto(d.tipografia, 400),
    luzECor: curto(d.luz_e_cor, 300),
    cantoDaLogo: CANTOS_DA_LOGO.includes(canto) ? canto : 'topo-direita',
  };
}

/**
 * O diretor de arte (Claude, com visão) planeja a peça olhando as fotos da empresa e os posts da marca.
 * Não escreve texto da peça (o texto é o aprovado): decide só a composição, o herói, os elementos e a luz.
 */
export async function dirigirArte(
  claude: ClienteClaude,
  e: EntradaArte & { referencias: ReferenciaImagem[] },
): Promise<DirecaoDeArte | null> {
  const t = textoDaArte(e.slide);
  const c = e.identidade.cores;
  const r = await claude.pedir({
    agente: 'diretor de arte',
    sistema: [
      {
        texto:
          'Você é o diretor de arte sênior de uma agência brasileira que faz posts de Instagram para marcas de varejo e serviços. Planeja cada peça como um designer: uma ideia visual forte, um herói claro, hierarquia que se lê em um segundo no celular, as cores da marca cheias, elementos gráficos com função. Descreve fatos visuais concretos para a IA de imagem, nunca adjetivos vagos ("bonito", "moderno", "premium").',
      },
      { texto: MANUAL_DESIGN, cache: true },
    ],
    imagens: e.referencias.map((x, i) => ({
      tipo: x.tipo,
      base64: Buffer.from(x.dados).toString('base64'),
      legenda:
        i < e.fotos
          ? `Imagem ${i + 1}: foto real da empresa (pode ser o herói da peça).`
          : `Imagem ${i + 1}: post que a marca já publicou (o jeito de postar dela).`,
    })),
    mensagem: [
      `Planeje a arte de ${e.formato === 'story' ? 'um story 9:16' : 'um post de feed 4:5'} da ${e.empresa}. Objetivo: ${e.objetivo}.`,
      'O texto da peça já está aprovado (não mude, não acrescente; só decida onde e como ele aparece):',
      t.selo && `- Selo: "${t.selo}"`,
      t.destaque && `- Número/preço: "${t.destaque}"`,
      `- Título: "${t.titulo}"`,
      t.texto && `- Texto: "${t.texto}"`,
      t.botao && `- Botão: "${t.botao}"`,
      `Cores da marca: principal ${c.principal}, destaque ${c.destaque}, claro ${c.claro}.`,
      e.identidade.jeitoDePostar
        ? `O jeito de postar da marca: ${e.identidade.jeitoDePostar.slice(0, 900)}`
        : '',
      e.fotos
        ? 'Use a foto da empresa como herói sempre que ela servir à mensagem (pessoa ou produto recortado sobre a cor da marca é o que mais funciona).'
        : 'Não há foto da empresa: o herói é um objeto ou cena criada que mostre o benefício (3D, bem iluminado), nunca um banco de imagens genérico.',
      'Escolha o canto livre para a logo de verdade (ela é posta depois, por cima).',
    ]
      .filter(Boolean)
      .join('\n'),
    ferramenta: { nome: 'direcao_de_arte', descricao: 'O plano visual da peça.', esquema: ESQUEMA_DIRECAO },
    maxTokens: 1200,
    temperatura: 0.6,
    esforco: 'alto',
    timeoutMs: 90_000,
  });
  return lerDirecao(r.dados);
}

export async function desenharArte(
  cfg: ConfigImagem,
  e: EntradaArte & { referencias: ReferenciaImagem[] },
): Promise<Uint8Array> {
  const t = tamanhoDaImagem(e.formato);
  return pedirImagem(cfg, {
    prompt: promptDaArte(e),
    ...t,
    ...(e.referencias.length ? { referencias: e.referencias } : {}),
  });
}

/* ───────────────────────────── A logo de verdade ───────────────────────────── */

export interface LogosDaArte {
  /** A logo para fundo claro. */
  claro: ReferenciaImagem | null;
  /** A logo para fundo escuro. */
  escuro: ReferenciaImagem | null;
}

/**
 * Põe a logo de verdade (o arquivo da conta, pixel por pixel) no canto que a direção de arte deixou
 * livre. Escolhe a versão da logo pelo fundo daquele canto (escuro → a logo para fundo escuro).
 */
export async function porLogo(
  jpeg: Uint8Array,
  logos: LogosDaArte,
  canto: CantoDaLogo,
  formato: FormatoPeca,
): Promise<Uint8Array> {
  if (!logos.claro && !logos.escuro) return jpeg;
  // Carregado só aqui: o worker-videos empacota este pacote e não tem o sharp instalado.
  const sharp = (await import('sharp')).default;
  const base = sharp(Buffer.from(jpeg));
  const { width: W = 1088, height: H = 1360 } = await base.metadata();
  const margem = Math.round(W * 0.06);
  const caixaL = Math.round(W * 0.26);
  const caixaA = Math.round(H * (formato === 'story' ? 0.06 : 0.08));
  const topo = formato === 'story' ? Math.round(H * 0.14) : margem;
  const baixo = H - caixaA - (formato === 'story' ? Math.round(H * 0.17) : margem);
  const x = canto.endsWith('esquerda') ? margem : W - margem - caixaL;
  const y = canto.startsWith('topo') ? topo : baixo;
  // O stats() do sharp mede a imagem de entrada: o recorte vira imagem antes de medir.
  const recorte = await sharp(Buffer.from(jpeg))
    .extract({ left: x, top: y, width: caixaL, height: caixaA })
    .toBuffer();
  const media = await sharp(recorte).stats();
  const [r, g, b] = media.channels.map((ch) => ch.mean);
  const escuro = 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0) < 140;
  const logo = (escuro ? logos.escuro : logos.claro) ?? logos.escuro ?? logos.claro!;
  const pronta = await sharp(Buffer.from(logo.dados))
    .resize({ width: caixaL, height: caixaA, fit: 'inside' })
    .png()
    .toBuffer({ resolveWithObject: true });
  const lx = canto.endsWith('esquerda') ? x : x + caixaL - pronta.info.width;
  const ly = y + Math.round((caixaA - pronta.info.height) / 2);
  const saida = await base
    .composite([{ input: pronta.data, left: lx, top: ly }])
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
  return new Uint8Array(saida);
}

/* ───────────────────────────── A conferência ───────────────────────────── */

const ESQUEMA_ARTE = {
  type: 'object',
  properties: {
    textos: {
      type: 'array',
      description:
        'TUDO o que está escrito na imagem, um item por linha de texto, copiado letra por letra como aparece (com os acentos e os erros, se houver). Inclua o que está no botão, no selo e na logo.',
      items: { type: 'string' },
    },
    canto_livre: {
      type: 'boolean',
      description: 'O canto indicado está liso (sem texto, sem objeto, sem parte importante da imagem).',
    },
    outra_marca: {
      type: 'boolean',
      description: 'Aparece algum logotipo, marca ou nome de empresa desenhado.',
    },
    defeito: {
      type: 'boolean',
      description:
        'Defeito de imagem gerada: mãos, rostos ou objetos deformados, letras derretidas, partes sem sentido.',
    },
    legivel: {
      type: 'boolean',
      description: 'O título e o número se leem bem no celular (contraste e tamanho).',
    },
    nota: {
      type: 'integer',
      description: 'De 1 a 5: a qualidade da peça como post de agência (5: pronta para publicar).',
    },
    problemas: { type: 'array', items: { type: 'string' }, description: 'Cada problema em uma frase curta.' },
  },
  required: ['textos', 'canto_livre', 'outra_marca', 'defeito', 'legivel', 'nota', 'problemas'],
} as const;

/** Compara sem ligar para maiúsculas, quebras de linha e pontuação solta; os acentos contam. */
export const normalizarTexto = (t: string) =>
  t
    .toLowerCase()
    .replace(/[“”"'‘’«»]/g, '')
    .replace(/[.,;:!?…()\-–—/|•]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const numeros = (t: string) => t.match(/\d+(?:[.,]\d+)?/g) ?? [];

/** v152: a arte só passa com nota 4 ou mais (antes, 3): abaixo disso o time desenha de novo. */
export const NOTA_MINIMA_ARTE = 4;

export interface ConferenciaArte {
  aprovada: boolean;
  problemas: string[];
  lidos: string[];
}

/**
 * O código decide, com o que o modelo de visão leu: cada campo do texto aprovado está lá inteiro (na
 * ordem das palavras), nenhum número ou preço a mais, a logo apareceu (quando foi), sem marca estranha
 * nem defeito, legível e nota 4 ou mais.
 */
export function avaliarArte(
  esperado: TextoDaArte,
  d: Record<string, unknown>,
  o: { empresa: string },
): ConferenciaArte {
  const lidos = (Array.isArray(d.textos) ? d.textos : []).map((x) => String(x).slice(0, 300));
  const tudo = ` ${normalizarTexto(lidos.join(' '))} `;
  const problemas: string[] = [];
  const campos: [string, string][] = [
    ['o selo', esperado.selo],
    ['o número', esperado.destaque],
    ['o título', esperado.titulo],
    ['o texto', esperado.texto],
    ['o botão', esperado.botao],
  ];
  for (const [rotulo, valor] of campos) {
    const v = normalizarTexto(valor);
    if (v && !tudo.includes(` ${v} `)) problemas.push(`Faltou ou saiu errado ${rotulo}: "${valor}".`);
  }
  const permitidos = new Set(
    [...Object.values(esperado), o.empresa].flatMap((x) =>
      numeros(normalizarTexto(x)).map((n) => n.replace(',', '.')),
    ),
  );
  const inventados = numeros(tudo)
    .map((n) => n.replace(',', '.'))
    .filter((n) => !permitidos.has(n));
  if (inventados.length)
    problemas.push(`Apareceu número que não estava no texto: ${[...new Set(inventados)].join(', ')}.`);
  if (d.canto_livre === false)
    problemas.push('O canto da logo não ficou livre: deixe aquele canto liso, sem nada.');
  if (d.outra_marca === true) problemas.push('Apareceu outra marca na arte.');
  if (d.defeito === true) problemas.push('A arte tem defeito de imagem gerada.');
  if (d.legivel === false) problemas.push('O título ou o número não se lê bem.');
  const nota = Number(d.nota);
  if (Number.isFinite(nota) && nota < NOTA_MINIMA_ARTE)
    problemas.push(`A peça ficou fraca (nota ${nota} de 5).`);
  for (const p of Array.isArray(d.problemas) ? d.problemas : [])
    if (problemas.length < 8) problemas.push(String(p).slice(0, 160));
  const reprovou =
    campos.some(([, v]) => normalizarTexto(v) && !tudo.includes(` ${normalizarTexto(v)} `)) ||
    inventados.length > 0 ||
    d.canto_livre === false ||
    d.outra_marca === true ||
    d.defeito === true ||
    d.legivel === false ||
    (Number.isFinite(nota) && nota < NOTA_MINIMA_ARTE);
  return { aprovada: !reprovou, problemas: reprovou ? problemas : [], lidos };
}

export async function conferirArte(
  claude: ClienteClaude,
  e: { jpeg: Uint8Array; canto: CantoDaLogo; esperado: TextoDaArte; empresa: string },
): Promise<ConferenciaArte> {
  const r = await claude.pedir({
    agente: 'revisor de arte',
    sistema: [
      {
        texto:
          'Você é o revisor final de uma agência: confere a arte desenhada pela IA antes de ir para o cliente. Leia o texto da imagem letra por letra, sem corrigir nada do que está escrito.',
      },
    ],
    imagens: [
      {
        tipo: 'image/jpeg' as const,
        base64: Buffer.from(e.jpeg).toString('base64'),
        legenda: 'A arte para conferir:',
      },
    ],
    mensagem: `Leia todo o texto da arte e confira a peça. O canto que precisa estar livre para a logo: ${e.canto.replace('-', ' ')}.`,
    ferramenta: {
      nome: 'conferir_arte',
      descricao: 'O que a arte tem escrito e a conferência.',
      esquema: ESQUEMA_ARTE,
    },
    maxTokens: 900,
    temperatura: 0,
    timeoutMs: 90_000,
  });
  return avaliarArte(e.esperado, r.dados, { empresa: e.empresa });
}
