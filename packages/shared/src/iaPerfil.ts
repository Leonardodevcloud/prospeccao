import { z } from 'zod';

/**
 * Perfil da IA de atendimento: tudo o que ela pode usar, organizado em seções que o gestor preenche
 * e confere. Ela só fala o que está aqui (e na base de conhecimento); o resto vai para o time.
 * A IA pode sugerir o conteúdo (a partir do site, de documentos, de conversas reais), mas a
 * sugestão só vale depois que uma pessoa aceita.
 */

const texto = (max = 2000) => z.string().trim().max(max).default('');
const obrig = (max: number) => z.string().trim().min(1).max(max);
const lista = (max = 40, tam = 300) => z.array(z.string().trim().min(1).max(tam)).max(max);

export const SECOES_IA = [
  'quem',
  'empresa',
  'regiao',
  'oferta',
  'objetivo',
  'objecoes',
  'limites',
  'reuniao',
] as const;
export type SecaoIa = (typeof SECOES_IA)[number];

/** Base de conhecimento e prova também contam na prontidão, mas não são seções do formulário. */
export const ROTULO_SECAO_IA: Record<SecaoIa | 'base' | 'prova', string> = {
  quem: 'Quem atende',
  empresa: 'A empresa',
  regiao: 'Onde atende',
  oferta: 'O que vende',
  objetivo: 'Objetivo e qualificação',
  objecoes: 'Objeções',
  limites: 'Limites e passagem',
  reuniao: 'Reunião',
  base: 'Base de conhecimento',
  prova: 'Prova',
};

export const TONS = ['formal', 'proximo', 'descontraido'] as const;
export const ROTULO_TOM: Record<(typeof TONS)[number], string> = {
  formal: 'Formal',
  proximo: 'Próximo, profissional',
  descontraido: 'Descontraído',
};

export const POLITICAS_PRECO = ['nunca', 'so_o_escrito', 'tabela'] as const;
export const ROTULO_POLITICA_PRECO: Record<(typeof POLITICAS_PRECO)[number], string> = {
  nunca: 'Nunca falar valores',
  so_o_escrito: 'Pode dar só o que está escrito aqui',
  tabela: 'Usar a tabela (na base de conhecimento)',
};

export const METAS_CONVERSA = ['reuniao', 'visita', 'ligacao', 'orcamento', 'cadastro'] as const;
export const ROTULO_META: Record<(typeof METAS_CONVERSA)[number], string> = {
  reuniao: 'Marcar uma reunião (vídeo)',
  visita: 'Marcar uma visita',
  ligacao: 'Marcar uma ligação',
  orcamento: 'Levar para um orçamento com o time',
  cadastro: 'Fazer o cadastro do cliente',
};

/** Quando a IA para e chama alguém do time (os marcados valem; dá para escrever outros). */
export const GATILHOS_PASSAGEM = {
  preco: 'Pediu preço de item, cotação ou desconto',
  reclamacao: 'Reclamação ou problema com pedido',
  pessoa: 'Pediu para falar com uma pessoa',
  sem_base: 'Pergunta que as informações não respondem',
  fora_area: 'Cidade fora da área atendida',
  irritado: 'Cliente irritado ou ofensivo',
  juridico: 'Falou de contrato, jurídico ou nota fiscal',
  fechar: 'Quer fechar o pedido agora',
} as const;
export type GatilhoPassagem = keyof typeof GATILHOS_PASSAGEM;

export const quemAtendeIa = z.object({
  nome: texto(40),
  apresentacao: texto(300),
  tom: z.enum(TONS).nullable().default(null),
  tratamento: z.enum(['voce', 'senhor']).nullable().default(null),
  emojis: z.enum(['nunca', 'pouco']).nullable().default(null),
  /** Mensagens reais da equipe: o jeito de escrever que a IA imita (não o conteúdo). */
  exemplos: lista(10, 600).default([]),
});

