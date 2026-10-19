import type { Pool } from '@prospeccao/db';
import type { ContextoAgente, DecisaoAgente } from '@prospeccao/integrations/agente';
import type { Filas } from '@prospeccao/queue';
import type { Logger } from '@prospeccao/shared';

export interface DepsApi {
  pool: Pool;
  filas: Pick<Filas, 'publicar' | 'publicarVarios' | 'cancelarPendentes' | 'tamanhos'>;
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
  /** Envio pelo WhatsApp (Evolution). Sem ele, o agente prepara mas não envia. */
  whatsapp?: { enviar(telefone: string, texto: string): Promise<{ idExterno: string | null }> } | null;
  /** IA do agente (Gemini). Sem ela, resposta do lead vai direto para você. */
  ia?: { decidir(contexto: ContextoAgente): Promise<DecisaoAgente> } | null;
}
