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
