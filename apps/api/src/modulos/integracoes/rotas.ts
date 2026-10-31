import { avisoEntrada, chaveApiEntrada, formularioSiteEntrada } from '@prospeccao/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { DepsApi } from '../../dependencias.js';
import { urlPublicaApi } from '../../endereco.js';
import { corpo, idDaRota } from '../../middlewares/http.js';
import { exigirAdmin } from '../../middlewares/seguranca.js';
import { temRecurso } from '../../recursos.js';
import * as avisos from './avisos.js';
import * as chaves from './chaves.js';
import * as formularios from './formularios.js';

/**
 * Gestão › Integrações (só o administrador): chaves da API, formulários do site e avisos.
 * O resumo (GET /) vale sempre (a tela mostra o cadeado quando o plano não tem); o resto precisa
 * do recurso "api" (a trava fica no app.ts).
 */
export function rotasIntegracoes(deps: DepsApi): Router {
  const { pool } = deps;
  const r = Router();
  r.use(exigirAdmin);
  const opcoes = () => ({ chave: deps.credenciais.chave });

  r.get('/', async (_req, res) => {
    const plano = await temRecurso(pool, 'api');
    const base = `${urlPublicaApi(deps.origens)}/v1`;
    if (!plano) return void res.json({ plano, base, uso: null, chaves: [] });
    res.json({ plano, base, uso: await chaves.uso(pool), chaves: await chaves.listar(pool) });
  });

  /* ───── Chaves ───── */

  r.post('/chaves', async (req, res) => {
    const d = corpo(req, chaveApiEntrada);
    res.status(201).json(await chaves.criar(pool, d));
  });

  r.delete('/chaves/:id', async (req, res) => {
    await chaves.revogar(pool, idDaRota(req));
    res.json({ ok: true });
  });

  /* ───── Formulários do site ───── */

  r.get('/formularios', async (_req, res) => {
    res.json(await formularios.listar(pool));
  });

  r.post('/formularios', async (req, res) => {
    const { nome } = corpo(req, z.object({ nome: z.string().trim().min(2).max(80) }));
    res.status(201).json({ id: await formularios.criar(pool, nome) });
  });

  r.put('/formularios/:id', async (req, res) => {
    await formularios.salvar(pool, idDaRota(req), corpo(req, formularioSiteEntrada));
    res.json({ ok: true });
  });

  r.delete('/formularios/:id', async (req, res) => {
    await formularios.apagar(pool, idDaRota(req));
    res.json({ ok: true });
  });

  r.get('/formularios/:id/envios', async (req, res) => {
    res.json(await formularios.envios(pool, idDaRota(req)));
  });

  /* ───── Avisos ───── */

  r.get('/avisos', async (_req, res) => {
    res.json(await avisos.listar(pool));
  });

  r.post('/avisos', async (req, res) => {
    res.status(201).json(await avisos.criar(pool, opcoes(), corpo(req, avisoEntrada)));
  });

  r.put('/avisos/:id', async (req, res) => {
    await avisos.atualizar(pool, idDaRota(req), corpo(req, avisoEntrada));
    res.json({ ok: true });
  });

  for (const [acao, situacao] of [
    ['pausar', 'pausado'],
    ['ativar', 'ativo'],
  ] as const)
    r.post(`/avisos/:id/${acao}`, async (req, res) => {
      await avisos.mudarSituacao(pool, idDaRota(req), situacao);
      res.json({ ok: true });
    });

  r.delete('/avisos/:id', async (req, res) => {
    await avisos.apagar(pool, idDaRota(req));
    res.json({ ok: true });
  });

  r.get('/avisos/:id/entregas', async (req, res) => {
    res.json(await avisos.entregas(pool, idDaRota(req)));
  });

  r.post('/avisos/:id/testar', async (req, res) => {
    res.status(201).json({ id: await avisos.testar(pool, idDaRota(req)) });
  });

  r.get('/avisos/:id/segredo', async (req, res) => {
    res.json({ segredo: await avisos.segredo(pool, opcoes(), idDaRota(req)) });
  });

  r.post('/avisos/:id/segredo', async (req, res) => {
    res.json({ segredo: await avisos.trocarSegredo(pool, opcoes(), idDaRota(req)) });
  });

  r.post('/entregas/:id/reenviar', async (req, res) => {
    await avisos.reenviar(pool, idDaRota(req));
    res.json({ ok: true });
  });

  return r;
}
