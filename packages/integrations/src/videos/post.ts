import type { DivulgarEntrada } from '@prospeccao/shared/carrosseis-time';
import { precosDoTexto } from '@prospeccao/shared/carrosseis-time';
import { type ChamadaVideo, fraseDaChamada, LIMITE_TEXTO_POST } from '@prospeccao/shared/videos';
import { type ClienteClaude, USO_ZERO, type UsoClaude } from '../carrosseis/claude.js';
import { MANUAL_REDACAO } from '../saber/index.js';

/**
 * O texto do post do Reels (v131): a redatora escreve o que vai embaixo do vídeo a partir do que a
 * pessoa fala, no tom da marca, com a chamada do fim. É também o que o CRM usa para reconhecer o
 * Reels quando ele aparece no Instagram. Preço só o da promoção cadastrada, exatamente como foi
 * digitado; um preço inventado derruba o texto e entra o padrão.
 */

export interface EntradaTextoPost {
  empresa: string;
  dossieTexto: string;
  titulo: string;
  assunto: string;
  /** O que a pessoa fala no vídeo editado. */
  fala: string;
  chamada: ChamadaVideo;
  promocao: DivulgarEntrada | null;
}

export interface ResultadoTextoPost {
  texto: string;
  hashtags: string[];
  /** A redatora escreveu (false: o texto padrão). */
  daRedatora: boolean;
  uso: UsoClaude;
  custoUsd: number;
}

const ESQUEMA_TEXTO_POST = {
  type: 'object',
  properties: {
    texto: {
      type: 'string',
      description:
        'O texto do post, sem hashtags: a primeira linha (até 125 letras) é o gancho; depois 1 a 3 parágrafos curtos; termina com a chamada.',
    },
    hashtags: {
      type: 'array',
      description: '3 a 6 hashtags do assunto, do nicho e da região (sem o #).',
      items: { type: 'string' },
    },
  },
  required: ['texto', 'hashtags'],
} as const;

const MANUAL_POST = `Você escreve o texto que vai embaixo dos Reels de uma empresa brasileira. Quem lê acabou de ver (ou está vendo) o vídeo: o texto completa o vídeo, não repete a fala inteira.`;

/** A frase da chamada do fim do vídeo, para o texto terminar pedindo a mesma coisa. */
export function chamadaDoPost(c: ChamadaVideo): string {
  if (c.tipo === 'comente') return `Comente ${c.palavra || 'QUERO'} que a gente te manda no direct.`;
  if (c.tipo === 'whatsapp') return 'Chama a gente no WhatsApp (link no perfil).';
  if (c.tipo === 'seguir') return 'Segue o perfil para ver as próximas.';
  return fraseDaChamada(c).frase;
}

/** O texto padrão (sem a redatora): o assunto e a chamada. */
export function textoPostPadrao(e: Pick<EntradaTextoPost, 'titulo' | 'assunto' | 'chamada'>): string {
  const abertura = (e.assunto || e.titulo).trim();
  return [abertura, chamadaDoPost(e.chamada)].filter(Boolean).join('\n\n').slice(0, LIMITE_TEXTO_POST);
}

export function mensagemDoTextoPost(e: EntradaTextoPost): string {
  const promo = e.promocao;
  return [
    'Você é a REDATORA. Escreva o texto do post deste Reels.',
    `O VÍDEO: ${e.titulo}`,
    e.assunto ? `ASSUNTO: ${e.assunto}` : '',
    `O QUE A PESSOA FALA NO VÍDEO: ${e.fala.slice(0, 2500)}`,
    promo
      ? `A PROMOÇÃO (preço e prazo só assim, exatamente): ${[promo.produto || promo.titulo, promo.precoDe && `de ${promo.precoDe}`, promo.precoPor && `por ${promo.precoPor}`, promo.validade, promo.condicoes].filter(Boolean).join(' · ')}`
      : '',
    `A CHAMADA DO FIM DO VÍDEO (o texto termina pedindo a mesma coisa): ${chamadaDoPost(e.chamada) || 'sem chamada'}`,
    'REGRAS:',
    '- A primeira linha prende sozinha (aparece antes do "mais"): o problema, o sintoma ou o ganho, com as palavras que o cliente usaria na busca.',
    '- Até 600 letras no total. Frases curtas. No máximo um emoji. Sem hashtag no texto (vão à parte).',
    '- Nada de preço, prazo, garantia ou número que não esteja na fala, na promoção ou no cérebro da marca.',
    e.chamada.tipo === 'comente'
      ? `- A última frase pede para comentar ${e.chamada.palavra || 'QUERO'}, com a palavra em maiúsculas e igual à do vídeo.`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** O texto pede para comentar a palavra ("Comente FREIO", "comenta “FREIO”"). */
export function pedeAPalavra(texto: string, palavra: string): boolean {
  const p = palavra.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`COMENT\\p{L}*\\s+["“'«]?${p}\\b`, 'u').test(texto.toUpperCase());
}

const limparHashtags = (v: unknown): string[] =>
  [
    ...new Set(
      (Array.isArray(v) ? v : [])
        .map((h) =>
          String(h ?? '')
            .replace(/^#+/, '')
            .replace(/[^\p{L}\p{N}_]/gu, '')
            .toLowerCase(),
        )
        .filter((h) => h.length >= 2 && h.length <= 40),
    ),
  ].slice(0, 8);

/** A redatora escreve o texto do post (conferido); sem ela, ou se não passar, o padrão. */
export async function escreverTextoDoPost(
  claude: ClienteClaude | null,
  e: EntradaTextoPost,
): Promise<ResultadoTextoPost> {
  const padrao = (): ResultadoTextoPost => ({
    texto: textoPostPadrao(e),
    hashtags: [],
    daRedatora: false,
    uso: USO_ZERO,
    custoUsd: 0,
  });
  if (!claude || !e.fala.trim()) return padrao();
  const r = await claude.pedir({
    agente: 'redator',
    sistema: [
      {
        texto: `${MANUAL_POST}\n\n${MANUAL_REDACAO}\n\nO CÉREBRO DA MARCA (${e.empresa}):\n${e.dossieTexto}`,
        cache: true,
      },
    ],
    mensagem: mensagemDoTextoPost(e),
    ferramenta: {
      nome: 'texto_do_post',
      descricao: 'O texto do post do Reels.',
      esquema: ESQUEMA_TEXTO_POST,
    },
    maxTokens: 900,
    temperatura: 0.6,
    timeoutMs: 60_000,
  });
  const texto = String(r.dados.texto ?? '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/(^|\s)#[\p{L}\p{N}_]+/gu, '')
    .trim()
    .slice(0, LIMITE_TEXTO_POST - 300);
  const fontes = `${e.fala}\n${e.dossieTexto}\n${e.assunto}`;
  const precoInventado = precosDoTexto(texto).some(
    (p) =>
      !fontes.replace(/\s/g, '').includes(p.replace(/\s/g, '')) &&
      !(e.promocao && [e.promocao.precoDe, e.promocao.precoPor].includes(p)),
  );
  // "Comente X": a palavra tem que estar no texto (é a mesma da regra do Comente e receba).
  const semPalavra =
    e.chamada.tipo === 'comente' && !!e.chamada.palavra && !pedeAPalavra(texto, e.chamada.palavra);
  if (texto.length < 20 || precoInventado || semPalavra)
    return { ...padrao(), uso: r.uso, custoUsd: r.custoUsd };
  return {
    texto,
    hashtags: limparHashtags(r.dados.hashtags),
    daRedatora: true,
    uso: r.uso,
    custoUsd: r.custoUsd,
  };
}
