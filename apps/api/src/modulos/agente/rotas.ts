import { interpretarWebhook } from '@prospeccao/integrations/whatsapp';
import { AppError, aprovarRascunho, configAgenteEntrada } from '@prospeccao/shared';
import { type Request, Router } from 'express';
import { z } from 'zod';
import type { DepsApi } from '../../dependencias.js';
import { corpo, idDaRota } from '../../middlewares/http.js';
import * as funil from '../funil/repositorio.js';
import * as repo from './repositorio.js';

/**
 * Endereço público da API (para a Evolution chamar): API_URL_PUBLICA, ou o domínio que o Railway
 * informa (RAILWAY_PUBLIC_DOMAIN), ou o da própria requisição.
 */
function enderecoPublico(req: Request): string {
  const env = process.env.API_URL_PUBLICA?.replace(/\/$/, '');
  if (env) return env;
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return `${req.protocol}://${req.get('host')}`;
}

/** Tela do Agente: configuração, mensagens para revisar e leads que a IA passou para você. */
export function rotasAgente({ pool, log, whatsapp, ia }: DepsApi): Router {
  const r = Router();

  r.get('/', async (req: Request, res) => {
    const [config, resumo, rascunhos, pausados] = await Promise.all([
      repo.obterConfig(pool),
      repo.resumo(pool),
      repo.rascunhos(pool),
      repo.pausados(pool),
    ]);
    const { webhookToken, ...resto } = config;
    res.json({
      config: resto,
      // Endereço para colar na Evolution (Webhook → MESSAGES_UPSERT).
      webhook: `${enderecoPublico(req)}/webhooks/evolution/${webhookToken}`,
      status: { whatsapp: !!whatsapp, ia: !!ia },
      resumo,
      rascunhos,
      pausados,
    });
  });

  r.put('/config', async (req, res) => {
    const dados = corpo(req, configAgenteEntrada);
    await repo.salvarConfig(pool, dados);
    log.info({ ligado: dados.ligado, revisarAntes: dados.revisarAntes }, 'agente: configuração salva');
    res.json({ ok: true });
  });

  r.post('/rascunhos/:id/aprovar', async (req, res) => {
    const { texto } = corpo(req, aprovarRascunho);
    if (!(await repo.aprovar(pool, idDaRota(req), texto))) throw AppError.naoEncontrado('Rascunho');
    res.json({ ok: true });
  });

  r.post('/rascunhos/:id/descartar', async (req, res) => {
    if (!(await repo.descartar(pool, idDaRota(req)))) throw AppError.naoEncontrado('Rascunho');
    res.json({ ok: true });
  });

  r.get('/conversa/:empresaId', async (req, res) => {
    res.json(await repo.conversa(pool, idDaRota(req, 'empresaId')));
  });

  /** Liga a IA em todos os leads abertos das etapas escolhidas. */
  r.post('/ligar-em-massa', async (req, res) => {
    const { etapas } = corpo(
      req,
      z.object({ etapas: z.array(z.enum(['a_abordar', 'abordado', 'respondeu', 'proposta'])).min(1) }),
    );
    res.json({ ligados: await repo.ligarEmMassa(pool, etapas) });
  });

  return r;
}

/**
 * Webhook da Evolution (público; a "senha" é o token no endereço). Guarda a mensagem do lead e
 * registra no funil (o lead vai para "Respondeu"); quem responde é o motor do agente, alguns
 * segundos depois, para juntar mensagens em sequência.
 */
export function rotasWebhook({ pool, log }: DepsApi): Router {
  const r = Router();
  r.post('/evolution/:token', async (req, res) => {
    const cfg = await repo.obterConfig(pool);
    if (req.params.token !== cfg.webhookToken) throw AppError.naoEncontrado('Webhook');
    const m = interpretarWebhook(req.body);
    // Grava antes de responder (é rápido). Falha fica no log; responde 200 para a Evolution não repetir sem fim.
    if (m)
      await registrarRecebida(m).catch((erro) =>
        log.error({ err: erro }, 'webhook da Evolution: falha ao registrar'),
      );
    res.json({ ok: true });
  });

  async function registrarRecebida(m: NonNullable<ReturnType<typeof interpretarWebhook>>) {
    const empresaId = await repo.leadPorTelefone(pool, m.telefone);
    if (!empresaId) return;
    if (m.deMim) {
      // Mensagem que você mandou pelo celular: entra no histórico (as do sistema já estão lá).
      if (m.idExterno) {
        const { rows } = await pool.query('SELECT 1 FROM comercial.mensagens WHERE id_externo = $1', [
          m.idExterno,
        ]);
        if (rows.length) return;
      }
      const id = await repo.criarMensagem(pool, {
        empresaId,
        direcao: 'enviada',
        texto: m.texto,
        telefone: m.telefone,
        status: 'enviada',
        origem: 'humano',
        idExterno: m.idExterno,
      });
      if (id)
        await funil.registrarAtividade(
          pool,
          empresaId,
          { tipo: 'whatsapp', direcao: 'enviada', texto: m.texto, contato: m.telefone },
          'você (celular)',
        );
      return;
    }
    const id = await repo.criarMensagem(pool, {
      empresaId,
      direcao: 'recebida',
      texto: m.texto,
      telefone: m.telefone,
      status: 'recebida',
      origem: 'lead',
      idExterno: m.idExterno,
    });
    if (!id) return; // a Evolution mandou a mesma mensagem duas vezes
    await funil.registrarAtividade(
      pool,
      empresaId,
      { tipo: 'whatsapp', direcao: 'recebida', texto: m.texto, contato: m.telefone },
      m.nome ?? 'lead',
    );
    log.info({ empresaId }, 'agente: lead respondeu no WhatsApp');
  }
  return r;
}
