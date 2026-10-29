import { comTransacao, gravarLead } from '@prospeccao/db';
import { ErroDefinitivo } from '@prospeccao/queue';
import type { LeadImportado } from '@prospeccao/shared';
import type { Deps } from './dependencias.js';

/**
 * Leads que o cliente importou (Excel, CSV ou PDF), já lidos e conferidos por ele na tela. Cada lead
 * vira (ou reaproveita) uma empresa da base, entra na lista e ganha os contatos do arquivo, que ficam
 * só na conta dele (conta_id). Depois, se ele pediu, vai para o enriquecimento; a api põe no funil.
 */

interface Importacao {
  id: number;
  conta_id: number;
  campanha_id: number | null;
  status: string;
  leads: (LeadImportado & { empresaId?: number })[] | null;
  opcoes: { enriquecer?: boolean; funil?: { responsavelId: number | null } | null } | null;
}

/** Lote por transação (e de quanto em quanto a tela vê o andamento). */
const LOTE = 50;

export async function importarLeads(deps: Deps, importacaoId: number) {
  const { rows } = await deps.pool.query<Importacao>(
    `SELECT id, conta_id, campanha_id, status, leads, opcoes FROM cadastro.importacoes_leads WHERE id = $1`,
    [importacaoId],
  );
  const imp = rows[0];
  if (!imp) throw new ErroDefinitivo(`Importação ${importacaoId} não existe`);
  if (!['na_fila', 'gravando', 'erro'].includes(imp.status)) return; // já gravada
  if (!imp.campanha_id || !imp.leads) throw new ErroDefinitivo(`Importação ${importacaoId} sem lista`);
  const campanhaId = imp.campanha_id;
  const leads = imp.leads;

  await deps.pool.query(
    `UPDATE cadastro.importacoes_leads SET status = 'gravando', erro = NULL, iniciado_em = coalesce(iniciado_em, now())
      WHERE id = $1`,
    [imp.id],
  );
  const r = { novas: 0, existentes: 0, jaNaLista: 0, enriquecer: 0, suprimidas: 0 };
  try {
    for (let i = 0; i < leads.length; i += LOTE) {
      await comTransacao(deps.pool, async (db) => {
        for (const l of leads.slice(i, i + LOTE)) {
          const g = await gravarLead(db, imp.conta_id, campanhaId, l);
          // Titular que pediu para ser esquecido (LGPD): fica fora da lista.
          if (g.suprimida) {
            r.suprimidas++;
            continue;
          }
          l.empresaId = g.empresaId;
          if (g.nova) r.novas++;
          else r.existentes++;
          if (!g.ligada) r.jaNaLista++;
        }
      });
      await deps.pool.query(`UPDATE cadastro.importacoes_leads SET gravados = $2 WHERE id = $1`, [
        imp.id,
        Math.min(leads.length, i + LOTE),
      ]);
    }

    const ids = [...new Set(leads.map((l) => l.empresaId).filter((x): x is number => !!x))];
    if (imp.opcoes?.enriquecer) {
      // Só o que ainda não foi pedido nesta lista (importar de novo não paga duas vezes).
      const { rows: pedir } = await deps.pool.query<{ empresa_id: number }>(
        `UPDATE descoberta.campanha_empresas SET enriquecimento_solicitado_em = now(), dentro_do_raio = true
          WHERE campanha_id = $1 AND empresa_id = ANY($2::bigint[]) AND enriquecimento_solicitado_em IS NULL
          RETURNING empresa_id`,
        [campanhaId, ids],
      );
      for (const p of pedir)
        await deps.filas.publicar('enriquecimento.solicitar', {
          empresaId: Number(p.empresa_id),
          campanhaId,
        });
      r.enriquecer = pedir.length;
    }

    await deps.pool.query(
      `UPDATE cadastro.importacoes_leads
          SET status = $2, leads = $3, empresa_ids = $4, resultado = resultado || $5::jsonb, gravados = total,
              concluido_em = CASE WHEN $2 = 'concluida' THEN now() END
        WHERE id = $1`,
      [imp.id, imp.opcoes?.funil ? 'funil' : 'concluida', JSON.stringify(leads), ids, JSON.stringify(r)],
    );
    deps.log.info({ importacaoId, campanhaId, leads: leads.length, ...r }, 'leads importados gravados');
  } catch (erro) {
    await deps.pool.query(`UPDATE cadastro.importacoes_leads SET status = 'erro', erro = $2 WHERE id = $1`, [
      imp.id,
      erro instanceof Error ? erro.message.slice(0, 300) : String(erro),
    ]);
    throw erro;
  }
}
