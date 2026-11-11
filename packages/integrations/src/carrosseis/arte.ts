import {
  FONTES_DO_PAR,
  type FormatoPeca,
  type IdentidadeCarrossel,
  type SlideCarrossel,
  semMarcas,
} from '@prospeccao/shared/carrosseis';
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

export interface EntradaArte {
  empresa: string;
  identidade: IdentidadeCarrossel;
  formato: FormatoPeca;
  slide: SlideCarrossel;
  /** O que o card quer (o objetivo do pedido), para o clima da peça. */
  objetivo: string;
  temLogo: boolean;
  /** Quantas fotos da empresa vão como referência (depois da logo). */
  fotos: number;
  /** Quantos posts do Instagram da conta vão como referência de estilo (depois das fotos). */
  posts: number;
  /** A segunda tentativa leva o que deu errado na primeira. */
  corrigir?: string[];
}

const linhaTexto = (rotulo: string, t: string) => (t ? `- ${rotulo}: "${t}"` : '');

export function promptDaArte(e: EntradaArte): string {
  const t = textoDaArte(e.slide);
  const c = e.identidade.cores;
  const par = FONTES_DO_PAR[e.identidade.fontes];
  const realce = marcadas(e.slide.titulo);
  let n = 0;
  const imgLogo = e.temLogo ? ++n : 0;
  const imgFotos = Array.from({ length: e.fotos }, () => ++n);
  const imgPosts = Array.from({ length: e.posts }, () => ++n);
  const story = e.formato === 'story';
  return [
    `Crie um post para o Instagram da ${e.empresa}, ${story ? 'story em pé 9:16 (tela cheia do celular)' : 'feed em pé 4:5'}, com qualidade de agência de publicidade brasileira: peça promocional pronta para publicar, que faz parar de rolar o feed.`,
    `Objetivo da peça: ${e.objetivo}. Ela é um post sozinho: quem vê só ela entende a oferta inteira.`,
    '',
    'TEXTO DA PEÇA (escreva EXATAMENTE assim, em português do Brasil, com todos os acentos, sem trocar, tirar ou acrescentar nenhuma palavra; nenhum outro texto na imagem):',
    linhaTexto('Selo pequeno no topo (etiqueta ou pílula)', t.selo),
    linhaTexto('Número ou preço em destaque, bem grande', t.destaque),
    linhaTexto('Título (o maior texto depois do número)', t.titulo),
    realce.length
      ? `  No título, destaque com a cor ${c.destaque}: ${realce.map((r) => `"${r}"`).join(', ')}.`
      : '',
    linhaTexto('Texto de apoio (menor, curto)', t.texto),
    linhaTexto('Botão (um botão arredondado, sólido, com este texto)', t.botao),
    '',
    'IDENTIDADE DA MARCA:',
    `- Cores: principal ${c.principal} (fundo e massas grandes), destaque ${c.destaque} (o número, as palavras destacadas, o botão), claro ${c.claro}. Use essas cores de verdade, cheias e vivas; nada de tons apagados.`,
    `- Tipografia: títulos na linha de "${par.titulo.familia}"${par.titulo.caixaAlta ? ', em caixa alta' : ''}, pesados e muito legíveis; texto de apoio limpo, sem serifa. Hierarquia forte: no celular, de longe, lê-se o número e o título num segundo.`,
    e.identidade.jeitoDePostar
      ? `- O jeito de postar da marca (siga): ${e.identidade.jeitoDePostar.replace(/\s+/g, ' ').slice(0, 900)}`
      : '',
    imgLogo
      ? `- A imagem ${imgLogo} é a LOGO da empresa: coloque-a exatamente como é (mesmas letras, formas e cores; sem redesenhar, sem distorcer, sem inventar símbolo), grande e visível, no topo ou num canto, com área de respiro em volta. É a única marca da peça.`
      : `- Escreva o nome "${e.empresa}" pequeno, no topo, como assinatura.`,
    imgFotos.length
      ? `- ${imgFotos.length === 1 ? `A imagem ${imgFotos[0]} é uma foto` : `As imagens ${imgFotos.join(', ')} são fotos`} da própria empresa: use como o assunto da peça (pode recortar a pessoa ou o produto e compor sobre a cor da marca, como fazem as boas marcas). O produto e as pessoas ficam iguais, sem deformar.`
      : '',
    imgPosts.length
      ? `- ${imgPosts.length === 1 ? `A imagem ${imgPosts[0]} é um post` : `As imagens ${imgPosts.join(', ')} são posts`} que a própria marca já publicou: siga o estilo visual deles (composição, elementos gráficos, ícones, uso das cores e das fotos). Não copie o texto nem o layout exato deles.`
      : '',
    '',
    'DIREÇÃO DE ARTE:',
    '- Uma ideia visual forte e uma mensagem só. Composição ousada e equilibrada, com elementos gráficos que servem à mensagem (formas, ícones 3D ou flat, setas, brilho leve), sem poluir.',
    '- Todo texto sobre área lisa ou com contraste garantido; nunca letra em cima de detalhe da foto.',
    `- Margens seguras: nada encostado na borda${story ? '; deixe livres os 13% de cima e os 16% de baixo (a interface do story cobre)' : ''}.`,
    '- Cenário e pessoas do Brasil quando aparecerem. ' + CARTAO_POSTAL,
    '- Proibido: texto além do pedido, número, preço, telefone, site ou @ que não esteja no texto acima, outras marcas e logotipos, marca d’água, moldura, aparência de template genérico de banco de imagens.',
    e.corrigir?.length ? `\nNA TENTATIVA ANTERIOR DEU ERRADO (corrija): ${e.corrigir.join(' ')}` : '',
  ]
    .filter((x) => x !== '')
    .join('\n');
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
    logo_da_marca: {
      type: 'boolean',
      description: 'A logo da primeira imagem aparece na arte, igual e legível.',
    },
    outra_marca: { type: 'boolean', description: 'Aparece logotipo ou marca que não é a da empresa.' },
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
  required: ['textos', 'logo_da_marca', 'outra_marca', 'defeito', 'legivel', 'nota', 'problemas'],
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

export interface ConferenciaArte {
  aprovada: boolean;
  problemas: string[];
  lidos: string[];
}

/**
 * O código decide, com o que o modelo de visão leu: cada campo do texto aprovado está lá inteiro (na
 * ordem das palavras), nenhum número ou preço a mais, a logo apareceu (quando foi), sem marca estranha
 * nem defeito, legível e nota 3 ou mais.
 */
export function avaliarArte(
  esperado: TextoDaArte,
  d: Record<string, unknown>,
  o: { temLogo: boolean; empresa: string },
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
  if (o.temLogo && d.logo_da_marca === false) problemas.push('A logo da empresa não apareceu igual.');
  if (d.outra_marca === true) problemas.push('Apareceu outra marca na arte.');
  if (d.defeito === true) problemas.push('A arte tem defeito de imagem gerada.');
  if (d.legivel === false) problemas.push('O título ou o número não se lê bem.');
  const nota = Number(d.nota);
  if (Number.isFinite(nota) && nota < 3) problemas.push(`A peça ficou fraca (nota ${nota} de 5).`);
  for (const p of Array.isArray(d.problemas) ? d.problemas : [])
    if (problemas.length < 8) problemas.push(String(p).slice(0, 160));
  const reprovou =
    campos.some(([, v]) => normalizarTexto(v) && !tudo.includes(` ${normalizarTexto(v)} `)) ||
    inventados.length > 0 ||
    (o.temLogo && d.logo_da_marca === false) ||
    d.outra_marca === true ||
    d.defeito === true ||
    d.legivel === false ||
    (Number.isFinite(nota) && nota < 3);
  return { aprovada: !reprovou, problemas: reprovou ? problemas : [], lidos };
}

export async function conferirArte(
  claude: ClienteClaude,
  e: { jpeg: Uint8Array; logo: ReferenciaImagem | null; esperado: TextoDaArte; empresa: string },
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
      ...(e.logo
        ? [
            {
              tipo: e.logo.tipo,
              base64: Buffer.from(e.logo.dados).toString('base64'),
              legenda: 'Primeira imagem: a logo da empresa (referência).',
            },
          ]
        : []),
      {
        tipo: 'image/jpeg' as const,
        base64: Buffer.from(e.jpeg).toString('base64'),
        legenda: 'A arte para conferir:',
      },
    ],
    mensagem: 'Leia todo o texto da arte e confira a peça.',
    ferramenta: {
      nome: 'conferir_arte',
      descricao: 'O que a arte tem escrito e a conferência.',
      esquema: ESQUEMA_ARTE,
    },
    maxTokens: 900,
    temperatura: 0,
    timeoutMs: 90_000,
  });
  return avaliarArte(e.esperado, r.dados, { temLogo: !!e.logo, empresa: e.empresa });
}
