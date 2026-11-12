import { MANUAL_DESIGN } from '../saber/design.js';
import { type ConfigImagem, pedirImagem } from '../videos/imagens.js';
import type { ClienteClaude } from './claude.js';

/**
 * v152: a peça "em camadas". A IA de imagem faz só o que não tem letra: tira o fundo da foto da empresa
 * (a pessoa ou o produto ficam iguais) e devolve um PNG transparente. O texto, a cor da marca e a logo
 * são postos pelo sistema, com as fontes medidas, então nenhuma letra sai errada e trocar a foto não
 * mexe no resto. O recorte passa por duas conferências: o código confere a transparência e um modelo
 * de visão compara o assunto com a foto original.
 */

/**
 * O sharp é carregado só na hora de usar: o worker-videos empacota este pacote e não tem o sharp
 * instalado (um import no topo derrubava o serviço ao subir, na v152).
 */
const carregarSharp = async () => (await import('sharp')).default;

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
  const sharp = await carregarSharp();
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
  const sharp = await carregarSharp();
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

/* ───────────────────────────── v153: a revisora olha as opções prontas ───────────────────────────── */

export interface NotaDaOpcao {
  /** De 1 a 5, com uma casa. */
  nota: number;
  comentario: string;
}

const ESQUEMA_OPCOES = {
  type: 'object',
  properties: {
    opcoes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          opcao: { type: 'integer', description: 'O número da opção, como na legenda da imagem.' },
          nota: {
            type: 'number',
            description:
              'De 1 a 5, com uma casa: a peça como post de agência, vista no celular (5: pronta para publicar).',
          },
          comentario: {
            type: 'string',
            description:
              'Uma ou duas frases para o dono da empresa, em português simples: o que funciona e o que atrapalha nesta opção (leitura, o que o olho vê primeiro, a foto, o equilíbrio). Sem termos de design.',
          },
          sobreposto: {
            type: 'boolean',
            description:
              'Algum texto, botão ou enfeite está por cima da foto, do produto ou de outro texto (ou cortado na borda).',
          },
        },
        required: ['opcao', 'nota', 'comentario', 'sobreposto'],
      },
    },
  },
  required: ['opcoes'],
} as const;

/** Lê as notas: uma por opção, na ordem das imagens; resposta incompleta devolve null (a tela fica sem nota). */
export function lerNotasDasOpcoes(d: Record<string, unknown>, quantas: number): NotaDaOpcao[] | null {
  const lista = Array.isArray(d.opcoes) ? (d.opcoes as Record<string, unknown>[]) : [];
  const notas: NotaDaOpcao[] = [];
  for (let k = 1; k <= quantas; k++) {
    const o = lista.find((x) => Number(x.opcao) === k);
    const nota = Number(o?.nota);
    if (!o || !Number.isFinite(nota)) return null;
    notas.push({
      // Peça com sobreposição nunca passa de 2: é o defeito mais grave.
      nota: Math.round(Math.min(o.sobreposto === true ? 2 : 5, Math.max(1, nota)) * 10) / 10,
      comentario: String(o.comentario ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 240),
    });
  }
  return notas;
}

/** A opção que a revisora prefere: a de maior nota (no empate, a primeira). */
export const opcaoPreferida = (notas: NotaDaOpcao[]): number =>
  notas.reduce((melhor, n, k) => (n.nota > notas[melhor]!.nota ? k : melhor), 0);

/**
 * A revisora olha as opções de um card já prontas (as imagens finais), como um designer olharia, e dá
 * a nota de cada uma. O texto já foi conferido antes: aqui é só a peça (leitura, hierarquia, foto).
 */
