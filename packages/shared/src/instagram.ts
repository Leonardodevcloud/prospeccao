import { z } from 'zod';

/**
 * Instagram no CRM: "comente e receba" (quem comenta a palavra recebe um direct), os cadastros dos
 * formulários dos anúncios da Meta e o direct como canal da conversa.
 */

/** Regras da Meta que a tela explica. */
export const PRAZO_RESPOSTA_PRIVADA_DIAS = 7;
export const JANELA_DIRECT_HORAS = 24;

/** Sem acento, minúsculas e espaços simples (para comparar a palavra do comentário). */
export function semAcentoMinusculo(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * O comentário tem uma das palavras? Sem acento e sem diferença de maiúscula; vale a palavra
 * sozinha ou no meio do texto ("quero!!", "PROSPECCAO por favor"), mas não pedaço de outra palavra
 * ("lista" não bate com "especialista").
 */
export function comentarioBate(texto: string, palavras: readonly string[]): string | null {
  const t = ` ${semAcentoMinusculo(texto).replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  for (const p of palavras) {
    const alvo = semAcentoMinusculo(p)
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
    if (alvo && t.includes(` ${alvo} `)) return p;
  }
  return null;
}

/** Troca {nome} pelo primeiro nome de quem comentou (ou tira, quando não há nome). */
export function comNome(texto: string, nome: string | null | undefined): string {
  const primeiro = nome?.trim().split(/\s+/)[0] ?? '';
  return texto
    .replace(/,?\s*\{nome\}/gi, (m) => (primeiro ? m.replace(/\{nome\}/i, primeiro) : ''))
    .replace(/\s+([!?.,])/g, '$1')
    .trim();
}

const palavra = z
  .string()
  .trim()
  .min(2, 'Palavra muito curta.')
  .max(40)
  .refine((v) => /[\p{L}\p{N}]/u.test(v), 'Use letras ou números.');

const link = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v))
  .pipe(z.string().url('Link inválido.'));

export const regraInstagramEntrada = z
  .object({
    alvo: z.enum(['publicacao', 'proxima', 'todas']),
    midiaId: z.string().trim().max(60).nullish(),
    palavras: z.array(palavra).min(1, 'Informe pelo menos uma palavra.').max(10),
    respostas: z.array(z.string().trim().min(1).max(300)).max(3).default([]),
    mensagem: z.string().trim().min(5, 'Escreva a mensagem do direct.').max(900),
    botaoTexto: z.string().trim().max(20).nullish(),
    botaoLink: link.nullish().or(z.literal('')),
    iaContinua: z.boolean().default(false),
    avisar: z.boolean().default(true),
    etapaId: z.number().int().positive().nullish(),
    responsavelId: z.number().int().positive().nullish(),
    etiquetas: z.array(z.string().trim().min(1).max(30)).max(6).default(['instagram']),
    ligada: z.boolean().default(true),
  })
  .refine((r) => r.alvo !== 'publicacao' || !!r.midiaId, {
    message: 'Escolha a publicação.',
    path: ['midiaId'],
  })
  .refine((r) => !r.botaoTexto === !r.botaoLink, {
    message: 'O botão precisa do texto e do link.',
    path: ['botaoLink'],
  });
export type RegraInstagramEntrada = z.infer<typeof regraInstagramEntrada>;

/** Para onde cada resposta do formulário vai no lead. */
export const CAMPOS_FORMULARIO = {
  contato: 'Nome do contato',
  telefone: 'WhatsApp',
  email: 'E-mail',
  empresa: 'Empresa',
  cidade: 'Cidade',
  cargo: 'Cargo',
  anotacao: 'Anotação do lead',
  ignorar: 'Não usar',
} as const;
export type CampoFormulario = keyof typeof CAMPOS_FORMULARIO;

/** O campo que o sistema sugere para cada pergunta (pelo tipo que a Meta informa ou pela chave). */
export function campoSugerido(tipo: string, chave: string): CampoFormulario {
  const t = tipo.toUpperCase();
  const k = semAcentoMinusculo(chave);
  if (t === 'FULL_NAME' || t === 'FIRST_NAME' || /^(full_?name|nome)/.test(k)) return 'contato';
  if (t === 'PHONE' || /phone|telefone|whatsapp|celular/.test(k)) return 'telefone';
  if (t === 'EMAIL' || /e-?mail/.test(k)) return 'email';
  if (t === 'COMPANY_NAME' || /company|empresa/.test(k)) return 'empresa';
  if (t === 'CITY' || /city|cidade/.test(k)) return 'cidade';
  if (t === 'JOB_TITLE' || /job|cargo/.test(k)) return 'cargo';
  if (t === 'LAST_NAME') return 'ignorar';
  return 'anotacao';
}

export const perguntaFormulario = z.object({
  chave: z.string().max(200),
  rotulo: z.string().max(300),
  tipo: z.string().max(60),
  campo: z.enum(Object.keys(CAMPOS_FORMULARIO) as [CampoFormulario, ...CampoFormulario[]]),
});
export type PerguntaFormulario = z.infer<typeof perguntaFormulario>;

export const formularioInstagramEntrada = z.object({
  ligado: z.boolean(),
  perguntas: z.array(perguntaFormulario).max(60),
  etapaId: z.number().int().positive().nullish(),
  responsavelId: z.number().int().positive().nullish(),
  etiquetas: z.array(z.string().trim().min(1).max(30)).max(6).default(['instagram']),
  boasVindas: z.string().trim().max(900).nullish(),
  avisar: z.boolean().default(true),
});
export type FormularioInstagramEntrada = z.infer<typeof formularioInstagramEntrada>;

/** Lead a partir das respostas do formulário, pelo mapa de campos. */
export function leadDoCadastro(
  respostas: { chave: string; valores: string[] }[],
  perguntas: readonly PerguntaFormulario[],
): {
  contato: string | null;
  telefone: string | null;
  email: string | null;
  empresa: string | null;
  cidade: string | null;
  cargo: string | null;
  anotacao: string | null;
} {
  const r = {
    contato: null as string | null,
    telefone: null as string | null,
    email: null as string | null,
    empresa: null as string | null,
    cidade: null as string | null,
    cargo: null as string | null,
    anotacao: null as string | null,
  };
  const notas: string[] = [];
  const nomes: string[] = [];
  for (const resp of respostas) {
    const valor = resp.valores.join(', ').trim();
    if (!valor) continue;
    const p = perguntas.find((x) => x.chave === resp.chave);
    const campo = p?.campo ?? campoSugerido('', resp.chave);
    const rotulo = p?.rotulo ?? resp.chave;
    if (campo === 'ignorar') {
      // Sobrenome separado: junta com o nome.
      if (p?.tipo === 'LAST_NAME') nomes.push(valor);
      continue;
    }
    if (campo === 'anotacao') notas.push(`${rotulo}: ${valor}`);
    else if (campo === 'contato') nomes.unshift(valor);
    else if (!r[campo]) r[campo] = valor.slice(0, 200);
    else notas.push(`${rotulo}: ${valor}`);
  }
  if (nomes.length) r.contato = nomes.join(' ').slice(0, 120);
  if (notas.length) r.anotacao = notas.join('\n').slice(0, 2000);
  return r;
}

export const instagramConfigEntrada = z.object({
  directNovo: z.enum(['lead', 'ignorar']),
});

export const directEntrada = z.object({ texto: z.string().trim().min(1).max(1000) });

/* ───────────────────────── Análise do conteúdo ───────────────────────── */

export type InteresseComentario = 'preco' | 'informacao' | 'contato';

export const ROTULO_INTERESSE: Record<InteresseComentario, string> = {
  preco: 'perguntou preço',
  informacao: 'pediu informação',
  contato: 'pediu contato',
};

/**
 * O comentário mostra interesse de compra? Pergunta de preço, pedido de informação ou de contato.
 * Regras de palavras (na hora e sem custo); elogio e marcação de amigo não contam.
 */
export function interesseDoComentario(texto: string): InteresseComentario | null {
  const t = ` ${semAcentoMinusculo(texto).replace(/[^\p{L}\p{N}?]+/gu, ' ')} `;
  if (
    /\b(quanto|valor(es)?|preco|precos|custa|custo|orcamento|mensalidade|plano(s)?|investimento|tabela)\b/.test(
      t,
    )
  )
    return 'preco';
  if (
    /\b(me chama|chama no|me manda|manda (no|um|o)|direct|dm|inbox|whats|whatsapp|zap|wpp|contato|liga(r)? pra mim|me liga|telefone)\b/.test(
      t,
    )
  )
    return 'contato';
  if (
    /\b(como funciona|como faco|como contratar|como (eu )?(faco|consigo|compro)|atende(m)?|funciona para|serve para|tem para|informac(ao|oes)|mais info|info|interesse|interessad[oa]|quero saber|gostaria)\b/.test(
      t,
    ) ||
    (/\?/.test(texto) && /\b(voces|vcs|voce|vc|tem|faz(em)?|da pra|consigo|pode)\b/.test(t))
  )
    return 'informacao';
  return null;
}

/** Uma publicação com os números do Instagram e os do CRM, para a análise. */
export interface PublicacaoNumeros {
  midiaId: string;
  legenda: string | null;
  tipo: string | null;
  alcance: number | null;
  leads: number;
  reunioes: number;
  vendas: number;
  valorVendas: number;
  interesse: number;
}

export interface Achado {
  tipo: 'formato' | 'destaque' | 'atencao';
  titulo: string;
  texto: string;
  midiaId?: string | null;
}

const NOME_FORMATO: Record<string, string> = {
  REELS: 'Reels',
  CAROUSEL_ALBUM: 'Carrossel',
  IMAGE: 'Foto',
  VIDEO: 'Vídeo',
};
export const nomeDoFormato = (tipo: string | null | undefined) =>
  tipo ? (NOME_FORMATO[tipo] ?? tipo) : 'Post';

const mil = (n: number) =>
  n >= 1000 ? `${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : String(n);
const reais = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const tituloCurto = (p: PublicacaoNumeros) => {
  const l = p.legenda?.split('\n')[0]?.trim() ?? '';
  return l
    ? `“${l.length > 48 ? `${l.slice(0, 46)}…` : l}”`
    : `o ${nomeDoFormato(p.tipo).toLowerCase()} sem legenda`;
};

/**
 * Até três achados do período, tirados dos números (sem inventar): o formato que mais traz lead por
 * alcance, o post que mais vendeu (ou trouxe leads) e o que teve muito alcance e nenhum lead.
 */
export function achadosDoConteudo(posts: readonly PublicacaoNumeros[]): Achado[] {
  const achados: Achado[] = [];
  const comAlcance = posts.filter((p) => (p.alcance ?? 0) > 0);

  // 1. Formato: leads a cada mil pessoas alcançadas, só com 2+ posts de cada formato.
  const porFormato = new Map<string, { alcance: number; leads: number; n: number }>();
  for (const p of comAlcance) {
    const k = p.tipo ?? 'POST';
    const f = porFormato.get(k) ?? { alcance: 0, leads: 0, n: 0 };
    f.alcance += p.alcance ?? 0;
    f.leads += p.leads;
    f.n++;
    porFormato.set(k, f);
  }
  const formatos = [...porFormato.entries()]
    .filter(([, f]) => f.n >= 2 && f.alcance > 0)
    .map(([tipo, f]) => ({ tipo, taxa: (f.leads / f.alcance) * 1000, media: f.alcance / f.n }))
    .sort((a, b) => b.taxa - a.taxa);
  const melhor = formatos[0];
  const pior = formatos.at(-1);
  if (melhor && pior && melhor !== pior && melhor.taxa > 0) {
    const vezes = pior.taxa > 0 ? melhor.taxa / pior.taxa : null;
    const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    achados.push({
      tipo: 'formato',
      titulo:
        vezes && vezes >= 1.2
          ? `${nomeDoFormato(melhor.tipo)} traz ${vezes.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}× mais leads por alcance que ${nomeDoFormato(pior.tipo).toLowerCase()}`
          : `${nomeDoFormato(melhor.tipo)} é o formato que mais traz leads por alcance`,
      texto: `${fmt(melhor.taxa)} lead a cada mil pessoas alcançadas no ${nomeDoFormato(melhor.tipo).toLowerCase()}, contra ${fmt(pior.taxa)} no ${nomeDoFormato(pior.tipo).toLowerCase()} (alcance médio de ${mil(Math.round(melhor.media))} e ${mil(Math.round(pior.media))}).`,
    });
  }

  // 2. Destaque: o que mais vendeu; sem venda, o que mais trouxe leads.
  const destaque = [...posts]
    .filter((p) => p.leads > 0)
    .sort((a, b) => b.valorVendas - a.valorVendas || b.vendas - a.vendas || b.leads - a.leads)[0];
  if (destaque)
    achados.push({
      tipo: 'destaque',
      titulo: tituloCurto(destaque),
      texto: `${destaque.alcance != null ? `Alcance de ${mil(destaque.alcance)}, ` : ''}${destaque.leads} ${destaque.leads === 1 ? 'lead' : 'leads'}, ${destaque.reunioes} ${destaque.reunioes === 1 ? 'reunião' : 'reuniões'}${destaque.vendas ? ` e ${destaque.vendas} ${destaque.vendas === 1 ? 'venda' : 'vendas'} (${reais(destaque.valorVendas)}/mês)` : ''}. Vale repetir o formato e o tema.`,
      midiaId: destaque.midiaId,
    });

  // 3. Atenção: o maior alcance sem nenhum lead (acima da média de alcance).
  const media = comAlcance.reduce((s, p) => s + (p.alcance ?? 0), 0) / (comAlcance.length || 1);
  const semLead = comAlcance
    .filter((p) => p.leads === 0 && (p.alcance ?? 0) >= media)
    .sort((a, b) => (b.alcance ?? 0) - (a.alcance ?? 0))[0];
  if (semLead)
    achados.push({
      tipo: 'atencao',
      titulo: `${tituloCurto(semLead)} teve ${mil(semLead.alcance ?? 0)} de alcance e nenhum lead`,
      texto: semLead.interesse
        ? `${semLead.interesse} ${semLead.interesse === 1 ? 'pessoa demonstrou' : 'pessoas demonstraram'} interesse nos comentários e ninguém virou lead: estão na página do post.`
        : 'Muita gente viu e ninguém chegou ao funil. Uma regra de comente e receba e uma chamada no texto ajudam.',
      midiaId: semLead.midiaId,
    });
  return achados;
}

/* ───────────────────────── Devolver as vendas para a Meta ───────────────────────── */

/** As etapas que a Meta recebe, em ordem (cada uma só depois das anteriores). */
export const ETAPAS_META = [
  { id: 'lead', evento: 'Lead', rotulo: 'Chegou o cadastro' },
  { id: 'respondeu', evento: 'Respondeu', rotulo: 'Respondeu' },
  { id: 'reuniao', evento: 'Reunião marcada', rotulo: 'Reunião marcada' },
  { id: 'proposta', evento: 'Proposta enviada', rotulo: 'Proposta enviada' },
  { id: 'ganho', evento: 'Cliente', rotulo: 'Virou cliente' },
] as const;
export type EtapaMeta = (typeof ETAPAS_META)[number]['id'];

const ORDEM_META: Record<string, number> = {
  a_abordar: 0,
  abordado: 0,
  respondeu: 1,
  reuniao: 2,
  proposta: 3,
  ganho: 4,
};

/**
 * As etapas da Meta que o lead já alcançou, pela etapa do funil. Perdido e descartado não avançam
 * (o que já foi avisado antes fica).
 */
export function etapasMetaAlcancadas(etapaFunil: string): EtapaMeta[] {
  const n = ORDEM_META[etapaFunil];
  if (n === undefined) return [];
  return ETAPAS_META.slice(0, n + 1).map((e) => e.id);
}

export const conversoesEntrada = z.object({
  ligado: z.boolean(),
  dataset: z
    .string()
    .trim()
    .regex(/^\d{6,20}$/, 'O ID do conjunto de dados são só números.')
    .nullish(),
  /** Vazio: mantém o que já está salvo. */
  token: z.string().trim().min(20, 'Token muito curto.').max(600).nullish().or(z.literal('')),
});
