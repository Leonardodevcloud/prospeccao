import { AppError } from '@prospeccao/shared';
import type { ClienteClaude } from '../carrosseis/claude.js';

/**
 * As imagens dos vídeos (e, na v131, dos carrosséis):
 * - gerar com o GPT Image 2 (OpenAI) em qualidade média, sempre sem texto, marca ou rosto em
 *   destaque: o texto do vídeo é escrito pelo sistema, nunca desenhado pela IA de imagem;
 * - conferir cada imagem gerada com um modelo de visão antes de entrar no vídeo;
 * - descrever as fotos da empresa uma vez, para a IA escolher a foto certa pela fala.
 */

export const URL_IMAGENS_OPENAI = 'https://api.openai.com/v1/images/generations';
export const MODELO_IMAGEM_PADRAO = 'gpt-image-2';

export const QUALIDADES_IMAGEM = ['low', 'medium', 'high'] as const;
export type QualidadeImagem = (typeof QUALIDADES_IMAGEM)[number];

export interface ConfigImagem {
  chave: string;
  modelo: string;
  /** v148: a qualidade pedida ao GPT Image (padrão: medium; os carrosséis e cards usam high). */
  qualidade?: QualidadeImagem;
  /** Para os testes (padrão: a API da OpenAI). */
  url?: string;
  urlEdicao?: string;
}

/** Tamanho pedido ao modelo (lados múltiplos de 16, como o GPT Image 2 pede). */
export const TAMANHO_IMAGEM = {
  cheia: { largura: 1088, altura: 1920 },
  acima: { largura: 1536, altura: 960 },
} as const;

/** O pedido de verdade ao modelo de imagem: a cena e as proibições que valem sempre. */
export function promptDaImagem(descricao: string, formato: 'cheia' | 'acima'): string {
  return [
    `Fotografia realista, profissional, luz natural, ${formato === 'cheia' ? 'vertical (formato de celular em pé)' : 'horizontal'}.`,
    `Cena: ${descricao.trim()}.`,
    formato === 'cheia'
      ? 'Composição: um assunto principal nítido no centro, fundo simples e um pouco desfocado, como foto de campanha publicitária.'
      : 'Composição: o assunto ocupa a maior parte do quadro, de perto, fundo limpo e desfocado, como foto de catálogo bem-feita.',
    'Cenário brasileiro quando houver lugar, rua ou carro (carros, ruas, lojas e oficinas como são no Brasil).',
    'Proibido: qualquer texto, letra, número, placa legível, logotipo, marca, embalagem de marca, marca d’água e moldura.',
    'Sem rosto de pessoa em destaque (pessoas só de costas, de longe ou só as mãos).',
    'Cores naturais, nitidez boa, sem aparência de ilustração.',
  ].join('\n');
}

interface RespostaImagem {
  data?: { b64_json?: string }[];
  error?: { message?: string; code?: string };
}

/** Gera uma imagem e devolve o JPEG. Erros da API viram AppError (429 e 5xx: dá para tentar de novo). */
export async function gerarImagem(
  cfg: ConfigImagem,
  e: { descricao: string; formato: 'cheia' | 'acima' },
): Promise<Uint8Array> {
  const t = TAMANHO_IMAGEM[e.formato];
  return pedirImagem(cfg, { prompt: promptDaImagem(e.descricao, e.formato), ...t });
}

export const URL_EDICAO_OPENAI = 'https://api.openai.com/v1/images/edits';

/**
 * O pedido ao modelo de imagem, com o prompt pronto (vídeos e carrosséis). Com `referencia`, é uma
 * edição: a foto vai junto e o modelo mantém o que o prompt manda manter (o produto igual).
 */
export interface ReferenciaImagem {
  dados: Uint8Array;
  tipo: 'image/jpeg' | 'image/png';
  nome: string;
}

/** Só os modelos de imagem antigos (gpt-image-1, 1-mini e 1.5) aceitam o input_fidelity. */
export const aceitaFidelidade = (modelo: string) => /^gpt-image-1(?:$|[.-])/.test(modelo);