export async function avaliarOpcoes(
  claude: ClienteClaude,
  e: { empresa: string; objetivo: string; opcoes: Uint8Array[] },
): Promise<NotaDaOpcao[] | null> {
  if (e.opcoes.length < 2) return null;
  const r = await claude.pedir({
    agente: 'revisor de arte',
    sistema: [
      {
        texto:
          'Você é a revisora final de uma agência brasileira. Olha posts de Instagram prontos, no tamanho do celular, e diz com franqueza qual funciona melhor: o que o olho vê primeiro, se o número e o título se leem em um segundo, se a foto ajuda a mensagem, se a peça está equilibrada. Compara as opções entre si; não dá a mesma nota por educação.',
      },
      { texto: MANUAL_DESIGN, cache: true },
    ],
    imagens: e.opcoes.map((jpeg, k) => ({
      tipo: 'image/jpeg' as const,
      base64: Buffer.from(jpeg).toString('base64'),
      legenda: `Opção ${k + 1}:`,
    })),
    mensagem: `São ${e.opcoes.length} opções do mesmo post da ${e.empresa}. Objetivo: ${e.objetivo}. Dê a nota e o comentário de cada uma.`,
    ferramenta: { nome: 'avaliar_opcoes', descricao: 'A nota de cada opção.', esquema: ESQUEMA_OPCOES },
    maxTokens: 700,
    temperatura: 0.2,
    timeoutMs: 90_000,
  });
  return lerNotasDasOpcoes(r.dados, e.opcoes.length);
}

/* ───────────────────────────── v153: os elementos em 3D ───────────────────────────── */

const ESQUEMA_ELEMENTO = {
  type: 'object',
  properties: {
    objeto: {
      type: 'string',
      description:
        'Em inglês, um único objeto físico e concreto que simboliza a oferta ou o assunto (ex.: "a car brake disc", "a delivery box", "a wrench"). Sem pessoas, sem texto, sem marcas, sem símbolos de moeda com letras.',
    },
  },
  required: ['objeto'],
} as const;

