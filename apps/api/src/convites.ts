import { createHash, randomBytes } from 'node:crypto';
import type { Executor } from '@prospeccao/db';

/**
 * Links de convite e de senha nova: o banco guarda só o hash do token (quem lê o banco ou um
 * backup não consegue usar o link); o token em si só existe no link entregue à pessoa.
 */
export const hashDoToken = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');

export function tokenDeConvite(): { token: string; hash: string } {
  const token = randomBytes(24).toString('base64url');
  return { token, hash: hashDoToken(token) };
}

/** Senha trocada ou link novo: todas as sessões abertas da pessoa caem na hora. */
export async function derrubarSessoes(db: Executor, usuarioId: number): Promise<void> {
  await db.query(
    'UPDATE cadastro.sessoes SET revogada_em = now() WHERE usuario_id = $1 AND revogada_em IS NULL',
    [usuarioId],
  );
}
