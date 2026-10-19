/**
 * Cliente da API. Tudo passa por /api (mesma origem): em produção o Vercel
 * repassa para o Railway; em desenvolvimento, o proxy do Vite.
 */

export class ErroApi extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensagem: string,
    readonly detalhes?: { campo: string; mensagem: string }[],
  ) {
    super(mensagem);
  }
}

export async function api<T>(caminho: string, opcoes: { metodo?: string; corpo?: unknown } = {}): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(`/api${caminho}`, {
      method: opcoes.metodo ?? 'GET',
      credentials: 'same-origin',
      headers: opcoes.corpo !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: opcoes.corpo !== undefined ? JSON.stringify(opcoes.corpo) : undefined,
    });
  } catch {
    throw new ErroApi(0, 'sem_conexao', 'Sem conexão com o servidor. Confira a internet e tente de novo.');
  }
  if (resposta.status === 204) return undefined as T;
  const dados = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    const erro = dados?.erro;
    throw new ErroApi(
      resposta.status,
      erro?.codigo ?? 'erro',
      erro?.mensagem ?? `Erro ${resposta.status}. Tente de novo.`,
      erro?.detalhes,
    );
  }
  return dados as T;
}

/** Monta a query string ignorando vazios. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

// ---------- Tipos de resposta ----------

export interface Nicho {
  id: number;
  nome: string;
  cnaes: string[];
  termosMaps: string[];
  palavrasPositivas: string[];
  palavrasNegativas: string[];
  cargosAlvo: string[];
  portes: string[];
  idadeMinimaAnos: number;
  ativo: boolean;
  campanhasEmAndamento: number;
}

export interface ProgressoCampanha {
  empresas: number;
  comCnpj: number;
  noMaps: number;
  soMaps: number;
  dentroDoRaio: number;
  semLocalizacao: number;
  comSinalEntrega: number;
  buscasPendentes: number;
  buscasConcluidas: number;
  buscasComErro: number;
  ultimaBusca: string | null;
}

export interface Campanha {
  id: number;
  nome: string;
  nichoId: number;
  nichoNome: string;
  cidades: { cidade: string; uf: string }[];
  raioKm: number;
  metaDiaria: number;
  limiteEnviosDia: number;
  cadencia: 'padrao' | 'curta';
  modo: 'semi' | 'auto';
  maxPorBusca: number;
  status: 'rascunho' | 'ativa' | 'pausada' | 'encerrada';
  iniciadaEm: string | null;
  criadoEm: string;
  progresso: ProgressoCampanha;
}

export interface EmpresaLista {
  id: number;
  nome: string;
  razaoSocial: string | null;
  cnpj: string | null;
  cidade: string;
  uf: string;
  bairro: string | null;
  cnaePrincipal: string | null;
  porte: string | null;
  mapsNota: number | null;
  mapsAvaliacoes: number | null;
  mapsCategoria: string | null;
  mapsSite: string | null;
  mapsTelefone: string | null;
  telefonesReceita: string[];
  sinalEntrega: boolean | null;
  distanciaBaseKm: number | null;
  mapsFechada: boolean | null;
  noMaps: boolean;
  origem: 'cnpj' | 'maps' | 'ambos';
  dentroDoRaio: boolean | null;
  campanhaId: number;
}

export interface Socio {
  nome: string;
  tipo: 'pf' | 'pj' | 'estrangeiro';
  qualificacao: string;
  dataEntrada: string | null;
  faixaEtaria: string | null;
  prioridade: number;
}

export interface EmpresaDetalhe extends EmpresaLista {
  cnpjBasico: string | null;
  situacao: string | null;
  dataAbertura: string | null;
  logradouro: string | null;
  numero: string | null;
  cep: string | null;
  emailReceita: string | null;
  lat: number | null;
  lng: number | null;
  geoFonte: 'maps' | 'ors' | 'manual' | null;
  placeId: string | null;
  mapsNome: string | null;
  mapsEndereco: string | null;
  mapsUrl: string | null;
  sinalEntregaFonte: string | null;
  baseNome: string | null;
  socios: Socio[];
  campanhas: {
    id: number;
    nome: string;
    origem: string;
    dentroDoRaio: boolean | null;
    enriquecimentoSolicitadoEm: string | null;
  }[];
  cruzamento: { tipo: string; similaridade: number | null } | null;
}

export interface Pagina<T> {
  itens: T[];
  total: number;
  pagina: number;
  porPagina: number;
}

export interface Base {
  id: number;
  nome: string;
  endereco: string | null;
  lat: number;
  lng: number;
  ativa: boolean;
}

export interface Importacao {
  id: number;
  mes: string;
  status: 'na_fila' | 'rodando' | 'concluida' | 'erro';
  motivo: string;
  ufs: string[];
  cnaes: string[];
  etapa: string | null;
  linhasLidas: number;
  estabelecimentos: number;
  empresas: number;
  socios: number;
  erro: string | null;
  criadoEm: string;
  concluidoEm: string | null;
}
