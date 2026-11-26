import {
  configAtendimentoEntrada,
  disponivelEntrada,
  donoEntrada,
  encerrarEntrada,
  etiquetaEntrada,
  filtrosAtendimento,
  importarCarteiraEntrada,
  listaEtiquetas,
  notaInternaEntrada,
  passarCarteiraEntrada,
  periodoPainel,
  transferirEntrada,
} from '@prospeccao/shared';
import { Router } from 'express';
import { z } from 'zod';
import { travaDaBase } from '../../base.js';
import type { DepsApi } from '../../dependencias.js';
import { consulta, corpo, idDaRota } from '../../middlewares/http.js';
import { exigirAdmin } from '../../middlewares/seguranca.js';
import { exigirRecurso } from '../../recursos.js';
import * as repo from './repositorio.js';

/**
 * Atendimento com carteira (recurso `carteira`, plano Escala). Ler as regras vale sempre (a tela
 * mostra o cadeado); o resto passa pela trava do plano.
 */
const etiquetasEntrada = z.object({ etiquetas: listaEtiquetas });

export function rotasCarteira(deps: DepsApi): Router {
  const { pool } = deps;
  const r = Router();
  r.param('empresaId', travaDaBase(pool));
  const admin = (req: { usuario?: { papel: string } }) => req.usuario?.papel === 'admin';

  r.get('/config', async (_req, res) => {
    const [config, etiquetas, carteira] = await Promise.all([
      repo.lerConfig(pool),
      repo.etiquetas(pool),
      repo.resumoCarteira(pool),
    ]);
    res.json({ config, etiquetas, carteira });
  });

  // Daqui para baixo, só com o recurso no plano.
  r.use((_req, _res, next) => {
    exigirRecurso(pool, 'carteira').then(() => next(), next);
  });

  r.put('/config', exigirAdmin, async (req, res) => {
    res.json(await repo.salvarConfig(pool, corpo(req, configAtendimentoEntrada)));
  });

  r.post('/etiquetas', exigirAdmin, async (req, res) => {
    await repo.criarEtiqueta(pool, corpo(req, etiquetaEntrada));
    res.status(201).json(await repo.etiquetas(pool));
  });
  r.put('/etiquetas/:id', exigirAdmin, async (req, res) => {
    await repo.atualizarEtiqueta(pool, idDaRota(req), corpo(req, etiquetaEntrada));
    res.json(await repo.etiquetas(pool));
  });
  r.delete('/etiquetas/:id', exigirAdmin, async (req, res) => {
    await repo.apagarEtiqueta(pool, idDaRota(req));
    res.json(await repo.etiquetas(pool));
  });

  r.get('/filas', async (req, res) => {
    res.json(await repo.contarFilas(pool, req.usuario!.id, admin(req)));
  });

  r.get('/atendimentos', async (req, res) => {
    res.json(
      await repo.listarAtendimentos(pool, consulta(req, filtrosAtendimento), req.usuario!.id, admin(req)),
    );
  });

  r.get('/pessoas', async (_req, res) => {
    const [pessoas, grupos] = await Promise.all([repo.pessoas(pool), repo.grupos(pool)]);
    res.json({ pessoas, grupos });
  });

  r.put('/disponivel', async (req, res) => {
    res.json(await repo.marcarDisponivel(pool, corpo(req, disponivelEntrada).disponivel));
  });

  r.get('/painel', exigirAdmin, async (req, res) => {
    const f = consulta(req, periodoPainel);
    res.json(await repo.painel(pool, f.periodo, f.grupo));
  });

  r.post('/passar', exigirAdmin, async (req, res) => {
    res.json(await repo.passarCarteira(pool, corpo(req, passarCarteiraEntrada)));
  });

  r.post('/importar', exigirAdmin, async (req, res) => {
    res.json(await repo.importarCarteira(deps, corpo(req, importarCarteiraEntrada)));
  });

  /* O atendimento de um cliente */

  r.get('/cliente/:empresaId', async (req, res) => {
    res.json(await repo.doCliente(pool, idDaRota(req, 'empresaId')));
  });

  r.post('/cliente/:empresaId/assumir', async (req, res) => {
    const id = idDaRota(req, 'empresaId');
    await repo.assumir(pool, id);
    res.json(await repo.doCliente(pool, id));
  });

  r.post('/cliente/:empresaId/transferir', async (req, res) => {
    const id = idDaRota(req, 'empresaId');
    await repo.transferir(pool, id, corpo(req, transferirEntrada));
    res.json(await repo.doCliente(pool, id));
  });

  r.post('/cliente/:empresaId/encerrar', async (req, res) => {
    const id = idDaRota(req, 'empresaId');
    const r2 = await repo.encerrar(deps, id, corpo(req, encerrarEntrada));
    res.json({ ...r2, cliente: await repo.doCliente(pool, id) });
  });

  r.post('/cliente/:empresaId/reabrir', async (req, res) => {
    const id = idDaRota(req, 'empresaId');
    await repo.reabrir(pool, id);
    res.json(await repo.doCliente(pool, id));
  });

  r.post('/cliente/:empresaId/nota', async (req, res) => {
    const id = idDaRota(req, 'empresaId');
    await repo.notaInterna(pool, id, corpo(req, notaInternaEntrada).texto);
    res.status(201).json(await repo.doCliente(pool, id));
  });

  r.put('/cliente/:empresaId/etiquetas', async (req, res) => {
    const id = idDaRota(req, 'empresaId');
    await repo.etiquetarAtendimento(pool, id, corpo(req, etiquetasEntrada).etiquetas);
    res.json(await repo.doCliente(pool, id));
  });

  r.put('/cliente/:empresaId/etiquetas-cliente', async (req, res) => {
    const id = idDaRota(req, 'empresaId');
    await repo.etiquetarCliente(pool, id, corpo(req, etiquetasEntrada).etiquetas);
    res.json(await repo.doCliente(pool, id));
  });

  r.put('/cliente/:empresaId/dono', exigirAdmin, async (req, res) => {
    const id = idDaRota(req, 'empresaId');
    await repo.trocarDono(pool, id, corpo(req, donoEntrada).usuarioId);
    res.json(await repo.doCliente(pool, id));
  });

  return r;
}
