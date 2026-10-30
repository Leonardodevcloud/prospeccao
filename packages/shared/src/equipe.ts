import { z } from 'zod';
import { opcoesSala } from './reunioes.js';

/* ───────────────────────────── Equipe ───────────────────────────── */

export const PAPEIS_USUARIO = ['admin', 'sdr', 'closer'] as const;
export type PapelUsuario = (typeof PAPEIS_USUARIO)[number];
export const ROTULO_PAPEL_USUARIO: Record<PapelUsuario, string> = {
  admin: 'Administrador',
  sdr: 'SDR (prospecção)',
  closer: 'Closer (fechamento)',
};

/** Papéis da organização inteira (todas as unidades): não ficam na equipe de uma unidade. */
export const PAPEIS_ORGANIZACAO = ['gestor', 'leitura'] as const;
export type PapelOrganizacao = (typeof PAPEIS_ORGANIZACAO)[number];
export const ROTULO_PAPEL_ORGANIZACAO: Record<PapelOrganizacao, string> = {
  gestor: 'Gestor da organização',
  leitura: 'Só leitura (diretoria)',
};
export const PAPEIS_TODOS = [...PAPEIS_USUARIO, ...PAPEIS_ORGANIZACAO] as const;
export type PapelQualquer = (typeof PAPEIS_TODOS)[number];

const telefone = z
  .string()
  .trim()
  .transform((v) => v.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, ''))
  .refine((v) => v === '' || /^\d{10,11}$/.test(v), 'Telefone com DDD, ex.: 71 99999-0000.')
  .transform((v) => v || null);

/** O que a pessoa vê da unidade: tudo ou só a própria base (as negociações em que é a responsável). */
export const ALCANCES = ['unidade', 'proprios'] as const;
export type Alcance = (typeof ALCANCES)[number];
export const ROTULO_ALCANCE: Record<Alcance, string> = {
  unidade: 'A unidade toda',
  proprios: 'Só a própria base',
};

export const usuarioNovo = z.object({
  nome: z.string().trim().min(2, 'Informe o nome.').max(80),
  email: z.string().trim().toLowerCase().email('E-mail inválido.'),
  papel: z.enum(PAPEIS_USUARIO),
  telefone: telefone.optional(),
  alcance: z.enum(ALCANCES).default('unidade'),
});
export type UsuarioNovo = Omit<z.infer<typeof usuarioNovo>, 'alcance'> & { alcance?: Alcance };

export const metasEntrada = z.object({
  abordagensDia: z.number().int().min(0).max(1000),
  reunioesMes: z.number().int().min(0).max(1000),
  ganhosMes: z.number().int().min(0).max(1000),
});
export type MetasEntrada = z.infer<typeof metasEntrada>;

