import { AppError } from '@prospeccao/shared';
import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';

export const COOKIE_SESSAO = 'sessao';

declare global {
  namespace Express {
    interface Request {
      usuario?: { email: string };
    }
  }
}

/** Exige o cookie de sessão válido. */
export function exigirSessao(jwtSegredo: string): RequestHandler {
  return (req, _res, next) => {
    const token = req.cookies?.[COOKIE_SESSAO] as string | undefined;
    if (!token) return next(AppError.naoAutorizado());
    try {
      const dados = jwt.verify(token, jwtSegredo, { algorithms: ['HS256'] }) as jwt.JwtPayload;
      if (typeof dados.sub !== 'string') return next(AppError.naoAutorizado());
      req.usuario = { email: dados.sub };
      next();
    } catch {
      next(AppError.naoAutorizado('Sua sessão expirou. Faça login de novo.'));
    }
  };
}

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Proteção contra CSRF além do SameSite=Strict: requisição que altera dados
 * precisa vir de uma origem conhecida (cabeçalho Origin ou, na falta, Referer).
 */
export function exigirOrigemConhecida(origens: string[]): RequestHandler {
  const permitidas = new Set(origens);
  return (req, _res, next) => {
    if (METODOS_SEGUROS.has(req.method)) return next();
    const origem =
      req.get('origin') ??
      (() => {
        const ref = req.get('referer');
        try {
          return ref ? new URL(ref).origin : undefined;
        } catch {
          return undefined;
        }
      })();
    if (origem && permitidas.has(origem.toLowerCase())) return next();
    next(new AppError(403, 'origem_recusada', 'Requisição de origem desconhecida.'));
  };
}
