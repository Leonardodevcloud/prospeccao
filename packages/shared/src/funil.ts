import { z } from 'zod';

/** Etapas do funil, na ordem em que o lead avança. "descartado" fica fora do quadro. */
export const ETAPAS_FUNIL = [
  'a_abordar',
  'abordado',
  'respondeu',
  'reuniao',
  'proposta',
  'ganho',
  'perdido',
  'descartado',
] as const;
export type EtapaFunil = (typeof ETAPAS_FUNIL)[number];

/** Etapas que aparecem como colunas do quadro. */
export const COLUNAS_FUNIL = ETAPAS_FUNIL.filter((e) => e !== 'descartado');

/** Ordem de avanço: o lead nunca "volta" sozinho para uma etapa anterior. */
export const ORDEM_ETAPA: Record<EtapaFunil, number> = {
  a_abordar: 0,
  abordado: 1,
  respondeu: 2,
  reuniao: 3,
  proposta: 4,
  ganho: 5,
  perdido: 5,
  descartado: 5,
};

export const ROTULO_ETAPA: Record<EtapaFunil, string> = {
  a_abordar: 'A abordar',
  abordado: 'Abordado',
  respondeu: 'Respondeu',
  reuniao: 'Reunião',
  proposta: 'Proposta',
  ganho: 'Ganho',
  perdido: 'Perdido',
  descartado: 'Descartado',
};

export const TIPOS_ATIVIDADE = ['whatsapp', 'ligacao', 'email', 'visita', 'reuniao', 'nota'] as const;
export type TipoAtividade = (typeof TIPOS_ATIVIDADE)[number];

const texto = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null);

const dataOpcional = z
  .union([z.string().datetime({ offset: true }), z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()])
  .transform((v) => (v ? new Date(v.length === 10 ? `${v}T12:00:00-03:00` : v).toISOString() : null));

/** Mandar leads para o funil (ou descartar) em lote. */
export const funilAdicionar = z.object({
  empresaIds: z.array(z.number().int().positive()).min(1, 'Escolha ao menos um lead.').max(500),
  etapa: z.enum(['a_abordar', 'descartado']).default('a_abordar'),
  motivo: texto(300).optional(),
  /** Adiciona mesmo se o telefone já estiver em outra empresa do funil. */
  forcar: z.boolean().default(false),
});
export type FunilAdicionar = z.infer<typeof funilAdicionar>;

