import type { Executor } from '@prospeccao/db';
import { JANELA_DIRECT_HORAS } from '@prospeccao/shared';
import { contaSql } from '../../contexto.js';

/** Por qual canal a conversa com o lead segue (WhatsApp ou o direct do Instagram). */

/** A resposta da IA sai pelo direct quando a última mensagem dele foi no Instagram (e a janela está aberta). */
export async function destinoDaResposta(
  db: Executor,
  empresaId: number,
): Promise<{ canal: 'whatsapp' | 'instagram'; instagramId: string | null }> {
  const { rows } = await db.query<{ canal: string; instagram_id: string | null; aberta: boolean }>(
    `SELECT canal, instagram_id, criado_em > now() - interval '${JANELA_DIRECT_HORAS} hours' AS aberta
       FROM comercial.mensagens WHERE conta_id = ${contaSql()} AND empresa_id = $1 AND direcao = 'recebida'
      ORDER BY criado_em DESC, id DESC LIMIT 1`,
    [empresaId],
  );
  const u = rows[0];
  return u?.canal === 'instagram' && u.aberta && u.instagram_id
    ? { canal: 'instagram', instagramId: u.instagram_id }
    : { canal: 'whatsapp', instagramId: null };
}

/** Até quando dá para responder no direct (24 h depois da última mensagem dele). */
export async function janelaDoDirect(db: Executor, empresaId: number): Promise<string | null> {
  const { rows } = await db.query<{ ate: string | null }>(
    `SELECT max(criado_em) + interval '${JANELA_DIRECT_HORAS} hours' AS ate FROM comercial.mensagens
      WHERE conta_id = ${contaSql()} AND empresa_id = $1 AND direcao = 'recebida' AND canal = 'instagram'`,
    [empresaId],
  );
  return rows[0]?.ate ?? null;
}
