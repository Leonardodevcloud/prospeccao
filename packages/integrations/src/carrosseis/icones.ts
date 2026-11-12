/**
 * Ícones 3D prontos (v156): a biblioteca aberta 3dicons (realvjy, licença CC0 — domínio público).
 * Quando o assunto do post tem um ícone pronto, a peça usa o pronto em vez de pagar uma imagem
 * nova: sai de graça, sai igual toda vez e combina com as outras peças da empresa. O arquivo é
 * baixado na hora do endereço público da biblioteca e tingido com a cor de destaque da marca;
 * se o endereço não responder, o sistema volta a pedir o objeto à IA de imagens.
 */
import { AppError } from '@prospeccao/shared';

/** `slug` é o nome do arquivo na biblioteca (com os erros de grafia de lá); `nome` é o que o diretor de arte lê. */
export const ICONES_PRONTOS = [
  { slug: '3d-coin', nome: 'moeda' },
  { slug: 'bag', nome: 'sacola de compras' },
  { slug: 'battery', nome: 'bateria' },
  { slug: 'bookmark', nome: 'marcador de página' },
  { slug: 'brush', nome: 'pincel' },
  { slug: 'bucket', nome: 'balde de tinta' },
  { slug: 'bulb', nome: 'lâmpada (ideia)' },
  { slug: 'calculator', nome: 'calculadora' },
  { slug: 'calender', nome: 'calendário' },
  { slug: 'camera', nome: 'câmera fotográfica' },
  { slug: 'card', nome: 'cartão de crédito' },
  { slug: 'chart', nome: 'gráfico de barras' },
  { slug: 'chat-bubble', nome: 'balão de conversa' },
  { slug: 'chat-text', nome: 'balão de mensagem com texto' },
  { slug: 'chess', nome: 'peça de xadrez (estratégia)' },
  { slug: 'clock', nome: 'relógio' },
  { slug: 'color-palette', nome: 'paleta de cores' },
  { slug: 'computer', nome: 'computador' },
  { slug: 'crow', nome: 'coroa' },
  { slug: 'cup', nome: 'taça de campeão' },
  { slug: 'dollar', nome: 'cifrão' },
  { slug: 'file-text', nome: 'documento' },
  { slug: 'fire', nome: 'chama de fogo' },
  { slug: 'flag', nome: 'bandeira' },
  { slug: 'flash', nome: 'raio' },
  { slug: 'folder', nome: 'pasta de arquivos' },
  { slug: 'gift', nome: 'caixa de presente' },
  { slug: 'glass', nome: 'copo' },
  { slug: 'gym', nome: 'haltere de academia' },
  { slug: 'headphone', nome: 'fone de ouvido' },
  { slug: 'heart', nome: 'coração' },
  { slug: 'key', nome: 'chave' },
  { slug: 'lab', nome: 'frasco de laboratório' },
  { slug: 'link', nome: 'elo de corrente (link)' },
  { slug: 'location', nome: 'marcador de localização' },
  { slug: 'lock', nome: 'cadeado' },
  { slug: 'mail', nome: 'envelope de carta' },
  { slug: 'map-pin', nome: 'mapa com alfinete' },
  { slug: 'medal', nome: 'medalha' },
  { slug: 'megaphone', nome: 'megafone' },
  { slug: 'mic', nome: 'microfone' },
  { slug: 'mobile', nome: 'celular' },
  { slug: 'money-bag', nome: 'saco de dinheiro' },
  { slug: 'money', nome: 'maço de dinheiro' },
  { slug: 'moon', nome: 'lua' },
  { slug: 'music', nome: 'nota musical' },
  { slug: 'notebook', nome: 'caderno' },
  { slug: 'paint-brush', nome: 'pincel de pintura' },
  { slug: 'pencil', nome: 'lápis' },
  { slug: 'phone-ringing', nome: 'telefone tocando' },
  { slug: 'picture', nome: 'quadro com foto' },
  { slug: 'pin', nome: 'alfinete de mural' },
  { slug: 'puzzle', nome: 'peça de quebra-cabeça' },
  { slug: 'rocket', nome: 'foguete' },
  { slug: 'roll-brush', nome: 'rolo de pintura' },
  { slug: 'scissor', nome: 'tesoura' },
  { slug: 'setting', nome: 'engrenagem' },
  { slug: 'sheild', nome: 'escudo (proteção)' },
  { slug: 'star', nome: 'estrela' },
  { slug: 'sun', nome: 'sol' },
  { slug: 'takeaway-cup', nome: 'copo de café para viagem' },
  { slug: 'target', nome: 'alvo com flecha' },
  { slug: 'tea-cup', nome: 'xícara' },
  { slug: 'thumb-up', nome: 'mão com polegar para cima' },
  { slug: 'tick', nome: 'sinal de certo' },
  { slug: 'tool', nome: 'ferramentas (chave de boca)' },
  { slug: 'trash-can', nome: 'lixeira' },
  { slug: 'travel', nome: 'mala de viagem' },
  { slug: 'trophy', nome: 'troféu' },
  { slug: 'umbrella', nome: 'guarda-chuva' },
  { slug: 'video-camera', nome: 'câmera de vídeo' },
  { slug: 'wallet', nome: 'carteira' },
  { slug: 'wifi', nome: 'sinal de wi-fi' },
  { slug: 'zoom', nome: 'lupa' },
] as const;

