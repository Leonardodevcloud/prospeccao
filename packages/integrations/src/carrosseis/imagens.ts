import type { FormatoPeca } from '@prospeccao/shared/carrosseis';
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

const linhaPaleta = (e: EstiloDaImagem) =>
  e.paleta.length
    ? `Paleta: use tons que combinem com estas cores da marca (${e.paleta.join(', ')}), sem saturar.`
    : '';
const linhaReferencia = (e: EstiloDaImagem) =>
  e.referencia
    ? `Inspire-se só no clima e na composição desta referência (não copie nada): ${e.referencia}`
    : '';

const PROIBIDO =
  'Proibido: qualquer texto, letra, número, placa legível, logotipo, marca, marca d’água e moldura. Sem rosto de pessoa em destaque (pessoas só de costas, de longe ou só as mãos).';

/** A imagem de um slide: a cena, a paleta e o espaço livre para o texto que o sistema escreve. */
export function promptDaImagemDoSlide(
  descricao: string,
  e: EstiloDaImagem,
  formato: FormatoPeca = 'feed',
): string {
  return [
    `Fotografia realista e profissional para um post do Instagram ${proporcao(formato)}, como foto de campanha.`,
    `Cena: ${descricao.trim()}.`,
    'Composição: o assunto principal nítido, com uma área calma e sem detalhes (em cima ou embaixo) onde vai entrar o texto.',
    linhaPaleta(e),
    linhaReferencia(e),
    'Cenário brasileiro quando houver lugar, rua, carro ou loja.',
    PROIBIDO,
    'Cores naturais, nitidez boa, sem aparência de ilustração.',
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

export async function gerarImagemDoSlide(
  cfg: ConfigImagem,
  descricao: string,
  e: EstiloDaImagem,
  formato: FormatoPeca = 'feed',
) {
  return pedirImagem(cfg, {
    prompt: promptDaImagemDoSlide(descricao, e, formato),
    ...tamanhoDaImagem(formato),
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
