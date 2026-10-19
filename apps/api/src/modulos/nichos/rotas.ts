import { AppError, nichoAtualizacao, nichoEntrada } from '@prospeccao/shared';
import { Router } from 'express';
import type { DepsApi } from '../../dependencias.js';
import { corpo, idDaRota } from '../../middlewares/http.js';
import * as repo from './repositorio.js';

function conflitoDeNome(erro: unknown): never {
  if ((erro as { code?: string }).code === '23505')
    throw AppError.conflito('Já existe um nicho ativo com esse nome.');
  throw erro;
}

export function rotasNichos({ pool }: DepsApi): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    res.json(await repo.listar(pool, req.query.todos === 'true'));
  });

  r.post('/', async (req, res) => {
    const dados = corpo(req, nichoEntrada);
    const id = await repo.criar(pool, dados).catch(conflitoDeNome);
    res.status(201).json(await repo.obter(pool, id));
  });

  r.get('/:id', async (req, res) => {
    const nicho = await repo.obter(pool, idDaRota(req));
    if (!nicho) throw AppError.naoEncontrado('Nicho');
    res.json(nicho);
  });

  r.patch('/:id', async (req, res) => {
    const id = idDaRota(req);
    const dados = corpo(req, nichoAtualizacao);
    if (!(await repo.atualizar(pool, id, dados).catch(conflitoDeNome))) throw AppError.naoEncontrado('Nicho');
    res.json(await repo.obter(pool, id));
  });

  /** Desativa (não apaga): campanhas antigas continuam apontando para ele. */
  r.delete('/:id', async (req, res) => {
    const id = idDaRota(req);
    const nicho = await repo.obter(pool, id);
    if (!nicho) throw AppError.naoEncontrado('Nicho');
    if (nicho.campanhasEmAndamento > 0) {
      throw AppError.conflito('Este nicho tem campanhas ativas ou pausadas. Encerre-as antes de desativar.');
    }
    await repo.atualizar(pool, id, { ativo: false });
    res.status(204).end();
  });

  return r;
}
