import { z } from 'zod';
import {
  ESTILOS,
  type EstiloCarrossel,
  FORMATOS_PECA,
  type FormatoPeca,
  MAX_SLIDES,
  MODELO,
  MODELOS,
  type ModeloSlide,
  type SlideCarrossel,
  slideEntrada,
  slideNovo,
} from './carrosseis.js';

/**
 * O time de IA dos carrosséis (v122): o cérebro da marca (o dossiê que o administrador confere), o
 * que divulgar no mês, o pedido de um carrossel, as etapas do time e o relatório que fica junto do
 * carrossel (as notas do revisor e os avisos que esperam uma pessoa decidir).
 */

const texto = (max: number) => z.string().trim().max(max, `Use até ${max} letras.`).default('');
const item = (max: number) => z.string().trim().min(1).max(max, `Use até ${max} letras.`);

/* ───────────────────────────── Cérebro da marca ───────────────────────────── */

export const dossieEntrada = z.object({
  /** O nicho em poucas palavras (ex.: "autopeças para oficinas em Salvador"). */
  nicho: texto(160),
  publico: texto(600),
  oQueVende: texto(900),
  diferenciais: z.array(item(220)).max(8).default([]),
  /** O que tira o sono do cliente (o que os posts ajudam a resolver). */
  dores: z.array(item(220)).max(8).default([]),
  /** O que o cliente quer conseguir. */
  desejos: z.array(item(220)).max(8).default([]),
  objecoes: z
    .array(z.object({ diz: item(180), resposta: item(320) }))
    .max(8)
    .default([]),
  /** Fatos que podem aparecer num post (número, prazo, garantia), cada um com de onde veio. */
  provas: z
    .array(z.object({ texto: item(260), fonte: item(80) }))
    .max(12)
    .default([]),
  /** O que os clientes perguntam de verdade (padrões, nunca de uma pessoa). */
  perguntas: z
    .array(
      z.object({
        texto: item(220),
        vezes: z.number().int().min(0).max(1_000_000).nullable().default(null),
        fonte: item(60),
      }),
    )
    .max(12)
    .default([]),
  tom: texto(500),
  /** Palavras e expressões do jeito de falar da empresa. */
  palavras: z.array(item(50)).max(15).default([]),
  nuncaDizer: z.array(item(180)).max(15).default([]),
  /** Os assuntos que a empresa quer que os posts cubram. */
  pilares: z.array(item(50)).max(6).default([]),
});
export type DossieMarca = z.infer<typeof dossieEntrada>;

export const DOSSIE_VAZIO: DossieMarca = dossieEntrada.parse({});

/** Junta o salvo com o vazio (campo novo ganha o padrão; dado estragado não derruba). */
export function dossieCompleto(salvo: unknown): DossieMarca {
  const r = dossieEntrada.safeParse(salvo ?? {});
  if (r.success) return r.data;
  const o = (salvo && typeof salvo === 'object' ? salvo : {}) as Record<string, unknown>;
  const saida: Record<string, unknown> = { ...DOSSIE_VAZIO };
  for (const k of Object.keys(DOSSIE_VAZIO)) {
    const campo = (dossieEntrada.shape as Record<string, z.ZodType>)[k]!;
    const x = campo.safeParse(o[k]);
    if (x.success) saida[k] = x.data;
  }
  return saida as DossieMarca;
}

/** O que falta no dossiê para o time escrever bem (a tela mostra e o pedido recusa sem o mínimo). */
export function faltandoNoDossie(d: DossieMarca): string[] {
  const f: string[] = [];
  if (d.oQueVende.trim().length < 20) f.push('O que a empresa vende');
  if (d.publico.trim().length < 10) f.push('Para quem vende');
  if (d.tom.trim().length < 5) f.push('O tom de voz');
  return f;
}

/** O dossiê em texto, na ordem em que o time lê (vazio não entra). */
export function textoDoDossie(d: DossieMarca, empresa: string): string {
  const linhas: string[] = [`EMPRESA: ${empresa}`];
  const add = (titulo: string, v: string | string[]) => {
    const lista = Array.isArray(v) ? v.filter((x) => x.trim()) : v.trim() ? [v.trim()] : [];
    if (!lista.length) return;
    linhas.push(
      Array.isArray(v) ? `${titulo}:\n${lista.map((x) => `- ${x}`).join('\n')}` : `${titulo}: ${lista[0]}`,
    );
  };
  add('NICHO', d.nicho);
  add('PÚBLICO', d.publico);
  add('O QUE VENDE', d.oQueVende);
  add('DIFERENCIAIS', d.diferenciais);
  add('DORES DO CLIENTE', d.dores);
  add('O QUE O CLIENTE QUER', d.desejos);
  add(
    'OBJEÇÕES (e a resposta aprovada)',
    d.objecoes.map((o) => `"${o.diz}" → ${o.resposta}`),
  );
  add(
    'PROVAS (fatos que podem aparecer num post, com a fonte)',
    d.provas.map((p) => `${p.texto} [fonte: ${p.fonte}]`),
  );
  add(
    'O QUE OS CLIENTES PERGUNTAM',
    d.perguntas.map((p) => `${p.texto}${p.vezes ? ` (${p.vezes}x)` : ''} [${p.fonte}]`),
  );
  add('TOM DE VOZ', d.tom);
  add('PALAVRAS DA MARCA', d.palavras);
  add('NUNCA DIZER', d.nuncaDizer);
  add('PILARES DE CONTEÚDO', d.pilares);
  return linhas.join('\n');
}

