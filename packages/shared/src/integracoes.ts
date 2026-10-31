import { z } from 'zod';
import { CAMPOS_FORMULARIO, campoSugerido } from './instagram.js';

/**
 * API aberta: chaves por conta (com permissões), formulários do site (um endereço que recebe o
 * envio como vier) e avisos (webhooks) do CRM para o sistema do cliente.
 */

/* ───────────────────────────── Chaves ───────────────────────────── */

export const PERMISSOES_API = {
  'leads:criar': {
    nome: 'Criar leads',
    descricao: 'Com deduplicação: telefone, e-mail ou CNPJ que já existe junta no lead em vez de duplicar.',
  },
  'leads:ler': { nome: 'Ler leads', descricao: 'Buscar e listar leads, contatos e histórico.' },
  'leads:mover': {
    nome: 'Mudar etapa e responsável',
    descricao: 'Inclusive marcar ganho (ex.: pedido faturado no ERP) e perdido.',
  },
  atividades: { nome: 'Registrar atividades e notas', descricao: 'Contato feito, nota e próximo passo.' },
  'funil:ler': {
    nome: 'Ler funis, etapas e usuários',
    descricao: 'Para saber os ids das etapas e das pessoas.',
  },
  avisos: { nome: 'Gerenciar avisos (webhooks)', descricao: 'Para o Make/Zapier se inscrever sozinho.' },
} as const;
export type PermissaoApi = keyof typeof PERMISSOES_API;
export const LISTA_PERMISSOES_API = Object.keys(PERMISSOES_API) as PermissaoApi[];

/** Prefixo das chaves (ajuda a achar uma chave vazada num repositório público). */
export const PREFIXO_CHAVE_API = 'pt_live_';

/** Limites por chave e por conta. */
export const LIMITES_API = { porMinuto: 600, porDia: 20_000 } as const;

/** IP (v4 ou v6) ou faixa CIDR. */
export function ipOuFaixaValido(texto: string): boolean {
  const t = texto.trim();
  const [ip, bits, ...resto] = t.split('/');
  if (resto.length || !ip) return false;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    if (v4.slice(1).some((n) => Number(n) > 255)) return false;
    return bits === undefined || (/^\d{1,2}$/.test(bits) && Number(bits) <= 32);
  }
  if (/^[0-9a-f:]+$/i.test(ip) && ip.includes(':'))
    return bits === undefined || (/^\d{1,3}$/.test(bits) && Number(bits) <= 128);
  return false;
}

export const chaveApiEntrada = z.object({
  nome: z.string().trim().min(2, 'Dê um nome para saber quem usa a chave.').max(80),
  permissoes: z
    .array(z.enum(LISTA_PERMISSOES_API as [PermissaoApi, ...PermissaoApi[]]))
    .min(1, 'Escolha ao menos uma permissão.'),
  /** Dias até vencer (null = sem validade). */
  validadeDias: z
    .union([z.literal(30), z.literal(90), z.literal(365)])
    .nullable()
    .default(null),
  ips: z
    .array(z.string().trim().refine(ipOuFaixaValido, 'Endereço IP ou faixa inválida (ex.: 201.17.40.0/24).'))
    .max(20)
    .default([]),
});
export type ChaveApiEntrada = z.infer<typeof chaveApiEntrada>;

/* ───────────────────────────── Avisos (webhooks) ───────────────────────────── */

export const EVENTOS_AVISO = {
  'lead.criado': 'Lead criado',
  'lead.etapa': 'Etapa mudou',
  'lead.responsavel': 'Responsável mudou',
  'lead.ganho': 'Lead ganho',
  'lead.perdido': 'Lead perdido',
  'mensagem.recebida': 'Mensagem recebida',
  'reuniao.marcada': 'Reunião marcada',
  'ligacao.encerrada': 'Ligação encerrada (com o resumo)',
} as const;
export type EventoAviso = keyof typeof EVENTOS_AVISO;
export const LISTA_EVENTOS_AVISO = Object.keys(EVENTOS_AVISO) as EventoAviso[];

/** Esperas entre as tentativas de entrega (min): 1ª na hora, depois 1 min, 5 min, 30 min, 2 h, 6 h e 24 h. */
export const ESPERAS_AVISO_MIN = [1, 5, 30, 120, 360, 1440] as const;
export const MAX_TENTATIVAS_AVISO = ESPERAS_AVISO_MIN.length + 1;
/** Falhando sem nenhum sucesso por este tempo, o aviso é pausado e o administrador é avisado. */
export const DIAS_PARA_PAUSAR_AVISO = 3;
/** Cabeçalho com a assinatura: "t=<segundos>,v1=<hmac sha256 hex de `${t}.${corpo}`>". */
export const CABECALHO_ASSINATURA = 'X-Prospect-Assinatura';

