import { z } from 'zod';

/**
 * Vídeos com IA (módulo à parte): a empresa sobe um vídeo falado (até 3 minutos) e a IA corta as
 * pausas, as muletas e as frases recomeçadas, legenda palavra por palavra na identidade da marca,
 * põe o título e a chamada no fim, sempre fora do rosto. Depois a pessoa revisa os cortes (devolve
 * o que não queria tirar), corrige a legenda e pede para gerar de novo.
 *
 * Desde a v129 a IA também põe imagens onde a fala cita produto, número, comparação ou lugar
 * (fotos da empresa primeiro; gera só o que faltar), animações que acompanham a fala (lista que se
 * marca, número grande, selo, oferta com o preço exato da promoção), efeitos sonoros discretos e
 * uma música feita para o vídeo, que baixa sozinha quando a pessoa fala.
 *
 * Tempos em segundos. Os da fala (palavras, cortes) são do vídeo original; o editado é montado a
 * partir deles.
 */

export const LIMITE_SEGUNDOS_VIDEO = 180;
export const LIMITE_BYTES_VIDEO = 1024 * 1024 * 1024;
/** Partes do envio (o armazenamento pede no mínimo 5 MB por parte, menos a última). */
export const TAMANHO_PARTE_ENVIO = 8 * 1024 * 1024;
export const TIPOS_VIDEO = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
  'video/3gpp',
  'video/x-m4v',
] as const;
export const MAX_VIDEOS_CONTA = 500;
/** Palavras que a empresa quer sempre escritas do mesmo jeito (marca, produtos, siglas). */
export const MAX_VOCABULARIO = 60;

export type SituacaoVideo = 'enviando' | 'na_fila' | 'editando' | 'revisar' | 'pronto' | 'falhou';
export const ROTULO_SITUACAO_VIDEO: Record<SituacaoVideo, string> = {
  enviando: 'Enviando',
  na_fila: 'Na fila',
  editando: 'Editando',
  revisar: 'Para revisar',
  pronto: 'Pronto',
  falhou: 'Não deu certo',
};

export type EtapaVideo =
  | 'preparando'
  | 'ouvindo'
  | 'cortando'
  | 'rosto'
  | 'imagens'
  | 'montando'
  | 'gerando'
  | 'som'
  | 'conferindo';
export const ETAPAS_VIDEO: { id: EtapaVideo; nome: string; dica: string }[] = [
  { id: 'preparando', nome: 'Preparando o vídeo', dica: 'Deixando o vídeo em pé, no tamanho do Reels' },
  { id: 'ouvindo', nome: 'Ouvindo a fala', dica: 'Cada palavra com o momento exato' },
  { id: 'cortando', nome: 'Cortando', dica: 'Pausas, "éé", "né" e frases recomeçadas' },
  { id: 'rosto', nome: 'Mapeando o rosto', dica: 'Para legenda e animações nunca ficarem em cima de você' },
  {
    id: 'imagens',
    nome: 'Escolhendo imagens e animações',
    dica: 'Onde uma imagem ajuda a entender; fotos da empresa primeiro',
  },
  {
    id: 'montando',
    nome: 'Montando legenda e animações',
    dica: 'Título, legenda palavra por palavra e a chamada no fim',
  },
  { id: 'gerando', nome: 'Gerando o vídeo final', dica: 'Juntando tudo com o som tratado' },
  { id: 'som', nome: 'Música e efeitos', dica: 'A música no tamanho do vídeo, mais baixa que a sua voz' },
  { id: 'conferindo', nome: 'Conferindo', dica: 'Quadro a quadro, que nenhum texto encostou no rosto' },
];

export type EstiloLegenda = 'acesa' | 'simples' | 'balao';
export const ESTILOS_LEGENDA: { id: EstiloLegenda; nome: string; dica: string }[] = [
  { id: 'acesa', nome: 'Palavra acesa', dica: 'A palavra falada acende na cor da marca' },
  { id: 'simples', nome: 'Simples', dica: 'A frase inteira, sem destaque' },
  { id: 'balao', nome: 'Balão', dica: 'A frase num balão branco' },
];

