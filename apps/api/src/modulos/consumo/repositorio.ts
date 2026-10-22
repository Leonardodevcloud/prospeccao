import { type Executor, INICIO_MES_SP, INICIO_MES_SP_TS } from '@prospeccao/db';
import { AppError } from '@prospeccao/shared';
import { contaSql } from '../../contexto.js';

/**
 * Consumo e tetos de cada conta no mês (fuso de São Paulo): IA, e-mails, WhatsApp e Google Places.
 * Os tetos de e-mail e de WhatsApp valem para os envios automáticos (campanha, sequência, IA,
 * cadência); a mensagem que alguém da equipe manda à mão nunca é bloqueada.
 */

export type RecursoLimitado = 'emails' | 'whatsapp';

const ORIGENS_AUTOMATICAS = `('agente', 'cadencia', 'sequencia')`;

function sqlUsado(recurso: RecursoLimitado, conta: string): string {
  return recurso === 'emails'
    ? `(SELECT count(*) FROM comercial.envios_email
         WHERE conta_id = ${conta} AND canal = 'email' AND status = 'enviado' AND enviado_em >= ${INICIO_MES_SP_TS})::int`
    : `(SELECT count(*) FROM comercial.mensagens
         WHERE conta_id = ${conta} AND direcao = 'enviada' AND status = 'enviada'
           AND origem IN ${ORIGENS_AUTOMATICAS} AND enviado_em >= ${INICIO_MES_SP_TS})::int`;
}

/** Teto e uso do mês da conta da rodada (null = sem teto). */
export async function limiteDoMes(
  db: Executor,
  recurso: RecursoLimitado,
): Promise<{ limite: number | null; usado: number; esgotado: boolean }> {
  const C = contaSql();
  const coluna = recurso === 'emails' ? 'limite_emails_mes' : 'limite_whatsapp_mes';
  const { rows } = await db.query<{ limite: number | null; usado: number }>(
    `SELECT ${coluna} AS limite, ${sqlUsado(recurso, C)} AS usado FROM cadastro.contas WHERE id = ${C}`,
  );
  const r = rows[0] ?? { limite: null, usado: 0 };
  return { ...r, esgotado: r.limite != null && r.usado >= r.limite };
}

export interface ConsumoConta {
  mes: string;
  limites: {
    usaIaPlataforma: boolean;
    iaMes: number | null;
    emailsMes: number | null;
    whatsappMes: number | null;
  };
  ia: Record<
    'conta' | 'plataforma',
    { chamadas: number; tokensEntrada: number; tokensSaida: number; erros: number; bloqueadas: number }
  >;
  /** Chamadas à IA por dia no mês (as duas chaves somadas), para o gráfico. */
  iaPorDia: { dia: string; chamadas: number }[];
  emails: { enviados: number; naFila: number };
  whatsapp: { automaticas: number; equipe: number; recebidas: number };
  places: { pedidos: number; pagos: number; gastoUsd: number; enriquecimento: number };
  /** Buscas no Google pelo Serper (o principal custo do enriquecimento) e leads enriquecidos no mês. */
  buscas: { serper: number; leadsEnriquecidos: number };
}

