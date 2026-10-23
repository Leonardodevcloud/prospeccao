import { cnpjValido, normalizarCidade, normalizarTelefone, soDigitos } from '@prospeccao/shared';
import { requisitarJson } from '../http.js';

/**
 * CNPJ de quem veio só do Google Maps: os números que aparecem no rodapé do site, na bio do
 * Instagram e nos trechos do Google (diretórios como cnpj.biz e Casa dos Dados) são conferidos na
 * Receita (BrasilAPI, gratuita) e só valem se forem da mesma cidade e tiverem o nome ou o
 * telefone da loja. Com o CNPJ confirmado vêm a razão social, o porte, a abertura e os sócios.
 */

export interface SocioCnpj {
  nome: string;
  qualificacao: string | null;
  tipo: 'pf' | 'pj' | 'estrangeiro';
  desde: string | null;
}

export interface DadosCnpj {
  cnpj: string;
  razaoSocial: string | null;
  nomeFantasia: string | null;
  /** 7 dígitos. */
  cnaePrincipal: string | null;
  porte: 'me' | 'epp' | 'demais' | 'nao_informado';
  /** "02" = ativa (como a Receita grava). */
  situacao: string | null;
  dataAbertura: string | null;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  cep: string | null;
  cidade: string | null;
  uf: string | null;
  telefones: string[];
  email: string | null;
  mei: boolean;
  socios: SocioCnpj[];
}

const CNPJ_NO_TEXTO = /\b\d{2}\.?\d{3}\.?\d{3}\s?\/?\s?\d{4}\s?-?\s?\d{2}\b/g;

/** CNPJs válidos citados num texto, sem repetir, na ordem em que aparecem. */
export function cnpjsNoTexto(texto: string): string[] {
  const achados: string[] = [];
  for (const m of texto.matchAll(CNPJ_NO_TEXTO)) {
    const d = soDigitos(m[0]);
    if (cnpjValido(d) && !achados.includes(d)) achados.push(d);
  }
  return achados;
}

const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

const PORTE_BRASILAPI: Record<string, DadosCnpj['porte']> = {
  '1': 'me',
  '01': 'me',
  '3': 'epp',
  '03': 'epp',
  '5': 'demais',
  '05': 'demais',
};

function porteDoTexto(codigo: unknown, descricao: unknown): DadosCnpj['porte'] {
  const c = codigo == null ? '' : String(codigo);
  if (PORTE_BRASILAPI[c]) return PORTE_BRASILAPI[c];
  const d = (texto(descricao) ?? '').toUpperCase();
  if (d.includes('MICRO')) return 'me';
  if (d.includes('PEQUENO')) return 'epp';
  if (d.includes('DEMAIS')) return 'demais';
  return 'nao_informado';
}

/** Resposta da BrasilAPI (/api/cnpj/v1/{cnpj}) no formato do sistema. Campo faltando não quebra. */
export function converterBrasilApi(bruto: unknown): DadosCnpj | null {
  const r = (bruto ?? {}) as Record<string, unknown>;
  const cnpj = soDigitos(String(r.cnpj ?? ''));
  if (!cnpjValido(cnpj)) return null;
  const telefones = [r.ddd_telefone_1, r.ddd_telefone_2]
    .map((t) => normalizarTelefone(texto(t)))
    .filter((t): t is string => !!t);
  const qsa = Array.isArray(r.qsa) ? (r.qsa as Record<string, unknown>[]) : [];
  const situacao = r.situacao_cadastral == null ? null : String(r.situacao_cadastral).padStart(2, '0');
  const cnae = r.cnae_fiscal == null ? null : soDigitos(String(r.cnae_fiscal)).padStart(7, '0');
  return {
    cnpj,
    razaoSocial: texto(r.razao_social),
    nomeFantasia: texto(r.nome_fantasia),
    cnaePrincipal: cnae && cnae.length === 7 ? cnae : null,
    porte: porteDoTexto(r.codigo_porte, r.porte ?? r.descricao_porte),
    situacao,
    dataAbertura: texto(r.data_inicio_atividade),
    logradouro:
      [texto(r.descricao_tipo_de_logradouro), texto(r.logradouro)].filter(Boolean).join(' ') || null,
    numero: texto(r.numero),
    bairro: texto(r.bairro),
    cep: (() => {
      const c = soDigitos(String(r.cep ?? ''));
      return c.length === 8 ? c : null;
    })(),
    cidade: texto(r.municipio),
    uf: texto(r.uf)?.toUpperCase() ?? null,
    telefones: [...new Set(telefones)],
    email: texto(r.email)?.toLowerCase() ?? null,
    mei: r.opcao_pelo_mei === true,
    socios: qsa
      .map((s) => ({
        nome: texto(s.nome_socio) ?? '',
        qualificacao: texto(s.qualificacao_socio),
        tipo: (String(s.identificador_de_socio ?? '2') === '1'
          ? 'pj'
          : String(s.identificador_de_socio) === '3'
            ? 'estrangeiro'
            : 'pf') as SocioCnpj['tipo'],
        desde: texto(s.data_entrada_sociedade),
      }))
      .filter((s) => s.nome),
  };
}

