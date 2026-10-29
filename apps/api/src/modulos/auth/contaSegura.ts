import type { Pool } from '@prospeccao/db';
import {
  AppError,
  codigoDuasEtapas,
  desativarDuasEtapas,
  TERMOS_VERSAO,
  termosEntrada,
} from '@prospeccao/shared';
import bcrypt from 'bcryptjs';
import type { Request, RequestHandler } from 'express';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import type { DepsApi } from '../../dependencias.js';
import { corpo } from '../../middlewares/http.js';
import {
  cifrarSegredo,
  conferir,
  decifrarSegredo,
  enderecoOtp,
  hashRecuperacao,
  novoSegredo,
  novosCodigosRecuperacao,
} from '../../totp.js';

/**
 * A conta da pessoa: verificação em duas etapas (app autenticador), sessões abertas e aceite dos
 * termos de uso e da política de privacidade.
 */

/** Desafio do login em duas etapas: a senha já conferiu; vale 5 minutos. */
export function desafioDuasEtapas(segredo: string, usuarioId: number): string {
  return jwt.sign({ d: 1 }, segredo, { algorithm: 'HS256', subject: String(usuarioId), expiresIn: '5m' });
}

export function lerDesafio(segredo: string, desafio: string): number | null {
  try {
    const d = jwt.verify(desafio, segredo, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    const id = Number(d.sub);
    return d.d === 1 && Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

/**
 * Confere o código do app (6 números) ou um código de recuperação (xxxx-xxxx, gasta na hora).
 * Devolve como entrou, ou null.
 */
export async function conferirSegundaEtapa(
  pool: Pool,
  segredoApi: string,
  usuarioId: number,
  digitado: string,
): Promise<'app' | 'recuperacao' | null> {
  const { rows } = await pool.query<{ totp_segredo: string | null; totp_ativo: boolean }>(
    'SELECT totp_segredo, totp_ativo FROM cadastro.usuarios WHERE id = $1',
    [usuarioId],
  );
  const u = rows[0];
  if (!u?.totp_ativo || !u.totp_segredo) return null;
  if (/^\d{6}$/.test(digitado.replace(/\s/g, '')))
    return conferir(decifrarSegredo(segredoApi, u.totp_segredo), digitado) ? 'app' : null;
  const { rowCount } = await pool.query(
    `UPDATE cadastro.usuarios SET totp_recuperacao = array_remove(totp_recuperacao, $2)
      WHERE id = $1 AND $2 = ANY(totp_recuperacao)`,
    [usuarioId, hashRecuperacao(digitado)],
  );
  return rowCount ? 'recuperacao' : null;
}

export function rotasContaSegura(
  deps: Pick<DepsApi, 'pool' | 'auth'>,
  sessao: RequestHandler,
  registrar: (req: Request, descricao: string) => void,
): Router {
  const { pool, auth } = deps;
  const r = Router();

  /** Situação das duas etapas da pessoa (e se a organização exige). */
  r.get('/duas-etapas', sessao, async (req, res) => {
    const { rows } = await pool.query<{
      ativo: boolean;
      desde: string | null;
      codigos: number;
      exigido: boolean;
    }>(
      `SELECT u.totp_ativo AS ativo, u.totp_desde AS desde, cardinality(u.totp_recuperacao) AS codigos,
              o.exigir_2fa AS exigido
         FROM cadastro.usuarios u JOIN cadastro.contas c ON c.id = u.conta_id
         JOIN cadastro.organizacoes o ON o.id = c.organizacao_id
        WHERE u.id = $1`,
      [req.usuario!.id],
    );
    res.json(rows[0]);
  });

  /** Começa a configurar: segredo novo (ainda não vale) e o QR para o app. */
  r.post('/duas-etapas/iniciar', sessao, async (req, res) => {
    const u = req.usuario!;
    const { rows } = await pool.query<{ ativo: boolean }>(
      'SELECT totp_ativo AS ativo FROM cadastro.usuarios WHERE id = $1',
      [u.id],
    );
    if (rows[0]?.ativo) throw AppError.invalido('A verificação em duas etapas já está ligada.');
    const segredo = novoSegredo();
    await pool.query('UPDATE cadastro.usuarios SET totp_segredo = $2 WHERE id = $1', [
      u.id,
      cifrarSegredo(auth.jwtSegredo, segredo),
    ]);
    const endereco = enderecoOtp(segredo, u.email);
    const qr = await QRCode.toString(endereco, { type: 'svg', margin: 1, width: 200 });
    res.json({ segredo, endereco, qr });
  });

  /** Confirma com o primeiro código do app: liga e entrega os códigos de recuperação (só agora). */
  r.post('/duas-etapas/ativar', sessao, async (req, res) => {
    const { codigo } = corpo(req, codigoDuasEtapas);
    const u = req.usuario!;
    const { rows } = await pool.query<{ totp_segredo: string | null; totp_ativo: boolean }>(
      'SELECT totp_segredo, totp_ativo FROM cadastro.usuarios WHERE id = $1',
      [u.id],
    );
    if (rows[0]?.totp_ativo) throw AppError.invalido('A verificação em duas etapas já está ligada.');
    if (!rows[0]?.totp_segredo) throw AppError.invalido('Comece de novo: gere o QR code.');
    if (!conferir(decifrarSegredo(auth.jwtSegredo, rows[0].totp_segredo), codigo))
      throw AppError.invalido(
        'Código não confere. Confira a hora do celular e digite o código que está aparecendo agora.',
      );
    const codigos = novosCodigosRecuperacao();
    await pool.query(
      `UPDATE cadastro.usuarios SET totp_ativo = true, totp_desde = now(), totp_recuperacao = $2 WHERE id = $1`,
      [u.id, codigos.map(hashRecuperacao)],
    );
    registrar(req, 'Ligou a verificação em duas etapas');
    res.json({ codigos });
  });

  r.post('/duas-etapas/desativar', sessao, async (req, res) => {
    const { senha } = corpo(req, desativarDuasEtapas);
    const u = req.usuario!;
    const { rows } = await pool.query<{ senha_hash: string | null; exigido: boolean }>(
      `SELECT u.senha_hash, o.exigir_2fa AS exigido FROM cadastro.usuarios u
         JOIN cadastro.contas c ON c.id = u.conta_id JOIN cadastro.organizacoes o ON o.id = c.organizacao_id
        WHERE u.id = $1`,
      [u.id],
    );
    if (rows[0]?.exigido) throw AppError.invalido('Sua organização exige a verificação em duas etapas.');
    if (!rows[0]?.senha_hash || !(await bcrypt.compare(senha, rows[0].senha_hash)))
      throw AppError.invalido('A senha não confere.');
    await pool.query(
      `UPDATE cadastro.usuarios SET totp_ativo = false, totp_segredo = NULL, totp_desde = NULL, totp_recuperacao = '{}'
        WHERE id = $1`,
      [u.id],
    );
    registrar(req, 'Desligou a verificação em duas etapas');
    res.json({ ok: true });
  });

  /** Códigos de recuperação novos (os antigos deixam de valer). Pede um código do app. */
  r.post('/duas-etapas/codigos', sessao, async (req, res) => {
    const { codigo } = corpo(req, codigoDuasEtapas);
    const u = req.usuario!;
    if ((await conferirSegundaEtapa(pool, auth.jwtSegredo, u.id, codigo)) !== 'app')
      throw AppError.invalido('Código do app não confere.');
    const codigos = novosCodigosRecuperacao();
    await pool.query('UPDATE cadastro.usuarios SET totp_recuperacao = $2 WHERE id = $1', [
      u.id,
      codigos.map(hashRecuperacao),
    ]);
    registrar(req, 'Gerou novos códigos de recuperação');
    res.json({ codigos });
  });

  /* ───────────── Sessões ───────────── */

  r.get('/sessoes', sessao, async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, criado_em AS "criadoEm", ultimo_uso AS "ultimoUso", ip, aparelho, (id = $2) AS atual
         FROM cadastro.sessoes
        WHERE usuario_id = $1 AND revogada_em IS NULL AND expira_em > now()
        ORDER BY (id = $2) DESC, ultimo_uso DESC LIMIT 50`,
      [req.usuario!.id, req.usuario!.sessaoId],
    );
    res.json(rows);
  });

  r.delete('/sessoes/:id', sessao, async (req, res) => {
    const id = String(req.params.id ?? '');
    if (!/^[0-9a-f-]{36}$/.test(id)) throw AppError.naoEncontrado('Sessão');
    const { rowCount } = await pool.query(
      `UPDATE cadastro.sessoes SET revogada_em = now() WHERE id = $1 AND usuario_id = $2 AND revogada_em IS NULL`,
      [id, req.usuario!.id],
    );
    if (!rowCount) throw AppError.naoEncontrado('Sessão');
    registrar(req, 'Encerrou uma sessão aberta');
    res.status(204).end();
  });

  /** Sai de todos os outros aparelhos (fica só neste). */
  r.post('/sessoes/encerrar-outras', sessao, async (req, res) => {
    const { rowCount } = await pool.query(
      `UPDATE cadastro.sessoes SET revogada_em = now()
        WHERE usuario_id = $1 AND revogada_em IS NULL AND id IS DISTINCT FROM $2`,
      [req.usuario!.id, req.usuario!.sessaoId],
    );
    registrar(req, 'Encerrou as sessões dos outros aparelhos');
    res.json({ encerradas: rowCount ?? 0 });
  });

  /* ───────────── Termos ───────────── */

  r.post('/termos', sessao, async (req, res) => {
    corpo(req, termosEntrada);
    await pool.query(
      'UPDATE cadastro.usuarios SET termos_versao = $2, termos_aceitos_em = now() WHERE id = $1',
      [req.usuario!.id, TERMOS_VERSAO],
    );
    registrar(req, `Aceitou os termos de uso e a política de privacidade (versão ${TERMOS_VERSAO})`);
    res.json({ ok: true });
  });

  return r;
}
