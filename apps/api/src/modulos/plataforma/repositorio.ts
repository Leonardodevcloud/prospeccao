import {
  type CredenciaisAmbiente,
  credenciaisEfetivas,
  type Executor,
  INICIO_MES_SP,
  INICIO_MES_SP_TS,
} from '@prospeccao/db';
import {
  type CustoEstimado,
  type CustosPlataforma,
  custoEstimado,
  custosCompletos,
  type Plano,
  type SinalSaude,
  type UsoPago,
} from '@prospeccao/shared';
import { type PlanoComUso, planoDaConta } from '../plano/repositorio.js';

/**
 * Painel da plataforma (só o master): receita, consumo e custo de cada cliente, saúde de uso e a
 * operação. As consultas atravessam as contas de propósito.
 */

export async function lerCustos(db: Executor): Promise<CustosPlataforma> {
  const { rows } = await db.query<{ dados: unknown }>(
    'SELECT dados FROM cadastro.custos_plataforma WHERE id = 1',
  );
  return custosCompletos(rows[0]?.dados);
}

export async function salvarCustos(db: Executor, c: CustosPlataforma, usuarioId: number): Promise<void> {
  await db.query(
    `INSERT INTO cadastro.custos_plataforma (id, dados, atualizado_em, atualizado_por) VALUES (1, $1, now(), $2)
     ON CONFLICT (id) DO UPDATE SET dados = EXCLUDED.dados, atualizado_em = now(), atualizado_por = EXCLUDED.atualizado_por`,
    [JSON.stringify(c), usuarioId],
  );
}

interface LinhaConta {
  id: number;
  nome: string;
  ativa: boolean;
  principal: boolean;
  criadoEm: string;
  desativadaEm: string | null;
  ultimoAcesso: string | null;
  leads14d: number;
  leadsMesAnterior: number;
  noFunil: number;
  serper: number;
  apifyInstagram: number;
  apifyGoogle: number;
  iaChamadas: number;
  iaEntrada: number;
  iaSaida: number;
  iaChamadasConta: number;
  emails: number;
  whatsappEnviadas: number;
  numeros: number;
  placesUsd: number;
}

/** Tudo o que o painel precisa de cada conta, numa consulta só (mês corrente, fuso de São Paulo). */
async function linhasDasContas(db: Executor): Promise<LinhaConta[]> {
  const { rows } = await db.query<LinhaConta>(
    `SELECT c.id, c.nome, c.ativa, c.principal, c.criado_em AS "criadoEm", c.desativada_em AS "desativadaEm",
            (SELECT max(u.ultimo_acesso) FROM cadastro.usuarios u WHERE u.conta_id = c.id AND NOT u.master) AS "ultimoAcesso",
            (SELECT count(*) FROM enriquecimento.leads l JOIN cadastro.campanhas ca ON ca.id = l.campanha_id
              WHERE ca.conta_id = c.id AND l.status = 'concluido' AND l.concluido_em > now() - interval '14 days')::int AS "leads14d",
            (SELECT count(*) FROM enriquecimento.leads l JOIN cadastro.campanhas ca ON ca.id = l.campanha_id
              WHERE ca.conta_id = c.id AND l.status = 'concluido'
                AND l.concluido_em >= ${INICIO_MES_SP_TS} - interval '1 month' AND l.concluido_em < ${INICIO_MES_SP_TS})::int
              AS "leadsMesAnterior",
            (SELECT count(*) FROM comercial.oportunidades o
              WHERE o.conta_id = c.id AND o.etapa NOT IN ('ganho', 'perdido', 'descartado'))::int AS "noFunil",
            coalesce(b.serper, 0)::int AS serper, coalesce(b.apify_instagram, 0)::int AS "apifyInstagram",
            coalesce(b.apify_google, 0)::int AS "apifyGoogle",
            coalesce(ia.chamadas, 0)::int AS "iaChamadas", coalesce(ia.entrada, 0)::float8 AS "iaEntrada",
            coalesce(ia.saida, 0)::float8 AS "iaSaida", coalesce(ia.chamadas_conta, 0)::int AS "iaChamadasConta",
            (SELECT count(*) FROM comercial.envios_email en
              WHERE en.conta_id = c.id AND en.canal = 'email' AND en.status = 'enviado'
                AND en.enviado_em >= ${INICIO_MES_SP_TS})::int AS emails,
            (SELECT count(*) FROM comercial.mensagens m
              WHERE m.conta_id = c.id AND m.direcao = 'enviada' AND m.status = 'enviada'
                AND m.enviado_em >= ${INICIO_MES_SP_TS})::int AS "whatsappEnviadas",
            (SELECT count(*) FROM comercial.chips h WHERE h.conta_id = c.id AND h.token_cifrado IS NOT NULL)::int AS numeros,
            coalesce((SELECT sum(gasto_usd) FROM descoberta.v_uso_places_mes v
                       WHERE v.conta_id = c.id AND v.mes = ${INICIO_MES_SP}), 0)::float8 AS "placesUsd"
       FROM cadastro.contas c
       LEFT JOIN (
         SELECT conta_id,
                sum(buscas) FILTER (WHERE servico = 'serper') AS serper,
                sum(buscas) FILTER (WHERE servico = 'apify_instagram') AS apify_instagram,
                sum(buscas) FILTER (WHERE servico = 'apify_google') AS apify_google
           FROM cadastro.consumo_buscas WHERE dia >= ${INICIO_MES_SP} GROUP BY conta_id
       ) b ON b.conta_id = c.id
       LEFT JOIN (
         SELECT conta_id,
                sum(chamadas) FILTER (WHERE origem = 'plataforma') AS chamadas,
                sum(tokens_entrada) FILTER (WHERE origem = 'plataforma') AS entrada,
                sum(tokens_saida) FILTER (WHERE origem = 'plataforma') AS saida,
                sum(chamadas) FILTER (WHERE origem = 'conta') AS chamadas_conta
           FROM cadastro.consumo_ia WHERE dia >= ${INICIO_MES_SP} GROUP BY conta_id
       ) ia ON ia.conta_id = c.id
      ORDER BY c.principal DESC, c.ativa DESC, c.nome`,
  );
  return rows;
}

