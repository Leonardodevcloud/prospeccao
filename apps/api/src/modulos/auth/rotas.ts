import { createHash, randomBytes } from 'node:crypto';
import {
  AppError,
  aceitarConvite,
  esqueciSenha,
  loginDuasEtapas,
  loginEntrada,
  montarEmail,
  perfilEntrada,
  TERMOS_VERSAO,
  trocarSenha,
} from '@prospeccao/shared';
import bcrypt from 'bcryptjs';
import { type Request, type Response, Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { DepsApi } from '../../dependencias.js';
import { enderecoDoApp } from '../../endereco.js';
import { corpo } from '../../middlewares/http.js';
import { COOKIE_SESSAO, exigirSessao } from '../../middlewares/seguranca.js';
import { ipDe } from '../auditoria/middleware.js';
import * as auditoria from '../auditoria/repositorio.js';
import { conferirSegundaEtapa, desafioDuasEtapas, lerDesafio, rotasContaSegura } from './contaSegura.js';
import { iniciarSessao, opcoesCookie, sessaoDoCookie } from './sessao.js';

/** Hash qualquer para comparar quando o e-mail não existe (o tempo não revela se o e-mail existe). */
const HASH_FALSO = bcrypt.hashSync('senha-que-ninguem-tem', 10);

/** O link de redefinição vale 1 hora e só uma vez. No banco fica só o hash do token. */
const HORAS_REDEFINIR = 1;
const hashDoToken = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');

/**
 * Login da equipe. Cada pessoa tem e-mail e senha no banco; o login do ambiente (ADMIN_EMAIL /
 * ADMIN_SENHA_HASH) sempre entra como administrador, e serve de acesso de emergência.
 */
export function rotasAuth(deps: DepsApi): Router {
  const r = Router();
  const { auth, pool } = deps;

  const limitarLogin = rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(new AppError(429, 'muitas_tentativas', 'Muitas tentativas de login. Espere 15 minutos.')),
  });

  /**
   * O administrador do ambiente vira (ou continua) usuário admin ativo da conta principal e master
   * da plataforma: é o acesso de emergência e quem cria as outras contas.
   */
  async function garantirAdminDoAmbiente(email: string): Promise<number> {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO cadastro.usuarios (nome, email, papel, ativo, master, conta_id)
       VALUES ($1, $2, 'admin', true, true, (SELECT id FROM cadastro.contas WHERE principal))
       ON CONFLICT ((lower(email))) DO UPDATE SET papel = 'admin', ativo = true, master = true
       RETURNING id`,
      [email.split('@')[0] ?? 'Administrador', email],
    );
    const id = rows[0]!.id;
    await pool.query('INSERT INTO comercial.metas (usuario_id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
    return id;
  }

  /** Evento de acesso para a auditoria (nunca atrasa nem derruba o login). */
  const registrarAcesso = (
    req: Request,
    u: { id: number | null; nome: string | null; contaId: number | null },
    acao: string,
    descricao: string,
  ) =>
    auditoria
      .registrar(pool, {
        contaId: u.contaId,
        usuarioId: u.id,
        usuarioNome: u.nome,
        acao,
        descricao,
        metodo: req.method,
        caminho: req.baseUrl + req.path,
        ip: ipDe(req),
      })
      .catch((erro) => deps.log.warn({ err: erro }, 'auditoria: não consegui registrar o acesso'));

  const quem = async (id: number) => {
    const { rows } = await pool.query<{ nome: string; conta_id: number }>(
      'SELECT nome, conta_id FROM cadastro.usuarios WHERE id = $1',
      [id],
    );
    return { id, nome: rows[0]?.nome ?? null, contaId: rows[0]?.conta_id ?? null };
  };

  const temDuasEtapas = async (id: number) => {
    const { rows } = await pool.query<{ ativo: boolean }>(
      'SELECT totp_ativo AS ativo FROM cadastro.usuarios WHERE id = $1',
      [id],
    );
    return !!rows[0]?.ativo;
  };

  /** Abre a sessão (registrada) e deixa no histórico. */
  const entrar = async (req: Request, res: Response, id: number, descricao: string) => {
    await pool.query('UPDATE cadastro.usuarios SET ultimo_acesso = now() WHERE id = $1', [id]);
    await iniciarSessao(pool, req, res, auth, id);
    void registrarAcesso(req, await quem(id), 'acesso', descricao);
    deps.log.info({ usuario: id }, 'login');
    res.json({ ok: true });
  };

  r.post('/login', limitarLogin, async (req, res) => {
    const { email, senha } = corpo(req, loginEntrada);
    const { rows } = await pool.query<{
      id: number;
      senha_hash: string | null;
      ativo: boolean;
      master: boolean;
      conta_ativa: boolean;
    }>(
      `SELECT u.id, u.senha_hash, u.ativo, u.master, c.ativa AS conta_ativa
         FROM cadastro.usuarios u JOIN cadastro.contas c ON c.id = u.conta_id
        WHERE lower(u.email) = $1`,
      [email],
    );
    const u = rows[0];
    const senhaDoBancoOk = await bcrypt.compare(senha, u?.senha_hash ?? HASH_FALSO);
    let id: number | null = u?.ativo && u.senha_hash && senhaDoBancoOk ? u.id : null;
    // O e-mail do ADMIN_EMAIL é sempre o master da plataforma, mesmo entrando com a senha do banco.
    if (id && !u?.master && email === auth.adminEmail.toLowerCase())
      id = await garantirAdminDoAmbiente(auth.adminEmail);
    if (!id && email === auth.adminEmail.toLowerCase() && (await bcrypt.compare(senha, auth.adminSenhaHash)))
      id = await garantirAdminDoAmbiente(auth.adminEmail);
    if (!id) {
      // Senha errada de alguém que existe: fica no histórico da conta dela.
      if (u) {
        const q = await quem(u.id);
        void registrarAcesso(req, q, 'acesso', 'Tentativa de login com senha errada');
      }
      throw new AppError(401, 'credenciais_invalidas', 'E-mail ou senha incorretos.');
    }
    if (id === u?.id && !u.conta_ativa && !u.master)
      throw new AppError(
        403,
        'conta_desativada',
        'O acesso desta empresa está desativado. Fale com o administrador.',
      );
    // Verificação em duas etapas ligada: a senha conferiu, falta o código do app.
    if (await temDuasEtapas(id)) {
      void registrarAcesso(req, await quem(id), 'acesso', 'Senha certa; esperando o código das duas etapas');
      res.json({ duasEtapas: true, desafio: desafioDuasEtapas(auth.jwtSegredo, id) });
      return;
    }
    await entrar(req, res, id, 'Entrou no sistema');
  });

  /** Segunda etapa do login: o código do app (ou um código de recuperação). */
  r.post('/login/duas-etapas', limitarLogin, async (req, res) => {
    const { desafio, codigo } = corpo(req, loginDuasEtapas);
    const id = lerDesafio(auth.jwtSegredo, desafio);
    if (!id)
      throw new AppError(401, 'desafio_vencido', 'O tempo para digitar o código acabou. Entre de novo.');
    const como = await conferirSegundaEtapa(pool, auth.jwtSegredo, id, codigo);
    if (!como) {
      void registrarAcesso(req, await quem(id), 'acesso', 'Código das duas etapas errado');
      throw new AppError(
        401,
        'codigo_invalido',
        'Código não confere. Digite o código que está aparecendo agora no app.',
      );
    }
    await entrar(
      req,
      res,
      id,
      como === 'recuperacao' ? 'Entrou com um código de recuperação' : 'Entrou (verificação em duas etapas)',
    );
  });

  r.post('/logout', async (req, res) => {
    const sid = sessaoDoCookie(req, auth.jwtSegredo);
    if (sid)
      await pool
        .query('UPDATE cadastro.sessoes SET revogada_em = now() WHERE id = $1 AND revogada_em IS NULL', [sid])
        .catch(() => undefined);
    res.clearCookie(COOKIE_SESSAO, opcoesCookie(auth));
    res.status(204).end();
  });

  /** Convite: mostra de quem é o link (para a tela de criar senha). */
  r.get('/convite/:token', async (req, res) => {
    const { rows } = await pool.query<{ nome: string; email: string; conta: string }>(
      `SELECT u.nome, u.email, c.nome AS conta FROM cadastro.usuarios u JOIN cadastro.contas c ON c.id = u.conta_id
        WHERE u.convite_token = $1 AND u.convite_expira > now() AND u.ativo`,
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
    if (await temDuasEtapas(rows[0].id)) {
      void registrarAcesso(req, await quem(rows[0].id), 'acesso', 'Criou a senha pelo convite');
      res.json({ duasEtapas: true, desafio: desafioDuasEtapas(auth.jwtSegredo, rows[0].id) });
      return;
    }
    await entrar(req, res, rows[0].id, 'Criou a senha pelo convite');
  });

  /* ───────────── Senha esquecida ───────────── */

  const limitarEsqueci = rateLimit({
    windowMs: 15 * 60_000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(new AppError(429, 'muitas_tentativas', 'Muitos pedidos de senha. Espere 15 minutos.')),
  });

  /** O e-mail do sistema (avisos de senha) sai pelo Resend da conta principal. */
  async function emailDoSistema() {
    const { rows } = await pool.query<{ id: number; nome: string }>(
      'SELECT id, nome FROM cadastro.contas WHERE principal',
    );
    const principal = rows[0];
    if (!principal) return null;
    const { email } = await deps.servicos(principal.id);
    return email ? { email, plataforma: principal.nome } : null;
  }

  /**
   * Pede o link para criar uma senha nova. A resposta é sempre a mesma (não revela quem tem
   * cadastro); a senha atual continua valendo até a nova ser criada.
   */
  r.post('/esqueci', limitarEsqueci, async (req, res) => {
    const { email } = corpo(req, esqueciSenha);
    const sistema = await emailDoSistema();
    if (!sistema)
      throw new AppError(
        503,
        'email_sistema',
        'O envio de e-mails do sistema ainda não está configurado. Peça um link de acesso ao administrador.',
      );
    const { rows } = await pool.query<{
      id: number;
      nome: string;
      email: string;
      conta_id: number;
      conta: string;
    }>(
      `SELECT u.id, u.nome, u.email, u.conta_id, c.nome AS conta
         FROM cadastro.usuarios u JOIN cadastro.contas c ON c.id = u.conta_id
        WHERE lower(u.email) = $1 AND u.ativo AND (c.ativa OR u.master)`,
      [email],
    );
    const u = rows[0];
    if (u) {
      const token = randomBytes(32).toString('base64url');
      await pool.query(
        `UPDATE cadastro.usuarios
            SET redefinir_hash = $2, redefinir_expira = now() + make_interval(hours => ${HORAS_REDEFINIR})
          WHERE id = $1`,
        [u.id, hashDoToken(token)],
      );
      const link = `${enderecoDoApp(req.get('origin'), deps.origens)}/redefinir/${token}`;
      const primeiro = u.nome.trim().split(/\s+/)[0] ?? '';
      const e = montarEmail(
        {
          assunto: 'Criar uma senha nova no Prospect Team',
          corpo: `{saudacao}\n\nRecebemos um pedido para criar uma senha nova para ${u.email} no Prospect Team da ${u.conta}.\n\n[[Criar senha nova|${link}]]\n\nO link vale ${HORAS_REDEFINIR} hora e só funciona uma vez. Se não foi você, ignore este e-mail: sua senha atual continua a mesma.`,
        },
        { nome: primeiro, empresa: u.conta },
        {
          marca: {
            nome: 'Prospect Team',
            estilo: 'cartao',
            corPrimaria: '#0b6b63',
            corFundo: '#f4f4f5',
            corTexto: '#1f2933',
            corCabecalho: '#ffffff',
          },
        },
      );
      try {
        await sistema.email.enviar({
          de: { nome: `Prospect Team · ${sistema.plataforma}`, email: sistema.email.remetente },
          para: u.email,
          assunto: e.assunto,
          html: e.html,
          texto: e.texto,
          chave: `senha-${u.id}-${hashDoToken(token).slice(0, 12)}`,
        });
      } catch (erro) {
        deps.log.error({ err: erro, usuario: u.id }, 'senha: o e-mail de redefinição não saiu');
        throw new AppError(
          502,
          'email_falhou',
          'Não consegui mandar o e-mail agora. Tente de novo em alguns minutos.',
        );
      }
      void registrarAcesso(
        req,
        { id: u.id, nome: u.nome, contaId: u.conta_id },
        'acesso',
        'Pediu o link de senha nova por e-mail',
      );
    }
    res.json({ ok: true });
  });

  /** De quem é o link (para a tela de criar a senha nova). */
  r.get('/redefinir/:token', async (req, res) => {
    const { rows } = await pool.query<{ nome: string; email: string; conta: string }>(
      `SELECT u.nome, u.email, c.nome AS conta FROM cadastro.usuarios u JOIN cadastro.contas c ON c.id = u.conta_id
        WHERE u.redefinir_hash = $1 AND u.redefinir_expira > now() AND u.ativo`,
      [hashDoToken(String(req.params.token ?? ''))],
    );
    if (!rows[0]) throw AppError.naoEncontrado('Link de senha (expirou ou já foi usado)');
    res.json(rows[0]);
  });

  r.post('/redefinir/:token', limitarLogin, async (req, res) => {
    const { senha } = corpo(req, aceitarConvite);
    const hash = await bcrypt.hash(senha, 10);
    const { rows } = await pool.query<{ id: number }>(
      `UPDATE cadastro.usuarios
          SET senha_hash = $2, redefinir_hash = NULL, redefinir_expira = NULL,
              convite_token = NULL, convite_expira = NULL, ultimo_acesso = now()
        WHERE redefinir_hash = $1 AND redefinir_expira > now() AND ativo
        RETURNING id`,
      [hashDoToken(String(req.params.token ?? '')), hash],
    );
    if (!rows[0]) throw AppError.naoEncontrado('Link de senha (expirou ou já foi usado)');
    // Senha nova: as sessões abertas com a senha antiga caem.
    await pool.query(
      'UPDATE cadastro.sessoes SET revogada_em = now() WHERE usuario_id = $1 AND revogada_em IS NULL',
      [rows[0].id],
    );
    if (await temDuasEtapas(rows[0].id)) {
      void registrarAcesso(req, await quem(rows[0].id), 'acesso', 'Criou uma senha nova pelo link do e-mail');
      res.json({ duasEtapas: true, desafio: desafioDuasEtapas(auth.jwtSegredo, rows[0].id) });
      return;
    }
    await entrar(req, res, rows[0].id, 'Criou uma senha nova pelo link do e-mail');
  });

  const sessao = exigirSessao(auth.jwtSegredo, pool);
  r.use(
    rotasContaSegura(deps, sessao, (req, descricao) => {
      const u = req.usuario!;
      void registrarAcesso(req, { id: u.id, nome: u.nome, contaId: u.contaPropria }, 'acesso', descricao);
    }),
  );

  r.get('/eu', sessao, async (req, res) => {
    const u = req.usuario!;
    const { rows } = await pool.query<{
      telefone: string | null;
      agendaToken: string;
      totpAtivo: boolean;
      termosVersao: string | null;
    }>(
      `SELECT telefone, agenda_token AS "agendaToken", totp_ativo AS "totpAtivo", termos_versao AS "termosVersao"
         FROM cadastro.usuarios WHERE id = $1`,
      [u.id],
    );
    const { rows: c } = await pool.query<{
      plano: string | null;
      modulos: string[];
      organizacao_id: number;
      organizacao: string;
      unidades: number;
      exigir_2fa: boolean;
      marca_nome: string | null;
      marca_cor: string | null;
      tem_logo: boolean;
      marca_versao: string | null;
    }>(
      `SELECT o.plano, o.modulos, o.id AS organizacao_id, o.nome AS organizacao, o.exigir_2fa,
              o.marca_nome, o.marca_cor, (o.marca_logo IS NOT NULL) AS tem_logo,
              extract(epoch FROM o.marca_atualizada_em)::bigint::text AS marca_versao,
              (SELECT count(*)::int FROM cadastro.contas x WHERE x.organizacao_id = o.id AND x.ativa) AS unidades
         FROM cadastro.contas c JOIN cadastro.organizacoes o ON o.id = c.organizacao_id WHERE c.id = $1`,
      [u.contaId],
    );
    res.json({
      id: u.id,
      nome: u.nome,
      email: u.email,
      papel: u.papel,
      telefone: rows[0]?.telefone ?? null,
      agendaToken: rows[0]?.agendaToken ?? null,
      conta: {
        id: u.contaId,
        nome: u.contaNome,
        plano: c[0]?.plano ?? null,
        // Módulos que valem na conta (sem plano: todos).
        modulos: c[0]?.plano ? c[0].modulos : ['whatsapp', 'agente_ia', 'email'],
      },
      organizacao: c[0] ? { id: c[0].organizacao_id, nome: c[0].organizacao, unidades: c[0].unidades } : null,
      master: u.master,
      papelOrganizacao: u.papelOrganizacao,
      duasEtapas: { ativo: !!rows[0]?.totpAtivo, exigido: !!c[0]?.exigir_2fa },
      termos: { versao: TERMOS_VERSAO, aceitos: rows[0]?.termosVersao === TERMOS_VERSAO },
      // Marca do cliente (white label): nome, cor e logo no sistema e nos relatórios.
      marca:
        c[0] && (c[0].marca_nome || c[0].marca_cor || c[0].tem_logo)
          ? {
              nome: c[0].marca_nome,
              cor: c[0].marca_cor,
              logo: c[0].tem_logo ? `/organizacao/marca/logo?v=${c[0].marca_versao ?? '0'}` : null,
            }
          : null,
      // O master dentro de outra conta (a tela mostra a faixa "você está na conta X").
      foraDaPropria: u.contaId !== u.contaPropria,
    });
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
    // Senha nova: os outros aparelhos saem (este continua).
    await pool.query(
      `UPDATE cadastro.sessoes SET revogada_em = now()
        WHERE usuario_id = $1 AND revogada_em IS NULL AND id IS DISTINCT FROM $2`,
      [req.usuario!.id, req.usuario!.sessaoId],
    );
    void registrarAcesso(req, await quem(req.usuario!.id), 'acesso', 'Trocou a própria senha');
    res.json({ ok: true });
  });

  return r;
}
