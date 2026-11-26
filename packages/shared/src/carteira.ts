import { z } from 'zod';

/**
 * Atendimento com carteira (recurso `carteira`, plano Escala). Cada vez que o cliente escreve abre
 * (ou continua) um atendimento com protocolo. Cliente com dono vai para a fila do dono ("Minha
 * carteira"); sem dono, para a Fila geral. O atendimento é encerrado com motivo e etiquetas e reabre
 * sozinho quando o cliente volta a escrever.
 */

export const CORES_ETIQUETA = ['cinza', 'azul', 'verde', 'laranja', 'vermelho', 'roxo'] as const;
export type CorEtiqueta = (typeof CORES_ETIQUETA)[number];

export type SituacaoAtendimento = 'aberto' | 'aguardando' | 'encerrado';
export type FilaAtendimento = 'minha' | 'geral' | 'aguardando' | 'encerrados';

export const FILAS_ATENDIMENTO: { id: FilaAtendimento; nome: string }[] = [
  { id: 'minha', nome: 'Minha carteira' },
  { id: 'geral', nome: 'Fila geral' },
  { id: 'aguardando', nome: 'Aguardando' },
  { id: 'encerrados', nome: 'Encerrados' },
];

export const MOTIVOS_PADRAO = [
  'Venda fechada',
  'Orçamento enviado',
  'Dúvida resolvida',
  'Troca ou garantia',
  'Cliente não respondeu',
  'Sem estoque ou indisponível',
];

/** Motivo do encerramento automático (cliente parou de responder). */
export const MOTIVO_SEM_RESPOSTA = 'Cliente não respondeu';

export const PERGUNTA_PESQUISA =
  'De 1 a 5, que nota você dá para este atendimento? Responda só com o número.';

export interface Etiqueta {
  id: number;
  nome: string;
  cor: CorEtiqueta;
  /** Quantas vezes foi usada em atendimentos neste mês e quantos clientes têm. */
  usosMes?: number;
  clientes?: number;
}

export interface ConfigAtendimento {
  ativo: boolean;
  viraDono: boolean;
  /** O dono não respondeu em X minutos: aparece também na Fila geral (null = não). */
  esperaDonoMin: number | null;
  pausaVaiGeral: boolean;
  motivos: string[];
  mandarEncerramento: boolean;
  msgEncerramento: string;
  pesquisa: boolean;
  /** Aguardando o cliente por X horas: encerra sozinho (null = não). */
  encerrarSemRespostaH: number | null;
  protocoloNaPrimeira: boolean;
}

export const CONFIG_ATENDIMENTO_PADRAO: ConfigAtendimento = {
  ativo: false,
  viraDono: true,
  esperaDonoMin: 10,
  pausaVaiGeral: true,
  motivos: MOTIVOS_PADRAO,
  mandarEncerramento: true,
  msgEncerramento:
    'Obrigado pelo contato, {nome}! Seu atendimento {protocolo} foi encerrado. Se precisar, é só chamar aqui.',
  pesquisa: true,
  encerrarSemRespostaH: 24,
  protocoloNaPrimeira: false,
};

const textoCurto = (max: number) => z.string().trim().min(1).max(max);

export const configAtendimentoEntrada = z.object({
  ativo: z.boolean(),
  viraDono: z.boolean(),
  esperaDonoMin: z.number().int().min(1).max(240).nullable(),
  pausaVaiGeral: z.boolean(),
  motivos: z
    .array(textoCurto(60))
    .min(1, 'Deixe pelo menos um motivo de encerramento.')
    .max(20)
    .transform((l) => [...new Set(l)]),
  mandarEncerramento: z.boolean(),
  msgEncerramento: z.string().trim().max(500),
  pesquisa: z.boolean(),
  encerrarSemRespostaH: z.number().int().min(1).max(720).nullable(),
  protocoloNaPrimeira: z.boolean(),
});
export type ConfigAtendimentoEntrada = z.infer<typeof configAtendimentoEntrada>;

export const etiquetaEntrada = z.object({
  nome: textoCurto(30),
  cor: z.enum(CORES_ETIQUETA).default('cinza'),
});

export const listaEtiquetas = z.array(textoCurto(30)).max(12);

export const filtrosAtendimento = z.object({
  fila: z.enum(['minha', 'geral', 'aguardando', 'encerrados']).default('minha'),
  etiqueta: z.string().trim().max(40).optional(),
  busca: z.string().trim().max(80).optional(),
});
export type FiltrosAtendimento = z.infer<typeof filtrosAtendimento>;

export const encerrarEntrada = z.object({
  motivo: textoCurto(60),
  etiquetas: listaEtiquetas.default([]),
  mandarMensagem: z.boolean().default(true),
  pedirNota: z.boolean().default(true),
});
export type EncerrarEntrada = z.infer<typeof encerrarEntrada>;

export const transferirEntrada = z
  .object({
    usuarioId: z.number().int().positive().nullable().default(null),
    grupoId: z.number().int().positive().nullable().default(null),
    nota: z.string().trim().max(1000).default(''),
    /** Passar também o cliente para a carteira de quem recebe (só o administrador). */
    passarCarteira: z.boolean().default(false),
  })
  .refine((d) => (d.usuarioId == null) !== (d.grupoId == null), 'Escolha uma pessoa ou um grupo.');
export type TransferirEntrada = z.infer<typeof transferirEntrada>;

