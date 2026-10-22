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
  /** Leads da campanha já enriquecidos / que podem ser (sem MEI e descartados). */
  enriquecidos: number;
  elegiveis: number;
  /** Estado do worker-enriquecimento pelo sinal de vida que ele grava. */
  servicoEnriquecimento: 'rodando' | 'pausado' | 'fora' | 'desconhecido';
  /** Estados da campanha que a Base CNPJ ainda não tem. */
  ufsForaDaBase: string[];
  /** Último erro das buscas no Maps (recente). */
  erroBusca: string | null;
  /** Buscas pendentes/rodando sem tarefa na fila (não andam sozinhas). */
  buscasParadas?: number;
  /** Buscas paradas no teto de gasto (da campanha ou do mês). */
  buscasBloqueadas?: number;
  /** Buscas por bairro (a cidade inteira encheu os 60 lugares do Google). */
  buscasPorBairro?: number;
  /** Pedidos feitos ao Google Places por esta campanha (cada página conta), pagos e gasto. */
  pedidosPlaces?: number;
  pagosPlaces?: number;
  gastoPlacesUsd?: number;
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
  /** Teto de gasto no Google em buscas pagas. null = sem teto; 0 = só a franquia grátis. */
  tetoPlacesUsd?: number | null;
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
  /** Nome da etapa no pipeline (várias etapas podem ter o mesmo papel). */
  deNome?: string | null;
  paraNome?: string | null;
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
    /** Mensagens enviadas sem resposta nesta etapa. */
    tentativas: number;
    /** Última tentativa feita: vai para "Perdido" nesta data se não responder. */
    encerrarEm: string | null;
    agente?: boolean;
    agentePausa?: string | null;
    etapaId?: number | null;
    etapaNome?: string | null;
    etapaCor?: string | null;
    pipelineNome?: string | null;
    etiquetas?: string[];
    responsavelId?: number | null;
    responsavelNome?: string | null;
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
  tentativas: number;
  encerrarEm: string | null;
  /** A IA conduz a conversa com este lead. */
  agente?: boolean;
  /** Por que a IA passou o lead para você (null = está com a IA). */
  agentePausa?: string | null;
  etapaId: number | null;
  etiquetas: string[];
  criadoEm: string;
  /** Última mensagem do lead e quando chegou. */
  ultimaDoLead: string | null;
  ultimaDoLeadEm: string | null;
  responsavelId: number | null;
  responsavelNome: string | null;
  /** Mensagens do lead ainda não lidas na caixa de entrada. */
  naoLidas: number;
  /** Próxima reunião/visita marcada na agenda. */
  reuniaoEm: string | null;
  /** Radar: negócio parado (crítico ou em risco) e por quê. */
  risco?: { nivel: 'critico' | 'risco'; motivo: string } | null;
  /** Conversa seguindo com uma pessoa indicada ("Carlos Lima · Compras"). */
  falandoCom: string | null;
  /** Pessoas na negociação (indicações confirmadas). */
  contatosNegociacao: number;
  /** Indicações vistas nas mensagens, esperando confirmação. */
  indicacoesNovas: number;
}

export interface Quadro {
  cards: CardFunil[];
  pendentes: number;
  descartados: number;
  /** Mensagens que a cadência manda antes de desistir. */
  totalTentativas: number;
  pipelineId: number | null;
  /** Todas as etiquetas em uso (para sugerir e filtrar). */
  etiquetas: string[];
}

/** Comportamento da etapa no sistema (cadência, IA e relatórios usam isto). */
export type PapelEtapa = Exclude<EtapaFunil, 'descartado'>;
export const ROTULO_PAPEL: Record<PapelEtapa, string> = {
  a_abordar: 'Primeiro contato',
  abordado: 'Aguardando resposta',
  respondeu: 'Conversa em andamento',
  reuniao: 'Reunião',
  proposta: 'Proposta',
  ganho: 'Ganho',
  perdido: 'Perdido',
};

export interface EtapaPipeline {
  id: number;
  nome: string;
  cor: string;
  ordem: number;
  papel: PapelEtapa;
}

export interface Pipeline {
  id: number;
  nome: string;
  ordem: number;
  abertos: number;
  etapas: EtapaPipeline[];
}

