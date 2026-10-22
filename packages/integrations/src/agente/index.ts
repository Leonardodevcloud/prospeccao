import { type ConfigIa, type EsquemaIa, gerarJson } from '../ia/index.js';

/**
 * Cérebro do agente de abordagem: lê a conversa com o lead e decide o próximo passo (responder,
 * marcar reunião, passar para você, encerrar). Só sabe o que está na base de conhecimento da conta
 * e na conversa; o resto é passado para um humano.
 */

export type AcaoAgente =
  | 'responder'
  | 'marcar_reuniao'
  | 'agendar_retorno'
  | 'passar_para_humano'
  | 'encerrar_sem_interesse'
  | 'optout';

export interface DecisaoAgente {
  acao: AcaoAgente;
  resposta: string;
  /** Data e hora da reunião combinada (ISO com fuso de São Paulo), quando acao = marcar_reuniao. */
  reuniaoEm: string | null;
  /** Quando retomar o contato (ISO), quando acao = agendar_retorno. */
  retornoEm?: string | null;
  motivo: string;
  /** Fatos novos que o lead contou nesta conversa (viram a memória do lead). */
  memoria?: string[];
  /** Pergunta do lead que a base não responde (vira "o que falta ensinar"). */
  semResposta?: string | null;
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
  /** Trechos da base de conhecimento que combinam com o que o lead escreveu. */
  conhecimento?: { titulo: string; texto: string }[];
  /** O que já sabemos do lead pelas conversas anteriores. */
  memoria?: string[];
  /** O que o enriquecimento achou do lead (ramo, porte, site, nota no Google…). */
  ficha?: string[];
  /** A resposta anterior foi barrada nas verificações: o que corrigir. */
  correcao?: { texto: string; problemas: string[] } | null;
  /** Hoje é o dia combinado para retomar a conversa (o que foi combinado). */
  retomada?: string | null;
}

const ESQUEMA: EsquemaIa = {
  type: 'OBJECT',
  properties: {
    acao: {
      type: 'STRING',
      enum: [
        'responder',
        'marcar_reuniao',
        'agendar_retorno',
        'passar_para_humano',
        'encerrar_sem_interesse',
        'optout',
      ],
    },
    resposta: { type: 'STRING' },
    reuniaoEm: { type: 'STRING', nullable: true },
    retornoEm: { type: 'STRING', nullable: true },
    motivo: { type: 'STRING' },
    memoria: { type: 'ARRAY', items: { type: 'STRING' } },
    semResposta: { type: 'STRING', nullable: true },
  },
  required: ['acao', 'resposta', 'motivo'],
};

/** O que a IA deve buscar em cada etapa do funil. */
const OBJETIVO_DA_ETAPA: Record<string, string> = {
  a_abordar:
    'despertar interesse e entender se faz sentido para ele; o objetivo é marcar uma conversa rápida',
  abordado: 'despertar interesse e entender se faz sentido para ele; o objetivo é marcar uma conversa rápida',
  respondeu: 'tirar as dúvidas, entender a necessidade dele e marcar uma conversa rápida',
  reuniao: 'a reunião já está marcada: confirme, remarque se ele pedir, e tire dúvidas simples',
  proposta: 'a proposta já foi enviada: tire dúvidas da base; negociação de preço e condições é com o time',
};

