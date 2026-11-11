import {
  MAX_PERGUNTAS_TIME,
  MAX_RODADAS_TIME,
  type PerguntaDoTime,
  type RodadaDoTime,
} from '@prospeccao/shared/carrosseis-time';
import type { ClienteClaude, UsoClaude } from './claude.js';

/**
 * v148/v149: antes de criar, a estrategista conversa com quem pediu. Ela lê o pedido, o cérebro da marca
 * e o que já foi respondido, e decide: já dá para a peça vender sem inventar nada? Se sim, devolve o
 * resumo do que entendeu (o briefing) para a pessoa conferir. Se não, pergunta de novo, aprofundando no
 * que a pessoa respondeu (disse "promoção": qual desconto e até quando). Até 3 rodadas de até 4 perguntas;
 * na última ela só resume. O que a pessoa responder e o briefing conferido viram fonte do pedido.
 */

export interface EntradaPerguntas {
  tipo: 'carrossel' | 'cards';
  empresa: string;
  dossieTexto: string;
  assunto: string;
  objetivo: string;
  chamada: string;
  formato: string;
  divulgar: string | null;
  fotos: number;
  /** v149: o que já foi perguntado e respondido (resposta vazia: não soube ou pulou). */
  conversa?: { pergunta: string; resposta: string }[];
  /** v149: quantas rodadas a pessoa já respondeu. */
  rodada?: number;
}

const ESQUEMA_RODADA = {
  type: 'object',
  properties: {
    pronto: {
      type: 'boolean',
      description:
        'true quando já dá para criar uma peça que vende sem inventar nada (aí perguntas vem vazia).',
    },
    entendi: {
      type: 'string',
      description:
        'O briefing da peça, do jeito que você entendeu até agora: 2 a 5 frases curtas (até 700 letras) com o que vai ser vendido, para quem, o benefício, a oferta ou condição, a ação e o tom. Só o que está no pedido, no cérebro e nas respostas; nada inventado. Escrito para quem pediu conferir ("Um card de lançamento da…").',
    },
    perguntas: {
      type: 'array',
      description: `De 0 a ${MAX_PERGUNTAS_TIME}. Vazio quando pronto.`,
      items: {
        type: 'object',
        properties: {
          pergunta: { type: 'string', description: 'Curta, direta, do jeito que se fala (até 110 letras).' },
          porque: { type: 'string', description: 'Por que ajuda a peça, em uma linha (até 90 letras).' },
          sugestoes: {
            type: 'array',
            description:
              '0 a 4 respostas prováveis, curtas (até 40 letras), tiradas do pedido e do cérebro da marca; nunca invente um número que não está lá. Pergunta aberta (o diferencial, uma história) pode vir sem sugestões. Inclua "Não tem" quando fizer sentido.',
            items: { type: 'string' },
          },
        },
        required: ['pergunta', 'porque', 'sugestoes'],
      },
    },
  },
  required: ['pronto', 'entendi', 'perguntas'],
} as const;

