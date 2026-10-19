import { filtrosRelatorio } from '@prospeccao/shared';
import { Router } from 'express';
import type { DepsApi } from '../../dependencias.js';
import { consulta } from '../../middlewares/http.js';
import { relatorio } from './repositorio.js';

export function rotasRelatorios({ pool }: DepsApi): Router {
  const r = Router();
  r.get('/', async (req, res) => {
    res.json(await relatorio(pool, consulta(req, filtrosRelatorio)));
  });
  return r;
}