export type RitmoCortes = 'dinamico' | 'natural' | 'pausas';
export const RITMOS: { id: RitmoCortes; nome: string; dica: string }[] = [
  { id: 'dinamico', nome: 'Dinâmico', dica: 'Padrão de Reels: pausas curtas e sem muletas' },
  { id: 'natural', nome: 'Natural', dica: 'Deixa respirar mais entre as frases' },
  { id: 'pausas', nome: 'Só pausas longas', dica: 'Não tira palavras, só encurta silêncios grandes' },
];
/** Pausa que fica entre duas falas depois do corte, por ritmo (segundos). */
export const PAUSA_QUE_FICA: Record<RitmoCortes, number> = { dinamico: 0.15, natural: 0.35, pausas: 0.5 };
/** Silêncio a partir do qual o ritmo encurta (segundos). */
export const PAUSA_MINIMA: Record<RitmoCortes, number> = { dinamico: 0.28, natural: 0.6, pausas: 1.0 };

export type TransicaoCortes = 'alternada' | 'seco' | 'deslizar';
export const TRANSICOES: { id: TransicaoCortes; nome: string; dica: string }[] = [
  { id: 'alternada', nome: 'Aproximação', dica: 'Disfarça o corte' },
  { id: 'seco', nome: 'Corte seco', dica: 'Mais rápido' },
  { id: 'deslizar', nome: 'Deslizar', dica: 'Aproximação nos cortes; as imagens entram deslizando' },
];

/* ───────────────────────────── Imagens, música e efeitos (v129) ───────────────────────────── */

export type ModoImagens = 'ia' | 'fotos' | 'nenhuma';
export const MODOS_IMAGENS: { id: ModoImagens; nome: string; dica: string }[] = [
  { id: 'ia', nome: 'A IA escolhe', dica: 'Fotos da empresa primeiro; gera só o que faltar' },
  { id: 'fotos', nome: 'Só fotos da empresa', dica: 'Nada gerado pela IA' },
  { id: 'nenhuma', nome: 'Sem imagens', dica: 'Só você, a legenda e as animações' },
];
/** Regras das imagens, conferidas pelo código (não só pelo critério da IA). */
export const IMAGEM_SEM_NO_COMECO = 2;
export const IMAGEM_MIN_SEGUNDOS = 1.5;
export const IMAGEM_MAX_SEGUNDOS = 4;
export const IMAGENS_FRACAO_MAXIMA = 0.3;
export const MAX_IMAGENS_VIDEO = 8;
export const MAX_FOTO_BYTES = 10 * 1024 * 1024;
export const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type ClimaMusica = 'animada' | 'confiante' | 'calma' | 'corporativa';
export const CLIMAS_MUSICA: { id: ClimaMusica; nome: string; dica: string }[] = [
  { id: 'animada', nome: 'Animada', dica: 'Batida pra cima, para promoção e novidade' },
  { id: 'confiante', nome: 'Confiante', dica: 'Firme e direta, para dica e oferta' },
  { id: 'calma', nome: 'Calma', dica: 'Leve, para explicar com calma' },
  { id: 'corporativa', nome: 'Corporativa', dica: 'Sóbria, para apresentar a empresa' },
];
export type MusicaDoVideo = 'ia' | ClimaMusica | 'nenhuma';
export const ROTULO_MUSICA: Record<MusicaDoVideo, string> = {
  ia: 'A IA escolhe pelo clima do vídeo',
  animada: 'Animada',
  confiante: 'Confiante',
  calma: 'Calma',
  corporativa: 'Corporativa',
  nenhuma: 'Sem música',
};
export const VOLUME_MUSICA_PADRAO = 35;

