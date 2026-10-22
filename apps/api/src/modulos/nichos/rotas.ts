import { AppError, NICHOS_PRONTOS, nichoAtualizacao, nichoEntrada } from '@prospeccao/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { DepsApi } from '../../dependencias.js';
import { corpo, idDaRota } from '../../middlewares/http.js';
import * as repo from './repositorio.js';

function conflitoDeNome(erro: unknown): never {
  if ((erro as { code?: string }).code === '23505')
    throw AppError.conflito('Já existe um nicho ativo com esse nome.');
  throw erro;
}

export function rotasNichos({ pool }: DepsApi): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    res.json(await repo.listar(pool, req.query.todos === 'true'));
  });

  /** Nichos prontos para escolher (e quais a conta já tem, pelo nome). */
  r.get('/prontos', async (_req, res) => {
    const ja = new Set((await repo.listar(pool, false)).map((n) => n.nome.trim().toLowerCase()));
    res.json(NICHOS_PRONTOS.map((n) => ({ ...n, jaTem: ja.has(n.nome.toLowerCase()) })));
  });

  /** Cria os nichos prontos escolhidos (os que a conta já tem com o mesmo nome ficam como estão). */
  r.post('/prontos', async (req, res) => {
    const { ids } = corpo(req, z.object({ ids: z.array(z.string().max(60)).min(1).max(40) }));
    const ja = new Set((await repo.listar(pool, false)).map((n) => n.nome.trim().toLowerCase()));
    let criados = 0;
    for (const p of NICHOS_PRONTOS.filter((n) => ids.includes(n.id))) {
      if (ja.has(p.nome.toLowerCase())) continue;
      const dados = nichoEntrada.parse({
        nome: p.nome,
        cnaes: p.cnaes,
        termosMaps: p.termosMaps,
        palavrasPositivas: p.palavrasPositivas,
        palavrasNegativas: p.palavrasNegativas,
      });
      await repo.criar(pool, dados).catch(conflitoDeNome);
      criados++;
    }
    res.status(201).json({ criados });
  });

  r.post('/', async (req, res) => {
    const dados = corpo(req, nichoEntrada);
    const id = await repo.criar(pool, dados).catch(conflitoDeNome);
    res.status(201).json(await repo.obter(pool, id));
  });

  r.get('/:id', async (req, res) => {
    const nicho = await repo.obter(pool, idDaRota(req));
    if (!nicho) throw AppError.naoEncontrado('Nicho');
    res.json(nicho);
  });

  r.patch('/:id', async (req, res) => {
    const id = idDaRota(req);
    const dados = corpo(req, nichoAtualizacao);
    if (!(await repo.atualizar(pool, id, dados).catch(conflitoDeNome))) throw AppError.naoEncontrado('Nicho');
    res.json(await repo.obter(pool, id));
  });

  /** Desativa (não apaga): campanhas antigas continuam apontando para ele. */
  r.delete('/:id', async (req, res) => {
    const id = idDaRota(req);
    const nicho = await repo.obter(pool, id);
    if (!nicho) throw AppError.naoEncontrado('Nicho');
    if (nicho.campanhasEmAndamento > 0) {
      throw AppError.conflito('Este nicho tem campanhas ativas ou pausadas. Encerre-as antes de desativar.');
    }
    await repo.atualizar(pool, id, { ativo: false });
    res.status(204).end();
  });

  return r;
}
