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
  excluirMei: boolean;
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
  /** Leads nunca trabalhados (nem no funil, nem descartados). */
  novos: number;
  noFunil: number;
  descartados: number;
  /** MEI ignorados (não contratam o serviço). */
  mei: number;
  /** Pedidos de enriquecimento desta campanha ainda na fila ou rodando. */
  naFilaEnriquecimento: number;
}

export interface Campanha {
  id: number;
  nome: string;
  nichoId: number;
  nichoNome: string;
  cidades: { cidade: string; uf: string }[];
  /** null = nacional. */
  raioKm: number | null;
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
  /** Microempreendedor individual (pelo Simples ou pela razão social com CPF). */
  mei: boolean;
  origem: 'cnpj' | 'maps' | 'ambos';
  dentroDoRaio: boolean | null;
  campanhaId: number;
  /** Enriquecimento: null enquanto não rodou. */
  enriqStatus: 'na_fila' | 'rodando' | 'concluido' | 'erro' | null;
  faixa: 'A' | 'B' | 'C' | null;
  score: number | null;
  motivo: string | null;
  decisorNome: string | null;
  decisorCargo: string | null;
  contatoCanal: CanalContato | null;
  contatoValor: string | null;
  contatoStatus: StatusContato | null;
  /** Etapa no funil comercial; null = nunca trabalhado. */
  funilEtapa: EtapaFunil | null;
  funilProximaAcaoEm: string | null;
}

export type EtapaFunil =
  | 'a_abordar'
  | 'abordado'
  | 'respondeu'
  | 'reuniao'
  | 'proposta'
  | 'ganho'
  | 'perdido'
  | 'descartado';

export const COLUNAS_FUNIL: EtapaFunil[] = [
  'a_abordar',
  'abordado',
  'respondeu',
  'reuniao',
  'proposta',
  'ganho',
  'perdido',
];

export const ROTULO_ETAPA: Record<EtapaFunil, string> = {
  a_abordar: 'A abordar',
  abordado: 'Abordado',
  respondeu: 'Respondeu',
  reuniao: 'Reunião',
  proposta: 'Proposta',
  ganho: 'Ganho',
  perdido: 'Perdido',
  descartado: 'Descartado',
};

export type TipoAtividade = 'whatsapp' | 'ligacao' | 'email' | 'visita' | 'reuniao' | 'nota' | 'etapa';

export interface AtividadeFunil {
  id: number;
  tipo: TipoAtividade;
  direcao: 'enviada' | 'recebida' | null;
  texto: string | null;
  contato: string | null;
  deEtapa: EtapaFunil | null;
  paraEtapa: EtapaFunil | null;
  autor: string | null;
  em: string;
}

export interface Duplicada {
  empresaId: number;
  nome: string;
  outraEmpresaId: number;
  outraNome: string;
  outraEtapa: EtapaFunil;
  telefone: string;
}

export interface DetalheFunil {
  oportunidade: {
    etapa: EtapaFunil;
    motivo: string | null;
    valorMensal: number | null;
    proximaAcao: string | null;
    proximaAcaoEm: string | null;
    ultimoContatoEm: string | null;
    etapaDesde: string;
    criadoEm: string;
    faixaEntrada: 'A' | 'B' | 'C' | null;
    campanhaId: number | null;
    pendente: boolean | null;
  } | null;
  atividades: AtividadeFunil[];
  duplicada: Duplicada | null;
}

export interface CardFunil {
  empresaId: number;
  etapa: EtapaFunil;
  posicao: number;
  proximaAcao: string | null;
  proximaAcaoEm: string | null;
  pendente: boolean | null;
  ultimoContatoEm: string | null;
  etapaDesde: string;
  valorMensal: number | null;
  motivo: string | null;
  nome: string;
  cidade: string;
  uf: string;
  categoria: string | null;
  faixa: 'A' | 'B' | 'C' | null;
  score: number | null;
  decisorNome: string | null;
  decisorCargo: string | null;
  contatoCanal: CanalContato | null;
  contatoValor: string | null;
  contatoStatus: StatusContato | null;
  telefone: string | null;
  contatos: number;
}

export interface Quadro {
  cards: CardFunil[];
  pendentes: number;
  descartados: number;
}

export interface ResultadoAdicionar {
  adicionadas: number;
  jaNoFunil: number;
  naoEncontradas: number;
  duplicadas: Duplicada[];
}

