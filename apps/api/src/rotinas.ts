import { contasAtivas, type Executor } from '@prospeccao/db';
import type { Logger } from '@prospeccao/shared';
import { comConta } from './contexto.js';

/**
 * Rotinas de fundo (motores do agente, do e-mail, lembretes, cadência) rodam conta por conta:
 * cada rodada enxerga só os dados e usa só as credenciais daquela conta. Falha numa conta não
 * para as outras.
 */
export async function paraCadaConta(
  db: Executor,
  log: Logger,
  nome: string,
  fn: (contaId: number) => Promise<void>,
): Promise<void> {
  for (const id of await contasAtivas(db)) {
    try {
      await comConta(id, () => fn(id));
    } catch (erro) {
      log.error({ err: erro, conta: id }, `${nome}: rodada falhou nesta conta`);
    }
  }
}
