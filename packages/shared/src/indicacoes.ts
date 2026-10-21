import { z } from 'zod';
import { normalizarTelefone } from './normalizar.js';

/**
 * Indicações: na conversa com uma empresa, quem atende costuma passar o contato de outra pessoa
 * ("fala com o Carlos das compras, 71 99999-1234"). Aqui ficam as regras para reconhecer isso numa
 * mensagem e os formatos de entrada das telas.
 */

export interface IndicacaoAchada {
  nome: string | null;
  cargo: string | null;
  telefone: string;
  /** Trecho da mensagem (ou "cartão de contato") que mostra a indicação. */
  evidencia: string;
}

/** Telefone brasileiro escrito de qualquer jeito: (71) 99999-1234, 71 9 9999 1234, +55 71 99999-1234. */
const TELEFONE_NO_TEXTO = /(?:\+?55[\s.-]*)?\(?\b([1-9]{2})\)?[\s.-]*(9[\s.-]*\d{4}|\d{4})[\s.-]*(\d{4})\b/g;

const CARGOS: [RegExp, string][] = [
  [/\bcompras?\b|\bcomprador(a)?\b/i, 'Compras'],
  [/\bgerente\b|\bgerência\b|\bgerencia\b/i, 'Gerente'],
  [/\bs[óo]ci[oa]\b/i, 'Sócio'],
  [/\bdon[oa]\b|\bpropriet[áa]ri[oa]\b|\bpatr[ãa]o\b/i, 'Dono'],
  [/\bdiretor(a)?\b/i, 'Diretor'],
  [/\bfinanceiro\b/i, 'Financeiro'],
  [/\bsupervisor(a)?\b/i, 'Supervisor'],
  [/\bvendas\b|\bvendedor(a)?\b/i, 'Vendas'],
  [/\bcomercial\b/i, 'Comercial'],
  [/\brespons[áa]vel\b/i, 'Responsável'],
];

/** Palavras com maiúscula que não são nome de gente. */
const NAO_E_NOME = new Set(
  'Bom Boa Dia Tarde Noite Ola Olá Oi Obrigado Obrigada Pode Fala Falar Liga Ligue Manda Mande Chama Chame Procura Procure Ele Ela Esse Essa Este Esta Whatsapp WhatsApp Zap Numero Número Contato Telefone Celular Segue Aqui Ai Aí Sim Nao Não Compras Comprador Compradora Gerente Dono Dona Sócio Sócia Socio Socia Diretor Diretora Financeiro Vendas Comercial Senhor Senhora Sr Sra Seu Sua'.split(
    ' ',
  ),
);

function nomeNoTrecho(trecho: string): string | null {
  // "fala com o Carlos", "procura a Ana Paula", "o Carlos das compras", "Sr. João"
  const padroes = [
    /(?:fal(?:a|ar|e)|procur(?:a|ar|e)|cham(?:a|ar|e)|lig(?:a|ar|ue)|mand(?:a|ar|e)|chama(?:r)?|contato|n[úu]mero|zap|whats(?:app)?)\s+(?:com\s+|d[oa]\s+|para\s+|pro\s+|pra\s+)?(?:o\s+|a\s+|seu\s+|sua\s+|sr\.?\s+|sra\.?\s+|dona\s+)?([A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+)?)/,
    /\b(?:o|a|seu|sua|sr\.?|sra\.?|dona)\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+)?)/,
  ];
  for (const p of padroes) {
    const m = trecho.match(p);
    const nome = m?.[1]
      ?.split(/\s+/)
      .filter((x) => !NAO_E_NOME.has(x))
      .join(' ');
    if (nome) return nome;
  }
  return null;
}

/**
 * Telefones indicados numa mensagem, com o nome e o cargo quando o texto diz. Ignora o próprio
 * número de quem escreveu. Sem telefone no texto, não há indicação (nome solto não basta).
 */
