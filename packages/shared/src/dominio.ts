import { z } from 'zod';
import { normalizarCnae } from './normalizar.js';

/**
 * Contratos de entrada do domínio, usados pela API (validação) e pelo web
 * (formulários). Este arquivo não pode importar nada de Node: o web importa
 * direto via "@prospeccao/shared/dominio".
 */

export const PORTES = ['me', 'epp', 'demais', 'nao_informado'] as const;
export const ROTULO_PORTE: Record<(typeof PORTES)[number], string> = {
  me: 'Microempresa',
  epp: 'Empresa de pequeno porte',
  demais: 'Demais',
  nao_informado: 'Não informado',
};

export const STATUS_CAMPANHA = ['rascunho', 'ativa', 'pausada', 'encerrada'] as const;
export type StatusCampanha = (typeof STATUS_CAMPANHA)[number];

export const MODOS_CAMPANHA = ['semi', 'auto'] as const;
export const CADENCIAS = ['padrao', 'curta'] as const;

export const ORIGENS_EMPRESA = ['cnpj', 'maps', 'ambos'] as const;
export type OrigemEmpresa = (typeof ORIGENS_EMPRESA)[number];

const texto = (min: number, max: number, rotulo: string) =>
  z
    .string({ message: `${rotulo} é obrigatório.` })
    .trim()
    .min(min, `${rotulo} precisa ter pelo menos ${min} caracteres.`)
    .max(max, `${rotulo} pode ter no máximo ${max} caracteres.`);

const listaTextos = (rotulo: string, min = 0) =>
  z
    .array(z.string().trim().min(1).max(120))
    .max(50, `${rotulo}: no máximo 50 itens.`)
    .min(min, `Informe pelo menos ${min} ${rotulo.toLowerCase()}.`)
    .transform((itens) => [...new Set(itens)]);

export const cnaeSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const n = normalizarCnae(v);
    if (!n) {
      ctx.addIssue({ code: 'custom', message: `CNAE inválido: "${v}". Use o formato 4530-7/03.` });
      return z.NEVER;
    }
    return n;
  });

/**
 * Versão "atualização" de um contrato de criação: todos os campos opcionais e SEM os valores
 * padrão. Com `.partial()` puro, o zod aplicaria os padrões e um PATCH só com o nome
 * reescreveria o resto (meta, cadência, raio...) com os valores de fábrica.
 */
function parcialSemPadroes<T extends z.ZodRawShape>(esquema: z.ZodObject<T>) {
  const campos = Object.fromEntries(
    Object.entries(esquema.shape).map(([k, v]) => [k, v instanceof z.ZodDefault ? v.unwrap() : v]),
  );
  return z.object(campos).partial() as unknown as ReturnType<z.ZodObject<T>['partial']>;
}

export const nichoEntrada = z.object({
  nome: texto(2, 80, 'Nome'),
  cnaes: z
    .array(cnaeSchema)
    .min(1, 'Informe pelo menos um CNAE.')
    .max(30)
    .transform((itens) => [...new Set(itens)]),
  termosMaps: listaTextos('Termos de busca', 1),
  palavrasPositivas: listaTextos('Palavras positivas').default([]),
  palavrasNegativas: listaTextos('Palavras negativas').default([]),
  cargosAlvo: listaTextos('Cargos-alvo').default([]),
  portes: z
    .array(z.enum(PORTES))
    .min(1, 'Escolha pelo menos um porte.')
    .default([...PORTES]),
  idadeMinimaAnos: z.coerce.number().int().min(0).max(50).default(0),
  /** MEI fica fora da lista e do enriquecimento (não tem como contratar o serviço). */
  excluirMei: z.boolean().default(true),
});
export type NichoEntrada = z.infer<typeof nichoEntrada>;
export const nichoAtualizacao = parcialSemPadroes(nichoEntrada).extend({ ativo: z.boolean().optional() });

export const ufSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'UF com duas letras, ex.: BA.');

export const cidadeSchema = z.object({
  cidade: texto(2, 80, 'Cidade'),
  uf: ufSchema,
});
export type Cidade = z.infer<typeof cidadeSchema>;

export const campanhaEntrada = z.object({
  nome: texto(3, 120, 'Nome'),
  nichoId: z.coerce.number().int().positive('Escolha um nicho.'),
  cidades: z.array(cidadeSchema).min(1, 'Adicione pelo menos uma cidade.').max(40),
  /** null = abrangência nacional, sem limite de distância. */
  raioKm: z
    .preprocess(
      (v) => (v === '' ? null : v),
      z.coerce.number().min(1, 'Raio mínimo de 1 km.').max(300, 'Raio máximo de 300 km.').nullable(),
    )
    .default(null),
  metaDiaria: z.coerce.number().int().min(1).max(2000).default(40),
  limiteEnviosDia: z.coerce.number().int().min(1).max(500).default(25),
  cadencia: z.enum(CADENCIAS).default('padrao'),
  modo: z.enum(MODOS_CAMPANHA).default('semi'),
  maxPorBusca: z.coerce.number().int().min(20).max(500).default(120),
});
export type CampanhaEntrada = z.infer<typeof campanhaEntrada>;
export const campanhaAtualizacao = parcialSemPadroes(campanhaEntrada);

