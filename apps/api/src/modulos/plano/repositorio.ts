import { type Executor, INICIO_MES_SP_TS } from '@prospeccao/db';
import {
  AppError,
  type Plano,
  type PlanoContaEntrada,
  type PlanoEfetivo,
  planoEfetivo,
  type TabelaPrecos,
  tabelaCompleta,
} from '@prospeccao/shared';
import { conta } from '../../contexto.js';
import { esquecerRecursos } from '../../recursos.js';

/**
 * Plano de cada conta: o que foi contratado (plano, usuários, leads por mês, módulos) e quanto
 * já foi usado no mês. Conta sem plano não tem limite.
 */

export interface PlanoComUso extends PlanoEfetivo {
  limiteUsuariosProprio: number | null;
  limiteLeadsProprio: number | null;
  mensalidadeManual: number | null;
  planoDesde: string | null;
  /** Recursos liberados à parte para esta organização (o master marca no painel). */
  recursosExtras: string[];
  /** Franquias combinadas só para esta organização (null = a do plano). */
  limiteHorasReuniaoProprio: number | null;
  limiteConversasIaProprio: number | null;
  /** Uso somado da organização inteira (o contrato vale para todas as unidades). */
  uso: { usuarios: number; leadsMes: number; leadsEsperando: number };
  organizacao: { id: number; nome: string; unidades: number };
  /** A unidade pedida: cota própria de leads (null = usa o que sobra da organização) e o uso dela. */
  unidade: { id: number; nome: string; cota: number | null; leadsMes: number; leadsEsperando: number } | null;
}

/** Leads enriquecidos no mês (fuso de São Paulo) pelas campanhas da conta (unidade). */
export const sqlLeadsDoMes = (conta: string) =>
  `(SELECT count(*) FROM enriquecimento.leads l JOIN cadastro.campanhas ca ON ca.id = l.campanha_id
     WHERE ca.conta_id = ${conta} AND l.status = 'concluido' AND l.concluido_em >= ${INICIO_MES_SP_TS})::int`;

/** Leads enriquecidos no mês por todas as unidades da organização. */
export const sqlLeadsDoMesDaOrganizacao = (org: string) =>
  `(SELECT count(*) FROM enriquecimento.leads l JOIN cadastro.campanhas ca ON ca.id = l.campanha_id
     JOIN cadastro.contas cc ON cc.id = ca.conta_id
     WHERE cc.organizacao_id = ${org} AND l.status = 'concluido' AND l.concluido_em >= ${INICIO_MES_SP_TS})::int`;

/** Usuários que ocupam vaga: ativos de todas as unidades (o master da plataforma não conta). */
export const sqlUsuariosAtivos = (org: string) =>
  `(SELECT count(*) FROM cadastro.usuarios u JOIN cadastro.contas cc ON cc.id = u.conta_id
     WHERE cc.organizacao_id = ${org} AND u.ativo AND NOT u.master)::int`;

/** Tabela de preços em vigor (a editada no painel master, ou a de partida). */
export async function tabelaDePrecos(db: Executor): Promise<TabelaPrecos> {
  const { rows } = await db.query<{ dados: unknown }>(
    'SELECT dados FROM cadastro.tabela_precos WHERE id = 1',
  );
  return tabelaCompleta(rows[0]?.dados);
}

export async function salvarTabelaDePrecos(db: Executor, t: TabelaPrecos, usuarioId: number | null) {
  await db.query(
    `INSERT INTO cadastro.tabela_precos (id, dados, atualizado_em, atualizado_por) VALUES (1, $1, now(), $2)
     ON CONFLICT (id) DO UPDATE SET dados = EXCLUDED.dados, atualizado_em = now(), atualizado_por = EXCLUDED.atualizado_por`,
    [JSON.stringify(t), usuarioId],
  );
  esquecerRecursos();
}

interface LinhaContrato {
  org_id: number;
  org_nome: string;
  plano: Plano | null;
  limite_usuarios: number | null;
  limite_leads_mes: number | null;
  modulos: string[];
  mensalidade_manual: string | null;
  plano_desde: string | null;
  numeros_extras: number;
  recursos_extras: string[];
  limite_horas_reuniao: number | null;
  limite_conversas_ia: number | null;
  usuarios: number;
  leads: number;
  esperando: number;
  unidades: number;
}

const SQL_CONTRATO = (filtro: string) =>
  `SELECT o.id AS org_id, o.nome AS org_nome, o.plano, o.limite_usuarios, o.limite_leads_mes, o.modulos,
          o.mensalidade_manual, to_char(o.plano_desde, 'YYYY-MM-DD') AS plano_desde,
          o.numeros_extras, o.recursos_extras, o.limite_horas_reuniao, o.limite_conversas_ia,
          ${sqlUsuariosAtivos('o.id')} AS usuarios, ${sqlLeadsDoMesDaOrganizacao('o.id')} AS leads,
          (SELECT count(*) FROM enriquecimento.leads l JOIN cadastro.campanhas ca ON ca.id = l.campanha_id
             JOIN cadastro.contas cc ON cc.id = ca.conta_id
            WHERE cc.organizacao_id = o.id AND l.status = 'limite')::int AS esperando,
          (SELECT count(*) FROM cadastro.contas cc WHERE cc.organizacao_id = o.id AND cc.ativa)::int AS unidades
     FROM cadastro.organizacoes o WHERE ${filtro}`;