export const notaInternaEntrada = z.object({ texto: textoCurto(2000) });

export const donoEntrada = z.object({ usuarioId: z.number().int().positive().nullable() });

export const passarCarteiraEntrada = z
  .object({
    de: z.number().int().positive(),
    para: z.number().int().positive(),
    /** Só os clientes com esta etiqueta (vazio = todos). */
    etiqueta: z.string().trim().max(40).optional(),
  })
  .refine((d) => d.de !== d.para, 'Escolha duas pessoas diferentes.');

export const importarCarteiraEntrada = z
  .object({
    /** Conteúdo da planilha em CSV (CNPJ ou telefone; e-mail do vendedor; nome opcional). */
    csv: z.string().min(1).max(2_000_000).optional(),
    /** Ou a planilha do Excel (.xlsx) em base64. */
    xlsx: z.string().min(1).max(14_000_000).optional(),
  })
  .refine((d) => !!d.csv !== !!d.xlsx, 'Mande a planilha em CSV ou em Excel.');

export const disponivelEntrada = z.object({ disponivel: z.boolean() });

export const periodoPainel = z.object({
  periodo: z.enum(['hoje', 'semana', 'mes']).default('hoje'),
  grupo: z.coerce.number().int().positive().optional(),
});

/** O atendimento de um cliente (o atual ou o último). */
export interface Atendimento {
  id: number;
  protocolo: string;
  canal: 'whatsapp' | 'instagram';
  situacao: SituacaoAtendimento;
  atendenteId: number | null;
  atendenteNome: string | null;
  grupoId: number | null;
  grupoNome: string | null;
  origem: 'carteira' | 'geral';
  reaberto: boolean;
  abertoEm: string;
  primeiraRespostaEm: string | null;
  ultimaClienteEm: string | null;
  encerradoEm: string | null;
  encerradoPor: string | null;
  motivo: string | null;
  etiquetas: string[];
  notaCliente: number | null;
}

/** O que aconteceu no atendimento (aparece na conversa entre as mensagens). */
export interface EventoAtendimento {
  id: number;
  atendimentoId: number;
  protocolo: string;
  tipo:
    | 'aberto'
    | 'reaberto'
    | 'assumiu'
    | 'transferiu'
    | 'nota'
    | 'encerrou'
    | 'pesquisa'
    | 'carteira'
    | 'etiquetas';
  usuario: string | null;
  usuarioId: number | null;
  para: string | null;
  texto: string | null;
  em: string;
}

export interface AtendimentoAnterior {
  id: number;
  protocolo: string;
  motivo: string | null;
  etiquetas: string[];
  atendente: string | null;
  origem: 'carteira' | 'geral';
  encerradoEm: string;
  notaCliente: number | null;
  pesquisaPedida: boolean;
}

/** Painel do cliente na conversa (coluna da direita). */
export interface ClienteDoAtendimento {
  empresaId: number;
  nome: string;
  cnpj: string | null;
  cidade: string | null;
  uf: string | null;
  clienteDesde: string;
  donoId: number | null;
  donoNome: string | null;
  donoDesde: string | null;
  etiquetas: string[];
  atual: Atendimento | null;
  /** Sem atendimento em aberto: o último encerrado (para reabrir). */
  ultimo: Atendimento | null;
  eventos: EventoAtendimento[];
  anteriores: AtendimentoAnterior[];
}

export interface ContagemFilas {
  minha: number;
  geral: number;
  aguardando: number;
  /** A mais antiga esperando na Fila geral. */
  geralDesde: string | null;
}

export interface PessoaAtendimento {
  id: number;
  nome: string;
  disponivel: boolean;
  pausaDesde: string | null;
  emAtendimento: number;
  grupos: string[];
}

export interface PainelAtendimentoCarteira {
  agora: { naFila: number; filaDesde: string | null; emAtendimento: number; pessoas: number };
  primeiraRespostaMin: number | null;
  primeiraRespostaOntemMin: number | null;
  duracaoMin: number | null;
  encerrados: number;
  vendas: number;
  notaMedia: number | null;
  notas: number;
  porPessoa: {
    id: number;
    nome: string;
    disponivel: boolean;
    pausaDesde: string | null;
    carteira: number;
    esperando: number;
    emAtendimento: number;
    hoje: number;
    paraFila: number;
    primeiraRespostaMin: number | null;
    nota: number | null;
  }[];
  motivos: { motivo: string; total: number }[];
  origens: { carteira: number; geral: number; viraramDono: number };
  etiquetas: { nome: string; total: number }[];
}

export interface ResumoCarteira {
  comDono: number;
  semDono: number;
  vendedores: number;
}

export interface ResultadoImportacaoCarteira {
  linhas: number;
  atribuidos: number;
  criados: number;
  semVendedor: string[];
  naoEncontrados: string[];
}

/** Troca {nome} e {protocolo} na mensagem de encerramento. */
export function textoEncerramento(modelo: string, dados: { nome: string; protocolo: string }): string {
  return modelo
    .replace(/\{nome\}/gi, dados.nome.trim() || 'cliente')
    .replace(/\{protocolo\}/gi, dados.protocolo)
    .trim();
}

/** A resposta da pesquisa: só o número de 1 a 5 (o resto é conversa e reabre o atendimento). */
export function notaDaPesquisa(texto: string): number | null {
  const t = texto.trim();
  return /^[1-5]$/.test(t) ? Number(t) : null;
}