export interface ClientePainel {
  id: number;
  nome: string;
  ativa: boolean;
  principal: boolean;
  criadoEm: string;
  desativadaEm: string | null;
  ultimoAcesso: string | null;
  plano: Plano | null;
  mensalidade: number | null;
  usuarios: { uso: number; limite: number | null };
  leads: { mes: number; limite: number | null; ultimos14d: number; mesAnterior: number; esperando: number };
  noFunil: number;
  uso: {
    serper: number;
    apifyInstagram: number;
    apifyGoogle: number;
    iaChamadas: number;
    iaTokensEntrada: number;
    iaTokensSaida: number;
    /** Chamadas com a chave de IA do próprio cliente (custo dele). */
    iaChamadasProprias: number;
    emails: number;
    whatsappEnviadas: number;
    numerosWhatsapp: number;
    placesUsd: number;
  };
  /** Quem paga cada serviço: a plataforma (custo seu) ou o cliente (chave dele). */
  pagaPlataforma: { ia: boolean; email: boolean; whatsapp: boolean; maps: boolean };
  custo: CustoEstimado;
  margem: number | null;
  saude: SinalSaude;
  saudeTexto: string;
}

const DIA = 86_400_000;

function avaliarSaude(l: LinhaConta, p: PlanoComUso, agora: Date): { saude: SinalSaude; texto: string } {
  const idade = (agora.getTime() - new Date(l.criadoEm).getTime()) / DIA;
  const semAcesso = l.ultimoAcesso ? (agora.getTime() - new Date(l.ultimoAcesso).getTime()) / DIA : null;
  const pct = p.leadsMes ? p.uso.leadsMes / p.leadsMes : null;
  if (pct != null && pct >= 0.9)
    return {
      saude: 'no_limite',
      texto:
        pct >= 1
          ? `Usou todos os leads do plano${p.uso.leadsEsperando ? ` e tem ${p.uso.leadsEsperando} esperando` : ''}: hora de oferecer mais leads.`
          : `Já usou ${Math.round(pct * 100)}% dos leads do mês.`,
    };
  if (idade < 14) return { saude: 'novo', texto: 'Cliente novo: acompanhe a primeira campanha.' };
  if (semAcesso == null || semAcesso >= 10)
    return {
      saude: 'parado',
      texto:
        semAcesso == null
          ? 'Ninguém da equipe entrou ainda.'
          : `Ninguém entra há ${Math.floor(semAcesso)} dias.`,
    };
  const diaDoMes = Number(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', day: 'numeric' }).format(agora),
  );
  if (l.leads14d === 0) return { saude: 'pouco_uso', texto: 'Nenhum lead enriquecido nos últimos 14 dias.' };
  if (pct != null && diaDoMes >= 15 && pct < 0.15)
    return { saude: 'pouco_uso', texto: `Usou só ${Math.round(pct * 100)}% dos leads do mês.` };
  return { saude: 'ok', texto: 'Usando normalmente.' };
}

