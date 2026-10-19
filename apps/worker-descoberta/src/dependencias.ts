import type { Pool } from '@prospeccao/db';
import type { ItemMaps, Run } from '@prospeccao/integrations/apify';
import type { ResultadoGeocodificacao } from '@prospeccao/integrations/ors';
import type { PaginaPlaces } from '@prospeccao/integrations/places';
import type { Filas } from '@prospeccao/queue';
import type { Logger } from '@prospeccao/shared';

/** Portas para o mundo de fora: em produção, Google Places, Apify e ORS; nos testes, dublês. */

/** Google Places (Text Search): uma página por chamada, cada chamada conta no uso do mês. */
export interface BuscadorPlaces {
  buscar(busca: { texto: string; pagina?: string | null }): Promise<PaginaPlaces>;
}

/** Apify (legado): dispara um run e coleta depois. */
export interface BuscadorMaps {
  iniciar(busca: { termo: string; local: string; max: number }): Promise<Run>;
  obter(runId: string): Promise<Run>;
  itens(datasetId: string): Promise<{ itens: ItemMaps[]; ignorados: number }>;
}

export interface Geocodificador {
  geocodificar(endereco: string): Promise<ResultadoGeocodificacao | null>;
}

export interface Ajustes {
  /** Não repete a mesma busca (cidade × termo) de uma campanha antes deste prazo. */
  rebuscaDias: number;
  /** Espera entre verificações do run no Apify. */
  esperaColetaSegundos: number;
  /** Desiste do run depois de tantas verificações. */
  maxVerificacoes: number;
  /** Confiança mínima do ORS para aceitar uma coordenada. */
  confiancaMinimaGeo: number;
}

export interface Deps {
  pool: Pool;
  filas: Pick<Filas, 'publicar'>;
  log: Logger;
  /** Provedor das buscas novas. Sem GOOGLE_PLACES_KEY, cai no Apify (se houver APIFY_TOKEN). */
  places: BuscadorPlaces | null;
  /** Apify: só para buscas novas sem Places e para coletar runs que já estavam rodando. */
  maps: BuscadorMaps | null;
  /** null sem ORS_API_KEY: só campanhas com raio precisam localizar quem não veio do Maps. */
  geo: Geocodificador | null;
  ajustes: Ajustes;
}
