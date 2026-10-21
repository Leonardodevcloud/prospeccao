import type { CookieOptions, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { DepsApi } from '../../dependencias.js';
import { COOKIE_SESSAO } from '../../middlewares/seguranca.js';

export function opcoesCookie(auth: DepsApi['auth']): CookieOptions {
  return { httpOnly: true, sameSite: 'strict', secure: auth.cookieSeguro, path: '/' };
}

/**
 * Abre (ou renova) a sessão. `conta`: a conta em que o master entrou pelo painel (só vale para
 * master; para os outros a conta é sempre a do usuário).
 */
export function abrirSessao(res: Response, auth: DepsApi['auth'], id: number, conta?: number | null) {
  const token = jwt.sign(conta ? { c: conta } : {}, auth.jwtSegredo, {
    algorithm: 'HS256',
    subject: String(id),
    expiresIn: `${auth.sessaoHoras}h`,
  });
  res.cookie(COOKIE_SESSAO, token, { ...opcoesCookie(auth), maxAge: auth.sessaoHoras * 3600_000 });
}
