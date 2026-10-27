import { createHash } from 'node:crypto';
import {
  AppError,
  configSiteEntrada,
  formatarTelefone,
  normalizarTelefone,
  pedidoSiteEntrada,
  pedidoSiteStatusEntrada,
  whatsappComDdi,
} from '@prospeccao/shared';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { comConta } from '../../contexto.js';
import type { DepsApi } from '../../dependencias.js';
import { corpo, idDaRota } from '../../middlewares/http.js';
import { criarLeadManual, LeadExistente } from '../funil/novoLead.js';
import { registrarAtividade } from '../funil/repositorio.js';
import { notificar, notificarDono } from '../notificacoes/repositorio.js';
import * as repo from './repositorio.js';

/** Quem preenche o formulário do site: o lead entra no funil da conta principal com esta origem. */
const AUTOR = 'Site (pedido de demonstração)';

/**
 * Rotas públicas do site institucional (sem login, chamadas pelo próprio site via /api do Vercel):
 * o contato comercial a mostrar e o pedido de demonstração, que vira lead no funil do master.
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
    const id = await repo.gravarPedido(pool, {
      nome: d.nome,
      empresa: d.empresa,
      whatsapp: telefone,
      email: d.email || null,
      nicho: d.nicho || null,
      plano,
      canal: d.canal,
      ipHash,
    });
    log.info({ pedido: id, canal: d.canal }, 'site: pedido de demonstração');

    // Vira lead no funil da conta principal. Se não der (conta sem nicho, etc.), o pedido fica
    // registrado no painel master do mesmo jeito.
    const contaId = await repo.contaPrincipal(pool);
    if (contaId) {
      const observacao = [
        'Pedido de demonstração pelo site.',
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
      await comConta(contaId, async () => {
        let empresaId: number | null = null;
        let erro: string | null = null;
        try {
          const lead = await criarLeadManual(
            deps,
            {
              empresa: d.empresa,
              contato: d.nome,
              cargo: null,
              telefone,
              whatsapp: true,
              email: d.email || null,
              cnpj: null,
              cidade: null,
              uf: null,
              site: null,
              instagram: null,
              observacao,
              etapaId: null,
              responsavelId: null,
              agente: false,
              enriquecer: false,
              telefoneConversa: null,
            },
            AUTOR,
          );
          empresaId = lead.empresaId;
        } catch (e) {
          if (e instanceof LeadExistente) {
            empresaId = (e.detalhes as { empresaId: number }).empresaId;
            await registrarAtividade(
              pool,
              empresaId,
              { tipo: 'nota', direcao: null, texto: observacao },
              AUTOR,
            );
          } else {
            erro = e instanceof Error ? e.message.slice(0, 300) : String(e);
            log.warn({ pedido: id, erro }, 'site: pedido sem lead no funil');
          }
        }
        await repo.ligarLead(pool, id, empresaId, erro);
        const aviso = {
          tipo: 'sistema' as const,
          titulo: `Pedido de demonstração: ${d.empresa}`,
          texto: `${d.nome} · ${formatarTelefone(telefone)}${plano ? ` · ${plano}` : ''}`,
        };
        if (empresaId) await notificarDono(pool, empresaId, aviso);
        else {
          const { rows } = await pool.query<{ id: number }>(
            'SELECT id FROM cadastro.usuarios WHERE conta_id = $1 AND (master OR papel = $2) AND ativo',
            [contaId, 'admin'],
          );
          for (const u of rows) await notificar(pool, u.id, { ...aviso, link: '/master?pedidos=1' });
        }
      }).catch((e: unknown) =>
        log.error({ pedido: id, erro: (e as Error).message }, 'site: aviso do pedido'),
      );
    }
    res.json({ ok: true });
  });

  return r;
}

/** Painel master: pedidos que chegaram pelo site e o contato comercial que ele mostra. */
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
  r.patch('/pedidos/:id', async (req, res) => {
    const { status } = corpo(req, pedidoSiteStatusEntrada);
    if (!(await repo.mudarStatus(pool, idDaRota(req), status))) throw AppError.naoEncontrado('Pedido');
    res.json({ ok: true });
  });
  return r;
}
