import { cartaoMoverEntrada, cartaoNovoEntrada, quadroEntrada } from '@prospeccao/shared';
import { Router } from 'express';
import { z } from 'zod';
import { exigirLeadDaConta, travaDaBase } from '../../base.js';
import { donoDaBase } from '../../contexto.js';
import type { DepsApi } from '../../dependencias.js';
import { consulta, corpo, idDaRota } from '../../middlewares/http.js';
import { exigirAdmin } from '../../middlewares/seguranca.js';
import * as repo from './repositorio.js';

/** Quadros com gatilhos da IA: o administrador monta; todo mundo move os leads que vê. */
export function rotasQuadros(deps: DepsApi): Router {
  const { pool } = deps;
  const r = Router();
  // Quem vê só a própria base não mexe em lead de colega.
  r.param('empresaId', travaDaBase(pool));

  r.get('/', async (_req, res) => {
    res.json(await repo.listar(pool));
  });

  r.post('/', exigirAdmin, async (req, res) => {
    res.status(201).json(await repo.criar(pool, corpo(req, quadroEntrada)));
  });

  r.put('/:id', exigirAdmin, async (req, res) => {
    res.json(await repo.atualizar(pool, idDaRota(req), corpo(req, quadroEntrada)));
  });

  r.delete('/:id', exigirAdmin, async (req, res) => {
    await repo.apagar(pool, idDaRota(req));
    res.json(await repo.listar(pool));
  });

  r.get('/leads', async (req, res) => {
    const f = consulta(req, z.object({ busca: z.string().trim().max(80).default('') }));
    res.json(await repo.buscarLeads(pool, f.busca));
  });

  r.get('/:id/cartoes', async (req, res) => {
    const f = consulta(
      req,
      z.object({
        responsavel: z
          .string()
          .regex(/^(eu|todos|\d+)$/)
          .default('todos'),
      }),
    );
    const eu = req.usuario!.id;
    const responsavel =
      donoDaBase() ??
      (f.responsavel === 'todos' ? null : f.responsavel === 'eu' ? eu : Number(f.responsavel));
    // Na fila, quem vê só a própria base vê também os sem dono: aí o filtro "meus" não se aplica.
    res.json(await repo.cartoes(pool, idDaRota(req), { responsavel: donoDaBase() ? null : responsavel }));
  });

  r.post('/:id/cartoes', async (req, res) => {
    const d = corpo(req, cartaoNovoEntrada);
    // Lead desta conta que esta pessoa vê (a base de empresas é de todas as contas).
    await exigirLeadDaConta(pool, d.empresaId);
    await repo.mover(pool, idDaRota(req), d.empresaId, d.colunaId);
    res.status(201).json({ ok: true });
  });

  r.patch('/:id/cartoes/:empresaId', async (req, res) => {
    await repo.mover(
      pool,
      idDaRota(req),
      idDaRota(req, 'empresaId'),
      corpo(req, cartaoMoverEntrada).colunaId,
    );
    res.json({ ok: true });
  });

  r.post('/:id/cartoes/:empresaId/confirmar', async (req, res) => {
    await repo.confirmar(pool, idDaRota(req), idDaRota(req, 'empresaId'));
    res.json({ ok: true });
  });

  r.post('/:id/cartoes/:empresaId/descartar', async (req, res) => {
    await repo.descartar(pool, idDaRota(req), idDaRota(req, 'empresaId'));
    res.json({ ok: true });
  });

  r.delete('/:id/cartoes/:empresaId', async (req, res) => {
    await repo.tirar(pool, idDaRota(req), idDaRota(req, 'empresaId'));
    res.json({ ok: true });
  });

  return r;
}
