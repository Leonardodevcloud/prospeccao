import type { Executor } from '@prospeccao/db';
import type { ConfigPlacesEntrada } from '@prospeccao/shared';

/**
 * Uso do Google Places: o Google não informa a franquia restante por API, então tudo aqui vem
 * da conta que o worker-descoberta faz de cada pedido (descoberta.uso_places) e da tabela de
 * preços em cadastro.config_places. Mês de cobrança do Google = horário do Pacífico.
 */

export interface ConfigPlaces {
  franquiaMensal: number;
  precoMilUsd: number;
  cotacaoBrl: number;
  tetoMensalUsd: number | null;
  maxBairros: number;
  atualizadoEm: string;
}

export async function obterConfig(db: Executor): Promise<ConfigPlaces> {
  const { rows } = await db.query<ConfigPlaces>(
    `SELECT franquia_mensal AS "franquiaMensal", preco_mil_usd::float8 AS "precoMilUsd",
            cotacao_brl::float8 AS "cotacaoBrl", teto_mensal_usd::float8 AS "tetoMensalUsd",
            max_bairros AS "maxBairros", atualizado_em AS "atualizadoEm"
       FROM cadastro.config_places WHERE id = 1`,
  );
  return (
    rows[0] ?? {
      franquiaMensal: 1000,
      precoMilUsd: 35,
      cotacaoBrl: 5.5,
      tetoMensalUsd: null,
      maxBairros: 150,
      atualizadoEm: new Date().toISOString(),
    }
  );
}

export async function salvarConfig(db: Executor, c: ConfigPlacesEntrada) {
  await db.query(
    `INSERT INTO cadastro.config_places (id, franquia_mensal, preco_mil_usd, cotacao_brl, teto_mensal_usd, max_bairros)
     VALUES (1, $1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET franquia_mensal = $1, preco_mil_usd = $2, cotacao_brl = $3,
                                    teto_mensal_usd = $4, max_bairros = $5`,
    [c.franquiaMensal, c.precoMilUsd, c.cotacaoBrl, c.tetoMensalUsd, c.maxBairros],
  );
}

const arred = (v: number, casas = 2) => Math.round(v * 10 ** casas) / 10 ** casas;

/** Painel do mês: usado x franquia, gasto, ritmo e projeção até o fim do mês. */
export async function resumoDoMes(db: Executor) {
  const cfg = await obterConfig(db);
  const { rows } = await db.query<{
    mes: string;
    hoje: string;
    renova_em: string;
    dias_no_mes: number;
    decorridos: number;
    pedidos: number;
    pagos: number;
    gasto_usd: number;
    lugares: number;
  }>(
    `WITH t AS (
       SELECT descoberta.mes_places() AS mes, (now() AT TIME ZONE 'America/Los_Angeles')::date AS hoje
     )
     SELECT to_char(t.mes, 'YYYY-MM-DD') AS mes, to_char(t.hoje, 'YYYY-MM-DD') AS hoje,
            to_char((t.mes + interval '1 month')::date, 'YYYY-MM-DD') AS renova_em,
            ((t.mes + interval '1 month')::date - t.mes)::int AS dias_no_mes,
            (t.hoje - t.mes + 1)::int AS decorridos,
            coalesce(u.pedidos, 0) AS pedidos, coalesce(u.pagos, 0) AS pagos,
            coalesce(u.gasto_usd, 0) AS gasto_usd, coalesce(u.lugares, 0) AS lugares
       FROM t LEFT JOIN descoberta.v_uso_places_mes u ON u.mes = t.mes`,
  );
  const r = rows[0]!;
  const precoPorPedido = cfg.precoMilUsd / 1000;
  const restantes = Math.max(0, r.dias_no_mes - r.decorridos);
  const ritmoDia = r.pedidos / Math.max(1, r.decorridos);
  const projecaoPedidos = Math.round(r.pedidos + ritmoDia * restantes);
  const projecaoUsd = Math.max(
    r.gasto_usd,
    Math.max(0, projecaoPedidos - cfg.franquiaMensal) * precoPorPedido,
  );
  const gratisRestantes = Math.max(0, cfg.franquiaMensal - r.pedidos);

  // Quando a franquia acaba no ritmo atual (null: não acaba este mês, ou já acabou).
  let franquiaAcabaEm: string | null = null;
  if (gratisRestantes > 0 && ritmoDia > 0) {
    const dias = Math.ceil(gratisRestantes / ritmoDia);
    const data = new Date(`${r.hoje}T12:00:00Z`);
    data.setUTCDate(data.getUTCDate() + dias);
    const iso = data.toISOString().slice(0, 10);
    if (iso < r.renova_em) franquiaAcabaEm = iso;
  }

  const situacao = r.pedidos >= cfg.franquiaMensal ? 'cobrando' : franquiaAcabaEm ? 'vai_cobrar' : 'gratis';

  return {
    mes: r.mes,
    renovaEm: r.renova_em,
    diasRestantes: restantes + 1,
    franquia: cfg.franquiaMensal,
    usados: r.pedidos,
    gratisRestantes,
    pagos: r.pagos,
    lugares: r.lugares,
    gastoUsd: arred(r.gasto_usd),
    precoPorPedidoUsd: precoPorPedido,
    precoMilUsd: cfg.precoMilUsd,
    ritmoDia: arred(ritmoDia, 1),
    projecaoPedidos,
    projecaoUsd: arred(projecaoUsd),
    franquiaAcabaEm,
    situacao: situacao as 'gratis' | 'vai_cobrar' | 'cobrando',
    tetoMensalUsd: cfg.tetoMensalUsd,
    cotacaoBrl: cfg.cotacaoBrl,
    maxBairros: cfg.maxBairros,
  };
}

