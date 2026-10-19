import { Router } from 'express';
import type { DepsApi } from '../../dependencias.js';
import { idDaRota } from '../../middlewares/http.js';
import * as repo from './repositorio.js';

export function rotasNotificacoes({ pool }: DepsApi): Router {
  const r = Router();
  r.get('/', async (req, res) => {
    res.json(await repo.listar(pool, req.usuario!.id));
  });
  r.post('/lidas', async (req, res) => {
    await repo.marcarLidas(pool, req.usuario!.id);
    res.json({ ok: true });
  });
  r.post('/:id/lida', async (req, res) => {
    await repo.marcarLidas(pool, req.usuario!.id, idDaRota(req));
    res.json({ ok: true });
  });
  return r;
}
