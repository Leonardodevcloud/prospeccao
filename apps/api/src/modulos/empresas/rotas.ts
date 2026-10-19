import { AppError, filtrosEmpresas } from '@prospeccao/shared';
import { Router } from 'express';
import type { DepsApi } from '../../dependencias.js';
import { consulta, idDaRota } from '../../middlewares/http.js';
import * as repo from './repositorio.js';

export function rotasEmpresas({ pool }: DepsApi): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    res.json(await repo.listar(pool, consulta(req, filtrosEmpresas)));
  });

  r.get('/:id', async (req, res) => {
    const empresa = await repo.obter(pool, idDaRota(req));
    if (!empresa) throw AppError.naoEncontrado('Empresa');
    res.json(empresa);
  });

  return r;
}