/* ───────────────────────────── O que divulgar ───────────────────────────── */

export const TIPOS_DIVULGAR = ['promocao', 'lancamento', 'campanha', 'data', 'novidade'] as const;
export type TipoDivulgar = (typeof TIPOS_DIVULGAR)[number];
export const ROTULO_DIVULGAR: Record<TipoDivulgar, string> = {
  promocao: 'Promoção',
  lancamento: 'Lançamento',
  campanha: 'Campanha',
  data: 'Data especial',
  novidade: 'Novidade',
};

const dataIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a data no formato AAAA-MM-DD.')
  .nullable()
  .default(null);

export const divulgarEntrada = z.object({
  tipo: z.enum(TIPOS_DIVULGAR),
  titulo: z.string().trim().min(2, 'Dê um nome curto.').max(100),
  detalhes: texto(700),
  produto: texto(100),
  /** Preços e prazo da promoção: saem nos slides exatamente como foram digitados. */
  precoDe: texto(24),
  precoPor: texto(24),
  validade: texto(60),
  condicoes: texto(240),
  /** Até quando vale (depois disso, some da lista de sugestões). */
  ate: dataIso,
});
export type DivulgarEntrada = z.infer<typeof divulgarEntrada>;

export interface DivulgarItem extends DivulgarEntrada {
  id: number;
  /** Quantos carrosséis o time já fez sobre isso. */
  usado: number;
  criadoEm: string;
}

/** O que da promoção tem que sair exatamente como foi digitado. */
export function camposExatos(d: DivulgarEntrada): { rotulo: string; valor: string }[] {
  return [
    { rotulo: 'Preço de', valor: d.precoDe },
    { rotulo: 'Preço por', valor: d.precoPor },
    { rotulo: 'Validade', valor: d.validade },
  ].filter((x) => x.valor.trim());
}

