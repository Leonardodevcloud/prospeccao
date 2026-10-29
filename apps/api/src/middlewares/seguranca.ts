import type { Executor } from '@prospeccao/db';
import { AppError, type PapelQualquer } from '@prospeccao/shared';
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
  sessaoId?: string | null,
): Promise<UsuarioSessao | null> {
  // Sessão registrada: encerrada (pela pessoa, troca de senha, logout) ou vencida derruba na hora.
  if (sessaoId) {
    const { rows: s } = await db.query<{ ok: boolean }>(
      `UPDATE cadastro.sessoes
          SET ultimo_uso = CASE WHEN ultimo_uso < now() - interval '5 minutes' THEN now() ELSE ultimo_uso END
        WHERE id = $1 AND usuario_id = $2 AND revogada_em IS NULL AND expira_em > now()
        RETURNING true AS ok`,
      [sessaoId, id],
    );
    if (!s[0]) return null;
  }
  const { rows } = await db.query<{
    id: number;
    nome: string;
    email: string;
    papel: PapelQualquer;
    master: boolean;
    conta_id: number;
    conta_ativa: boolean;
    organizacao_id: number;
    totp_ativo: boolean;
    exigir_2fa: boolean;
  }>(
    `SELECT u.id, u.nome, u.email, u.papel, u.master, u.conta_id, (c.ativa AND o.ativa) AS conta_ativa,
            c.organizacao_id, u.totp_ativo, o.exigir_2fa
       FROM cadastro.usuarios u JOIN cadastro.contas c ON c.id = u.conta_id
       JOIN cadastro.organizacoes o ON o.id = c.organizacao_id
      WHERE u.id = $1 AND u.ativo`,
    [id],
  );
  const u = rows[0];
  if (!u) return null;
  if (!u.conta_ativa && !u.master) return null;
  const { rows: contas } = await db.query<{
    id: number;
    nome: string;
    organizacao_id: number;
    ativa: boolean;
  }>('SELECT id, nome, organizacao_id, ativa FROM cadastro.contas WHERE id = ANY($1::int[])', [
    [u.conta_id, contaEscolhida ?? u.conta_id],
  ]);
  const daOrganizacao = u.papel === 'gestor' || u.papel === 'leitura';
  // O master entra em qualquer conta; o gestor e a leitura, em qualquer unidade ativa da organização.
  const escolhida = contaEscolhida
    ? contas.find(
        (c) =>
          c.id === contaEscolhida &&
          (u.master || (daOrganizacao && c.organizacao_id === u.organizacao_id && c.ativa)),
      )
    : undefined;
  const conta = escolhida ?? contas.find((c) => c.id === u.conta_id);
  if (!conta) return null;
  const contaId = conta.id;
  return {
    id: u.id,
    nome: u.nome,
    email: u.email,
    // Dentro de outra conta, o master age como administrador dela; o gestor e a leitura veem cada
    // unidade como o administrador (a leitura não altera nada: exigirEscrita).
    papel:
      (u.master && contaId !== u.conta_id) || daOrganizacao ? 'admin' : (u.papel as UsuarioSessao['papel']),
    papelOrganizacao: daOrganizacao ? (u.papel as 'gestor' | 'leitura') : null,
    contaId,
    contaNome: conta.nome,
    organizacaoId: conta.organizacao_id,
    master: u.master,
    contaPropria: u.conta_id,
    sessaoId: sessaoId ?? null,
    // A organização exige verificação em duas etapas e a pessoa ainda não configurou.
    precisaDuasEtapas: u.exigir_2fa && !u.totp_ativo,
  };
}

/** Organização que exige duas etapas: sem configurar, só as telas de conta e login funcionam. */
export const exigirDuasEtapas: RequestHandler = (req, _res, next) => {
  if (!req.usuario?.precisaDuasEtapas) return next();
  next(
    new AppError(
      403,
      'configurar_duas_etapas',
      'Sua organização exige verificação em duas etapas. Configure em Minha conta para continuar.',
    ),
  );
};

/** Acesso só de leitura (diretoria): pode olhar tudo, não altera nada. */
export const exigirEscrita: RequestHandler = (req, _res, next) => {
  if (req.usuario?.papelOrganizacao !== 'leitura' || METODOS_SEGUROS.has(req.method)) return next();
  // Trocar de unidade e mexer no próprio perfil (senha, aviso no celular) continuam valendo.
  // Perguntar ao Argos também (ele só lê; criar tarefa pelo Argos é recusado lá dentro).
  if (
    /^\/organizacao\/(unidades\/\d+\/entrar|voltar)$|^\/(notificacoes|push)\b|^\/assistente(\/transcrever|\/falar(\/preparar)?|\/conversas\/\d+)?$/.test(
      req.path,
    )
  )
    return next();
  next(
    new AppError(403, 'somente_leitura', 'Seu acesso é só de leitura: você pode ver tudo, mas não alterar.'),
  );
};

/** Só o gestor da organização (ou o master). */
export const exigirGestor: RequestHandler = (req, _res, next) => {
  const u = req.usuario;
  next(u && (u.master || u.papelOrganizacao) ? undefined : AppError.proibido());
};

/** Exige o cookie de sessão válido de um usuário ativo (de uma conta ativa). */
export function exigirSessao(jwtSegredo: string, db: Executor): RequestHandler {
  return (req, _res, next) => {
    const token = req.cookies?.[COOKIE_SESSAO] as string | undefined;
    if (!token) return next(AppError.naoAutorizado());
    let id: number;
    let contaEscolhida: number | null = null;
    let sessaoId: string | null = null;
    try {
      const dados = jwt.verify(token, jwtSegredo, { algorithms: ['HS256'] }) as jwt.JwtPayload;
      id = Number(dados.sub);
      // Sessão do tempo de um usuário só (sub = e-mail): faz login de novo.
      if (!Number.isInteger(id) || id <= 0) return next(AppError.naoAutorizado());
      if (Number.isInteger(dados.c) && dados.c > 0) contaEscolhida = dados.c as number;
      if (typeof dados.s === 'string' && /^[0-9a-f-]{36}$/.test(dados.s)) sessaoId = dados.s;
    } catch {
      return next(AppError.naoAutorizado('Sua sessão expirou. Faça login de novo.'));
    }
    carregarUsuario(db, id, contaEscolhida, sessaoId).then(
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
