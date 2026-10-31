import { timingSafeEqual } from 'node:crypto';
import { cobrancaDoAsaas } from '@prospeccao/integrations/cobranca';
import { AppError, assinarEntrada, cadastroTesteEntrada, comprarMinutosEntrada } from '@prospeccao/shared';
import express, { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { DepsApi } from '../../dependencias.js';
import { enderecoDoApp } from '../../endereco.js';
import { consulta, corpo } from '../../middlewares/http.js';
import { exigirAdmin } from '../../middlewares/seguranca.js';
import { iniciarSessao } from '../auth/sessao.js';
import * as cadastro from './cadastro.js';
import * as servico from './servico.js';

/**
 * Teste grátis (sem login: cadastro, reenviar o link e confirmar), o aviso do Asaas (pagamentos)
 * e Meu plano › Assinar (com login).
 */

const depsAssinatura = (deps: DepsApi): servico.DepsAssinatura => ({
  pool: deps.pool,
  log: deps.log,
  servicos: deps.servicos,
  cobranca: deps.cobranca ?? null,
});

export function rotasTesteGratis(deps: DepsApi): Router {
  const r = Router();
  const d: cadastro.DepsCadastro = {
    pool: deps.pool,
    log: deps.log,
    servicos: deps.servicos,
    captcha: deps.captcha ?? null,
  };
  const limite = (limit: number) =>
    rateLimit({
      windowMs: 60 * 60_000,
      limit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (_req, _res, next) =>
        next(new AppError(429, 'muitas_tentativas', 'Muitas tentativas. Espere um pouco e tente de novo.')),
    });
  const limitar = limite(10);
  const limitarConfirmar = limite(30);
  const endereco = (origem: string | undefined) => enderecoDoApp(origem, deps.origens, null);

  r.get('/config', (_req, res) => {
    res.json({ captcha: deps.captcha?.site ?? null });
  });

  r.post('/', limitar, async (req, res) => {
    const e = corpo(req, cadastroTesteEntrada);
    const ip = req.ip ?? '';
    res.status(201).json(await cadastro.iniciar(d, e, ip, endereco(req.get('origin'))));
  });

  r.post('/reenviar', limitar, async (req, res) => {
    const { email } = corpo(req, z.object({ email: z.string().trim().email().max(200) }));
    await cadastro.reenviar(d, email, endereco(req.get('origin')));
    res.json({ ok: true });
  });

  r.post('/confirmar/:token', limitarConfirmar, async (req, res) => {
    const token = String(req.params.token);
    if (!/^[\w-]{20,80}$/.test(token)) throw AppError.naoEncontrado('Link de confirmação');
    const { usuarioId } = await cadastro.confirmar(d, token);
    await iniciarSessao(deps.pool, req, res, deps.auth, usuarioId);
    res.json({ ok: true });
  });

  return r;
}

/** Aviso do Asaas (pagamento criado, confirmado, atrasado, estornado). Corpo JSON; token no cabeçalho. */
export function rotasWebhookAsaas(deps: DepsApi): Router {
  const r = Router();
  r.post('/webhook', express.json({ limit: '1mb' }), async (req, res) => {
    const esperado = deps.asaasTokenWebhook;
    const veio = req.get('asaas-access-token') ?? '';
    if (
      !esperado ||
      veio.length !== esperado.length ||
      !timingSafeEqual(Buffer.from(veio), Buffer.from(esperado))
    )
      throw new AppError(401, 'token_invalido', 'Token do aviso inválido.');
    const b = req.body as { id?: string; event?: string; payment?: Parameters<typeof cobrancaDoAsaas>[0] };
    const id = String(b.id ?? `${b.event}:${b.payment?.id}:${b.payment?.status}`);
    const { rows } = await deps.pool.query(
      `INSERT INTO cadastro.asaas_eventos (id, tipo, corpo) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING RETURNING 1`,
      [id.slice(0, 200), String(b.event ?? ''), JSON.stringify(b)],
    );
    // O mesmo aviso de novo: já tratado.
    if (rows[0] && b.payment?.id) {
      try {
        await servico.processarCobranca(depsAssinatura(deps), cobrancaDoAsaas(b.payment));
      } catch (e) {
        await deps.pool.query('UPDATE cadastro.asaas_eventos SET erro = $2 WHERE id = $1', [
          id.slice(0, 200),
          (e as Error).message.slice(0, 500),
        ]);
        throw e;
      }
    }
    res.json({ ok: true });
  });
  return r;
}

export function rotasAssinatura(deps: DepsApi): Router {
  const r = Router();
  const d = () => depsAssinatura(deps);

  r.get('/', async (req, res) => {
    res.json(await servico.resumo(d(), req.usuario!.contaId));
  });

  r.post('/assinar', exigirAdmin, async (req, res) => {
    const e = corpo(req, assinarEntrada);
    res.status(201).json(await servico.assinar(d(), req.usuario!.contaId, e));
  });

  r.get('/pagar', async (req, res) => {
    const { cobranca } = consulta(req, z.object({ cobranca: z.coerce.number().int().positive().optional() }));
    res.json(await servico.aPagar(d(), req.usuario!.contaId, cobranca));
  });

  /** "Já paguei": confere no Asaas agora (sem esperar o aviso). */
  r.post('/conferir', async (req, res) => {
    await servico.conferir(d(), req.usuario!.contaId);
    res.json(await servico.resumo(d(), req.usuario!.contaId));
  });

  /** Não renovar (o mês pago continua valendo até o fim). */
  r.post('/cancelar', exigirAdmin, async (req, res) => {
    await servico.cancelar(d(), req.usuario!.contaId);
    res.json(await servico.resumo(d(), req.usuario!.contaId));
  });

  r.post('/renovar', exigirAdmin, async (req, res) => {
    await servico.voltarARenovar(d(), req.usuario!.contaId);
    res.json(await servico.resumo(d(), req.usuario!.contaId));
  });

  /** Pacote de minutos de ligação (cobrança avulsa; entra no saldo quando pagar). */
  r.post('/minutos', exigirAdmin, async (req, res) => {
    const { pacotes } = corpo(req, comprarMinutosEntrada);
    res.status(201).json(await servico.comprarMinutos(d(), req.usuario!.contaId, pacotes));
  });

  return r;
}