/** Resposta do CNPJ.ws público (publica.cnpj.ws/cnpj/{cnpj}) no formato do sistema. */
export function converterCnpjWs(bruto: unknown): DadosCnpj | null {
  const r = (bruto ?? {}) as Record<string, unknown>;
  const e = (r.estabelecimento ?? {}) as Record<string, unknown>;
  const cnpj = soDigitos(String(e.cnpj ?? ''));
  if (!cnpjValido(cnpj)) return null;
  const sub = (o: unknown, k: string) => texto((o as Record<string, unknown> | null)?.[k]);
  const telefones = [
    [e.ddd1, e.telefone1],
    [e.ddd2, e.telefone2],
  ]
    .map(([d, t]) => normalizarTelefone(`${d ?? ''}${t ?? ''}`))
    .filter((t): t is string => !!t);
  const situacao = (texto(e.situacao_cadastral) ?? '').toUpperCase();
  const cnae = soDigitos(String(sub(e.atividade_principal, 'id') ?? ''));
  const socios = Array.isArray(r.socios) ? (r.socios as Record<string, unknown>[]) : [];
  return {
    cnpj,
    razaoSocial: texto(r.razao_social),
    nomeFantasia: texto(e.nome_fantasia),
    cnaePrincipal: cnae.length === 7 ? cnae : null,
    porte: porteDoTexto(sub(r.porte, 'id'), sub(r.porte, 'descricao')),
    situacao: situacao ? (situacao === 'ATIVA' ? '02' : '08') : null,
    dataAbertura: texto(e.data_inicio_atividade),
    logradouro: [texto(e.tipo_logradouro), texto(e.logradouro)].filter(Boolean).join(' ') || null,
    numero: texto(e.numero),
    bairro: texto(e.bairro),
    cep: (() => {
      const c = soDigitos(String(e.cep ?? ''));
      return c.length === 8 ? c : null;
    })(),
    cidade: sub(e.cidade, 'nome'),
    uf: sub(e.estado, 'sigla')?.toUpperCase() ?? null,
    telefones: [...new Set(telefones)],
    email: texto(e.email)?.toLowerCase() ?? null,
    mei: /sim/i.test(sub(r.simples, 'mei') ?? ''),
    socios: socios
      .map((x) => ({
        nome: texto(x.nome) ?? '',
        qualificacao: sub(x.qualificacao_socio, 'descricao'),
        tipo: (/jur[ií]dica/i.test(String(x.tipo ?? ''))
          ? 'pj'
          : /estrangeir/i.test(String(x.tipo ?? ''))
            ? 'estrangeiro'
            : 'pf') as SocioCnpj['tipo'],
        desde: texto(x.data_entrada),
      }))
      .filter((x) => x.nome),
  };
}

/** Resposta da ReceitaWS (receitaws.com.br/v1/cnpj/{cnpj}) no formato do sistema. */
export function converterReceitaWs(bruto: unknown): DadosCnpj | null {
  const r = (bruto ?? {}) as Record<string, unknown>;
  if (String(r.status ?? '').toUpperCase() === 'ERROR') return null;
  const cnpj = soDigitos(String(r.cnpj ?? ''));
  if (!cnpjValido(cnpj)) return null;
  const abertura = texto(r.abertura)?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const principal = Array.isArray(r.atividade_principal)
    ? (r.atividade_principal[0] as Record<string, unknown> | undefined)
    : undefined;
  const cnae = soDigitos(String(principal?.code ?? ''));
  const telefones = (texto(r.telefone) ?? '')
    .split('/')
    .map((t) => normalizarTelefone(t))
    .filter((t): t is string => !!t);
  const qsa = Array.isArray(r.qsa) ? (r.qsa as Record<string, unknown>[]) : [];
  return {
    cnpj,
    razaoSocial: texto(r.nome),
    nomeFantasia: texto(r.fantasia),
    cnaePrincipal: cnae.length === 7 ? cnae : null,
    porte: porteDoTexto(null, r.porte),
    situacao: texto(r.situacao) ? (/ATIVA/i.test(String(r.situacao)) ? '02' : '08') : null,
    dataAbertura: abertura ? `${abertura[3]}-${abertura[2]}-${abertura[1]}` : null,
    logradouro: texto(r.logradouro),
    numero: texto(r.numero),
    bairro: texto(r.bairro),
    cep: (() => {
      const c = soDigitos(String(r.cep ?? ''));
      return c.length === 8 ? c : null;
    })(),
    cidade: texto(r.municipio),
    uf: texto(r.uf)?.toUpperCase() ?? null,
    telefones: [...new Set(telefones)],
    email: texto(r.email)?.toLowerCase() ?? null,
    mei: (r.simei as { optante?: boolean } | undefined)?.optante === true,
    socios: qsa
      .map((x) => ({
        nome: texto(x.nome) ?? '',
        qualificacao: texto(x.qual)?.replace(/^\d+-/, '') ?? null,
        tipo: 'pf' as const,
        desde: null,
      }))
      .filter((x) => x.nome),
  };
}

