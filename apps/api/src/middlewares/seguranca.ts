import type { Executor } from '@prospeccao/db';
import { AppError } from '@prospeccao/shared';
import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { comUsuario, type UsuarioSessao, usuarioAtual } from '../contexto.js';

export const COOKIE_SESSAO = 'sessao';

declare global {
  namespace Express {
    interface Request {
      usuario?: UsuarioSessao;
    }
  }
}

/** Usuário ativo da sessão (consulta o banco: desativar alguém derruba a sessão na hora). */
export async function carregarUsuario(db: Executor, id: number): Promise<UsuarioSessao | null> {
  const { rows } = await db.query<UsuarioSessao>(
    'SELECT id, nome, email, papel FROM cadastro.usuarios WHERE id = $1 AND ativo',
    [id],
  );
  return rows[0] ?? null;
}

/** Exige o cookie de sessão válido de um usuário ativo. */
export function exigirSessao(jwtSegredo: string, db: Executor): RequestHandler {
  return (req, _res, next) => {
    const token = req.cookies?.[COOKIE_SESSAO] as string | undefined;
    if (!token) return next(AppError.naoAutorizado());
    let id: number;
    try {
      const dados = jwt.verify(token, jwtSegredo, { algorithms: ['HS256'] }) as jwt.JwtPayload;
      id = Number(dados.sub);
      // Sessão do tempo de um usuário só (sub = e-mail): faz login de novo.
      if (!Number.isInteger(id) || id <= 0) return next(AppError.naoAutorizado());
    } catch {
      return next(AppError.naoAutorizado('Sua sessão expirou. Faça login de novo.'));
    }
    carregarUsuario(db, id).then(
      (u) => {
        if (!u) return next(AppError.naoAutorizado('Seu acesso foi desativado.'));
        req.usuario = u;
        comUsuario(u, () => next());
      },
      (erro) => next(erro),
    );
  };
}

/** Só administrador. */
export const exigirAdmin: RequestHandler = (req, _res, next) => {
  const papel = req.usuario?.papel ?? usuarioAtual()?.papel;
  next(papel === 'admin' ? undefined : AppError.proibido());
};

/** Leitura para todos; criar, mudar e apagar só administrador. */
export const adminParaAlterar: RequestHandler = (req, res, next) =>
  METODOS_SEGUROS.has(req.method) ? next() : exigirAdmin(req, res, next);

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
