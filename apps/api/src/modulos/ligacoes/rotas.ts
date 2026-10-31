import type { Executor } from '@prospeccao/db';
import type { AvisoVideo } from '@prospeccao/integrations/reuniao';
import { IDENTIDADE_LEAD } from '@prospeccao/integrations/telefonia';
import {
  AppError,
  estadoLigacaoEntrada,
  iniciarLigacaoEntrada,
  numeroEmpresaEntrada,
  RESULTADOS_LIGACAO,
  resultadoLigacaoEntrada,
  telefoniaConfigEntrada,
} from '@prospeccao/shared';
import express, { type NextFunction, type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { exigirVisivel, travaDaBase } from '../../base.js';
import { comConta, donoDaBase } from '../../contexto.js';
import type { DepsApi } from '../../dependencias.js';
import { consulta, corpo, idDaRota } from '../../middlewares/http.js';
import { exigirAdmin } from '../../middlewares/seguranca.js';
import * as servico from './servico.js';

/**
 * Ligações: preparar e discar, o que o navegador viu (tocou, atendeu, desligou), os arquivos da
 * gravação, o "Como foi?", o histórico e a configuração (Gestão › Telefonia). Os números da empresa
 * são cadastrados pela plataforma (painel master).
 */

const telefoniaDe = (deps: DepsApi): servico.DepsTelefonia => deps.telefonia ?? servico.SEM_TELEFONIA;

const filtroLista = z.object({
  usuario: z
    .string()
    .regex(/^(eu|todos|\d+)$/)
    .default('eu'),
  resultado: z.enum([...RESULTADOS_LIGACAO, 'sem_resultado']).optional(),
  dias: z.coerce.number().int().min(1).max(366).default(30),
  lead: z.coerce.number().int().positive().optional(),
});

/** Escrita só com o módulo no plano (ver o histórico vale sempre). */
function comModulo(db: Executor) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.method === 'GET') return next();
    servico.exigirModulo(db).then(() => next(), next);
  };
}

/** Aviso de gravação falado (o navegador toca na ligação). Lembrado por texto. */
const avisosFalados = new Map<string, Uint8Array>();

export function rotasLigacoes(deps: DepsApi): Router {
  const r = Router();
  const { pool } = deps;
  const tel = () => telefoniaDe(deps);
  r.param('empresaId', travaDaBase(pool));
  r.use(comModulo(pool));

  r.get('/situacao', async (_req, res) => {
    res.json(await servico.situacao(pool, tel()));
  });

  r.get('/config', async (_req, res) => {
    res.json(await servico.situacao(pool, tel()));
  });

  r.put('/config', exigirAdmin, async (req, res) => {
    await servico.salvarConfig(pool, corpo(req, telefoniaConfigEntrada));
    res.json(await servico.situacao(pool, tel()));
  });

  /** O aviso de gravação em voz (mp3), para tocar no começo da ligação. */
  r.get('/aviso', async (_req, res) => {
    const fala = tel().fala;
    if (!fala) throw AppError.naoEncontrado('Aviso falado');
    const { avisoGravacao } = await servico.config(pool);
    let audio = avisosFalados.get(avisoGravacao);
    if (!audio) {
      audio = await fala.falar(avisoGravacao, { voz: 'marin', velocidade: 1.05 });
      if (avisosFalados.size > 200) avisosFalados.clear();
      avisosFalados.set(avisoGravacao, audio);
    }
    res
      .set('Content-Type', 'audio/mpeg')
      .set('Cache-Control', 'private, max-age=3600')
      .send(Buffer.from(audio));
  });

  r.get('/lead/:empresaId', async (req, res) => {
    res.json(await servico.doLead(pool, idDaRota(req, 'empresaId')));
  });

  r.get('/', async (req, res) => {
    const f = consulta(req, filtroLista);
    const dono = donoDaBase();
    const usuarioId =
      dono ?? (f.usuario === 'todos' ? null : f.usuario === 'eu' ? req.usuario!.id : Number(f.usuario));
    if (f.lead) await exigirVisivel(pool, f.lead);
    res.json(
      await servico.lista(pool, {
        usuarioId: f.lead ? null : usuarioId,
        resultado: f.resultado,
        dias: f.lead ? 366 : f.dias,
        limite: 200,
        empresaId: f.lead ?? null,
      }),
    );
  });

  r.get('/:id', async (req, res) => {
    res.json(await servico.detalhe(pool, tel(), idDaRota(req)));
  });

  r.post('/', async (req, res) => {
    const d = corpo(req, iniciarLigacaoEntrada);
    if (d.empresaId) await exigirVisivel(pool, d.empresaId);
    res.status(201).json(await servico.iniciar(pool, tel(), d));
  });

  r.post('/:id/discar', async (req, res) => {
    await servico.discar(pool, tel(), idDaRota(req));
    res.json({ ok: true });
  });

  r.post('/:id/estado', async (req, res) => {
    const d = corpo(req, estadoLigacaoEntrada);
    await servico.registrarEstado(pool, tel(), idDaRota(req), d.evento, d.motivo);
    res.json({ ok: true });
  });

  r.post('/:id/desligar', async (req, res) => {
    await servico.minha(pool, idDaRota(req));
    await servico.encerrar(pool, tel(), idDaRota(req), 'desligou');
    res.json({ ok: true });
  });

  // Arquivo da gravação: corpo cru (o áudio), até 30 MB.
  r.post(
    '/:id/audios/:quem',
    express.raw({ type: () => true, limit: servico.LIMITE_AUDIO }),
    async (req, res) => {
      const quem = z.enum(['voce', 'lead', 'conversa']).parse(req.params.quem);
      const desloc = Number(req.query.deslocamento ?? 0);
      const bytes = Buffer.isBuffer(req.body) ? new Uint8Array(req.body) : new Uint8Array();
      await servico.receberAudio(
        pool,
        tel(),
        idDaRota(req),
        quem,
        bytes,
        String(req.get('content-type') ?? 'audio/webm').split(';')[0]!,
        Number.isFinite(desloc) ? desloc : 0,
      );
      res.json({ ok: true });
    },
  );

  r.post('/:id/resultado', async (req, res) => {
    const id = idDaRota(req);
    await servico.salvarResultado(pool, id, corpo(req, resultadoLigacaoEntrada));
    res.json(await servico.detalhe(pool, tel(), id));
  });

  return r;
}

