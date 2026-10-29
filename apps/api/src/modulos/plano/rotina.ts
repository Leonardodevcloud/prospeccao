import type { Logger } from '@prospeccao/shared';
import type { DepsApi } from '../../dependencias.js';
import * as alertas from '../alertas/repositorio.js';
import { planoDaConta, vagasDeLeads } from './repositorio.js';

type Deps = Pick<DepsApi, 'pool' | 'filas'> & { log: Logger };

const INTERVALO_MS = 10 * 60_000;
const LOCK = 7_301_037;

/**
 * Limite de leads do plano, conta por conta:
 *  - leads que esperaram o limite voltam para a fila quando há vaga (mês novo ou plano maior);
 *  - avisa os administradores quando a conta chega perto (90%) ou no limite do mês.
 */
export async function conferirLimitesDeLeads(deps: Deps): Promise<number> {
  const { rows: contas } = await deps.pool.query<{ id: number }>(
    `SELECT c.id FROM cadastro.contas c JOIN cadastro.organizacoes o ON o.id = c.organizacao_id
      WHERE c.ativa AND o.ativa AND o.plano IS NOT NULL ORDER BY c.id`,
  );
  let voltaram = 0;
  for (const { id } of contas) {
    const p = await planoDaConta(deps.pool, id);
    const vagas = vagasDeLeads(p);
    if (vagas == null) continue;
    if (vagas && p.unidade?.leadsEsperando) {
      const { rows } = await deps.pool.query<{ empresa_id: number; campanha_id: number }>(
        `UPDATE enriquecimento.leads l SET status = 'na_fila'
          WHERE l.empresa_id IN (
            SELECT l2.empresa_id FROM enriquecimento.leads l2 JOIN cadastro.campanhas ca ON ca.id = l2.campanha_id
             WHERE ca.conta_id = $1 AND l2.status = 'limite' ORDER BY l2.empresa_id LIMIT $2)
          RETURNING l.empresa_id::int, l.campanha_id::int`,
        [id, Math.min(vagas, 2000)],
      );
      if (rows.length)
        await deps.filas.publicarVarios(
          'enriquecimento.solicitar',
          rows.map((r) => ({ empresaId: r.empresa_id, campanhaId: r.campanha_id })),
        );
      voltaram += rows.length;
      if (rows.length)
        deps.log.info({ conta: id, leads: rows.length }, 'plano: leads em espera voltaram para a fila');
    }
    // O que aperta primeiro: a cota da unidade ou o total da organização.
    const pelaCota =
      p.unidade?.cota != null &&
      (p.leadsMes == null || p.unidade.cota - p.unidade.leadsMes <= p.leadsMes - p.uso.leadsMes);
    const limite = pelaCota ? p.unidade!.cota! : p.leadsMes!;
    const usados = pelaCota ? p.unidade!.leadsMes : p.uso.leadsMes;
    const quem = pelaCota ? 'A unidade' : 'A conta';
    const esperando = p.unidade?.leadsEsperando ?? 0;
    const usado = usados / Math.max(1, limite);
    await alertas.conferir(
      deps.pool,
      id,
      'plano:leads',
      usado >= 1
        ? {
            nivel: 'aviso',
            titulo: `${quem} chegou no limite de leads do mês`,
            texto: `${usados} de ${limite} leads enriquecidos. Os próximos esperam o mês virar${esperando ? ` (${esperando} esperando)` : ''}, ${pelaCota ? 'ou peça ao gestor para aumentar a cota da unidade' : 'ou peça para aumentar o plano'}.`,
            link: '/plano',
          }
        : usado >= 0.9
          ? {
              nivel: 'aviso',
              titulo: `${quem} está perto do limite de leads do mês`,
              texto: `${usados} de ${limite} leads enriquecidos neste mês.`,
              link: '/plano',
            }
          : null,
    );
  }
  return voltaram;
}

export function iniciarPlanos(deps: Deps): () => void {
  const rodar = async () => {
    const cliente = await deps.pool.connect();
    try {
      const { rows } = await cliente.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [LOCK]);
      if (!rows[0]?.ok) return;
      try {
        await conferirLimitesDeLeads(deps);
      } finally {
        await cliente.query('SELECT pg_advisory_unlock($1)', [LOCK]);
      }
    } catch (erro) {
      deps.log.error({ err: erro }, 'plano: verificação dos limites falhou');
    } finally {
      cliente.release();
    }
  };
  const primeiro = setTimeout(() => void rodar(), 90_000);
  const t = setInterval(() => void rodar(), INTERVALO_MS);
  primeiro.unref();
  t.unref();
  return () => {
    clearTimeout(primeiro);
    clearInterval(t);
  };
}