const urlDeAviso = z
  .string()
  .trim()
  .max(500)
  .url('Endereço inválido.')
  .refine((u) => /^https:\/\//i.test(u), 'Use um endereço https://');

export const avisoEntrada = z.object({
  nome: z.string().trim().min(2, 'Dê um nome ao aviso.').max(80),
  url: urlDeAviso,
  eventos: z
    .array(z.enum(LISTA_EVENTOS_AVISO as [EventoAviso, ...EventoAviso[]]))
    .min(1, 'Escolha ao menos um evento.'),
});
export type AvisoEntrada = z.infer<typeof avisoEntrada>;

/* ───────────────────────────── Formulários do site ───────────────────────────── */

/** Para onde cada campo do formulário do site vai (os do anúncio da Meta e mais três). */
export const CAMPOS_FORMULARIO_SITE = {
  ...CAMPOS_FORMULARIO,
  cnpj: 'CNPJ',
  site: 'Site',
  origem: 'Origem (campanha)',
} as const;
export type CampoFormularioSite = keyof typeof CAMPOS_FORMULARIO_SITE;
const LISTA_CAMPOS_SITE = Object.keys(CAMPOS_FORMULARIO_SITE) as CampoFormularioSite[];

export const campoFormularioSite = z.object({
  chave: z.string().max(200),
  rotulo: z.string().max(300),
  campo: z.enum(LISTA_CAMPOS_SITE as [CampoFormularioSite, ...CampoFormularioSite[]]),
  exemplo: z.string().max(120).nullish(),
  /** Chegou no último envio e ninguém conferiu ainda. */
  novo: z.boolean().optional(),
});
export type CampoSite = z.infer<typeof campoFormularioSite>;

export const formularioSiteEntrada = z.object({
  nome: z.string().trim().min(2).max(80),
  ligado: z.boolean().default(true),
  campos: z.array(campoFormularioSite).max(80).default([]),
  etapaId: z.number().int().positive().nullish(),
  responsavelId: z.number().int().positive().nullish(),
  etiquetas: z.array(z.string().trim().min(1).max(30)).max(6).default(['site']),
  boasVindas: z.string().trim().max(900).nullish(),
  avisar: z.boolean().default(true),
  redirecionar: z
    .string()
    .trim()
    .max(500)
    .url('Endereço inválido.')
    .refine((u) => /^https?:\/\//i.test(u), 'Use um endereço http(s)://')
    .nullish(),
});
export type FormularioSiteEntrada = z.infer<typeof formularioSiteEntrada>;

/** Campo-isca: o formulário leva este campo escondido; robô preenche, gente não. */
export const CAMPO_ISCA = 'pt_confirmar';

/** Campos que os construtores de formulário mandam e que não são resposta de ninguém. */
const CHAVES_INTERNAS =
  /^(form_id|form_name|formid|post_id|queried_id|referer_title|_wp\w*|_wpcf7\w*|g-recaptcha-response|cf-turnstile-response|h-captcha-response|action|submit|token|csrf\w*|_token|meta\.\w+)$/i;

export interface CampoRecebido {
  chave: string;
  rotulo: string;
  valor: string;
}

const textoDe = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v) && v.every((x) => x == null || ['string', 'number', 'boolean'].includes(typeof x)))
    return v
      .filter((x) => x != null && String(x).trim())
      .map((x) => String(x).trim())
      .join(', ');
  return null;
};

/** Rótulo legível a partir da chave (form_fields[nome_completo] → "Nome completo"). */
export function rotuloDaChave(chave: string): string {
  const base =
    chave
      .split(/[.[\]]+/)
      .filter(Boolean)
      .pop() ?? chave;
  const t = base.replace(/[_-]+/g, ' ').trim();
  return t ? t[0]!.toUpperCase() + t.slice(1) : chave;
}

/**
 * O envio do formulário vira uma lista de campos (chave, rótulo, valor), qualquer que seja o
 * construtor: JSON solto, formulário HTML, Elementor (fields[x][value] + [title]), RD Station
 * (leads[0]) e Typeform (form_response.answers).
 */