export const empresaIa = z.object({
  oQueFaz: texto(1200),
  paraQuem: texto(800),
  desde: texto(80),
  diferenciais: z
    .array(z.object({ texto: obrig(300), prova: texto(300) }))
    .max(12)
    .default([]),
  funcionamento: texto(300),
});

export const regiaoIa = z.object({
  todoBrasil: z.boolean().default(false),
  ufs: z.array(z.string().trim().toUpperCase().length(2)).max(27).default([]),
  cidades: lista(400, 80).default([]),
  observacao: texto(400),
});

export const ofertaIa = z.object({
  linhas: z
    .array(z.object({ nome: obrig(120), descricao: texto(600) }))
    .max(30)
    .default([]),
  naoFazemos: lista(30, 200).default([]),
  precoPolitica: z.enum(POLITICAS_PRECO).nullable().default(null),
  precoTexto: texto(800),
  pagamento: texto(600),
  prazos: texto(600),
});

export const objetivoIa = z.object({
  meta: z.enum(METAS_CONVERSA).nullable().default(null),
  metaTexto: texto(300),
  /** O que a IA precisa descobrir antes de avançar (uma pergunta por vez). */
  perguntas: lista(10, 200).default([]),
  /** Quando não vale a pena seguir (encerra com educação). */
  desqualifica: lista(10, 200).default([]),
});

export const objecoesIa = z.object({
  itens: z
    .array(z.object({ diz: obrig(200), resposta: obrig(800) }))
    .max(30)
    .default([]),
});

export const limitesIa = z.object({
  nunca: lista(30, 200).default([]),
  gatilhos: z
    .array(z.enum(Object.keys(GATILHOS_PASSAGEM) as [GatilhoPassagem, ...GatilhoPassagem[]]))
    .max(20)
    .default([]),
  outrosGatilhos: lista(10, 200).default([]),
  /** Quem recebe quando ela passa: o responsável pelo lead ou uma pessoa fixa (id). */
  quemRecebe: z
    .union([z.literal('responsavel'), z.number().int().positive()])
    .nullable()
    .default(null),
  fraseDePassagem: texto(300),
  /** Correções feitas na prova: viram regra. */
  daProva: lista(40, 300).default([]),
});

export const reuniaoIa = z.object({
  formato: z.enum(['video', 'presencial', 'ligacao']).nullable().default(null),
  duracaoMin: z.number().int().min(5).max(240).nullable().default(null),
  horarios: texto(300),
  quemParticipa: texto(200),
  link: texto(300),
});

export const perfilIa = z.object({
  quem: quemAtendeIa.default(quemAtendeIa.parse({})),
  empresa: empresaIa.default(empresaIa.parse({})),
  regiao: regiaoIa.default(regiaoIa.parse({})),
  oferta: ofertaIa.default(ofertaIa.parse({})),
  objetivo: objetivoIa.default(objetivoIa.parse({})),
  objecoes: objecoesIa.default(objecoesIa.parse({})),
  limites: limitesIa.default(limitesIa.parse({})),
  reuniao: reuniaoIa.default(reuniaoIa.parse({})),
});
export type PerfilIa = z.infer<typeof perfilIa>;

export const ESQUEMA_SECAO: { [K in SecaoIa]: z.ZodType<PerfilIa[K]> } = {
  quem: quemAtendeIa as z.ZodType<PerfilIa['quem']>,
  empresa: empresaIa as z.ZodType<PerfilIa['empresa']>,
  regiao: regiaoIa as z.ZodType<PerfilIa['regiao']>,
  oferta: ofertaIa as z.ZodType<PerfilIa['oferta']>,
  objetivo: objetivoIa as z.ZodType<PerfilIa['objetivo']>,
  objecoes: objecoesIa as z.ZodType<PerfilIa['objecoes']>,
  limites: limitesIa as z.ZodType<PerfilIa['limites']>,
  reuniao: reuniaoIa as z.ZodType<PerfilIa['reuniao']>,
};

