import { AppError, configPlacesEntrada } from '@prospeccao/shared';
import { Router } from 'express';
import type { DepsApi } from '../../dependencias.js';
import { corpo } from '../../middlewares/http.js';
import { exigirAdmin } from '../../middlewares/seguranca.js';
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

  // Muda o teto de gasto: só o administrador. Na chave do Google da plataforma, quem paga é a
  // plataforma: só o master mexe.
  r.put('/config', exigirAdmin, async (req, res) => {
    if (!req.usuario?.master && (await repo.usaChaveDaPlataforma(pool)))
      throw AppError.proibido(
        'Esta conta usa a chave do Google da plataforma: o limite de gasto é ajustado pelo Prospect Team.',
      );
    const dados = corpo(req, configPlacesEntrada);
    await repo.salvarConfig(pool, dados);
    log.info(dados, 'tabela do Google Places atualizada');
    res.json(await repo.obterConfig(pool));
  });

  return r;
}
