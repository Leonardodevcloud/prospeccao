import { filtrosConversas, mensagemEntrada, midiaEntrada, respostaRapidaEntrada } from '@prospeccao/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { DepsApi } from '../../dependencias.js';
import { consulta, corpo, idDaRota } from '../../middlewares/http.js';
import * as motorEmail from '../email/motor.js';
import * as repo from './repositorio.js';

export function rotasConversas(deps: DepsApi): Router {
  const { pool } = deps;
  const r = Router();

  r.get('/', async (req, res) => {
    res.json(await repo.listar(pool, consulta(req, filtrosConversas), req.usuario!.id));
  });

  r.get('/resumo', async (req, res) => {
    res.json(await repo.resumo(pool, req.usuario!.papel === 'admin' ? null : req.usuario!.id));
  });

  r.get('/respostas', async (_req, res) => {
    res.json(await repo.respostas(pool));
  });
  r.post('/respostas', async (req, res) => {
    await repo.salvarResposta(pool, corpo(req, respostaRapidaEntrada));
    res.status(201).json(await repo.respostas(pool));
  });
  r.put('/respostas/:id', async (req, res) => {
    await repo.salvarResposta(pool, corpo(req, respostaRapidaEntrada), idDaRota(req));
    res.json(await repo.respostas(pool));
  });
  r.delete('/respostas/:id', async (req, res) => {
    await repo.apagarResposta(pool, idDaRota(req));
    res.json(await repo.respostas(pool));
  });

  /** Arquivo de uma mensagem (foto, áudio, PDF). */
  r.get('/midia/:id', async (req, res) => {
    const m = await repo.midia(pool, idDaRota(req));
    // Arquivo que veio do lead pode ser qualquer coisa: só abre na tela o que é foto, áudio, vídeo
    // ou PDF; o resto baixa (e nada roda com a origem do sistema).
    const seguro =
      /^(image\/(png|jpe?g|gif|webp)|audio\/[\w.+-]+|video\/(mp4|webm|ogg)|application\/pdf)(;|$)/i.test(
        m.mime,
      );
    const nome = m.nome ? `; filename*=UTF-8''${encodeURIComponent(m.nome)}` : '';
    res
      .type(seguro ? m.mime : 'application/octet-stream')
      .set('Cache-Control', 'private, max-age=86400')
      .set('Content-Disposition', `${seguro ? 'inline' : 'attachment'}${nome}`)
      .set('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; sandbox")
      .set('X-Content-Type-Options', 'nosniff')
      .send(m.dados);
  });

  /** Abre a conversa (e marca as mensagens dele como lidas). */
  r.get('/:empresaId', async (req, res) => {
    const id = idDaRota(req, 'empresaId');
    const conversa = await repo.abrir(pool, id);
    await repo.marcarLidas(pool, id);
    res.json(conversa);
  });

  r.post('/:empresaId/mensagens', async (req, res) => {
    const id = idDaRota(req, 'empresaId');
    await repo.enviarTexto(deps, id, corpo(req, mensagemEntrada).texto);
    res.status(201).json(await repo.abrir(pool, id));
  });

  /** E-mail pela conversa: responde a última mensagem dele por e-mail ou manda um novo. */
  r.post('/:empresaId/email', async (req, res) => {
    const id = idDaRota(req, 'empresaId');
    const d = corpo(
      req,
      z.object({
        texto: z.string().trim().min(1).max(20_000),
        assunto: z.string().trim().max(200).optional(),
      }),
    );
    await motorEmail.enviarDaConversa(await motorEmail.depsDaConta(deps), id, d);
    await repo.marcarLidas(pool, id);
    res.status(201).json(await repo.abrir(pool, id));
  });

  r.post('/:empresaId/midia', async (req, res) => {
    const id = idDaRota(req, 'empresaId');
    await repo.enviarMidia(deps, id, corpo(req, midiaEntrada));
    res.status(201).json(await repo.abrir(pool, id));
  });

  return r;
}
