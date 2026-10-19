import {
  AppError,
  atividadeEntrada,
  configCadenciaEntrada,
  etapaAtualizar,
  etapaEntrada,
  filtrosFunil,
  funilAdicionar,
  funilAtualizar,
  pipelineEntrada,
} from '@prospeccao/shared';
import { type Request, Router } from 'express';
import type { DepsApi } from '../../dependencias.js';
import { consulta, corpo, idDaRota } from '../../middlewares/http.js';
import { exigirAdmin } from '../../middlewares/seguranca.js';
import * as cadencia from './cadencia.js';
import * as pipelines from './pipelines.js';
import * as repo from './repositorio.js';

const autor = (req: Request) => req.usuario?.nome ?? 'sistema';

export function rotasFunil({ pool, log }: DepsApi): Router {
  const r = Router();

  /** Quadro: cards de todas as etapas (menos descartados) e quantos follow-ups vencem hoje. */
  r.get('/', async (req, res) => {
    res.json(await repo.quadro(pool, consulta(req, filtrosFunil)));
  });

  /** Manda leads para o funil ou descarta, em lote, sem duplicar. */
  r.post('/', async (req, res) => {
    res.json(await repo.adicionar(pool, corpo(req, funilAdicionar), autor(req)));
  });

  /** Para o menu: os seus follow-ups (o administrador vê os de todos). */
  r.get('/resumo', async (req, res) => {
    res.json(await repo.resumo(pool, req.usuario?.papel === 'admin' ? null : (req.usuario?.id ?? null)));
  });

  r.get('/etiquetas', async (_req, res) => {
    const { rows } = await pool.query<{ e: string }>(
      'SELECT DISTINCT unnest(etiquetas) AS e FROM comercial.oportunidades ORDER BY 1 LIMIT 200',
    );
    res.json(rows.map((x) => x.e));
  });

  /** Pipelines e etapas (SDR, Closer…), editáveis. */
  r.get('/pipelines', async (_req, res) => {
    res.json(await pipelines.listar(pool));
  });
  r.post('/pipelines', exigirAdmin, async (req, res) => {
    const id = await pipelines.criarPipeline(pool, corpo(req, pipelineEntrada).nome);
    res.status(201).json({ id });
  });
  r.patch('/pipelines/:id', exigirAdmin, async (req, res) => {
    await pipelines.renomearPipeline(pool, idDaRota(req), corpo(req, pipelineEntrada).nome);
    res.json(await pipelines.listar(pool));
  });
  r.delete('/pipelines/:id', exigirAdmin, async (req, res) => {
    await pipelines.apagarPipeline(pool, idDaRota(req));
    res.status(204).end();
  });
  r.post('/pipelines/:id/etapas', exigirAdmin, async (req, res) => {
    const id = await pipelines.criarEtapa(pool, idDaRota(req), corpo(req, etapaEntrada));
    res.status(201).json({ id });
  });
  r.patch('/etapas/:id', exigirAdmin, async (req, res) => {
    await pipelines.atualizarEtapa(pool, idDaRota(req), corpo(req, etapaAtualizar));
    res.json(await pipelines.listar(pool));
  });
  r.delete('/etapas/:id', exigirAdmin, async (req, res) => {
    await pipelines.apagarEtapa(pool, idDaRota(req));
    res.status(204).end();
  });

  /** Cadência de follow-up e modelos de mensagem. */
  r.get('/cadencia', async (_req, res) => {
    res.json(await cadencia.obterConfig(pool));
  });

  r.put('/cadencia', exigirAdmin, async (req, res) => {
    const dados = corpo(req, configCadenciaEntrada);
    await cadencia.salvarConfig(pool, dados);
    log.info({ diasFollowup: dados.diasFollowup, diasEncerrar: dados.diasEncerrar }, 'cadência atualizada');
    res.json(await cadencia.obterConfig(pool));
  });

  r.get('/:empresaId', async (req, res) => {
    res.json(await repo.detalhe(pool, idDaRota(req, 'empresaId')));
  });

  /** Mensagem pronta do próximo envio (WhatsApp), com nome, empresa e cidade. */
  r.get('/:empresaId/mensagem', async (req, res) => {
    res.json(await cadencia.mensagemDoLead(pool, idDaRota(req, 'empresaId')));
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
  r.delete('/:empresaId', exigirAdmin, async (req, res) => {
    if (!(await repo.remover(pool, idDaRota(req, 'empresaId'))))
      throw AppError.naoEncontrado('Lead no funil');
    res.status(204).end();
  });

  return r;
}
