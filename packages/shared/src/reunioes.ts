import { z } from 'zod';

/**
 * Reuniões por vídeo no próprio sistema: a sala tem um link público (/r/<código>), abre alguns
 * minutos antes do horário, pode ser gravada e transcrita, e o resumo da IA vai para a ficha do lead.
 */

/* ───────────────────────────── Sala ───────────────────────────── */

/** Quem tem o link entra sozinho, ou espera alguém do time deixar entrar. */
export const ENTRADAS_SALA = ['livre', 'aprovacao'] as const;
export type EntradaSala = (typeof ENTRADAS_SALA)[number];

export const ROTULO_ENTRADA_SALA: Record<EntradaSala, string> = {
  livre: 'Quem tem o link entra sozinho',
  aprovacao: 'Eu aprovo cada pessoa',
};

/** Minutos antes do horário em que a sala abre para os convidados (o time entra quando quiser). */
export const ABERTURAS_SALA = [5, 10, 15, 30] as const;

export const opcoesSala = z.object({
  entrada: z.enum(ENTRADAS_SALA).default('livre'),
  gravar: z.boolean().default(true),
  transcrever: z.boolean().default(true),
  abreMinutosAntes: z.number().int().min(0).max(120).default(10),
});
export type OpcoesSala = z.infer<typeof opcoesSala>;

/** Letras e números sem os parecidos (0/o, 1/l/i): o link é lido em voz alta e digitado. */
export const ALFABETO_CODIGO_SALA = 'abcdefghjkmnpqrstuvwxyz23456789';
const REGEX_CODIGO = /^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$/;

export function codigoSalaValido(codigo: string): boolean {
  return REGEX_CODIGO.test(codigo);
}