export function indicacoesNoTexto(texto: string, telefoneDeQuemEscreveu?: string | null): IndicacaoAchada[] {
  const proprio = normalizarTelefone(telefoneDeQuemEscreveu)?.slice(-8) ?? null;
  const achadas: IndicacaoAchada[] = [];
  const vistos = new Set<string>();
  for (const m of texto.matchAll(TELEFONE_NO_TEXTO)) {
    const tel = normalizarTelefone(`${m[1]}${(m[2] ?? '').replace(/\D/g, '')}${m[3]}`);
    if (!tel || vistos.has(tel) || tel.slice(-8) === proprio) continue;
    vistos.add(tel);
    // O trecho que fala deste número: da frase anterior até o número.
    const inicio = Math.max(0, (m.index ?? 0) - 120);
    const antes = texto.slice(inicio, m.index ?? 0);
    const frase = antes.split(/[.!?\n]\s*(?=[A-ZÁÉÍÓÚ])/).at(-1) ?? antes;
    const depois = texto.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 40);
    const contexto = `${frase} ${depois.split(/[.!?\n]/)[0] ?? ''}`;
    const cargo = CARGOS.find(([re]) => re.test(contexto))?.[1] ?? null;
    achadas.push({
      nome: nomeNoTrecho(frase) ?? nomeNoTrecho(depois),
      cargo,
      telefone: tel,
      evidencia: `${frase.trim()} ${m[0].trim()}`.trim().slice(0, 240),
    });
  }
  return achadas;
}

/** Cartão de contato (vCard) mandado no WhatsApp: nome e telefones. */
export function lerVcard(
  vcard: string,
  nomeExibido?: string | null,
): { nome: string | null; telefones: string[] } {
  const linhas = vcard.replace(/\r/g, '').split('\n');
  const fn =
    linhas
      .find((l) => /^FN[:;]/i.test(l))
      ?.replace(/^FN[^:]*:/i, '')
      .trim() || null;
  const telefones = [
    ...new Set(
      linhas
        .filter((l) => /^(item\d+\.)?TEL/i.test(l))
        .map((l) => normalizarTelefone(l.match(/waid=(\d+)/i)?.[1] ?? l.replace(/^[^:]*:/, '')))
        .filter((t): t is string => !!t),
    ),
  ];
  return { nome: nomeExibido?.trim() || fn, telefones };
}

/* ───────────── Entradas das telas ───────────── */

const telefoneEntrada = z
  .string()
  .trim()
  .max(30)
  .transform((v, ctx) => {
    if (!v) return null;
    const t = normalizarTelefone(v);
    if (!t) {
      ctx.addIssue({ code: 'custom', message: 'Telefone inválido: use DDD + número.' });
      return z.NEVER;
    }
    return t;
  });

export const contatoLeadEntrada = z
  .object({
    nome: z.string().trim().min(1, 'Informe o nome.').max(120),
    cargo: z.string().trim().max(80).nullish(),
    telefone: telefoneEntrada.nullish(),
    email: z.string().trim().toLowerCase().email('E-mail inválido.').max(160).nullish().or(z.literal('')),
    indicadoPorId: z.number().int().positive().nullish(),
    indicadoPorTexto: z.string().trim().max(120).nullish(),
    decisor: z.boolean().optional(),
    /** Passar a conversar com este contato (o "enviar para" muda para o número dele). */
    conversarCom: z.boolean().optional(),
  })
  .refine((d) => d.telefone || d.email, { message: 'Informe o telefone ou o e-mail.', path: ['telefone'] });
export type ContatoLeadEntrada = z.infer<typeof contatoLeadEntrada>;

export const contatoLeadAtualizar = z.object({
  nome: z.string().trim().min(1).max(120).optional(),
  cargo: z.string().trim().max(80).nullish(),
  telefone: telefoneEntrada.nullish(),
  email: z.string().trim().toLowerCase().email('E-mail inválido.').max(160).nullish().or(z.literal('')),
  indicadoPorId: z.number().int().positive().nullish(),
  indicadoPorTexto: z.string().trim().max(120).nullish(),
  decisor: z.boolean().optional(),
  /** Sugestão aceita: vira contato confirmado. */
  confirmar: z.literal(true).optional(),
  conversarCom: z.boolean().optional(),
});
export type ContatoLeadAtualizar = z.infer<typeof contatoLeadAtualizar>;

export const destinoEntrada = z.object({ telefone: telefoneEntrada.nullable() });

export const vincularEntrada = z.object({
  empresaId: z.number().int().positive(),
  nome: z.string().trim().min(1, 'Informe o nome.').max(120),
  cargo: z.string().trim().max(80).nullish(),
  indicadoPorId: z.number().int().positive().nullish(),
  indicadoPorTexto: z.string().trim().max(120).nullish(),
  conversarCom: z.boolean().default(true),
});
export type VincularEntrada = z.infer<typeof vincularEntrada>;
