import {
  AppError,
  contatoLeadAtualizar,
  contatoLeadEntrada,
  destinoEntrada,
  filtrosConversas,
  mensagemEntrada,
  midiaEntrada,
  respostaRapidaEntrada,
  vincularEntrada,
} from '@prospeccao/shared';
import { type Request, Router } from 'express';
import { z } from 'zod';
import type { DepsApi } from '../../dependencias.js';
import { consulta, corpo, idDaRota } from '../../middlewares/http.js';
import * as contatos from '../contatos/repositorio.js';
import * as motorEmail from '../email/motor.js';
import { pararSequencia, RESPONDEU_WHATSAPP } from '../email/sequencia.js';
import { dadosDoLead } from '../funil/cadencia.js';
import * as funil from '../funil/repositorio.js';
import * as repo from './repositorio.js';

/** Telefone na rota: só dígitos (10 a 13). */
function telefoneDaRota(req: Request): string {
  const t = String(req.params.telefone ?? '').replace(/\D/g, '');
  if (t.length < 10 || t.length > 13) throw AppError.invalido('Telefone inválido.');
  return t;
}

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

  /* ───────── Números fora dos leads (a pessoa indicada que escreveu primeiro, por exemplo) ───────── */

  /** Leads para vincular um número (nome da empresa, de um contato ou telefone). */
  r.get('/leads', async (req, res) => {
    const { busca } = consulta(req, z.object({ busca: z.string().trim().min(2).max(80) }));
    res.json(await contatos.buscarLeads(pool, busca));
  });

  r.get('/nao-identificados', async (_req, res) => {
    res.json(await contatos.listarNaoIdentificados(pool));
  });

  /** Vincula o número a um lead: vira contato da negociação e as mensagens vão para a conversa dele. */
  r.post('/nao-identificados/:telefone/vincular', async (req, res) => {
    const d = corpo(req, vincularEntrada);
    const v = await contatos.vincular(pool, telefoneDaRota(req), d);
    if (v.recebidas) {
      // Mensagem dele é resposta: a etapa anda e a sequência automática para.
      await pararSequencia(pool, d.empresaId, RESPONDEU_WHATSAPP);
      // Resposta pelo WhatsApp sem texto (as mensagens já estão na conversa): a etapa anda.
      await funil.registrarAtividade(
        pool,
        d.empresaId,
        { tipo: 'whatsapp', direcao: 'recebida', texto: null, contato: telefoneDaRota(req) },
        d.nome,
      );
      await funil.registrarAtividade(
        pool,
        d.empresaId,
        {
          tipo: 'nota',
          direcao: null,
          texto: `${d.nome}${d.cargo ? ` (${d.cargo})` : ''} entrou na negociação: ${v.recebidas} mensagem(ns) do número ${telefoneDaRota(req)} vieram para esta conversa.`,
        },
        req.usuario!.nome,
      );
    }
    res.status(201).json(await repo.abrir(pool, d.empresaId));
  });

  r.post('/nao-identificados/:telefone/descartar', async (req, res) => {
    await contatos.descartarNaoIdentificado(pool, telefoneDaRota(req));
    res.json({ ok: true });
  });

  /* ───────── Contatos da negociação e "enviar para" ───────── */

  /** Só os contatos da negociação (a ficha usa; não marca mensagens como lidas). */
  r.get('/:empresaId/contatos', async (req, res) => {
    const id = idDaRota(req, 'empresaId');
    const [lista, opcoes, lead] = await Promise.all([
      contatos.listar(pool, id),
      contatos.opcoesDeEnvio(pool, id),
      dadosDoLead(pool, id),
    ]);
    res.json({ contatos: lista, opcoesEnvio: opcoes, telefone: lead.telefone });
  });

  r.post('/:empresaId/contatos', async (req, res) => {
    const id = idDaRota(req, 'empresaId');
    await contatos.criar(pool, id, corpo(req, contatoLeadEntrada));
    res.status(201).json(await repo.abrir(pool, id));
  });

  r.patch('/:empresaId/contatos/:id', async (req, res) => {
    const id = idDaRota(req, 'empresaId');
    await contatos.atualizar(pool, id, idDaRota(req), corpo(req, contatoLeadAtualizar));
    res.json(await repo.abrir(pool, id));
  });

  r.delete('/:empresaId/contatos/:id', async (req, res) => {
    const id = idDaRota(req, 'empresaId');
    await contatos.remover(pool, id, idDaRota(req));
    res.json(await repo.abrir(pool, id));
  });

  r.put('/:empresaId/destino', async (req, res) => {
    const id = idDaRota(req, 'empresaId');
    const { telefone } = corpo(req, destinoEntrada);
    if (telefone) {
      const opcoes = await contatos.opcoesDeEnvio(pool, id);
      if (
        !opcoes.some(
          (o) =>
            o.telefone.slice(0, 2) === telefone.slice(0, 2) && o.telefone.slice(-8) === telefone.slice(-8),
        )
      )
        throw AppError.invalido('Escolha um número da empresa ou um contato da negociação.');
    }
    await contatos.definirDestino(pool, id, telefone);
    res.json(await repo.abrir(pool, id));
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
