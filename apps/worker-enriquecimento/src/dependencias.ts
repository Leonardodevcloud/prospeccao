import type { Pool } from '@prospeccao/db';
import type {
  AvaliacaoIa,
  BuscaDiretorios,
  ConsultaBasePaga,
  DadosCnpj,
  DetalhesPlaces,
  EmpresaParaAchar,
  EntradaAvaliacao,
  EntradaLeituraBusca,
  LeituraBusca,
  LugarAchado,
  PerfilInstagram,
  PerfilWhatsapp,
  ResultadoGoogle,
  ResultadoSite,
} from '@prospeccao/integrations/enriquecimento';
import type { Logger } from '@prospeccao/shared';

/**
 * Portas para o mundo de fora. Cada uma é opcional (null) quando falta a chave: a cascata
 * pula aquela fonte e registra o motivo na trilha. Nos testes, dublês.
 */
export interface Fontes {
  site: {
    ler(url: string): Promise<ResultadoSite | null>;
    /** Página do link da bio do Instagram (Linktree, Beacons…): botões de WhatsApp e contatos. */
    lerLinks?(url: string): Promise<ResultadoSite | null>;
  };
  google: {
    /** Quem faz a busca ("Serper" ou "Apify"), para as mensagens de erro. */
    nome?: string;
    buscar(consultas: string[]): Promise<Map<string, ResultadoGoogle[]>>;
  } | null;
  instagram: { ler(usuario: string): Promise<PerfilInstagram | null> } | null;
  ia: {
    avaliar(entrada: EntradaAvaliacao): Promise<AvaliacaoIa>;
    /** Lê a página de resultados do Google e tira Instagram, site, contatos e pessoas. */
    lerBusca?(entrada: EntradaLeituraBusca): Promise<LeituraBusca>;
  } | null;
  places: { detalhes(placeId: string): Promise<DetalhesPlaces> } | null;
  /** Procura a empresa no Google Maps pelo nome e endereço (Places na cota grátis, depois Serper). */
  lugar?: { achar(empresa: EmpresaParaAchar): Promise<LugarAchado> } | null;
  /** Busca a razão social no Google e lê telefone/e-mail citados em diretórios (Serper). */
  diretorios?: {
    buscar(empresa: {
      nome: string;
      razaoSocial: string | null;
      cidade: string;
      /** Busca pronta (a principal: "GEFPEL" autopeças salvador). Sem ela, busca a razão social. */
      consulta?: string;
    }): Promise<BuscaDiretorios>;
  } | null;
  /** Dados públicos da Receita por CNPJ (BrasilAPI, gratuita): confirma o CNPJ de quem veio só do Maps. */
  cnpj?: { consultar(cnpj: string): Promise<DadosCnpj | null> } | null;
  /** Base paga (Direct Data): telefones atualizados por CNPJ. Custa por consulta. */
  basePaga?: { nome: string; precoBrl: number; consultar(cnpj: string): Promise<ConsultaBasePaga> } | null;
  whatsapp: {
    verificar(numeros: string[]): Promise<Map<string, boolean>>;
    /** Perfil comercial (WhatsApp Business) do número. */
    perfil?(numero: string): Promise<PerfilWhatsapp | null>;
  } | null;
}

export interface Ajustes {
  /** Faixas que justificam a busca de pessoas no LinkedIn (custa uma busca no Google). */
  faixasLinkedin: Set<string>;
  /** Faixas validadas no Google Places (custa uma consulta). */
  faixasPlaces: Set<string>;
  /** Procurar no Google (nome + endereço) quem veio da base de CNPJ e não apareceu nas buscas. */
  acharNoGoogle?: boolean;
  /** Faixas que podem gastar uma consulta na base paga (só quando não há WhatsApp atual). */
  faixasBasePaga?: Set<string>;
  /** Procurar o Instagram no Google quando o site não indica. */
  buscarInstagram: boolean;
  /** Telefone em pelo menos N CNPJs da base é tratado como do contador. */
  limiteContador: number;
  /** Não refaz empresa enriquecida há menos de N dias (a não ser que peçam). */
  refazerDias: number;
}

export interface Deps {
  pool: Pool;
  log: Logger;
  fontes: Fontes;
  ajustes: Ajustes;
  /** Conta que pediu (para o limite de leads do plano); sem ela, não há limite. */
  contaId?: number;
}