export function promptAgente(c: ContextoAgente): string {
  const nome = c.remetente || 'o atendente';
  const objetivo = OBJETIVO_DA_ETAPA[c.lead.etapa] ?? OBJETIVO_DA_ETAPA.respondeu;
  const trechos = c.conhecimento ?? [];
  const linhas = [
    `Você é ${nome}, da ${c.empresa}, conversando pelo WhatsApp com uma empresa que prospectamos.`,
    `Seu objetivo agora: ${objetivo}.`,
    '',
    `SOBRE A ${c.empresa.toUpperCase()}:`,
    c.sobreEmpresa || '(não informado)',
  ];
  if (trechos.length)
    linhas.push(
      '',
      'INFORMAÇÕES DA EMPRESA QUE COMBINAM COM A CONVERSA:',
      ...trechos.map((t, i) => `[${i + 1}] ${t.titulo}\n${t.texto}`),
    );
  linhas.push('', 'REGRAS DA EMPRESA:', c.regras || '(nenhuma)');
  linhas.push(
    '',
    `LEAD: ${c.lead.empresa}${c.lead.cidade ? `, ${c.lead.cidade}` : ''}${c.lead.contato ? `; falando com ${c.lead.contato}` : ''}. Etapa no funil: ${c.lead.etapa}.`,
  );
  if (c.ficha?.length)
    linhas.push('O que sabemos da empresa dele (pesquisa):', ...c.ficha.map((f) => `- ${f}`));
  if (c.memoria?.length)
    linhas.push('O que ele já contou (não pergunte de novo):', ...c.memoria.map((f) => `- ${f}`));
  linhas.push(
    `Horários para reunião: ${c.horariosReuniao}. Agora é ${c.agora} (horário de Brasília).`,
    '',
    'COMO RESPONDER:',
    '- Use SÓ o que está acima. Preço, prazo, condição, desconto, garantia, link, telefone ou e-mail que não estiverem escritos acima: não diga. Nesses casos, ou se não tiver certeza, use "passar_para_humano".',
    '- Escreva como uma pessoa no WhatsApp: frases curtas, no tom do lead (formal se ele for formal), sem markdown, sem listas, no máximo 1 emoji. Até 2 mensagens curtas separadas por uma linha em branco; no total, no máximo 4 frases.',
    '- Responda primeiro o que ele perguntou, depois avance: termine com UMA pergunta ou um próximo passo concreto (exceto ao encerrar).',
    '- Objeção ("já tenho fornecedor", "está caro", "agora não"): reconheça sem discutir, faça uma pergunta para entender, e mostre um ponto da empresa que responda àquela objeção. Se ele recusar duas vezes, encerre com educação.',
    '- Para marcar reunião, ofereça dois horários concretos dentro dos horários permitidos.',
    '- Não repita frases que já mandamos na conversa. Use o nome da pessoa quando souber.',
    '- Se perguntarem se é robô ou IA, não negue: diga que é o assistente virtual da empresa e ofereça chamar alguém do time.',
    '',
    'Decida o próximo passo e responda em JSON:',
    '- acao "responder": tirar dúvida ou continuar a conversa rumo à reunião; "resposta" é a mensagem.',
    '- acao "marcar_reuniao": o lead CONFIRMOU dia e horário; "reuniaoEm" em ISO 8601 com -03:00; "resposta" confirma.',
    '- acao "agendar_retorno": o lead pediu para falar depois ("me chama semana que vem", "depois do dia 10", "agora estou sem tempo"); "retornoEm" é a data e hora para retomar, em ISO 8601 com -03:00, dentro dos horários permitidos (se ele não disse quando, daqui a 7 dias às 10h); "resposta" confirma curto ("Combinado, te chamo na segunda!").',
    '- acao "passar_para_humano": pediu preço fechado, proposta, contrato, perguntou algo que não está acima, reclamou, quer falar com uma pessoa, ou você não tem certeza; "resposta" pode ser vazia ou algo como "Vou confirmar com o time e já te retorno" (sem prometer o que não sabe).',
    '- acao "encerrar_sem_interesse": disse claramente que não tem interesse; "resposta" agradece com educação e deixa a porta aberta.',
    '- acao "optout": pediu para não receber mais mensagens; "resposta" vazia.',
    '"motivo": uma frase curta explicando a decisão (para o vendedor ler).',
    '"memoria": fatos NOVOS e úteis que o lead contou nesta conversa (fornecedor atual, volume, necessidade, quem cuida das compras segundo ele, melhor horário), cada um em poucas palavras; [] se nada novo.',
    '"semResposta": se ele perguntou algo que as informações acima não respondem, escreva a pergunta dele de forma geral (ex.: "Vocês atendem em Feira de Santana?"); senão null.',
  );
  if (c.retomada)
    linhas.push(
      '',
      `HOJE É O DIA COMBINADO PARA RETOMAR A CONVERSA (${c.retomada}). Escreva a mensagem de retomada: lembre do que foi conversado em uma frase e faça uma pergunta para avançar. Use acao "responder".`,
    );
  if (c.correcao)
    linhas.push(
      '',
      'ATENÇÃO: sua resposta anterior foi barrada e não foi enviada:',
      `"${c.correcao.texto}"`,
      'Problemas:',
      ...c.correcao.problemas.map((p) => `- ${p}`),
      'Escreva de novo corrigindo isso. Se não der para responder sem esses itens, use "passar_para_humano".',
    );
  linhas.push(
    '',
    'CONVERSA (mais antiga primeiro):',
    ...c.conversa.slice(-20).map((m) => `${m.de === 'nos' ? 'NÓS' : 'LEAD'}: ${m.texto}`),
  );
  return linhas.join('\n');
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
      memoria: [],
      semResposta: null,
    };
  }
  const acoes: AcaoAgente[] = [
    'responder',
    'marcar_reuniao',
    'agendar_retorno',
    'passar_para_humano',
    'encerrar_sem_interesse',
    'optout',
  ];
  let acao: AcaoAgente = acoes.includes(j.acao as AcaoAgente) ? (j.acao as AcaoAgente) : 'passar_para_humano';
  const resposta = String(j.resposta ?? '')
    .trim()
    .slice(0, 900);
  let reuniaoEm: string | null = null;
  if (acao === 'marcar_reuniao') {
    const d = j.reuniaoEm ? new Date(j.reuniaoEm) : null;
    if (d && Number.isFinite(d.getTime()) && d.getTime() > Date.now() - 3600_000) reuniaoEm = d.toISOString();
    else acao = 'passar_para_humano';
  }
  let retornoEm: string | null = null;
  if (acao === 'agendar_retorno') {
    const d = j.retornoEm ? new Date(j.retornoEm) : null;
    // De 1 hora a 4 meses para frente; fora disso, não vale.
    if (d && d.getTime() > Date.now() + 3600_000 && d.getTime() < Date.now() + 120 * 86_400_000)
      retornoEm = d.toISOString();
    else acao = resposta ? 'responder' : 'passar_para_humano';
  }
  if ((acao === 'responder' || acao === 'encerrar_sem_interesse') && !resposta) acao = 'passar_para_humano';
  const memoria = (Array.isArray(j.memoria) ? j.memoria : [])
    .map((f) => String(f).replace(/\s+/g, ' ').trim().slice(0, 160))
    .filter((f) => f.length >= 3)
    .slice(0, 5);
  const semResposta = j.semResposta ? String(j.semResposta).trim().slice(0, 300) || null : null;
  return {
    acao,
    resposta,
    reuniaoEm,
    retornoEm,
    motivo: String(j.motivo ?? '').slice(0, 300),
    memoria,
    semResposta,
  };
}

/** Junta a memória do lead: o que é novo entra, repetido (mesmo texto) não; guarda os 15 mais recentes. */
export function juntarMemoria(atual: string[], novos: string[], maximo = 15): string[] {
  const chave = (t: string) =>
    t
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const vistos = new Set(atual.map(chave));
  const saida = [...atual];
  for (const n of novos) {
    const k = chave(n);
    if (!k || vistos.has(k)) continue;
    vistos.add(k);
    saida.push(n);
  }
  return saida.slice(-maximo);
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
    maxTokens: 1000,
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
export * from './conhecimento.js';
export * from './passagem.js';
export * from './verificacoes.js';
