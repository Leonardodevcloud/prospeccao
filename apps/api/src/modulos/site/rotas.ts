import { createHash } from 'node:crypto';
import {
  AppError,
  configSiteEntrada,
  type EtapaVenda,
  formatarTelefone,
  normalizarTelefone,
  pedidoSiteAtualizar,
  pedidoSiteEntrada,
  pedidoVendaNovo,
  ROTULO_ETAPA_VENDA,
  whatsappComDdi,
} from '@prospeccao/shared';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { comConta } from '../../contexto.js';
import type { DepsApi } from '../../dependencias.js';
import { corpo, idDaRota } from '../../middlewares/http.js';
import { notificar } from '../notificacoes/repositorio.js';
import * as repo from './repositorio.js';

const pedidoNotaEntrada = z.object({ texto: z.string().trim().min(1, 'Escreva a anotação.').max(1000) });

const fmtData = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * Rotas públicas do site institucional (sem login, chamadas pelo próprio site via /api do Vercel):
 * o contato comercial a mostrar e o pedido de demonstração, que cai no quadro de vendas do master
 * (não no CRM: é venda da plataforma, não prospecção da conta principal).
 */
export function rotasSitePublico(deps: DepsApi): Router {
  const { pool, log } = deps;
  const r = Router();

  const limitar = rateLimit({
    windowMs: 10 * 60_000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(
        new AppError(
          429,
          'muitos_pedidos',
          'Recebemos vários pedidos seus. Tente de novo em alguns minutos.',
        ),
      ),
  });

  r.get('/contato', async (_req, res) => {
    const c = await repo.lerConfig(pool);
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ whatsapp: c.whatsapp, email: c.email });
  });

  r.post('/demonstracao', limitar, async (req, res) => {
    const d = corpo(req, pedidoSiteEntrada);
    // Robô preencheu o campo escondido: responde como se tivesse dado certo e não grava nada.
    if (d.site) {
      res.json({ ok: true });
      return;
    }
    const ipHash = createHash('sha256')
      .update(`${req.ip ?? ''}|prospect-site`)
      .digest('hex')
      .slice(0, 32);
    if ((await repo.pedidosRecentes(pool, ipHash)) >= 5) {
      res.json({ ok: true });
      return;
    }
    const telefone = normalizarTelefone(d.whatsapp)!;
    const plano = d.plano && d.plano !== 'Ainda não sei' ? d.plano : null;
    const resumo = [
      d.nicho ? `Vende para: ${d.nicho}.` : '',
      plano ? `Plano de interesse: ${plano}.` : '',
      d.canal === 'whatsapp'
        ? 'Seguiu para o WhatsApp com a mensagem pronta.'
        : d.canal === 'email'
          ? 'Seguiu para o e-mail com a mensagem pronta.'
          : '',
    ]
      .filter(Boolean)
      .join(' ');

    // A mesma pessoa pedindo de novo: anota no pedido que já está aberto.
    const aberto = await repo.pedidoAbertoDoNumero(pool, telefone);
    const id =
      aberto ??
      (await repo.gravarPedido(pool, {
        nome: d.nome,
        empresa: d.empresa,
        whatsapp: telefone,
        email: d.email || null,
        nicho: d.nicho || null,
        plano,
        canal: d.canal,
        ipHash,
      }));
    await repo.historico(
      pool,
      id,
      aberto ? `Pediu demonstração de novo pelo site. ${resumo}` : `Pedido pelo site. ${resumo}`,
      d.nome,
    );
    log.info({ pedido: id, canal: d.canal, repetido: !!aberto }, 'site: pedido de demonstração');

    // Aviso no sino (e no celular) de quem administra a plataforma.
    const contaId = await repo.contaPrincipal(pool);
    if (contaId)
      await comConta(contaId, async () => {
        const { rows } = await pool.query<{ id: number }>(
          'SELECT id FROM cadastro.usuarios WHERE conta_id = $1 AND master AND ativo',
          [contaId],
        );
        for (const u of rows)
          await notificar(pool, u.id, {
            tipo: 'sistema',
            titulo: `Pedido de demonstração: ${d.empresa}`,
            texto: `${d.nome} · ${formatarTelefone(telefone)}${plano ? ` · ${plano}` : ''}`,
            link: `/plataforma/vendas?pedido=${id}`,
          });
      }).catch((e: unknown) =>
        log.error({ pedido: id, erro: (e as Error).message }, 'site: aviso do pedido'),
      );
    res.json({ ok: true });
  });

  return r;
}

