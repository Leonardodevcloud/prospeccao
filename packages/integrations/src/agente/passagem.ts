import { type ConfigIa, type EsquemaIa, gerarJson } from '../ia/index.js';

/**
 * Passagem para o time: quando a IA para de responder um lead, o vendedor recebe um resumo do que
 * aconteceu (o que foi combinado, objeções, interesse, próximo passo) em vez de ler a conversa toda.
 * E o que o vendedor responde no lugar da IA vira sugestão para a base de conhecimento.
 */

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Pediu para falar com uma pessoa: vai para o time na hora, sem passar pela IA. */
export function pediuHumano(texto: string): boolean {
  const t = semAcento(texto);
  return /\b((falar|conversar|tratar) com (um|uma|o|a|algum|alguem)?\s?(atendente|humano|pessoa|consultor|vendedor|responsavel|gerente)|atendimento humano|pessoa de verdade|e (um )?robo\b.*\?|voce e (um )?robo|sai(r)? do (bot|robo)|me (passa|transfere|liga)\b.*(atendente|vendedor|pessoa|alguem))/.test(
    t,
  );
}

/** Assunto sério (reclamação formal, jurídico): vai para o time na hora. */
export function assuntoSensivel(texto: string): boolean {
  return /\b(procon|advogad|processar|processo judicial|reclame ?aqui|ministerio publico|juizado|denuncia|calote|golpe)/.test(
    semAcento(texto),
  );
}

/** Tempo de "digitando…" antes de mandar, como uma pessoa: ~0,9 s para ler mais 22 ms por letra. */
export function tempoDigitando(texto: string): number {
  return Math.min(7500, Math.max(1200, 900 + 22 * texto.length));
}

/* ───────────── Resumo da passagem ───────────── */

export interface ResumoPassagem {
  /** Uma ou duas frases: em que pé está a conversa. */
  situacao: string;
  /** O que ficou combinado (pela IA ou pelo lead). */
  combinado: string[];
  objecoes: string[];
  /** O que ele perguntou e ficou sem resposta. */
  perguntasEmAberto: string[];
  interesse: 'alto' | 'medio' | 'baixo' | 'indefinido';
  /** O que o vendedor deve fazer agora. */
  proximoPasso: string;
}

export interface EntradaResumo {
  empresa: string;
  lead: { empresa: string; contato: string | null; etapa: string };
  /** Por que a IA passou para o time. */
  motivo: string;
  memoria: string[];
  conversa: { de: 'nos' | 'lead'; texto: string }[];
}

const ESQUEMA_RESUMO: EsquemaIa = {
  type: 'OBJECT',
  properties: {
    situacao: { type: 'STRING' },
    combinado: { type: 'ARRAY', items: { type: 'STRING' } },
    objecoes: { type: 'ARRAY', items: { type: 'STRING' } },
    perguntasEmAberto: { type: 'ARRAY', items: { type: 'STRING' } },
    interesse: { type: 'STRING', enum: ['alto', 'medio', 'baixo', 'indefinido'] },
    proximoPasso: { type: 'STRING' },
  },
  required: ['situacao', 'combinado', 'objecoes', 'perguntasEmAberto', 'interesse', 'proximoPasso'],
};

export function promptResumo(e: EntradaResumo): string {
  return [
    `Você resume para um vendedor da ${e.empresa} uma conversa de WhatsApp que a IA estava conduzindo e agora passa para ele. Responda só com o JSON pedido, em português, frases curtas.`,
    `Lead: ${e.lead.empresa}${e.lead.contato ? ` (falando com ${e.lead.contato})` : ''}. Etapa: ${e.lead.etapa}.`,
    `Por que a IA passou: ${e.motivo || 'não informado'}`,
    e.memoria.length ? `O que já sabíamos dele: ${e.memoria.join('; ')}` : '',
    '',
    'Regras: use só o que está na conversa; não invente. Lista vazia quando não houver nada.',
    '- "situacao": em que pé está, em 1 ou 2 frases.',
    '- "combinado": o que foi acertado (horário, envio de material, retorno prometido…).',
    '- "objecoes": o que ele colocou contra (preço, já tem fornecedor, momento…), com as palavras dele quando der.',
    '- "perguntasEmAberto": o que ele perguntou e não foi respondido.',
    '- "interesse": alto (pediu proposta, reunião, preço para comprar), medio (fez perguntas), baixo (frio, evasivo), indefinido.',
    '- "proximoPasso": a ação que o vendedor deve fazer agora (não a pergunta que já mandamos).',
    '',
    'CONVERSA (mais antiga primeiro):',
    ...e.conversa.slice(-30).map((m) => `${m.de === 'nos' ? 'NÓS' : 'LEAD'}: ${m.texto}`),
  ]
    .filter((l) => l !== '')
    .join('\n');
}

const lista = (v: unknown, max = 5) =>
  (Array.isArray(v) ? v : [])
    .map((x) => String(x).replace(/\s+/g, ' ').trim().slice(0, 200))
    .filter(Boolean)
    .slice(0, max);

