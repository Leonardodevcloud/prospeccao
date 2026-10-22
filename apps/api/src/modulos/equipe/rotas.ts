import { distribuicaoEntrada, usuarioAtualizar, usuarioNovo } from '@prospeccao/shared';
import { type Request, Router } from 'express';
import { z } from 'zod';
import { conta } from '../../contexto.js';
import type { DepsApi } from '../../dependencias.js';
import { consulta, corpo, idDaRota } from '../../middlewares/http.js';
import { exigirAdmin } from '../../middlewares/seguranca.js';
import { planoDaConta } from '../plano/repositorio.js';
import * as repo from './repositorio.js';

/** Endereço da tela (para o link do convite): a origem do navegador ou a primeira configurada. */
function enderecoDoApp(req: Request, origens: string[]): string {
  const origem = req.get('origin');
  if (origem && origens.includes(origem.toLowerCase())) return origem;
  return origens[0] ?? '';
}

export function rotasEquipe({ pool, origens }: DepsApi): Router {
  const r = Router();
  const link = (req: Request, token: string) => `${enderecoDoApp(req, origens)}/convite/${token}`;

  /** O plano da conta: o que está contratado e quanto já foi usado no mês. */
  r.get('/plano', async (_req, res) => {
    res.json(await planoDaConta(pool, conta()));
  });

  r.get('/', async (_req, res) => {
    res.json(await repo.listar(pool));
  });

  r.get('/desempenho', async (req, res) => {
    const { dias } = consulta(req, z.object({ dias: z.coerce.number().int().min(0).max(3650).default(30) }));
    res.json(await repo.desempenho(pool, dias));
  });

  r.post('/', exigirAdmin, async (req, res) => {
    const { id, token } = await repo.criar(pool, corpo(req, usuarioNovo));
    res.status(201).json({ id, convite: link(req, token), diasValidade: repo.DIAS_CONVITE });
  });

  r.patch('/:id', exigirAdmin, async (req, res) => {
    await repo.atualizar(pool, idDaRota(req), corpo(req, usuarioAtualizar));
    res.json(await repo.listar(pool));
  });

  r.post('/:id/convite', exigirAdmin, async (req, res) => {
    const token = await repo.novoConvite(pool, idDaRota(req));
    res.json({ convite: link(req, token), diasValidade: repo.DIAS_CONVITE });
  });

  r.put('/distribuicao', exigirAdmin, async (req, res) => {
    await repo.salvarDistribuicao(pool, corpo(req, distribuicaoEntrada));
    res.json({ ok: true });
  });

  r.post('/distribuir', exigirAdmin, async (_req, res) => {
    res.json({ distribuidos: await repo.distribuirSemDono(pool) });
  });

  return r;
}