/** Painel master: quadro de vendas da plataforma e o contato comercial que o site mostra. */
export function rotasSiteMaster({ pool }: DepsApi): Router {
  const r = Router();
  r.get('/', async (_req, res) => {
    const [config, pedidos] = await Promise.all([repo.lerConfig(pool), repo.listar(pool)]);
    res.json({ config, pedidos });
  });
  r.get('/novos', async (_req, res) => {
    res.json({ novos: await repo.contarNovos(pool) });
  });
  r.put('/config', async (req, res) => {
    const d = corpo(req, configSiteEntrada);
    const config = { whatsapp: whatsappComDdi(d.whatsapp), email: d.email || null };
    await repo.salvarConfig(pool, config, req.usuario!.id);
    res.json(config);
  });

  /** Oportunidade que chegou por outro canal (indicação, ligação): entra no quadro à mão. */
  r.post('/pedidos', async (req, res) => {
    const d = corpo(req, pedidoVendaNovo);
    const plano = d.plano && d.plano !== 'Ainda não sei' ? d.plano : null;
    const id = await repo.gravarPedido(pool, {
      nome: d.nome,
      empresa: d.empresa,
      whatsapp: normalizarTelefone(d.whatsapp)!,
      email: d.email || null,
      nicho: d.nicho || null,
      plano,
      canal: 'formulario',
      ipHash: null,
      nota: d.nota || null,
    });
    await repo.historico(pool, id, 'Cadastrado à mão no quadro de vendas.', req.usuario!.nome);
    res.status(201).json(await repo.obter(pool, id));
  });

  r.get('/pedidos/:id', async (req, res) => {
    const p = await repo.obter(pool, idDaRota(req));
    if (!p) throw AppError.naoEncontrado('Pedido');
    res.json(p);
  });

  r.patch('/pedidos/:id', async (req, res) => {
    const id = idDaRota(req);
    const d = corpo(req, pedidoSiteAtualizar);
    if (d.contaId) {
      const { rowCount } = await pool.query('SELECT 1 FROM cadastro.contas WHERE id = $1', [d.contaId]);
      if (!rowCount) throw AppError.naoEncontrado('Conta');
    }
    const antes = await repo.atualizar(pool, id, d);
    if (!antes) throw AppError.naoEncontrado('Pedido');
    const autor = req.usuario!.nome;
    if (d.etapa && d.etapa !== antes.etapa) {
      const extra =
        d.etapa === 'perdido' && d.motivoPerda
          ? ` Motivo: ${d.motivoPerda}.`
          : d.etapa === 'demonstracao' && d.demonstracaoEm
            ? ` Para ${fmtData(d.demonstracaoEm)}.`
            : '';
      await repo.historico(
        pool,
        id,
        `${ROTULO_ETAPA_VENDA[antes.etapa as EtapaVenda]} → ${ROTULO_ETAPA_VENDA[d.etapa]}.${extra}`,
        autor,
      );
    } else if (d.demonstracaoEm) {
      await repo.historico(pool, id, `Demonstração marcada para ${fmtData(d.demonstracaoEm)}.`, autor);
    }
    if (d.contaId && d.contaId !== antes.conta_id) {
      const { rows } = await pool.query<{ nome: string }>('SELECT nome FROM cadastro.contas WHERE id = $1', [
        d.contaId,
      ]);
      await repo.historico(pool, id, `Conta criada no sistema: ${rows[0]?.nome ?? d.contaId}.`, autor);
    }
    res.json(await repo.obter(pool, id));
  });

  /** Anotação no histórico (ligou, mandou proposta, etc.). */
  r.post('/pedidos/:id/notas', async (req, res) => {
    const id = idDaRota(req);
    const { texto } = corpo(req, pedidoNotaEntrada);
    const p = await repo.obter(pool, id);
    if (!p) throw AppError.naoEncontrado('Pedido');
    await repo.historico(pool, id, texto, req.usuario!.nome);
    await pool.query('UPDATE cadastro.pedidos_site SET atualizado_em = now() WHERE id = $1', [id]);
    res.status(201).json(await repo.obter(pool, id));
  });

  r.delete('/pedidos/:id', async (req, res) => {
    const { rowCount } = await pool.query('DELETE FROM cadastro.pedidos_site WHERE id = $1', [idDaRota(req)]);
    if (!rowCount) throw AppError.naoEncontrado('Pedido');
    res.status(204).end();
  });
  return r;
}
