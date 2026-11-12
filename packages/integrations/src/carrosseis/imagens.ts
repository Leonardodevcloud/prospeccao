import {
  ESTILO,
  ESTILOS,
  type EstiloCarrossel,
  FONTES_DO_PAR,
  type FormatoPeca,
  PARES_FONTES,
  type ParFontes,
} from '@prospeccao/shared/carrosseis';
import { type ConfigImagem, conferirImagem, pedirImagem } from '../videos/imagens.js';
import type { ClienteClaude } from './claude.js';

/**
 * As imagens dos carrosséis (v132), sempre sem texto (o texto do slide é desenhado pelo sistema):
 * - imagem gerada para um slide de capa ou foto, na paleta da marca, quando nenhuma foto da empresa
 *   combina;
 * - o produto num cenário novo: a foto do produto vai como referência e o produto fica igual; só o
 *   fundo e a luz mudam;
 * - a referência de estilo: um post de que a pessoa gostou, lido por um modelo de visão (composição,
 *   luz, clima), que entra nos pedidos de imagem e no estrategista. Nunca para copiar a arte.
 * Cada imagem passa pelo revisor de visão antes de entrar.
 */

/** 4:5, como o slide (1080 × 1350), em lados múltiplos de 16. */
export const TAMANHO_SLIDE = { largura: 1088, altura: 1360 } as const;
/** v144: 9:16, como o story (1080 × 1920). */
export const TAMANHO_STORY = { largura: 1088, altura: 1920 } as const;
export const tamanhoDaImagem = (f: FormatoPeca = 'feed') => (f === 'story' ? TAMANHO_STORY : TAMANHO_SLIDE);
const proporcao = (f: FormatoPeca = 'feed') =>
  f === 'story' ? 'em pé (9:16, tela cheia de story)' : 'em pé (4:5)';

/** As três cenas de partida para o produto (o mockup: estúdio na cor da marca, uso real, close). */
export const CENAS_PRODUTO = [
  'sobre um fundo liso na cor principal da marca, luz de estúdio suave vinda de um lado, sombra leve',
  'num lugar real onde o produto é usado no dia a dia no Brasil (bancada, balcão ou oficina limpa), luz natural',
  'em close, com o fundo desfocado e uma peça ou objeto relacionado bem de leve atrás, luz quente',
] as const;

export interface EstiloDaImagem {
  /** As cores da marca (hex), para a imagem combinar com o slide. */
  paleta: string[];
  /** O que a referência de estilo tem (composição, luz, clima), quando há uma. */
  referencia?: string | null;
}

// v151: a cor da marca entra na cena (objetos, luz, roupa, parede), cheia e viva, e não "sem saturar":
// era isso que deixava as fotos apagadas, de banco de imagens.
const linhaPaleta = (e: EstiloDaImagem) =>
  e.paleta.length
    ? `BRAND COLOR: bring these brand colors into the scene itself (props, light, wardrobe, walls), vivid and intentional: ${e.paleta.join(', ')}.`
    : '';
const linhaReferencia = (e: EstiloDaImagem) =>
  e.referencia ? `STYLE REFERENCE (não copie nada, só o clima e a composição): ${e.referencia}` : '';

/** v148: peça que fala de uma cidade: a imagem é o cartão-postal dela, pelo nome (dá para reconhecer o lugar). */
export const CARTAO_POSTAL =
  'Se a peça fala de uma cidade ou bairro, a cena é o cartão-postal dele pelo nome (ex.: Brasília → "o Congresso Nacional visto da Esplanada dos Ministérios, ao entardecer"; Salvador → "o Elevador Lacerda e a Baía de Todos-os-Santos"), nunca "uma cidade" genérica: quem vê tem que reconhecer o lugar.';

/**
 * v156: pessoas liberadas nas imagens geradas (pedido do Leonardo: gente que combina com a publicação,
 * em boa qualidade). Continua de fora: pessoa real ou famosa, criança, e gente com defeito de imagem
 * gerada (o revisor visual reprova rosto ou mão deformados).
 */