export const usuarioAtualizar = z
  .object({
    nome: z.string().trim().min(2).max(80).optional(),
    papel: z.enum(PAPEIS_USUARIO).optional(),
    ativo: z.boolean().optional(),
    recebeLeads: z.boolean().optional(),
    alcance: z.enum(ALCANCES).optional(),
    telefone: telefone.optional(),
    metas: metasEntrada.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nada para atualizar.');
export type UsuarioAtualizar = z.infer<typeof usuarioAtualizar>;

export const distribuicaoEntrada = z.object({
  sdr: z.enum(['rodizio', 'manual']),
  closer: z.enum(['rodizio', 'mesmo', 'manual']),
});
export type DistribuicaoEntrada = z.infer<typeof distribuicaoEntrada>;

const senhaForte = z
  .string()
  .min(8, 'A senha precisa de pelo menos 8 caracteres.')
  .max(200)
  .refine((s) => /\d/.test(s) && /\p{L}/u.test(s), 'Use letras e números na senha.');

export const aceitarConvite = z.object({ senha: senhaForte });
export const trocarSenha = z.object({ atual: z.string().min(1, 'Informe a senha atual.'), nova: senhaForte });
export const perfilEntrada = z
  .object({ nome: z.string().trim().min(2).max(80).optional(), telefone: telefone.optional() })
  .refine((v) => Object.keys(v).length > 0, 'Nada para atualizar.');

/* ───────────────────────────── Conversas ───────────────────────────── */

export const TIPOS_MIDIA = ['imagem', 'audio', 'video', 'documento'] as const;
export type TipoMidia = (typeof TIPOS_MIDIA)[number];

/** Até 10 MB de arquivo (em base64 fica ~13,4 MB). */
export const LIMITE_MIDIA_BYTES = 10 * 1024 * 1024;

export const mensagemEntrada = z.object({ texto: z.string().trim().min(1, 'Escreva a mensagem.').max(4000) });

export const midiaEntrada = z.object({
  tipo: z.enum(TIPOS_MIDIA),
  mime: z
    .string()
    .trim()
    .max(120)
    .regex(/^[\w.+-]+\/[\w.+-]+(;.*)?$/, 'Tipo de arquivo inválido.'),
  nome: z.string().trim().max(200).optional(),
  /** Conteúdo em base64 (sem o prefixo data:). */
  base64: z
    .string()
    .min(1)
    .max(Math.ceil((LIMITE_MIDIA_BYTES * 4) / 3) + 8, 'Arquivo grande demais (até 10 MB).'),
  legenda: z.string().trim().max(1000).optional(),
});
export type MidiaEntrada = z.infer<typeof midiaEntrada>;

export const respostaRapidaEntrada = z.object({
  atalho: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(30)
    .regex(/^[\p{L}\d_-]+$/u, 'Atalho sem espaços (ex.: preco, reuniao).'),
  texto: z.string().trim().min(1).max(2000),
});

export const filtrosConversas = z.object({
  filtro: z.enum(['todas', 'nao_lidas', 'minhas']).default('todas'),
  busca: z.string().trim().max(120).optional(),
});

/* ───────────────────────────── Agenda ───────────────────────────── */

export const TIPOS_TAREFA = ['tarefa', 'ligacao', 'reuniao', 'visita'] as const;
export type TipoTarefa = (typeof TIPOS_TAREFA)[number];
export const ROTULO_TAREFA: Record<TipoTarefa, string> = {
  tarefa: 'Tarefa',
  ligacao: 'Ligação',
  reuniao: 'Reunião',
  visita: 'Visita',
};

const instante = z
  .string()
  .datetime({ offset: true })
  .transform((v) => new Date(v).toISOString());

const tarefaCampos = z.object({
  empresaId: z.number().int().positive().nullable().optional(),
  usuarioId: z.number().int().positive().nullable().optional(),
  tipo: z.enum(TIPOS_TAREFA),
  titulo: z.string().trim().min(1, 'Diga o que é.').max(200),
  descricao: z
    .string()
    .trim()
    .max(2000)
    .transform((v) => v || null)
    .optional(),
  inicio: instante,
  fim: instante.nullable().optional(),
  local: z
    .string()
    .trim()
    .max(300)
    .transform((v) => v || null)
    .optional(),
  /** Reunião na sala de vídeo do próprio sistema (o link vira o "local"); null tira a sala. */
  sala: opcoesSala.nullable().optional(),
});

export const tarefaEntrada = tarefaCampos.extend({ tipo: z.enum(TIPOS_TAREFA).default('tarefa') });
export type TarefaEntrada = z.infer<typeof tarefaEntrada>;

/**
 * Atualizar só o que veio (sem valor padrão: marcar uma reunião como feita não pode virar
 * "tarefa").
 */
export const tarefaAtualizar = tarefaCampos
  .partial()
  .extend({ concluida: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, 'Nada para atualizar.');
export type TarefaAtualizar = z.infer<typeof tarefaAtualizar>;

export const filtrosAgenda = z.object({
  de: z.string().datetime({ offset: true }),
  ate: z.string().datetime({ offset: true }),
  /** "eu" (padrão), "todos" ou o id de alguém. */
  usuario: z
    .string()
    .regex(/^(eu|todos|\d+)$/)
    .default('eu'),
});

export const configAgendaEntrada = z.object({
  lembreteLead: z.boolean(),
  lembreteLeadMinutos: z.number().int().min(10).max(2880),
  textoLembreteLead: z.string().trim().min(1).max(1000),
  lembreteUsuarioMinutos: z.number().int().min(5).max(1440),
  lembreteUsuarioWhatsapp: z.boolean(),
  duracaoReuniaoMin: z.number().int().min(5).max(480),
});
export type ConfigAgendaEntrada = z.infer<typeof configAgendaEntrada>;

/* ───────────────────────────── Organização (gestor) ───────────────────────────── */

const cota = z.number().int().min(0).max(10_000_000).nullable();

export const unidadeNova = z.object({
  nome: z.string().trim().min(2, 'Informe o nome da unidade.').max(80),
  /** Leads do mês reservados para a unidade (null = usa o que sobra da organização). */
  cotaLeadsMes: cota.optional(),
});
export type UnidadeNova = z.infer<typeof unidadeNova>;

export const unidadeAtualizar = z
  .object({
    nome: z.string().trim().min(2).max(80).optional(),
    cotaLeadsMes: cota.optional(),
    ativa: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nada para atualizar.');
export type UnidadeAtualizar = z.infer<typeof unidadeAtualizar>;

export const pessoaNova = z.object({
  nome: z.string().trim().min(2, 'Informe o nome.').max(80),
  email: z.string().trim().toLowerCase().email('E-mail inválido.'),
  papel: z.enum(PAPEIS_TODOS),
  unidadeId: z.number().int().positive(),
  telefone: telefone.optional(),
});
export type PessoaNova = z.infer<typeof pessoaNova>;

export const pessoaAtualizar = z
  .object({
    nome: z.string().trim().min(2).max(80).optional(),
    papel: z.enum(PAPEIS_TODOS).optional(),
    unidadeId: z.number().int().positive().optional(),
    ativo: z.boolean().optional(),
    /** Ao desativar ou trocar de unidade: quem fica com os leads abertos (null = sem dono, rodízio). */
    transferirPara: z.number().int().positive().nullish(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nada para atualizar.');
export type PessoaAtualizar = z.infer<typeof pessoaAtualizar>;