export async function pedirImagem(
  cfg: ConfigImagem,
  e: {
    prompt: string;
    largura: number;
    altura: number;
    referencia?: Uint8Array;
    /** v150: várias imagens de referência na mesma edição (a logo, as fotos, posts da marca). */
    referencias?: ReferenciaImagem[];
    /** v150: quanto o modelo segue as referências (padrão high, para o produto e a logo saírem iguais). */
    fidelidade?: 'high' | 'low';
  },
): Promise<Uint8Array> {
  const size = `${e.largura}x${e.altura}`;
  const refs: ReferenciaImagem[] = [
    ...(e.referencia ? [{ dados: e.referencia, tipo: 'image/jpeg' as const, nome: 'produto.jpg' }] : []),
    ...(e.referencias ?? []),
  ];
  let resposta: Response;
  try {
    if (refs.length) {
      const form = new FormData();
      form.append('model', cfg.modelo);
      form.append('prompt', e.prompt);
      form.append('size', size);
      form.append('quality', cfg.qualidade ?? 'medium');
      form.append('output_format', 'jpeg');
      // v151: o GPT Image 2 já lê as referências em alta fidelidade e RECUSA o campo input_fidelity
      // (erro 400): mandar só para os modelos antigos (gpt-image-1 e 1.5), que ainda pedem.
      if (aceitaFidelidade(cfg.modelo)) form.append('input_fidelity', e.fidelidade ?? 'high');
      form.append('n', '1');
      for (const r of refs)
        form.append('image[]', new Blob([Buffer.from(r.dados)], { type: r.tipo }), r.nome);
      resposta = await fetch(cfg.urlEdicao ?? URL_EDICAO_OPENAI, {
        method: 'POST',
        headers: { authorization: `Bearer ${cfg.chave}` },
        body: form,
        signal: AbortSignal.timeout(240_000),
      });
    } else
      resposta = await fetch(cfg.url ?? URL_IMAGENS_OPENAI, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.chave}` },
        body: JSON.stringify({
          model: cfg.modelo,
          prompt: e.prompt,
          size,
          quality: cfg.qualidade ?? 'medium',
          output_format: 'jpeg',
          output_compression: 90,
          n: 1,
        }),
        signal: AbortSignal.timeout(240_000),
      });
  } catch (erro) {
    throw new AppError(502, 'falha_externa', `Imagem: sem resposta (${(erro as Error).name})`, {
      repetivel: true,
      detalhes: { status: 0 },
    });
  }
  const corpo = (await resposta.json().catch(() => ({}))) as RespostaImagem;
  if (!resposta.ok) {
    const msg = (corpo.error?.message ?? '').slice(0, 240).replace(/[A-Za-z0-9_\-+/=.]{24,}/g, '…');
    throw new AppError(502, 'falha_externa', `Imagem: HTTP ${resposta.status} ${msg}`.trim(), {
      repetivel: resposta.status === 429 || resposta.status >= 500,
      detalhes: { status: resposta.status, codigo: corpo.error?.code ?? null },
    });
  }
  const b64 = corpo.data?.[0]?.b64_json;
  if (!b64) throw AppError.externo('Imagem', 'a resposta veio sem a imagem');
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/* ───────────────────────────── Conferência e descrição ───────────────────────────── */

const ESQUEMA_CONFERENCIA = {
  type: 'object',
  properties: {
    tem_texto: {
      type: 'boolean',
      description: 'Aparece qualquer letra, número ou texto, mesmo pequeno ou borrado.',
    },
    tem_marca: { type: 'boolean', description: 'Aparece logotipo, marca ou embalagem reconhecível.' },
    rosto_em_destaque: { type: 'boolean', description: 'Um rosto de pessoa aparece de frente e grande.' },
    defeito: {
      type: 'boolean',
      description:
        'Defeito de imagem gerada: mãos ou objetos deformados, peças sem sentido, partes derretidas.',
    },
    combina: { type: 'boolean', description: 'A imagem mostra a cena pedida.' },
    problemas: {
      type: 'array',
      items: { type: 'string' },
      description: 'Cada problema em uma frase curta, em português.',
    },
  },
  required: ['tem_texto', 'tem_marca', 'rosto_em_destaque', 'defeito', 'combina', 'problemas'],
} as const;

export interface ConferenciaImagem {
  aprovada: boolean;
  problemas: string[];
}

/** Um modelo de visão olha a imagem gerada: sem texto, sem marca, sem rosto em destaque, sem defeito. */
export async function conferirImagem(
  claude: ClienteClaude,
  e: { jpeg: Uint8Array; descricao: string },
): Promise<ConferenciaImagem> {
  const r = await claude.pedir({
    agente: 'revisor de imagem',
    sistema: [
      {
        texto:
          'Você confere imagens geradas por IA antes de entrarem num vídeo de uma empresa. Seja rigoroso: qualquer letra ou número visível, marca, rosto de frente em destaque ou defeito reprova.',
      },
    ],
    imagens: [{ tipo: 'image/jpeg', base64: Buffer.from(e.jpeg).toString('base64') }],
    mensagem: `A cena pedida: ${e.descricao}\nConfira a imagem.`,
    ferramenta: {
      nome: 'conferir_imagem',
      descricao: 'O resultado da conferência.',
      esquema: ESQUEMA_CONFERENCIA,
    },
    maxTokens: 600,
    temperatura: 0,
    timeoutMs: 90_000,
  });
  const d = r.dados;
  const problemas = (Array.isArray(d.problemas) ? d.problemas : []).map((p) => String(p).slice(0, 160));
  const aprovada = !d.tem_texto && !d.tem_marca && !d.rosto_em_destaque && !d.defeito && d.combina !== false;
  if (!aprovada && !problemas.length) {
    if (d.tem_texto) problemas.push('Apareceu texto na imagem.');
    if (d.tem_marca) problemas.push('Apareceu uma marca na imagem.');
    if (d.rosto_em_destaque) problemas.push('Apareceu um rosto em destaque.');
    if (d.defeito) problemas.push('A imagem tem um defeito.');
    if (d.combina === false) problemas.push('A imagem não mostra a cena pedida.');
  }
  return { aprovada, problemas };
}

const ESQUEMA_DESCRICOES = {
  type: 'object',
  properties: {
    fotos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          indice: { type: 'integer' },
          descricao: {
            type: 'string',
            description:
              'Uma frase em português com o que a foto mostra, concreto (produto, peça, fachada, equipe, serviço). Sem opinião.',
          },
        },
        required: ['indice', 'descricao'],
      },
    },
  },
  required: ['fotos'],
} as const;

/** Descreve até 8 fotos de uma vez (o mesmo pedido lê todas). */
export async function descreverFotos(
  claude: ClienteClaude,
  fotos: { id: number; nome: string; jpeg: Uint8Array }[],
): Promise<{ id: number; descricao: string }[]> {
  if (!fotos.length) return [];
  const r = await claude.pedir({
    agente: 'descrição das fotos',
    sistema: [
      {
        texto:
          'Você descreve fotos de uma empresa brasileira para outro editor escolher a foto certa para cada momento de um vídeo. Seja concreto e curto.',
      },
    ],
    imagens: fotos.map((f, k) => ({
      tipo: 'image/jpeg' as const,
      base64: Buffer.from(f.jpeg).toString('base64'),
      legenda: `Foto ${k} (arquivo ${f.nome}):`,
    })),
    mensagem: `Descreva as ${fotos.length} fotos acima, pelo índice.`,
    ferramenta: {
      nome: 'descrever_fotos',
      descricao: 'Uma descrição por foto.',
      esquema: ESQUEMA_DESCRICOES,
    },
    maxTokens: 1500,
    temperatura: 0,
    timeoutMs: 120_000,
  });
  const lista = Array.isArray(r.dados.fotos) ? (r.dados.fotos as Record<string, unknown>[]) : [];
  return lista
    .map((x) => ({
      k: Number(x.indice),
      descricao: String(x.descricao ?? '')
        .trim()
        .slice(0, 200),
    }))
    .filter((x) => Number.isInteger(x.k) && fotos[x.k] && x.descricao)
    .map((x) => ({ id: fotos[x.k]!.id, descricao: x.descricao }));
}
