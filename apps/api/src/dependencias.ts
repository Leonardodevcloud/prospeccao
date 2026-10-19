import type { Pool } from '@prospeccao/db';
import type { Filas } from '@prospeccao/queue';
import type { Logger } from '@prospeccao/shared';

export interface DepsApi {
  pool: Pool;
  filas: Pick<Filas, 'publicar' | 'tamanhos'>;
  log: Logger;
  auth: {
    jwtSegredo: string;
    adminEmail: string;
    adminSenhaHash: string;
    sessaoHoras: number;
    cookieSeguro: boolean;
  };
  origens: string[];
  /** Geocodificação de endereço de base; ausente quando não há chave do ORS. */
  geocodificar?: (endereco: string) => Promise<{ lat: number; lng: number } | null>;
}
