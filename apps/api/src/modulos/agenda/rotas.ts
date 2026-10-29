import {
  AppError,
  configAgendaEntrada,
  filtrosAgenda,
  tarefaAtualizar,
  tarefaEntrada,
} from '@prospeccao/shared';
import { type Request, Router } from 'express';
import { z } from 'zod';
import { exigirVisivel, travaDaBase } from '../../base.js';
import { donoDaBase } from '../../contexto.js';
import type { DepsApi } from '../../dependencias.js';
import { consulta, corpo, idDaRota } from '../../middlewares/http.js';
import { exigirAdmin } from '../../middlewares/seguranca.js';
import * as repo from './repositorio.js';

/** "eu" → o próprio id; "todos" → null; número → aquela pessoa. */
function quem(req: Request, valor: string): number | null {
  // Quem vê só a própria base vê só a própria agenda.
  if (donoDaBase()) return req.usuario!.id;
  if (valor === 'todos') return null;
  if (valor === 'eu') return req.usuario!.id;
  return Number(valor);
}

export function rotasAgenda({ pool }: DepsApi): Router {
  const r = Router();
  r.param('empresaId', travaDaBase(pool));

  /** Quem vê só a própria base mexe só nas próprias tarefas (e nos próprios leads). */
  const exigirMinha = async (id: number) => {
    const dono = donoDaBase();
    if (!dono) return;
    const t = (await repo.obter(pool, id)) as { usuarioId?: number | null };
    if (t.usuarioId !== dono) throw AppError.naoEncontrado('Tarefa');
  };

  r.get('/', async (req, res) => {
    const f = consulta(req, filtrosAgenda);
    res.json(await repo.listar(pool, f.de, f.ate, quem(req, f.usuario)));
  });

  r.get('/meu-dia', async (req, res) => {
    const { usuario } = consulta(
      req,
      z.object({
        usuario: z
          .string()
          .regex(/^(eu|todos|\d+)$/)
          .default('eu'),
      }),
    );
    res.json(await repo.meuDia(pool, quem(req, usuario)));
  });

  r.get('/lead/:empresaId', async (req, res) => {
    res.json(await repo.doLead(pool, idDaRota(req, 'empresaId')));
  });

  r.get('/config', async (_req, res) => {
    res.json(await repo.obterConfig(pool));
  });

  r.put('/config', exigirAdmin, async (req, res) => {
    await repo.salvarConfig(pool, corpo(req, configAgendaEntrada));
    res.json(await repo.obterConfig(pool));
  });

  r.post('/', async (req, res) => {
    const d = corpo(req, tarefaEntrada);
    const dono = donoDaBase();
    if (dono) {
      if (d.empresaId) await exigirVisivel(pool, d.empresaId);
      d.usuarioId = dono;
    }
    const id = await repo.criar(pool, d);
    res.status(201).json(await repo.obter(pool, id));
  });

  r.patch('/:id', async (req, res) => {
    const id = idDaRota(req);
    await exigirMinha(id);
    const d = corpo(req, tarefaAtualizar);
    if (donoDaBase() && 'usuarioId' in d) d.usuarioId = donoDaBase() ?? undefined;
    await repo.atualizar(pool, id, d);
    res.json(await repo.obter(pool, id));
  });

  r.delete('/:id', async (req, res) => {
    await exigirMinha(idDaRota(req));
    await repo.apagar(pool, idDaRota(req));
    res.status(204).end();
  });

  return r;
}

/** Calendário público por link secreto (o Google Agenda não manda cookie). */
export function rotasCalendario({ pool }: DepsApi): Router {
  const r = Router();
  r.get('/:token', async (req, res) => {
    const token = req.params.token.replace(/\.ics$/, '');
    const ics = await repo.calendario(pool, token);
    if (!ics) {
      res.status(404).type('text/plain').send('Agenda não encontrada.');
      return;
    }
    res.type('text/calendar; charset=utf-8').set('Cache-Control', 'no-cache').send(ics);
  });
  return r;
}
