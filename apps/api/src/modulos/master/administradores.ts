import { randomBytes } from 'node:crypto';
import { AppError, administradorAtualizar, administradorNovo } from '@prospeccao/shared';
import { type Request, Router } from 'express';
import type { DepsApi } from '../../dependencias.js';
import { enderecoDoApp } from '../../endereco.js';
import { corpo, idDaRota } from '../../middlewares/http.js';
import * as auditoria from '../auditoria/repositorio.js';
import { DIAS_CONVITE } from '../equipe/repositorio.js';

/**
 * Administradores da plataforma (master): quem vê o painel, os clientes, o financeiro e as
 * configurações. Ficam na conta principal. O do ADMIN_EMAIL é o acesso de emergência: não sai daqui
 * (volta sozinho a cada login). Sempre sobra pelo menos um master ativo, e ninguém mexe no próprio.
 */

export interface Administrador {
  id: number;
  nome: string;
  email: string;
  ativo: boolean;
  convitePendente: boolean;
  ultimoAcesso: string | null;
  duasEtapas: boolean;
  criadoEm: string;
  /** O do ADMIN_EMAIL (acesso de emergência, configurado no servidor). */
  doAmbiente: boolean;
  /** Quem está vendo a lista. */
  voce: boolean;
}

export function rotasAdministradores(deps: DepsApi): Router {
  const { pool, log, origens } = deps;
  const r = Router();
  const ambiente = deps.auth.adminEmail.toLowerCase();
  const link = (req: Request, token: string) =>
    `${enderecoDoApp(req.get('origin'), origens)}/convite/${token}`;

  async function listar(req: Request): Promise<Administrador[]> {
    const { rows } = await pool.query<Omit<Administrador, 'doAmbiente' | 'voce'>>(
      `SELECT id, nome, email, ativo, (senha_hash IS NULL) AS "convitePendente", ultimo_acesso AS "ultimoAcesso",
              totp_ativo AS "duasEtapas", criado_em AS "criadoEm"
         FROM cadastro.usuarios WHERE master
        ORDER BY ativo DESC, criado_em`,
    );
    return rows.map((a) => {
      const doAmbiente = a.email.toLowerCase() === ambiente;
      // O do ADMIN_EMAIL entra com a senha do servidor: não tem convite a aceitar.
      return {
        ...a,
        convitePendente: a.convitePendente && !doAmbiente,
        doAmbiente,
        voce: a.id === req.usuario!.id,
      };
    });
  }

  async function registrar(req: Request, descricao: string) {
    await auditoria.registrar(pool, {
      contaId: null,
      usuarioId: req.usuario!.id,
      usuarioNome: req.usuario!.nome,
      comoMaster: true,
      acao: 'administradores',
      descricao,
      metodo: req.method,
      caminho: req.baseUrl + req.path,
    });
  }

  /** O administrador que vai ser mexido: existe, é master, não é você nem o do ADMIN_EMAIL. */
  async function alvo(req: Request) {
    const id = idDaRota(req);
    const { rows } = await pool.query<{
      id: number;
      nome: string;
      email: string;
      ativo: boolean;
      master: boolean;
    }>('SELECT id, nome, email, ativo, master FROM cadastro.usuarios WHERE id = $1', [id]);
    const a = rows[0];
    if (!a?.master) throw AppError.naoEncontrado('Administrador');
    if (a.id === req.usuario!.id)
      throw AppError.invalido(
        'Você não muda o seu próprio acesso por aqui (use Minha conta para a sua senha).',
      );
    if (a.email.toLowerCase() === ambiente)
      throw AppError.invalido(
        'Este é o acesso de emergência (ADMIN_EMAIL, configurado no servidor): não se desativa por aqui.',
      );
    return a;
  }

  r.get('/', async (req, res) => {
    res.json(await listar(req));
  });

  /** Novo administrador: entra pelo link de convite (cria a senha). */
  r.post('/', async (req, res) => {
    const d = corpo(req, administradorNovo);
    const { rows: existe } = await pool.query<{ id: number; master: boolean; principal: boolean }>(
      `SELECT u.id, u.master, c.principal FROM cadastro.usuarios u JOIN cadastro.contas c ON c.id = u.conta_id
        WHERE lower(u.email) = $1`,
      [d.email],
    );
    if (existe[0]?.master) throw AppError.conflito('Essa pessoa já é administradora da plataforma.');
    if (existe[0] && !existe[0].principal)
      throw AppError.conflito(
        'Esse e-mail já é de alguém de um cliente. Use outro e-mail para o administrador da plataforma.',
      );
    const token = randomBytes(24).toString('base64url');
    let id: number;
    if (existe[0]) {
      // Já é da sua equipe (conta principal): ganha o acesso master e um link novo.
      await pool.query(
        `UPDATE cadastro.usuarios
            SET master = true, papel = 'admin', ativo = true, nome = $2,
                convite_token = CASE WHEN senha_hash IS NULL THEN $3 ELSE convite_token END,
                convite_expira = CASE WHEN senha_hash IS NULL THEN now() + make_interval(days => ${DIAS_CONVITE}) ELSE convite_expira END
          WHERE id = $1`,
        [existe[0].id, d.nome, token],
      );
      id = existe[0].id;
    } else {
      const { rows } = await pool.query<{ id: number }>(
        `INSERT INTO cadastro.usuarios (nome, email, papel, ativo, master, conta_id, convite_token, convite_expira)
         VALUES ($1, $2, 'admin', true, true, (SELECT id FROM cadastro.contas WHERE principal ORDER BY id LIMIT 1),
                 $3, now() + make_interval(days => ${DIAS_CONVITE}))
         RETURNING id`,
        [d.nome, d.email, token],
      );
      id = rows[0]!.id;
      await pool.query('INSERT INTO comercial.metas (usuario_id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
    }
    const { rows: s } = await pool.query<{ pendente: boolean }>(
      'SELECT senha_hash IS NULL AS pendente FROM cadastro.usuarios WHERE id = $1',
      [id],
    );
    await registrar(req, `Novo administrador da plataforma: ${d.nome} (${d.email}).`);
    log.info({ master: req.usuario!.id, novo: id }, 'master: administrador criado');
    res.status(201).json({
      id,
      // Quem já tinha senha (era da sua equipe) entra com ela mesma.
      convite: s[0]?.pendente ? link(req, token) : null,
      diasValidade: DIAS_CONVITE,
      administradores: await listar(req),
    });
  });

  /** Desativar/reativar ou tirar o acesso master (a pessoa continua na sua equipe, sem o painel). */
  r.patch('/:id', async (req, res) => {
    const a = await alvo(req);
    const d = corpo(req, administradorAtualizar);
    const tirando = d.ativo === false || d.master === false;
    if (tirando) {
      const { rows } = await pool.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM cadastro.usuarios WHERE master AND ativo AND id <> $1',
        [a.id],
      );
      if (!rows[0]?.n) throw AppError.invalido('A plataforma precisa de pelo menos um administrador ativo.');
    }
    await pool.query(
      `UPDATE cadastro.usuarios SET ativo = coalesce($2, ativo), master = coalesce($3, master) WHERE id = $1`,
      [a.id, d.ativo ?? null, d.master ?? null],
    );
    // Perdeu o acesso: sai de todos os aparelhos na hora.
    if (tirando)
      await pool.query(
        'UPDATE cadastro.sessoes SET revogada_em = now() WHERE usuario_id = $1 AND revogada_em IS NULL',
        [a.id],
      );
    await registrar(
      req,
      d.master === false
        ? `Tirou o acesso de administrador da plataforma de ${a.nome} (${a.email}).`
        : d.ativo === false
          ? `Desativou o administrador ${a.nome} (${a.email}).`
          : `Reativou o administrador ${a.nome} (${a.email}).`,
    );
    res.json(await listar(req));
  });

  /** Link novo para criar a senha (convite vencido ou senha esquecida). A senha antiga deixa de valer. */
  r.post('/:id/convite', async (req, res) => {
    const a = await alvo(req);
    const token = randomBytes(24).toString('base64url');
    await pool.query(
      `UPDATE cadastro.usuarios
          SET convite_token = $2, convite_expira = now() + make_interval(days => ${DIAS_CONVITE}), senha_hash = NULL
        WHERE id = $1`,
      [a.id, token],
    );
    await pool.query(
      'UPDATE cadastro.sessoes SET revogada_em = now() WHERE usuario_id = $1 AND revogada_em IS NULL',
      [a.id],
    );
    await registrar(req, `Gerou um link de nova senha para o administrador ${a.nome}.`);
    res.json({ convite: link(req, token), diasValidade: DIAS_CONVITE });
  });

  return r;
}
