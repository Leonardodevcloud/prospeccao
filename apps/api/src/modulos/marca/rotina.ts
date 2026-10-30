import type { Executor } from '@prospeccao/db';
import type { Logger } from '@prospeccao/shared';
import * as repo from './repositorio.js';
import type { DominiosSite } from './vercel.js';

const INTERVALO_MS = 5 * 60_000;

/**
 * Domínio próprio esperando o DNS: confere sozinho a cada 5 minutos (na última semana; depois disso,
 * só quando o cliente aperta "Conferir agora"). Ficou ativo, os links passam a sair com ele.
 */
export function iniciarDominios(deps: {
  pool: Executor;
  log: Logger;
  site: () => DominiosSite | null;
}): () => void {
  const rodar = async () => {
    const site = deps.site();
    if (!site) return;
    try {
      for (const org of await repo.pendentes(deps.pool))
        if (await repo.conferirDominio(deps.pool, site, org))
          deps.log.info({ organizacao: org }, 'marca: domínio ativo');
    } catch (erro) {
      deps.log.error({ err: erro }, 'marca: conferência dos domínios falhou');
    }
  };
  const t = setInterval(() => void rodar(), INTERVALO_MS);
  t.unref();
  return () => clearInterval(t);
}
