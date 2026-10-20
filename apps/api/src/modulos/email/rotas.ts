import {
  AppError,
  anexoEmailEntrada,
  CLASSES_RESPOSTA,
  campanhaEmailEntrada,
  configEmailEntrada,
  modeloEmailEntrada,
  montarEmail,
  responderEmailEntrada,
} from '@prospeccao/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { DepsApi } from '../../dependencias.js';
import { consulta, corpo, idDaRota } from '../../middlewares/http.js';
import { exigirAdmin } from '../../middlewares/seguranca.js';
import { guardarMidia } from '../conversas/repositorio.js';
import * as motor from './motor.js';
import * as repo from './repositorio.js';

export function rotasEmail(deps: DepsApi): Router {
  const { pool } = deps;
  const r = Router();

  /** Visão geral: configuração, se o e-mail está ligado na API e os números do dia. */
  r.get('/', async (_req, res) => {
    const [config, resumo] = await Promise.all([repo.obterConfig(pool), repo.resumo(pool)]);
    res.json({
      config,
      resumo,
      status: {
        smtp: !!deps.email,
        imap: !!deps.email?.lerNovos,
        ia: !!deps.classificarEmail,
        remetente: deps.email?.remetente ?? null,
      },
    });
  });

  r.put('/config', exigirAdmin, async (req, res) => {
    await repo.salvarConfig(pool, corpo(req, configEmailEntrada));
    res.json(await repo.obterConfig(pool));
  });

  /** Testa a conexão com o servidor de e-mail (SMTP e IMAP). */
  r.post('/verificar', exigirAdmin, async (_req, res) => {
    if (!deps.email) throw AppError.invalido('O e-mail não está configurado na API.');
    const resultado: { smtp: string; imap: string } = {
      smtp: 'ok',
      imap: deps.email.lerNovos ? 'ok' : 'não configurado',
    };
    try {
      await deps.email.verificar?.();
    } catch (erro) {
      resultado.smtp = erro instanceof Error ? erro.message : String(erro);
    }
    if (deps.email.lerNovos) {
      const cfg = await repo.obterConfig(pool);
      const lidas = await motor.lerRespostas(deps, cfg, true);
      const depois = await repo.obterConfig(pool);
      resultado.imap =
        depois.imapErro ?? `ok (${lidas} resposta${lidas === 1 ? '' : 's'} nova${lidas === 1 ? '' : 's'})`;
    }
    res.json(resultado);
  });

  /* Modelos */
  r.get('/modelos', async (_req, res) => {
    res.json(await repo.listarModelos(pool));
  });
  r.post('/modelos', exigirAdmin, async (req, res) => {
    const id = await repo.salvarModelo(pool, corpo(req, modeloEmailEntrada));
    res.status(201).json({ id, modelos: await repo.listarModelos(pool) });
  });
  r.put('/modelos/:id', exigirAdmin, async (req, res) => {
    const id = await repo.salvarModelo(pool, corpo(req, modeloEmailEntrada), idDaRota(req));
    res.json({ id, modelos: await repo.listarModelos(pool) });
  });
  r.delete('/modelos/:id', exigirAdmin, async (req, res) => {
    await repo.apagarModelo(pool, idDaRota(req));
    res.json(await repo.listarModelos(pool));
  });

  /** Arquivo para anexar (proposta em PDF…). */
  r.post('/anexos', exigirAdmin, async (req, res) => {
    const a = corpo(req, anexoEmailEntrada);
    const id = await guardarMidia(pool, { mime: a.mime, nome: a.nome, base64: a.base64 });
    res.status(201).json({ id, nome: a.nome, mime: a.mime, tamanho: Buffer.byteLength(a.base64, 'base64') });
  });

  /** Prévia: o e-mail como o lead vai ver (com um lead de verdade, se informado). */
  r.post('/previa', async (req, res) => {
    const d = corpo(
      req,
      z.object({
        assunto: z.string().max(200),
        corpo: z.string().max(20_000),
        empresaId: z.number().int().positive().nullable().optional(),
      }),
    );
    res.json(await repo.previa(pool, d, d.empresaId));
  });

  /** Envia o modelo para você (ou outro endereço) ver na caixa de entrada de verdade. */
  r.post('/teste', exigirAdmin, async (req, res) => {
    const d = corpo(
      req,
      z.object({
        assunto: z.string().trim().min(1).max(200),
        corpo: z.string().trim().min(1).max(20_000),
        anexos: z.array(z.number().int().positive()).max(5).default([]),
        para: z.string().trim().toLowerCase().email('E-mail inválido.'),
      }),
    );
    if (!deps.email)
      throw AppError.invalido(
        'O e-mail não está configurado na API (EMAIL_SMTP_HOST, EMAIL_USUARIO, EMAIL_SENHA).',
      );
    const cfg = await repo.obterConfig(pool);
    const p = await repo.previa(pool, d);
    const e = montarEmail({ assunto: `[TESTE] ${d.assunto}`, corpo: d.corpo }, p.lead, {
      assinatura: cfg.assinatura,
      descadastro: '#',
    });
    await deps.email.enviar({
      de: { nome: cfg.remetenteNome, email: deps.email.remetente },
      para: d.para,
      responderPara: cfg.responderPara,
      assunto: e.assunto,
      html: e.html,
      texto: e.texto,
      anexos: await repo.anexosDoModelo(pool, d.anexos),
    });
    res.json({ ok: true });
  });

  /* Campanhas de e-mail */
  r.get('/campanhas', async (_req, res) => {
    res.json(await repo.listarCampanhas(pool));
  });

  /** Quantos leads vão receber (antes de criar). */
  r.post('/campanhas/estimar', async (req, res) => {
    const d = corpo(
      req,
      campanhaEmailEntrada.pick({
        campanhaId: true,
        faixas: true,
        pularNoFunil: true,
        incluirContador: true,
      }),
    );
    const e = await repo.elegiveis(pool, d);
    res.json({
      leads: e.leads,
      comEmail: e.comEmail,
      elegiveis: e.elegiveis.length,
      exemplos: e.elegiveis.slice(0, 8),
    });
  });

  r.post('/campanhas', exigirAdmin, async (req, res) => {
    const id = await repo.criarCampanha(pool, corpo(req, campanhaEmailEntrada));
    res.status(201).json({ id });
  });
  r.post('/campanhas/:id/iniciar', exigirAdmin, async (req, res) => {
    res.json(await repo.iniciarCampanha(pool, idDaRota(req)));
  });
  r.post('/campanhas/:id/pausar', exigirAdmin, async (req, res) => {
    await repo.pausarCampanha(pool, idDaRota(req));
    res.json({ ok: true });
  });
  r.delete('/campanhas/:id', exigirAdmin, async (req, res) => {
    await repo.apagarCampanha(pool, idDaRota(req));
    res.status(204).end();
  });

  r.get('/envios', async (req, res) => {
    const f = consulta(
      req,
      z.object({
        campanhaEmailId: z.coerce.number().int().positive().optional(),
        filtro: z.enum(['todos', 'abriram', 'responderam', 'erros', 'fila']).default('todos'),
        busca: z.string().trim().max(120).optional(),
      }),
    );
    res.json(await repo.envios(pool, f));
  });

  /* Respostas */
  r.get('/respostas', async (req, res) => {
    const f = consulta(
      req,
      z.object({
        classe: z.enum(CLASSES_RESPOSTA).optional(),
        naoLidas: z
          .enum(['true', 'false'])
          .transform((v) => v === 'true')
          .optional(),
      }),
    );
    res.json(await repo.respostas(pool, f));
  });

  r.post('/respostas/:id/lida', async (req, res) => {
    await pool.query(
      'UPDATE comercial.respostas_email SET lida_em = coalesce(lida_em, now()) WHERE id = $1',
      [idDaRota(req)],
    );
    res.json({ ok: true });
  });

  /** Corrige a classificação (ex.: era interesse e a IA achou que não): o lead segue o caminho certo. */
  r.post('/respostas/:id/classe', async (req, res) => {
    const id = idDaRota(req);
    const { classe } = corpo(req, z.object({ classe: z.enum(CLASSES_RESPOSTA) }));
    const { rows } = await pool.query<{
      id: number;
      empresaId: number | null;
      deEmail: string;
      texto: string;
      resumo: string | null;
      classe: string;
    }>(
      `UPDATE comercial.respostas_email SET classe = $2, classificado_por = 'voce', lida_em = coalesce(lida_em, now())
        WHERE id = $1
        RETURNING id::int, empresa_id::int AS "empresaId", de_email AS "deEmail", texto, resumo, classe`,
      [id, classe],
    );
    const resp = rows[0];
    if (!resp) throw AppError.naoEncontrado('Resposta');
    await motor.agirPelaResposta(deps, { ...resp, classe });
    res.json({ ok: true });
  });

  r.post('/respostas/:id/responder', async (req, res) => {
    await motor.responder(deps, idDaRota(req), corpo(req, responderEmailEntrada).texto);
    res.json({ ok: true });
  });

  /** E-mails de um lead (ficha). */
  r.get('/lead/:empresaId', async (req, res) => {
    res.json(await repo.doLead(pool, idDaRota(req, 'empresaId')));
  });

  return r;
}
