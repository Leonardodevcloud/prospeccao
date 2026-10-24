import { z } from 'zod';
import { cnpjValido, normalizarCidade, normalizarNome, normalizarTelefone, soDigitos } from './normalizar.js';

/**
 * Importação de leads que o cliente já tem (Excel, CSV ou PDF), em qualquer formato: cada coluna é
 * reconhecida pelo cabeçalho e pelo conteúdo (a IA confirma), o cliente confere e a linha vira um lead.
 */

export const CAMPOS_IMPORTACAO = [
  'empresa',
  'contato',
  'cargo',
  'telefone',
  'whatsapp',
  'email',
  'cnpj',
  'cidade',
  'uf',
  'endereco',
  'cep',
  'site',
  'instagram',
  'observacao',
  'ignorar',
] as const;
export type CampoImportacao = (typeof CAMPOS_IMPORTACAO)[number];

export const ROTULO_CAMPO_IMPORTACAO: Record<CampoImportacao, string> = {
  empresa: 'Empresa',
  contato: 'Nome do contato',
  cargo: 'Cargo',
  telefone: 'Telefone',
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  cnpj: 'CNPJ',
  cidade: 'Cidade',
  uf: 'UF',
  endereco: 'Endereço',
  cep: 'CEP',
  site: 'Site',
  instagram: 'Instagram',
  observacao: 'Observação',
  ignorar: 'Não importar',
};

/** Campos que podem aparecer em mais de uma coluna (telefone 1, telefone 2…). */
const REPETIVEIS = new Set<CampoImportacao>(['telefone', 'whatsapp', 'email', 'observacao']);

/** Uma escolha por coluna (na ordem das colunas do arquivo). */
export type MapaImportacao = CampoImportacao[];

export const UFS = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
] as const;
const SET_UFS = new Set<string>(UFS);

const NOMES_UF: Record<string, string> = {
  acre: 'AC',
  alagoas: 'AL',
  amapa: 'AP',
  amazonas: 'AM',
  bahia: 'BA',
  ceara: 'CE',
  'distrito federal': 'DF',
  'espirito santo': 'ES',
  goias: 'GO',
  maranhao: 'MA',
  'mato grosso': 'MT',
  'mato grosso do sul': 'MS',
  'minas gerais': 'MG',
  para: 'PA',
  paraiba: 'PB',
  parana: 'PR',
  pernambuco: 'PE',
  piaui: 'PI',
  'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN',
  'rio grande do sul': 'RS',
  rondonia: 'RO',
  roraima: 'RR',
  'santa catarina': 'SC',
  'sao paulo': 'SP',
  sergipe: 'SE',
  tocantins: 'TO',
};

const semAcento = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

/** "BA", "Bahia", "ba " → "BA"; o resto → null. */
export function normalizarUf(v: string | null | undefined): string | null {
  const t = semAcento(v ?? '');
  if (!t) return null;
  if (SET_UFS.has(t.toUpperCase())) return t.toUpperCase();
  return NOMES_UF[t] ?? null;
}

/* ───────────── Reconhecer as colunas ───────────── */

/** Palavras do cabeçalho → campo (a primeira regra que bate vence). */
const CABECALHO: [RegExp, CampoImportacao][] = [
  [/\b(cnpj|cpf ?\/ ?cnpj|cnpj ?\/ ?cpf)\b/, 'cnpj'],
  [/(e-?mail|correio)/, 'email'],
  [/(whats|zap|wpp)/, 'whatsapp'],
  [/(celular|telefone|fone|tel\b|contato tel|movel|numero)/, 'telefone'],
  [/(instagram|insta\b|@)/, 'instagram'],
  [/(site|website|url|pagina|dominio)/, 'site'],
  // "Cidade/UF" é a cidade (a UF sai do próprio texto).
  [/(cidade|municipio|localidade)/, 'cidade'],
  [/\b(uf|estado)\b/, 'uf'],
  [/\bcep\b/, 'cep'],
  [/(endereco|logradouro|rua|bairro)/, 'endereco'],
  [/(cargo|funcao|posicao)/, 'cargo'],
  [
    /(responsavel|contato|pessoa|comprador|socio|proprietario|dono|gerente|nome do contato|falar com)/,
    'contato',
  ],
  [/(empresa|razao|fantasia|loja|cliente|estabelecimento|companhia|organizacao|conta)/, 'empresa'],
  [/^nome( completo)?$/, 'contato'],
  [/(obs|observ|nota|coment|anotac|descricao|segmento|ramo|categoria)/, 'observacao'],
];

