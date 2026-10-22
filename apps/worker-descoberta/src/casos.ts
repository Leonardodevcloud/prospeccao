import { converterItem, type ItemMaps, runTerminou } from '@prospeccao/integrations/apify';
import {
  converterLugar,
  ehLugarPlaces,
  MAX_PAGINAS,
  POR_PAGINA,
  textoDaBusca,
} from '@prospeccao/integrations/places';
import { ErroDefinitivo } from '@prospeccao/queue';
import { AppError, type ItemPlanilhaMaps, MOTIVO_META_LEADS, normalizarTelefone } from '@prospeccao/shared';
import { cruzarResultado } from './cruzamento.js';
import type { Deps } from './dependencias.js';
import * as repo from './repositorio.js';

/** Tentativas de geocodificação por empresa antes de desistir. */
const MAX_TENTATIVAS_GEO = 2;

/** Pedido antigo (sem a campanha): usa a conta principal. */
async function contaPrincipal(deps: Deps): Promise<number> {
  const { rows } = await deps.pool.query<{ id: number }>('SELECT id FROM cadastro.contas WHERE principal');
  return rows[0]?.id ?? 1;
}

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

/** O item guardado em `dados` pode ter vindo do Places ou do Apify. */
function converterDados(dados: unknown): ItemMaps | null {
  const d = dados as { origem?: string; item?: ItemMaps } | null;
  if (d?.origem === 'planilha' && d.item) return d.item;
  return ehLugarPlaces(dados) ? converterLugar(dados) : converterItem(dados);
}

/** Cruza tudo que ainda não foi cruzado na busca (inclusive de uma tentativa que caiu no meio). */
async function cruzarPendentes(deps: Deps, campanha: repo.CampanhaDescoberta, busca: repo.Busca) {
  const { rows: pendentes } = await deps.pool.query<{ id: number; dados: unknown }>(
    'SELECT id, dados FROM descoberta.maps_resultados WHERE busca_id = $1 AND cruzamento IS NULL ORDER BY id',
    [busca.id],
  );
  const contagem: Record<string, number> = {};
  for (const p of pendentes) {
    const item = converterDados(p.dados);
    if (!item) continue;
    const { tipo } = await cruzarResultado(deps.pool, campanha, busca, p.id, item);
    contagem[tipo] = (contagem[tipo] ?? 0) + 1;
  }
  return contagem;
}

/**
 * Roda a busca: no Google Places (padrão), na hora, página a página; no Apify (legado),
 * dispara o run e agenda a coleta.
 */
export async function dispararBuscaMaps(deps: Deps, buscaId: number) {
  const busca = await repo.obterBusca(deps.pool, buscaId);
  if (!busca) throw new ErroDefinitivo(`Busca ${buscaId} não existe`);
  // Cada conta busca com a sua chave do Google.
  const places = await deps.placesDa(busca.conta_id);
  if (places) return buscarNoPlaces(deps, busca, places);

  if (busca.status !== 'pendente') return; // já disparada (job repetido)
  const campanha = await repo.obterCampanha(deps.pool, busca.campanha_id);
  if (campanha?.status !== 'ativa') return; // fica pendente até a campanha voltar
  if (await repo.metaAtingida(deps.pool, campanha)) {
    await repo.bloquearBusca(deps.pool, buscaId, MOTIVO_META_LEADS);
    await aoConcluirBusca(deps, campanha.id);
    return;
  }
  if (!deps.maps)
    throw new ErroDefinitivo(
      'Sem Google Places para esta conta: o administrador do sistema cadastra a chave no painel master.',
    );

  const local = `${busca.bairro ? `${busca.bairro}, ` : ''}${busca.cidade}, ${busca.uf}, Brasil`;
  const run = await deps.maps.iniciar({ termo: busca.termo, local, max: campanha.max_por_busca });
  await repo.marcarBuscaRodando(deps.pool, buscaId, run.id, run.datasetId);
  await deps.filas.publicar(
    'maps.coletar',
    { buscaId },
    { atrasoSegundos: deps.ajustes.esperaColetaSegundos },
  );
  deps.log.info({ buscaId, runId: run.id, termo: busca.termo, local }, 'busca no Maps disparada');
}

