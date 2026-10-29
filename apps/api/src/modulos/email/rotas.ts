import {
  AppError,
  anexoEmailEntrada,
  CANAIS_SEQUENCIA,
  CLASSES_RESPOSTA,
  campanhaEmailAtualizar,
  campanhaEmailEntrada,
  configEmailEntrada,
  imagemEmailEntrada,
  marcaEmailEntrada,
  modeloEmailEntrada,
  montarMensagem,
  responderEmailEntrada,
} from '@prospeccao/shared';
import { Router } from 'express';
import { z } from 'zod';
import { travaDaBase } from '../../base.js';
import { conta, contaSql, empresaNaBase, empresaVisivel } from '../../contexto.js';
import type { DepsApi } from '../../dependencias.js';
import { urlPublicaApi } from '../../endereco.js';
import { consulta, corpo, idDaRota } from '../../middlewares/http.js';
import { exigirAdmin, exigirMaster } from '../../middlewares/seguranca.js';
import { visivel } from '../../visibilidade.js';
import { guardarMidia } from '../conversas/repositorio.js';
import { obterConfig as configCadencia } from '../funil/cadencia.js';
import * as motor from './motor.js';
import * as repo from './repositorio.js';

const NAO_CONFIGURADO =
  'O envio de e-mail ainda não está ativo nesta conta. Fale com o suporte do Prospect Team.';

const textoPrevia = z.object({
  assunto: z.string().max(200),
  corpo: z.string().max(20_000),
  marcaId: z.number().int().positive().nullable().optional(),
  empresaId: z.number().int().positive().nullable().optional(),
  campanhaId: z.number().int().positive().nullable().optional(),
  instrucoesIa: z.string().max(3000).optional(),
  personalizarIa: z.boolean().optional(),
  anexos: z.array(z.number().int().positive()).max(5).optional(),
});

