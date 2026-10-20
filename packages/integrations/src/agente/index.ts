import { requisitarJson } from '../http.js';

/**
 * Cérebro do agente de abordagem: lê a conversa com o lead e decide o próximo passo (responder,
 * marcar reunião, passar para você, encerrar). Só sabe o que está na base de conhecimento da Tutts
 * e na conversa; o resto é passado para um humano.
 */

export interface ConfigGeminiAgente {
  apiKey: string;
  modelo: string;
}

export type AcaoAgente =
  | 'responder'
  | 'marcar_reuniao'
  | 'passar_para_humano'
  | 'encerrar_sem_interesse'
  | 'optout';

export interface DecisaoAgente {
  acao: AcaoAgente;
  resposta: string;
  /** Data e hora da reunião combinada (ISO com fuso de São Paulo), quando acao = marcar_reuniao. */
  reuniaoEm: string | null;
  motivo: string;
}

export interface ContextoAgente {
  sobreEmpresa: string;
  regras: string;
  horariosReuniao: string;
  remetente: string;
  agora: string;
  lead: { empresa: string; cidade: string | null; contato: string | null; etapa: string };
  conversa: { de: 'nos' | 'lead'; texto: string; em: string }[];
}

const ESQUEMA = {
  type: 'OBJECT',
  properties: {
    acao: {
      type: 'STRING',
      enum: ['responder', 'marcar_reuniao', 'passar_para_humano', 'encerrar_sem_interesse', 'optout'],
    },
    resposta: { type: 'STRING' },
    reuniaoEm: { type: 'STRING', nullable: true },
    motivo: { type: 'STRING' },
  },
  required: ['acao', 'resposta', 'motivo'],
};

export function promptAgente(c: ContextoAgente): string {
  return [
    `Você é ${c.remetente || 'o atendente'} da Tutts, conversando pelo WhatsApp com uma loja que prospectamos.`,
    'SOBRE A TUTTS (use só isto; não invente nada fora daqui):',
    c.sobreEmpresa,
    '',
    'REGRAS:',
    c.regras,
    `Horários para reunião: ${c.horariosReuniao}. Agora é ${c.agora} (horário de Brasília).`,
    '',
    `LEAD: ${c.lead.empresa}${c.lead.cidade ? `, ${c.lead.cidade}` : ''}${c.lead.contato ? `; falando com ${c.lead.contato}` : ''}. Etapa no funil: ${c.lead.etapa}.`,
    '',
    'Decida o próximo passo e responda em JSON:',
    '- acao "responder": tirar dúvida ou continuar a conversa rumo a uma reunião; "resposta" é a mensagem.',
    '- acao "marcar_reuniao": o lead CONFIRMOU um dia e horário; "reuniaoEm" em ISO 8601 com -03:00; "resposta" confirma.',
    '- acao "passar_para_humano": pediu preço fechado, contrato, algo fora da base de conhecimento, reclamou, ou você não tem certeza; "resposta" pode ser vazia ou "Vou confirmar e já te retorno".',
    '- acao "encerrar_sem_interesse": disse claramente que não tem interesse; "resposta" agradece com educação.',
    '- acao "optout": pediu para não receber mais mensagens; "resposta" vazia.',
    '"motivo": uma frase curta explicando a decisão (para o vendedor ler).',
    'Mensagens curtas, naturais, sem parecer robô, sem emojis em excesso, nunca mais de 3 frases.',
    '',
    'CONVERSA (mais antiga primeiro):',
    ...c.conversa.slice(-20).map((m) => `${m.de === 'nos' ? 'NÓS' : 'LEAD'}: ${m.texto}`),
  ].join('\n');
}

/** Confere a decisão da IA: ação desconhecida, resposta longa ou reunião sem data viram "passar para humano". */
export function lerDecisao(texto: string): DecisaoAgente {
  let j: Partial<DecisaoAgente> = {};
  try {
    j = JSON.parse(texto) as Partial<DecisaoAgente>;
  } catch {
    return {
      acao: 'passar_para_humano',
      resposta: '',
      reuniaoEm: null,
      motivo: 'A IA não respondeu direito.',
    };
  }
  const acoes: AcaoAgente[] = [
    'responder',
    'marcar_reuniao',
    'passar_para_humano',
    'encerrar_sem_interesse',
    'optout',
  ];
  let acao: AcaoAgente = acoes.includes(j.acao as AcaoAgente) ? (j.acao as AcaoAgente) : 'passar_para_humano';
  const resposta = String(j.resposta ?? '')
    .trim()
    .slice(0, 700);
  let reuniaoEm: string | null = null;
  if (acao === 'marcar_reuniao') {
    const d = j.reuniaoEm ? new Date(j.reuniaoEm) : null;
    if (d && Number.isFinite(d.getTime()) && d.getTime() > Date.now() - 3600_000) reuniaoEm = d.toISOString();
    else acao = 'passar_para_humano';
  }
  if ((acao === 'responder' || acao === 'encerrar_sem_interesse') && !resposta) acao = 'passar_para_humano';
  return { acao, resposta, reuniaoEm, motivo: String(j.motivo ?? '').slice(0, 300) };
}