export function achatarEnvio(corpo: unknown): CampoRecebido[] {
  if (!corpo || typeof corpo !== 'object') return [];
  const c = corpo as Record<string, unknown>;

  // Typeform: respostas com a pergunta na definição.
  const fr = c.form_response as Record<string, unknown> | undefined;
  if (fr && Array.isArray(fr.answers)) {
    const defs = new Map<string, string>();
    const def = fr.definition as { fields?: { id: string; ref?: string; title?: string }[] } | undefined;
    for (const f of def?.fields ?? []) defs.set(f.id, f.title ?? f.ref ?? f.id);
    const r: CampoRecebido[] = [];
    for (const a of fr.answers as Record<string, unknown>[]) {
      const field = (a.field ?? {}) as { id?: string; ref?: string };
      const tipo = String(a.type ?? '');
      const bruto =
        tipo === 'choice'
          ? (a.choice as { label?: string } | undefined)?.label
          : tipo === 'choices'
            ? (a.choices as { labels?: string[] } | undefined)?.labels
            : a[tipo];
      const valor = textoDe(bruto);
      if (!valor) continue;
      const chave = field.ref || field.id || tipo;
      r.push({ chave, rotulo: defs.get(field.id ?? '') ?? rotuloDaChave(chave), valor });
    }
    const hidden = fr.hidden as Record<string, unknown> | undefined;
    for (const [k, v] of Object.entries(hidden ?? {})) {
      const valor = textoDe(v);
      if (valor) r.push({ chave: k, rotulo: rotuloDaChave(k), valor });
    }
    return r;
  }

  // RD Station Marketing: { leads: [ { name, email, personal_phone, custom_fields, ... } ] }.
  if (Array.isArray(c.leads) && c.leads[0] && typeof c.leads[0] === 'object') return achatarEnvio(c.leads[0]);

  // Elementor: fields[x] = { id, type, title, value, raw_value }.
  const fields = c.fields as Record<string, unknown> | undefined;
  if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
    const vals = Object.values(fields);
    if (vals.length && vals.every((v) => v && typeof v === 'object' && 'value' in (v as object))) {
      const r: CampoRecebido[] = [];
      for (const [k, v] of Object.entries(fields as Record<string, { title?: string; value?: unknown }>)) {
        const valor = textoDe(v.value);
        if (valor) r.push({ chave: `fields.${k}`, rotulo: v.title?.trim() || rotuloDaChave(k), valor });
      }
      return r;
    }
  }

  // Qualquer outro: achata o objeto (a.b.c), juntando listas simples.
  const r: CampoRecebido[] = [];
  const andar = (v: unknown, chave: string, prof: number) => {
    if (r.length >= 80 || prof > 4) return;
    const t = textoDe(v);
    if (t !== null) {
      if (t && chave && !CHAVES_INTERNAS.test(chave))
        r.push({ chave, rotulo: rotuloDaChave(chave), valor: t });
      return;
    }
    if (Array.isArray(v)) {
      for (const [i, x] of v.entries()) andar(x, `${chave}.${i}`, prof + 1);
    } else if (v && typeof v === 'object')
      for (const [k, x] of Object.entries(v as Record<string, unknown>))
        andar(x, chave ? `${chave}.${k}` : k, prof + 1);
  };
  andar(c, '', 0);
  return r;
}

