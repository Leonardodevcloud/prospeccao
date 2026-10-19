import {
  AppError,
  campanhaAtualizacao,
  campanhaEntrada,
  reenriquecerEntrada,
  type StatusCampanha,
} from '@prospeccao/shared';
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

  /** Quantos leads cada opção de "refazer enriquecimento" mandaria para a fila (para confirmar). */
  r.get('/:id/reenriquecer', async (req, res) => {
    res.json(await repo.previaReenriquecer(pool, idDaRota(req)));
  });

  /**
   * Refaz o enriquecimento de uma parte da campanha: "ab" (notas A e B), "sem_decisor" ou "todos".
   * MEI e descartados ficam sempre de fora. Custa de novo no Apify e no Gemini; a tela confirma antes.
   */
  r.post('/:id/reenriquecer', async (req, res) => {
    const id = idDaRota(req);
    const { escopo } = corpo(req, reenriquecerEntrada);
    const empresas = await repo.empresasParaReenriquecer(pool, id, escopo);
    if (!empresas.length) throw AppError.invalido('Nenhum lead nessa opção para enriquecer de novo.');
    const quantidade = await filas.publicarVarios(
      'enriquecimento.solicitar',
      empresas.map((empresaId) => ({ empresaId, campanhaId: id, forcar: true })),
    );
    log.info({ campanhaId: id, escopo, empresas: empresas.length, quantidade }, 'enriquecimento refeito');
    res.status(202).json({ quantidade });
  });

  r.post('/:id/encerrar', async (req, res) => {
    const id = idDaRota(req);
    await transicionar(id, 'encerrada');
    res.json(await repo.obter(pool, id));
  });

  return r;
}