/** Páginas por busca (o Google entrega até 3 de 20). */
const POR_PAGINA = 20;
const MAX_PAGINAS = 3;
/** Sem histórico, quantas páginas uma busca por bairro costuma usar. */
const MEDIA_BAIRRO_PADRAO = 1.5;
/** Mesmo prazo padrão do worker (MAPS_REBUSCA_DIAS) para não repetir busca. */
const REBUSCA_DIAS = 30;

/**
 * Quanto a campanha vai gastar no Google se rodar agora. Conta as buscas que ainda vão rodar:
 * as da cidade inteira que não rodaram nos últimos 30 dias (no pior caso, cada uma enche e vira
 * uma busca por bairro) e as pendentes/paradas no teto, do ponto onde pararam.
 */
export async function estimativaCampanha(db: Executor, campanhaId: number) {
  const { rows: cs } = await db.query<{
    cidades: { cidade: string; uf: string }[];
    termos_maps: string[];
    cnaes: string[];
    max_por_busca: number;
    teto_places_usd: number | null;
  }>('SELECT * FROM cadastro.v_campanhas_descoberta WHERE id = $1', [campanhaId]);
  const c = cs[0];
  if (!c) return null;
  const cfg = await obterConfig(db);
  const mes = await resumoDoMes(db);

  const paginasMax = Math.min(MAX_PAGINAS, Math.max(1, Math.ceil(c.max_por_busca / POR_PAGINA)));
  const divideBairro = paginasMax >= MAX_PAGINAS;
  const { rows: hist } = await db.query<{ media: number | null }>(
    `SELECT avg(paginas)::float8 AS media FROM descoberta.buscas_maps
      WHERE fonte = 'places' AND bairro IS NOT NULL AND status = 'concluida' AND paginas > 0
        AND concluido_em > now() - interval '120 days'`,
  );
  const mediaBairro = Math.min(MAX_PAGINAS, hist[0]?.media ?? MEDIA_BAIRRO_PADRAO);

  const cidades: { cidade: string; uf: string; bairros: number }[] = [];
  for (const x of c.cidades) {
    const { rows } = await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM descoberta.bairros_para_busca($1, $2, $3::text[], $4)',
      [x.cidade, x.uf, c.cnaes, cfg.maxBairros],
    );
    cidades.push({ cidade: x.cidade, uf: x.uf, bairros: divideBairro ? (rows[0]?.n ?? 0) : 0 });
  }

  const { rows: buscas } = await db.query<{
    cidade: string;
    uf: string;
    termo: string;
    bairro: string | null;
    status: string;
    paginas: number;
    recente: boolean;
  }>(
    `SELECT cidade, uf, lower(termo) AS termo, bairro, status, paginas,
            (status IN ('pendente', 'rodando', 'bloqueada')
             OR (status = 'concluida' AND concluido_em > now() - make_interval(days => $2))) AS recente
       FROM descoberta.buscas_maps WHERE campanha_id = $1`,
    [campanhaId, REBUSCA_DIAS],
  );

  let pedidosMax = 0;
  let pedidosMin = 0;
  for (const x of cidades) {
    for (const termo of c.termos_maps) {
      const daCidade = buscas.filter(
        (b) => b.cidade === x.cidade && b.uf === x.uf && b.termo === termo.toLowerCase() && b.recente,
      );
      const cidadeInteira = daCidade.find((b) => !b.bairro);
      if (!cidadeInteira) {
        pedidosMax += paginasMax + x.bairros * mediaBairro;
        pedidosMin += 1;
        continue;
      }
      // Já existe: conta só o que falta (pendentes e paradas no teto).
      for (const b of daCidade) {
        if (b.status === 'concluida') continue;
        const falta = b.bairro ? Math.max(1, mediaBairro - b.paginas) : Math.max(0, paginasMax - b.paginas);
        pedidosMax += falta;
        pedidosMin += Math.min(1, falta);
      }
      const bairrosCriados = daCidade.filter((b) => b.bairro).length;
      if (cidadeInteira.status !== 'concluida' && bairrosCriados === 0) pedidosMax += x.bairros * mediaBairro;
    }
  }
  pedidosMax = Math.ceil(pedidosMax);

  const preco = cfg.precoMilUsd / 1000;
  const gratis = Math.min(pedidosMax, mes.gratisRestantes);
  const pagos = pedidosMax - gratis;
  const custoUsd = arred(pagos * preco);
  const { rows: gasto } = await db.query<{ gasto: number }>(
    `SELECT coalesce(gasto_usd, 0)::float8 AS gasto FROM descoberta.v_uso_places_campanha WHERE campanha_id = $1`,
    [campanhaId],
  );

  return {
    cidades,
    termos: c.termos_maps.length,
    paginasPorBusca: paginasMax,
    divideBairro,
    mediaPaginasBairro: arred(mediaBairro, 1),
    pedidosMin,
    pedidosMax,
    gratisRestantes: mes.gratisRestantes,
    gratis,
    pagos,
    sobraGratisDepois: Math.max(0, mes.gratisRestantes - pedidosMax),
    precoPorPedidoUsd: preco,
    custoUsd,
    custoBrl: arred(custoUsd * cfg.cotacaoBrl),
    cotacaoBrl: cfg.cotacaoBrl,
    tetoCampanhaUsd: c.teto_places_usd,
    gastoCampanhaUsd: arred(gasto[0]?.gasto ?? 0),
    tetoMensalUsd: cfg.tetoMensalUsd,
    gastoMesUsd: mes.gastoUsd,
    renovaEm: mes.renovaEm,
  };
}
