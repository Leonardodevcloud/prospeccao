import type { SlideCarrossel } from '@prospeccao/shared/carrosseis';
import {
  conferirDirectDaPromocao,
  directPadrao,
  ENTREGA,
  type Entrega,
  frasePromocao,
} from '@prospeccao/shared/carrosseis-publicacao';
import { type DivulgarEntrada, precosDoTexto, textoDosSlides } from '@prospeccao/shared/carrosseis-time';
import { MANUAL_REDACAO } from '../saber/index.js';
import { type ClienteClaude, USO_ZERO, type UsoClaude } from './claude.js';

/**
 * A redatora escreve o direct que vai para quem comentou a palavra do carrossel: no tom da marca,
 * dizendo o que a pessoa está recebendo (o link, o arquivo, a promoção) ou fazendo uma pergunta que
 * abre a conversa. A promoção sai com o preço e o prazo exatamente como foram digitados; um preço
 * que não veio da promoção derruba o texto e entra o padrão.
 */

export interface EntradaDirect {
  empresa: string;
  dossieTexto: string;
  titulo: string;
  slides: SlideCarrossel[];
  legenda: string;
  palavra: string;
  entrega: Entrega;
  /** O que o link ou o arquivo é (o endereço ou o nome do arquivo), para dizer o que a pessoa recebe. */
  material: string;
  promocao: DivulgarEntrada | null;
  /** Direct de um vídeo (v131): o que a pessoa fala no vídeo, no lugar dos slides. */
  fala?: string;
}

/** O conteúdo da peça (os slides do carrossel ou a fala do vídeo) para a redatora e a conferência. */
const conteudoDaPeca = (e: Pick<EntradaDirect, 'slides' | 'fala'>) =>
  e.fala != null ? e.fala : textoDosSlides(e.slides);

export interface ResultadoDirect {
  mensagem: string;
  botao: string;
  /** A redatora escreveu (false: o texto padrão, porque o dela não passou na conferência). */
  daRedatora: boolean;
  uso: UsoClaude;
  custoUsd: number;
}

const ESQUEMA_DIRECT = {
  type: 'object',
  properties: {
    mensagem: {
      type: 'string',
      description:
        'O direct inteiro, até 500 letras. Começa com "Oi, {nome}!" ({nome} vira o primeiro nome de quem comentou).',
    },
    botao: { type: 'string', description: 'O texto do botão, até 20 letras (vazio quando não tem botão).' },
  },
  required: ['mensagem', 'botao'],
} as const;

const O_QUE_ENTREGA: Record<Entrega, string> = {
  link: 'um LINK (abre no botão). Diga em uma frase o que a pessoa vai encontrar nele.',
  arquivo: 'um ARQUIVO (abre no botão). Diga em uma frase o que é o material e como usar.',
  promocao:
    'uma PROMOÇÃO com botão para pedir pelo WhatsApp. Diga o produto, o preço e o prazo exatamente como estão abaixo e convide a pedir.',
  conversa:
    'SÓ A CONVERSA (sem botão). Termine com UMA pergunta simples que a pessoa responda em poucas palavras (ex.: o carro e o ano, o tamanho da equipe).',
};

export function mensagemDoDirect(e: EntradaDirect): string {
  const promo = e.promocao;
  return [
    `Você é a REDATORA. Escreva o direct que vai, sozinho, para quem comentou a palavra ${e.fala != null ? 'no vídeo' : 'no carrossel'} abaixo.`,
    `A pessoa comentou "${e.palavra}". Ela vai receber: ${O_QUE_ENTREGA[e.entrega]}`,
    e.material ? `O MATERIAL: ${e.material}` : '',
    promo
      ? `A PROMOÇÃO (copie preço e prazo exatamente assim): ${[promo.produto || promo.titulo, frasePromocao(promo), promo.condicoes].filter(Boolean).join(' · ')}`
      : '',
    e.fala != null
      ? `O VÍDEO: ${e.titulo}\nO QUE A PESSOA FALA NO VÍDEO: ${e.fala.slice(0, 1500)}`
      : `O CARROSSEL: ${e.titulo}\n${textoDosSlides(e.slides).slice(0, 1500)}`,
    `${e.fala != null ? 'O TEXTO DO POST' : 'A LEGENDA'}: ${e.legenda.slice(0, 600)}`,
    'REGRAS:',
    '- Até 500 letras, 2 ou 3 frases curtas, no tom da empresa. Sem hashtag. No máximo um emoji.',
    '- Comece com "Oi, {nome}!". Fale como a empresa ("a gente", "nós").',
    '- Nada de preço, prazo, garantia ou número que não esteja no conteúdo, na promoção ou no cérebro da marca.',
    '- Não diga que vai ligar, mandar e-mail ou fazer algo que o direct não faz.',
    e.entrega === 'conversa'
      ? '- Sem botão: devolva "botao" vazio.'
      : `- O botão: até 20 letras, um verbo (ex.: "${ENTREGA[e.entrega].botao}").`,
  ]
    .filter(Boolean)
    .join('\n');
}

const MANUAL_DIRECT = `Você escreve as mensagens de direct do Instagram de uma empresa brasileira. A mensagem chega para quem comentou uma palavra num post: a pessoa pediu, então vá direto ao que ela pediu, com simpatia e sem enrolação. Português do Brasil, frases curtas, palavra simples.`;

/** A redatora escreve o direct (conferido); se não der, o padrão de cada entrega. */
export async function escreverDirect(
  claude: ClienteClaude | null,
  e: EntradaDirect,
): Promise<ResultadoDirect> {
  const padrao = (): ResultadoDirect => ({
    mensagem: directPadrao(e.entrega, e.titulo, e.promocao),
    botao: ENTREGA[e.entrega].botao,
    daRedatora: false,
    uso: USO_ZERO,
    custoUsd: 0,
  });
  if (!claude) return padrao();
  const r = await claude.pedir({
    agente: 'redator',
    sistema: [
      {
        texto: `${MANUAL_DIRECT}\n\n${MANUAL_REDACAO}\n\nO CÉREBRO DA MARCA (${e.empresa}):\n${e.dossieTexto}`,
        cache: true,
      },
    ],
    mensagem: mensagemDoDirect(e),
    ferramenta: { nome: 'direct', descricao: 'O direct para quem comentou.', esquema: ESQUEMA_DIRECT },
    maxTokens: 700,
    temperatura: 0.6,
    timeoutMs: 60_000,
  });
  const mensagem = String(r.dados.mensagem ?? '')
    .replace(/\s+\n/g, '\n')
    .trim()
    .slice(0, 900);
  const botao =
    e.entrega === 'conversa'
      ? ''
      : String(r.dados.botao ?? '')
          .trim()
          .slice(0, 20) || ENTREGA[e.entrega].botao;
  const fontes = `${conteudoDaPeca(e)}\n${e.legenda}\n${e.dossieTexto}`;
  const precoInventado = precosDoTexto(mensagem).some(
    (p) =>
      !fontes.replace(/\s/g, '').includes(p.replace(/\s/g, '')) &&
      !(e.promocao && [e.promocao.precoDe, e.promocao.precoPor].includes(p)),
  );
  const promocaoErrada =
    e.promocao && e.entrega === 'promocao' && conferirDirectDaPromocao(e.promocao, mensagem).length > 0;
  if (mensagem.length < 5 || precoInventado || promocaoErrada)
    return { ...padrao(), uso: r.uso, custoUsd: r.custoUsd };
  return { mensagem, botao, daRedatora: true, uso: r.uso, custoUsd: r.custoUsd };
}