export function rotasEmail(deps: DepsApi): Router {
  const { pool } = deps;
  const r = Router();
  r.param('empresaId', travaDaBase(pool));

  const servicos = () => deps.servicos(conta());
  const contextoPrevia = async () => {
    const s = await servicos();
    return {
      origens: deps.origens,
      remetenteConta: s.email?.remetente ?? null,
      personalizar: s.personalizarAbertura,
    };
  };

  /** Visão geral: configuração, o que está conectado no Resend e os números do dia. */
  r.get('/', async (req, res) => {
    const master = !!req.usuario?.master;
    const [config, resumo, s, token] = await Promise.all([
      repo.obterConfig(pool),
      repo.resumo(pool),
      servicos(),
      pool.query<{ webhook_token: string }>(
        `SELECT webhook_token FROM cadastro.contas WHERE id = ${contaSql()}`,
      ),
    ]);
    res.json({
      config,
      resumo,
      status: {
        resend: !!s.email,
        remetente: s.email?.remetente ?? null,
        dominioRespostas: s.email?.dominioRespostas ?? null,
        webhook: !!s.email?.segredoWebhook,
        // Endereço para colar no Resend da conta (Webhooks → Add endpoint).
        // Endereço (com a senha embutida) e o que é técnico: só para o master.
        webhookUrl: master
          ? `${urlPublicaApi(deps.origens)}/e/resend/${token.rows[0]?.webhook_token ?? ''}`
          : '',
        ia: !!s.personalizarAbertura,
        iaDescricao: master ? s.iaDescricao : null,
        origem: s.origem.resend,
      },
    });
  });

  r.put('/config', exigirAdmin, async (req, res) => {
    await repo.salvarConfig(pool, corpo(req, configEmailEntrada));
    res.json(await repo.obterConfig(pool));
  });

  /** Confere a chave do Resend e o domínio do remetente. */
  r.post('/verificar', exigirMaster, async (_req, res) => {
    const { email } = await servicos();
    if (!email) throw AppError.invalido(NAO_CONFIGURADO);
    let resend: string;
    try {
      resend = (await email.verificar?.()) ?? 'ok';
    } catch (erro) {
      resend = erro instanceof Error ? erro.message : String(erro);
    }
    const cfg = await repo.obterConfig(pool);
    res.json({
      resend,
      respostas: email.dominioRespostas
        ? email.segredoWebhook
          ? cfg.webhookEm
            ? `ok (último aviso do Resend ${new Date(cfg.webhookEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })})`
            : 'configurado; nenhum aviso do Resend chegou ainda (confira o webhook no Resend)'
          : 'falta o segredo do webhook (painel master)'
        : 'falta o domínio de respostas (painel master)',
    });
  });

  /* Identidade visual (white label) */
  r.get('/marcas', async (_req, res) => {
    res.json(await repo.listarMarcas(pool, deps.origens));
  });
  r.post('/marcas', exigirAdmin, async (req, res) => {
    const id = await repo.salvarMarca(pool, corpo(req, marcaEmailEntrada));
    res.status(201).json({ id, marcas: await repo.listarMarcas(pool, deps.origens) });
  });
  r.put('/marcas/:id', exigirAdmin, async (req, res) => {
    const id = await repo.salvarMarca(pool, corpo(req, marcaEmailEntrada), idDaRota(req));
    res.json({ id, marcas: await repo.listarMarcas(pool, deps.origens) });
  });
  r.delete('/marcas/:id', exigirAdmin, async (req, res) => {
    await repo.apagarMarca(pool, idDaRota(req));
    res.json(await repo.listarMarcas(pool, deps.origens));
  });

  /** Logo ou capa: fica num endereço público (o e-mail do lead precisa abrir a imagem). */
  r.post('/imagens', exigirAdmin, async (req, res) => {
    const d = corpo(req, imagemEmailEntrada);
    const { id, token } = await repo.guardarImagem(pool, d);
    res.status(201).json({ id, url: repo.urlImagem(deps.origens, token) });
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

  /** Leads para escolher na prévia (os que a campanha alcança, com e-mail primeiro). */
  r.get('/leads', async (req, res) => {
    const f = consulta(
      req,
      z.object({
        campanhaId: z.coerce.number().int().positive().optional(),
        busca: z.string().trim().max(120).optional(),
      }),
    );
    const { rows } = await pool.query(
      `SELECT e.id::int AS "empresaId", e.nome, e.cidade,
              (SELECT c.valor FROM enriquecimento.contatos c
                WHERE c.empresa_id = e.id AND c.canal = 'email' AND c.status <> 'invalido' AND ${visivel('c')}
                ORDER BY c.principal DESC, c.confianca DESC LIMIT 1) AS email
         FROM descoberta.empresas e
        WHERE EXISTS (SELECT 1 FROM descoberta.campanha_empresas ce
                       WHERE ce.empresa_id = e.id AND ce.conta_id = ${contaSql()} AND ce.liberado_em IS NOT NULL
                         AND ($1::bigint IS NULL OR ce.campanha_id = $1))
          AND ($2::text IS NULL OR e.nome ILIKE $2 OR e.razao_social ILIKE $2)
          AND ${empresaVisivel('e.id')}
        ORDER BY (EXISTS (SELECT 1 FROM enriquecimento.contatos c WHERE c.empresa_id = e.id AND c.canal = 'email'
                           AND c.status <> 'invalido' AND ${visivel('c')})) DESC, e.nome
        LIMIT 20`,
      [f.campanhaId ?? null, f.busca ? `%${f.busca}%` : null],
    );
    res.json(rows);
  });

  /** Prévia real: o e-mail como o lead vai ver (marca, lead de verdade, abertura da IA). */
  r.post('/previa', async (req, res) => {
    const d = corpo(req, textoPrevia);
    res.json(await repo.previa(pool, { ...d, marcaId: d.marcaId ?? null }, await contextoPrevia()));
  });

  async function enviarTeste(
    p: Awaited<ReturnType<typeof repo.previa>>,
    marcaId: number | null,
    para: string,
    anexos: number[],
  ) {
    const { email } = await servicos();
    if (!email) throw AppError.invalido(NAO_CONFIGURADO);
    const marca = await repo.obterMarca(pool, marcaId, deps.origens);
    await email.enviar({
      de: motor.remetenteDa(email, marca),
      para,
      responderPara: motor.enderecoDeResposta(email, marca, null),
      assunto: `[TESTE] ${p.assunto}`,
      html: p.html,
      texto: p.texto,
      anexos: await repo.anexosDoModelo(pool, anexos),
    });
  }

  /** Envia para você (ou outro endereço) ver na caixa de entrada de verdade. */
  r.post('/teste', exigirAdmin, async (req, res) => {
    const d = corpo(
      req,
      textoPrevia.extend({
        assunto: z.string().trim().min(1).max(200),
        corpo: z.string().trim().min(1).max(20_000),
        anexos: z.array(z.number().int().positive()).max(5).default([]),
        para: z.string().trim().toLowerCase().email('E-mail inválido.'),
      }),
    );
    const p = await repo.previa(pool, { ...d, marcaId: d.marcaId ?? null }, await contextoPrevia());
    await enviarTeste(p, d.marcaId ?? null, d.para, d.anexos);
    res.json({ ok: true, abertura: p.abertura });
  });

  /* Campanhas de e-mail */
  r.get('/campanhas', async (_req, res) => {
    res.json(await repo.listarCampanhas(pool));
  });

  /** Quantos leads vão receber (antes de criar). */
  r.post('/campanhas/estimar', async (req, res) => {
    const d = corpo(
      req,
      campanhaEmailEntrada
        .pick({
          campanhaId: true,
          faixas: true,
          pularNoFunil: true,
          incluirContador: true,
        })
        .extend({ canais: z.array(z.enum(CANAIS_SEQUENCIA)).max(3).optional() }),
    );
    const e = await repo.elegiveis(pool, { ...d, canais: new Set(d.canais?.length ? d.canais : ['email']) });
    res.json({
      leads: e.leads,
      comEmail: e.comEmail,
      comWhatsapp: e.comWhatsapp,
      elegiveis: e.elegiveis.length,
      exemplos: e.elegiveis.slice(0, 8),
    });
  });

  r.post('/campanhas', exigirAdmin, async (req, res) => {
    const id = await repo.criarCampanha(pool, corpo(req, campanhaEmailEntrada));
    res.status(201).json({ id });
  });
  r.patch('/campanhas/:id', exigirAdmin, async (req, res) => {
    await repo.atualizarCampanha(pool, idDaRota(req), corpo(req, campanhaEmailAtualizar));
    res.json({ ok: true });
  });

  /** Prévia de um passo da campanha (com a marca, as instruções e a IA dela), para um lead. */
  const previaDaCampanha = z.object({
    passo: z.number().int().min(1).max(6).default(1),
    empresaId: z.number().int().positive().nullable().optional(),
  });
  /** Passo de WhatsApp ou ligação: o texto pronto para o lead (sem marca, é mensagem). */
  async function previaDeTexto(
    c: repo.CampanhaEmailRow,
    p: { canal?: string; texto?: string },
    empresaId: number | null | undefined,
  ) {
    const lead = await repo.leadDaPrevia(pool, { empresaId, campanhaId: c.campanhaId });
    const cad = await configCadencia(pool);
    const v = lead
      ? await repo.variaveisDoLead(pool, lead, cad.remetente)
      : {
          nome: repo.LEAD_INVENTADO.contato,
          empresa: repo.LEAD_INVENTADO.empresa,
          cidade: repo.LEAD_INVENTADO.cidade,
          remetente: cad.remetente,
        };
    return {
      canal: p.canal,
      texto: montarMensagem(p.texto ?? '', v),
      lead: { empresaId: lead, empresa: v.empresa, contato: v.nome ?? null, cidade: v.cidade ?? null },
    };
  }

  async function previaDoPasso(id: number, passo: number, empresaId: number | null | undefined) {
    const c = await repo.obterCampanhaRow(pool, id);
    const p = c.passos[passo - 1];
    if (!p) throw AppError.naoEncontrado('Passo da sequência');
    if ((p.canal ?? 'email') !== 'email' || !p.modeloId)
      return { campanha: c, modelo: null, previa: null, texto: await previaDeTexto(c, p, empresaId) };
    const modelo = await repo.obterModelo(pool, p.modeloId);
    return {
      campanha: c,
      modelo,
      previa: await repo.previa(
        pool,
        {
          assunto: modelo.assunto,
          corpo: modelo.corpo,
          marcaId: c.marcaId,
          empresaId,
          campanhaId: c.campanhaId,
          instrucoesIa: c.instrucoesIa,
          personalizarIa: c.personalizarIa,
          anexos: modelo.anexos,
        },
        await contextoPrevia(),
      ),
      texto: null,
    };
  }
  r.post('/campanhas/:id/previa', async (req, res) => {
    const d = corpo(req, previaDaCampanha);
    const p = await previaDoPasso(idDaRota(req), d.passo, d.empresaId);
    res.json(p.previa ? { canal: 'email', ...p.previa } : p.texto);
  });
  r.post('/campanhas/:id/teste', exigirAdmin, async (req, res) => {
    const d = corpo(
      req,
      previaDaCampanha.extend({ para: z.string().trim().toLowerCase().email('E-mail inválido.') }),
    );
    const { campanha, modelo, previa } = await previaDoPasso(idDaRota(req), d.passo, d.empresaId);
    if (!previa || !modelo) throw AppError.invalido('O teste por e-mail é só para os passos de e-mail.');
    await enviarTeste(previa, campanha.marcaId, d.para, modelo.anexos);
    res.json({ ok: true, abertura: previa.abertura });
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
      `UPDATE comercial.respostas_email SET lida_em = coalesce(lida_em, now())
        WHERE id = $1 AND conta_id = ${contaSql()} AND ${empresaNaBase('comercial.respostas_email.empresa_id')}`,
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
        WHERE id = $1 AND conta_id = ${contaSql()} AND ${empresaNaBase('comercial.respostas_email.empresa_id')}
        RETURNING id::int, empresa_id::int AS "empresaId", de_email AS "deEmail", texto, resumo, classe`,
      [id, classe],
    );
    const resp = rows[0];
    if (!resp) throw AppError.naoEncontrado('Resposta');
    await motor.agirPelaResposta(deps, { ...resp, classe });
    res.json({ ok: true });
  });

  r.post('/respostas/:id/responder', async (req, res) => {
    const { rowCount } = await pool.query(
      `SELECT 1 FROM comercial.respostas_email WHERE id = $1 AND conta_id = ${contaSql()} AND ${empresaNaBase('comercial.respostas_email.empresa_id')}`,
      [idDaRota(req)],
    );
    if (!rowCount) throw AppError.naoEncontrado('Resposta');
    await motor.responder(
      await motor.depsDaConta(deps),
      idDaRota(req),
      corpo(req, responderEmailEntrada).texto,
    );
    res.json({ ok: true });
  });

  /** E-mails de um lead (ficha). */
  r.get('/lead/:empresaId', async (req, res) => {
    res.json(await repo.doLead(pool, idDaRota(req, 'empresaId')));
  });

  return r;
}
