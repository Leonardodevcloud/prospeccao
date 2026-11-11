import { Router } from 'express';
import { z } from 'zod';
import type { DepsApi } from '../../dependencias.js';
import { corpo } from '../../middlewares/http.js';
import { exigirAdmin, semDiretoria } from '../../middlewares/seguranca.js';
import { oQueAprendeu } from '../carrosseis/aprender.js';
import * as servico from './servico.js';

/**
 * Gestão › Integrações › Segundo cérebro (v147): qualquer conta liga, só o administrador mexe.
 * O token do Cérebro entra uma vez, fica cifrado e nunca volta para a tela (só os 4 últimos).
 */
export function rotasSegundoCerebro(deps: DepsApi): Router {
  const { pool } = deps;
  const r = Router();
  r.use(exigirAdmin);

  r.get('/', async (_req, res) => {
    res.json(await servico.estado(pool));
  });

  r.put('/', semDiretoria, async (req, res) => {
    const d = corpo(
      req,
      z.object({ url: z.string().trim().min(4).max(500), token: z.string().trim().min(10).max(300) }),
    );
    res.json(await servico.conectar(pool, d));
  });

  r.post('/testar', async (_req, res) => {
    res.json(await servico.testar(pool));
  });

  r.patch('/', async (req, res) => {
    const d = corpo(
      req,
      z.object({ ligado: z.boolean().optional(), enviarAprendizados: z.boolean().optional() }),
    );
    res.json(await servico.ajustar(pool, d));
  });

  r.delete('/', async (_req, res) => {
    await servico.desconectar(pool);
    res.json({ ok: true });
  });

  /** Lê o Cérebro como o time leria (a tela mostra o que voltou: "o que os agentes vão ver"). */
  r.post('/experimentar', async (req, res) => {
    const { pergunta } = corpo(req, z.object({ pergunta: z.string().trim().min(3).max(300) }));
    res.json({
      itens: await servico.trechosParaOTime(pool, [pergunta], { max: 6 }),
      estado: await servico.estado(pool),
    });
  });

  r.post('/enviar-agora', async (_req, res) => {
    const feito = await servico.enviarAprendizados(pool, () => oQueAprendeu(pool));
    res.json({ ...feito, estado: await servico.estado(pool) });
  });

  return r;
}