/** O campo que o sistema sugere para cada campo do formulário do site (pela chave e pelo rótulo). */
export function campoSugeridoSite(chave: string, rotulo: string): CampoFormularioSite {
  const k = `${chave} ${rotulo}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (k.includes(CAMPO_ISCA)) return 'ignorar';
  if (/\butm_|campanha|campaign|\bsource\b|\bmedium\b|gclid|fbclid|traffic/.test(k)) return 'origem';
  if (/cnpj/.test(k)) return 'cnpj';
  if (/\b(site|website|url)\b/.test(k) && !/e-?mail/.test(k)) return 'site';
  if (/sobrenome|last_?name/.test(k)) return 'anotacao';
  if (/\b(nome|name|full_?name|seu nome|first_?name)\b/.test(k) && !/empresa|company/.test(k))
    return 'contato';
  if (/phone|telefone|whats|celular|fone/.test(k)) return 'telefone';
  if (/e-?mail/.test(k)) return 'email';
  if (/empresa|company|razao|organiza|negocio/.test(k)) return 'empresa';
  if (/cidade|city/.test(k)) return 'cidade';
  if (/cargo|job|funcao|position/.test(k)) return 'cargo';
  return campoSugerido('', chave) === 'ignorar' ? 'anotacao' : campoSugerido('', chave);
}

export interface LeadDoEnvio {
  contato: string | null;
  telefone: string | null;
  email: string | null;
  empresa: string | null;
  cidade: string | null;
  cargo: string | null;
  cnpj: string | null;
  site: string | null;
  origem: string | null;
  anotacao: string | null;
}

/** O lead a partir do envio e do mapa de campos (campo que ninguém mapeou: pela sugestão). */
export function leadDoEnvio(recebidos: CampoRecebido[], mapa: readonly CampoSite[]): LeadDoEnvio {
  const r: LeadDoEnvio = {
    contato: null,
    telefone: null,
    email: null,
    empresa: null,
    cidade: null,
    cargo: null,
    cnpj: null,
    site: null,
    origem: null,
    anotacao: null,
  };
  const notas: string[] = [];
  const origens: string[] = [];
  for (const c of recebidos) {
    const m = mapa.find((x) => x.chave === c.chave);
    const campo = m?.campo ?? campoSugeridoSite(c.chave, c.rotulo);
    const rotulo = m?.rotulo || c.rotulo;
    if (campo === 'ignorar') continue;
    if (campo === 'anotacao') notas.push(`${rotulo}: ${c.valor}`);
    else if (campo === 'origem') origens.push(`${rotulo}: ${c.valor}`);
    else if (!r[campo]) r[campo] = c.valor.slice(0, 200);
    else notas.push(`${rotulo}: ${c.valor}`);
  }
  if (origens.length) r.origem = origens.join(' · ').slice(0, 500);
  if (notas.length) r.anotacao = notas.join('\n').slice(0, 2000);
  return r;
}

/** Junta ao mapa os campos que chegaram agora (os novos ficam marcados para alguém conferir). */
export function aprenderCampos(mapa: readonly CampoSite[], recebidos: CampoRecebido[]): CampoSite[] {
  const r = [...mapa];
  for (const c of recebidos) {
    const i = r.findIndex((x) => x.chave === c.chave);
    const exemplo = c.valor.slice(0, 120);
    if (i >= 0) r[i] = { ...r[i]!, exemplo };
    else if (r.length < 80)
      r.push({
        chave: c.chave,
        rotulo: c.rotulo.slice(0, 300),
        campo: campoSugeridoSite(c.chave, c.rotulo),
        exemplo,
        novo: mapa.length > 0,
      });
  }
  return r;
}

/* ───────────────────────────── Entradas da API v1 ───────────────────────────── */

const textoApi = (max: number) => z.string().trim().max(max);

export const leadApiEntrada = z.object({
  empresa: textoApi(160).min(2, 'Informe o nome da empresa (ou da pessoa).'),
  contato: z
    .object({
      nome: textoApi(120).nullish(),
      cargo: textoApi(80).nullish(),
      telefone: textoApi(40).nullish(),
      email: textoApi(160).email('E-mail inválido.').nullish(),
    })
    .nullish(),
  cnpj: textoApi(30).nullish(),
  cidade: textoApi(80).nullish(),
  uf: textoApi(2).nullish(),
  site: textoApi(200).nullish(),
  etapaId: z.number().int().positive().nullish(),
  responsavelId: z.number().int().positive().nullish(),
  etiquetas: z.array(textoApi(30).min(1)).max(6).nullish(),
  valorMensal: z.number().min(0).max(10_000_000).nullish(),
  origem: z.record(z.string().max(60), z.union([z.string().max(300), z.number(), z.boolean()])).nullish(),
  nota: textoApi(2000).nullish(),
  /** Qualquer outro dado (vira nota no lead). */
  campos: z
    .record(z.string().max(80), z.union([z.string().max(500), z.number(), z.boolean(), z.null()]))
    .nullish(),
});
export type LeadApiEntrada = z.infer<typeof leadApiEntrada>;

export const leadApiAtualizar = z
  .object({
    etapaId: z.number().int().positive().optional(),
    responsavelId: z.number().int().positive().nullable().optional(),
    motivo: textoApi(300).optional(),
    valorMensal: z.number().min(0).max(10_000_000).nullable().optional(),
    proximaAcao: textoApi(200).optional(),
    proximaAcaoEm: z.string().datetime({ offset: true }).nullable().optional(),
    etiquetas: z.array(textoApi(30).min(1)).max(12).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nada para atualizar.');
export type LeadApiAtualizar = z.infer<typeof leadApiAtualizar>;

export const atividadeApiEntrada = z.object({
  tipo: z.enum(['whatsapp', 'ligacao', 'email', 'visita', 'reuniao', 'nota']),
  direcao: z.enum(['enviada', 'recebida']).nullish(),
  texto: textoApi(4000).nullish(),
  contato: textoApi(200).nullish(),
  proximaAcao: textoApi(200).nullish(),
  proximaAcaoEm: z.string().datetime({ offset: true }).nullish(),
});
export type AtividadeApiEntrada = z.infer<typeof atividadeApiEntrada>;
