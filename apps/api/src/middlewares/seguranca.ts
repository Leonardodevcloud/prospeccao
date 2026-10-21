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

/**
 * Usuário ativo da sessão e a conta em que está (consulta o banco: desativar alguém, ou a conta,
 * derruba a sessão na hora). O master pode estar "dentro" de outra conta (escolhida no painel);
 * lá ele age como administrador.
 */
export async function carregarUsuario(
  db: Executor,
  id: number,
  contaEscolhida?: number | null,
): Promise<UsuarioSessao | null> {
  const { rows } = await db.query<{
    id: number;
    nome: string;
    email: string;
    papel: UsuarioSessao['papel'];
    master: boolean;
    conta_id: number;
    conta_ativa: boolean;
  }>(
    `SELECT u.id, u.nome, u.email, u.papel, u.master, u.conta_id, c.ativa AS conta_ativa
       FROM cadastro.usuarios u JOIN cadastro.contas c ON c.id = u.conta_id
      WHERE u.id = $1 AND u.ativo`,
    [id],
  );
  const u = rows[0];
  if (!u) return null;
  if (!u.conta_ativa && !u.master) return null;
  const { rows: contas } = await db.query<{ id: number; nome: string }>(
    'SELECT id, nome FROM cadastro.contas WHERE id = ANY($1::int[])',
    [[u.conta_id, contaEscolhida ?? u.conta_id]],
  );
  const escolhida = u.master && contaEscolhida ? contas.find((c) => c.id === contaEscolhida) : undefined;
  const conta = escolhida ?? contas.find((c) => c.id === u.conta_id);
  if (!conta) return null;
  const contaId = conta.id;
  const nomeConta = conta.nome;
  return {
    id: u.id,
    nome: u.nome,
    email: u.email,
    // Dentro de outra conta, o master age como administrador dela.
    papel: u.master && contaId !== u.conta_id ? 'admin' : u.papel,
    contaId,
    contaNome: nomeConta,
    master: u.master,
    contaPropria: u.conta_id,
  };
}

/** Exige o cookie de sessão válido de um usuário ativo (de uma conta ativa). */
export function exigirSessao(jwtSegredo: string, db: Executor): RequestHandler {
  return (req, _res, next) => {
    const token = req.cookies?.[COOKIE_SESSAO] as string | undefined;
    if (!token) return next(AppError.naoAutorizado());
    let id: number;
    let contaEscolhida: number | null = null;
    try {
      const dados = jwt.verify(token, jwtSegredo, { algorithms: ['HS256'] }) as jwt.JwtPayload;
      id = Number(dados.sub);
      // Sessão do tempo de um usuário só (sub = e-mail): faz login de novo.
      if (!Number.isInteger(id) || id <= 0) return next(AppError.naoAutorizado());
      if (Number.isInteger(dados.c) && dados.c > 0) contaEscolhida = dados.c as number;
    } catch {
      return next(AppError.naoAutorizado('Sua sessão expirou. Faça login de novo.'));
    }
    carregarUsuario(db, id, contaEscolhida).then(
      (u) => {
        if (!u) return next(AppError.naoAutorizado('Seu acesso foi desativado.'));
        req.usuario = u;
        comUsuario(u, () => next());
      },
      (erro) => next(erro),
    );
  };
}

/** Só quem administra a plataforma (painel master). */
export const exigirMaster: RequestHandler = (req, _res, next) => {
  next(req.usuario?.master ? undefined : AppError.proibido());
};

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
