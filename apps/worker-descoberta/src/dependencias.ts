import type { Pool } from '@prospeccao/db';
import type { ItemMaps, Run } from '@prospeccao/integrations/apify';
import type { ResultadoGeocodificacao } from '@prospeccao/integrations/ors';
import type { Filas } from '@prospeccao/queue';
import type { Logger } from '@prospeccao/shared';

/** Portas para o mundo de fora: em produção, Apify e ORS; nos testes, dublês. */
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
  maps: BuscadorMaps;
  /** null sem ORS_API_KEY: só campanhas com raio precisam localizar quem não veio do Maps. */
  geo: Geocodificador | null;
  ajustes: Ajustes;
}
