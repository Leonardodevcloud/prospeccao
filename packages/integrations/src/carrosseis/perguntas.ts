import { MAX_PERGUNTAS_TIME, type PerguntaDoTime } from '@prospeccao/shared/carrosseis-time';
import type { ClienteClaude, UsoClaude } from './claude.js';

/**
 * v148: antes de criar, a estrategista lê o pedido e o cérebro da marca e pergunta o que falta para a
 * peça vender (o benefício, a condição, a ação, a cidade). No máximo 4 perguntas, cada uma com
 * respostas prontas para tocar. O que a pessoa responder vira fonte do pedido: o card pode afirmar o
 * que foi confirmado ali. Pedido claro: nenhuma pergunta.
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
}

const ESQUEMA_PERGUNTAS = {
  type: 'object',
  properties: {
    perguntas: {
      type: 'array',
      description: `De 0 a ${MAX_PERGUNTAS_TIME}. Vazio quando o pedido já tem o que precisa.`,
      items: {
        type: 'object',
        properties: {
          pergunta: { type: 'string', description: 'Curta, direta, do jeito que se fala (até 90 letras).' },
          porque: { type: 'string', description: 'Por que ajuda a peça, em uma linha (até 90 letras).' },
          sugestoes: {
            type: 'array',
            description:
              '2 a 4 respostas prováveis, curtas (até 40 letras), tiradas do pedido e do cérebro da marca; nunca invente um número que não está lá. Inclua "Não tem" quando fizer sentido.',
            items: { type: 'string' },
          },
        },
        required: ['pergunta', 'porque', 'sugestoes'],
      },
    },
  },
  required: ['perguntas'],
} as const;

export function mensagemDasPerguntas(e: EntradaPerguntas): string {
  return [
    `Uma pessoa da ${e.empresa} vai pedir ${e.tipo === 'cards' ? 'cards avulsos (posts de uma peça só)' : 'um carrossel'} para o Instagram. Antes de o time criar, você (a estrategista) pode fazer até ${MAX_PERGUNTAS_TIME} perguntas rápidas.`,
    '',
    'PERGUNTE SÓ O QUE FALTA E MUDA A PEÇA:',
    '- o que o cliente ganha (o benefício que o título vai vender), quando o pedido só diz o que a empresa faz;',
    '- a oferta ou condição (preço, desconto, grátis, prazo, validade), quando o pedido fala de promoção ou lançamento e não diz qual;',
    '- para quem é (público, bairro, cidade), quando não está claro;',
    '- o que a pessoa deve fazer (WhatsApp, comentar, link), quando não está escolhido;',
    '- uma foto ou o lugar que deve aparecer, quando a peça fala de um lugar ou produto e não há foto.',
    'NÃO PERGUNTE o que já está no pedido, no cérebro da marca ou no que divulgar; nem coisas de design (cor, fonte, estilo: o time decide). Pedido claro e completo: devolva a lista vazia.',
    '',
    `PEDIDO: ${e.assunto || '(sem texto)'}`,
    `OBJETIVO: ${e.objetivo || '(não escolhido)'}`,
    `AÇÃO ESCOLHIDA: ${e.chamada || '(não escolhida)'}`,
    `FORMATO: ${e.formato}`,
    `FOTOS ENVIADAS COM O PEDIDO: ${e.fotos}`,
    e.divulgar ? `O QUE DIVULGAR (já cadastrado):\n${e.divulgar}` : '',
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

export function lerPerguntas(d: Record<string, unknown>): PerguntaDoTime[] {
  const brutas = (Array.isArray(d.perguntas) ? d.perguntas : []) as Record<string, unknown>[];
  const vistas = new Set<string>();
  const saida: PerguntaDoTime[] = [];
  for (const b of brutas) {
    const pergunta = corte(b.pergunta, 120);
    if (pergunta.length < 5 || vistas.has(pergunta.toLowerCase())) continue;
    vistas.add(pergunta.toLowerCase());
    const sugestoes = [
      ...new Set((Array.isArray(b.sugestoes) ? b.sugestoes : []).map((x) => corte(x, 60)).filter(Boolean)),
    ].slice(0, 4);
    saida.push({ pergunta, porque: corte(b.porque, 140), sugestoes });
    if (saida.length >= MAX_PERGUNTAS_TIME) break;
  }
  return saida;
}

export async function perguntarAntes(
  claude: ClienteClaude,
  e: EntradaPerguntas,
): Promise<{ perguntas: PerguntaDoTime[]; uso: UsoClaude; custoUsd: number }> {
  const r = await claude.pedir({
    agente: 'estrategista',
    sistema: [
      {
        texto:
          'Você é a estrategista de conteúdo de uma agência. Faz poucas perguntas, as certas, para a peça sair vendendo sem inventar nada.',
      },
    ],
    mensagem: mensagemDasPerguntas(e),
    ferramenta: { nome: 'perguntas', descricao: 'As perguntas antes de criar.', esquema: ESQUEMA_PERGUNTAS },
    maxTokens: 900,
    temperatura: 0.3,
    timeoutMs: 45_000,
  });
  return { perguntas: lerPerguntas(r.dados), uso: r.uso, custoUsd: r.custoUsd };
}