/** Consumo do mês de uma conta (painel master: a conta vem da rota, não da sessão). */
export async function consumoDaConta(db: Executor, contaId: number): Promise<ConsumoConta> {
  const C = String(Math.trunc(contaId));
  const [conta, ia, porDia, outros] = await Promise.all([
    db.query<{
      usa_ia_plataforma: boolean;
      limite_ia_mes: number | null;
      limite_emails_mes: number | null;
      limite_whatsapp_mes: number | null;
      mes: string;
    }>(
      `SELECT usa_ia_plataforma, limite_ia_mes, limite_emails_mes, limite_whatsapp_mes,
              to_char(${INICIO_MES_SP}, 'YYYY-MM') AS mes
         FROM cadastro.contas WHERE id = $1`,
      [contaId],
    ),
    db.query<{
      origem: 'conta' | 'plataforma';
      chamadas: number;
      entrada: number;
      saida: number;
      erros: number;
      bloqueadas: number;
    }>(
      `SELECT origem, sum(chamadas)::int AS chamadas, sum(tokens_entrada)::float8 AS entrada,
              sum(tokens_saida)::float8 AS saida, sum(erros)::int AS erros, sum(bloqueadas)::int AS bloqueadas
         FROM cadastro.consumo_ia WHERE conta_id = $1 AND dia >= ${INICIO_MES_SP}
        GROUP BY origem`,
      [contaId],
    ),
    db.query<{ dia: string; chamadas: number }>(
      `SELECT to_char(d, 'YYYY-MM-DD') AS dia,
              coalesce((SELECT sum(chamadas) FROM cadastro.consumo_ia u WHERE u.conta_id = $1 AND u.dia = d), 0)::int AS chamadas
         FROM generate_series(${INICIO_MES_SP}, (now() AT TIME ZONE 'America/Sao_Paulo')::date, interval '1 day') d`,
      [contaId],
    ),
    db.query<{
      enviados: number;
      na_fila: number;
      automaticas: number;
      equipe: number;
      recebidas: number;
      pedidos: number;
      pagos: number;
      gasto: number;
      enriq: number;
      serper: number;
      leads: number;
    }>(
      `SELECT ${sqlUsado('emails', C)} AS enviados,
              (SELECT count(*) FROM comercial.envios_email en JOIN comercial.campanhas_email ce ON ce.id = en.campanha_email_id
                WHERE en.conta_id = ${C} AND en.status = 'na_fila' AND ce.status = 'enviando')::int AS na_fila,
              ${sqlUsado('whatsapp', C)} AS automaticas,
              (SELECT count(*) FROM comercial.mensagens WHERE conta_id = ${C} AND direcao = 'enviada'
                  AND status = 'enviada' AND origem = 'humano' AND enviado_em >= ${INICIO_MES_SP_TS})::int AS equipe,
              (SELECT count(*) FROM comercial.mensagens WHERE conta_id = ${C} AND direcao = 'recebida'
                  AND criado_em >= ${INICIO_MES_SP_TS})::int AS recebidas,
              coalesce((SELECT pedidos FROM descoberta.v_uso_places_mes WHERE conta_id = ${C} AND mes = ${INICIO_MES_SP}), 0)::int AS pedidos,
              coalesce((SELECT pagos FROM descoberta.v_uso_places_mes WHERE conta_id = ${C} AND mes = ${INICIO_MES_SP}), 0)::int AS pagos,
              coalesce((SELECT gasto_usd FROM descoberta.v_uso_places_mes WHERE conta_id = ${C} AND mes = ${INICIO_MES_SP}), 0)::float8 AS gasto,
              coalesce((SELECT pedidos FROM enriquecimento.v_uso_places_mes WHERE conta_id = ${C} AND mes = ${INICIO_MES_SP}), 0)::int AS enriq,
              coalesce((SELECT sum(buscas) FROM cadastro.consumo_buscas WHERE conta_id = ${C} AND dia >= ${INICIO_MES_SP}), 0)::int AS serper,
              (SELECT count(*) FROM enriquecimento.leads l JOIN cadastro.campanhas ca ON ca.id = l.campanha_id
                WHERE ca.conta_id = ${C} AND l.status = 'concluido' AND l.concluido_em >= ${INICIO_MES_SP_TS})::int AS leads`,
    ),
  ]);
  const c = conta.rows[0];
  if (!c) throw AppError.naoEncontrado('Conta');
  const vazio = { chamadas: 0, tokensEntrada: 0, tokensSaida: 0, erros: 0, bloqueadas: 0 };
  const porOrigem = { conta: { ...vazio }, plataforma: { ...vazio } };
  for (const r of ia.rows)
    porOrigem[r.origem] = {
      chamadas: r.chamadas,
      tokensEntrada: r.entrada,
      tokensSaida: r.saida,
      erros: r.erros,
      bloqueadas: r.bloqueadas,
    };
  const o = outros.rows[0]!;
  return {
    mes: c.mes,
    limites: {
      usaIaPlataforma: c.usa_ia_plataforma,
      iaMes: c.limite_ia_mes,
      emailsMes: c.limite_emails_mes,
      whatsappMes: c.limite_whatsapp_mes,
    },
    ia: porOrigem,
    iaPorDia: porDia.rows,
    emails: { enviados: o.enviados, naFila: o.na_fila },
    whatsapp: { automaticas: o.automaticas, equipe: o.equipe, recebidas: o.recebidas },
    places: { pedidos: o.pedidos, pagos: o.pagos, gastoUsd: o.gasto, enriquecimento: o.enriq },
    buscas: { serper: o.serper, leadsEnriquecidos: o.leads },
  };
}

/** Resumo para a lista de contas do painel: chamadas de IA da plataforma e o teto. */
export async function iaPlataformaPorConta(db: Executor): Promise<Map<number, number>> {
  const { rows } = await db.query<{ conta_id: number; chamadas: number }>(
    `SELECT conta_id, sum(chamadas)::int AS chamadas FROM cadastro.consumo_ia
      WHERE origem = 'plataforma' AND dia >= ${INICIO_MES_SP} GROUP BY conta_id`,
  );
  return new Map(rows.map((r) => [r.conta_id, r.chamadas]));
}

export async function salvarLimites(
  db: Executor,
  contaId: number,
  d: {
    usaIaPlataforma?: boolean;
    iaMes?: number | null;
    emailsMes?: number | null;
    whatsappMes?: number | null;
  },
): Promise<void> {
  const sets: string[] = [];
  const valores: unknown[] = [contaId];
  const set = (coluna: string, v: unknown) => {
    valores.push(v);
    sets.push(`${coluna} = $${valores.length}`);
  };
  if (d.usaIaPlataforma !== undefined) set('usa_ia_plataforma', d.usaIaPlataforma);
  if (d.iaMes !== undefined) set('limite_ia_mes', d.iaMes);
  if (d.emailsMes !== undefined) set('limite_emails_mes', d.emailsMes);
  if (d.whatsappMes !== undefined) set('limite_whatsapp_mes', d.whatsappMes);
  if (!sets.length) return;
  const { rowCount } = await db.query(`UPDATE cadastro.contas SET ${sets.join(', ')} WHERE id = $1`, valores);
  if (!rowCount) throw AppError.naoEncontrado('Conta');
}