export type ModeloMensagem =
  | 'primeira'
  | 'followup1'
  | 'followup2'
  | 'ultima'
  | 'marcar_reuniao'
  | 'cobrar_proposta';

export const MODELOS_MENSAGEM: { id: ModeloMensagem; rotulo: string; quando: string }[] = [
  { id: 'primeira', rotulo: 'Primeira abordagem', quando: 'Lead em "A abordar"' },
  { id: 'followup1', rotulo: '1º follow-up', quando: 'Depois da 1ª mensagem sem resposta' },
  { id: 'followup2', rotulo: 'Follow-ups seguintes', quando: 'Do 2º follow-up em diante' },
  { id: 'ultima', rotulo: 'Última tentativa', quando: 'A última mensagem antes de encerrar' },
  { id: 'marcar_reuniao', rotulo: 'Marcar reunião', quando: 'Lead em "Respondeu"' },
  { id: 'cobrar_proposta', rotulo: 'Cobrar proposta', quando: 'Lead em "Proposta"' },
];

export interface ConfigCadencia {
  diasFollowup: number[];
  diasEncerrar: number;
  encerrarSemResposta: boolean;
  diasCobrarProposta: number[];
  remetente: string;
  modelos: Record<ModeloMensagem, string>;
}

export interface MensagemPronta {
  modelo: ModeloMensagem | null;
  rotulo: string | null;
  texto: string;
  telefone: string | null;
  /** Número desta mensagem na cadência (1 = primeira); 0 fora da prospecção. */
  tentativa: number;
  totalTentativas: number;
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
  /** Contatos que você marcou como errados, por fonte de origem. */
  errosPorFonte?: { fonte: string; erros: number; contatos: number }[];
  naoDecisores?: number;
  custos?: { basePagaBrl: number; basePagaConsultas: number; placesEnriquecimento: number };
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
  | 'manual'
  | 'whatsapp'
  | 'base_paga';

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
  /** Você marcou que esta pessoa não é quem decide. */
  naoDecisor?: boolean;
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
  /** Você marcou este contato como errado. */
  marcadoErrado?: boolean;
}

