import { converterItem, runTerminou } from '@prospeccao/integrations/apify';
import { ErroDefinitivo } from '@prospeccao/queue';
import { cruzarResultado } from './cruzamento.js';
import type { Deps } from './dependencias.js';
import * as repo from './repositorio.js';

/** Tentativas de geocodificação por empresa antes de desistir. */
const MAX_TENTATIVAS_GEO = 2;

/** Campanha iniciada ou retomada: base de CNPJ + buscas no Maps. */
export async function iniciarCampanha(deps: Deps, campanhaId: number) {
  const campanha = await repo.obterCampanha(deps.pool, campanhaId);
  if (!campanha) throw new ErroDefinitivo(`Campanha ${campanhaId} não existe`);
  if (campanha.status !== 'ativa') {
    deps.log.info({ campanhaId, status: campanha.status }, 'campanha não está ativa; nada a fazer');
    return;
  }
  await deps.filas.publicar('campanha.buscar_cnpj', { campanhaId });
  const buscas = await repo.prepararBuscas(deps.pool, campanha, deps.ajustes.rebuscaDias);
  for (const buscaId of buscas) await deps.filas.publicar('maps.buscar', { buscaId });
  deps.log.info({ campanhaId, buscas: buscas.length }, 'campanha em descoberta');
  if (!buscas.length) await finalizarDescoberta(deps, campanhaId);
}

/** Empresas do nicho nas cidades da campanha, vindas da base de CNPJ. */
export async function buscarNaBaseCnpj(deps: Deps, campanhaId: number) {
  const campanha = await repo.obterCampanha(deps.pool, campanhaId);
  if (campanha?.status !== 'ativa') return;
  const total = await repo.importarEmpresasDaBase(deps.pool, campanha);
  deps.log.info({ campanhaId, empresas: total }, 'empresas da base de CNPJ ligadas à campanha');
  // Se o Maps já terminou, quem chegou agora precisa ser localizado.
  if ((await repo.buscasEmAberto(deps.pool, campanhaId)) === 0) await finalizarDescoberta(deps, campanhaId);
}

/** Dispara a busca no Apify e agenda a coleta. */
export async function dispararBuscaMaps(deps: Deps, buscaId: number) {
  const busca = await repo.obterBusca(deps.pool, buscaId);
  if (!busca) throw new ErroDefinitivo(`Busca ${buscaId} não existe`);
  if (busca.status !== 'pendente') return; // já disparada (job repetido)
  const campanha = await repo.obterCampanha(deps.pool, busca.campanha_id);
  if (campanha?.status !== 'ativa') return; // fica pendente até a campanha voltar

  const local = `${busca.cidade}, ${busca.uf}, Brasil`;
  const run = await deps.maps.iniciar({ termo: busca.termo, local, max: campanha.max_por_busca });
  await repo.marcarBuscaRodando(deps.pool, buscaId, run.id, run.datasetId);
  await deps.filas.publicar(
    'maps.coletar',
    { buscaId },
    { atrasoSegundos: deps.ajustes.esperaColetaSegundos },
  );
  deps.log.info({ buscaId, runId: run.id, termo: busca.termo, local }, 'busca no Maps disparada');
}

/** Confere o run; se terminou, grava e cruza os resultados. */
export async function coletarBuscaMaps(deps: Deps, buscaId: number) {
  const busca = await repo.obterBusca(deps.pool, buscaId);
  if (busca?.status !== 'rodando' || !busca.apify_run_id || !busca.dataset_id) return;
  const campanha = await repo.obterCampanha(deps.pool, busca.campanha_id);
  if (!campanha) throw new ErroDefinitivo(`Campanha ${busca.campanha_id} não existe`);

  const run = await deps.maps.obter(busca.apify_run_id);
  const estado = runTerminou(run.status);

  if (estado === 'rodando') {
    const verificacoes = await repo.contarVerificacao(deps.pool, buscaId);
    if (verificacoes >= deps.ajustes.maxVerificacoes) {
      await repo.concluirBusca(
        deps.pool,
        buscaId,
        `Run ${run.id} não terminou após ${verificacoes} verificações`,
        null,
      );
      await aoConcluirBusca(deps, busca.campanha_id);
      return;
    }
    await deps.filas.publicar(
      'maps.coletar',
      { buscaId },
      { atrasoSegundos: deps.ajustes.esperaColetaSegundos },
    );
    return;
  }

  if (estado === 'falha') {
    await repo.concluirBusca(deps.pool, buscaId, `Run ${run.id} terminou com status ${run.status}`, null);
    await aoConcluirBusca(deps, busca.campanha_id);
    return;
  }

  const { itens, ignorados } = await deps.maps.itens(busca.dataset_id);
  for (const item of itens) await repo.salvarResultado(deps.pool, buscaId, item);

  // Processa tudo que ainda não foi cruzado (inclusive de uma tentativa anterior que caiu no meio).
  const { rows: pendentes } = await deps.pool.query<{ id: number; dados: unknown }>(
    'SELECT id, dados FROM descoberta.maps_resultados WHERE busca_id = $1 AND cruzamento IS NULL ORDER BY id',
    [buscaId],
  );
  const contagem: Record<string, number> = {};
  for (const p of pendentes) {
    const item = converterItem(p.dados);
    if (!item) continue;
    const { tipo } = await cruzarResultado(deps.pool, campanha, busca, p.id, item);
    contagem[tipo] = (contagem[tipo] ?? 0) + 1;
  }

  await repo.concluirBusca(deps.pool, buscaId, null, itens.length);
  deps.log.info({ buscaId, itens: itens.length, ignorados, cruzamento: contagem }, 'busca no Maps coletada');
  await aoConcluirBusca(deps, busca.campanha_id);
}