export const baseEntrada = z
  .object({
    nome: texto(2, 80, 'Nome'),
    endereco: z.string().trim().max(240).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    ativa: z.boolean().default(true),
  })
  .refine((b) => (b.lat != null && b.lng != null) || !!b.endereco, {
    message: 'Informe o endereço ou as coordenadas da base.',
  });
export type BaseEntrada = z.infer<typeof baseEntrada>;

const booleanoQuery = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

export const filtrosEmpresas = z.object({
  campanhaId: z.coerce.number().int().positive().optional(),
  busca: z.string().trim().max(120).optional(),
  cidade: z.string().trim().max(80).optional(),
  origem: z.enum(ORIGENS_EMPRESA).optional(),
  comCnpj: booleanoQuery,
  dentroDoRaio: booleanoQuery,
  entrega: booleanoQuery,
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(200).default(50),
  ordem: z.enum(['nota', 'recentes', 'distancia', 'avaliacoes', 'nome']).default('nota'),
  /** Nota do enriquecimento: "A", "B", "C" ou "pendente" (ainda não enriquecido). */
  faixa: z.enum(['A', 'B', 'C', 'pendente']).optional(),
  /** Só quem tem WhatsApp achado (e não conferido como inválido). */
  comWhatsapp: booleanoQuery,
  /** Só quem tem decisor identificado (sócio da Receita ou cargo comprovado). */
  comDecisor: booleanoQuery,
  /**
   * Situação no funil: "novos" = nunca trabalhados (nem no funil, nem descartados);
   * "no_funil" = em alguma etapa; "descartados" = marcados como fora do perfil.
   */
  situacao: z.enum(['todos', 'novos', 'no_funil', 'descartados']).default('todos'),
  /** Nota mínima (0–100). */
  scoreMinimo: z.coerce.number().int().min(0).max(100).optional(),
  /** MEI fica de fora por padrão; "true" mostra também. */
  incluirMei: booleanoQuery,
});
export type FiltrosEmpresas = z.infer<typeof filtrosEmpresas>;

export const loginEntrada = z.object({
  email: z.string().trim().toLowerCase().email('E-mail inválido.'),
  senha: z.string().min(1, 'Informe a senha.'),
});

export const importacaoEntrada = z.object({
  mes: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'Mês no formato AAAA-MM.')
    .optional(),
});

/** Que parte da campanha volta para o enriquecimento. */
export const reenriquecerEntrada = z.object({
  escopo: z.enum(['ab', 'sem_decisor', 'todos']).default('ab'),
});
export type EscopoReenriquecer = z.infer<typeof reenriquecerEntrada>['escopo'];

/** Confirmação para apagar a campanha com os leads: o nome digitado. */
export const apagarCampanhaEntrada = z.object({
  confirmarNome: z.string().trim().min(1, 'Digite o nome da campanha para confirmar.'),
});

/** Valor em US$ opcional: vazio ou null = sem teto. */
const tetoUsd = z.preprocess(
  (v) => (v === '' || v === undefined ? null : v),
  z.coerce.number().min(0, 'O teto não pode ser negativo.').max(100_000, 'Teto alto demais.').nullable(),
);

/**
 * Iniciar/retomar a campanha. `tetoPlacesUsd` (opcional) troca o teto de gasto da campanha em
 * buscas pagas no Google: null = sem teto; 0 = só a franquia grátis.
 */
export const iniciarCampanhaEntrada = z.object({
  tetoPlacesUsd: tetoUsd.optional(),
});

export const tetoPlacesEntrada = z.object({ tetoPlacesUsd: tetoUsd });

/** Tabela de preços do Google Places (a do Google pode mudar) e teto do mês. */
export const configPlacesEntrada = z.object({
  franquiaMensal: z.coerce.number().int().min(0).max(1_000_000),
  precoMilUsd: z.coerce.number().min(0).max(1000),
  cotacaoBrl: z.coerce.number().min(0.5, 'Cotação inválida.').max(50, 'Cotação inválida.'),
  tetoMensalUsd: tetoUsd,
  maxBairros: z.coerce.number().int().min(0).max(1000),
});
export type ConfigPlacesEntrada = z.infer<typeof configPlacesEntrada>;

/** Uma linha da planilha do Google Maps (Instant Data Scraper), já com as colunas escolhidas. */
export const itemPlanilhaMaps = z.object({
  nome: z.string().trim().min(1).max(200),
  telefone: z.string().trim().max(40).nullish(),
  endereco: z.string().trim().max(300).nullish(),
  categoria: z.string().trim().max(120).nullish(),
  nota: z.number().min(0).max(5).nullish(),
  avaliacoes: z.number().int().min(0).max(10_000_000).nullish(),
  url: z.string().trim().max(1000).nullish(),
  site: z.string().trim().max(300).nullish(),
});
export type ItemPlanilhaMaps = z.infer<typeof itemPlanilhaMaps>;

export const planilhaMapsEntrada = z.object({
  campanhaId: z.number().int().positive(),
  cidade: z.string().trim().min(2).max(80),
  uf: z.string().trim().length(2),
  itens: z.array(itemPlanilhaMaps).min(1, 'A planilha não tem linhas com nome.').max(5000),
});
export type PlanilhaMapsEntrada = z.infer<typeof planilhaMapsEntrada>;