/* ───────────────────────────── Painel master: números ───────────────────────────── */

export function rotasMasterTelefonia(deps: DepsApi): Router {
  const r = Router({ mergeParams: true });
  const { pool } = deps;
  const contaDaRota = (req: Request) => idDaRota(req, 'contaId');

  r.get('/', async (req, res) => {
    const contaId = contaDaRota(req);
    const [nums, teste] = await Promise.all([
      servico.numeros(pool, contaId),
      deps.telefonia?.servico
        ? deps.telefonia.servico.testar().catch((e: Error) => `erro: ${e.message}`)
        : Promise.resolve(null),
    ]);
    res.json({ numeros: nums, telefonia: teste });
  });

  r.post('/numeros', async (req, res) => {
    const contaId = contaDaRota(req);
    const d = corpo(req, numeroEmpresaEntrada);
    const { rows } = await pool.query(
      `SELECT conta_id FROM comercial.telefonia_numeros WHERE numero = $1 AND ativo`,
      [d.numero],
    );
    if (rows.length) throw AppError.conflito('Este número já é de uma conta.');
    const { rows: tem } = await pool.query(
      'SELECT 1 FROM comercial.telefonia_numeros WHERE conta_id = $1 AND ativo',
      [contaId],
    );
    await pool.query(
      `INSERT INTO comercial.telefonia_numeros (conta_id, numero, rotulo, principal) VALUES ($1, $2, $3, $4)`,
      [contaId, d.numero, d.rotulo ?? null, d.principal || !tem.length],
    );
    if (d.principal)
      await pool.query(
        `UPDATE comercial.telefonia_numeros SET principal = (numero = $2) WHERE conta_id = $1 AND ativo`,
        [contaId, d.numero],
      );
    res.status(201).json({ numeros: await servico.numeros(pool, contaId) });
  });

  r.patch('/numeros/:numeroId', async (req, res) => {
    const contaId = contaDaRota(req);
    await pool.query(
      `UPDATE comercial.telefonia_numeros SET principal = (id = $2) WHERE conta_id = $1 AND ativo`,
      [contaId, idDaRota(req, 'numeroId')],
    );
    res.json({ numeros: await servico.numeros(pool, contaId) });
  });

  r.delete('/numeros/:numeroId', async (req, res) => {
    const contaId = contaDaRota(req);
    await pool.query(`UPDATE comercial.telefonia_numeros SET ativo = false WHERE conta_id = $1 AND id = $2`, [
      contaId,
      idDaRota(req, 'numeroId'),
    ]);
    // Saiu o principal: o mais antigo assume.
    await pool.query(
      `UPDATE comercial.telefonia_numeros SET principal = true
        WHERE id = (SELECT id FROM comercial.telefonia_numeros WHERE conta_id = $1 AND ativo ORDER BY id LIMIT 1)
          AND NOT EXISTS (SELECT 1 FROM comercial.telefonia_numeros WHERE conta_id = $1 AND ativo AND principal)`,
      [contaId],
    );
    res.json({ numeros: await servico.numeros(pool, contaId) });
  });

  return r;
}

/* ───────────────────────────── Aviso do LiveKit ───────────────────────────── */

/** Sala de ligação (lig-…) fechou ou o lead desligou: encerra a ligação. */
export async function tratarAvisoLigacao(deps: DepsApi, aviso: AvisoVideo): Promise<void> {
  if (!('sala' in aviso) || !aviso.sala.startsWith('lig-')) return;
  const fim =
    aviso.tipo === 'sala_encerrada' || (aviso.tipo === 'saiu' && aviso.identidade === IDENTIDADE_LEAD);
  if (!fim) return;
  const { rows } = await deps.pool.query<{ id: number; conta_id: number }>(
    `SELECT id::int, conta_id FROM comercial.ligacoes
      WHERE sala = $1 AND situacao IN ('preparando', 'chamando', 'tocando', 'em_andamento')`,
    [aviso.sala],
  );
  for (const l of rows)
    await comConta(l.conta_id, () =>
      servico.encerrar(
        deps.pool,
        telefoniaDe(deps),
        l.id,
        aviso.tipo === 'saiu' ? 'lead desligou' : 'sala fechou',
      ),
    );
}