export function campoPeloCabecalho(cabecalho: string): CampoImportacao | null {
  const t = semAcento(cabecalho)
    .replace(/[_.:]+/g, ' ')
    .replace(/\s+/g, ' ');
  if (!t) return null;
  for (const [re, campo] of CABECALHO) if (re.test(t)) return campo;
  return null;
}

const RE_EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;
const ehEmail = (v: string) => RE_EMAIL.test(v);
const ehCnpj = (v: string) => {
  const d = soDigitos(v);
  return (d.length === 14 || (d.length >= 12 && /[./-]/.test(v))) && /^[\d./\s-]+$/.test(v.trim());
};
const ehTelefone = (v: string) =>
  /^[+\d\s().\-/,;]{8,40}$/.test(v.trim()) && telefonesDoTexto(v).length > 0 && !ehCnpj(v);
const ehSite = (v: string) => /^(https?:\/\/|www\.)\S+$/i.test(v.trim()) && !/instagram\.com/i.test(v);
const ehInstagram = (v: string) => /instagram\.com\/|^@[\w.]{2,30}$/i.test(v.trim());
const ehCep = (v: string) => /^\d{5}-?\d{3}$/.test(v.trim());
const ehUf = (v: string) => normalizarUf(v) != null && v.trim().length <= 20;
const ehEndereco = (v: string) =>
  /\b(r\.|rua|av\.?|avenida|rod\.?|rodovia|travessa|pra[çc]a|alameda|estrada|quadra|qd\.?|lote)\s/i.test(v);

/** Conteúdo de uma coluna → campo, quando a maioria das células tem a mesma cara. */
function campoPeloConteudo(valores: string[]): CampoImportacao | null {
  const v = valores.map((x) => x.trim()).filter(Boolean);
  if (!v.length) return null;
  const parte = (f: (x: string) => boolean) => v.filter(f).length / v.length;
  if (parte(ehEmail) >= 0.6) return 'email';
  if (parte(ehCnpj) >= 0.6) return 'cnpj';
  if (parte(ehInstagram) >= 0.6) return 'instagram';
  if (parte(ehSite) >= 0.6) return 'site';
  if (parte(ehCep) >= 0.7) return 'cep';
  if (parte(ehTelefone) >= 0.6) return 'telefone';
  if (parte(ehUf) >= 0.8) return 'uf';
  if (parte(ehEndereco) >= 0.5) return 'endereco';
  return null;
}

/** Linha que é cabeçalho: tem palavras de cabeçalho e não tem cara de dado (e-mail, telefone…). */
function pontosDeCabecalho(linha: string[]): number {
  let pontos = 0;
  for (const c of linha) {
    const t = c.trim();
    if (!t) continue;
    if (ehEmail(t) || ehTelefone(t) || ehCnpj(t) || /^\d+$/.test(t)) return 0;
    if (campoPeloCabecalho(t)) pontos++;
  }
  return pontos;
}

/**
 * Onde começam os dados: planilhas de Excel costumam ter título, linhas vazias e só depois o
 * cabeçalho. Devolve o índice do cabeçalho (ou null quando não há) entre as 10 primeiras linhas.
 */
export function acharCabecalho(linhas: string[][]): number | null {
  let melhor: { i: number; p: number } | null = null;
  for (let i = 0; i < Math.min(linhas.length, 10); i++) {
    const p = pontosDeCabecalho(linhas[i] ?? []);
    if (p >= 2 && (!melhor || p > melhor.p)) melhor = { i, p };
  }
  if (melhor) return melhor.i;
  // Uma coluna só com cabeçalho óbvio ("Telefone")
  return pontosDeCabecalho(linhas[0] ?? []) >= 1 ? 0 : null;
}

