import { inscricaoPush } from '@prospeccao/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { DepsApi } from '../../dependencias.js';
import { corpo, idDaRota } from '../../middlewares/http.js';
import * as push from '../push/servico.js';
import * as repo from './repositorio.js';

export function rotasNotificacoes({ pool }: DepsApi): Router {
  const r = Router();

  /* Notificação no celular */
  r.get('/push', async (req, res) => {
    res.json({ chave: push.chavePublica(), aparelhos: await push.aparelhos(pool, req.usuario!.id) });
  });
  r.post('/push', async (req, res) => {
    await push.inscrever(pool, req.usuario!.id, corpo(req, inscricaoPush));
    res.status(201).json({ aparelhos: await push.aparelhos(pool, req.usuario!.id) });
  });
  r.delete('/push', async (req, res) => {
    const { endpoint } = corpo(req, z.object({ endpoint: z.string().url().max(1000) }));
    await push.cancelar(pool, req.usuario!.id, endpoint);
    res.json({ aparelhos: await push.aparelhos(pool, req.usuario!.id) });
  });
  r.post('/push/teste', async (req, res) => {
    const n = await push.enviarPush(req.usuario!.id, {
      titulo: 'Notificações ligadas',
      texto: 'É assim que você vai saber quando um lead responder.',
      link: '/hoje',
    });
    res.json({ enviados: n });
  });

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