export async function clientes(
  db: Executor,
  credenciais: { chave: string | null; ambiente: CredenciaisAmbiente },
): Promise<{ clientes: ClientePainel[]; custos: CustosPlataforma }> {
  const [linhas, custos] = await Promise.all([linhasDasContas(db), lerCustos(db)]);
  const ativosPagantes = linhas.filter((l) => l.ativa && !l.principal).length || 1;
  const infraPorConta = custos.infraMes / ativosPagantes;
  const agora = new Date();
  const lista = await Promise.all(
    linhas.map(async (l): Promise<ClientePainel> => {
      const [p, cred] = await Promise.all([
        planoDaConta(db, l.id),
        credenciaisEfetivas(db, l.id, credenciais.chave, credenciais.ambiente).catch(() => null),
      ]);
      const paga = {
        ia: true, // consumo_ia já separa: só as chamadas com a chave da plataforma entram no custo.
        email: cred?.origem.resend === 'plataforma',
        whatsapp: cred?.origem.whatsapp === 'plataforma',
        maps: cred?.origem.places === 'plataforma',
      };
      const usoPago: UsoPago = {
        serper: l.serper,
        apifyInstagram: l.apifyInstagram,
        apifyGoogle: l.apifyGoogle,
        iaTokensEntrada: l.iaEntrada,
        iaTokensSaida: l.iaSaida,
        emails: paga.email ? l.emails : 0,
        numerosWhatsapp: paga.whatsapp ? l.numeros : 0,
        placesUsd: paga.maps ? l.placesUsd : 0,
      };
      const custo = custoEstimado(usoPago, custos, l.ativa && !l.principal ? infraPorConta : 0);
      const s = avaliarSaude(l, p, agora);
      return {
        id: l.id,
        nome: l.nome,
        ativa: l.ativa,
        principal: l.principal,
        criadoEm: l.criadoEm,
        desativadaEm: l.desativadaEm,
        ultimoAcesso: l.ultimoAcesso,
        plano: p.plano,
        mensalidade: p.mensalidade,
        usuarios: { uso: p.uso.usuarios, limite: p.usuarios },
        leads: {
          mes: p.uso.leadsMes,
          limite: p.leadsMes,
          ultimos14d: l.leads14d,
          mesAnterior: l.leadsMesAnterior,
          esperando: p.uso.leadsEsperando,
        },
        noFunil: l.noFunil,
        uso: {
          serper: l.serper,
          apifyInstagram: l.apifyInstagram,
          apifyGoogle: l.apifyGoogle,
          iaChamadas: l.iaChamadas,
          iaTokensEntrada: l.iaEntrada,
          iaTokensSaida: l.iaSaida,
          iaChamadasProprias: l.iaChamadasConta,
          emails: l.emails,
          whatsappEnviadas: l.whatsappEnviadas,
          numerosWhatsapp: l.numeros,
          placesUsd: l.placesUsd,
        },
        pagaPlataforma: paga,
        custo,
        margem: p.mensalidade != null ? Math.round((p.mensalidade - custo.total) * 100) / 100 : null,
        saude: l.principal ? 'ok' : l.ativa ? s.saude : 'ok',
        saudeTexto: l.principal ? 'Sua conta.' : l.ativa ? s.texto : 'Conta desativada.',
      };
    }),
  );
  return { clientes: lista, custos };
}