/** Perfil vazio (conta nova). */
export function perfilVazio(): PerfilIa {
  return perfilIa.parse({});
}

/**
 * O que falta em cada seção para ela poder ser conferida (os obrigatórios). Lista vazia: completa.
 * Os textos aparecem na tela como estão.
 */
export function faltandoNaSecao(p: PerfilIa, s: SecaoIa): string[] {
  const f: string[] = [];
  const vazio = (t: string | null | undefined, min = 1) => (t ?? '').trim().length < min;
  switch (s) {
    case 'quem':
      if (vazio(p.quem.nome)) f.push('Nome de quem atende');
      if (vazio(p.quem.apresentacao, 10)) f.push('Como se apresenta');
      if (!p.quem.tom) f.push('Tom de voz');
      if (!p.quem.tratamento) f.push('Tratamento (você ou senhor)');
      if (!p.quem.emojis) f.push('Uso de emojis');
      if (p.quem.exemplos.length < 3) f.push('Pelo menos 3 mensagens reais da equipe');
      break;
    case 'empresa':
      if (vazio(p.empresa.oQueFaz, 40)) f.push('O que a empresa faz (pelo menos uma frase completa)');
      if (vazio(p.empresa.paraQuem, 10)) f.push('Para quem vende');
      if (p.empresa.diferenciais.length < 2) f.push('Pelo menos 2 diferenciais');
      if (vazio(p.empresa.funcionamento, 5)) f.push('Horário de funcionamento');
      break;
    case 'regiao':
      if (!p.regiao.todoBrasil && !p.regiao.ufs.length && !p.regiao.cidades.length)
        f.push('Onde atende (Brasil todo, estados ou cidades)');
      break;
    case 'oferta':
      if (!p.oferta.linhas.length) f.push('Pelo menos uma linha de produto ou serviço');
      if (!p.oferta.naoFazemos.length) f.push('Pelo menos uma coisa que vocês não fazem');
      if (!p.oferta.precoPolitica) f.push('Como falar de preço');
      else if (p.oferta.precoPolitica === 'so_o_escrito' && vazio(p.oferta.precoTexto, 5))
        f.push('O que pode ser dito sobre preço');
      if (vazio(p.oferta.pagamento, 5)) f.push('Condições de pagamento');
      if (vazio(p.oferta.prazos, 5)) f.push('Prazos de entrega ou de início');
      break;
    case 'objetivo':
      if (!p.objetivo.meta) f.push('O objetivo da conversa');
      if (!p.objetivo.perguntas.length) f.push('Pelo menos uma pergunta de qualificação');
      break;
    case 'objecoes':
      if (p.objecoes.itens.length < 3) f.push('Pelo menos 3 objeções com resposta aprovada');
      break;
    case 'limites':
      if (!p.limites.nunca.length) f.push('Pelo menos uma coisa que ela nunca pode dizer');
      if (!p.limites.gatilhos.length && !p.limites.outrosGatilhos.length) f.push('Quando chamar o time');
      if (p.limites.quemRecebe == null) f.push('Quem recebe quando ela passa');
      if (vazio(p.limites.fraseDePassagem, 10)) f.push('O que ela diz ao passar');
      break;
    case 'reuniao':
      if (!p.reuniao.formato) f.push('Formato da reunião');
      if (!p.reuniao.duracaoMin) f.push('Duração');
      if (vazio(p.reuniao.horarios, 5)) f.push('Horários livres');
      break;
  }
  return f;
}

/* ───────────── O que a tela recebe ───────────── */

export interface SecaoStatusIa {
  id: SecaoIa | 'base' | 'prova';
  titulo: string;
  faltando: string[];
  /** Sugestões da IA esperando alguém aceitar ou descartar. */
  sugestoes: number;
  conferida: { por: string; em: string } | null;
  /** 0 a 100. */
  pct: number;
}