export type TipoChamada = 'comente' | 'whatsapp' | 'seguir' | 'texto' | 'nenhuma';
export const ROTULO_CHAMADA: Record<TipoChamada, string> = {
  comente: 'Comente a palavra',
  whatsapp: 'Chame no WhatsApp',
  seguir: 'Siga o perfil',
  texto: 'Texto meu',
  nenhuma: 'Sem chamada',
};

const textoCurto = (max: number) => z.string().trim().max(max);

export const chamadaEntrada = z.object({
  tipo: z.enum(['comente', 'whatsapp', 'seguir', 'texto', 'nenhuma']),
  /** A palavra do "Comente X" (sem acento nem espaço, como no Comente e receba). */
  palavra: z
    .string()
    .trim()
    .max(30)
    .transform((s) => s.toUpperCase())
    .default(''),
  /** A frase grande da tela final (vazio: a padrão do tipo). */
  texto: textoCurto(80).default(''),
});
export type ChamadaVideo = z.infer<typeof chamadaEntrada>;

export const opcoesVideoEntrada = z.object({
  assunto: textoCurto(140).default(''),
  estilo: z.enum(['acesa', 'simples', 'balao']).default('acesa'),
  ritmo: z.enum(['dinamico', 'natural', 'pausas']).default('dinamico'),
  transicao: z.enum(['alternada', 'seco', 'deslizar']).default('alternada'),
  imagens: z.enum(['ia', 'fotos', 'nenhuma']).default('ia'),
  musica: z.enum(['ia', 'animada', 'confiante', 'calma', 'corporativa', 'nenhuma']).default('ia'),
  efeitos: z.boolean().default(true),
  chamada: chamadaEntrada.default({ tipo: 'nenhuma', palavra: '', texto: '' }),
  instrucoes: textoCurto(600).default(''),
});
export type OpcoesVideo = z.infer<typeof opcoesVideoEntrada>;

/** Começa um envio: o navegador manda o arquivo em partes depois. */
export const novoVideoEntrada = z.object({
  nome: z.string().trim().min(1).max(200),
  tipo: z.enum(TIPOS_VIDEO),
  bytes: z.number().int().min(1).max(LIMITE_BYTES_VIDEO),
  /** O navegador lê a duração antes de mandar (a edição confere de novo). */
  duracao: z
    .number()
    .min(0)
    .max(24 * 3600)
    .nullable()
    .default(null),
  titulo: textoCurto(120).default(''),
  opcoes: opcoesVideoEntrada,
});

export type TipoCorte = 'pausa' | 'muleta' | 'recomeco' | 'fora' | 'inicio' | 'fim' | 'outro';
export const ROTULO_CORTE: Record<TipoCorte, string> = {
  pausa: 'Pausa',
  muleta: 'Muleta',
  recomeco: 'Frase recomeçada',
  fora: 'Fala para outra pessoa',
  inicio: 'Começo antes de falar',
  fim: 'Fim depois de falar',
  outro: 'Trecho cortado',
};

export interface CorteVideo {
  id: string;
  inicio: number;
  fim: number;
  tipo: TipoCorte;
  /** Por que saiu, em uma frase para quem usa. */
  motivo: string;
  /** O que foi dito no trecho (vazio nas pausas). */
  trecho: string;
  /** A IA ficou em dúvida: aparece em destaque para a pessoa decidir. */
  duvida: boolean;
  /** "devolver": a pessoa pediu para manter no vídeo. */
  decisao: 'cortar' | 'devolver';
  /** A pessoa já olhou (as dúvidas saem do destaque). */
  conferido: boolean;
}

/** Palavra falada (tempo do original). `forte`: destacada na legenda. */
export interface PalavraVideo {
  t: string;
  i: number;
  f: number;
  forte?: boolean;
  /** A transcrição ficou insegura nesta palavra: a tela pede para conferir. */
  conferir?: boolean;
}

