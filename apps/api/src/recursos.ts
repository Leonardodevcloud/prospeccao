import { type Executor, INICIO_MES_SP_TS } from '@prospeccao/db';
import {
  AppError,
  NOME_PLANO,
  planoQueLibera,
  RECURSOS,
  type Recurso,
  type TabelaPrecos,
} from '@prospeccao/shared';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { conta } from './contexto.js';
import { type PlanoComUso, planoDaConta, tabelaDePrecos } from './modulos/plano/repositorio.js';

/**
 * O que o plano libera para cada conta (recursos, números de WhatsApp, franquias) e as travas das
 * rotas. O contrato fica lembrado por meio minuto (o painel master esquece ao salvar). Conta sem
 * plano tem tudo, sem limite.
 */

const VALIDADE_MS = 30_000;
const lembrados = new Map<number, { em: number; contrato: Promise<PlanoComUso> }>();
let tabelaLembrada: { em: number; tabela: Promise<TabelaPrecos> } | null = null;

export function esquecerRecursos(contaId?: number): void {
  if (contaId) lembrados.delete(contaId);
  else lembrados.clear();
  tabelaLembrada = null;
}

/** Contrato da conta (para saber o que vale; o uso que vem junto pode estar de meio minuto atrás). */
export function contratoDaConta(db: Executor, contaId: number = conta()): Promise<PlanoComUso> {
  const agora = Date.now();
  const x = lembrados.get(contaId);
  if (x && agora - x.em < VALIDADE_MS) return x.contrato;
  const contrato = planoDaConta(db, contaId);
  contrato.catch(() => lembrados.delete(contaId));
  lembrados.set(contaId, { em: agora, contrato });
  return contrato;
}

function tabela(db: Executor): Promise<TabelaPrecos> {
  const agora = Date.now();
  if (tabelaLembrada && agora - tabelaLembrada.em < VALIDADE_MS) return tabelaLembrada.tabela;
  tabelaLembrada = { em: agora, tabela: tabelaDePrecos(db) };
  return tabelaLembrada.tabela;
}

export async function temRecurso(db: Executor, r: Recurso, contaId: number = conta()): Promise<boolean> {
  const c = await contratoDaConta(db, contaId).catch(() => null);
  // Sem contrato achado (conta antiga, teste): não trava.
  return !c || c.recursos.includes(r);
}

/** Erro para quem tenta usar o que o plano não tem (a tela mostra o cartão "disponível no plano X"). */
export async function foraDoPlano(db: Executor, r: Recurso): Promise<AppError> {
  const p = planoQueLibera(r, await tabela(db));
  return new AppError(
    403,
    'fora_do_plano',
    `${RECURSOS[r].nome} não está no seu plano${p ? `: vem a partir do plano ${NOME_PLANO[p]}` : ''}. Fale com a gente para liberar.`,
    { detalhes: { recurso: r, plano: p } },
  );
}

export async function exigirRecurso(db: Executor, r: Recurso, contaId: number = conta()): Promise<void> {
  if (!(await temRecurso(db, r, contaId))) throw await foraDoPlano(db, r);
}

/** Trava de rota: o recurso precisa estar no plano (menos nos caminhos de `livre`). */
export function rotaComRecurso(
  db: Executor,
  r: Recurso,
  livre: (req: Request) => boolean = () => false,
): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (livre(req)) return next();
    exigirRecurso(db, r).then(() => next(), next);
  };
}

/* ───────────────────────────── Franquias do mês ───────────────────────────── */

const ORG = (contaId: number) =>
  `(SELECT organizacao_id FROM cadastro.contas WHERE id = ${Math.trunc(contaId)})`;

/** Horas de reunião por vídeo usadas no mês por todas as unidades da organização. */
export async function horasDeReuniaoNoMes(db: Executor, contaId: number = conta()): Promise<number> {
  const { rows } = await db.query<{ h: number }>(
    `SELECT coalesce(sum(extract(epoch FROM (coalesce(ss.encerrada_em, now()) - ss.iniciada_em))), 0)::float / 3600 AS h
       FROM comercial.sala_sessoes ss JOIN cadastro.contas c ON c.id = ss.conta_id
      WHERE c.organizacao_id = ${ORG(contaId)} AND ss.iniciada_em >= ${INICIO_MES_SP_TS}`,
  );
  return Number(rows[0]?.h ?? 0);
}

/** Conversas do Agente de IA no mês: leads diferentes a quem a IA mandou mensagem (organização toda). */
export async function conversasDaIaNoMes(db: Executor, contaId: number = conta()): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(DISTINCT (a.conta_id, a.empresa_id))::int AS n
       FROM comercial.atividades a JOIN cadastro.contas c ON c.id = a.conta_id
      WHERE c.organizacao_id = ${ORG(contaId)} AND a.autor = 'agente' AND a.direcao = 'enviada'
        AND a.criado_em >= ${INICIO_MES_SP_TS}`,
  );
  return rows[0]?.n ?? 0;
}

/** Antes de abrir uma reunião nova: ainda tem horas no mês? */
export async function exigirHorasDeReuniao(db: Executor, contaId: number = conta()): Promise<void> {
  await exigirRecurso(db, 'reunioes', contaId);
  const c = await contratoDaConta(db, contaId).catch(() => null);
  if (c?.horasReuniao == null) return;
  const usadas = await horasDeReuniaoNoMes(db, contaId);
  if (usadas >= c.horasReuniao)
    throw new AppError(
      403,
      'franquia',
      `As ${c.horasReuniao} horas de reunião do mês já foram usadas. Fale com a gente para aumentar a franquia; no dia 1º ela volta.`,
      { detalhes: { recurso: 'reunioes', usado: usadas, limite: c.horasReuniao } },
    );
}

/** O Agente de IA chegou ao limite de conversas do mês? (Aí ele passa as respostas para o time.) */
export async function agenteNoLimite(db: Executor, contaId: number = conta()): Promise<boolean> {
  const c = await contratoDaConta(db, contaId).catch(() => null);
  if (c?.conversasIa == null) return false;
  return (await conversasDaIaNoMes(db, contaId)) >= c.conversasIa;
}

/** Números de WhatsApp: quantos a organização pode conectar e quantos já estão conectados. */
export async function numerosDeWhatsapp(
  db: Executor,
  contaId: number = conta(),
): Promise<{ limite: number | null; usados: number }> {
  const c = await contratoDaConta(db, contaId).catch(() => null);
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM comercial.chips h JOIN cadastro.contas c ON c.id = h.conta_id
      WHERE c.organizacao_id = ${ORG(contaId)} AND h.token_cifrado IS NOT NULL`,
  );
  return { limite: c?.numerosWhatsapp ?? null, usados: rows[0]?.n ?? 0 };
}