export function lerResumo(bruto: string): ResumoPassagem | null {
  try {
    const j = JSON.parse(bruto) as Partial<ResumoPassagem>;
    const situacao = String(j.situacao ?? '').trim();
    if (!situacao) return null;
    const niveis = ['alto', 'medio', 'baixo', 'indefinido'] as const;
    return {
      situacao: situacao.slice(0, 400),
      combinado: lista(j.combinado),
      objecoes: lista(j.objecoes),
      perguntasEmAberto: lista(j.perguntasEmAberto),
      interesse: niveis.includes(j.interesse as (typeof niveis)[number])
        ? (j.interesse as ResumoPassagem['interesse'])
        : 'indefinido',
      proximoPasso: String(j.proximoPasso ?? '')
        .trim()
        .slice(0, 300),
    };
  } catch {
    return null;
  }
}

export async function resumirPassagem(cfg: ConfigIa, e: EntradaResumo): Promise<ResumoPassagem | null> {
  const texto = await gerarJson(cfg, {
    prompt: promptResumo(e),
    esquema: ESQUEMA_RESUMO,
    temperatura: 0.2,
    timeoutMs: 40_000,
    maxTokens: 700,
  });
  return lerResumo(texto);
}

/** Resumo em texto corrido (notificação e nota no histórico). */
export function resumoEmTexto(r: ResumoPassagem): string {
  const partes = [r.situacao];
  if (r.combinado.length) partes.push(`Combinado: ${r.combinado.join('; ')}.`);
  if (r.objecoes.length) partes.push(`Objeções: ${r.objecoes.join('; ')}.`);
  if (r.perguntasEmAberto.length) partes.push(`Sem resposta: ${r.perguntasEmAberto.join('; ')}.`);
  if (r.proximoPasso) partes.push(`Próximo passo: ${r.proximoPasso}`);
  return partes.join(' ');
}

/* ───────────── Aprendizado: a resposta do time vira sugestão para a base ───────────── */

export interface Aprendizado {
  /** A pergunta, escrita de forma geral (sem o nome do lead). */
  pergunta: string;
  /** A resposta, sem dados do lead (nome, telefone, pedido dele). */
  resposta: string;
  titulo: string;
}

const ESQUEMA_APRENDIZADO: EsquemaIa = {
  type: 'OBJECT',
  properties: {
    util: { type: 'BOOLEAN' },
    titulo: { type: 'STRING' },
    pergunta: { type: 'STRING' },
    resposta: { type: 'STRING' },
  },
  required: ['util', 'titulo', 'pergunta', 'resposta'],
};

export function promptAprendizado(e: { empresa: string; pergunta: string; respostaDoTime: string }): string {
  return [
    `Um lead perguntou algo que a IA de atendimento da ${e.empresa} não sabia, e um vendedor respondeu. Transforme isso em uma pergunta e resposta para a base de conhecimento, que vai valer para TODOS os próximos leads. Responda só com o JSON pedido.`,
    '',
    `Pergunta do lead: ${e.pergunta.slice(0, 600)}`,
    `Resposta do vendedor: ${e.respostaDoTime.slice(0, 1500)}`,
    '',
    '- "util": false se a resposta do vendedor não responde a pergunta, é só sobre esse lead (um pedido, um horário dele, "vou ver e te falo") ou não serve para outros leads.',
    '- "pergunta": a pergunta de forma geral, sem nome de pessoa ou empresa do lead.',
    '- "resposta": o que o vendedor disse, reescrito de forma geral e fiel. Não acrescente nada que ele não disse. Sem nome, telefone ou dados do lead.',
    '- "titulo": 3 a 6 palavras sobre o assunto (ex.: "Atendimento em Feira de Santana").',
  ].join('\n');
}

export function lerAprendizado(bruto: string): Aprendizado | null {
  try {
    const j = JSON.parse(bruto) as Partial<Aprendizado> & { util?: boolean };
    if (!j.util) return null;
    const pergunta = String(j.pergunta ?? '').trim();
    const resposta = String(j.resposta ?? '').trim();
    if (pergunta.length < 5 || resposta.length < 5) return null;
    return {
      pergunta: pergunta.slice(0, 500),
      resposta: resposta.slice(0, 2000),
      titulo: (String(j.titulo ?? '').trim() || pergunta).slice(0, 120),
    };
  } catch {
    return null;
  }
}

export async function extrairAprendizado(
  cfg: ConfigIa,
  e: { empresa: string; pergunta: string; respostaDoTime: string },
): Promise<Aprendizado | null> {
  const texto = await gerarJson(cfg, {
    prompt: promptAprendizado(e),
    esquema: ESQUEMA_APRENDIZADO,
    temperatura: 0.2,
    timeoutMs: 30_000,
    maxTokens: 600,
  });
  return lerAprendizado(texto);
}
