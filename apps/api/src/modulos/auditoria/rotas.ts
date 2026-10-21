import { filtrosAuditoria } from '@prospeccao/shared';
import { Router } from 'express';
import type { DepsApi } from '../../dependencias.js';
import { consulta } from '../../middlewares/http.js';
import { exigirAdmin } from '../../middlewares/seguranca.js';
import * as repo from './repositorio.js';

/** Histórico de alterações da conta (só o administrador vê). */
export function rotasAuditoria({ pool }: DepsApi): Router {
  const r = Router();
  r.use(exigirAdmin);
  r.get('/', async (req, res) => {
    res.json(await repo.listar(pool, consulta(req, filtrosAuditoria)));
  });
  r.get('/acoes', async (_req, res) => {
    res.json(await repo.acoes(pool));
  });
  return r;
}
