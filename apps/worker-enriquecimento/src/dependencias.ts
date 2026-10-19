import type { Pool } from '@prospeccao/db';
import type {
  AvaliacaoIa,
  DetalhesPlaces,
  EntradaAvaliacao,
  PerfilInstagram,
  ResultadoGoogle,
  ResultadoSite,
} from '@prospeccao/integrations/enriquecimento';
import type { Logger } from '@prospeccao/shared';

/**
 * Portas para o mundo de fora. Cada uma é opcional (null) quando falta a chave: a cascata
 * pula aquela fonte e registra o motivo na trilha. Nos testes, dublês.
 */
export interface Fontes {
  site: { ler(url: string): Promise<ResultadoSite | null> };
  google: { buscar(consultas: string[]): Promise<Map<string, ResultadoGoogle[]>> } | null;
  instagram: { ler(usuario: string): Promise<PerfilInstagram | null> } | null;
  ia: { avaliar(entrada: EntradaAvaliacao): Promise<AvaliacaoIa> } | null;
  places: { detalhes(placeId: string): Promise<DetalhesPlaces> } | null;
  whatsapp: { verificar(numeros: string[]): Promise<Map<string, boolean>> } | null;
}

export interface Ajustes {
  /** Faixas que justificam a busca de pessoas no LinkedIn (custa uma busca no Google). */
  faixasLinkedin: Set<string>;
  /** Faixas validadas no Google Places (custa uma consulta). */
  faixasPlaces: Set<string>;
  /** Procurar o Instagram no Google quando o site não indica. */
  buscarInstagram: boolean;
  /** Não refaz empresa enriquecida há menos de N dias (a não ser que peçam). */
  refazerDias: number;
}

export interface Deps {
  pool: Pool;
  log: Logger;
  fontes: Fontes;
  ajustes: Ajustes;
}