export type TipoMomento = 'lista' | 'numero' | 'selo' | 'destaque' | 'oferta';
export const ROTULO_MOMENTO: Record<TipoMomento, string> = {
  lista: 'Lista que se marca',
  numero: 'Número grande',
  selo: 'Selo',
  destaque: 'Aproximação na frase forte',
  oferta: 'Oferta com o preço da promoção',
};

/** Um item da lista: marca quando a pessoa fala dele (tempo do original). */
export interface ItemDaLista {
  texto: string;
  em: number;
}

/** Os valores da promoção, copiados do O que divulgar (saem exatamente como foram digitados). */
export interface OfertaDoVideo {
  produto: string;
  precoDe: string;
  precoPor: string;
  validade: string;
}

/** Uma animação que acompanha a fala (tempos do original). */
export interface MomentoVideo {
  id: string;
  tipo: TipoMomento;
  inicio: number;
  fim: number;
  /** O que foi dito no momento (para a pessoa saber por que entrou). */
  fala: string;
  usar: boolean;
  /** Título da lista, texto do selo, a linha embaixo do número. */
  titulo: string;
  numero: string;
  itens: ItemDaLista[];
  divulgarId: number | null;
  oferta: OfertaDoVideo | null;
  /** Posto à mão na revisão. */
  manual: boolean;
}

export interface AnimacoesVideo {
  titulo: { usar: boolean; texto: string };
  chamada: { usar: boolean } & ChamadaVideo;
  /** v129: as animações que acompanham a fala (vídeos antigos não têm). */
  momentos?: MomentoVideo[];
}

export type OrigemImagem = 'empresa' | 'gerada' | 'propria';
export const ROTULO_ORIGEM_IMAGEM: Record<OrigemImagem, string> = {
  empresa: 'Foto da empresa',
  gerada: 'Gerada pela IA',
  propria: 'Foto sua',
};
export type EncaixeImagem = 'acima' | 'cheia';
/** Como a imagem entrou no último vídeo gerado. */
export type ImagemPosta = 'acima' | 'cartao' | 'cheia';
export const ROTULO_IMAGEM_POSTA: Record<ImagemPosta, string> = {
  acima: 'acima da cabeça',
  cartao: 'tela dividida (você embaixo)',
  cheia: 'tela cheia (a sua voz continua)',
};

/** Uma imagem do vídeo (tempos do original). */
export interface ImagemVideo {
  id: string;
  inicio: number;
  fim: number;
  fala: string;
  /** Por que entrou, em uma frase. */
  motivo: string;
  origem: OrigemImagem;
  fotoId: number | null;
  /** Caminho no armazenamento (null: ainda não escolhida ou gerada). */
  chave: string | null;
  /** O que a imagem mostra (a descrição da foto ou o pedido da imagem gerada). */
  descricao: string;
  encaixe: EncaixeImagem;
  usar: boolean;
  /** Pedido para o próximo "Gerar de novo". */
  pedido: 'gerar_outra' | 'escolher' | null;
  /** Resultado da conferência da imagem gerada (sem letra, sem marca, sem defeito). */
  conferencia: string | null;
  posta: ImagemPosta | null;
  manual: boolean;
}

/** Onde a IA preferiu não pôr imagem (tempos do original). */
export interface TrechoSemImagem {
  inicio: number;
  fim: number;
  fala: string;
  motivo: string;
}

export type TipoEfeito = 'tique' | 'sopro' | 'estalo' | 'subida';
export const ROTULO_EFEITO: Record<TipoEfeito, string> = {
  tique: 'Toque',
  sopro: 'Sopro',
  estalo: 'Estalo suave',
  subida: 'Subida',
};
/** Um efeito sonoro (tempo do vídeo editado; o id é estável enquanto a animação existir). */
export interface EfeitoVideo {
  id: string;
  tipo: TipoEfeito;
  em: number;
  onde: string;
}