export interface Relatorio {
  kpis: {
    encontrados: number;
    enriquecidos: number;
    faixaA: number;
    faixaB: number;
    faixaC: number;
    comDecisor: number;
    comWhatsapp: number;
    entraramNoFunil: number;
    abordados: number;
    responderam: number;
    reunioes: number;
    ganhos: number;
    perdidos: number;
    contatos: number;
    valorGanho: number;
    followupsAtrasados: number;
    semProximoPasso: number;
  };
  funil: Record<
    'a_abordar' | 'abordado' | 'respondeu' | 'reuniao' | 'proposta' | 'ganho' | 'perdido',
    number
  >;
  campanhas: {
    id: number;
    nome: string;
    status: string;
    encontrados: number;
    faixaA: number;
    faixaB: number;
    faixaC: number;
    comDecisor: number;
    novos: number;
    descartados: number;
    noFunil: number;
    abordados: number;
    responderam: number;
    ganhos: number;
  }[];
  faixas: {
    faixa: 'A' | 'B' | 'C' | 'sem_nota';
    noFunil: number;
    abordados: number;
    responderam: number;
    reunioes: number;
    ganhos: number;
    perdidos: number;
  }[];
  decisores: {
    faixa: 'A' | 'B' | 'C';
    total: number;
    receita: number;
    linkedin: number;
    outras: number;
    semDecisor: number;
    comWhatsapp: number;
  }[];
  motivos: { etapa: 'perdido' | 'descartado'; motivo: string; quantidade: number }[];
  diario: { dia: string; contatos: number; respostas: number; novosNoFunil: number }[];
}

export type CanalContato = 'whatsapp' | 'telefone' | 'email' | 'instagram' | 'linkedin' | 'site' | 'facebook';
export type StatusContato = 'verificado' | 'nao_verificado' | 'atencao' | 'invalido';
export type FonteEnriq =
  | 'receita'
  | 'maps'
  | 'site'
  | 'instagram'
  | 'linkedin'
  | 'google'
  | 'ia'
  | 'places'
  | 'manual';

export interface PessoaEnriq {
  id: number;
  nome: string;
  cargo: string | null;
  papel: 'socio' | 'compras' | 'gestao' | 'outro';
  decisor: boolean;
  prioridade: number;
  desde: string | null;
  linkedin: string | null;
  fontes: FonteEnriq[];
  /** Trecho do site/bio que mostra a pessoa com o cargo. */
  evidencia?: string | null;
}

export interface ContatoEnriq {
  id: number;
  pessoaId: number | null;
  canal: CanalContato;
  valor: string;
  rotulo: string | null;
  fonte: FonteEnriq;
  fontes: FonteEnriq[];
  urlOrigem: string | null;
  confianca: number;
  status: StatusContato;
  whatsapp: boolean | null;
  principal: boolean;
}

export interface EtapaEnriq {
  etapa: 'receita' | 'maps' | 'site' | 'instagram' | 'ia' | 'linkedin' | 'places' | 'whatsapp';
  status: 'encontrado' | 'sem_resultado' | 'pulada' | 'erro';
  detalhe: string | null;
  url: string | null;
  em: string;
}

export interface Enriquecimento {
  status: 'na_fila' | 'rodando' | 'concluido' | 'erro';
  faixa: 'A' | 'B' | 'C' | null;
  score: number | null;
  motivo: string | null;
  resumo: string | null;
  entrega: boolean | null;
  cnpjAchado: string | null;
  site: string | null;
  instagram: string | null;
  facebook: string | null;
  linkedinEmpresa: string | null;
  mapsAberto: boolean | null;
  erro: string | null;
  solicitadoEm: string;
  iniciadoEm: string | null;
  concluidoEm: string | null;
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
    adicionadaEm: string;
  }[];
  cruzamento: { tipo: string; similaridade: number | null } | null;
  enriquecimento: Enriquecimento | null;
  pessoas: PessoaEnriq[];
  contatos: ContatoEnriq[];
  etapas: EtapaEnriq[];
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
  /** Arquivos da Receita já processados (de 33); a importação retoma a partir deles. */
  arquivosProntos?: number;
  estabelecimentos: number;
  empresas: number;
  socios: number;
  erro: string | null;
  criadoEm: string;
  concluidoEm: string | null;
}

export interface BuscaAtividade {
  id: number;
  campanhaId: number;
  campanha: string | null;
  cidade: string;
  uf: string;
  termo: string;
  status: 'pendente' | 'rodando' | 'concluida' | 'erro';
  itens: number | null;
  erro: string | null;
  verificacoes: number;
  criadoEm: string;
  iniciadoEm: string | null;
  concluidoEm: string | null;
}

export interface Atividade {
  agora: string;
  importacao: (Importacao & { iniciadoEm: string | null }) | null;
  importacaoAgendada: {
    estado: 'na_fila' | 'rodando' | 'nova_tentativa';
    falhas: number;
    limiteTentativas: number;
    quando: string;
    criadoEm: string;
  } | null;
  buscas: BuscaAtividade[];
  buscasEmAndamento: number;
  filas: Record<string, number>;
}
