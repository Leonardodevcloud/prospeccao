import { type Executor, INICIO_MES_SP_TS } from '@prospeccao/db';
import {
  AppError,
  type Plano,
  type PlanoContaEntrada,
  type PlanoEfetivo,
  planoEfetivo,
} from '@prospeccao/shared';
import { conta } from '../../contexto.js';

/**
 * Plano de cada conta: o que foi contratado (plano, usuários, leads por mês, módulos) e quanto
 * já foi usado no mês. Conta sem plano não tem limite.
 */

export interface PlanoComUso extends PlanoEfetivo {
  limiteUsuariosProprio: number | null;
  limiteLeadsProprio: number | null;
  mensalidadeManual: number | null;
  planoDesde: string | null;
  uso: { usuarios: number; leadsMes: number; leadsEsperando: number };
}

/** Leads enriquecidos no mês (fuso de São Paulo) pelas campanhas da conta. */
export const sqlLeadsDoMes = (conta: string) =>
  `(SELECT count(*) FROM enriquecimento.leads l JOIN cadastro.campanhas ca ON ca.id = l.campanha_id
     WHERE ca.conta_id = ${conta} AND l.status = 'concluido' AND l.concluido_em >= ${INICIO_MES_SP_TS})::int`;

/** Usuários que ocupam vaga: ativos (o master da plataforma não conta). */
export const sqlUsuariosAtivos = (conta: string) =>
  `(SELECT count(*) FROM cadastro.usuarios u WHERE u.conta_id = ${conta} AND u.ativo AND NOT u.master)::int`;

export async function planoDaConta(db: Executor, contaId: number): Promise<PlanoComUso> {
  const C = String(Math.trunc(contaId));
  const { rows } = await db.query<{
    plano: Plano | null;
    limite_usuarios: number | null;
    limite_leads_mes: number | null;
    modulos: string[];
    mensalidade_manual: string | null;
    plano_desde: string | null;
    usuarios: number;
    leads: number;
    esperando: number;
  }>(
    `SELECT c.plano, c.limite_usuarios, c.limite_leads_mes, c.modulos, c.mensalidade_manual,
            to_char(c.plano_desde, 'YYYY-MM-DD') AS plano_desde,
            ${sqlUsuariosAtivos(C)} AS usuarios, ${sqlLeadsDoMes(C)} AS leads,
            (SELECT count(*) FROM enriquecimento.leads l JOIN cadastro.campanhas ca ON ca.id = l.campanha_id
              WHERE ca.conta_id = ${C} AND l.status = 'limite')::int AS esperando
       FROM cadastro.contas c WHERE c.id = ${C}`,
  );
  const r = rows[0];
  if (!r) throw AppError.naoEncontrado('Conta');
  const manual = r.mensalidade_manual == null ? null : Number(r.mensalidade_manual);
  return {
    ...planoEfetivo({
      plano: r.plano,
      limiteUsuarios: r.limite_usuarios,
      limiteLeadsMes: r.limite_leads_mes,
      modulos: r.modulos,
      mensalidadeManual: manual,
    }),
    limiteUsuariosProprio: r.limite_usuarios,
    limiteLeadsProprio: r.limite_leads_mes,
    mensalidadeManual: manual,
    planoDesde: r.plano_desde,
    uso: { usuarios: r.usuarios, leadsMes: r.leads, leadsEsperando: r.esperando },
  };
}

export async function salvarPlano(db: Executor, contaId: number, d: PlanoContaEntrada): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE cadastro.contas
        SET plano = $2, limite_usuarios = $3, limite_leads_mes = $4, modulos = $5, mensalidade_manual = $6,
            plano_desde = CASE WHEN $2::text IS NULL THEN NULL
                               WHEN plano IS DISTINCT FROM $2 THEN current_date ELSE plano_desde END
      WHERE id = $1`,
    [
      contaId,
      d.plano,
      d.plano ? d.limiteUsuarios : null,
      d.plano ? d.limiteLeadsMes : null,
      d.plano ? d.modulos : [],
      d.plano ? d.mensalidadeManual : null,
    ],
  );
  if (!rowCount) throw AppError.naoEncontrado('Conta');
}

/**
 * Antes de criar ou reativar alguém: a conta tem vaga no plano? (O master pode aumentar o número
 * de usuários da conta no painel.)
 */
export async function exigirVagaDeUsuario(db: Executor, contaId = conta()): Promise<void> {
  const p = await planoDaConta(db, contaId);
  if (p.usuarios != null && p.uso.usuarios >= p.usuarios)
    throw AppError.invalido(
      `O plano desta conta permite ${p.usuarios} usuário${p.usuarios > 1 ? 's' : ''} ativo${p.usuarios > 1 ? 's' : ''} e todos estão em uso. Desative alguém ou peça para aumentar o plano.`,
    );
}
