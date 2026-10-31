import type { Executor } from '@prospeccao/db';
import { AppError } from '@prospeccao/shared';
import { fotoFundoEntrada } from '@prospeccao/shared/fundos';
import { Router } from 'express';
import type { DepsApi } from '../../dependencias.js';
import { corpo } from '../../middlewares/http.js';
import { imagemDaMarca } from '../organizacao/repositorio.js';

/**
 * Fundos da câmera de cada pessoa do time (até 5): ficam na conta dela e aparecem em qualquer
 * computador em que ela entrar. Só a própria pessoa vê, envia e tira.
 */

export const LIMITE_PESSOAIS = 5;

export interface FundoPessoal {
  id: number;
  nome: string;
}

export async function listar(db: Executor, usuarioId: number): Promise<FundoPessoal[]> {
  const { rows } = await db.query<FundoPessoal>(
    'SELECT id::int AS id, nome FROM cadastro.fundos_pessoais WHERE usuario_id = $1 ORDER BY id',
    [usuarioId],
  );
  return rows;
}

export function rotasFundosPessoais({ pool }: DepsApi): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    res.json({ fundos: await listar(pool, req.usuario!.id), limite: LIMITE_PESSOAIS });
  });

  r.post('/', async (req, res) => {
    const d = corpo(req, fotoFundoEntrada);
    const ja = await listar(pool, req.usuario!.id);
    if (ja.length >= LIMITE_PESSOAIS)
      throw AppError.invalido(`Dá para ter até ${LIMITE_PESSOAIS} fundos seus. Tire um para enviar outro.`);
    const { buf, tipo } = imagemDaMarca(d.imagem, 1536, 'Imagem');
    await pool.query(
      'INSERT INTO cadastro.fundos_pessoais (usuario_id, nome, imagem, tipo) VALUES ($1, $2, $3, $4)',
      [req.usuario!.id, d.nome, buf, tipo],
    );
    res.status(201).json({ fundos: await listar(pool, req.usuario!.id), limite: LIMITE_PESSOAIS });
  });

  r.delete('/:id', async (req, res) => {
    const { rowCount } = await pool.query(
      'DELETE FROM cadastro.fundos_pessoais WHERE id = $1 AND usuario_id = $2',
      [Number(req.params.id) || 0, req.usuario!.id],
    );
    if (!rowCount) throw AppError.naoEncontrado('Fundo');
    res.json({ fundos: await listar(pool, req.usuario!.id), limite: LIMITE_PESSOAIS });
  });

  r.get('/:id', async (req, res) => {
    const { rows } = await pool.query<{ imagem: Buffer; tipo: string }>(
      'SELECT imagem, tipo FROM cadastro.fundos_pessoais WHERE id = $1 AND usuario_id = $2',
      [Number(req.params.id) || 0, req.usuario!.id],
    );
    if (!rows[0]) throw AppError.naoEncontrado('Fundo');
    res.setHeader('Content-Type', rows[0].tipo);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(rows[0].imagem);
  });

  return r;
}
