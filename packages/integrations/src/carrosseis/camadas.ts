import sharp from 'sharp';
import { type ConfigImagem, pedirImagem } from '../videos/imagens.js';
import type { ClienteClaude } from './claude.js';

/**
 * v152: a peça "em camadas". A IA de imagem faz só o que não tem letra: tira o fundo da foto da empresa
 * (a pessoa ou o produto ficam iguais) e devolve um PNG transparente. O texto, a cor da marca e a logo
 * são postos pelo sistema, com as fontes medidas, então nenhuma letra sai errada e trocar a foto não
 * mexe no resto. O recorte passa por duas conferências: o código confere a transparência e um modelo
 * de visão compara o assunto com a foto original.
 */

/** O recorte é pedido em pé, com folga (lados múltiplos de 16). */
export const TAMANHO_RECORTE = { largura: 1024, altura: 1536 } as const;

export function promptDoRecorte(): string {
  return [
    'Extract the main subject of the input photo (the person, the group of people or the product) onto a fully transparent background.',
    'KEEP EXACTLY AS IN THE PHOTO: every face, body, pose, clothing, uniform, product shape, colors, labels and anything written on the subject. Do not redraw, beautify, restyle or complete anything that is not in the photo.',
    'REMOVE: the whole background and floor, other objects and people that are not the main subject, shadows on the ground.',
    'FRAMING: the subject whole and centered, as large as possible, clean precise edges (hair, fingers, product contours), no halo, no glow, no outline, no drop shadow.',
    'CONSTRAINTS: no added text, no logo, no watermark, no frame, no checkerboard pattern. The background must be real transparency (alpha channel).',
  ].join('\n');
}

/** O PNG transparente da foto (pode recusar: modelo sem transparência, moderação). */
export async function recortarFoto(cfg: ConfigImagem, foto: Uint8Array): Promise<Uint8Array> {
  return pedirImagem(cfg, {
    prompt: promptDoRecorte(),
    ...TAMANHO_RECORTE,
    referencia: foto,
    transparente: true,
  });
}

export interface RecorteAparado {
  png: Uint8Array;
  largura: number;
  altura: number;
  /** A parte da imagem que ficou transparente (0 a 1), antes de aparar. */
  transparente: number;
}

/**
 * Confere a transparência de verdade (um tabuleiro desenhado não é transparência) e apara as bordas
 * vazias, para a peça saber o tamanho exato do assunto. Reprova (null) quando quase nada ficou
 * transparente (o fundo não saiu) ou quase tudo ficou (o assunto sumiu).
 */
export async function apararRecorte(png: Uint8Array): Promise<RecorteAparado | null> {
  const img = sharp(Buffer.from(png), { failOn: 'error' });
  const meta = await img.metadata();
  if (!meta.hasAlpha || !meta.width || !meta.height) return null;
  const alfa = await img.clone().extractChannel('alpha').raw().toBuffer();
  let vazios = 0;
  for (let i = 0; i < alfa.length; i++) if (alfa[i]! < 16) vazios++;
  const transparente = vazios / Math.max(1, alfa.length);
  if (transparente < 0.12 || transparente > 0.93) return null;
  const { data, info } = await img
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
    .png({ compressionLevel: 9 })
    .toBuffer({ resolveWithObject: true });
  if (info.width < 160 || info.height < 160) return null;
  return { png: new Uint8Array(data), largura: info.width, altura: info.height, transparente };
}

/** O recorte sobre um fundo liso, em JPEG, para o modelo de visão comparar com a foto. */
export async function recorteParaConferir(png: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp(Buffer.from(png))
      .flatten({ background: '#8a8f98' })
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 86 })
      .toBuffer(),
  );
}

const ESQUEMA_RECORTE = {
  type: 'object',
  properties: {
    assunto_igual: {
      type: 'boolean',
      description:
        'A pessoa ou o produto do recorte é o mesmo da foto: rosto, corpo, roupa, forma, cores e o que está escrito iguais (nada redesenhado).',
    },
    inteiro: {
      type: 'boolean',
      description:
        'O assunto principal está inteiro como na foto (sem cabeça, braço ou parte do produto cortados pelo recorte).',
    },
    fundo_limpo: {
      type: 'boolean',
      description:
        'Não sobrou pedaço do fundo da foto em volta do assunto (o cinza liso é o fundo da conferência).',
    },
    defeito: {
      type: 'boolean',
      description: 'Bordas serrilhadas ou com halo forte, mãos ou rosto deformados, partes inventadas.',
    },
    texto_novo: { type: 'boolean', description: 'Apareceu texto, logotipo ou marca que não está na foto.' },
    isolavel: {
      type: 'boolean',
      description:
        'O assunto faz sentido recortado: é uma pessoa, um grupo, um veículo ou um produto/objeto. Falso para paisagem, fachada, rua ou ambiente inteiro.',
    },
    problemas: { type: 'array', items: { type: 'string' }, description: 'Cada problema em uma frase curta.' },
  },
  required: ['assunto_igual', 'inteiro', 'fundo_limpo', 'defeito', 'texto_novo', 'isolavel', 'problemas'],
} as const;

export function avaliarRecorte(d: Record<string, unknown>): { aprovada: boolean; problemas: string[] } {
  const aprovada =
    d.assunto_igual === true &&
    d.inteiro !== false &&
    d.fundo_limpo !== false &&
    d.isolavel !== false &&
    !d.defeito &&
    !d.texto_novo;
  const problemas = (Array.isArray(d.problemas) ? d.problemas : []).map((p) => String(p).slice(0, 160));
  if (!aprovada && !problemas.length) {
    if (d.assunto_igual !== true) problemas.push('O assunto ficou diferente da foto.');
    if (d.inteiro === false) problemas.push('O recorte cortou parte do assunto.');
    if (d.fundo_limpo === false) problemas.push('Sobrou fundo em volta do assunto.');
    if (d.defeito) problemas.push('O recorte tem defeito.');
    if (d.texto_novo) problemas.push('Apareceu texto ou marca que não está na foto.');
    if (d.isolavel === false) problemas.push('Esta foto é de um lugar inteiro: não serve para recortar.');
  }
  return { aprovada, problemas: aprovada ? [] : problemas };
}

/** O revisor visual compara a foto com o recorte: o mesmo assunto, inteiro, sem sobra de fundo. */
export async function conferirRecorte(
  claude: ClienteClaude,
  e: { original: Uint8Array; recorte: Uint8Array },
): Promise<{ aprovada: boolean; problemas: string[] }> {
  const r = await claude.pedir({
    agente: 'revisor de imagem',
    sistema: [
      {
        texto:
          'Você confere o recorte de uma foto antes de ele entrar no post de uma empresa. A primeira imagem é a foto real; a segunda, o assunto recortado sobre um fundo cinza liso. Seja rigoroso: pessoa ou produto diferente do da foto, parte cortada, sobra de fundo ou defeito reprovam.',
      },
    ],
    imagens: [
      { tipo: 'image/jpeg', base64: Buffer.from(e.original).toString('base64'), legenda: 'A foto real:' },
      { tipo: 'image/jpeg', base64: Buffer.from(e.recorte).toString('base64'), legenda: 'O recorte:' },
    ],
    mensagem: 'Compare o recorte com a foto e confira.',
    ferramenta: {
      nome: 'conferir_recorte',
      descricao: 'O resultado da conferência.',
      esquema: ESQUEMA_RECORTE,
    },
    maxTokens: 600,
    temperatura: 0,
    esforco: 'baixo',
    timeoutMs: 90_000,
  });
  return avaliarRecorte(r.dados);
}