/**
 * Busca no Google Places: até 3 páginas de 20 (limitado por "lugares por busca" da campanha).
 * Cada página passa pela reserva de uso (franquia e tetos) antes de ir ao Google; se o teto
 * bater, a busca fica "bloqueada" com o motivo e a campanha segue com o que já achou.
 * A busca da cidade inteira que enche (60 lugares) é dividida por bairro.
 */
async function buscarNoPlaces(
  deps: Deps,
  inicial: repo.Busca,
  places: NonNullable<Awaited<ReturnType<Deps['placesDa']>>>,
) {
  const campanha = await repo.obterCampanha(deps.pool, inicial.campanha_id);
  if (campanha?.status !== 'ativa') return; // fica pendente até a campanha voltar
  const busca = await repo.reivindicarBuscaPlaces(deps.pool, inicial.id);
  if (!busca) return; // outra tarefa está nela, ou já terminou
  // A campanha já tem leads para a meta: a busca não roda (nem gasta no Google).
  if (busca.paginas === 0 && (await repo.metaAtingida(deps.pool, campanha))) {
    await repo.bloquearBusca(deps.pool, busca.id, MOTIVO_META_LEADS);
    await aoConcluirBusca(deps, campanha.id);
    return;
  }

  const maxPaginas = Math.min(MAX_PAGINAS, Math.max(1, Math.ceil(campanha.max_por_busca / POR_PAGINA)));
  const texto = textoDaBusca(busca);
  let paginas = busca.paginas;
  let proxima = busca.proxima_pagina;

  let bateuMeta = false;
  while (paginas < maxPaginas && (paginas === 0 || proxima)) {
    // Meta de leads atingida no meio da busca: para aqui, guardando a página (volta se a meta subir).
    if (paginas > 0) {
      await cruzarPendentes(deps, campanha, busca);
      if (await repo.metaAtingida(deps.pool, campanha)) {
        bateuMeta = true;
        break;
      }
    }
    const reserva = await repo.reservarUsoPlaces(deps.pool, {
      campanhaId: campanha.id,
      buscaId: busca.id,
      tetoCampanhaUsd: campanha.teto_places_usd,
      contaId: campanha.conta_id,
    });
    if (!reserva.ok) {
      await cruzarPendentes(deps, campanha, busca);
      await repo.bloquearBusca(deps.pool, busca.id, reserva.motivo);
      deps.log.warn(
        { buscaId: busca.id, campanhaId: campanha.id, motivo: reserva.motivo },
        'busca parada no teto',
      );
      await aoConcluirBusca(deps, campanha.id);
      return;
    }
    let pagina: Awaited<ReturnType<typeof places.buscar>>;
    try {
      pagina = await places.buscar({ texto, pagina: proxima });
    } catch (erro) {
      await repo.cancelarUsoPlaces(deps.pool, reserva.usoId);
      // Token de página vencido (a busca ficou parada muito tempo): fecha com o que já tem.
      if (
        proxima &&
        erro instanceof AppError &&
        (erro.detalhes as { status?: number } | undefined)?.status === 400
      ) {
        proxima = null;
        break;
      }
      throw erro;
    }
    for (const item of pagina.itens) await repo.salvarResultado(deps.pool, busca.id, item);
    await repo.confirmarUsoPlaces(deps.pool, reserva.usoId, pagina.itens.length);
    paginas++;
    proxima = pagina.proximaPagina;
    await repo.gravarPaginaPlaces(deps.pool, busca.id, paginas, proxima);
  }

  const contagem = await cruzarPendentes(deps, campanha, busca);
  const itens = await repo.contarResultados(deps.pool, busca.id);

  // Encheu? O Google não entrega mais que isso por texto: divide a cidade por bairro.
  const encheu = !busca.bairro && paginas >= MAX_PAGINAS && itens >= MAX_PAGINAS * POR_PAGINA;
  // Parou na meta, ou encheu mas a meta já foi: fica parada (sem dividir por bairro) e retoma
  // daqui se a meta subir.
  if (bateuMeta || (encheu && (await repo.metaAtingida(deps.pool, campanha)))) {
    await repo.bloquearBusca(deps.pool, busca.id, MOTIVO_META_LEADS);
    deps.log.info({ buscaId: busca.id, texto, paginas, itens }, 'busca parada na meta de leads');
    await aoConcluirBusca(deps, campanha.id);
    return;
  }
  let porBairro = 0;
  if (encheu) {
    const cfg = await repo.configPlaces(deps.pool, campanha.conta_id);
    const bairros = await repo.bairrosParaBusca(deps.pool, {
      cidade: busca.cidade,
      uf: busca.uf,
      cnaes: campanha.cnaes,
      limite: cfg.max_bairros,
    });
    const ids = await repo.criarBuscasPorBairro(deps.pool, busca, bairros, deps.ajustes.rebuscaDias);
    for (const id of ids) await deps.filas.publicar('maps.buscar', { buscaId: id });
    porBairro = ids.length;
  }

  await repo.concluirBusca(deps.pool, busca.id, null, itens);
  deps.log.info(
    { buscaId: busca.id, texto, paginas, itens, cruzamento: contagem, porBairro },
    'busca no Google Places concluída',
  );
  await aoConcluirBusca(deps, campanha.id);
}

