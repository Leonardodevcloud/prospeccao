import type { Executor } from '@prospeccao/db';
import type { AvisoVideo } from '@prospeccao/integrations/reuniao';
import { ehDoOutroLado, IDENTIDADE_SIGA_ME, PREFIXO_ENTRADA } from '@prospeccao/integrations/telefonia';
import {
  AppError,
  estadoLigacaoEntrada,
  iniciarLigacaoEntrada,
  listaLigacaoEntrada,
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
import * as entrada from './entrada.js';
import * as lista from './lista.js';
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
  ver: z.enum(['todas', 'feitas', 'recebidas', 'perdidas']).default('todas'),
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

  /**
   * Áudios falados (mp3) que o navegador toca na ligação: o aviso de gravação e o recado para quem
   * atendeu junto com outra linha da lista ("te retorno em instantes").
   */
  r.get('/aviso', async (req, res) => {
    const fala = tel().fala;
    if (!fala) throw AppError.naoEncontrado('Aviso falado');
    let texto = (await servico.config(pool)).avisoGravacao;
    if (req.query.tipo === 'retorno') {
      const { rows } = await pool.query<{ empresa: string }>(
        `SELECT coalesce(org.marca_nome, c.nome) AS empresa FROM cadastro.contas c
           JOIN cadastro.organizacoes org ON org.id = c.organizacao_id WHERE c.id = $1`,
        [req.usuario!.contaId],
      );
      const primeiro = (req.usuario!.nome ?? '').split(' ')[0] || 'o comercial';
      texto = `Oi! Aqui é ${primeiro}, da ${rows[0]?.empresa ?? 'empresa'}. Estou terminando outra ligação e te retorno em instantes, tá bom? Obrigado!`;
    }
    let audio = avisosFalados.get(texto);
    if (!audio) {
      audio = await fala.falar(texto, { voz: 'marin', velocidade: 1.05 });
      if (avisosFalados.size > 200) avisosFalados.clear();
      avisosFalados.set(texto, audio);
    }
    res
      .set('Content-Type', 'audio/mpeg')
      .set('Cache-Control', 'private, max-age=3600')
      .send(Buffer.from(audio));
  });

  /* ───── Lista de ligação ───── */

  r.get('/listas/candidatos', async (req, res) => {
    const f = consulta(
      req,
      z.object({
        etapaId: z.coerce.number().int().positive().optional(),
        responsavel: z
          .string()
          .regex(/^(eu|todos|\d+)$/)
          .default('eu'),
      }),
    );
    const responsavel =
      donoDaBase() ??
      (f.responsavel === 'todos' ? null : f.responsavel === 'eu' ? req.usuario!.id : Number(f.responsavel));
    res.json(await lista.candidatos(pool, { etapaId: f.etapaId ?? null, responsavel }));
  });

  r.get('/listas/atual', async (_req, res) => {
    res.json(await lista.atual(pool));
  });

  r.post('/listas', async (req, res) => {
    const r2 = await lista.criar(pool, corpo(req, listaLigacaoEntrada));
    res.status(201).json({ ...r2, lista: await lista.atual(pool) });
  });

  r.post('/listas/:id/proximo', async (req, res) => {
    res.json({ item: await lista.proximo(pool, idDaRota(req)) });
  });

  for (const [acao, situacao] of [
    ['pausar', 'pausada'],
    ['continuar', 'ativa'],
    ['encerrar', 'encerrada'],
  ] as const)
    r.post(`/listas/:id/${acao}`, async (req, res) => {
      await lista.mudarSituacao(pool, idDaRota(req), situacao);
      res.json(await lista.atual(pool));
    });

  r.post('/listas/itens/:id/devolver', async (req, res) => {
    await lista.devolver(pool, idDaRota(req));
    res.json({ ok: true });
  });

  r.post('/listas/itens/:id/pular', async (req, res) => {
    await lista.pular(pool, idDaRota(req));
    res.json(await lista.atual(pool));
  });

  /* ───── Recebidas ───── */

  r.get('/entrando', async (_req, res) => {
    res.json(await entrada.entrando(pool));
  });

  r.get('/relatorio', async (req, res) => {
    const { dias } = consulta(req, z.object({ dias: z.coerce.number().int().min(1).max(366).default(30) }));
    res.json(await servico.relatorio(pool, dias, donoDaBase()));
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
        ver: f.ver,
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
    const d = corpo(req, resultadoLigacaoEntrada);
    await servico.salvarResultado(pool, id, d);
    await lista.aposResultado(pool, id, d.resultado);
    res.json(await servico.detalhe(pool, tel(), id));
  });

  /** Atendeu junto com outra linha da lista e ouviu o recado: fica para retornar. */
  r.post('/:id/retorno', async (req, res) => {
    const id = idDaRota(req);
    await servico.minha(pool, id);
    await servico.encerrar(pool, tel(), id, 'recado de retorno');
    await lista.paraRetornar(pool, id);
    res.json({ ok: true });
  });

  r.post('/:id/atender', async (req, res) => {
    res.json(await entrada.atender(pool, tel(), idDaRota(req)));
  });

  r.post('/:id/passar', async (req, res) => {
    await entrada.passarParaTime(pool, idDaRota(req));
    res.json({ ok: true });
  });

  /** Ligação de número desconhecido que virou lead: liga ao lead novo. */
  r.post('/:id/lead', async (req, res) => {
    const id = idDaRota(req);
    const { empresaId } = corpo(req, z.object({ empresaId: z.number().int().positive() }));
    await exigirVisivel(pool, empresaId);
    await pool.query(
      `UPDATE comercial.ligacoes SET empresa_id = $2 WHERE id = $1 AND conta_id = $3 AND empresa_id IS NULL`,
      [id, empresaId, req.usuario!.contaId],
    );
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
  const tel = telefoniaDe(deps);
  // Alguém ligou para um número da empresa.
  if (
    aviso.tipo === 'entrou' &&
    aviso.sala.startsWith(PREFIXO_ENTRADA) &&
    aviso.identidade.startsWith('sip_')
  ) {
    await entrada.receber(deps.pool, tel, deps.log, aviso.sala, aviso.identidade);
    return;
  }
  const outroLado =
    aviso.tipo === 'saiu' && (ehDoOutroLado(aviso.identidade) || aviso.identidade === IDENTIDADE_SIGA_ME);
  if (aviso.tipo !== 'sala_encerrada' && !outroLado) return;
  const { rows } = await deps.pool.query<{
    id: number;
    conta_id: number;
    direcao: string;
    atendida: boolean;
  }>(
    `SELECT id::int, conta_id, direcao, atendida_em IS NOT NULL AS atendida FROM comercial.ligacoes
      WHERE sala = $1 AND situacao IN ('preparando', 'chamando', 'tocando', 'em_andamento', 'siga_me')`,
    [aviso.sala],
  );
  for (const l of rows)
    await comConta(l.conta_id, () =>
      l.direcao === 'entrada' && !l.atendida
        ? entrada.perdida(deps.pool, tel, l.id, 'desligou antes de atenderem')
        : servico.encerrar(
            deps.pool,
            tel,
            l.id,
            aviso.tipo === 'saiu' ? 'o outro lado desligou' : 'sala fechou',
          ),
    );
}