export function mensagemDasPerguntas(e: EntradaPerguntas): string {
  const conversa = e.conversa ?? [];
  const rodada = e.rodada ?? 0;
  const ultima = rodada >= MAX_RODADAS_TIME;
  return [
    `Uma pessoa da ${e.empresa} vai pedir ${e.tipo === 'cards' ? 'cards avulsos (posts de uma peça só)' : 'um carrossel'} para o Instagram. Antes de o time criar, você (a estrategista) conversa com ela em rodadas curtas, como num briefing de agência: até ${MAX_RODADAS_TIME} rodadas de até ${MAX_PERGUNTAS_TIME} perguntas.`,
    '',
    'COMO CONDUZIR:',
    '- A cada rodada, leia o pedido, o cérebro da marca e TUDO o que já foi respondido, e decida: já dá para fazer uma peça que vende sem inventar nada? Se sim, pronto = true e nenhuma pergunta.',
    '- Se não, pergunte só o que ainda falta e muda a peça, aprofundando no que a pessoa respondeu: disse "promoção", pergunte qual a condição e até quando; disse "para oficinas", pergunte o que mais pesa para elas; disse "lançamento", pergunte o que tem de novo e quando chega.',
    '- O que costuma faltar: o que o cliente ganha (o benefício que o título vai vender), a oferta ou condição (preço, desconto, grátis, prazo, validade), para quem é (público, bairro, cidade), o que a pessoa deve fazer (WhatsApp, comentar, link), uma prova (número, garantia, tempo de mercado), e a foto ou o lugar que deve aparecer quando a peça fala de um lugar ou produto e não há foto.',
    '- Cada rodada pergunta menos que a anterior: comece pelo que mais muda a peça; depois só o que a resposta abriu.',
    '- Resposta vazia quer dizer que a pessoa não sabe ou pulou: não pergunte aquilo de novo, siga sem.',
    '- Nunca repita uma pergunta já feita, nem pergunte o que já está no pedido, no cérebro da marca ou no que divulgar. Nada de design (cor, fonte, estilo): o time decide.',
    '- Sempre escreva "entendi": o briefing do jeito que você entendeu até agora. Quando pronto, é o que a pessoa vai conferir antes de criar.',
    ultima
      ? `- ESTA É A ÚLTIMA RODADA: não pergunte mais nada. pronto = true, perguntas vazia, e capriche no "entendi" com tudo o que foi respondido.`
      : rodada === 0
        ? '- Pedido claro e completo já na primeira leitura: pronto = true sem perguntas.'
        : `- Já foram ${rodada} rodada(s). Só pergunte de novo se a resposta abriu algo que muda a peça.`,
    '',
    `PEDIDO: ${e.assunto || '(sem texto)'}`,
    `OBJETIVO: ${e.objetivo || '(não escolhido)'}`,
    `AÇÃO ESCOLHIDA: ${e.chamada || '(não escolhida)'}`,
    `FORMATO: ${e.formato}`,
    `FOTOS ENVIADAS COM O PEDIDO: ${e.fotos}`,
    e.divulgar ? `O QUE DIVULGAR (já cadastrado):\n${e.divulgar}` : '',
    conversa.length
      ? `O QUE JÁ FOI PERGUNTADO E RESPONDIDO:\n${conversa.map((c) => `- ${c.pergunta} → ${c.resposta || '(não respondeu)'}`).join('\n')}`
      : '',
    '',
    `O CÉREBRO DA MARCA (${e.empresa}):\n${e.dossieTexto.slice(0, 6000)}`,
  ]
    .filter((x) => x !== '')
    .join('\n');
}

const corte = (t: unknown, max: number) =>
  String(t ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const chave = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();

/** As perguntas da rodada: sem repetidas (nem as que já foram feitas antes), no máximo 4. */
export function lerPerguntas(d: Record<string, unknown>, jaFeitas: string[] = []): PerguntaDoTime[] {
  const brutas = (Array.isArray(d.perguntas) ? d.perguntas : []) as Record<string, unknown>[];
  const vistas = new Set(jaFeitas.map(chave));
  const saida: PerguntaDoTime[] = [];
  for (const b of brutas) {
    const pergunta = corte(b.pergunta, 140);
    if (pergunta.length < 5 || vistas.has(chave(pergunta))) continue;
    vistas.add(chave(pergunta));
    const sugestoes = [
      ...new Set((Array.isArray(b.sugestoes) ? b.sugestoes : []).map((x) => corte(x, 60)).filter(Boolean)),
    ].slice(0, 4);
    saida.push({ pergunta, porque: corte(b.porque, 140), sugestoes });
    if (saida.length >= MAX_PERGUNTAS_TIME) break;
  }
  return saida;
}

/** A rodada: na última não vem pergunta; sem pergunta, está pronto. */
export function lerRodada(d: Record<string, unknown>, e: EntradaPerguntas): RodadaDoTime {
  const rodada = Math.min(e.rodada ?? 0, MAX_RODADAS_TIME);
  const ultima = rodada >= MAX_RODADAS_TIME;
  const perguntas =
    ultima || d.pronto === true
      ? []
      : lerPerguntas(
          d,
          (e.conversa ?? []).map((c) => c.pergunta),
        );
  return { pronto: perguntas.length === 0, entendi: corte(d.entendi, 900), perguntas, rodada };
}

export async function perguntarAntes(
  claude: ClienteClaude,
  e: EntradaPerguntas,
): Promise<RodadaDoTime & { uso: UsoClaude; custoUsd: number }> {
  const r = await claude.pedir({
    agente: 'estrategista',
    sistema: [
      {
        texto:
          'Você é a estrategista de conteúdo de uma agência. Conduz o briefing como uma boa atendimento: pergunta pouco, as perguntas certas, vai fundo no que a pessoa responde, e para quando já tem o que a peça precisa para vender sem inventar nada.',
      },
    ],
    mensagem: mensagemDasPerguntas(e),
    ferramenta: {
      nome: 'perguntas',
      descricao: 'A rodada da conversa antes de criar.',
      esquema: ESQUEMA_RODADA,
    },
    maxTokens: 1400,
    temperatura: 0.3,
    timeoutMs: 45_000,
  });
  return { ...lerRodada(r.dados, e), uso: r.uso, custoUsd: r.custoUsd };
}