export interface SugestaoIaDTO {
  id: number;
  secao: SecaoIa;
  campo: string;
  /** Texto ou item de lista sugerido (o formato depende do campo). */
  valor: unknown;
  origem: string;
  /** Trecho da fonte que sustenta a sugestão. */
  trecho: string | null;
  criadoEm: string;
}

export interface PerfilIaTela {
  perfil: PerfilIa;
  secoes: SecaoStatusIa[];
  sugestoes: SugestaoIaDTO[];
  /** 0 a 100 (seções conferidas + prova). */
  prontidao: number;
  pronto: boolean;
  /** O que impede ligar, em frases curtas. */
  impedimentos: string[];
  ligado: boolean;
  fontes: { site: string | null; siteLidoEm: string | null };
  /** A IA da conta está disponível (para sugerir e para a prova). */
  temIa: boolean;
  /** A configuração mudou depois da última prova completa. */
  provaDesatualizada: boolean;
}

export const salvarSecaoIa = z.object({
  dados: z.unknown(),
  /** Marcar como conferida (só vale com tudo obrigatório e sem sugestão pendente). */
  conferir: z.boolean().default(false),
});

export const fonteSugestaoIa = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('site'), url: z.string().trim().url().max(500) }),
  z.object({
    tipo: z.literal('texto'),
    rotulo: z.string().trim().min(2).max(120),
    texto: z.string().min(40).max(200_000),
  }),
  z.object({
    tipo: z.literal('arquivo'),
    nome: z.string().trim().min(1).max(200),
    mime: z.string().max(200),
    base64: z.string().min(10).max(20_000_000),
  }),
  z.object({ tipo: z.literal('base') }),
  z.object({
    tipo: z.literal('entrevista'),
    respostas: z
      .array(z.object({ pergunta: z.string().max(400), resposta: z.string().max(4000) }))
      .min(1)
      .max(30),
  }),
]);
export type FonteSugestaoIa = z.infer<typeof fonteSugestaoIa>;

/* ───────────── Prova ───────────── */

export const TIPOS_CENARIO = [
  'basico',
  'objecao',
  'fora_area',
  'preco',
  'armadilha',
  'passagem',
  'reuniao',
  'seu',
] as const;
export const ROTULO_CENARIO: Record<(typeof TIPOS_CENARIO)[number], string> = {
  basico: 'Básico',
  objecao: 'Objeção',
  fora_area: 'Fora da área',
  preco: 'Preço',
  armadilha: 'Armadilha',
  passagem: 'Passagem',
  reuniao: 'Reunião',
  seu: 'Seu cenário',
};

export interface FraseConferida {
  frase: string;
  tipo: 'fato' | 'cordialidade' | 'pergunta';
  /** De onde veio (rótulo da fonte); null num fato = sem fonte. */
  fonte: string | null;
  trecho: string | null;
}

export interface CenarioProvaDTO {
  id: number;
  chave: string;
  tipo: (typeof TIPOS_CENARIO)[number];
  titulo: string;
  mensagem: string;
  /** O que se espera dela (para quem avalia). */
  esperado: string;
  resposta: string | null;
  acao: string | null;
  motivo: string | null;
  conferencia: FraseConferida[];
  /** A mensagem teria sido barrada na vida real (e por quê). */
  barrada: string[];
  status: 'pendente' | 'aprovada' | 'reprovada';
  correcao: string | null;
  rodadaEm: string | null;
  avaliadaPor: string | null;
}

export const avaliarCenario = z.object({
  aprovar: z.boolean(),
  /** O que ela deveria ter feito (vira regra em Limites). */
  correcao: z.string().trim().max(300).optional(),
});

export const cenarioProprio = z.object({
  titulo: z.string().trim().min(3).max(80),
  mensagem: z.string().trim().min(2).max(600),
  esperado: z.string().trim().max(300).default(''),
});