/** O diretor de arte escolhe o objeto que enfeita a peça (um só, concreto, ligado à mensagem). */
export async function escolherElemento(
  claude: ClienteClaude,
  e: { empresa: string; titulo: string; destaque: string; texto: string },
): Promise<string | null> {
  const r = await claude.pedir({
    agente: 'diretor de arte',
    sistema: [
      {
        texto:
          'Você é diretor de arte. Para um post de Instagram, escolhe UM objeto em 3D que enfeita a peça ao lado da foto: concreto, fácil de reconhecer pequeno, ligado ao que o post vende ou ensina. Nunca um objeto genérico (estrela, raio, coração) quando existe um do assunto.',
      },
      { texto: MANUAL_DESIGN, cache: true },
    ],
    mensagem: `Post da ${e.empresa}. Título: "${e.titulo}". ${e.destaque ? `Número em destaque: "${e.destaque}". ` : ''}${e.texto ? `Texto: "${e.texto}".` : ''} Escolha o objeto.`,
    ferramenta: { nome: 'elemento_da_peca', descricao: 'O objeto da peça.', esquema: ESQUEMA_ELEMENTO },
    maxTokens: 200,
    temperatura: 0.5,
    esforco: 'baixo',
    timeoutMs: 45_000,
  });
  const objeto = String(r.dados.objeto ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return objeto.length >= 3 ? objeto : null;
}

export function promptDoElemento(objeto: string, cor: string): string {
  return [
    `A single 3D rendered object: ${objeto}.`,
    `STYLE: clean modern 3D illustration for a brand social post, smooth glossy material, soft studio light from the top left, gentle shading, seen from a slight three-quarter angle. Main color ${cor} with lighter and darker tones of the same color; at most one neutral secondary tone.`,
    'FRAMING: the whole object, centered, with padding around it, on a fully transparent background (alpha channel).',
    'CONSTRAINTS: no text, letters or numbers anywhere; no logos or brand marks; no people or hands; no ground, no cast shadow, no background, no frame, no checkerboard pattern.',
  ].join('\n');
}

/** O objeto em 3D, em PNG transparente (quadrado). */
export async function gerarElemento(cfg: ConfigImagem, objeto: string, cor: string): Promise<Uint8Array> {
  return pedirImagem(cfg, {
    prompt: promptDoElemento(objeto, cor),
    largura: 1024,
    altura: 1024,
    transparente: true,
  });
}

/* ───────────────────────────── v155: o acabamento do recorte ───────────────────────────── */

export interface RecorteAcabado {
  png: Uint8Array;
  /** A margem (px) posta em volta do recorte para caber a sombra ou o contorno. */
  folga: number;
}

/**
 * O acabamento que faz o recorte parecer pousado na peça, e não colado: uma sombra suave atrás dele
 * ou um contorno branco de adesivo (com uma sombra leve). Feito no servidor, sem IA, a partir do
 * canal de transparência do próprio recorte. A imagem ganha uma margem em volta (`folga`).
 */
export async function acabarRecorte(png: Uint8Array, tipo: 'sombra' | 'contorno'): Promise<RecorteAcabado> {
  const sharp = await carregarSharp();
  const meta = await sharp(Buffer.from(png)).metadata();
  const L = meta.width ?? 0;
  const A = meta.height ?? 0;
  if (!L || !A || !meta.hasAlpha) return { png, folga: 0 };
  const maior = Math.max(L, A);
  const folga = Math.round(maior * 0.05);
  const largura = L + folga * 2;
  const altura = A + folga * 2;
  const base = await sharp(Buffer.from(png))
    .extend({
      top: folga,
      bottom: folga,
      left: folga,
      right: folga,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  const alfa = () => sharp(base).extractChannel('alpha');
  /** Uma camada de uma cor só, com a transparência dada (cinza: 0 some, 255 cheio). */
  const camada = async (mascara: Buffer, cor: { r: number; g: number; b: number }) =>
    sharp({ create: { width: largura, height: altura, channels: 3, background: cor } })
      .joinChannel(mascara, { raw: { width: largura, height: altura, channels: 1 } })
      .png()
      .toBuffer();
  const cinza = (s: ReturnType<typeof alfa>) => s.toColourspace('b-w').raw().toBuffer();
  const camadas: { input: Buffer; left: number; top: number }[] = [];
  if (tipo === 'contorno') {
    // O contorno: a transparência "engordada" (borrada e cortada), pintada de branco.
    const raio = Math.max(6, Math.round(maior * 0.014));
    // Borrar e depois cortar baixo "engorda" a silhueta; um borrão leve no fim alisa a borda. Cada passo
    // numa imagem própria: no mesmo encadeamento o sharp corta antes de borrar.
    const cru = (b: Buffer) => sharp(b, { raw: { width: largura, height: altura, channels: 1 } });
    // A mediana tira os pontinhos soltos da máscara (senão cada um viraria uma bolinha branca).
    const limpo = await cinza(alfa().median(7));
    const borrado = await cinza(cru(limpo).blur(raio));
    const cortado = await cinza(cru(borrado).threshold(8));
    const gordo = await cinza(cru(cortado).blur(1.2));
    const sombra = await cinza(
      sharp(gordo, { raw: { width: largura, height: altura, channels: 1 } })
        .blur(Math.max(4, raio))
        .linear(0.28, 0),
    );
    camadas.push({ input: await camada(sombra, { r: 0, g: 0, b: 0 }), left: 0, top: Math.round(raio * 0.8) });
    camadas.push({ input: await camada(gordo, { r: 255, g: 255, b: 255 }), left: 0, top: 0 });
  } else {
    const sombra = await cinza(
      alfa()
        .blur(Math.max(6, Math.round(maior * 0.016)))
        .linear(0.38, 0),
    );
    camadas.push({
      input: await camada(sombra, { r: 0, g: 0, b: 0 }),
      left: 0,
      top: Math.round(maior * 0.014),
    });
  }
  const saida = await sharp({
    create: { width: largura, height: altura, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([...camadas, { input: base, left: 0, top: 0 }])
    .png({ compressionLevel: 8 })
    .toBuffer();
  return { png: new Uint8Array(saida), folga };
}
