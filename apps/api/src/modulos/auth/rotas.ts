import { AppError, aceitarConvite, loginEntrada, perfilEntrada, trocarSenha } from '@prospeccao/shared';
import bcrypt from 'bcryptjs';
import { type CookieOptions, type Response, Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import type { DepsApi } from '../../dependencias.js';
import { corpo } from '../../middlewares/http.js';
import { COOKIE_SESSAO, exigirSessao } from '../../middlewares/seguranca.js';

/** Hash qualquer para comparar quando o e-mail não existe (o tempo não revela se o e-mail existe). */
const HASH_FALSO = bcrypt.hashSync('senha-que-ninguem-tem', 10);

/**
 * Login da equipe. Cada pessoa tem e-mail e senha no banco; o login do ambiente (ADMIN_EMAIL /
 * ADMIN_SENHA_HASH) sempre entra como administrador, e serve de acesso de emergência.
 */
export function rotasAuth(deps: DepsApi): Router {
  const r = Router();
  const { auth, pool } = deps;

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

  function abrirSessao(res: Response, id: number) {
    const token = jwt.sign({}, auth.jwtSegredo, {
      algorithm: 'HS256',
      subject: String(id),
      expiresIn: `${auth.sessaoHoras}h`,
    });
    res.cookie(COOKIE_SESSAO, token, { ...opcoesCookie, maxAge: auth.sessaoHoras * 3600_000 });
  }

  /** O administrador do ambiente vira (ou continua) usuário admin ativo. */
  async function garantirAdminDoAmbiente(email: string): Promise<number> {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO cadastro.usuarios (nome, email, papel, ativo)
       VALUES ($1, $2, 'admin', true)
       ON CONFLICT ((lower(email))) DO UPDATE SET papel = 'admin', ativo = true
       RETURNING id`,
      [email.split('@')[0] ?? 'Administrador', email],
    );
    const id = rows[0]!.id;
    await pool.query('INSERT INTO comercial.metas (usuario_id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
    return id;
  }

  r.post('/login', limitarLogin, async (req, res) => {
    const { email, senha } = corpo(req, loginEntrada);
    const { rows } = await pool.query<{ id: number; senha_hash: string | null; ativo: boolean }>(
      'SELECT id, senha_hash, ativo FROM cadastro.usuarios WHERE lower(email) = $1',
      [email],
    );
    const u = rows[0];
    const senhaDoBancoOk = await bcrypt.compare(senha, u?.senha_hash ?? HASH_FALSO);
    let id: number | null = u?.ativo && u.senha_hash && senhaDoBancoOk ? u.id : null;
    if (!id && email === auth.adminEmail.toLowerCase() && (await bcrypt.compare(senha, auth.adminSenhaHash)))
      id = await garantirAdminDoAmbiente(auth.adminEmail);
    if (!id) throw new AppError(401, 'credenciais_invalidas', 'E-mail ou senha incorretos.');
    await pool.query('UPDATE cadastro.usuarios SET ultimo_acesso = now() WHERE id = $1', [id]);
    abrirSessao(res, id);
    deps.log.info({ usuario: id }, 'login');
    res.json({ ok: true });
  });

  r.post('/logout', (_req, res) => {
    res.clearCookie(COOKIE_SESSAO, opcoesCookie);
    res.status(204).end();
  });

  /** Convite: mostra de quem é o link (para a tela de criar senha). */
  r.get('/convite/:token', async (req, res) => {
    const { rows } = await pool.query<{ nome: string; email: string }>(
      `SELECT nome, email FROM cadastro.usuarios
        WHERE convite_token = $1 AND convite_expira > now() AND ativo`,
      [req.params.token],
    );
    if (!rows[0]) throw AppError.naoEncontrado('Convite (o link expirou ou já foi usado)');
    res.json(rows[0]);
  });

  /** Convite: cria a senha e já entra. */
  r.post('/convite/:token', limitarLogin, async (req, res) => {
    const { senha } = corpo(req, aceitarConvite);
    const hash = await bcrypt.hash(senha, 10);
    const { rows } = await pool.query<{ id: number }>(
      `UPDATE cadastro.usuarios
          SET senha_hash = $2, convite_token = NULL, convite_expira = NULL, ultimo_acesso = now()
        WHERE convite_token = $1 AND convite_expira > now() AND ativo
        RETURNING id`,
      [req.params.token, hash],
    );
    if (!rows[0]) throw AppError.naoEncontrado('Convite (o link expirou ou já foi usado)');
    abrirSessao(res, rows[0].id);
    res.json({ ok: true });
  });

  const sessao = exigirSessao(auth.jwtSegredo, pool);

  r.get('/eu', sessao, async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, nome, email, papel, telefone, agenda_token AS "agendaToken"
         FROM cadastro.usuarios WHERE id = $1`,
      [req.usuario!.id],
    );
    res.json(rows[0]);
  });

  r.patch('/eu', sessao, async (req, res) => {
    const d = corpo(req, perfilEntrada);
    await pool.query(
      `UPDATE cadastro.usuarios
          SET nome = coalesce($2, nome),
              telefone = CASE WHEN $3 THEN $4 ELSE telefone END
        WHERE id = $1`,
      [req.usuario!.id, d.nome ?? null, d.telefone !== undefined, d.telefone ?? null],
    );
    res.json({ ok: true });
  });

  r.post('/senha', sessao, limitarLogin, async (req, res) => {
    const { atual, nova } = corpo(req, trocarSenha);
    const { rows } = await pool.query<{ senha_hash: string | null }>(
      'SELECT senha_hash FROM cadastro.usuarios WHERE id = $1',
      [req.usuario!.id],
    );
    const ok = await bcrypt.compare(atual, rows[0]?.senha_hash ?? HASH_FALSO);
    if (!ok) throw AppError.invalido('A senha atual não confere.');
    await pool.query('UPDATE cadastro.usuarios SET senha_hash = $2 WHERE id = $1', [
      req.usuario!.id,
      await bcrypt.hash(nova, 10),
    ]);
    res.json({ ok: true });
  });

  return r;
}