/** Palpite inicial de cada coluna: o cabeçalho decide; sem cabeçalho (ou sem palavra conhecida), o conteúdo. */
export function detectarCampos(cabecalho: string[] | null, dados: string[][]): MapaImportacao {
  const larg = Math.max(cabecalho?.length ?? 0, ...dados.slice(0, 200).map((l) => l.length));
  const amostra = dados.slice(0, 200);
  const mapa: MapaImportacao = [];
  for (let i = 0; i < larg; i++) {
    const valores = amostra.map((l) => l[i] ?? '');
    const peloConteudo = campoPeloConteudo(valores);
    const peloCabecalho = cabecalho?.[i] ? campoPeloCabecalho(cabecalho[i] as string) : null;
    // Conteúdo forte (e-mail, CNPJ, telefone) corrige cabeçalho genérico ("Contato" com telefones).
    const forte = peloConteudo && ['email', 'cnpj', 'telefone', 'site', 'instagram'].includes(peloConteudo);
    let campo: CampoImportacao | null =
      forte && peloCabecalho !== 'whatsapp' ? peloConteudo : (peloCabecalho ?? peloConteudo);
    if (campo === 'telefone' && peloCabecalho === 'whatsapp') campo = 'whatsapp';
    if (!valores.some((x) => x.trim())) campo = 'ignorar';
    mapa.push(campo ?? 'ignorar');
  }
  // Colunas de texto sem nome conhecido: a primeira vira a empresa (se não houver), a seguinte o contato.
  const temTexto = (i: number) =>
    amostra.filter((l) => /\p{L}{2,}/u.test(l[i] ?? '')).length >= Math.max(1, amostra.length * 0.5);
  for (const alvo of ['empresa', 'contato'] as const) {
    if (mapa.includes(alvo)) continue;
    const i = mapa.findIndex((c, j) => c === 'ignorar' && !cabecalho?.[j]?.trim() && temTexto(j));
    if (i >= 0) mapa[i] = alvo;
  }
  return unicos(mapa);
}

/** Campos que só valem uma vez: a primeira coluna fica, as outras viram observação. */
export function unicos(mapa: MapaImportacao): MapaImportacao {
  const vistos = new Set<CampoImportacao>();
  return mapa.map((c) => {
    if (c === 'ignorar' || REPETIVEIS.has(c)) return c;
    if (vistos.has(c)) return 'observacao';
    vistos.add(c);
    return c;
  });
}

/* ───────────── Linha → lead ───────────── */

export interface TelefoneImportado {
  numero: string;
  /** A coluna dizia WhatsApp. */
  whatsapp: boolean;
}

export interface LeadImportado {
  empresa: string;
  contato: string | null;
  cargo: string | null;
  telefones: TelefoneImportado[];
  emails: string[];
  cnpj: string | null;
  cidade: string | null;
  uf: string | null;
  endereco: string | null;
  cep: string | null;
  site: string | null;
  instagram: string | null;
  observacao: string | null;
  /** O nome da empresa não veio: usamos o do contato. */
  semEmpresa: boolean;
  /** Linhas do arquivo que viraram este lead (1 = primeira linha de dados). */
  linhas: number[];
}

/** Telefones de uma célula ("(71) 99999-1111 / 3333-2222"), já com DDD. */
export function telefonesDoTexto(v: string, dddPadrao?: string | null): string[] {
  const achados = new Set<string>();
  const partes = v.split(/\s*(?:\/|;|,|\||\be\b|\bou\b)\s*/i);
  for (const p of partes) {
    let d = soDigitos(p);
    if (!d) continue;
    // Número sem DDD (8 ou 9 dígitos): usa o DDD do número anterior da célula ou o padrão.
    if ((d.length === 8 || d.length === 9) && (dddPadrao || achados.size)) {
      const ddd = dddPadrao ?? [...achados][0]!.slice(0, 2);
      d = ddd + d;
    }
    const n = normalizarTelefone(d);
    if (n) achados.add(n);
  }
  return [...achados];
}

function emailsDoTexto(v: string): string[] {
  return [...v.matchAll(new RegExp(RE_EMAIL.source, 'g'))]
    .map((m) => m[0].toLowerCase().replace(/[.,;]+$/, ''))
    .filter((e) => !/\.(png|jpe?g|gif|webp)$/.test(e));
}

function cnpjDoTexto(v: string): string | null {
  let d = soDigitos(v);
  // Excel guarda CNPJ como número e perde o zero da frente.
  if (d.length >= 12 && d.length < 14) d = d.padStart(14, '0');
  return d.length === 14 && cnpjValido(d) ? d : null;
}

function instagramDoTexto(v: string): string | null {
  const t = v.trim();
  const m = t.match(/instagram\.com\/([\w.]{2,30})/i) ?? t.match(/^@?([\w.]{2,30})$/);
  const u = m?.[1]?.replace(/\.$/, '').toLowerCase();
  return u && !['p', 'reel', 'explore', 'accounts'].includes(u) ? u : null;
}

