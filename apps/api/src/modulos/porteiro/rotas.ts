import { porteiroEntrada } from '@prospeccao/shared';
import { Router } from 'express';
import { conta, contaSql } from '../../contexto.js';
import type { DepsApi } from '../../dependencias.js';
import { corpo, idDaRota } from '../../middlewares/http.js';
import { exigirAdmin } from '../../middlewares/seguranca.js';
import * as alertas from '../alertas/repositorio.js';
import * as regras from './regras.js';

/** Porteiro do WhatsApp: todos veem como está o número; o administrador configura e libera. */
export function rotasPorteiro(deps: DepsApi): Router {
  const { pool } = deps;
  const r = Router();

  r.get('/', async (_req, res) => {
    res.json(await regras.painel(pool));
  });

  r.put('/', exigirAdmin, async (req, res) => {
    await regras.salvarConfig(pool, corpo(req, porteiroEntrada));
    res.json(await regras.painel(pool));
  });

  /** Tira a pausa dos contatos novos antes da hora (os sinais contam de novo a partir de agora). */
  r.post('/numeros/:id/liberar', exigirAdmin, async (req, res) => {
    const id = idDaRota(req);
    const { rowCount } = await pool.query(
      `UPDATE comercial.chips SET frios_ate = now() WHERE id = $1 AND conta_id = ${contaSql()} AND frios_ate > now()`,
      [id],
    );
    if (rowCount) {
      await alertas.fechar(pool, conta(), `porteiro:${id}`);
      await regras.registrar(pool, {
        tipo: 'risco',
        chipId: id,
        empresaId: null,
        detalhe: `Liberado à mão por ${req.usuario?.nome ?? 'administrador'}.`,
      });
    }
    res.json(await regras.painel(pool));
  });

  return r;
}