export interface EtapaEnriq {
  etapa:
    | 'receita'
    | 'maps'
    | 'site'
    | 'google'
    | 'instagram'
    | 'ia'
    | 'linkedin'
    | 'places'
    | 'whatsapp'
    | 'base_paga';
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
  status: 'pendente' | 'rodando' | 'concluida' | 'erro' | 'bloqueada';
  itens: number | null;
  erro: string | null;
  verificacoes: number;
  /** Pendente/rodando sem tarefa na fila: não anda sozinha. */
  parada?: boolean;
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

// ---------- Google Places (uso e custo) ----------

export interface UsoPlaces {
  /** 1º dia do mês de cobrança do Google (AAAA-MM-DD). */
  mes: string;
  renovaEm: string;
  diasRestantes: number;
  franquia: number;
  usados: number;
  gratisRestantes: number;
  pagos: number;
  lugares: number;
  gastoUsd: number;
  precoPorPedidoUsd: number;
  precoMilUsd: number;
  ritmoDia: number;
  projecaoPedidos: number;
  projecaoUsd: number;
  /** Quando a franquia acaba no ritmo atual (null: não acaba este mês ou já acabou). */
  franquiaAcabaEm: string | null;
  situacao: 'gratis' | 'vai_cobrar' | 'cobrando';
  tetoMensalUsd: number | null;
  cotacaoBrl: number;
  maxBairros: number;
}

export interface ConfigPlaces {
  franquiaMensal: number;
  precoMilUsd: number;
  cotacaoBrl: number;
  tetoMensalUsd: number | null;
  maxBairros: number;
}

export interface EstimativaPlaces {
  cidades: { cidade: string; uf: string; bairros: number }[];
  termos: number;
  paginasPorBusca: number;
  divideBairro: boolean;
  mediaPaginasBairro: number;
  pedidosMin: number;
  pedidosMax: number;
  gratisRestantes: number;
  gratis: number;
  pagos: number;
  sobraGratisDepois: number;
  precoPorPedidoUsd: number;
  custoUsd: number;
  custoBrl: number;
  cotacaoBrl: number;
  tetoCampanhaUsd: number | null;
  gastoCampanhaUsd: number;
  tetoMensalUsd: number | null;
  gastoMesUsd: number;
  renovaEm: string;
}

export interface ConfigAgente {
  ligado: boolean;
  revisarAntes: boolean;
  horaInicio: number;
  horaFim: number;
  diasSemana: number[];
  limiteDia: number;
  intervaloSeg: number;
  respostasDiaLead: number;
  sobreEmpresa: string;
  regras: string;
  horariosReuniao: string;
  /** Quando a IA passa para o time, o lead recebe "vou chamar alguém do time". */
  avisoPassagem: boolean;
}

export interface RascunhoAgente {
  id: number;
  empresaId: number;
  nome: string;
  cidade: string | null;
  texto: string;
  telefone: string | null;
  origem: 'agente' | 'cadencia';
  nota: string | null;
  criadoEm: string;
  etapa: EtapaFunil | null;
  ultimaDoLead: string | null;
}

export interface TelaAgente {
  config: ConfigAgente;
  webhook: string;
  status: { whatsapp: boolean; ia: boolean };
  resumo: {
    rascunhos: number;
    enviadasHoje: number;
    recebidasHoje: number;
    leadsComIa: number;
    pausados: number;
  };
  rascunhos: RascunhoAgente[];
  pausados: {
    empresaId: number;
    nome: string;
    cidade: string | null;
    motivo: string;
    etapa: EtapaFunil;
    em: string;
    /** Resumo que a IA fez ao passar para você. */
    resumo: ResumoPassagem | null;
  }[];
}

/** Resumo da conversa quando a IA passa o lead para o time. */
export interface ResumoPassagem {
  situacao: string;
  combinado: string[];
  objecoes: string[];
  perguntasEmAberto: string[];
  interesse: 'alto' | 'medio' | 'baixo' | 'indefinido';
  proximoPasso: string;
  motivo?: string;
}

export interface ItemConhecimento {
  id: number;
  tipo: 'texto' | 'faq' | 'arquivo';
  titulo: string;
  pergunta: string | null;
  conteudo: string;
  origem: 'manual' | 'arquivo' | 'conversa';
  status: 'ativo' | 'sugerido';
  empresaId: number | null;
  empresaNome: string | null;
  usos: number;
  usadoEm: string | null;
  criadoEm: string;
  criadoPorNome: string | null;
}

export interface LacunaIa {
  id: number;
  empresaId: number;
  empresaNome: string | null;
  pergunta: string;
  motivo: string | null;
  criadoEm: string;
  /** Sugestão de resposta já criada a partir do que o time respondeu. */
  sugestaoId: number | null;
}

export interface VerificacaoIa {
  id: number;
  empresaId: number;
  empresaNome: string | null;
  texto: string;
  problemas: { regra: string; detalhe: string }[];
  resultado: 'reescrita' | 'bloqueada';
  criadoEm: string;
}

export interface TelaConhecimento {
  itens: ItemConhecimento[];
  lacunas: LacunaIa[];
  verificacoes: VerificacaoIa[];
  numeros: { ativos: number; sugeridos: number; lacunas: number; barradas7d: number };
}

export interface TrechoAchado {
  conhecimentoId: number;
  titulo: string;
  texto: string;
  relevancia: number;
}

export interface ItemRadar {
  empresaId: number;
  nome: string;
  cidade: string | null;
  etapa: EtapaFunil;
  etapaNome: string | null;
  responsavelId: number | null;
  responsavelNome: string | null;
  valorMensal: number | null;
  proximaAcao: string | null;
  proximaAcaoEm: string | null;
  ultimoMovimento: string | null;
  horasParado: number;
  nivel: 'critico' | 'risco';
  motivo: string;
}

export interface TelaRadar {
  itens: ItemRadar[];
  contagem: { critico: number; risco: number; andamento: number };
}

/* ───────────────────────────── Equipe ───────────────────────────── */

export type PapelUsuario = 'admin' | 'sdr' | 'closer';
export const ROTULO_PAPEL_USUARIO: Record<PapelUsuario, string> = {
  admin: 'Administrador',
  sdr: 'SDR',
  closer: 'Closer',
};

export interface Sessao {
  id: number;
  nome: string;
  email: string;
  papel: PapelUsuario;
  telefone: string | null;
  agendaToken: string;
  /** Conta (empresa) em que a pessoa está agora. */
  conta: {
    id: number;
    nome: string;
    plano: string | null;
    /** Módulos que valem na conta (sem plano: todos). */
    modulos: ('whatsapp' | 'agente_ia' | 'email')[];
  };
  /** Administra a plataforma (painel master). */
  master: boolean;
  /** Master dentro de outra conta (suporte/configuração). */
  foraDaPropria: boolean;
}

export interface Metas {
  abordagensDia: number;
  reunioesMes: number;
  ganhosMes: number;
}

export interface UsuarioEquipe {
  id: number;
  nome: string;
  email: string;
  papel: PapelUsuario;
  ativo: boolean;
  recebeLeads: boolean;
  telefone: string | null;
  convitePendente: boolean;
  ultimoAcesso: string | null;
  leadsAbertos: number;
  metas: Metas;
}

export interface Equipe {
  usuarios: UsuarioEquipe[];
  distribuicao: { sdr: 'rodizio' | 'manual'; closer: 'rodizio' | 'mesmo' | 'manual' };
  semDono: number;
}

export interface DesempenhoUsuario {
  id: number;
  nome: string;
  papel: PapelUsuario;
  contatosHoje: number;
  contatos: number;
  pelaIa: number;
  respostas: number;
  reunioes: number;
  reunioesMes: number;
  ganhos: number;
  ganhosMes: number;
  valorGanho: number;
  abertos: number;
  atrasados: number;
  metas: Metas;
}

export interface Notificacao {
  id: number;
  tipo: 'mensagem' | 'atribuido' | 'reuniao' | 'tarefa' | 'sistema';
  titulo: string;
  texto: string | null;
  empresaId: number | null;
  link: string | null;
  lidaEm: string | null;
  criadoEm: string;
}

/* ───────────────────────────── Conversas ───────────────────────────── */

export type TipoMidia = 'imagem' | 'audio' | 'video' | 'documento';

export interface ConversaResumo {
  empresaId: number;
  nome: string;
  cidade: string | null;
  etapa: EtapaFunil;
  etapaNome: string | null;
  etapaCor: string | null;
  responsavelId: number | null;
  responsavelNome: string | null;
  agente: boolean;
  agentePausa: string | null;
  ultima: string | null;
  ultimaDirecao: 'enviada' | 'recebida' | null;
  ultimaEm: string;
  ultimaMidia: TipoMidia | null;
  ultimaOrigem: string | null;
  /** Canal da última mensagem (WhatsApp ou e-mail). */
  ultimoCanal: 'whatsapp' | 'email' | null;
  naoLidas: number;
  /** Conversa seguindo com uma pessoa indicada (nome dela). */
  falandoCom: string | null;
  /** Contatos sugeridos esperando confirmação. */
  sugestoes: number;
}

export interface MensagemConversa {
  id: string;
  canal: 'whatsapp' | 'email';
  /** Assunto, quando é e-mail. */
  assunto: string | null;
  direcao: 'enviada' | 'recebida';
  texto: string;
  status: 'rascunho' | 'aprovada' | 'enviada' | 'erro' | 'recebida' | 'registrada';
  origem: 'agente' | 'cadencia' | 'humano' | 'lead' | 'registro' | 'sequencia';
  erro: string | null;
  nota: string | null;
  midiaTipo: TipoMidia | null;
  midiaId: number | null;
  em: string;
  autor: string | null;
  /** Número com quem foi trocada (WhatsApp). */
  telefone: string | null;
  /** Contato da negociação dono do número (null = número da empresa). */
  contatoId: number | null;
  contatoNome: string | null;
  contatoCargo: string | null;
}

export interface ConversaAberta {
  empresaId: number;
  nome: string;
  cidade: string | null;
  etapa: EtapaFunil;
  etapaNome: string | null;
  etapaCor: string | null;
  responsavelId: number | null;
  responsavelNome: string | null;
  agente: boolean;
  agentePausa: string | null;
  /** Resumo que a IA fez ao passar a conversa para o time (só enquanto está pausada). */
  agenteResumo: ResumoPassagem | null;
  /** O que o lead já contou (a IA não pergunta de novo). */
  agenteMemoria: string[] | null;
  /** Melhor e-mail do lead. */
  email: string | null;
  /** O lead já respondeu por e-mail: a resposta vai na mesma conversa. */
  emailEmConversa: boolean;
  telefone: string | null;
  variaveis: { nome: string | null; empresa: string; cidade: string | null; remetente: string };
  mensagens: MensagemConversa[];
  /** Contatos da negociação: cadeia de indicações e sugestões a confirmar. */
  contatos: ContatoLead[];
  /** Números para o "enviar para" (telefone é o escolhido). */
  opcoesEnvio: OpcaoEnvio[];
}

export interface ContatoLead {
  id: number;
  nome: string;
  cargo: string | null;
  telefone: string | null;
  email: string | null;
  indicadoPorId: number | null;
  indicadoPorNome: string | null;
  indicadoPorTexto: string | null;
  decisor: boolean;
  status: 'sugerido' | 'confirmado';
  origem: 'manual' | 'ia' | 'nao_identificado';
  evidencia: string | null;
  criadoEm: string;
  criadoPorNome: string | null;
  mensagens: number;
}

export interface OpcaoEnvio {
  telefone: string;
  nome: string;
  detalhe: string | null;
  tipo: 'empresa' | 'contato';
  contatoId: number | null;
  whatsapp: boolean | null;
}

export interface NaoIdentificado {
  telefone: string;
  nome: string | null;
  ultima: string;
  ultimaDirecao: 'enviada' | 'recebida';
  ultimaEm: string;
  quantidade: number;
  mensagens: {
    id: number;
    direcao: 'enviada' | 'recebida';
    texto: string;
    midiaTipo: TipoMidia | null;
    em: string;
  }[];
  /** O número já foi indicado na conversa de um lead (o vínculo provável). */
  indicadoEm: {
    empresaId: number;
    empresa: string;
    contatoId: number;
    contatoNome: string;
    indicadoPorId: number | null;
  } | null;
}

export interface RespostaRapida {
  id: number;
  atalho: string;
  texto: string;
}

/* ───────────────────────────── Agenda ───────────────────────────── */

export type TipoTarefa = 'tarefa' | 'ligacao' | 'reuniao' | 'visita';
export const ROTULO_TAREFA: Record<TipoTarefa, string> = {
  tarefa: 'Tarefa',
  ligacao: 'Ligação',
  reuniao: 'Reunião',
  visita: 'Visita',
};
export const ICONE_TAREFA: Record<TipoTarefa, string> = {
  tarefa: 'check',
  ligacao: 'phone',
  reuniao: 'users',
  visita: 'map-pin',
};

export interface Tarefa {
  id: number;
  empresaId: number | null;
  empresaNome: string | null;
  empresaCidade: string | null;
  usuarioId: number | null;
  usuarioNome: string | null;
  tipo: TipoTarefa;
  titulo: string;
  descricao: string | null;
  inicio: string;
  fim: string | null;
  local: string | null;
  concluidaEm: string | null;
  lembreteLeadEm: string | null;
  atrasada: boolean;
}

export interface FollowupDoDia {
  empresaId: number;
  nome: string;
  cidade: string | null;
  etapa: EtapaFunil;
  etapaNome: string | null;
  etapaCor: string | null;
  proximaAcao: string | null;
  proximaAcaoEm: string;
  atrasado: boolean;
  tentativas: number;
  agente: boolean;
  agentePausa: string | null;
  responsavelNome: string | null;
}

export interface MeuDia {
  tarefas: Tarefa[];
  followups: FollowupDoDia[];
  conversas: { empresaId: number; nome: string; naoLidas: number; ultimaEm: string; ultima: string }[];
  proximas: Tarefa[];
}

export interface ConfigAgenda {
  lembreteLead: boolean;
  lembreteLeadMinutos: number;
  textoLembreteLead: string;
  lembreteUsuarioMinutos: number;
  lembreteUsuarioWhatsapp: boolean;
  duracaoReuniaoMin: number;
}

/* ───────────────────────────── E-mail ───────────────────────────── */

export type ClasseResposta = 'interessado' | 'sem_interesse' | 'descadastro' | 'automatica';
export const ROTULO_CLASSE: Record<ClasseResposta, string> = {
  interessado: 'Tem interesse',
  sem_interesse: 'Sem interesse',
  descadastro: 'Pediu para sair',
  automatica: 'Resposta automática',
};

export interface ConfigEmail {
  ligado: boolean;
  limiteDia: number;
  intervaloSeg: number;
  horaInicio: number;
  horaFim: number;
  diasSemana: number[];
  rastrearAbertura: boolean;
  /** Último aviso do Resend recebido. */
  webhookEm: string | null;
}

export interface VisaoEmail {
  config: ConfigEmail;
  resumo: { enviadosHoje: number; naFila: number; respostasNaoLidas: number };
  status: {
    resend: boolean;
    remetente: string | null;
    dominioRespostas: string | null;
    webhook: boolean;
    webhookUrl: string;
    ia: boolean;
    /** "DeepSeek · deepseek-flash", por exemplo. */
    iaDescricao: string | null;
    /** De onde vem o Resend: da conta (painel master) ou da plataforma. */
    origem: OrigemCredencial;
  };
}

export type OrigemCredencial = 'conta' | 'plataforma' | null;

/** Identidade visual do e-mail (white label). */
export interface MarcaEmail {
  id: number;
  nome: string;
  remetenteNome: string;
  remetenteEmail: string | null;
  responderPara: string | null;
  estilo: 'cartao' | 'simples';
  corPrimaria: string;
  corFundo: string;
  corTexto: string;
  corCabecalho: string;
  logoId: number | null;
  larguraLogo: number;
  capaId: number | null;
  assinatura: string;
  rodape: string;
  logoUrl: string | null;
  capaUrl: string | null;
  campanhas: number;
}

/** O e-mail exatamente como o lead recebe. */
export interface PreviaEmail {
  assunto: string;
  html: string;
  texto: string;
  de: { nome: string; email: string | null };
  responderPara: string | null;
  lead: { empresaId: number | null; empresa: string; contato: string | null; cidade: string | null };
  /** O que a IA escreveu no lugar de {abertura}. */
  abertura: string | null;
  aviso: string | null;
  anexos: { id: number; nome: string; tamanho: number }[];
}

export interface LeadPrevia {
  empresaId: number;
  nome: string;
  cidade: string | null;
  email: string | null;
}

export interface ArquivoEmail {
  id: number;
  nome: string;
  mime: string;
  tamanho: number;
}

export interface ModeloEmail {
  id: number;
  nome: string;
  assunto: string;
  corpo: string;
  anexos: number[];
  arquivos: ArquivoEmail[];
  /** Nicho para o qual o modelo foi escrito (só organização). */
  nichoId: number | null;
  nichoNome: string | null;
  atualizadoEm: string;
}

export interface CampanhaEmail {
  id: number;
  nome: string;
  status: 'rascunho' | 'enviando' | 'pausada' | 'concluida';
  passos: PassoSequencia[];
  faixas: ('A' | 'B' | 'C')[];
  pularNoFunil: boolean;
  incluirContador: boolean;
  campanhaId: number;
  campanhaNome: string;
  marcaId: number | null;
  marcaNome: string | null;
  instrucoesIa: string;
  personalizarIa: boolean;
  criadoEm: string;
  iniciadaEm: string | null;
  concluidaEm: string | null;
  leads: number;
  naFila: number;
  enviados: number;
  enviadosEmail: number;
  enviadosWhatsapp: number;
  ligacoes: number;
  pulados: number;
  erros: number;
  abriram: number;
  clicaram: number;
  responderam: number;
  responderamWhatsapp: number;
  interessados: number;
  ultimoEnvio: string | null;
}

export type CanalSequencia = 'email' | 'whatsapp' | 'ligacao';

/** Passo da sequência: e-mail (modelo), WhatsApp (texto) ou ligação (roteiro). */
export interface PassoSequencia {
  canal?: CanalSequencia;
  modeloId?: number;
  texto?: string;
  dias: number;
}

export interface EnvioEmail {
  id: number;
  empresaId: number;
  nome: string;
  cidade: string | null;
  email: string | null;
  canal: CanalSequencia;
  telefone: string | null;
  paradoMotivo: string | null;
  passo: number;
  status: 'na_fila' | 'enviado' | 'erro' | 'devolvido' | 'cancelado' | 'pulado';
  assunto: string | null;
  erro: string | null;
  enviadoEm: string | null;
  abertoEm: string | null;
  aberturas: number;
  clicadoEm: string | null;
  cliques: number;
  respondidoEm: string | null;
  campanhaNome: string;
  campanhaEmailId: number;
  classeResposta: ClasseResposta | null;
  etapaFunil: EtapaFunil | null;
}

export interface RespostaEmail {
  id: number;
  empresaId: number | null;
  nome: string | null;
  cidade: string | null;
  deEmail: string;
  deNome: string | null;
  assunto: string | null;
  texto: string;
  recebidoEm: string;
  classe: ClasseResposta;
  resumo: string | null;
  classificadoPor: 'ia' | 'regra' | 'voce';
  lidaEm: string | null;
  etapaFunil: EtapaFunil | null;
  campanhaNome: string | null;
}

/* ───────── Painel master ───────── */

export interface ContaResumo {
  id: number;
  nome: string;
  ativa: boolean;
  principal: boolean;
  /** Chamadas à IA da plataforma neste mês e o teto (null = sem teto). */
  iaPlataformaMes: number;
  limiteIaMes: number | null;
  usaIaPlataforma: boolean;
  observacoes: string | null;
  criadoEm: string;
  usuarios: number;
  ultimoAcesso: string | null;
  campanhasAtivas: number;
  leadsNoFunil: number;
  emails30d: number;
  whatsapp30d: number;
  plano: PlanoConta;
}

/** Plano da conta: o que vale (números e módulos), o preço e o uso do mês. */
export interface PlanoConta {
  plano: 'start' | 'time' | 'escala' | 'personalizado' | null;
  usuarios: number | null;
  leadsMes: number | null;
  modulos: ('whatsapp' | 'agente_ia' | 'email')[];
  itens: { rotulo: string; valor: number }[];
  mensalidadeCalculada: number | null;
  mensalidade: number | null;
  limiteUsuariosProprio: number | null;
  limiteLeadsProprio: number | null;
  mensalidadeManual: number | null;
  planoDesde: string | null;
  uso: { usuarios: number; leadsMes: number; leadsEsperando: number };
}

export type CampoSegredo =
  | 'placesKey'
  | 'resendKey'
  | 'resendWebhookSegredo'
  | 'evolutionKey'
  | 'iaKey'
  | 'orsKey';
export type ProvedorIa = 'deepseek' | 'gemini' | 'openai';
export type ServicoTestavel = 'resend' | 'evolution' | 'ia' | 'places' | 'ors';

export interface CredenciaisTela {
  emailRemetente: string | null;
  resendDominioRespostas: string | null;
  evolutionUrl: string | null;
  evolutionInstancia: string | null;
  iaProvedor: ProvedorIa | null;
  iaModelo: string | null;
  iaBaseUrl: string | null;
  /** Final de cada segredo guardado (…a1b2) ou null. */
  segredos: Record<CampoSegredo, string | null>;
  atualizadoEm: string | null;
  erro: string | null;
  /** false: falta CHAVE_CREDENCIAIS no servidor. */
  podeGuardar: boolean;
  emUso: {
    places: OrigemCredencial;
    ors: OrigemCredencial;
    resend: OrigemCredencial;
    evolution: OrigemCredencial;
    ia: OrigemCredencial;
    remetente: string | null;
    iaModelo: string | null;
  };
}

export interface UsuarioConta {
  id: number;
  nome: string;
  email: string;
  papel: PapelUsuario;
  ativo: boolean;
  master: boolean;
  convitePendente: boolean;
  ultimoAcesso: string | null;
}

export interface ContaDetalhe
  extends Omit<
    ContaResumo,
    | 'usuarios'
    | 'ultimoAcesso'
    | 'campanhasAtivas'
    | 'leadsNoFunil'
    | 'emails30d'
    | 'whatsapp30d'
    | 'iaPlataformaMes'
    | 'limiteIaMes'
    | 'usaIaPlataforma'
  > {
  usuarios: UsuarioConta[];
  credenciais: CredenciaisTela;
  webhooks: { resend: string; evolution: string | null };
}

export interface UsoIa {
  chamadas: number;
  tokensEntrada: number;
  tokensSaida: number;
  erros: number;
  bloqueadas: number;
}

export interface ConsumoConta {
  mes: string;
  limites: {
    usaIaPlataforma: boolean;
    iaMes: number | null;
    emailsMes: number | null;
    whatsappMes: number | null;
  };
  ia: { conta: UsoIa; plataforma: UsoIa };
  iaPorDia: { dia: string; chamadas: number }[];
  emails: { enviados: number; naFila: number };
  whatsapp: { automaticas: number; equipe: number; recebidas: number };
  places: { pedidos: number; pagos: number; gastoUsd: number; enriquecimento: number };
  /** Buscas no Google pelo Serper e leads enriquecidos no mês. */
  buscas: { serper: number; leadsEnriquecidos: number };
}

export interface ItemAuditoria {
  id: number;
  usuarioId?: number | null;
  usuarioNome: string | null;
  comoMaster: boolean;
  acao: string;
  descricao: string;
  metodo?: string | null;
  caminho?: string | null;
  empresaId: number | null;
  empresaNome: string | null;
  detalhes?: { params?: Record<string, string>; corpo?: unknown; filtros?: unknown } | null;
  ip?: string | null;
  criadoEm: string;
}

/* ───────── Chips de WhatsApp ───────── */

export interface Chip {
  id: number;
  nome: string;
  instancia: string;
  ativo: boolean;
  limiteDia: number;
  estado: string | null;
  estadoEm: string | null;
  /** Mensagens frias hoje (as que contam no limite). */
  enviadosHoje: number;
  /** Respostas da IA hoje (não contam no limite). */
  respostasHoje: number;
  leads: number;
  aquecer: boolean;
  diasDeUso: number;
  /** Teto de hoje pelo aquecimento (número novo); null: sem teto. */
  tetoAquecimento: number | null;
  /** Pausado sozinho por falhas de envio, até esta hora. */
  pausadoAte: string | null;
  pausaMotivo: string | null;
}

/* ───────── Alertas ───────── */

export interface Alerta {
  id: number;
  contaId: number | null;
  chave: string;
  nivel: 'erro' | 'aviso';
  titulo: string;
  texto: string | null;
  link: string | null;
  primeiraVez: string;
  ultimaVez: string;
}

/* ───────── Agente: simulador e desempenho ───────── */

export type AcaoAgente =
  | 'responder'
  | 'marcar_reuniao'
  | 'agendar_retorno'
  | 'passar_para_humano'
  | 'encerrar_sem_interesse'
  | 'optout';

export interface ProblemaVerificacao {
  regra: string;
  detalhe: string;
}

export interface Simulacao {
  regraFixa?: { tipo: 'parar' | 'pediu_pessoa' | 'sensivel'; motivo?: string };
  decisao?: {
    acao: AcaoAgente;
    resposta: string;
    reuniaoEm: string | null;
    retornoEm?: string | null;
    motivo: string;
    memoria?: string[];
    semResposta?: string | null;
  };
  bolhas?: string[];
  trechos?: TrechoAchado[];
  primeiraResposta?: string | null;
  problemasIniciais?: ProblemaVerificacao[];
  barrada?: ProblemaVerificacao[];
  aviso: string | null;
}

export interface DesempenhoIa {
  dias: number;
  numeros: {
    leadsAtendidos: number;
    respostas: number;
    reunioes: number;
    retornos: number;
    semInteresse: number;
    passagens: number;
    corrigidas: number;
    barradas: number;
    lacunas: number;
    ensinadas: number;
    aprendidas: number;
    tempoRespostaSeg: number | null;
  };
  passagensPorTipo: { tipo: string; n: number }[];
  baseMaisUsada: { id: number; titulo: string; pergunta: string | null; usos: number }[];
}
