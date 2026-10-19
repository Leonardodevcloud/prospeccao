import { configPlacesEntrada } from '@prospeccao/shared';
import { Router } from 'express';
import type { DepsApi } from '../../dependencias.js';
import { corpo } from '../../middlewares/http.js';
import * as repo from './repositorio.js';

/** Painel "Google Places": uso do mês, custo e tabela de preços. */
export function rotasPlaces({ pool, log }: DepsApi): Router {
  const r = Router();

  r.get('/uso', async (_req, res) => {
    res.json(await repo.resumoDoMes(pool));
  });

  r.get('/config', async (_req, res) => {
    res.json(await repo.obterConfig(pool));
  });

  r.put('/config', async (req, res) => {
    const dados = corpo(req, configPlacesEntrada);
    await repo.salvarConfig(pool, dados);
    log.info(dados, 'tabela do Google Places atualizada');
    res.json(await repo.obterConfig(pool));
  });

  return r;
}