async function montar(db: Executor, r: LinhaContrato): Promise<Omit<PlanoComUso, 'unidade'>> {
  const manual = r.mensalidade_manual == null ? null : Number(r.mensalidade_manual);
  const tabela = await tabelaDePrecos(db);
  return {
    ...planoEfetivo(
      {
        plano: r.plano,
        limiteUsuarios: r.limite_usuarios,
        limiteLeadsMes: r.limite_leads_mes,
        modulos: r.modulos,
        mensalidadeManual: manual,
        numerosExtras: r.numeros_extras,
        recursosExtras: r.recursos_extras,
        horasReuniao: r.limite_horas_reuniao,
        conversasIa: r.limite_conversas_ia,
      },
      tabela,
    ),
    limiteUsuariosProprio: r.limite_usuarios,
    limiteLeadsProprio: r.limite_leads_mes,
    mensalidadeManual: manual,
    planoDesde: r.plano_desde,
    recursosExtras: r.recursos_extras,
    limiteHorasReuniaoProprio: r.limite_horas_reuniao,
    limiteConversasIaProprio: r.limite_conversas_ia,
    uso: { usuarios: r.usuarios, leadsMes: r.leads, leadsEsperando: r.esperando },
    organizacao: { id: r.org_id, nome: r.org_nome, unidades: r.unidades },
  };
}

/** Contrato da organização (somado para todas as unidades). */
export async function planoDaOrganizacao(db: Executor, organizacaoId: number): Promise<PlanoComUso> {
  const { rows } = await db.query<LinhaContrato>(SQL_CONTRATO('o.id = $1'), [organizacaoId]);
  if (!rows[0]) throw AppError.naoEncontrado('Organização');
  return { ...(await montar(db, rows[0])), unidade: null };
}

/** Contrato da organização da conta, com a cota e o uso desta unidade. */
export async function planoDaConta(db: Executor, contaId: number): Promise<PlanoComUso> {
  const C = String(Math.trunc(contaId));
  const { rows } = await db.query<LinhaContrato>(
    SQL_CONTRATO(`o.id = (SELECT organizacao_id FROM cadastro.contas WHERE id = ${C})`),
  );
  if (!rows[0]) throw AppError.naoEncontrado('Conta');
  const { rows: u } = await db.query<{ nome: string; cota: number | null; leads: number; esperando: number }>(
    `SELECT c.nome, c.cota_leads_mes AS cota, ${sqlLeadsDoMes(C)} AS leads,
            (SELECT count(*) FROM enriquecimento.leads l JOIN cadastro.campanhas ca ON ca.id = l.campanha_id
              WHERE ca.conta_id = ${C} AND l.status = 'limite')::int AS esperando
       FROM cadastro.contas c WHERE c.id = ${C}`,
  );
  const x = u[0]!;
  return {
    ...(await montar(db, rows[0])),
    unidade: { id: contaId, nome: x.nome, cota: x.cota, leadsMes: x.leads, leadsEsperando: x.esperando },
  };
}

/** Quantos leads esta unidade ainda pode enriquecer no mês (null = sem limite). */
export function vagasDeLeads(p: PlanoComUso): number | null {
  const daOrg = p.leadsMes == null ? null : Math.max(0, p.leadsMes - p.uso.leadsMes);
  const daCota = p.unidade?.cota == null ? null : Math.max(0, p.unidade.cota - p.unidade.leadsMes);
  if (daOrg == null) return daCota;
  if (daCota == null) return daOrg;
  return Math.min(daOrg, daCota);
}

/** Grava o contrato na organização (vale para todas as unidades dela). */
export async function salvarPlano(db: Executor, organizacaoId: number, d: PlanoContaEntrada): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE cadastro.organizacoes
        SET plano = $2, limite_usuarios = $3, limite_leads_mes = $4, modulos = $5, mensalidade_manual = $6,
            numeros_extras = $7, recursos_extras = $8, limite_horas_reuniao = $9, limite_conversas_ia = $10,
            plano_desde = CASE WHEN $2::text IS NULL THEN NULL
                               WHEN plano IS DISTINCT FROM $2 THEN current_date ELSE plano_desde END
      WHERE id = $1`,
    [
      organizacaoId,
      d.plano,
      d.plano ? d.limiteUsuarios : null,
      d.plano ? d.limiteLeadsMes : null,
      d.plano ? d.modulos : [],
      d.plano ? d.mensalidadeManual : null,
      d.plano && d.modulos.includes('whatsapp') ? d.numerosExtras : 0,
      d.plano ? d.recursosExtras : [],
      d.plano ? d.horasReuniao : null,
      d.plano ? d.conversasIa : null,
    ],
  );
  if (!rowCount) throw AppError.naoEncontrado('Organização');
  esquecerRecursos();
}

/** Organização da conta (unidade). */
export async function organizacaoDaConta(db: Executor, contaId: number): Promise<number> {
  const { rows } = await db.query<{ o: number }>(
    'SELECT organizacao_id AS o FROM cadastro.contas WHERE id = $1',
    [contaId],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Conta');
  return rows[0].o;
}

/**
 * Antes de criar ou reativar alguém: a conta tem vaga no plano? (O master pode aumentar o número
 * de usuários da conta no painel.)
 */
export async function exigirVagaDeUsuario(db: Executor, contaId = conta()): Promise<void> {
  const p = await planoDaConta(db, contaId);
  if (p.usuarios != null && p.uso.usuarios >= p.usuarios)
    throw AppError.invalido(
      `O plano da organização permite ${p.usuarios} usuário${p.usuarios > 1 ? 's' : ''} ativo${p.usuarios > 1 ? 's' : ''} e todos estão em uso. Desative alguém ou peça para aumentar o plano.`,
    );
}
