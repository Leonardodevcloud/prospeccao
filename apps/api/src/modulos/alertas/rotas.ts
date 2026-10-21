import { Router } from 'express';
import type { DepsApi } from '../../dependencias.js';
import { exigirAdmin } from '../../middlewares/seguranca.js';
import * as repo from './repositorio.js';
import { verificarSaude } from './rotina.js';

/** Alertas em aberto (a faixa no topo da tela, para o administrador e o master). */
export function rotasAlertas(deps: DepsApi): Router {
  const r = Router();
  r.use(exigirAdmin);
  r.get('/', async (req, res) => {
    res.json(await repo.ativos(deps.pool, req.usuario!.contaId, req.usuario!.master));
  });
  /** Confere de novo agora (depois de arrumar algo). */
  r.post('/conferir', async (req, res) => {
    await verificarSaude(deps);
    res.json(await repo.ativos(deps.pool, req.usuario!.contaId, req.usuario!.master));
  });
  return r;
}