export interface SomVideo {
  musica: {
    usar: boolean;
    clima: ClimaMusica;
    /** Pedido livre ("rock leve, com guitarra"); vazio: o clima. */
    descricao: string;
    /** O estilo que a IA escolheu pelo assunto (vale quando a pessoa não descreve). */
    estiloIa: string;
    volume: number;
    chave: string | null;
    segundos: number | null;
    /** "Fazer outra música" no próximo gerar de novo. */
    pedirOutra: boolean;
    /** Por que a música não entrou (para a tela explicar). */
    erro: string | null;
  };
  efeitos: { ligados: boolean; desligados: string[]; lista: EfeitoVideo[] };
}

export interface ConferenciaVideo {
  quadros: number;
  sobreposicoes: number;
  /** Menor distância entre um texto e o rosto (px num vídeo de 1080 × 1920). */
  menorDistancia: number | null;
}

export interface ResumoVideo {
  id: number;
  titulo: string;
  situacao: SituacaoVideo;
  etapa: EtapaVideo | null;
  progresso: number;
  duracaoOriginal: number | null;
  duracaoFinal: number | null;
  duvidas: number;
  erro: string | null;
  temCapa: boolean;
  criadoEm: string;
  prontoEm: string | null;
  /** Quando o Reels foi reconhecido no Instagram (v131). */
  publicadoEm: string | null;
}

export interface DetalheVideo extends ResumoVideo {
  opcoes: OpcoesVideo;
  cortes: CorteVideo[];
  palavras: PalavraVideo[];
  animacoes: AnimacoesVideo | null;
  imagens: ImagemVideo[];
  semImagem: TrechoSemImagem[];
  som: SomVideo | null;
  conferencia: ConferenciaVideo | null;
  /** Mudanças da revisão ainda não geradas (o botão "Gerar de novo" acende). */
  mudancasPendentes: boolean;
  versao: number;
  /** O texto do post do Reels e as hashtags (v131). */
  textoPost: string;
  hashtags: string[];
  /** O texto ainda é o que a redatora escreveu. */
  textoDaRedatora: boolean;
  /** O Reels no Instagram, depois de reconhecido. */
  midiaLink: string | null;
  /** v136: o que cada etapa achou e se já há o quadro da prévia (tipo=previa em /arquivo). */
  andamento: AndamentoVideo | null;
  temPrevia: boolean;
}

/** O que a pessoa muda na revisão (salvo na hora; o vídeo só muda ao gerar de novo). */
export const revisaoEntrada = z.object({
  versao: z.number().int().min(1),
  cortes: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        decisao: z.enum(['cortar', 'devolver']),
        conferido: z.boolean().default(true),
      }),
    )
    .max(2000)
    .default([]),
  palavras: z
    .array(z.object({ indice: z.number().int().min(0).max(20_000), texto: z.string().trim().min(1).max(40) }))
    .max(2000)
    .default([]),
  titulo: z.object({ usar: z.boolean(), texto: textoCurto(60) }).optional(),
  chamada: z.object({ usar: z.boolean() }).merge(chamadaEntrada).optional(),
  estilo: z.enum(['acesa', 'simples', 'balao']).optional(),
  ritmo: z.enum(['dinamico', 'natural', 'pausas']).optional(),
  transicao: z.enum(['alternada', 'seco', 'deslizar']).optional(),
  momentos: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        usar: z.boolean().optional(),
        titulo: textoCurto(40).optional(),
        numero: textoCurto(8).optional(),
        itens: z.array(z.string().trim().min(1).max(32)).min(1).max(5).optional(),
      }),
    )
    .max(60)
    .default([]),
  /** Animação posta à mão, no tempo do vídeo editado. */
  novoMomento: z
    .object({
      tipo: z.enum(['selo', 'destaque', 'numero']),
      em: z.number().min(0).max(LIMITE_SEGUNDOS_VIDEO),
      titulo: textoCurto(40).default(''),
      numero: textoCurto(8).default(''),
    })
    .optional(),
  imagens: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        usar: z.boolean().optional(),
        encaixe: z.enum(['acima', 'cheia']).optional(),
        /** Trocar por uma foto da empresa. */
        fotoId: z.number().int().positive().optional(),
        pedido: z.enum(['gerar_outra']).nullable().optional(),
      }),
    )
    .max(60)
    .default([]),
  /** Imagem posta à mão, no tempo do vídeo editado (sem foto: a IA escolhe ou gera). */
  novaImagem: z
    .object({
      em: z.number().min(0).max(LIMITE_SEGUNDOS_VIDEO),
      fotoId: z.number().int().positive().nullable().default(null),
    })
    .optional(),
  musica: z
    .object({
      usar: z.boolean().optional(),
      clima: z.enum(['animada', 'confiante', 'calma', 'corporativa']).optional(),
      descricao: textoCurto(120).optional(),
      volume: z.number().int().min(0).max(100).optional(),
      outra: z.boolean().optional(),
    })
    .optional(),
  efeitos: z
    .object({
      ligados: z.boolean().optional(),
      desligados: z.array(z.string().min(1).max(60)).max(300).optional(),
    })
    .optional(),
});
export type RevisaoVideo = z.infer<typeof revisaoEntrada>;