/** Pedidos de demonstração por etapa e o que entrou/fechou no mês. */
export async function resumoVendas(db: Executor) {
  const { rows } = await db.query<{ etapa: string; n: number }>(
    'SELECT etapa, count(*)::int AS n FROM cadastro.pedidos_site GROUP BY etapa',
  );
  const { rows: mes } = await db.query<{ novos: number; clientes: number; perdidos: number }>(
    `SELECT count(*) FILTER (WHERE criado_em >= ${INICIO_MES_SP_TS})::int AS novos,
            count(*) FILTER (WHERE etapa = 'cliente' AND atualizado_em >= ${INICIO_MES_SP_TS})::int AS clientes,
            count(*) FILTER (WHERE etapa = 'perdido' AND atualizado_em >= ${INICIO_MES_SP_TS})::int AS perdidos
       FROM cadastro.pedidos_site`,
  );
  return {
    porEtapa: Object.fromEntries(rows.map((r) => [r.etapa, r.n])) as Record<string, number>,
    mes: mes[0] ?? { novos: 0, clientes: 0, perdidos: 0 },
  };
}

/** Saúde da máquina: filas, alertas da plataforma, enriquecimento e base CNPJ. */
export async function operacao(db: Executor) {
  const [alertas, enriq, etapasErro, base, basePaga, ultimos] = await Promise.all([
    db.query(
      `SELECT a.id::int, a.conta_id AS "contaId", c.nome AS "contaNome", a.nivel, a.titulo, a.texto,
              a.primeira_vez AS "primeiraVez", a.ultima_vez AS "ultimaVez"
         FROM comercial.alertas a LEFT JOIN cadastro.contas c ON c.id = a.conta_id
        WHERE a.ativo ORDER BY (a.nivel = 'erro') DESC, a.primeira_vez LIMIT 50`,
    ),
    db.query<{
      na_fila: number;
      rodando: number;
      concluidos24h: number;
      erros24h: number;
      parciais24h: number;
      limite: number;
    }>(
      `SELECT count(*) FILTER (WHERE status = 'na_fila')::int AS na_fila,
              count(*) FILTER (WHERE status = 'rodando')::int AS rodando,
              count(*) FILTER (WHERE status = 'concluido' AND concluido_em > now() - interval '24 hours')::int AS concluidos24h,
              count(*) FILTER (WHERE status = 'erro' AND atualizado_em > now() - interval '24 hours')::int AS erros24h,
              count(*) FILTER (WHERE status = 'concluido' AND cardinality(pendencias) > 0
                                 AND concluido_em > now() - interval '24 hours')::int AS parciais24h,
              count(*) FILTER (WHERE status = 'limite')::int AS limite
         FROM enriquecimento.leads`,
    ),
    db.query<{ etapa: string; erros: number; total: number }>(
      `SELECT etapa, count(*) FILTER (WHERE status = 'erro')::int AS erros, count(*)::int AS total
         FROM enriquecimento.etapas WHERE criado_em > now() - interval '24 hours'
        GROUP BY etapa HAVING count(*) FILTER (WHERE status = 'erro') > 0
        ORDER BY 2 DESC LIMIT 12`,
    ),
    db.query(`SELECT mes, status, concluido_em AS "concluidoEm" FROM base_cnpj.v_ultima_importacao`),
    db.query<{ consultas: number; custo: number }>(
      `SELECT count(*)::int AS consultas, coalesce(sum(custo_brl), 0)::float8 AS custo
         FROM enriquecimento.uso_base_paga WHERE criado_em >= ${INICIO_MES_SP_TS}`,
    ),
    db.query<{ dia: string; concluidos: number; erros: number }>(
      `SELECT to_char(d, 'YYYY-MM-DD') AS dia,
              (SELECT count(*) FROM enriquecimento.leads l WHERE l.status = 'concluido'
                AND (l.concluido_em AT TIME ZONE 'America/Sao_Paulo')::date = d)::int AS concluidos,
              (SELECT count(*) FROM enriquecimento.leads l WHERE l.status = 'erro'
                AND (l.atualizado_em AT TIME ZONE 'America/Sao_Paulo')::date = d)::int AS erros
         FROM generate_series((now() AT TIME ZONE 'America/Sao_Paulo')::date - 13,
                              (now() AT TIME ZONE 'America/Sao_Paulo')::date, interval '1 day') d`,
    ),
  ]);
  return {
    alertas: alertas.rows,
    enriquecimento: enriq.rows[0],
    fontesComErro: etapasErro.rows,
    baseCnpj: base.rows[0] ?? null,
    basePaga: basePaga.rows[0] ?? { consultas: 0, custo: 0 },
    enriquecimentoPorDia: ultimos.rows,
  };
}
