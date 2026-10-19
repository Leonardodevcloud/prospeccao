import { AppError, baseEntrada } from '@prospeccao/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { DepsApi } from '../../dependencias.js';
import { corpo, idDaRota } from '../../middlewares/http.js';

const CAMPOS = `id, nome, endereco, lat, lng, ativa, criado_em AS "criadoEm"`;

export function rotasBases({ pool, geocodificar }: DepsApi): Router {
  const r = Router();

  async function resolverCoordenadas(b: { endereco?: string; lat?: number; lng?: number }) {
    if (b.lat != null && b.lng != null) return { lat: b.lat, lng: b.lng };
    if (!geocodificar) {
      throw AppError.invalido(
        'Informe latitude e longitude: a busca por endereço precisa da ORS_API_KEY na API.',
      );
    }
    const geo = await geocodificar(b.endereco!);
    if (!geo) throw AppError.invalido('Não encontrei esse endereço. Confira ou informe as coordenadas.');
    return geo;
  }

  r.get('/', async (_req, res) => {
    const { rows } = await pool.query(`SELECT ${CAMPOS} FROM cadastro.bases ORDER BY ativa DESC, nome`);
    res.json(rows);
  });

  r.post('/', async (req, res) => {
    const b = corpo(req, baseEntrada);
    const { lat, lng } = await resolverCoordenadas(b);
    const { rows } = await pool.query(
      `INSERT INTO cadastro.bases (nome, endereco, lat, lng, ativa) VALUES ($1, $2, $3, $4, $5) RETURNING ${CAMPOS}`,
      [b.nome, b.endereco ?? null, lat, lng, b.ativa],
    );
    res.status(201).json(rows[0]);
  });

  r.patch('/:id', async (req, res) => {
    const id = idDaRota(req);
    const b = corpo(
      req,
      z.object({
        nome: z.string().trim().min(2).max(80).optional(),
        ativa: z.boolean().optional(),
      }),
    );
    const { rows } = await pool.query(
      `UPDATE cadastro.bases SET nome = coalesce($2, nome), ativa = coalesce($3, ativa) WHERE id = $1 RETURNING ${CAMPOS}`,
      [id, b.nome ?? null, b.ativa ?? null],
    );
    if (!rows[0]) throw AppError.naoEncontrado('Base');
    res.json(rows[0]);
  });

  r.delete('/:id', async (req, res) => {
    const { rowCount } = await pool.query('UPDATE cadastro.bases SET ativa = false WHERE id = $1', [
      idDaRota(req),
    ]);
    if (!rowCount) throw AppError.naoEncontrado('Base');
    res.status(204).end();
  });

  return r;
}