/** Confere o run do Apify; se terminou, grava e cruza os resultados. */
export async function coletarBuscaMaps(deps: Deps, buscaId: number) {
  const busca = await repo.obterBusca(deps.pool, buscaId);
  if (busca?.status !== 'rodando' || !busca.apify_run_id || !busca.dataset_id) return;
  const campanha = await repo.obterCampanha(deps.pool, busca.campanha_id);
  if (!campanha) throw new ErroDefinitivo(`Campanha ${busca.campanha_id} não existe`);
  if (!deps.maps) {
    await repo.concluirBusca(
      deps.pool,
      buscaId,
      'Apify desligado (sem APIFY_TOKEN): run antigo não coletado.',
      null,
    );
    await aoConcluirBusca(deps, busca.campanha_id);
    return;
  }

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
  const contagem = await cruzarPendentes(deps, campanha, busca);

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
  // Só campanhas com raio precisam de coordenada; sem geocodificador (ORS da conta), fica com o que veio do Maps.
  const campanha = await repo.obterCampanha(deps.pool, campanhaId);
  const geo = campanha ? await deps.geoDa(campanha.conta_id) : null;
  const semLocal = geo ? await repo.empresasSemLocalizacao(deps.pool, campanhaId, MAX_TENTATIVAS_GEO) : [];
  for (const empresaId of semLocal) await deps.filas.publicar('empresa.localizar', { empresaId, campanhaId });
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

/** Coordenada pelo ORS (da conta da campanha) para quem não veio do Maps; depois distância e enriquecimento. */
export async function localizarEmpresa(deps: Deps, empresaId: number, campanhaId?: number) {
  const e = await repo.obterEmpresaLocalizar(deps.pool, empresaId);
  if (!e) return;
  const campanha = campanhaId ? await repo.obterCampanha(deps.pool, campanhaId) : null;
  const geo = await deps.geoDa(campanha?.conta_id ?? (await contaPrincipal(deps)));

  if (geo && e.lat == null && e.geo_tentativas < MAX_TENTATIVAS_GEO) {
    let achado: { lat: number; lng: number } | null = null;
    for (const endereco of montarEndereco(e)) {
      const r = await geo.geocodificar(endereco);
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

/**
 * Ao subir o serviço: campanha ativa com busca pendente volta a disparar (uma busca pode ter ficado
 * sem tarefa na fila depois de falhar todas as tentativas ou de um deploy no meio).
 */
export async function retomarBuscasParadas(deps: Deps) {
  const { rows } = await deps.pool.query<{ campanha_id: number }>(
    `SELECT DISTINCT b.campanha_id::int FROM descoberta.buscas_maps b
       JOIN cadastro.v_campanhas_descoberta c ON c.id = b.campanha_id AND c.status = 'ativa'
      WHERE b.status = 'pendente'`,
  );
  for (const r of rows) await deps.filas.publicar('campanha.iniciar', { campanhaId: r.campanha_id });
  if (rows.length) deps.log.info({ campanhas: rows.length }, 'buscas pendentes retomadas');
}

/** Base de CNPJ atualizada: campanhas ativas buscam de novo na base. */
export async function aoAtualizarBaseCnpj(deps: Deps) {
  for (const campanhaId of await repo.campanhasAtivas(deps.pool)) {
    await deps.filas.publicar('campanha.buscar_cnpj', { campanhaId });
  }
}

/** Erro de busca em português curto (o que aparece na tela de Atividade e no card). */
export function explicarFalhaBusca(erro: unknown): string {
  const msg = erro instanceof Error ? erro.message : String(erro);
  if (/^Google Places/i.test(msg)) {
    if (/BILLING|billing/.test(msg))
      return 'O Google pediu faturamento: ative o faturamento no projeto do Google Cloud da chave do Places desta conta.';
    if (/SERVICE_DISABLED|has not been used|not been enabled|API_KEY_SERVICE_BLOCKED/i.test(msg))
      return 'A "Places API (New)" não está ativa no Google Cloud para a chave desta conta: ative e use "Tentar de novo".';
    if (/HTTP 401|HTTP 403|API_KEY_INVALID|API key not valid|PERMISSION_DENIED/i.test(msg))
      return 'O Google recusou a chave do Places desta conta: confira a chave e as restrições dela no Google Cloud.';
    if (/HTTP 429|RESOURCE_EXHAUSTED|quota/i.test(msg))
      return 'Limite de pedidos do Google (por minuto ou cota diária): a busca tenta de novo sozinha.';
    if (/sem resposta|timeout/i.test(msg))
      return 'O Google demorou demais para responder: a busca tenta de novo.';
    return msg.slice(0, 240);
  }
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

/**
 * Planilha do Google Maps (Instant Data Scraper, exportada e subida na tela): cada linha vira um
 * resultado de uma "busca" do tipo planilha e passa pelo mesmo cruzamento com a base de CNPJ
 * (telefone, nome + CEP, nome + cidade). Quem casa ganha telefone e nota do Google; quem não casa
 * entra como lead só do Maps. No fim, vai para o enriquecimento como qualquer busca.
 */
export async function importarPlanilha(
  deps: Deps,
  p: { campanhaId: number; cidade: string; uf: string; itens: ItemPlanilhaMaps[] },
) {
  const campanha = await repo.obterCampanha(deps.pool, p.campanhaId);
  if (!campanha) throw new ErroDefinitivo(`Campanha ${p.campanhaId} não existe`);
  const buscaId = await repo.criarBuscaPlanilha(deps.pool, p.campanhaId, p.cidade, p.uf);
  let salvos = 0;
  let contagem: Record<string, number> = {};
  try {
    for (const linha of p.itens) {
      const item = itemDaPlanilha(linha, p.cidade, p.uf);
      const id = await repo.salvarResultado(deps.pool, buscaId, {
        ...item,
        dados: { origem: 'planilha', item },
      });
      if (id != null) salvos++;
    }
    const busca = await repo.obterBusca(deps.pool, buscaId);
    if (busca) contagem = await cruzarPendentes(deps, campanha, busca);
  } catch (erro) {
    // Fecha esta busca com o erro (a nova tentativa cria outra): nada fica "rodando" para sempre.
    await repo.concluirBusca(deps.pool, buscaId, erro instanceof Error ? erro.message : String(erro), salvos);
    throw erro;
  }
  await repo.concluirBusca(deps.pool, buscaId, null, salvos);
  deps.log.info(
    { buscaId, linhas: p.itens.length, salvos, cruzamento: contagem },
    'planilha do Maps importada',
  );
  await aoConcluirBusca(deps, p.campanhaId);
}

/** Linha da planilha no formato de um lugar do Maps (id estável a partir de nome + telefone/endereço). */
export function itemDaPlanilha(l: ItemPlanilhaMaps, cidade: string, uf: string): ItemMaps {
  const telefone = normalizarTelefone(l.telefone);
  const cep = l.endereco?.match(/\b(\d{5})-?(\d{3})\b/);
  const chave = `${l.nome}|${telefone ?? ''}|${l.endereco ?? ''}`.toLowerCase();
  let h = 0;
  for (let i = 0; i < chave.length; i++) h = (Math.imul(31, h) + chave.charCodeAt(i)) | 0;
  return {
    placeId: `planilha:${(h >>> 0).toString(36)}`,
    nome: l.nome,
    categoria: l.categoria ?? null,
    telefone,
    endereco: l.endereco ?? null,
    cep: cep ? `${cep[1]}${cep[2]}` : null,
    cidade,
    uf,
    lat: null,
    lng: null,
    nota: l.nota ?? null,
    avaliacoes: l.avaliacoes ?? null,
    site: l.site ?? null,
    url: l.url ?? null,
    fechada: false,
    entrega: null,
    dados: {},
  };
}
