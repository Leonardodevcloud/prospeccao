/**
 * TLS da conexão com o Postgres, decidido pela URL. Usado pelo pool (db) e pelas filas (queue)
 * para os dois conectarem do mesmo jeito.
 *
 * - Sem TLS: localhost, `sslmode=disable` e a rede privada do Railway (`*.railway.internal`),
 *   que já é criptografada entre os serviços do projeto e não apresenta certificado.
 * - TLS sem verificar o certificado: `sslmode=no-verify` (ex.: proxy público do Railway,
 *   que usa certificado autoassinado).
 * - Nos demais casos, TLS com verificação (Neon, Supabase, RDS...).
 */
export type SslPostgres = undefined | { rejectUnauthorized: boolean };

/**
 * A URL sem `sslmode`/`sslrootcert`. O driver `pg` deixa esses parâmetros da URL sobrescreverem a
 * opção `ssl`; tirando-os, vale só o que `sslDoPostgres` decidiu.
 */
export function semSslmode(url: string): string {
  try {
    const u = new URL(url);
    for (const p of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) u.searchParams.delete(p);
    return u.toString();
  } catch {
    return url;
  }
}

export function sslDoPostgres(url: string): SslPostgres {
  let host = '';
  let modo = '';
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    modo = (u.searchParams.get('sslmode') ?? '').toLowerCase();
  } catch {
    return { rejectUnauthorized: true };
  }
  const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host);
  if (local || modo === 'disable' || host.endsWith('.railway.internal')) return undefined;
  if (modo === 'no-verify') return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
}