export const PESSOAS_NA_IMAGEM =
  'PEOPLE: people are welcome when they fit the scene, including faces in the foreground: adults who look Brazilian, natural expression and pose, real skin texture, natural eyes and teeth, correct hands with five fingers. Never a real or famous person, never children.';

const PROIBIDO =
  'Proibido: qualquer texto, letra, número, placa legível, logotipo, marca, marca d’água e moldura.';

/**
 * A imagem de um slide: a cena, a paleta e o espaço livre para o texto que o sistema escreve. v151: no
 * formato que a OpenAI recomenda para o GPT Image (uso, cena, assunto, detalhes de câmera e luz,
 * restrições), com "photorealistic" e fatos de fotografia em vez de adjetivos.
 */
export function promptDaImagemDoSlide(
  descricao: string,
  e: EstiloDaImagem,
  formato: FormatoPeca = 'feed',
): string {
  return [
    `USE CASE: photorealistic advertising photograph for a Brazilian brand's Instagram post, vertical ${formato === 'story' ? '9:16' : '4:5'}. It must look like a real campaign shoot by a professional photographer, not stock.`,
    `SCENE: ${descricao.trim()}.`,
    'SUBJECT AND FRAMING: one clear hero, sharp, filling the frame with intent; leave one calm, low-detail area (top or bottom third) where the text will be placed afterwards.',
    'CAMERA AND LIGHT: real photograph, professional photography, 35–50mm lens look, shallow depth of field, directional key light with soft fill, rich contrast, clean color grading.',
    linhaPaleta(e),
    linhaReferencia(e),
    `PLACE: people, streets, cars and shops look Brazilian. ${CARTAO_POSTAL}`,
    PESSOAS_NA_IMAGEM,
    `CONSTRAINTS: ${PROIBIDO} No illustration look, no plastic CGI look, no generic stock-photo look.`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** O produto da foto num cenário novo: o produto fica exatamente igual. */
export function promptDoCenario(cena: string, e: EstiloDaImagem, formato: FormatoPeca = 'feed'): string {
  return [
    'Use a foto enviada como referência do produto.',
    'O produto continua EXATAMENTE igual: mesma forma, cor, proporção, peças, acabamento e o que estiver escrito nele. Não redesenhe, não troque nada no produto.',
    `Troque só o fundo, a luz e o ambiente: o produto ${cena}.`,
    `Fotografia realista de produto, formato ${proporcao(formato)}, o produto inteiro e nítido, com espaço livre acima ou abaixo para texto.`,
    linhaPaleta(e),
    linhaReferencia(e),
    'Proibido: texto novo, letras, números, logotipo ou marca que não estejam no próprio produto, marca d’água, moldura, pessoas.',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * v153: a âncora de estilo do carrossel. A primeira imagem gerada vai como referência das seguintes,
 * para o carrossel parecer uma peça só (mesma luz, cor, lente e clima), com outra cena.
 */
export const LINHA_DA_ANCORA =
  'STYLE ANCHOR: the input image is another slide of this same carousel. Create a NEW photograph of the scene described above (different subject and composition) that clearly belongs to the same shoot: same color palette, lighting direction and quality, lens look, color grading and mood. Do not copy its subject, framing or any object from it.';

export async function gerarImagemDoSlide(
  cfg: ConfigImagem,
  descricao: string,
  e: EstiloDaImagem,
  formato: FormatoPeca = 'feed',
  estiloDe: Uint8Array | null = null,
) {
  return pedirImagem(cfg, {
    prompt: estiloDe
      ? `${promptDaImagemDoSlide(descricao, e, formato)}\n${LINHA_DA_ANCORA}`
      : promptDaImagemDoSlide(descricao, e, formato),
    ...tamanhoDaImagem(formato),
    ...(estiloDe ? { referencia: estiloDe } : {}),
  });
}

export async function gerarCenario(
  cfg: ConfigImagem,
  produto: Uint8Array,
  cena: string,
  e: EstiloDaImagem,
  formato: FormatoPeca = 'feed',
) {
  return pedirImagem(cfg, {
    prompt: promptDoCenario(cena, e, formato),
    ...tamanhoDaImagem(formato),
    referencia: produto,
  });
}

/** A cena da conferência da foto melhorada (o revisor visual compara com a original). */
export const CENA_MELHORADA =
  'com a luz, a cor, a nitidez e o fundo tratados, o mesmo assunto e o mesmo enquadramento';

/**
 * v144: a mesma foto, melhorada: luz, cor, nitidez e um fundo limpo, sem mudar o assunto (o produto,
 * a fachada, a equipe, o carro). O revisor visual confere que o assunto ficou igual.
 */
export function promptDaFotoMelhorada(formato: FormatoPeca = 'feed'): string {
  return [
    'Use a foto enviada e devolva A MESMA FOTO, tratada como por um fotógrafo profissional.',
    'O assunto continua EXATAMENTE igual: mesmas pessoas, mesmo produto, mesma forma, cor, proporção, peças e o que estiver escrito nele. Não invente nem tire nada do assunto.',
    'Melhore: luz equilibrada, cores naturais e vivas, nitidez, ruído limpo, horizonte reto; tire do fundo o que distrai (fios, lixo, bagunça), deixando o fundo limpo e coerente com o lugar.',
    `Formato ${proporcao(formato)}: se precisar, estenda o fundo de forma natural para preencher, sem cortar o assunto.`,
    'Proibido: texto novo, letra, número, logotipo ou marca que não estejam na foto, marca d’água, moldura, aparência de ilustração.',
  ].join('\n');
}

export async function melhorarFoto(cfg: ConfigImagem, foto: Uint8Array, formato: FormatoPeca = 'feed') {
  return pedirImagem(cfg, {
    prompt: promptDaFotoMelhorada(formato),
    ...tamanhoDaImagem(formato),
    referencia: foto,
  });
}

/** A imagem do slide passa pelo mesmo revisor de visão das imagens dos vídeos. */
export const conferirImagemDoSlide = conferirImagem;

const ESQUEMA_CENARIO = {
  type: 'object',
  properties: {
    produto_igual: {
      type: 'boolean',
      description: 'O produto da segunda imagem é o mesmo da primeira: forma, cor, peças e detalhes iguais.',
    },
    texto_novo: {
      type: 'boolean',
      description: 'Aparece texto, letra ou número que NÃO está no produto da primeira imagem.',
    },
    marca_estranha: {
      type: 'boolean',
      description: 'Aparece logotipo ou marca que não está no produto da primeira imagem.',
    },
    defeito: { type: 'boolean', description: 'Partes derretidas, deformadas ou sem sentido.' },
    combina: { type: 'boolean', description: 'O fundo e a luz são os da cena pedida.' },
    problemas: { type: 'array', items: { type: 'string' }, description: 'Cada problema em uma frase curta.' },
  },
  required: ['produto_igual', 'texto_novo', 'marca_estranha', 'defeito', 'combina', 'problemas'],
} as const;

/** O revisor visual compara o produto da foto com o do cenário: igual, sem texto nem marca estranha. */
export async function conferirCenario(
  claude: ClienteClaude,
  e: { original: Uint8Array; gerada: Uint8Array; cena: string },
): Promise<{ aprovada: boolean; problemas: string[] }> {
  const r = await claude.pedir({
    agente: 'revisor de imagem',
    leve: true,
    sistema: [
      {
        texto:
          'Você confere imagens geradas por IA antes de entrarem no post de uma empresa. A primeira imagem é a foto real do produto; a segunda, o produto num cenário novo. Seja rigoroso: produto diferente, texto ou marca que não existem no produto, ou defeito reprovam.',
      },
    ],
    imagens: [
      {
        tipo: 'image/jpeg',
        base64: Buffer.from(e.original).toString('base64'),
        legenda: 'A foto real do produto:',
      },
      { tipo: 'image/jpeg', base64: Buffer.from(e.gerada).toString('base64'), legenda: 'O cenário gerado:' },
    ],
    mensagem: `A cena pedida: o produto ${e.cena}. Confira.`,
    ferramenta: {
      nome: 'conferir_cenario',
      descricao: 'O resultado da conferência.',
      esquema: ESQUEMA_CENARIO,
    },
    maxTokens: 600,
    temperatura: 0,
    timeoutMs: 90_000,
  });
  const d = r.dados;
  const problemas = (Array.isArray(d.problemas) ? d.problemas : []).map((p) => String(p).slice(0, 160));
  const aprovada =
    d.produto_igual === true && !d.texto_novo && !d.marca_estranha && !d.defeito && d.combina !== false;
  if (!aprovada && !problemas.length) {
    if (d.produto_igual !== true) problemas.push('O produto ficou diferente da foto.');
    if (d.texto_novo) problemas.push('Apareceu texto que não está no produto.');
    if (d.marca_estranha) problemas.push('Apareceu uma marca que não está no produto.');
    if (d.defeito) problemas.push('A imagem tem um defeito.');
    if (d.combina === false) problemas.push('O fundo não é o da cena pedida.');
  }
  return { aprovada, problemas };
}

const ESQUEMA_REFERENCIA = {
  type: 'object',
  properties: {
    estilo: {
      type: 'string',
      description:
        'Em até 60 palavras: composição (onde fica o assunto e o texto), luz, clima, tipo de foto e cores dominantes. Sem descrever logotipo, texto escrito, marca ou pessoa identificável.',
    },
  },
  required: ['estilo'],
} as const;

/** Lê o post de referência: o que ele tem de estilo (para inspirar, nunca para copiar). */
export async function descreverReferencia(claude: ClienteClaude, jpeg: Uint8Array): Promise<string> {
  const r = await claude.pedir({
    agente: 'descrição das fotos',
    leve: true,
    sistema: [
      {
        texto:
          'Você é diretor de arte. Descreva o estilo visual de um post de referência para outro designer se inspirar, sem copiar: o que importa é a composição, a luz e o clima, não o conteúdo nem a marca de quem fez.',
      },
    ],
    imagens: [{ tipo: 'image/jpeg', base64: Buffer.from(jpeg).toString('base64') }],
    mensagem: 'Descreva o estilo deste post.',
    ferramenta: { nome: 'estilo_da_referencia', descricao: 'O estilo do post.', esquema: ESQUEMA_REFERENCIA },
    maxTokens: 300,
    temperatura: 0.2,
    timeoutMs: 60_000,
  });
  return String(r.dados.estilo ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

/* ───────────────────────────── v148: aprender com o Instagram da empresa ───────────────────────────── */

export interface JeitoDePostar {
  cores: { principal: string; destaque: string; claro: string; texto: string };
  estilo: EstiloCarrossel;
  fontes: ParFontes;
  /** Como a empresa posta, para o time seguir (composição, fotos, tipografia, selos, palavras marcadas). */
  jeito: string;
  /** Por que estas escolhas, em uma ou duas frases (a tela mostra). */
  motivo: string;
}

const HEX = /^#[0-9a-f]{6}$/i;

const ESQUEMA_JEITO = {
  type: 'object',
  properties: {
    principal: { type: 'string', description: 'A cor que mais aparece como fundo ou marca (hex #RRGGBB).' },
    destaque: { type: 'string', description: 'A cor de destaque: palavras, selos, botões (hex #RRGGBB).' },
    claro: {
      type: 'string',
      description: 'O fundo claro que a marca usa, ou um tom bem claro da principal (hex).',
    },
    texto: { type: 'string', description: 'A cor do texto sobre fundo claro (hex, bem escura).' },
    estilo: {
      type: 'string',
      enum: [...ESTILOS],
      description: `O estilo que mais se parece com os posts: ${ESTILOS.map((e) => `${e} (${ESTILO[e].descricao})`).join('; ')}`,
    },
    fontes: {
      type: 'string',
      enum: [...PARES_FONTES],
      description: `O par de fontes mais parecido com os títulos: ${PARES_FONTES.map((p) => `${p} (${FONTES_DO_PAR[p].nome})`).join('; ')}`,
    },
    jeito: {
      type: 'string',
      description:
        'De 60 a 160 palavras, para um designer seguir: o que costuma ter de fundo, como entram as fotos (pessoas, produto, ambiente, ponta a ponta ou em quadro), como é o título (caixa alta ou não, peso, palavras coloridas), selos, botões, ícones, onde fica a logo e o clima geral. Sem nomes de pessoas, sem copiar frases dos posts.',
    },
    motivo: { type: 'string', description: 'Em até 2 frases, o que levou a estas escolhas.' },
  },
  required: ['principal', 'destaque', 'claro', 'texto', 'estilo', 'fontes', 'jeito', 'motivo'],
} as const;

/**
 * Lê os posts recentes da empresa (as imagens) e devolve o jeito de postar dela: as cores, o estilo e
 * as fontes mais parecidos e uma descrição para o time seguir. Só sugere: a pessoa confere e aplica.
 */
export async function lerJeitoDePostar(
  claude: ClienteClaude,
  posts: { jpeg: Uint8Array; legenda?: string | null }[],
  atual: { principal: string; destaque: string; claro: string; texto: string },
): Promise<JeitoDePostar> {
  const r = await claude.pedir({
    agente: 'diretor de arte',
    sistema: [
      {
        texto:
          'Você é diretor de arte de uma agência. Olha o feed de uma empresa e descreve, com precisão de quem vai continuar o trabalho, como ela posta: cores, tipografia, composição e uso de fotos. Você descreve o estilo; não copia nada.',
      },
    ],
    imagens: posts.map((p, i) => ({
      tipo: 'image/jpeg' as const,
      base64: Buffer.from(p.jpeg).toString('base64'),
      legenda: `Post ${i + 1} do feed da empresa:`,
    })),
    mensagem: `Estes são os ${posts.length} posts mais recentes do Instagram da empresa. As cores que estão cadastradas hoje: principal ${atual.principal}, destaque ${atual.destaque}, claro ${atual.claro}, texto ${atual.texto} (troque se os posts mostrarem outras). Descreva o jeito de postar.`,
    ferramenta: {
      nome: 'jeito_de_postar',
      descricao: 'O jeito de postar da empresa.',
      esquema: ESQUEMA_JEITO,
    },
    maxTokens: 900,
    temperatura: 0.2,
    timeoutMs: 120_000,
  });
  const d = r.dados;
  const cor = (v: unknown, padrao: string) =>
    HEX.test(String(v ?? '').trim()) ? String(v).trim().toUpperCase() : padrao;
  const estilo = (ESTILOS as readonly string[]).includes(String(d.estilo))
    ? (d.estilo as EstiloCarrossel)
    : 'vivo';
  const fontes = (PARES_FONTES as readonly string[]).includes(String(d.fontes))
    ? (d.fontes as ParFontes)
    : 'moderno';
  const limpo = (t: unknown, max: number) =>
    String(t ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max);
  return {
    cores: {
      principal: cor(d.principal, atual.principal),
      destaque: cor(d.destaque, atual.destaque),
      claro: cor(d.claro, atual.claro),
      texto: cor(d.texto, atual.texto),
    },
    estilo,
    fontes,
    jeito: limpo(d.jeito, 1500),
    motivo: limpo(d.motivo, 300),
  };
}
