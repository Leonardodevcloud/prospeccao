import { AppError, filtrosEmpresas } from '@prospeccao/shared';
import { Router } from 'express';
import type { DepsApi } from '../../dependencias.js';
import { consulta, idDaRota } from '../../middlewares/http.js';
import * as repo from './repositorio.js';

export function rotasEmpresas({ pool, filas }: DepsApi): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    res.json(await repo.listar(pool, consulta(req, filtrosEmpresas)));
  });

  r.get('/:id', async (req, res) => {
    const empresa = await repo.obter(pool, idDaRota(req));
    if (!empresa) throw AppError.naoEncontrado('Empresa');
    res.json(empresa);
  });

  /** "Enriquecer de novo": refaz a cascata mesmo que a empresa tenha sido enriquecida há pouco. */
  r.post('/:id/enriquecer', async (req, res) => {
    const id = idDaRota(req);
    const campanhaId = await repo.campanhaDaEmpresa(pool, id);
    if (!campanhaId) throw AppError.naoEncontrado('Empresa');
    await filas.publicar('enriquecimento.solicitar', { empresaId: id, campanhaId, forcar: true });
    res.status(202).json({ mensagem: 'Enriquecimento pedido. A ficha atualiza sozinha em alguns minutos.' });
  });

  return r;
}