export type SlugIcone = (typeof ICONES_PRONTOS)[number]['slug'];

export const SLUGS_ICONES: readonly string[] = ICONES_PRONTOS.map((i) => i.slug);

/** A lista que o diretor de arte recebe para escolher. */
export const LISTA_ICONES = ICONES_PRONTOS.map((i) => `${i.slug} = ${i.nome}`).join('; ');

export function iconePronto(slug: string): { slug: SlugIcone; nome: string } | null {
  return ICONES_PRONTOS.find((i) => i.slug === slug) ?? null;
}

/** Versão em argila clara, de frente e levemente girada: a que aceita tinta sem perder o volume. */
export function enderecoDoIcone(slug: SlugIcone): string {
  return `https://3dicons.sgp1.cdn.digitaloceanspaces.com/v1/dynamic/clay/${slug}-dynamic-clay.png`;
}

const ASSINATURA_PNG = [0x89, 0x50, 0x4e, 0x47];
const TAMANHO_MAXIMO = 6 * 1024 * 1024;

/** Baixa o ícone. Qualquer problema vira erro: quem chama cai na imagem feita pela IA. */
export async function baixarIcone(slug: SlugIcone, timeoutMs = 15_000): Promise<Uint8Array> {
  const r = await fetch(enderecoDoIcone(slug), { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new AppError(502, 'icone_indisponivel', `A biblioteca de ícones respondeu ${r.status}.`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  const png = ASSINATURA_PNG.every((b, i) => bytes[i] === b);
  if (!png || bytes.byteLength < 2000 || bytes.byteLength > TAMANHO_MAXIMO) {
    throw new AppError(502, 'icone_indisponivel', 'O arquivo do ícone não veio como esperado.');
  }
  return bytes;
}

function rgbDe(cor: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(cor.trim());
  const n = Number.parseInt(m?.[1] ?? '7c3aed', 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Tinge os pontos (RGBA cru) com a cor da marca guardando o volume: a claridade da argila vira a
 * claridade da cor, os brilhos puxam para o branco e as sombras para uma versão escura da própria
 * cor (nunca cinza, que deixaria o objeto sujo). A transparência não muda.
 */
export function tingirPontos(rgba: Uint8Array, cor: string): Uint8Array {
  const [cr, cg, cb] = rgbDe(cor);
  const saida = new Uint8Array(rgba.length);
  // A argila da biblioteca é clara (perto de 220): ali fica a cor cheia.
  const CHEIA = 0.84;
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3] ?? 0;
    saida[i + 3] = a;
    if (a === 0) continue;
    const l = (0.2126 * (rgba[i] ?? 0) + 0.7152 * (rgba[i + 1] ?? 0) + 0.0722 * (rgba[i + 2] ?? 0)) / 255;
    if (l >= CHEIA) {
      const t = Math.min(1, (l - CHEIA) / (1 - CHEIA)) * 0.7;
      saida[i] = Math.round(cr + (255 - cr) * t);
      saida[i + 1] = Math.round(cg + (255 - cg) * t);
      saida[i + 2] = Math.round(cb + (255 - cb) * t);
    } else {
      const t = 0.22 + 0.78 * (l / CHEIA);
      saida[i] = Math.round(cr * t);
      saida[i + 1] = Math.round(cg * t);
      saida[i + 2] = Math.round(cb * t);
    }
  }
  return saida;
}

/** O ícone pronto na cor da marca, em PNG transparente de até 1024 px. */
export async function tingirIcone(png: Uint8Array, cor: string): Promise<Uint8Array> {
  // O sharp entra só aqui: quem empacota este pacote sem ele (worker de vídeos) não pode cair ao subir.
  const { default: sharp } = await import('sharp');
  const { data, info } = await sharp(png)
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) throw new AppError(502, 'icone_indisponivel', 'O ícone veio sem transparência.');
  const tinto = tingirPontos(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), cor);
  const saida = await sharp(tinto, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();
  return new Uint8Array(saida);
}