/** Os servidores públicos recusam pedido sem identificação (firewall contra robôs). */
const CABECALHOS = { 'user-agent': 'ProspectTeam/1.0 (+https://prospectteam.com.br)' };

const status = (erro: unknown) => (erro as { detalhes?: { status?: number } }).detalhes?.status;

/** Consulta o CNPJ na BrasilAPI (dados públicos da Receita). null: não existe. */
export async function consultarCnpjBrasilApi(cnpj: string, timeoutMs = 15_000): Promise<DadosCnpj | null> {
  try {
    const bruto = await requisitarJson<unknown>(`https://brasilapi.com.br/api/cnpj/v1/${soDigitos(cnpj)}`, {
      servico: 'BrasilAPI',
      headers: CABECALHOS,
      timeoutMs,
    });
    return converterBrasilApi(bruto);
  } catch (erro) {
    if (status(erro) === 404) return null;
    throw erro;
  }
}

/** Fontes públicas e gratuitas, na ordem: a primeira que responder vale. */
const FONTES_PUBLICAS: {
  nome: string;
  url: (cnpj: string) => string;
  converter: (bruto: unknown) => DadosCnpj | null;
}[] = [
  {
    nome: 'BrasilAPI',
    url: (c) => `https://brasilapi.com.br/api/cnpj/v1/${c}`,
    converter: converterBrasilApi,
  },
  { nome: 'CNPJ.ws', url: (c) => `https://publica.cnpj.ws/cnpj/${c}`, converter: converterCnpjWs },
  { nome: 'ReceitaWS', url: (c) => `https://receitaws.com.br/v1/cnpj/${c}`, converter: converterReceitaWs },
];

/** Erro de consulta pública em português curto (sem o JSON do servidor). */
export class ConsultaCnpjIndisponivel extends Error {
  constructor(public readonly falhas: string[]) {
    super(`Consulta pública da Receita indisponível agora (${falhas.join('; ')}).`);
  }
}

const motivoCurto = (erro: unknown) => {
  const s = status(erro);
  if (s === 403) return 'recusou o pedido';
  if (s === 429) return 'limite de consultas por minuto';
  if (s && s >= 500) return 'fora do ar';
  return 'sem resposta';
};

/**
 * Consulta o CNPJ nas fontes públicas da Receita (BrasilAPI, depois CNPJ.ws, depois ReceitaWS):
 * se uma recusar ou estiver fora, tenta a próxima. null: o CNPJ não existe. Todas falhando, lança
 * ConsultaCnpjIndisponivel com o motivo curto de cada uma.
 */
export async function consultarCnpjPublico(cnpj: string, timeoutMs = 15_000): Promise<DadosCnpj | null> {
  const c = soDigitos(cnpj);
  const falhas: string[] = [];
  for (const f of FONTES_PUBLICAS) {
    try {
      const bruto = await requisitarJson<unknown>(f.url(c), {
        servico: f.nome,
        headers: CABECALHOS,
        timeoutMs,
      });
      const dados = f.converter(bruto);
      if (dados) return dados;
      falhas.push(`${f.nome}: resposta sem os dados`);
    } catch (erro) {
      if (status(erro) === 404) return null;
      falhas.push(`${f.nome}: ${motivoCurto(erro)}`);
    }
  }
  throw new ConsultaCnpjIndisponivel(falhas);
}

const PALAVRAS_GENERICAS = new Set([
  'ltda',
  'me',
  'epp',
  'eireli',
  'comercio',
  'servicos',
  'restaurante',
  'bar',
  'loja',
  'de',
  'do',
  'da',
  'dos',
  'das',
  'e',
  'the',
  'and',
]);

const palavras = (t: string | null | undefined) =>
  (t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 3 && !PALAVRAS_GENERICAS.has(p));

/**
 * O CNPJ é desta loja? Tem de ser da mesma cidade e ter o nome (uma palavra própria em comum
 * com o nome fantasia ou a razão social) ou um telefone em comum.
 */
export function cnpjConfere(
  d: DadosCnpj,
  loja: { nome: string; cidade: string; uf: string; telefones: (string | null | undefined)[] },
): { ok: boolean; motivo: string } {
  if (d.uf && d.uf !== loja.uf.toUpperCase()) return { ok: false, motivo: `é de ${d.uf}` };
  if (d.cidade && normalizarCidade(d.cidade) !== normalizarCidade(loja.cidade))
    return { ok: false, motivo: `é de ${d.cidade}` };
  const tels = new Set(loja.telefones.map((t) => normalizarTelefone(t)).filter(Boolean));
  if (d.telefones.some((t) => tels.has(t))) return { ok: true, motivo: 'mesmo telefone' };
  const daLoja = new Set(palavras(loja.nome));
  const doCnpj = [...palavras(d.nomeFantasia), ...palavras(d.razaoSocial)];
  const comum = doCnpj.find((p) => daLoja.has(p));
  return comum ? { ok: true, motivo: `nome confere ("${comum}")` } : { ok: false, motivo: 'nome diferente' };
}
