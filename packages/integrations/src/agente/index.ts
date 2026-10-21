import { type ConfigIa, type EsquemaIa, gerarJson } from '../ia/index.js';

/**
 * Cérebro do agente de abordagem: lê a conversa com o lead e decide o próximo passo (responder,
 * marcar reunião, passar para você, encerrar). Só sabe o que está na base de conhecimento da conta
 * e na conversa; o resto é passado para um humano.
 */

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
  /** Nome da empresa que vende (a conta). */
  empresa: string;
  sobreEmpresa: string;
  regras: string;
  horariosReuniao: string;
  remetente: string;
  agora: string;
  lead: { empresa: string; cidade: string | null; contato: string | null; etapa: string };
  conversa: { de: 'nos' | 'lead'; texto: string; em: string }[];
}

const ESQUEMA: EsquemaIa = {
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
    `Você é ${c.remetente || 'o atendente'} da ${c.empresa}, conversando pelo WhatsApp com uma empresa que prospectamos.`,
    `SOBRE A ${c.empresa.toUpperCase()} (use só isto; não invente nada fora daqui):`,
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

export async function decidirComIa(cfg: ConfigIa, c: ContextoAgente): Promise<DecisaoAgente> {
  const texto = await gerarJson(cfg, {
    prompt: promptAgente(c),
    esquema: ESQUEMA,
    temperatura: 0.4,
    timeoutMs: 45_000,
    maxTokens: 800,
  });
  return lerDecisao(texto);
}

/* ───────────── Resposta de e-mail: o lead tem interesse? ───────────── */

export type ClasseRespostaEmail = 'interessado' | 'sem_interesse' | 'descadastro' | 'automatica';

export interface AnaliseRespostaEmail {
  classe: ClasseRespostaEmail;
  /** Uma frase com o que o lead disse (para o vendedor ler no card). */
  resumo: string;
}

const ESQUEMA_EMAIL: EsquemaIa = {
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
  cfg: ConfigIa,
  c: { sobreEmpresa: string; assunto: string; texto: string },
): Promise<AnaliseRespostaEmail | null> {
  const texto = await gerarJson(cfg, {
    prompt: promptRespostaEmail(c),
    esquema: ESQUEMA_EMAIL,
    temperatura: 0.1,
    timeoutMs: 30_000,
    maxTokens: 300,
  });
  return lerAnaliseEmail(texto);
}

/* ───────────── Abertura do e-mail escrita para cada lead ───────────── */

export interface EntradaAbertura {
  /** Quem manda: o que a empresa faz (base de conhecimento do agente). */
  sobreEmpresa: string;
  /** O que a campanha pede: dor do nicho, tom, o que destacar, o que evitar. */
  instrucoes: string;
  /** Texto do e-mail (para a abertura combinar com o resto e não repetir). */
  corpo: string;
  lead: {
    empresa: string;
    cidade: string | null;
    contato: string | null;
    categoria: string | null;
    /** O que a empresa faz, em uma frase (do enriquecimento). */
    resumo: string | null;
    notaGoogle: number | null;
    avaliacoesGoogle: number | null;
    site: string | null;
    instagram: string | null;
    anosDeEmpresa: number | null;
  };
}

export interface Abertura {
  abertura: string;
}

const ESQUEMA_ABERTURA: EsquemaIa = {
  type: 'OBJECT',
  properties: { abertura: { type: 'STRING' } },
  required: ['abertura'],
};

export function promptAbertura(e: EntradaAbertura): string {
  const l = e.lead;
  const fatos = [
    `Empresa: ${l.empresa}${l.cidade ? ` (${l.cidade})` : ''}`,
    l.contato && `Pessoa: ${l.contato}`,
    l.categoria && `Categoria no Google: ${l.categoria}`,
    l.resumo && `O que faz: ${l.resumo}`,
    l.notaGoogle != null && `Nota no Google: ${l.notaGoogle} (${l.avaliacoesGoogle ?? 0} avaliações)`,
    l.anosDeEmpresa != null && `Tempo de empresa: ${l.anosDeEmpresa} anos`,
    l.site && `Site: ${l.site}`,
    l.instagram && `Instagram: @${l.instagram}`,
  ].filter(Boolean);
  return [
    'Você escreve a abertura de um e-mail de prospecção B2B em português do Brasil.',
    'A abertura vem logo depois da saudação ("Olá, Fulano!") e antes da apresentação: 1 ou 2 frases curtas, no máximo 45 palavras, que mostram que olhamos a empresa dele e ligam isso ao que oferecemos.',
    'Use SOMENTE os fatos abaixo; não invente números, clientes, prêmios nem elogios genéricos ("empresa incrível"). Sem saudação, sem assinatura, sem emojis, sem links.',
    '',
    `QUEM ESCREVE: ${e.sobreEmpresa.slice(0, 1500) || 'não informado'}`,
    `INSTRUÇÕES DA CAMPANHA: ${e.instrucoes.slice(0, 2000) || 'nenhuma'}`,
    '',
    'FATOS DO LEAD:',
    ...fatos,
    '',
    'RESTO DO E-MAIL (para não repetir):',
    e.corpo.slice(0, 2500),
    '',
    'Responda em JSON com "abertura".',
  ].join('\n');
}

/** Abertura conferida: tira saudação/assinatura que a IA tenha posto e limita o tamanho. */
export function lerAbertura(texto: string): string | null {
  let j: Partial<Abertura> = {};
  try {
    j = JSON.parse(texto) as Partial<Abertura>;
  } catch {
    return null;
  }
  let a = String(j.abertura ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(ol[áa]|oi|bom dia|boa tarde|boa noite|prezad[oa])(?=[\s,!.?])[^.!?]{0,40}[.!?]\s*/i, '')
    .replace(/^(ol[áa]|oi|bom dia|boa tarde|boa noite|prezad[oa])(?=[\s,!.?])[^,]{0,40},\s*/i, '')
    .trim();
  a = a.charAt(0).toUpperCase() + a.slice(1);
  if (!a) return null;
  if (a.length > 400) a = `${a.slice(0, 400).replace(/\s+\S*$/, '')}…`;
  return a;
}

export async function personalizarAbertura(cfg: ConfigIa, e: EntradaAbertura): Promise<string | null> {
  const texto = await gerarJson(cfg, {
    prompt: promptAbertura(e),
    esquema: ESQUEMA_ABERTURA,
    temperatura: 0.6,
    timeoutMs: 30_000,
    maxTokens: 300,
  });
  return lerAbertura(texto);
}
