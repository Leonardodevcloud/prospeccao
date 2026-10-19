import { AppError, loginEntrada } from '@prospeccao/shared';
import bcrypt from 'bcryptjs';
import { type CookieOptions, Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import type { DepsApi } from '../../dependencias.js';
import { corpo } from '../../middlewares/http.js';
import { COOKIE_SESSAO, exigirSessao } from '../../middlewares/seguranca.js';

/** Sistema de um usuário: credenciais vêm do ambiente, não do banco. */
export function rotasAuth(deps: DepsApi): Router {
  const r = Router();
  const { auth } = deps;

  const opcoesCookie: CookieOptions = {
    httpOnly: true,
    sameSite: 'strict',
    secure: auth.cookieSeguro,
    path: '/',
  };

  const limitarLogin = rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(new AppError(429, 'muitas_tentativas', 'Muitas tentativas de login. Espere 15 minutos.')),
  });

  r.post('/login', limitarLogin, async (req, res) => {
    const { email, senha } = corpo(req, loginEntrada);
    // Compara a senha mesmo com e-mail errado: o tempo de resposta não revela qual dos dois errou.
    const senhaOk = await bcrypt.compare(senha, auth.adminSenhaHash);
    if (email !== auth.adminEmail || !senhaOk) {
      throw new AppError(401, 'credenciais_invalidas', 'E-mail ou senha incorretos.');
    }
    const token = jwt.sign({}, auth.jwtSegredo, {
      algorithm: 'HS256',
      subject: email,
      expiresIn: `${auth.sessaoHoras}h`,
    });
    res.cookie(COOKIE_SESSAO, token, { ...opcoesCookie, maxAge: auth.sessaoHoras * 3600_000 });
    deps.log.info({ email }, 'login');
    res.json({ email });
  });

  r.post('/logout', (_req, res) => {
    res.clearCookie(COOKIE_SESSAO, opcoesCookie);
    res.status(204).end();
  });

  r.get('/eu', exigirSessao(auth.jwtSegredo), (req, res) => {
    res.json({ email: req.usuario!.email });
  });

  return r;
}
