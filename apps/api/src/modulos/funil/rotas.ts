import { AppError, atividadeEntrada, filtrosFunil, funilAdicionar, funilAtualizar } from '@prospeccao/shared';
import { type Request, Router } from 'express';
import type { DepsApi } from '../../dependencias.js';
import { consulta, corpo, idDaRota } from '../../middlewares/http.js';
import * as repo from './repositorio.js';

const autor = (req: Request) => req.usuario?.email ?? 'sistema';

export function rotasFunil({ pool }: DepsApi): Router {
  const r = Router();

  /** Quadro: cards de todas as etapas (menos descartados) e quantos follow-ups vencem hoje. */
  r.get('/', async (req, res) => {
    res.json(await repo.quadro(pool, consulta(req, filtrosFunil)));
  });

  /** Manda leads para o funil ou descarta, em lote, sem duplicar. */
  r.post('/', async (req, res) => {
    res.json(await repo.adicionar(pool, corpo(req, funilAdicionar), autor(req)));
  });

  r.get('/resumo', async (_req, res) => {
    res.json(await repo.resumo(pool));
  });

  r.get('/:empresaId', async (req, res) => {
    res.json(await repo.detalhe(pool, idDaRota(req, 'empresaId')));
  });

  /** Mover de etapa, reordenar, próximo passo, valor. */
  r.patch('/:empresaId', async (req, res) => {
    const id = idDaRota(req, 'empresaId');
    await repo.atualizar(pool, id, corpo(req, funilAtualizar), autor(req));
    res.json(await repo.detalhe(pool, id));
  });

  /** Registrar contato feito/recebido ou nota. */
  r.post('/:empresaId/atividades', async (req, res) => {
    const id = idDaRota(req, 'empresaId');
    await repo.registrarAtividade(pool, id, corpo(req, atividadeEntrada), autor(req));
    res.status(201).json(await repo.detalhe(pool, id));
  });

  /** Tira do funil (apaga o histórico): o lead volta a ser "novo". */
  r.delete('/:empresaId', async (req, res) => {
    if (!(await repo.remover(pool, idDaRota(req, 'empresaId'))))
      throw AppError.naoEncontrado('Lead no funil');
    res.status(204).end();
  });

  return r;
}
