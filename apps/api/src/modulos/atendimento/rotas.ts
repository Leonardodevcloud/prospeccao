import { AppError } from '@prospeccao/shared';
import { CRITERIO_ATENDIMENTO, corrigirNotaEntrada, inicioDaSemana } from '@prospeccao/shared/atendimento';
import { type Request, Router } from 'express';
import { z } from 'zod';
import type { DepsApi } from '../../dependencias.js';
import { consulta, corpo, idDaRota } from '../../middlewares/http.js';
import { exigirAdmin } from '../../middlewares/seguranca.js';
import { rotaComRecurso } from '../../recursos.js';
import { notificar } from '../notificacoes/repositorio.js';
import * as repo from './repositorio.js';

/**
 * Qualidade do atendimento (recurso do plano). O gestor (administrador) vê a equipe e corrige notas;
 * cada pessoa vê as próprias notas e o próprio resumo da semana.
 */

const semanaConsulta = z.object({
  semana: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  grupo: z.coerce.number().int().positive().optional(),
});

/** A semana pedida (sempre a segunda-feira dela) ou a atual. */
const semanaDe = (s?: string) => inicioDaSemana(s ? new Date(`${s}T12:00:00-03:00`) : new Date());

export function rotasAtendimento(deps: DepsApi): Router {
  const { pool } = deps;
  const r = Router();
  r.use(rotaComRecurso(pool, 'atendimento'));
  const ehGestor = (req: Request) => req.usuario?.papel === 'admin';

  /** O painel da equipe na semana (filtro por grupo/loja). */
  r.get('/painel', exigirAdmin, async (req, res) => {
    const q = consulta(req, semanaConsulta);
    res.json(await repo.painel(pool, semanaDe(q.semana), q.grupo ?? null));
  });

  /** O resumo de uma pessoa: o gestor vê de todos; cada um vê o próprio. */
  r.get('/vendedor/:id', async (req, res) => {
    const id = idDaRota(req);
    if (!ehGestor(req) && id !== req.usuario!.id) throw AppError.proibido();
    const q = consulta(req, semanaConsulta);
    res.json(await repo.resumo(pool, id, semanaDe(q.semana)));
  });

  r.get('/eu', async (req, res) => {
    const q = consulta(req, semanaConsulta);
    res.json(await repo.resumo(pool, req.usuario!.id, semanaDe(q.semana)));
  });

  /** As notas de um lead (o painel da conversa). */
  r.get('/lead/:id', async (req, res) => {
    res.json({ notas: await repo.notasDoLead(pool, idDaRota(req), ehGestor(req) ? null : req.usuario!.id) });
  });

  /** O gestor corrige a nota (fica registrado quem, quando e por quê; a da IA continua guardada). */
  r.post('/notas/:id/corrigir', exigirAdmin, async (req, res) => {
    const d = corpo(req, corrigirNotaEntrada);
    res.json(await repo.corrigir(pool, idDaRota(req), d, req.usuario!.id));
  });

  /** Manda o resumo da semana para a pessoa (aviso no sino com o link). */
  r.post('/vendedor/:id/enviar', exigirAdmin, async (req, res) => {
    const id = idDaRota(req);
    const q = consulta(req, semanaConsulta);
    const s = semanaDe(q.semana);
    const { resumo } = await repo.resumo(pool, id, s);
    if (!resumo.atendimentos)
      throw AppError.invalido('Essa pessoa não tem atendimentos avaliados nesta semana.');
    const treinar = resumo.treinar
      ? ` · treinar: ${CRITERIO_ATENDIMENTO[resumo.treinar.criterio].treinar}`
      : '';
    await notificar(pool, id, {
      tipo: 'sistema',
      titulo: 'Seu resumo de atendimento da semana',
      texto: `Nota ${String(resumo.nota ?? '-').replace('.', ',')}${treinar}`.slice(0, 300),
      link: `/qualidade?semana=${s}`,
    });
    res.json({ ok: true });
  });

  return r;
}