/** "k7m2-x9qp" a partir de 8 bytes aleatórios (quem chama gera os bytes). */
export function codigoSala(bytes: Uint8Array): string {
  if (bytes.length < 8) throw new Error('codigoSala precisa de 8 bytes');
  let s = '';
  for (let i = 0; i < 8; i++) s += ALFABETO_CODIGO_SALA[bytes[i]! % ALFABETO_CODIGO_SALA.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Status guardado da sala. */
export const STATUS_SALA = ['marcada', 'ao_vivo', 'encerrada', 'cancelada'] as const;
export type StatusSala = (typeof STATUS_SALA)[number];

/** O que o convidado vê ao abrir o link. */
export type SituacaoSala = 'antes' | 'aberta' | 'encerrada' | 'cancelada';

/**
 * Situação da sala para o convidado agora: antes da hora de abrir, aberta, encerrada ou cancelada.
 * A reunião não tem hora para acabar: encerra quando o time encerra ou a sala fica vazia.
 */
export function situacaoDaSala(
  s: { status: StatusSala; inicio: Date | string; abreMinutosAntes: number },
  agora: Date = new Date(),
): { situacao: SituacaoSala; abreEm: Date } {
  const abreEm = new Date(new Date(s.inicio).getTime() - s.abreMinutosAntes * 60_000);
  if (s.status === 'cancelada') return { situacao: 'cancelada', abreEm };
  if (s.status === 'encerrada') return { situacao: 'encerrada', abreEm };
  if (s.status === 'ao_vivo') return { situacao: 'aberta', abreEm };
  return { situacao: agora >= abreEm ? 'aberta' : 'antes', abreEm };
}

/** "2 h 14 min", "14 min", "menos de 1 min". */
export function faltaParaAbrir(abreEm: Date | string, agora: Date = new Date()): string {
  const ms = new Date(abreEm).getTime() - agora.getTime();
  if (ms <= 60_000) return 'menos de 1 min';
  const min = Math.ceil(ms / 60_000);
  const dias = Math.floor(min / 1440);
  const horas = Math.floor((min % 1440) / 60);
  const resto = min % 60;
  if (dias > 0) return `${dias} ${dias === 1 ? 'dia' : 'dias'}${horas ? ` e ${horas} h` : ''}`;
  if (horas > 0) return resto ? `${horas} h ${resto} min` : `${horas} h`;
  return `${resto} min`;
}

/* ───────────────────────────── Entrar e conversar ───────────────────────────── */

export const entrarNaSala = z.object({
  nome: z.string().trim().min(2, 'Diga seu nome.').max(60, 'Use até 60 letras.'),
  /** O convidado leu que a reunião é gravada (obrigatório quando é). */
  aceitouGravacao: z.boolean().default(false),
  /** Volta com a mesma identidade depois de recarregar a página. */
  participanteId: z.string().uuid().optional(),
  segredo: z.string().min(20).max(80).optional(),
});
export type EntrarNaSala = z.infer<typeof entrarNaSala>;

export const mensagemSala = z.object({
  texto: z.string().trim().min(1, 'Escreva a mensagem.').max(2000, 'Use até 2.000 letras.'),
});

/** Arquivo no chat da sala (até 10 MB). */
export const LIMITE_ARQUIVO_SALA = 10 * 1024 * 1024;
export const arquivoSala = z.object({
  nome: z.string().trim().min(1).max(160),
  mime: z.string().trim().max(120).default('application/octet-stream'),
  base64: z
    .string()
    .min(4)
    .max(Math.ceil((LIMITE_ARQUIVO_SALA * 4) / 3) + 8),
  /** Texto que acompanha o arquivo (opcional). */
  texto: z.string().trim().max(2000).optional(),
});

export const decisaoEspera = z.object({ decisao: z.enum(['deixar_entrar', 'recusar']) });

/** Papel de quem está na sala (vai nos atributos do participante). */
export type PapelNaSala = 'anfitriao' | 'equipe' | 'convidado';

/* ───────────────────────────── Resumo da IA ───────────────────────────── */

export const TIPOS_DESTAQUE = [
  'dor',
  'volume',
  'orcamento',
  'objecao',
  'decisor',
  'prazo',
  'concorrente',
  'outro',
] as const;
export type TipoDestaque = (typeof TIPOS_DESTAQUE)[number];

export const ROTULO_DESTAQUE: Record<TipoDestaque, string> = {
  dor: 'Dor principal',
  volume: 'Volume citado',
  orcamento: 'Orçamento',
  objecao: 'Objeção',
  decisor: 'Quem decide',
  prazo: 'Prazo',
  concorrente: 'Concorrente',
  outro: 'Ponto importante',
};

export const TIPOS_MOMENTO = ['preco', 'objecao', 'decisao', 'proximo_passo', 'outro'] as const;
export type TipoMomento = (typeof TIPOS_MOMENTO)[number];

export const INTERESSES_REUNIAO = ['alto', 'medio', 'baixo', 'indefinido'] as const;
export const ETAPAS_SUGERIDAS = ['reuniao', 'proposta', 'ganho', 'perdido'] as const;

const segundo = z.number().int().min(0).max(86_400).nullable().catch(null);

/** Resumo que a IA escreve depois da reunião (a validação descarta o que vier torto). */
export const resumoReuniao = z.object({
  resumo: z.string().trim().min(1).max(1500),
  interesse: z.enum(INTERESSES_REUNIAO).catch('indefinido'),
  destaques: z
    .array(
      z.object({
        tipo: z.enum(TIPOS_DESTAQUE).catch('outro'),
        texto: z.string().trim().min(1).max(300),
        segundo,
      }),
    )
    .max(12)
    .catch([]),
  proximosPassos: z
    .array(
      z.object({
        texto: z.string().trim().min(1).max(200),
        quem: z.string().trim().max(80).nullable().catch(null),
        prazo: z.string().trim().max(60).nullable().catch(null),
      }),
    )
    .max(10)
    .catch([]),
  momentos: z
    .array(
      z.object({
        segundo: z.number().int().min(0).max(86_400),
        titulo: z.string().trim().min(1).max(80),
        tipo: z.enum(TIPOS_MOMENTO).catch('outro'),
      }),
    )
    .max(12)
    .catch([]),
  sugestaoEtapa: z.enum(ETAPAS_SUGERIDAS).nullable().catch(null),
  motivoSugestao: z.string().trim().max(300).nullable().catch(null),
});
export type ResumoReuniao = z.infer<typeof resumoReuniao>;

/** Próximos passos que viram tarefas (os que a pessoa marcou na tela). */
export const criarTarefasDaReuniao = z.object({
  passos: z
    .array(
      z.object({
        texto: z.string().trim().min(1).max(200),
        inicio: z
          .string()
          .datetime({ offset: true })
          .transform((v) => new Date(v).toISOString()),
      }),
    )
    .min(1, 'Marque ao menos um passo.')
    .max(10),
});

/* ───────────────────────────── Formatos ───────────────────────────── */

/** 760 → "12:40"; 3723 → "1:02:03". */
export function fmtTempoReuniao(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const dois = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${dois(m)}:${dois(r)}` : `${m}:${dois(r)}`;
}

/** 3120 → "52 min"; 4500 → "1 h 15 min"; 30 → "menos de 1 min". */
export function fmtDuracaoReuniao(segundos: number): string {
  const min = Math.round(segundos / 60);
  if (min < 1) return 'menos de 1 min';
  const h = Math.floor(min / 60);
  const r = min % 60;
  if (!h) return `${min} min`;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** Parte de cada pessoa no tempo de fala (soma 100, arredondado). */
export function partesDeFala(
  falas: { identidade: string; inicioMs: number; fimMs: number }[],
): Map<string, number> {
  const tempo = new Map<string, number>();
  let total = 0;
  for (const f of falas) {
    const d = Math.max(0, f.fimMs - f.inicioMs);
    tempo.set(f.identidade, (tempo.get(f.identidade) ?? 0) + d);
    total += d;
  }
  const partes = new Map<string, number>();
  if (!total) return partes;
  for (const [id, d] of tempo) partes.set(id, Math.round((d / total) * 100));
  return partes;
}

/* ───────────────────────────── Enquadramento dos vídeos ───────────────────────────── */

/**
 * Quanto da imagem pode ficar de fora para o vídeo preencher o quadro (como no Meet). Acima disso,
 * a imagem aparece inteira, com faixas pretas: ninguém fica com a cabeça ou a tela cortada.
 */
export const CORTE_MAXIMO_VIDEO = 0.15;

/** "cover" (preenche, cortando pouco) ou "contain" (inteiro) para um vídeo num quadro. */
export function encaixeDoVideo(
  video: { largura: number; altura: number } | null,
  quadro: { largura: number; altura: number },
  sempreInteiro = false,
): 'cover' | 'contain' {
  if (sempreInteiro || !video?.largura || !video.altura || !quadro.largura || !quadro.altura)
    return 'contain';
  const rv = video.largura / video.altura;
  const rq = quadro.largura / quadro.altura;
  const corte = 1 - Math.min(rv, rq) / Math.max(rv, rq);
  return corte <= CORTE_MAXIMO_VIDEO ? 'cover' : 'contain';
}

/**
 * Grade que cabe no espaço: quantas colunas e o tamanho de cada quadro (na proporção 16:9) para
 * os vídeos ficarem o maior possível sem passar do espaço disponível.
 */
export function gradeEncaixada(
  n: number,
  espaco: { largura: number; altura: number },
  vao = 12,
  proporcao = 16 / 9,
): { colunas: number; largura: number; altura: number } {
  const total = Math.max(1, n);
  let melhor = { colunas: 1, largura: 0, altura: 0 };
  for (let colunas = 1; colunas <= total; colunas++) {
    const linhas = Math.ceil(total / colunas);
    const largura = Math.min(
      (espaco.largura - (colunas - 1) * vao) / colunas,
      ((espaco.altura - (linhas - 1) * vao) / linhas) * proporcao,
    );
    if (largura > melhor.largura)
      melhor = { colunas, largura: Math.floor(largura), altura: Math.floor(largura / proporcao) };
  }
  return { ...melhor, largura: Math.max(0, melhor.largura), altura: Math.max(0, melhor.altura) };
}
