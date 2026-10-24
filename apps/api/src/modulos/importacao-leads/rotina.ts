import type { Pool } from '@prospeccao/db';
import type { LeadImportado, Logger } from '@prospeccao/shared';
import { comConta, contaSql } from '../../contexto.js';
import { definirResponsavel } from '../equipe/repositorio.js';
import { adicionar, registrarAtividade } from '../funil/repositorio.js';

/** Só uma instância da API põe no funil por vez. */
const LOCK = 7_301_044;
const INTERVALO_MS = 10_000;
const AUTOR = 'Importação de leads';

interface Pronta {
  id: number;
  conta_id: number;
  opcoes: { funil?: { responsavelId: number | null } | null } | null;
  leads: (LeadImportado & { empresaId?: number })[] | null;
  empresa_ids: string[];
}

/**
 * Importação que o worker terminou de gravar e o cliente pediu "mandar para o funil": entra no SDR
 * (pelo rodízio ou com a pessoa escolhida), com a observação da planilha como nota no lead.
 */
export async function porNoFunil(pool: Pool, log: Logger): Promise<number> {
  const cliente = await pool.connect();
  let feitas = 0;
  try {
    const { rows: lock } = await cliente.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [
      LOCK,
    ]);
    if (!lock[0]?.ok) return 0;
    try {
      for (;;) {
        const { rows } = await pool.query<Pronta>(
          `UPDATE cadastro.importacoes_leads SET status = 'concluida', concluido_em = now()
            WHERE id = (SELECT id FROM cadastro.importacoes_leads WHERE status = 'funil' ORDER BY id LIMIT 1)
            RETURNING id, conta_id, opcoes, leads, empresa_ids`,
        );
        const imp = rows[0];
        if (!imp) break;
        try {
          const r = await comConta(imp.conta_id, () => funilDaImportacao(pool, imp));
          await pool.query(
            `UPDATE cadastro.importacoes_leads SET resultado = resultado || $2::jsonb WHERE id = $1`,
            [imp.id, JSON.stringify({ funil: r })],
          );
          log.info({ importacaoId: imp.id, conta: imp.conta_id, ...r }, 'importação: leads no funil');
        } catch (erro) {
          log.error({ err: erro, importacaoId: imp.id }, 'importação: falha ao pôr no funil');
          await pool.query(`UPDATE cadastro.importacoes_leads SET erro = $2 WHERE id = $1`, [
            imp.id,
            'Os leads foram importados, mas não consegui pôr todos no funil. Selecione na tela de Leads e adicione.',
          ]);
        }
        feitas++;
      }
    } finally {
      await cliente.query('SELECT pg_advisory_unlock($1)', [LOCK]);
    }
  } catch (erro) {
    log.error({ err: erro }, 'importação: rotina do funil falhou');
  } finally {
    cliente.release();
  }
  return feitas;
}

async function funilDaImportacao(pool: Pool, imp: Pronta) {
  const ids = [...new Set(imp.empresa_ids.map(Number))];
  const { rows: antes } = await pool.query<{ empresa_id: string }>(
    `SELECT empresa_id FROM comercial.oportunidades
      WHERE conta_id = ${contaSql()} AND empresa_id = ANY($1::bigint[]) AND etapa <> 'descartado'`,
    [ids],
  );
  const jaEstavam = new Set(antes.map((x) => Number(x.empresa_id)));
  const total = { adicionadas: 0, jaNoFunil: 0, duplicadas: 0 };
  for (let i = 0; i < ids.length; i += 500) {
    const r = await adicionar(
      pool,
      { empresaIds: ids.slice(i, i + 500), etapa: 'a_abordar', forcar: false },
      AUTOR,
    );
    total.adicionadas += r.adicionadas;
    total.jaNoFunil += r.jaNoFunil;
    total.duplicadas += r.duplicadas.length;
  }
  const { rows: depois } = await pool.query<{ empresa_id: string }>(
    `SELECT empresa_id FROM comercial.oportunidades
      WHERE conta_id = ${contaSql()} AND empresa_id = ANY($1::bigint[]) AND etapa <> 'descartado'`,
    [ids],
  );
  const novas = depois.map((x) => Number(x.empresa_id)).filter((id) => !jaEstavam.has(id));
  const responsavel = imp.opcoes?.funil?.responsavelId ?? null;
  if (responsavel) for (const id of novas) await definirResponsavel(pool, id, responsavel, 'importação');

  // O que veio na planilha e não tem coluna própria fica como nota no lead.
  const novasSet = new Set(novas);
  for (const l of imp.leads ?? []) {
    if (!l.empresaId || !novasSet.has(l.empresaId)) continue;
    const partes = [
      l.contato ? `Contato: ${l.contato}${l.cargo ? ` (${l.cargo})` : ''}` : null,
      l.observacao ? `Observação: ${l.observacao}` : null,
    ].filter(Boolean);
    if (partes.length)
      await registrarAtividade(
        pool,
        l.empresaId,
        { tipo: 'nota', direcao: null, texto: `Da planilha importada. ${partes.join(' · ')}` },
        AUTOR,
      );
  }
  return total;
}

/** Roda a cada 10 segundos (só quando há importação esperando o funil). Devolve a função que para. */
export function iniciarImportacaoLeads(pool: Pool, log: Logger): () => void {
  const t = setInterval(() => void porNoFunil(pool, log), INTERVALO_MS);
  t.unref();
  return () => clearInterval(t);
}