function siteDoTexto(v: string): string | null {
  const t = v.trim().split(/\s+/)[0] ?? '';
  if (!/^(https?:\/\/)?(www\.)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(t)) return null;
  if (/instagram\.com|facebook\.com|wa\.me|whatsapp/i.test(t)) return null;
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

/** "Salvador - BA", "Salvador/BA", "Salvador (BA)" → cidade e UF. */
export function separarCidadeUf(v: string): { cidade: string | null; uf: string | null } {
  const t = v.trim();
  const m = t.match(/^(.+?)\s*(?:[-/,]|\()\s*([A-Za-z]{2})\)?$/);
  if (m && normalizarUf(m[2])) return { cidade: m[1]!.trim() || null, uf: normalizarUf(m[2]) };
  return { cidade: t || null, uf: null };
}

const limpar = (v: string | undefined, max = 300) => {
  const t = (v ?? '').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
};

/** Primeira letra maiúscula em nomes que vieram TODOS EM CAIXA ALTA. */
function nomeApresentavel(v: string): string {
  if (v !== v.toUpperCase() || !/\p{L}/u.test(v)) return v;
  const minusculas = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
  return v
    .toLowerCase()
    .split(' ')
    .map((w, i) =>
      i > 0 && minusculas.has(w)
        ? w
        : /^(ltda|me|eireli|epp|s\/a|sa)$/i.test(w)
          ? w.toUpperCase()
          : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(' ');
}

/** Uma linha do arquivo → lead (null quando não tem nome nenhum). */
export function linhaParaLead(
  linha: string[],
  mapa: MapaImportacao,
  padrao: { cidade?: string | null; uf?: string | null } = {},
  numero = 0,
): LeadImportado | null {
  const valores = (campo: CampoImportacao) =>
    mapa.flatMap((c, i) => (c === campo && linha[i]?.trim() ? [linha[i]!.trim()] : []));
  const um = (campo: CampoImportacao) => valores(campo)[0];

  let cidade = limpar(um('cidade'), 80);
  let uf = normalizarUf(um('uf'));
  // Coluna de UF com "Franca/SP": a cidade também vem dela.
  if (!uf && um('uf')) {
    const s = separarCidadeUf(um('uf') ?? '');
    uf = s.uf;
    if (s.uf) cidade ??= s.cidade;
  }
  if (cidade && !uf) {
    const s = separarCidadeUf(cidade);
    cidade = s.cidade;
    uf = s.uf;
  }
  cidade ??= padrao.cidade ?? null;
  uf ??= normalizarUf(padrao.uf);

  const telefones: TelefoneImportado[] = [];
  const add = (n: string, whatsapp: boolean) => {
    const ja = telefones.find((t) => t.numero === n);
    if (ja) ja.whatsapp ||= whatsapp;
    else telefones.push({ numero: n, whatsapp });
  };
  for (const v of valores('whatsapp')) for (const n of telefonesDoTexto(v)) add(n, true);
  for (const v of valores('telefone')) for (const n of telefonesDoTexto(v)) add(n, false);

  const emails = [...new Set([...valores('email'), ...valores('observacao')].flatMap(emailsDoTexto))];
  const cnpj = valores('cnpj').map(cnpjDoTexto).find(Boolean) ?? null;
  const contato = limpar(um('contato'), 120);
  const empresaBruta = limpar(um('empresa'), 160);
  const empresa = empresaBruta ?? contato;
  if (!empresa) return null;

  const observacoes = valores('observacao').filter((v) => !RE_EMAIL.test(v));
  return {
    empresa: nomeApresentavel(empresa),
    contato: contato && contato !== empresa ? nomeApresentavel(contato) : null,
    cargo: limpar(um('cargo'), 80),
    telefones: telefones.slice(0, 5),
    emails: emails.slice(0, 5),
    cnpj,
    cidade: cidade ? nomeApresentavel(cidade) : null,
    uf,
    endereco: limpar(um('endereco'), 200),
    cep: (() => {
      const d = soDigitos(um('cep'));
      return d.length === 8 ? d : null;
    })(),
    site: valores('site').map(siteDoTexto).find(Boolean) ?? null,
    instagram: valores('instagram').map(instagramDoTexto).find(Boolean) ?? null,
    observacao: observacoes.length ? observacoes.join(' · ').slice(0, 500) : null,
    semEmpresa: !empresaBruta,
    linhas: [numero],
  };
}

/** A mesma empresa duas vezes no arquivo (mesmo CNPJ, ou mesmo nome na mesma cidade) vira um lead só. */
export function chaveDoLead(l: LeadImportado): string {
  if (l.cnpj) return `cnpj:${l.cnpj}`;
  return `nome:${normalizarNome(l.empresa)}|${l.cidade ? normalizarCidade(l.cidade) : ''}|${l.uf ?? ''}`;
}

function juntar(a: LeadImportado, b: LeadImportado): LeadImportado {
  const tel = [...a.telefones];
  for (const t of b.telefones) if (!tel.some((x) => x.numero === t.numero)) tel.push(t);
  return {
    ...a,
    contato: a.contato ?? b.contato,
    cargo: a.cargo ?? b.cargo,
    telefones: tel.slice(0, 8),
    emails: [...new Set([...a.emails, ...b.emails])].slice(0, 8),
    cnpj: a.cnpj ?? b.cnpj,
    endereco: a.endereco ?? b.endereco,
    cep: a.cep ?? b.cep,
    site: a.site ?? b.site,
    instagram: a.instagram ?? b.instagram,
    observacao: [a.observacao, b.observacao].filter(Boolean).join(' · ').slice(0, 500) || null,
    linhas: [...a.linhas, ...b.linhas],
  };
}

export interface ResultadoLeitura {
  leads: LeadImportado[];
  /** Linhas sem nome nenhum (nem empresa nem contato). */
  semNome: number[];
  /** Linhas repetidas que foram juntadas com outra. */
  repetidas: number;
  /** Leads sem telefone, e-mail, site, Instagram nem CNPJ (só dá para enriquecer). */
  semContato: number;
  /** Leads sem cidade (só entram com a cidade padrão). */
  semCidade: number;
}

/** Todas as linhas → leads, juntando as repetidas. */
export function lerLeads(
  dados: string[][],
  mapa: MapaImportacao,
  padrao: { cidade?: string | null; uf?: string | null } = {},
): ResultadoLeitura {
  const porChave = new Map<string, LeadImportado>();
  const semNome: number[] = [];
  let repetidas = 0;
  dados.forEach((linha, i) => {
    const l = linhaParaLead(linha, mapa, padrao, i + 1);
    if (!l) {
      if (linha.some((c) => c.trim())) semNome.push(i + 1);
      return;
    }
    const k = chaveDoLead(l);
    const ja = porChave.get(k);
    if (ja) {
      porChave.set(k, juntar(ja, l));
      repetidas++;
    } else porChave.set(k, l);
  });
  const leads = [...porChave.values()];
  const semContato = leads.filter(
    (l) => !l.telefones.length && !l.emails.length && !l.site && !l.instagram && !l.cnpj,
  ).length;
  return { leads, semNome, repetidas, semContato, semCidade: leads.filter((l) => !l.cidade || !l.uf).length };
}

/* ───────────── Entradas da API ───────────── */

const ATE_15MB = Math.ceil((15 * 1024 * 1024 * 4) / 3) + 8;

export const arquivoImportacaoEntrada = z.object({
  nome: z.string().trim().min(1).max(200),
  mime: z.string().trim().max(160).default(''),
  base64: z.string().min(1).max(ATE_15MB, 'Arquivo grande demais (até 15 MB).'),
});

export const mapaImportacaoEntrada = z.object({
  mapa: z.array(z.enum(CAMPOS_IMPORTACAO)).min(1).max(80),
  /** Linha do cabeçalho (null = o arquivo não tem cabeçalho). */
  cabecalho: z.number().int().min(0).max(50).nullable().optional(),
  cidadePadrao: z.string().trim().max(80).nullable().optional(),
  ufPadrao: z.string().trim().max(20).nullable().optional(),
});

export const confirmarImportacaoEntrada = mapaImportacaoEntrada.extend({
  /** Lista nova (nome e nicho) ou uma campanha que já existe. */
  destino: z.union([
    z.object({ campanhaId: z.number().int().positive() }),
    z.object({
      nova: z.object({ nome: z.string().trim().min(2).max(120), nichoId: z.number().int().positive() }),
    }),
  ]),
  /** Busca site, Instagram, CNPJ, sócios e confere o WhatsApp (consome créditos). */
  enriquecer: z.boolean().default(false),
  /** Põe no funil (SDR): pelo rodízio da equipe ou com uma pessoa escolhida. */
  funil: z
    .object({ responsavelId: z.number().int().positive().nullable().default(null) })
    .nullable()
    .default(null),
});
export type ConfirmarImportacao = z.infer<typeof confirmarImportacaoEntrada>;