export const vocabularioEntrada = z.object({
  palavras: z
    .array(z.string().trim().min(1).max(40))
    .max(MAX_VOCABULARIO)
    .transform((l) => [...new Set(l)]),
});

/** Texto grande da tela final de cada tipo de chamada. */
export function fraseDaChamada(c: ChamadaVideo): { frase: string; botao: string } {
  const texto = c.texto.trim();
  switch (c.tipo) {
    case 'comente':
      return { frase: texto || 'Quer saber mais?', botao: `Comente ${c.palavra || 'QUERO'}` };
    case 'whatsapp':
      return { frase: texto || 'Fale com a gente', botao: 'Chame no WhatsApp' };
    case 'seguir':
      return { frase: texto || 'Tem mais toda semana', botao: 'Siga o perfil' };
    case 'texto':
      return { frase: texto, botao: '' };
    default:
      return { frase: '', botao: '' };
  }
}

/**
 * Os trechos que ficam no vídeo: tudo menos os cortes que continuam "cortar". Cortes que se
 * encostam viram um só; trechos minúsculos que sobram entre dois cortes (menos de 0,12 s) saem.
 */
export function trechosQueFicam(duracao: number, cortes: Pick<CorteVideo, 'inicio' | 'fim' | 'decisao'>[]) {
  const fora = cortes
    .filter((c) => c.decisao === 'cortar' && c.fim > c.inicio)
    .map((c) => [Math.max(0, c.inicio), Math.min(duracao, c.fim)] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const juntos: [number, number][] = [];
  for (const [a, b] of fora) {
    const u = juntos[juntos.length - 1];
    if (u && a <= u[1] + 0.12) u[1] = Math.max(u[1], b);
    else juntos.push([a, b]);
  }
  const ficam: { inicio: number; fim: number }[] = [];
  let t = 0;
  for (const [a, b] of juntos) {
    if (a - t >= 0.12) ficam.push({ inicio: r3(t), fim: r3(a) });
    t = Math.max(t, b);
  }
  if (duracao - t >= 0.12) ficam.push({ inicio: r3(t), fim: r3(duracao) });
  return ficam;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Leva um instante do original para o vídeo editado (null: caiu num corte). */
export function tempoNoEditado(t: number, ficam: { inicio: number; fim: number }[]): number | null {
  let acumulado = 0;
  for (const s of ficam) {
    if (t < s.inicio) return null;
    if (t <= s.fim) return r3(acumulado + (t - s.inicio));
    acumulado += s.fim - s.inicio;
  }
  return null;
}

/** Leva um instante do vídeo editado para o original (o caminho de volta do tempoNoEditado). */
export function tempoNoOriginal(t: number, ficam: { inicio: number; fim: number }[]): number | null {
  let acumulado = 0;
  for (const s of ficam) {
    const d = s.fim - s.inicio;
    if (t <= acumulado + d + 1e-6) return r3(s.inicio + Math.max(0, t - acumulado));
    acumulado += d;
  }
  return null;
}

/** As animações de um vídeo (antigos não têm a lista). */
export const momentosDe = (a: AnimacoesVideo | null | undefined): MomentoVideo[] => a?.momentos ?? [];

export const duracaoDosTrechos = (ficam: { inicio: number; fim: number }[]) =>
  r3(ficam.reduce((s, x) => s + (x.fim - x.inicio), 0));

/** "1:18" */
export function fmtDuracao(segundos: number | null | undefined): string {
  if (segundos == null || !Number.isFinite(segundos)) return '—';
  const s = Math.max(0, Math.round(segundos));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* ───────────────────────────── v131: o vídeo no Instagram ───────────────────────────── */

/** A fala que ficou no vídeo editado (as palavras fora dos cortes), em texto corrido. */
export function falaQueFica(
  palavras: readonly Pick<PalavraVideo, 't' | 'i' | 'f'>[],
  ficam: readonly { inicio: number; fim: number }[],
): string {
  return palavras
    .filter((p) => {
      const meio = (p.i + p.f) / 2;
      return ficam.some((t) => meio >= t.inicio && meio <= t.fim);
    })
    .map((p) => p.t)
    .join(' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .trim();
}

/** O vídeo para a aba Publicação: ainda editando, pronto para postar ou já no Instagram. */
export function situacaoParaPublicar(
  situacao: SituacaoVideo,
  midiaId: string | null,
): 'rascunho' | 'pronto' | 'publicado' {
  if (midiaId) return 'publicado';
  return situacao === 'pronto' || situacao === 'revisar' ? 'pronto' : 'rascunho';
}

/** O texto do post do Reels (o Instagram aceita até 2.200 letras com as hashtags). */
export const LIMITE_TEXTO_POST = 2200;

export const textoPostEntrada = z.object({
  texto: z.string().max(LIMITE_TEXTO_POST),
  hashtags: z
    .array(
      z
        .string()
        .trim()
        .transform((h) => h.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, ''))
        .pipe(z.string().min(1).max(60)),
    )
    .max(30)
    .default([]),
});
export type TextoPostEntrada = z.infer<typeof textoPostEntrada>;

/** O texto do post com as hashtags no fim, como vai para o Instagram. */
export function textoComHashtags(texto: string, hashtags: readonly string[]): string {
  const tags = hashtags.map((h) => `#${h}`).join(' ');
  return [texto.trim(), tags].filter(Boolean).join('\n\n');
}

/* ───────────────────────────── v136: o andamento da edição ───────────────────────────── */

/** Uma caixa em px no vídeo em pé (1080 × 1920). */
export interface CaixaNoVideo {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** O que cada etapa achou, anotado pelo worker enquanto edita (a tela mostra no lugar da dica). */
export interface AndamentoVideo {
  /** Quando esta edição começou (ISO), para estimar quanto falta. */
  inicio?: string;
  ouvindo?: { palavras: number };
  cortando?: { pausas: number; muletas: number; recomecos: number; outros: number; de: number; para: number };
  /** O rosto no quadro da prévia (null: não apareceu rosto nesse quadro). */
  rosto?: { caixa: CaixaNoVideo | null; t: number };
  imagens?: { fotos: number; geradas: number; animacoes: number; musica: boolean };
}

const pl = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** A linha de cada etapa já feita, com os números de verdade (null: fica a dica de sempre). */
export function linhaDoAndamento(etapa: EtapaVideo, a: AndamentoVideo | null | undefined): string | null {
  if (!a) return null;
  if (etapa === 'ouvindo' && a.ouvindo)
    return `${pl(a.ouvindo.palavras, 'palavra', 'palavras')}, cada uma com o momento exato`;
  if (etapa === 'cortando' && a.cortando) {
    const c = a.cortando;
    const partes = [
      c.pausas ? pl(c.pausas, 'pausa', 'pausas') : '',
      c.muletas ? pl(c.muletas, '"éé" ou "né"', '"éé" e "né"') : '',
      c.recomecos ? pl(c.recomecos, 'frase recomeçada', 'frases recomeçadas') : '',
      c.outros ? pl(c.outros, 'trecho a mais', 'trechos a mais') : '',
    ].filter(Boolean);
    const tempo = `${fmtDuracao(c.de)} vira ${fmtDuracao(c.para)}`;
    return partes.length ? `${partes.join(', ')}: ${tempo}` : `Nada para cortar: ${fmtDuracao(c.de)}`;
  }
  if (etapa === 'rosto' && a.rosto)
    return a.rosto.caixa
      ? 'Rosto achado: a legenda fica abaixo do queixo e os gráficos acima da cabeça'
      : 'Sem rosto no começo: a legenda fica na parte de baixo';
  if (etapa === 'imagens' && a.imagens) {
    const i = a.imagens;
    const img = i.fotos + i.geradas;
    return [
      img
        ? `${pl(img, 'imagem', 'imagens')}${i.geradas ? ` (${i.geradas} feita${i.geradas > 1 ? 's' : ''} pela IA)` : ''}`
        : 'Sem imagens',
      i.animacoes ? pl(i.animacoes, 'animação', 'animações') : '',
      i.musica ? 'música' : '',
    ]
      .filter(Boolean)
      .join(', ');
  }
  return null;
}

/**
 * Quanto falta, pelo ritmo até agora (só depois de 15%, quando já dá para medir).
 * Devolve o texto ("cerca de 2 minutos") ou null.
 */
export function quantoFalta(
  inicio: string | undefined,
  progresso: number,
  agora = Date.now(),
): string | null {
  if (!inicio || progresso < 15 || progresso >= 100) return null;
  const passou = (agora - new Date(inicio).getTime()) / 1000;
  if (!(passou > 0)) return null;
  const falta = (passou / progresso) * (100 - progresso);
  if (falta < 45) return 'menos de 1 minuto';
  const min = Math.round(falta / 60);
  return min <= 1 ? 'cerca de 1 minuto' : `cerca de ${min} minutos`;
}

/** As medidas da diagramação (as mesmas do worker, em integrations/videos/diagramacao.ts). */
const TELA = { largura: 1080, altura: 1920, topo: 210, base: 1700, folga: 34, legendaMaisAlta: 1180 };

/**
 * O mapa da prévia, em frações da tela (0 a 1): o rosto, a faixa da legenda (abaixo do queixo,
 * nunca acima da linha de 1180 px nem abaixo dos ícones do Instagram) e o espaço dos gráficos
 * (do cabeçalho do Instagram até a cabeça). É uma prévia: o vídeo pronto segue o rosto a cada momento.
 */
export function mapaDaPrevia(caixa: CaixaNoVideo | null) {
  const f = (x0: number, y0: number, x1: number, y1: number) => ({
    x: x0 / TELA.largura,
    y: y0 / TELA.altura,
    w: (x1 - x0) / TELA.largura,
    h: (y1 - y0) / TELA.altura,
  });
  const margem = 110;
  const topoLegenda = Math.min(
    TELA.base - 200,
    Math.max(TELA.legendaMaisAlta, caixa ? caixa.y1 + TELA.folga : TELA.legendaMaisAlta),
  );
  const legenda = f(margem, topoLegenda, TELA.largura - margem, Math.min(TELA.base, topoLegenda + 220));
  const fimGraficos = caixa ? caixa.y0 - TELA.folga : TELA.topo + 420;
  const graficos =
    fimGraficos - TELA.topo >= 120 ? f(margem, TELA.topo, TELA.largura - margem, fimGraficos) : null;
  return { rosto: caixa ? f(caixa.x0, caixa.y0, caixa.x1, caixa.y1) : null, legenda, graficos };
}
