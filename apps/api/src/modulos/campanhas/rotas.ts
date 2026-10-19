import {
  AppError,
  apagarCampanhaEntrada,
  campanhaAtualizacao,
  campanhaEntrada,
  iniciarCampanhaEntrada,
  reenriquecerEntrada,
  type StatusCampanha,
  tetoPlacesEntrada,
} from '@prospeccao/shared';
import { Router } from 'express';
import type { DepsApi } from '../../dependencias.js';
import { corpo, idDaRota } from '../../middlewares/http.js';
import { estimativaCampanha } from '../places/repositorio.js';
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

  /** Quanto a campanha vai gastar no Google Places se rodar agora (a tela confirma antes). */
  r.get('/:id/estimativa-places', async (req, res) => {
    const estimativa = await estimativaCampanha(pool, idDaRota(req));
    if (!estimativa) throw AppError.naoEncontrado('Campanha');
    res.json(estimativa);
  });

  /** Troca o teto de gasto da campanha no Google (null = sem teto; 0 = só a franquia grátis). */
  r.put('/:id/teto-places', async (req, res) => {
    const id = idDaRota(req);
    const { tetoPlacesUsd } = corpo(req, tetoPlacesEntrada);
    if (!(await repo.statusAtual(pool, id))) throw AppError.naoEncontrado('Campanha');
    await repo.mudarTetoPlaces(pool, id, tetoPlacesUsd);
    res.json(await repo.obter(pool, id));
  });

  /**
   * Ativa (ou retoma) e dispara a descoberta. Buscas paradas no teto voltam para a fila.
   * Opcional: `tetoPlacesUsd` troca o teto da campanha junto (escolha feita na estimativa).
   */
  r.post('/:id/iniciar', async (req, res) => {
    const id = idDaRota(req);
    const { tetoPlacesUsd } = corpo(req, iniciarCampanhaEntrada);
    if (tetoPlacesUsd !== undefined) {
      if (!(await repo.statusAtual(pool, id))) throw AppError.naoEncontrado('Campanha');
      await repo.mudarTetoPlaces(pool, id, tetoPlacesUsd);
    }
    await transicionar(id, 'ativa');
    await filas.publicar('campanha.iniciar', { campanhaId: id });
    log.info({ campanhaId: id }, 'campanha iniciada');
    const avisos = (await repo.baseCnpjImportada(pool))
      ? []
      : ['A base de CNPJ ainda não foi importada: por enquanto só o Google Maps vai trazer empresas.'];
    res.status(202).json({ campanha: await repo.obter(pool, id), avisos });
  });

  /** Tira da fila tudo que a campanha ainda não processou: enriquecimento e buscas no Maps. */
  async function pararFilas(id: number) {
    const buscas = await repo.buscasDaCampanha(pool, id);
    const porCampanha = { campo: 'campanhaId', valores: [id] };
    const porBusca = { campo: 'buscaId', valores: buscas };
    const [enriquecimento, ...outros] = await Promise.all([
      filas.cancelarPendentes('enriquecimento.solicitar', porCampanha),
      filas.cancelarPendentes('campanha.iniciar', porCampanha),
      filas.cancelarPendentes('campanha.buscar_cnpj', porCampanha),
      filas.cancelarPendentes('maps.buscar', porBusca),
      filas.cancelarPendentes('maps.coletar', porBusca),
    ]);
    return { enriquecimento: enriquecimento ?? 0, outros: outros.reduce((a, b) => a + b, 0) };
  }

  /** Pausar também para o que está na fila (o que já está rodando termina). */
  r.post('/:id/pausar', async (req, res) => {
    const id = idDaRota(req);
    await transicionar(id, 'pausada');
    const cancelados = await pararFilas(id);
    log.info({ campanhaId: id, ...cancelados }, 'campanha pausada');
    res.json(await repo.obter(pool, id));
  });

  /** Para o enriquecimento da campanha sem pausar a campanha. */
  r.post('/:id/parar-enriquecimento', async (req, res) => {
    const id = idDaRota(req);
    if (!(await repo.statusAtual(pool, id))) throw AppError.naoEncontrado('Campanha');
    const cancelados = await filas.cancelarPendentes('enriquecimento.solicitar', {
      campo: 'campanhaId',
      valores: [id],
    });
    log.info({ campanhaId: id, cancelados }, 'enriquecimento parado');
    res.json({ cancelados });
  });

  /**
   * Apaga a campanha e os leads só dela (para recomeçar um teste). Pede o nome da campanha
   * digitado como confirmação. Base de CNPJ e nichos ficam.
   */
  r.delete('/:id', async (req, res) => {
    const id = idDaRota(req);
    const campanha = await repo.obter(pool, id);
    if (!campanha) throw AppError.naoEncontrado('Campanha');
    const { confirmarNome } = corpo(req, apagarCampanhaEntrada);
    if (confirmarNome.trim().toLowerCase() !== campanha.nome.trim().toLowerCase())
      throw AppError.invalido('Digite o nome da campanha exatamente como aparece para confirmar.');
    const cancelados = await pararFilas(id);
    const r2 = await repo.apagarComLeads(pool, id);
    log.warn({ campanhaId: id, ...cancelados, ...r2 }, 'campanha apagada com os leads');
    res.json(r2);
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
