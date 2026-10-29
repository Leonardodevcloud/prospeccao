import type { Executor } from '@prospeccao/db';
import type { CookieOptions, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { DepsApi } from '../../dependencias.js';
import { COOKIE_SESSAO } from '../../middlewares/seguranca.js';

export function opcoesCookie(auth: DepsApi['auth']): CookieOptions {
  return { httpOnly: true, sameSite: 'strict', secure: auth.cookieSeguro, path: '/' };
}

/**
 * Abre (ou renova) o cookie da sessão. `conta`: a conta (unidade) em que o master ou o gestor
 * entrou; `sessao`: o registro da sessão (a pessoa vê e pode encerrar). Trocar de unidade renova o
 * cookie mantendo a mesma sessão.
 */
export function abrirSessao(
  res: Response,
  auth: DepsApi['auth'],
  id: number,
  conta?: number | null,
  sessao?: string | null,
) {
  const token = jwt.sign(
    { ...(conta ? { c: conta } : {}), ...(sessao ? { s: sessao } : {}) },
    auth.jwtSegredo,
    {
      algorithm: 'HS256',
      subject: String(id),
      expiresIn: `${auth.sessaoHoras}h`,
    },
  );
  res.cookie(COOKIE_SESSAO, token, { ...opcoesCookie(auth), maxAge: auth.sessaoHoras * 3600_000 });
}

/** Login novo: registra a sessão (aparelho, endereço) e abre o cookie. */
export async function iniciarSessao(
  db: Executor,
  req: Request,
  res: Response,
  auth: DepsApi['auth'],
  id: number,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO cadastro.sessoes (usuario_id, expira_em, ip, aparelho)
     VALUES ($1, now() + make_interval(hours => $2), $3, $4) RETURNING id`,
    [id, auth.sessaoHoras, ipDaRequisicao(req), (req.get('user-agent') ?? '').slice(0, 300) || null],
  );
  const sid = rows[0]!.id;
  abrirSessao(res, auth, id, null, sid);
  return sid;
}

/** Sessão do cookie (para encerrar no logout), sem exigir que ainda seja válida. */
export function sessaoDoCookie(req: Request, segredo: string): string | null {
  const token = req.cookies?.[COOKIE_SESSAO] as string | undefined;
  if (!token) return null;
  try {
    const d = jwt.verify(token, segredo, { algorithms: ['HS256'], ignoreExpiration: true }) as jwt.JwtPayload;
    return typeof d.s === 'string' ? d.s : null;
  } catch {
    return null;
  }
}

export function ipDaRequisicao(req: Request): string | null {
  return (req.ip ?? '').replace(/^::ffff:/, '') || null;
}