/** O texto que vai na imagem e na legenda (para conferir preços e promessas). */
export function textoDosSlides(slides: SlideCarrossel[]): string {
  return slides
    .map((s) =>
      [
        s.sobretitulo,
        s.titulo,
        s.texto,
        s.destaque,
        s.botao,
        ...s.itens,
        ...s.colunas.flatMap((c) => [c.rotulo, c.texto]),
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n');
}

const normalizar = (t: string) =>
  t
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
const soDigitos = (t: string) => t.replace(/\D/g, '');

/** Valores em reais escritos num texto (R$ 139,90; R$1.299). */
export function precosDoTexto(t: string): string[] {
  return [...t.matchAll(/R\$\s?\d{1,3}(?:\.\d{3})*(?:,\d{2})?|R\$\s?\d+(?:,\d{2})?/g)].map((m) => m[0]);
}

/**
 * Confere a promoção nos slides e na legenda: cada valor digitado aparece igual (pelo menos uma
 * vez) e nenhum preço que não foi digitado aparece. Devolve os problemas em português.
 */
export function conferirPromocao(d: DivulgarEntrada, slides: SlideCarrossel[], legenda: string): string[] {
  const problemas: string[] = [];
  const tudo = `${textoDosSlides(slides)}\n${legenda}`;
  const t = normalizar(tudo);
  for (const c of camposExatos(d))
    if (!t.includes(normalizar(c.valor)))
      problemas.push(`${c.rotulo} "${c.valor}" precisa aparecer exatamente assim.`);
  const permitidos = new Set([d.precoDe, d.precoPor].filter(Boolean).map(soDigitos));
  for (const p of precosDoTexto(tudo))
    if (!permitidos.has(soDigitos(p)))
      problemas.push(`O preço ${p} não foi informado na promoção: tire ou use o preço informado.`);
  return [...new Set(problemas)];
}

/* ───────────────────────────── O pedido de um carrossel ───────────────────────────── */

export const OBJETIVOS_CARROSSEL = ['ensinar', 'vender', 'resultado', 'bastidores'] as const;
export type ObjetivoCarrossel = (typeof OBJETIVOS_CARROSSEL)[number];
export const OBJETIVO: Record<ObjetivoCarrossel, { nome: string; dica: string }> = {
  ensinar: { nome: 'Ensinar', dica: 'dicas, passo a passo' },
  vender: { nome: 'Vender', dica: 'produto, oferta' },
  resultado: { nome: 'Mostrar resultado', dica: 'caso de cliente' },
  bastidores: { nome: 'Bastidores', dica: 'equipe, rotina' },
};

export const CHAMADAS_FINAIS = ['comentar', 'whatsapp', 'direct', 'salvar'] as const;
export type ChamadaFinal = (typeof CHAMADAS_FINAIS)[number];
export const CHAMADA_FINAL: Record<ChamadaFinal, string> = {
  comentar: 'Comentar uma palavra',
  whatsapp: 'Chamar no WhatsApp',
  direct: 'Mandar mensagem no direct',
  salvar: 'Salvar e compartilhar (sem pedido de contato)',
};

/** Palavra do "comente": uma palavra só, sem espaço (vira o botão "Comente PALAVRA"). */
export const PALAVRA_COMENTAR = /^[\p{L}\p{N}]{2,20}$/u;

/**
 * v144: as fotos que a empresa manda junto do pedido (carrossel ou cards). Cada uma entra nas peças
 * do jeito escolhido: como está, melhorada pela IA (a mesma foto, com luz, cor e fundo tratados; o
 * assunto igual) ou o produto num cenário novo. O revisor visual confere as feitas pela IA.
 */
export const TRATAMENTOS_FOTO = ['como_esta', 'melhorar', 'cenario'] as const;
export type TratamentoFoto = (typeof TRATAMENTOS_FOTO)[number];
export const TRATAMENTO_FOTO: Record<TratamentoFoto, { nome: string; dica: string }> = {
  como_esta: { nome: 'Usar como está', dica: 'A foto entra do jeito que foi enviada.' },
  melhorar: { nome: 'Melhorar a foto', dica: 'A IA trata luz, cor, nitidez e fundo; o assunto fica igual.' },
  cenario: { nome: 'Produto num cenário novo', dica: 'O produto fica igual; a IA troca o fundo e a luz.' },
};
export const MAX_FOTOS_PEDIDO = 4;

/* ── v148/v149: a conversa da estrategista antes de criar ── */

/** Perguntas por rodada. */
export const MAX_PERGUNTAS_TIME = 4;
/** v149: a estrategista conversa em até 3 rodadas; ela para antes quando já tem o que precisa. */
export const MAX_RODADAS_TIME = 3;
export const MAX_RESPOSTAS_TIME = MAX_PERGUNTAS_TIME * MAX_RODADAS_TIME;
/** Uma pergunta da estrategista, com as respostas prontas para tocar (a pessoa pode escrever outra). */
export interface PerguntaDoTime {
  pergunta: string;
  /** Por que ela pergunta (uma linha). */
  porque: string;
  sugestoes: string[];
}
/**
 * v149: uma rodada da conversa. `entendi` é o resumo do que a estrategista entendeu até aqui (o briefing
 * da peça); `pronto` diz que ela já tem o que precisa (aí não vem pergunta e a pessoa confere o resumo).
 */
export interface RodadaDoTime {
  pronto: boolean;
  entendi: string;
  perguntas: PerguntaDoTime[];
  /** Quantas rodadas a pessoa já respondeu. */
  rodada: number;
}
/** v149: o briefing que a pessoa conferiu (e pode ter corrigido) antes de criar: vale como fato. */
export const briefingEntrada = z.string().trim().max(1500).default('');
/** O que a pessoa respondeu: vira fonte do pedido (o card pode dizer o que foi confirmado aqui). */
export const respostasEntrada = z
  .array(
    z.object({
      pergunta: z.string().trim().min(3).max(200),
      resposta: z.string().trim().min(1).max(400),
    }),
  )
  .max(MAX_RESPOSTAS_TIME + 2)
  .default([]);
export type RespostaDoTime = z.infer<typeof respostasEntrada>[number];

/** O pedido de perguntas: o mesmo rascunho do formulário (carrossel ou cards). */
export const perguntasEntrada = z.object({
  tipo: z.enum(['carrossel', 'cards']),
  assunto: z.string().trim().max(1000).default(''),
  divulgarId: z.number().int().positive().nullable().default(null),
  objetivo: z.string().trim().max(30).default(''),
  chamada: z.string().trim().max(20).default(''),
  formato: z.string().trim().max(10).default('feed'),
  fotos: z.number().int().min(0).max(MAX_FOTOS_PEDIDO).default(0),
  /** v149: o que já foi perguntado e respondido (resposta vazia: a pessoa não soube ou pulou). */
  conversa: z
    .array(
      z.object({
        pergunta: z.string().trim().min(3).max(200),
        resposta: z.string().trim().max(400).default(''),
      }),
    )
    .max(MAX_RESPOSTAS_TIME + 2)
    .default([]),
  /** v149: quantas rodadas a pessoa já respondeu (0 na primeira chamada). */
  rodada: z.number().int().min(0).max(MAX_RODADAS_TIME).default(0),
});
export type PedidoDePerguntas = z.infer<typeof perguntasEntrada>;
export const fotosDoPedidoEntrada = z
  .array(
    z.object({
      fotoId: z.number().int().positive(),
      tratamento: z.enum(TRATAMENTOS_FOTO).default('como_esta'),
    }),
  )
  .max(MAX_FOTOS_PEDIDO, `Até ${MAX_FOTOS_PEDIDO} fotos por pedido.`)
  .default([]);
export type FotoDoPedido = z.infer<typeof fotosDoPedidoEntrada>[number];

export const pedidoTimeEntrada = z
  .object({
    /** Sobre o que é e o que não pode faltar (vai para o time como o pedido de quem criou). */
    assunto: z.string().trim().max(1000, 'Use até 1.000 letras.').default(''),
    divulgarId: z.number().int().positive().nullable().default(null),
    objetivo: z.enum(OBJETIVOS_CARROSSEL).default('ensinar'),
    /** null: o time decide (5 a 10). */
    slides: z.number().int().min(4).max(MAX_SLIDES).nullable().default(null),
    /** null: o da identidade visual. */
    estilo: z.enum(ESTILOS).nullable().default(null),
    chamada: z.enum(CHAMADAS_FINAIS).default('salvar'),
    palavra: z.string().trim().max(20).default(''),
    usarFotos: z.boolean().default(true),
    /** v132: a IA pode gerar as imagens que faltarem (sem texto, na paleta da marca). */
    gerarImagens: z.boolean().default(false),
    /** v132: a foto do produto (das fotos da empresa): a capa usa o produto num cenário novo. */
    fotoProdutoId: z.number().int().positive().nullable().default(null),
    /** v132: um post de que a empresa gostou (inspira o clima e a composição; nunca é copiado). */
    referenciaId: z.number().int().positive().nullable().default(null),
    /** v134: a ideia de onde o carrossel saiu (a aba Ideias marca como usada). */
    ideiaId: z.number().int().positive().nullable().default(null),
    /** v144: as fotos enviadas para este pedido (entram nos slides, tratadas como escolhido). */
    fotos: fotosDoPedidoEntrada,
    /** v148: as respostas às perguntas do time (viram fonte do pedido). */
    respostas: respostasEntrada,
    /** v149: o resumo da estrategista que a pessoa conferiu antes de criar (vira fonte do pedido). */
    briefing: briefingEntrada,
  })
  .refine((d) => d.assunto.length >= 3 || d.divulgarId != null, {
    message: 'Diga sobre o que é o carrossel (ou escolha o que divulgar).',
    path: ['assunto'],
  })
  .refine((d) => d.chamada !== 'comentar' || PALAVRA_COMENTAR.test(d.palavra), {
    message: 'Escolha a palavra que a pessoa vai comentar (uma palavra só, sem espaço).',
    path: ['palavra'],
  });
export type PedidoTime = z.infer<typeof pedidoTimeEntrada>;

/** Os pedidos rápidos ao redator, slide a slide (o editor mostra como botões). */
export const PEDIDOS_RAPIDOS = ['curto', 'direto', 'outro_jeito'] as const;
export type PedidoRapido = (typeof PEDIDOS_RAPIDOS)[number];
export const PEDIDO_RAPIDO: Record<PedidoRapido, { rotulo: string; instrucao: string }> = {
  curto: { rotulo: 'Mais curto', instrucao: 'Deixe o slide bem mais curto, sem perder a ideia.' },
  direto: { rotulo: 'Mais direto', instrucao: 'Vá direto ao ponto: corte rodeio e palavra vazia.' },
  outro_jeito: {
    rotulo: 'Outro jeito de dizer',
    instrucao: 'Diga a mesma ideia de outro jeito, com outras palavras.',
  },
};

/* ───────────────────────────── As etapas do time ───────────────────────────── */

export const ETAPAS_TIME = ['estrategista', 'redator', 'diretor', 'revisor'] as const;
export type EtapaTime = (typeof ETAPAS_TIME)[number];
/**
 * O time como a pessoa conhece (a apresentação na primeira entrada, o andamento do pedido, a
 * Conversa): nome, a função em poucas palavras, o que faz e a foto (em /carrosseis/time/).
 */
export const ETAPA_TIME: Record<
  EtapaTime,
  { nome: string; funcao: string; faz: string; apresentacao: string; foto: string }
> = {
  estrategista: {
    nome: 'Estrategista',
    funcao: 'Planeja o carrossel',
    faz: 'Escolhe o ângulo, o gancho e a ordem dos slides.',
    apresentacao:
      'Lê o cérebro da marca, o que você quer divulgar e os posts que mais funcionaram. Escolhe o ângulo, cria três ganchos para a capa e monta o roteiro.',
    foto: '/carrosseis/time/estrategista.jpg',
  },
  redator: {
    nome: 'Redatora',
    funcao: 'Escreve os textos',
    faz: 'Escreve os slides, a legenda e as hashtags.',
    apresentacao:
      'Escreve cada slide no tamanho certo para ler no celular, a legenda e as hashtags, sempre no tom da sua empresa.',
    foto: '/carrosseis/time/redatora.jpg',
  },
  diretor: {
    nome: 'Diretor de arte',
    funcao: 'Cuida do visual',
    faz: 'Escolhe o modelo e a foto de cada slide e confere se o texto cabe.',
    apresentacao:
      'Escolhe o modelo e a foto de cada slide, aplica suas cores, fontes e logo e confere se todo o texto cabe. Preço e prazo saem exatamente como você digitou.',
    foto: '/carrosseis/time/diretor-de-arte.jpg',
  },
  revisor: {
    nome: 'Revisora',
    funcao: 'Garante a qualidade',
    faz: 'Ortografia, tamanho do texto, promessa sem fonte e o tom da marca.',
    apresentacao:
      'Dá nota de 1 a 5 em oito pontos, devolve para reescrever o que não está bom e confere se cada fato tem fonte. O que sobrar vira sugestão para você decidir.',
    foto: '/carrosseis/time/revisora.jpg',
  },
};

export const SITUACOES_PEDIDO = ['fila', 'trabalhando', 'pronto', 'falhou', 'cancelado'] as const;
export type SituacaoPedido = (typeof SITUACOES_PEDIDO)[number];

export interface PedidoDoTime {
  id: number;
  tipo: 'carrossel' | 'dossie' | 'ideias' | 'cards';
  situacao: SituacaoPedido;
  etapa: EtapaTime | null;
  /** O que cada etapa já disse (ex.: o gancho escolhido). */
  detalhes: Partial<Record<EtapaTime, string>>;
  assunto: string;
  carrosselId: number | null;
  erro: string | null;
  criadoEm: string;
  concluidoEm: string | null;
}

/* ───────────────────────────── O revisor ───────────────────────────── */

export const CRITERIOS_REVISOR = [
  'gancho',
  'umaIdeia',
  'clareza',
  'especifico',
  'tamanho',
  'chamada',
  'tom',
  'portugues',
] as const;
export type CriterioRevisor = (typeof CRITERIOS_REVISOR)[number];
export const CRITERIO: Record<CriterioRevisor, string> = {
  gancho: 'Gancho da capa',
  umaIdeia: 'Uma ideia por slide',
  clareza: 'Clareza',
  especifico: 'Específico (nada genérico)',
  tamanho: 'Tamanho do texto',
  chamada: 'Chamada final',
  tom: 'Tom da marca',
  portugues: 'Português',
};

/** Passa quando nenhum critério fica abaixo de 3 e a média é 4 ou mais (notas de 1 a 5). */
export function revisaoAprovada(notas: Partial<Record<CriterioRevisor, number>>): boolean {
  const v = CRITERIOS_REVISOR.map((c) => notas[c] ?? 0);
  return v.every((n) => n >= 3) && v.reduce((a, b) => a + b, 0) / v.length >= 4;
}

/** Quantas vezes o revisor pode devolver o carrossel para o redator reescrever. */
export const MAX_VOLTAS_REVISOR = 2;

export const TIPOS_AVISO_TIME = ['fato', 'promocao', 'tamanho', 'tom', 'portugues', 'outro'] as const;
export type TipoAvisoTime = (typeof TIPOS_AVISO_TIME)[number];
export const ROTULO_AVISO_TIME: Record<TipoAvisoTime, string> = {
  fato: 'Afirmação sem fonte',
  promocao: 'Promoção',
  tamanho: 'Tamanho do texto',
  tom: 'Tom da marca',
  portugues: 'Português',
  outro: 'Revisora',
};

export const CAMPOS_SUGESTAO = ['sobretitulo', 'titulo', 'texto', 'destaque', 'botao', 'legenda'] as const;
export type CampoSugestao = (typeof CAMPOS_SUGESTAO)[number];

/** O que o revisor deixou para uma pessoa decidir (o editor mostra no slide). */
export interface AvisoTime {
  id: string;
  /** Slide do aviso (null: a legenda ou o carrossel inteiro). */
  slideId: string | null;
  tipo: TipoAvisoTime;
  texto: string;
  sugestao: { campo: CampoSugestao; valor: string } | null;
  /** Quem decidiu: usou a sugestão ou manteve. Sem isso, está esperando. */
  resolvido: 'usou' | 'manteve' | null;
}

/** O que o time deixa junto do carrossel (o porquê de cada escolha e o que falta decidir). */
export interface RelatorioTime {
  objetivo: ObjetivoCarrossel;
  assunto: string;
  angulo: string;
  gancho: string;
  ganchosAlternativos: string[];
  porque: string;
  /** O que o time usou para decidir (ex.: "Promoção: Pastilha em dobro", "Perguntas dos clientes"). */
  fontes: string[];
  notas: Partial<Record<CriterioRevisor, number>>;
  voltas: number;
  aprovado: boolean;
  hashtags: string[];
  avisos: AvisoTime[];
  divulgarId: number | null;
  chamada: ChamadaFinal;
  palavra: string;
  modelo: string;
}

export const avisoResolverEntrada = z.object({ acao: z.enum(['usar', 'manter']) });

/** Aplica a sugestão do revisor no slide (ou na legenda). */
export function aplicarSugestao(
  a: AvisoTime,
  slides: SlideCarrossel[],
  legenda: string,
): { slides: SlideCarrossel[]; legenda: string } {
  if (!a.sugestao) return { slides, legenda };
  const { campo, valor } = a.sugestao;
  if (campo === 'legenda') return { slides, legenda: valor.slice(0, 2200) };
  return {
    slides: slides.map((s) => (s.id === a.slideId ? { ...s, [campo]: valor } : s)),
    legenda,
  };
}

/* ───────────────────────────── Limites para o redator ───────────────────────────── */

/** Os campos de cada modelo com o limite de letras, em texto (o redator escreve dentro disso). */
export function limitesParaORedator(modelos: readonly ModeloSlide[] = MODELOS): string {
  return modelos
    .map((m) => {
      const d = MODELO[m];
      const campos = d.campos.map((c) => `${c.campo} (${c.rotulo}, até ${c.limite} letras)`);
      if (d.itens) campos.push(`itens (até ${d.itens.max}, cada um até ${d.itens.limite} letras)`);
      if (d.colunas) campos.push('colunas (2: rótulo até 16 letras e texto até 120 letras)');
      return `- ${m} (${d.nome}: ${d.descricao}) → ${campos.join('; ')}`;
    })
    .join('\n');
}

const corte = (t: unknown, max: number) =>
  String(t ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/**
 * O slide que o redator devolveu, no formato do editor: campos que o modelo não usa ficam vazios,
 * tudo cortado no tamanho que o editor aceita.
 */
export function slideDoTime(bruto: Record<string, unknown>, modelo: ModeloSlide, id: string): SlideCarrossel {
  const base = { ...slideNovo(modelo, id), sobretitulo: '', titulo: '', texto: '', destaque: '', botao: '' };
  const d = MODELO[modelo];
  const usa = new Set(d.campos.map((c) => c.campo));
  const s: SlideCarrossel = {
    ...base,
    itens: [],
    colunas: [],
    sobretitulo: usa.has('sobretitulo') ? corte(bruto.sobretitulo, 40) : '',
    titulo: usa.has('titulo') ? corte(bruto.titulo, 160) : '',
    texto: usa.has('texto')
      ? String(bruto.texto ?? '')
          .trim()
          .slice(0, 400)
      : '',
    destaque: usa.has('destaque') ? corte(bruto.destaque, 24) : '',
    botao: usa.has('botao') ? corte(bruto.botao, 40) : '',
  };
  if (d.itens)
    s.itens = (Array.isArray(bruto.itens) ? bruto.itens : [])
      .map((x) => corte(x, 120))
      .filter(Boolean)
      .slice(0, d.itens.max);
  if (d.colunas) {
    const cols = (Array.isArray(bruto.colunas) ? bruto.colunas : []).slice(0, 2) as Record<string, unknown>[];
    s.colunas = cols.map((c) => ({ rotulo: corte(c?.rotulo, 24), texto: corte(c?.texto, 160) }));
    while (s.colunas.length < 2) s.colunas.push({ rotulo: s.colunas.length ? 'Depois' : 'Antes', texto: '' });
  }
  return s;
}

/** O texto do botão da chamada final para cada tipo de chamada. */
export function botaoDaChamada(chamada: ChamadaFinal, palavra: string): string | null {
  if (chamada === 'comentar' && palavra) return `Comente ${palavra.toUpperCase()}`;
  return null;
}

/* ───────────────────────────── A conversa com o time ───────────────────────────── */

export const ALCANCES_CONVERSA = ['slide', 'carrossel', 'legenda'] as const;
export type AlcanceConversa = (typeof ALCANCES_CONVERSA)[number];
export const ROTULO_ALCANCE: Record<AlcanceConversa, string> = {
  slide: 'Este slide',
  carrossel: 'Carrossel inteiro',
  legenda: 'Legenda',
};

export const conversaEntrada = z
  .object({
    alcance: z.enum(ALCANCES_CONVERSA),
    slideId: z.string().trim().max(40).nullable().default(null),
    texto: z.string().trim().max(800, 'Use até 800 letras.').default(''),
    rapido: z.enum(PEDIDOS_RAPIDOS).nullable().default(null),
    /** Como o carrossel está na tela agora (com o que ainda não foi salvo). */
    slides: z.array(slideEntrada).min(1).max(MAX_SLIDES),
    legenda: z.string().max(2200).default(''),
    estilo: z.enum(ESTILOS),
  })
  .refine((d) => d.rapido || d.texto.length >= 3, { message: 'Diga o que mudar.', path: ['texto'] })
  .refine((d) => !d.rapido || d.alcance === 'slide', {
    message: 'Os atalhos são para um slide.',
    path: ['rapido'],
  })
  .refine((d) => d.alcance !== 'slide' || (d.slideId && d.slides.some((s) => s.id === d.slideId)), {
    message: 'Escolha o slide.',
    path: ['slideId'],
  });
export type ConversaEntrada = z.infer<typeof conversaEntrada>;

/** O pedido como o time lê (o atalho vira a instrução dele; o texto da pessoa vem junto). */
export function instrucaoDaConversa(d: Pick<ConversaEntrada, 'rapido' | 'texto'>): string {
  return [d.rapido ? PEDIDO_RAPIDO[d.rapido].instrucao : '', d.texto].filter(Boolean).join(' ');
}

/** O pedido como aparece na conversa (o atalho com o nome do botão). */
export function textoDoPedido(d: Pick<ConversaEntrada, 'rapido' | 'texto'>): string {
  return [d.rapido ? PEDIDO_RAPIDO[d.rapido].rotulo : '', d.texto].filter(Boolean).join(' · ');
}

/** Aplicar, descartar ou desfazer (depois de aplicada: a tela volta o que estava antes). */
export const decisaoConversaEntrada = z.object({ acao: z.enum(['aplicar', 'descartar', 'desfazer']) });

/**
 * Aplica a proposta no carrossel como está na tela. Se ninguém mexeu desde o pedido, fica igual à
 * proposta. Se mexeu: um slide ou a legenda trocam só o que foi pedido; o carrossel inteiro troca
 * tudo (a tela confirma antes, `mudouDesdeOPedido`).
 */
export function aplicarProposta(
  m: Pick<MensagemConversa, 'alcance' | 'slideId' | 'proposta'>,
  agora: EstadoCarrossel,
  lado: 'depois' | 'antes' = 'depois',
): EstadoCarrossel {
  const p = m.proposta;
  if (!p) return agora;
  const alvo = p[lado];
  if (m.alcance === 'legenda') return { ...agora, legenda: alvo.legenda };
  if (m.alcance === 'slide') {
    const novo = alvo.slides.find((s) => s.id === m.slideId);
    return novo ? { ...agora, slides: agora.slides.map((s) => (s.id === m.slideId ? novo : s)) } : agora;
  }
  return { slides: alvo.slides, legenda: alvo.legenda };
}

/** O que a pessoa mudou na tela depois de pedir (no que a proposta vai trocar). */
export function mudouDesdeOPedido(
  m: Pick<MensagemConversa, 'alcance' | 'slideId' | 'proposta'>,
  agora: EstadoCarrossel,
): boolean {
  const p = m.proposta;
  if (!p) return false;
  if (m.alcance === 'legenda') return p.antes.legenda.trim() !== agora.legenda.trim();
  if (m.alcance === 'slide') {
    return !mesmoSlide(
      p.antes.slides.find((s) => s.id === m.slideId),
      agora.slides.find((s) => s.id === m.slideId),
    );
  }
  return mudancasEntre(p.antes, agora).length > 0;
}

export interface EstadoCarrossel {
  slides: SlideCarrossel[];
  legenda: string;
}

/** O que mudou de uma versão para a outra, em português (a resposta do time mostra). */
export interface MudancaConversa {
  tipo: 'mudou' | 'novo' | 'saiu' | 'ordem' | 'legenda';
  slideId: string | null;
  texto: string;
}

export interface MensagemConversa {
  id: number;
  autor: 'pessoa' | 'time';
  texto: string;
  alcance: AlcanceConversa;
  slideId: string | null;
  /** null: o pedido da pessoa, ou a resposta sem mudança. */
  situacao: 'pensando' | 'proposta' | 'aplicada' | 'descartada' | 'desfeita' | 'erro' | null;
  proposta: { antes: EstadoCarrossel; depois: EstadoCarrossel } | null;
  mudancas: MudancaConversa[];
  /** O que o revisor ainda achou na proposta (a pessoa decide se aplica assim). */
  avisos: string[];
  criadoEm: string;
}

const ROTULO_CAMPO: Record<string, string> = {
  modelo: 'modelo',
  sobretitulo: 'assunto',
  titulo: 'título',
  texto: 'texto',
  destaque: 'número',
  botao: 'botão',
  itens: 'itens',
  colunas: 'colunas',
  fotoId: 'foto',
  fundo: 'fundo',
};

/** Um campo do slide para comparar (a ordem das chaves muda quando passa pelo banco). */
const valorDoCampo = (s: SlideCarrossel, k: keyof SlideCarrossel) =>
  k === 'colunas' ? JSON.stringify(s.colunas.map((c) => [c.rotulo, c.texto])) : JSON.stringify(s[k] ?? null);

/** O mesmo slide, campo a campo. */
export function mesmoSlide(a: SlideCarrossel | undefined, b: SlideCarrossel | undefined): boolean {
  if (!a || !b) return a === b;
  return (['id', ...Object.keys(ROTULO_CAMPO)] as (keyof SlideCarrossel)[]).every(
    (k) => valorDoCampo(a, k) === valorDoCampo(b, k),
  );
}

/** As mudanças entre duas versões do carrossel (pelo identificador de cada slide). */
export function mudancasEntre(antes: EstadoCarrossel, depois: EstadoCarrossel): MudancaConversa[] {
  const m: MudancaConversa[] = [];
  const porId = new Map(antes.slides.map((s, i) => [s.id, { s, i }]));
  const ficaram = new Set(depois.slides.map((s) => s.id));
  depois.slides.forEach((s, i) => {
    const a = porId.get(s.id);
    if (!a) {
      m.push({ tipo: 'novo', slideId: s.id, texto: `Slide ${i + 1} novo (${MODELO[s.modelo].nome})` });
      return;
    }
    const campos = (Object.keys(ROTULO_CAMPO) as (keyof SlideCarrossel)[]).filter(
      (k) => valorDoCampo(a.s, k) !== valorDoCampo(s, k),
    );
    if (campos.length)
      m.push({
        tipo: 'mudou',
        slideId: s.id,
        texto: `Slide ${i + 1}: ${campos.map((k) => ROTULO_CAMPO[k]).join(', ')}`,
      });
  });
  antes.slides.forEach((s, i) => {
    if (!ficaram.has(s.id))
      m.push({ tipo: 'saiu', slideId: s.id, texto: `Saiu o slide ${i + 1} (${MODELO[s.modelo].nome})` });
  });
  const ordemAntes = antes.slides.map((s) => s.id).filter((id) => ficaram.has(id));
  const ordemDepois = depois.slides.map((s) => s.id).filter((id) => porId.has(id));
  if (ordemAntes.join('|') !== ordemDepois.join('|'))
    m.push({ tipo: 'ordem', slideId: null, texto: 'Mudou a ordem dos slides' });
  if (antes.legenda.trim() !== depois.legenda.trim())
    m.push({ tipo: 'legenda', slideId: null, texto: 'Legenda reescrita' });
  return m;
}

/* ───────────────────────────── v144: os cards avulsos ───────────────────────────── */

/** O que o card faz: guia o time no texto e no modelo de cada card. */
export const OBJETIVOS_CARD = [
  'promocao',
  'lancamento',
  'produto',
  'aviso',
  'data',
  'frase',
  'institucional',
] as const;
export type ObjetivoCard = (typeof OBJETIVOS_CARD)[number];
export const OBJETIVO_CARD: Record<ObjetivoCard, { nome: string; dica: string }> = {
  promocao: { nome: 'Promoção', dica: 'oferta com preço, prazo e condição exatos; o preço em destaque' },
  lancamento: {
    nome: 'Lançamento',
    dica: 'novidade, produto novo ou chegada numa cidade: o que muda para o cliente, com a data em destaque e tom de venda',
  },
  produto: { nome: 'Produto', dica: 'um produto ou serviço e por que vale a pena' },
  aviso: { nome: 'Aviso', dica: 'horário, mudança, comunicado: claro e curto' },
  data: { nome: 'Data especial', dica: 'data comemorativa ligada à empresa, sem clichê' },
  frase: { nome: 'Frase', dica: 'uma frase forte do jeito que a empresa fala' },
  institucional: { nome: 'Institucional', dica: 'quem a empresa é, o diferencial, a confiança' },
};

/** Os modelos que funcionam sozinhos num card (sem lista longa nem "arraste"). */
export const MODELOS_CARD = ['capa', 'numero', 'citacao', 'foto', 'comparacao', 'chamada'] as const;
export type ModeloCard = (typeof MODELOS_CARD)[number];

export const MAX_CARDS_PEDIDO = 10;
export const MAX_VARIACOES_CARD = 3;
export const MAX_PECAS_PEDIDO = 20;

export const pedidoCardsEntrada = z
  .object({
    /** O que pedir ao time (o "chat" do pedido): o que os cards dizem e o que não pode faltar. */
    assunto: z.string().trim().max(1000, 'Use até 1.000 letras.').default(''),
    divulgarId: z.number().int().positive().nullable().default(null),
    objetivo: z.enum(OBJETIVOS_CARD).default('promocao'),
    quantidade: z.number().int().min(1).max(MAX_CARDS_PEDIDO).default(1),
    variacoes: z.number().int().min(1).max(MAX_VARIACOES_CARD).default(2),
    formato: z.enum(FORMATOS_PECA).default('feed'),
    /** null: o da identidade visual. */
    estilo: z.enum(ESTILOS).nullable().default(null),
    chamada: z.enum(CHAMADAS_FINAIS).default('whatsapp'),
    palavra: z.string().trim().max(20).default(''),
    usarFotos: z.boolean().default(true),
    gerarImagens: z.boolean().default(false),
    referenciaId: z.number().int().positive().nullable().default(null),
    fotos: fotosDoPedidoEntrada,
    /** v148: as respostas às perguntas do time (viram fonte do pedido). */
    respostas: respostasEntrada,
    /** v149: o resumo da estrategista que a pessoa conferiu antes de criar (vira fonte do pedido). */
    briefing: briefingEntrada,
    /**
     * v150: em cada card, mais uma variação com a peça inteira desenhada pela IA de imagem (com a logo,
     * as fotos e o jeito de postar da conta), a partir do texto da 1ª variação, conferida letra por letra.
     */
    arteIa: z.boolean().default(true),
  })
  .refine((d) => d.assunto.length >= 3 || d.divulgarId != null, {
    message: 'Diga o que os cards precisam dizer (ou escolha o que divulgar).',
    path: ['assunto'],
  })
  .refine((d) => d.quantidade * d.variacoes <= MAX_PECAS_PEDIDO, {
    message: `Até ${MAX_PECAS_PEDIDO} peças por pedido (cards × variações).`,
    path: ['variacoes'],
  })
  .refine((d) => d.chamada !== 'comentar' || PALAVRA_COMENTAR.test(d.palavra), {
    message: 'Escolha a palavra que a pessoa vai comentar (uma palavra só, sem espaço).',
    path: ['palavra'],
  });
export type PedidoCards = z.infer<typeof pedidoCardsEntrada>;

/** "Outra variação" de um card: mais uma, diferente das que já existem, no mesmo pedido. */
export const outraVariacaoEntrada = z.object({
  /** O que mudar nesta variação (opcional). */
  pedido: z.string().trim().max(400).default(''),
});

/** Uma variação de um card (é um carrossel de um slide). */
export interface VariacaoCard {
  id: number;
  variacao: number;
  escolhido: boolean;
  versao: number;
  situacao: string;
  slide: SlideCarrossel | null;
  estilo: EstiloCarrossel;
}

/** Os cards de um pedido, como a aba Cards avulsos mostra. */
export interface LoteCards {
  pedidoId: number;
  titulo: string;
  assunto: string;
  objetivo: ObjetivoCard;
  formato: FormatoPeca;
  quantidade: number;
  variacoes: number;
  situacao: SituacaoPedido;
  etapa: EtapaTime | null;
  detalhes: Partial<Record<EtapaTime, string>>;
  erro: string | null;
  criadoEm: string;
  /** Pedidos de "outra variação" ainda trabalhando neste lote (o card de cada um). */
  trabalhando: number[];
  cards: { card: number; variacoes: VariacaoCard[] }[];
}