export const funilAtualizar = z
  .object({
    etapa: z.enum(ETAPAS_FUNIL).optional(),
    /** Coloca o card antes deste (mesma coluna); sem ele, vai para o fim. */
    antesDe: z.number().int().positive().nullable().optional(),
    motivo: texto(300).optional(),
    valorMensal: z.number().min(0).max(10_000_000).nullable().optional(),
    proximaAcao: texto(200).optional(),
    proximaAcaoEm: dataOpcional.optional(),
    /** Etapa do pipeline (a tela usa esta; o papel dela decide a cadência). */
    etapaId: z.number().int().positive().optional(),
    /** Suas etiquetas (Indicação, Farma…). */
    etiquetas: z.array(z.string().trim().min(1).max(30)).max(12).optional(),
    /** A IA conduz a conversa com este lead. */
    agente: z.boolean().optional(),
    /** Devolve para a IA o lead que ela tinha passado para você. */
    devolverParaIa: z.literal(true).optional(),
    /** Dono do lead (null = sem dono). */
    responsavelId: z.number().int().positive().nullable().optional(),
    /** Ao mover para reunião pela tela: já cria a reunião na agenda. */
    reuniao: z
      .object({
        inicio: z.string().datetime({ offset: true }),
        local: z.string().trim().max(300).optional(),
      })
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nada para atualizar.');
export type FunilAtualizar = z.infer<typeof funilAtualizar>;

export const atividadeEntrada = z.object({
  tipo: z.enum(TIPOS_ATIVIDADE),
  direcao: z.enum(['enviada', 'recebida']).nullable().default(null),
  texto: texto(4000).optional(),
  contato: texto(200).optional(),
  /** Já marca o próximo passo junto com o registro. */
  proximaAcao: texto(200).optional(),
  proximaAcaoEm: dataOpcional.optional(),
});
export type AtividadeEntrada = z.infer<typeof atividadeEntrada>;

export const filtrosFunil = z.object({
  /** Pipeline do quadro (padrão: o primeiro). */
  pipelineId: z.coerce.number().int().positive().optional(),
  etiqueta: z.string().trim().max(30).optional(),
  /** Entraram no funil nos últimos N dias. */
  dias: z.coerce.number().int().min(1).max(3650).optional(),
  ordem: z.enum(['manual', 'recentes', 'proximo', 'nota', 'contato', 'valor']).default('manual'),
  /** Dono: id de alguém ou "sem" (sem dono). */
  responsavel: z
    .string()
    .regex(/^(sem|\d+)$/)
    .optional(),
  campanhaId: z.coerce.number().int().positive().optional(),
  faixa: z.enum(['A', 'B', 'C']).optional(),
  busca: z.string().trim().max(120).optional(),
  /** Só quem tem próximo passo vencido ou para hoje. */
  pendentes: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type FiltrosFunil = z.infer<typeof filtrosFunil>;

export const filtrosRelatorio = z.object({
  /** Dias para trás (0 = desde o começo). */
  dias: z.coerce.number().int().min(0).max(3650).default(30),
  campanhaId: z.coerce.number().int().positive().optional(),
});
export type FiltrosRelatorio = z.infer<typeof filtrosRelatorio>;

/* ───────────────────────────── Cadência de follow-up ───────────────────────────── */

/** Modelos de mensagem, um por momento da cadência. */
export const MODELOS_MENSAGEM = [
  'primeira',
  'followup1',
  'followup2',
  'ultima',
  'marcar_reuniao',
  'cobrar_proposta',
] as const;
export type ModeloMensagem = (typeof MODELOS_MENSAGEM)[number];

export const ROTULO_MODELO: Record<ModeloMensagem, string> = {
  primeira: 'Primeira abordagem',
  followup1: '1º follow-up',
  followup2: 'Follow-ups seguintes',
  ultima: 'Última tentativa',
  marcar_reuniao: 'Marcar reunião (depois que respondeu)',
  cobrar_proposta: 'Cobrar proposta',
};

export interface ConfigCadencia {
  /** Dias de espera depois de cada mensagem sem resposta: [2, 3, 5] = 3 follow-ups. */
  diasFollowup: number[];
  /** Depois da última tentativa sem resposta, quantos dias até encerrar. */
  diasEncerrar: number;
  /** Encerra sozinho (vai para "Perdido: sem resposta") quando o prazo acima passa. */
  encerrarSemResposta: boolean;
  /** Dias para cobrar a proposta: [3, 7] = cobra 2 vezes. */
  diasCobrarProposta: number[];
  /** Seu nome nas mensagens ("Aqui é {remetente}, da sua empresa"). */
  remetente: string;
  modelos: Record<ModeloMensagem, string>;
}

const listaDeDias = (max: number) => z.array(z.number().int().min(1).max(60)).max(max);

export const configCadenciaEntrada = z.object({
  diasFollowup: listaDeDias(6),
  diasEncerrar: z.number().int().min(1).max(60),
  encerrarSemResposta: z.boolean(),
  diasCobrarProposta: listaDeDias(4),
  remetente: z.string().trim().max(60),
  modelos: z.object(
    Object.fromEntries(
      MODELOS_MENSAGEM.map((m) => [m, z.string().trim().min(1, 'Mensagem vazia.').max(1000)]),
    ) as Record<ModeloMensagem, z.ZodString>,
  ),
});

/** Total de mensagens que a cadência manda antes de desistir (a primeira + os follow-ups). */
export const totalTentativas = (c: Pick<ConfigCadencia, 'diasFollowup'>) => c.diasFollowup.length + 1;

/** O que a cadência faz depois de um acontecimento. */
export type EventoCadencia = 'etapa' | 'enviada' | 'recebida' | 'reuniao';

export interface PassoCadencia {
  acao: string;
  /** Em quantos dias (0 = hoje). */
  dias: number;
  /** Mensagens enviadas sem resposta nesta etapa, depois do evento. */
  tentativas: number;
  /** Última tentativa feita: encerra quando o prazo passar. */
  encerrar: boolean;
}

/**
 * Próximo passo automático. `tentativas` é quantas mensagens já foram enviadas sem resposta
 * na etapa atual (zera quando a etapa muda). Etapas fechadas não têm próximo passo.
 */
export function proximoPasso(
  etapa: EtapaFunil,
  tentativas: number,
  evento: EventoCadencia,
  c: Pick<ConfigCadencia, 'diasFollowup' | 'diasEncerrar' | 'diasCobrarProposta'>,
): PassoCadencia | null {
  const passo = (acao: string, dias: number, t = tentativas, encerrar = false): PassoCadencia => ({
    acao,
    dias,
    tentativas: t,
    encerrar,
  });
  switch (etapa) {
    case 'a_abordar':
      return passo('Primeira abordagem', 0, 0);
    case 'abordado': {
      // Entrar em "Abordado" (arrastando) conta como a primeira mensagem.
      const t = evento === 'enviada' ? tentativas + 1 : Math.max(tentativas, 1);
      if (t <= c.diasFollowup.length) return passo(`Follow-up ${t}`, c.diasFollowup[t - 1] ?? 2, t);
      return passo('Sem resposta: encerrar', c.diasEncerrar, t, true);
    }
    case 'respondeu':
      if (evento === 'enviada') return passo('Cobrar retorno', 2, tentativas + 1);
      return passo('Responder e marcar reunião', 0, 0);
    case 'reuniao':
      if (evento === 'recebida') return passo('Responder', 0, 0);
      return passo('Mandar proposta', 1, 0);
    case 'proposta': {
      if (evento === 'recebida') return passo('Responder sobre a proposta', 0, 0);
      const t = evento === 'enviada' ? tentativas + 1 : 0;
      const dias = c.diasCobrarProposta[t];
      return dias != null
        ? passo('Cobrar resposta da proposta', dias, t)
        : passo('Decidir: ganho ou perdido', 3, t);
    }
    default:
      return null;
  }
}

/** Qual modelo de mensagem usar no próximo envio. */
export function modeloDoPasso(
  etapa: EtapaFunil,
  tentativas: number,
  c: Pick<ConfigCadencia, 'diasFollowup'>,
): ModeloMensagem | null {
  if (etapa === 'a_abordar') return 'primeira';
  if (etapa === 'abordado') {
    const total = totalTentativas(c);
    if (tentativas + 1 >= total) return 'ultima';
    return tentativas <= 1 ? 'followup1' : 'followup2';
  }
  if (etapa === 'respondeu') return 'marcar_reuniao';
  if (etapa === 'proposta') return 'cobrar_proposta';
  return null;
}

/**
 * Dia do próximo passo às 9h de São Paulo, pulando sábado e domingo.
 * (O Brasil não tem horário de verão desde 2019: São Paulo é sempre -03:00.)
 */
export function dataDoPasso(dias: number, agora = new Date()): string {
  const [a, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })
    .format(agora)
    .split('-')
    .map(Number) as [number, number, number];
  const dia = new Date(Date.UTC(a, m - 1, d + dias, 12));
  if (dias > 0) while (dia.getUTCDay() === 0 || dia.getUTCDay() === 6) dia.setUTCDate(dia.getUTCDate() + 1);
  return new Date(`${dia.toISOString().slice(0, 10)}T09:00:00-03:00`).toISOString();
}

/** Monta a mensagem trocando {saudacao}, {nome}, {empresa}, {cidade} e {remetente}. */
export function montarMensagem(
  modelo: string,
  v: { nome?: string | null; empresa: string; cidade?: string | null; remetente?: string | null },
): string {
  const nome = v.nome?.trim() || '';
  const valores: Record<string, string> = {
    saudacao: nome ? `Olá, ${nome}!` : 'Olá!',
    nome,
    empresa: v.empresa,
    cidade: v.cidade?.trim() || 'sua cidade',
    remetente: v.remetente?.trim() || '',
  };
  return modelo
    .replace(/\{(\w+)\}/g, (todo, chave: string) => valores[chave] ?? todo)
    .replace(/Aqui é\s+da/g, 'Aqui é da')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ([,.!?])/g, '$1')
    .trim();
}

/** Seu retorno sobre um contato ou pessoa do lead. */
export const feedbackEntrada = z.object({
  tipo: z.enum(['numero_errado', 'nao_decisor']),
  /** numero_errado: o valor do contato como está no cadastro; nao_decisor: o nome da pessoa. */
  valor: z.string().trim().min(1).max(200),
  canal: z.string().trim().max(20).optional(),
});
export type FeedbackEntrada = z.infer<typeof feedbackEntrada>;

/* ───────────────────────────── Agente de abordagem ───────────────────────────── */

export const configAgenteEntrada = z
  .object({
    ligado: z.boolean(),
    revisarAntes: z.boolean(),
    horaInicio: z.number().int().min(0).max(23),
    horaFim: z.number().int().min(1).max(24),
    diasSemana: z.array(z.number().int().min(0).max(6)).min(1, 'Escolha ao menos um dia.').max(7),
    limiteDia: z.number().int().min(1).max(500),
    intervaloSeg: z.number().int().min(20).max(3600),
    respostasDiaLead: z.number().int().min(1).max(30),
    sobreEmpresa: z.string().trim().min(20, 'Conte um pouco da sua empresa para a IA.').max(6000),
    regras: z.string().trim().max(3000),
    horariosReuniao: z.string().trim().min(3).max(300),
  })
  .refine((v) => v.horaFim > v.horaInicio, {
    message: 'O fim do horário precisa ser depois do início.',
    path: ['horaFim'],
  });
export type ConfigAgenteEntrada = z.infer<typeof configAgenteEntrada>;

export const aprovarRascunho = z.object({ texto: z.string().trim().min(1).max(1500).optional() });

/* ───────────── Base de conhecimento do agente ───────────── */

export const conhecimentoEntrada = z
  .object({
    tipo: z.enum(['texto', 'faq']),
    titulo: z.string().trim().min(2, 'Dê um título.').max(200),
    pergunta: z.string().trim().max(500).optional(),
    conteudo: z.string().trim().min(5, 'Escreva o conteúdo.').max(60_000),
  })
  .refine((v) => v.tipo !== 'faq' || (v.pergunta?.length ?? 0) >= 5, {
    message: 'Escreva a pergunta.',
    path: ['pergunta'],
  });
export type ConhecimentoEntrada = z.infer<typeof conhecimentoEntrada>;

export const conhecimentoAtualizar = z
  .object({
    titulo: z.string().trim().min(2).max(200).optional(),
    pergunta: z.string().trim().max(500).nullable().optional(),
    conteudo: z.string().trim().min(5).max(60_000).optional(),
    aprovar: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nada para atualizar.');

export const conhecimentoArquivo = z.object({
  nome: z.string().trim().min(1).max(200),
  mime: z.string().trim().max(120),
  titulo: z.string().trim().max(200).optional(),
  /** Conteúdo em base64 (sem o prefixo data:), até 10 MB. */
  base64: z
    .string()
    .min(1)
    .max(Math.ceil((10 * 1024 * 1024 * 4) / 3) + 8, 'Arquivo grande demais (até 10 MB).'),
});

export const ensinarLacuna = z.object({
  pergunta: z.string().trim().min(5).max(500).optional(),
  resposta: z.string().trim().min(2, 'Escreva a resposta.').max(4000),
});

/* ───────────────────────────── Pipelines ───────────────────────────── */

/** O que cada etapa faz no sistema (a cadência, a IA e os relatórios usam o papel). */
export const PAPEIS_ETAPA = [
  'a_abordar',
  'abordado',
  'respondeu',
  'reuniao',
  'proposta',
  'ganho',
  'perdido',
] as const;
export type PapelEtapa = (typeof PAPEIS_ETAPA)[number];

export const ROTULO_PAPEL: Record<PapelEtapa, string> = {
  a_abordar: 'Primeiro contato',
  abordado: 'Aguardando resposta',
  respondeu: 'Conversa em andamento',
  reuniao: 'Reunião',
  proposta: 'Proposta',
  ganho: 'Ganho',
  perdido: 'Perdido',
};

const cor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor no formato #rrggbb.');

export const pipelineEntrada = z.object({ nome: z.string().trim().min(1).max(40) });

export const etapaEntrada = z.object({
  nome: z.string().trim().min(1).max(40),
  cor: cor.default('#64748b'),
  papel: z.enum(PAPEIS_ETAPA),
});

export const etapaAtualizar = z
  .object({
    nome: z.string().trim().min(1).max(40).optional(),
    cor: cor.optional(),
    papel: z.enum(PAPEIS_ETAPA).optional(),
    /** Nova posição (1 = primeira). */
    ordem: z.number().int().min(1).max(50).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nada para atualizar.');
