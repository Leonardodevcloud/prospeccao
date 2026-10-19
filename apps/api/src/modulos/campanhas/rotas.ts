import { AppError, campanhaAtualizacao, campanhaEntrada, type StatusCampanha } from '@prospeccao/shared';
import { Router } from 'express';
import type { DepsApi } from '../../dependencias.js';
import { corpo, idDaRota } from '../../middlewares/http.js';
import * as repo from './repositorio.js';

/** De onde cada status pode ir. */
const TRANSICOES: Record<StatusCampanha, StatusCampanha[]> = {
  rascunho: ['ativa', 'encerrada'],
  ativa: ['pausada', 'encerrada'],
  pausada: ['ativa', 'encerrada'],
  encerrada: [],
};

export function rotasCampanhas({ pool, filas, log }: DepsApi): Router {
  const r = Router();

  async function transicionar(id: number, para: StatusCampanha) {
    const atual = await repo.statusAtual(pool, id);
    if (!atual) throw AppError.naoEncontrado('Campanha');
    if (atual === para) return;
    if (!TRANSICOES[atual].includes(para)) {
      throw AppError.conflito(`Uma campanha ${atual} não pode ir para ${para}.`);
    }
    await repo.mudarStatus(pool, id, para);
  }

  r.get('/', async (_req, res) => {
    res.json(await repo.listar(pool));
  });

  r.post('/', async (req, res) => {
    const dados = corpo(req, campanhaEntrada);
    if (!(await repo.nichoAtivo(pool, dados.nichoId)))
      throw AppError.invalido('Nicho inexistente ou desativado.');
    const id = await repo.criar(pool, dados);
    res.status(201).json(await repo.obter(pool, id));
  });

  r.get('/:id', async (req, res) => {
    const campanha = await repo.obter(pool, idDaRota(req));
    if (!campanha) throw AppError.naoEncontrado('Campanha');
    res.json(campanha);
  });

  r.patch('/:id', async (req, res) => {
    const id = idDaRota(req);
    const dados = corpo(req, campanhaAtualizacao);
    const atual = await repo.statusAtual(pool, id);
    if (!atual) throw AppError.naoEncontrado('Campanha');
    if (atual === 'encerrada') throw AppError.conflito('Campanha encerrada não pode ser alterada.');
    if (dados.nichoId && !(await repo.nichoAtivo(pool, dados.nichoId))) {
      throw AppError.invalido('Nicho inexistente ou desativado.');
    }
    await repo.atualizar(pool, id, dados);
    res.json(await repo.obter(pool, id));
  });

  /** Ativa (ou retoma) e dispara a descoberta. */
  r.post('/:id/iniciar', async (req, res) => {
    const id = idDaRota(req);
    await transicionar(id, 'ativa');
    await filas.publicar('campanha.iniciar', { campanhaId: id });
    log.info({ campanhaId: id }, 'campanha iniciada');
    const avisos = (await repo.baseCnpjImportada(pool))
      ? []
      : ['A base de CNPJ ainda não foi importada: por enquanto só o Google Maps vai trazer empresas.'];
    res.status(202).json({ campanha: await repo.obter(pool, id), avisos });
  });

  r.post('/:id/pausar', async (req, res) => {
    const id = idDaRota(req);
    await transicionar(id, 'pausada');
    res.json(await repo.obter(pool, id));
  });

  /**
   * Refaz o enriquecimento de todas as empresas da campanha (ex.: depois de ligar uma fonte nova).
   * Custa de novo no Apify e no Gemini; a tela pede confirmação antes.
   */
  r.post('/:id/reenriquecer', async (req, res) => {
    const id = idDaRota(req);
    const { rows } = await pool.query<{ empresa_id: number }>(
      // Descartados (fora do perfil) não gastam Apify/Gemini de novo.
      `SELECT ce.empresa_id FROM descoberta.campanha_empresas ce
        WHERE ce.campanha_id = $1
          AND NOT EXISTS (SELECT 1 FROM comercial.v_empresas_descartadas d WHERE d.empresa_id = ce.empresa_id)
        ORDER BY ce.empresa_id`,
      [id],
    );
    if (!rows.length) throw AppError.invalido('A campanha ainda não tem empresas.');
    for (const r of rows) {
      await filas.publicar('enriquecimento.solicitar', {
        empresaId: r.empresa_id,
        campanhaId: id,
        forcar: true,
      });
    }
    log.info({ campanhaId: id, empresas: rows.length }, 'enriquecimento refeito para a campanha');
    res.status(202).json({ quantidade: rows.length });
  });

  r.post('/:id/encerrar', async (req, res) => {
    const id = idDaRota(req);
    await transicionar(id, 'encerrada');
    res.json(await repo.obter(pool, id));
  });

  return r;
}
