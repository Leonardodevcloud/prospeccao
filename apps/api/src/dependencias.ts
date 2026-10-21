import type { CredenciaisAmbiente, Pool } from '@prospeccao/db';
import type { Filas } from '@prospeccao/queue';
import type { Logger } from '@prospeccao/shared';
import type { ResolverServicos } from './servicos.js';

export type {
  EmailConta,
  ResolverServicos,
  ServicosConta,
  WhatsappConta,
} from './servicos.js';

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
  /** WhatsApp, IA, e-mail e geocodificação de cada conta, com as credenciais dela. */
  servicos: ResolverServicos;
  /** Credenciais das contas (painel master): chave de cifra, o que o ambiente tem e o cache. */
  credenciais: {
    /** CHAVE_CREDENCIAIS (sem ela, não dá para guardar chaves de API das contas). */
    chave: string | null;
    ambiente: CredenciaisAmbiente;
    /** Esquece as credenciais lembradas (depois de salvar no painel). */
    invalidar(contaId?: number): void;
  };
}