async function aoConcluirBusca(deps: Deps, campanhaId: number) {
  if ((await repo.buscasEmAberto(deps.pool, campanhaId)) === 0) await finalizarDescoberta(deps, campanhaId);
}

/**
 * Fecha a rodada de descoberta da campanha: calcula distâncias de quem já tem
 * coordenada, manda localizar quem não tem e libera para o enriquecimento quem
 * está pronto.
 */
export async function finalizarDescoberta(deps: Deps, campanhaId: number) {
  await repo.recalcularDistancias(deps.pool, { campanhaId });
  // Só campanhas com raio precisam de coordenada; sem geocodificador, fica com o que veio do Maps.
  const semLocal = deps.geo
    ? await repo.empresasSemLocalizacao(deps.pool, campanhaId, MAX_TENTATIVAS_GEO)
    : [];
  for (const empresaId of semLocal) await deps.filas.publicar('empresa.localizar', { empresaId });
  const prontas = await repo.reservarParaEnriquecimento(deps.pool, { campanhaId });
  for (const p of prontas) {
    await deps.filas.publicar('enriquecimento.solicitar', {
      empresaId: p.empresa_id,
      campanhaId: p.campanha_id,
    });
  }
  deps.log.info(
    { campanhaId, aLocalizar: semLocal.length, paraEnriquecer: prontas.length },
    'descoberta finalizada',
  );
}

function montarEndereco(e: repo.EmpresaLocalizar): string[] {
  const cidade = `${e.cidade}, ${e.uf}`;
  const rua = [e.logradouro, e.numero].filter(Boolean).join(', ');
  const tentativas = [
    e.maps_endereco,
    [rua, e.bairro, cidade, e.cep].filter(Boolean).join(', '),
    e.cep ? `${e.cep}, ${cidade}` : null,
  ];
  return [...new Set(tentativas.filter((t): t is string => !!t && t !== cidade))];
}

/** Coordenada pelo ORS para quem não veio do Maps; depois distância e enriquecimento. */
export async function localizarEmpresa(deps: Deps, empresaId: number) {
  const e = await repo.obterEmpresaLocalizar(deps.pool, empresaId);
  if (!e) return;

  if (deps.geo && e.lat == null && e.geo_tentativas < MAX_TENTATIVAS_GEO) {
    let achado: { lat: number; lng: number } | null = null;
    for (const endereco of montarEndereco(e)) {
      const r = await deps.geo.geocodificar(endereco);
      if (r && r.confianca >= deps.ajustes.confiancaMinimaGeo) {
        achado = r;
        break;
      }
    }
    await repo.gravarLocalizacao(deps.pool, empresaId, achado);
    if (!achado) deps.log.info({ empresaId }, 'endereço não localizado com confiança');
  }

  await repo.recalcularDistancias(deps.pool, { empresaId });
  const prontas = await repo.reservarParaEnriquecimento(deps.pool, { empresaId });
  for (const p of prontas) {
    await deps.filas.publicar('enriquecimento.solicitar', {
      empresaId: p.empresa_id,
      campanhaId: p.campanha_id,
    });
  }
}

/** Base de CNPJ atualizada: campanhas ativas buscam de novo na base. */
export async function aoAtualizarBaseCnpj(deps: Deps) {
  for (const campanhaId of await repo.campanhasAtivas(deps.pool)) {
    await deps.filas.publicar('campanha.buscar_cnpj', { campanhaId });
  }
}

/** Erro de busca em português curto (o que aparece na tela de Atividade). */
export function explicarFalhaBusca(erro: unknown): string {
  const msg = erro instanceof Error ? erro.message : String(erro);
  if (/HTTP 402|not enough usage|usage limit|credit|insufficient/i.test(msg))
    return 'Sem crédito no Apify: recarregue ou troque de plano e use "Tentar de novo".';
  if (/HTTP 401|HTTP 403|token/i.test(msg)) return 'APIFY_TOKEN recusado pelo Apify.';
  if (/TIMED-OUT|timeout|tempo esgotado/i.test(msg)) return 'O Apify demorou demais para responder.';
  return msg.slice(0, 240);
}

/**
 * Falha ao disparar ou coletar uma busca: grava o motivo na busca para a tela mostrar. Na última
 * tentativa, fecha a busca com erro e segue a campanha com o que as outras buscas acharam.
 */
export async function registrarFalhaBusca(deps: Deps, buscaId: number, erro: unknown, final: boolean) {
  const motivo = explicarFalhaBusca(erro);
  const busca = await repo.obterBusca(deps.pool, buscaId);
  if (!busca) return;
  if (final) {
    await repo.concluirBusca(deps.pool, buscaId, motivo, null);
    await aoConcluirBusca(deps, busca.campanha_id);
  } else {
    await repo.anotarFalhaBusca(deps.pool, buscaId, motivo);
  }
}
