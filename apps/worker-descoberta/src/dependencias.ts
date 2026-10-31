import type { Pool } from '@prospeccao/db';
import type { ResultadoGeocodificacao } from '@prospeccao/integrations/ors';
import type { PaginaPlaces } from '@prospeccao/integrations/places';
import type { Filas } from '@prospeccao/queue';
import type { Logger } from '@prospeccao/shared';

/** Portas para o mundo de fora: em produção, Google Places e ORS; nos testes, dublês. */

/** Google Places (Text Search): uma página por chamada, cada chamada conta no uso do mês. */
export interface BuscadorPlaces {
  buscar(busca: { texto: string; pagina?: string | null }): Promise<PaginaPlaces>;
}

export interface Geocodificador {
  geocodificar(endereco: string): Promise<ResultadoGeocodificacao | null>;
}

export interface Ajustes {
  /** Não repete a mesma busca (cidade × termo) de uma campanha antes deste prazo. */
  rebuscaDias: number;
  /** Confiança mínima do ORS para aceitar uma coordenada. */
  confiancaMinimaGeo: number;
}

export interface Deps {
  pool: Pool;
  filas: Pick<Filas, 'publicar'>;
  log: Logger;
  /**
   * Google Places da conta (cada conta usa a sua chave, cadastrada no painel master; a conta
   * principal pode usar GOOGLE_PLACES_KEY). null: a conta não tem e a busca no Maps não roda.
   */
  placesDa(contaId: number): Promise<BuscadorPlaces | null>;
  /** ORS da conta. null: só campanhas com raio precisam localizar quem não veio do Maps. */
  geoDa(contaId: number): Promise<Geocodificador | null>;
  ajustes: Ajustes;
}