/** Pedido para parar de receber mensagens: tratado antes da IA, sem chance de erro. */
export function pediuParaParar(texto: string): boolean {
  const t = texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return /\b(pare\b|para de mandar|parar de mandar|nao (me )?(mande|envie|chame)|sair da lista|descadastr|me remov|remov(a|e) (meu|o meu|da lista)|nao quero (mais )?(receber|mensage))/.test(
    t,
  );
}

export async function decidirComGemini(cfg: ConfigGeminiAgente, c: ContextoAgente): Promise<DecisaoAgente> {
  const r = await requisitarJson<{ candidates?: { content?: { parts?: { text?: string }[] } }[] }>(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.modelo)}:generateContent`,
    {
      servico: 'Gemini',
      method: 'POST',
      headers: { 'x-goog-api-key': cfg.apiKey },
      body: {
        contents: [{ role: 'user', parts: [{ text: promptAgente(c) }] }],
        generationConfig: { temperature: 0.4, responseMimeType: 'application/json', responseSchema: ESQUEMA },
      },
      timeoutMs: 45_000,
    },
  );
  return lerDecisao(r.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
}

/* ───────────── Resposta de e-mail: o lead tem interesse? ───────────── */

export type ClasseRespostaEmail = 'interessado' | 'sem_interesse' | 'descadastro' | 'automatica';

export interface AnaliseRespostaEmail {
  classe: ClasseRespostaEmail;
  /** Uma frase com o que o lead disse (para o vendedor ler no card). */
  resumo: string;
}

const ESQUEMA_EMAIL = {
  type: 'OBJECT',
  properties: {
    classe: { type: 'STRING', enum: ['interessado', 'sem_interesse', 'descadastro', 'automatica'] },
    resumo: { type: 'STRING' },
  },
  required: ['classe', 'resumo'],
};

export function promptRespostaEmail(c: { sobreEmpresa: string; assunto: string; texto: string }): string {
  return [
    'Você classifica respostas a e-mails de prospecção B2B. Responda só com o JSON pedido.',
    `Quem mandou o e-mail: ${c.sobreEmpresa.slice(0, 1500)}`,
    '',
    'Classes:',
    '- "interessado": quer saber mais, pediu preço, proposta, ligação, reunião, fez pergunta, indicou outra pessoa ou disse "talvez mais pra frente". Na dúvida entre interessado e sem_interesse, escolha interessado.',
    '- "sem_interesse": recusou claramente (não precisa, já tem fornecedor, não atende o perfil).',
    '- "descadastro": pediu para não receber mais e-mails.',
    '- "automatica": resposta automática (férias, ausência, recebemos sua mensagem).',
    '"resumo": uma frase curta em português dizendo o que o lead disse.',
    '',
    `Assunto: ${c.assunto.slice(0, 300)}`,
    'Resposta do lead:',
    c.texto.slice(0, 6000),
  ].join('\n');
}

export function lerAnaliseEmail(bruto: string): AnaliseRespostaEmail | null {
  try {
    const j = JSON.parse(bruto) as Partial<AnaliseRespostaEmail>;
    const classes: ClasseRespostaEmail[] = ['interessado', 'sem_interesse', 'descadastro', 'automatica'];
    if (!j.classe || !classes.includes(j.classe)) return null;
    return {
      classe: j.classe,
      resumo: String(j.resumo ?? '')
        .trim()
        .slice(0, 300),
    };
  } catch {
    return null;
  }
}

export async function classificarRespostaEmail(
  cfg: ConfigGeminiAgente,
  c: { sobreEmpresa: string; assunto: string; texto: string },
): Promise<AnaliseRespostaEmail | null> {
  const r = await requisitarJson<{ candidates?: { content?: { parts?: { text?: string }[] } }[] }>(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.modelo)}:generateContent`,
    {
      servico: 'Gemini',
      method: 'POST',
      headers: { 'x-goog-api-key': cfg.apiKey },
      body: {
        contents: [{ role: 'user', parts: [{ text: promptRespostaEmail(c) }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
          responseSchema: ESQUEMA_EMAIL,
        },
      },
      timeoutMs: 30_000,
    },
  );
  return lerAnaliseEmail(r.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
}
