import {
  AppError,
  conversoesEntrada,
  formularioInstagramEntrada,
  instagramConfigEntrada,
  regraInstagramEntrada,
} from '@prospeccao/shared';
import express, { type Request, type Response, Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { comConta, conta, contaSql, usuarioAtual } from '../../contexto.js';
import type { DepsApi } from '../../dependencias.js';
import { consulta, corpo, idDaRota } from '../../middlewares/http.js';
import { adminParaAlterar } from '../../middlewares/seguranca.js';
import { visivel } from '../../visibilidade.js';
import * as conteudo from './conteudo.js';
import * as conversoes from './conversoes.js';
import * as servico from './servico.js';

/**
 * Instagram: a tela (conexão, regras de "comente e receba", formulários dos anúncios) e o que a
 * Meta chama sem login (o retorno do login e o webhook).
 */

const AUDIENCIA = 'meta-login';

/** Onde a Meta devolve o login (cadastrado em "URIs de redirecionamento do OAuth" do app). */
export const enderecoDeRetorno = (origens: string[]) => `${origens[0]}/api/meta/retorno`;

/* ───────────────────────── Tela ───────────────────────── */

export function rotasInstagram(deps: DepsApi): Router {
  const { pool } = deps;
  const r = Router();
  // Ver: todos. Conectar, criar regra, mudar formulário: o administrador.
  r.use(adminParaAlterar);

  r.get('/', async (_req, res) => {
    await servico.atualizarPerfil(deps);
    res.json(await servico.situacao(pool));
  });

  /** Link do login na Meta (o navegador vai para lá e volta em /api/meta/retorno). */
  r.post('/conexao', async (req, res) => {
    const m = servico.meta();
    if (!m)
      throw AppError.invalido(
        'A integração com o Instagram ainda não foi liberada na plataforma. Fale com o suporte do Prospect Team.',
      );
    if (!deps.credenciais.chave)
      throw AppError.invalido('Configure CHAVE_CREDENCIAIS na api para guardar a conexão.');
    const origem = String(req.headers.origin ?? deps.origens[0]).replace(/\/$/, '');
    const estado = jwt.sign({ c: conta(), u: usuarioAtual()?.id ?? null, o: origem }, deps.auth.jwtSegredo, {
      audience: AUDIENCIA,
      expiresIn: '20m',
    });
    res.json({ url: m.urlDeLogin(enderecoDeRetorno(deps.origens), estado) });
  });

  r.post('/conexao/escolher', async (req, res) => {
    const { paginaId } = corpo(req, z.object({ paginaId: z.string().regex(/^\d+$/) }));
    await servico.escolherPagina(deps, paginaId);
    res.json(await servico.situacao(pool));
  });

  r.delete('/conexao', async (_req, res) => {
    await servico.desconectar(deps);
    res.json(await servico.situacao(pool));
  });

  r.put('/config', async (req, res) => {
    await servico.salvarDirectNovo(pool, corpo(req, instagramConfigEntrada).directNovo);
    res.json(await servico.situacao(pool));
  });

  /** Publicações recentes (para escolher na regra). */
  r.get('/publicacoes', async (_req, res) => {
    res.json(await servico.publicacoes(pool));
  });

  /* ───── Comente e receba ───── */

  r.get('/regras', async (req, res) => {
    const { dias } = consulta(req, z.object({ dias: z.coerce.number().int().min(1).max(365).default(30) }));
    res.json(await listarRegras(deps, dias));
  });

  r.get('/regras/:id', async (req, res) => {
    res.json(await abrirRegra(deps, idDaRota(req)));
  });

  r.post('/regras', async (req, res) => {
    const id = await salvarRegra(deps, corpo(req, regraInstagramEntrada));
    res.status(201).json(await abrirRegra(deps, id));
  });

  r.put('/regras/:id', async (req, res) => {
    const id = await salvarRegra(deps, corpo(req, regraInstagramEntrada), idDaRota(req));
    res.json(await abrirRegra(deps, id));
  });

  r.patch('/regras/:id', async (req, res) => {
    const { ligada } = corpo(req, z.object({ ligada: z.boolean() }));
    const { rowCount } = await pool.query(
      `UPDATE comercial.instagram_regras SET ligada = $2 WHERE id = $1 AND conta_id = ${contaSql()}`,
      [idDaRota(req), ligada],
    );
    if (!rowCount) throw AppError.naoEncontrado('Regra');
    res.json({ ok: true });
  });

  r.delete('/regras/:id', async (req, res) => {
    const { rowCount } = await pool.query(
      `DELETE FROM comercial.instagram_regras WHERE id = $1 AND conta_id = ${contaSql()}`,
      [idDaRota(req)],
    );
    if (!rowCount) throw AppError.naoEncontrado('Regra');
    res.json({ ok: true });
  });

  /** Quem comentou e não respondeu: vira lead à mão. */
  r.post('/interacoes/:id/lead', async (req, res) => {
    const empresaId = await servico.criarLeadDaInteracao(deps, idDaRota(req));
    res.status(201).json({ empresaId });
  });

  /* ───── Conteúdo (análise das publicações) ───── */

  r.get('/conteudo', async (req, res) => {
    const { dias, tipo } = consulta(
      req,
      z.object({
        dias: z.coerce.number().int().min(7).max(365).default(30),
        tipo: z.string().max(20).optional(),
      }),
    );
    // Abriu a tela: busca o que mudou se a última atualização tem mais de 6 h (sem travar a tela).
    await conteudo
      .atualizarConteudo(deps)
      .catch((e) => deps.log.warn({ err: e }, 'instagram: conteúdo não atualizou'));
    res.json(await conteudo.listarConteudo(pool, dias, tipo ?? null));
  });

  r.post('/conteudo/atualizar', async (_req, res) => {
    await conteudo.atualizarConteudo(deps, { forcar: true });
    res.json({ ok: true });
  });

  r.get('/conteudo/:midiaId', async (req, res) => {
    const midiaId = String(req.params.midiaId);
    if (!/^[\w-]{1,60}$/.test(midiaId)) throw AppError.naoEncontrado('Publicação');
    res.json(await conteudo.abrirPost(deps, midiaId));
  });

  const comentarioDaRota = (req: Request) => {
    const id = String(req.params.id);
    if (!/^[\w-]{1,60}$/.test(id)) throw AppError.naoEncontrado('Comentário');
    return id;
  };

  r.post('/comentarios/:id/responder', async (req, res) => {
    const { texto } = corpo(req, z.object({ texto: z.string().trim().min(1).max(1000) }));
    await conteudo.responderComentario(pool, comentarioDaRota(req), texto);
    res.json({ ok: true });
  });

  r.post('/comentarios/:id/direct', async (req, res) => {
    const { texto } = corpo(req, z.object({ texto: z.string().trim().min(1).max(1000) }));
    await conteudo.directDoComentario(pool, comentarioDaRota(req), texto);
    res.json({ ok: true });
  });

  r.post('/comentarios/:id/lead', async (req, res) => {
    res.status(201).json({ empresaId: await conteudo.leadDoComentario(deps, comentarioDaRota(req)) });
  });

  /* ───── Devolver as vendas para a Meta ───── */

  r.get('/conversoes', async (_req, res) => {
    res.json(await conversoes.situacaoConversoes(pool));
  });

  r.put('/conversoes', async (req, res) => {
    await conversoes.salvarConversoes(pool, corpo(req, conversoesEntrada));
    res.json(await conversoes.situacaoConversoes(pool));
  });

  r.post('/conversoes/testar', async (req, res) => {
    const { codigo } = corpo(
      req,
      z.object({
        codigo: z
          .string()
          .trim()
          .regex(/^TEST\w{2,20}$/i, 'O código de teste começa com TEST.'),
      }),
    );
    res.json(await conversoes.testarConversoes(pool, codigo));
  });

  /* ───── Formulários ───── */

  r.get('/formularios', async (req, res) => {
    const { dias } = consulta(req, z.object({ dias: z.coerce.number().int().min(1).max(365).default(30) }));
    res.json(await listarFormularios(deps, dias));
  });

  r.post('/formularios/sincronizar', async (req, res) => {
    const novos = await servico.sincronizarFormularios(pool);
    const { dias } = consulta(req, z.object({ dias: z.coerce.number().int().min(1).max(365).default(30) }));
    res.json({ novos, formularios: await listarFormularios(deps, dias) });
  });

  r.put('/formularios/:id', async (req, res) => {
    const d = corpo(req, formularioInstagramEntrada);
    await conferirDestino(deps, d.etapaId ?? null, d.responsavelId ?? null);
    const { rowCount } = await pool.query(
      `UPDATE comercial.instagram_formularios
          SET ligado = $2, perguntas = $3, etapa_id = $4, responsavel_id = $5, etiquetas = $6, boas_vindas = $7, avisar = $8
        WHERE id = $1 AND conta_id = ${contaSql()}`,
      [
        idDaRota(req),
        d.ligado,
        JSON.stringify(d.perguntas),
        d.etapaId ?? null,
        d.responsavelId ?? null,
        [...new Set(d.etiquetas)],
        d.boasVindas || null,
        d.avisar,
      ],
    );
    if (!rowCount) throw AppError.naoEncontrado('Formulário');
    res.json(await listarFormularios(deps, 30));
  });

  return r;
}

/** Etapa e responsável precisam ser desta conta. */
async function conferirDestino(deps: DepsApi, etapaId: number | null, responsavelId: number | null) {
  if (etapaId) {
    const { rows } = await deps.pool.query(
      `SELECT 1 FROM comercial.etapas WHERE id = $1 AND conta_id = ${contaSql()}`,
      [etapaId],
    );
    if (!rows.length) throw AppError.naoEncontrado('Etapa');
  }
  if (responsavelId) {
    const { rows } = await deps.pool.query(
      `SELECT 1 FROM cadastro.usuarios WHERE id = $1 AND conta_id = ${contaSql()} AND ativo`,
      [responsavelId],
    );
    if (!rows.length) throw AppError.naoEncontrado('Responsável');
  }
}

async function salvarRegra(
  deps: DepsApi,
  d: z.infer<typeof regraInstagramEntrada>,
  id?: number,
): Promise<number> {
  const { pool } = deps;
  await conferirDestino(deps, d.etapaId ?? null, d.responsavelId ?? null);
  const valores = [
    d.alvo,
    d.alvo === 'publicacao' ? d.midiaId : null,
    [...new Set(d.palavras.map((p) => p.trim()))],
    d.respostas,
    d.mensagem,
    d.botaoTexto || null,
    d.botaoLink || null,
    d.iaContinua,
    d.avisar,
    d.etapaId ?? null,
    d.responsavelId ?? null,
    [...new Set(d.etiquetas)],
    d.ligada,
  ];
  let regraId: number;
  if (id) {
    const { rows } = await pool.query<{ id: number; midia_id: string | null }>(
      `UPDATE comercial.instagram_regras SET alvo = $2,
              midia_id = CASE WHEN $2 = 'publicacao' THEN $3 ELSE NULL END,
              palavras = $4, respostas = $5, mensagem = $6, botao_texto = $7, botao_link = $8, ia_continua = $9,
              avisar = $10, etapa_id = $11, responsavel_id = $12, etiquetas = $13, ligada = $14
        WHERE id = $1 AND conta_id = ${contaSql()} RETURNING id::int, midia_id`,
      [id, ...valores],
    );
    if (!rows[0]) throw AppError.naoEncontrado('Regra');
    regraId = rows[0].id;
  } else {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO comercial.instagram_regras
         (conta_id, alvo, midia_id, palavras, respostas, mensagem, botao_texto, botao_link, ia_continua, avisar,
          etapa_id, responsavel_id, etiquetas, ligada, criado_por)
       VALUES (${contaSql()}, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id::int`,
      [...valores, usuarioAtual()?.id ?? null],
    );
    regraId = rows[0]!.id;
  }
  // A publicação escolhida: guarda legenda, capa e link (para a lista mostrar sem ir à Meta toda vez).
  if (d.alvo === 'publicacao' && d.midiaId) {
    const c = await servico.conexaoDaConta(pool);
    const m = servico.meta();
    const pub = c && m ? await m.publicacao(d.midiaId, c.token).catch(() => null) : null;
    if (pub) await servico.guardarPublicacao(pool, regraId, pub);
  } else
    await pool.query(
      `UPDATE comercial.instagram_regras SET midia_legenda = NULL, midia_tipo = NULL, midia_link = NULL,
              midia_imagem = NULL, midia_em = NULL
        WHERE id = $1 AND conta_id = ${contaSql()} AND midia_id IS NULL`,
      [regraId],
    );
  return regraId;
}

const COLUNAS_REGRA = `r.id::int, r.alvo, r.midia_id AS "midiaId", r.midia_legenda AS "midiaLegenda",
  r.midia_tipo AS "midiaTipo", r.midia_link AS "midiaLink", r.midia_imagem AS "midiaImagem", r.midia_em AS "midiaEm",
  r.palavras, r.respostas, r.mensagem, r.botao_texto AS "botaoTexto", r.botao_link AS "botaoLink",
  r.ia_continua AS "iaContinua", r.avisar, r.etapa_id AS "etapaId", r.responsavel_id AS "responsavelId",
  r.etiquetas, r.ligada, r.criado_em AS "criadoEm"`;

/** Números de um conjunto de interações (comentaram → direct → responderam → leads → reuniões). */
const numerosSql = (filtro: string) => `
  SELECT count(*)::int AS comentaram,
         count(*) FILTER (WHERE i.direct = 'enviado')::int AS receberam,
         count(*) FILTER (WHERE i.direct = 'fora_do_prazo')::int AS "foraDoPrazo",
         count(*) FILTER (WHERE i.direct = 'erro')::int AS erros,
         count(*) FILTER (WHERE i.respondeu_em IS NOT NULL)::int AS responderam,
         count(DISTINCT i.empresa_id)::int AS leads,
         count(DISTINCT i.empresa_id) FILTER (WHERE EXISTS (
           SELECT 1 FROM enriquecimento.contatos ct WHERE ct.empresa_id = i.empresa_id AND ${visivel('ct')}
              AND ct.canal IN ('whatsapp', 'telefone') AND ct.status <> 'invalido'))::int AS whatsapp,
         count(DISTINCT i.empresa_id) FILTER (WHERE o.etapa IN ('reuniao', 'proposta', 'ganho'))::int AS reunioes,
         count(DISTINCT i.empresa_id) FILTER (WHERE o.etapa = 'ganho')::int AS ganhos,
         coalesce(sum(DISTINCT o.valor_mensal) FILTER (WHERE o.etapa = 'ganho'), 0)::float AS "valorGanho"
    FROM comercial.instagram_interacoes i
    LEFT JOIN comercial.oportunidades o ON o.conta_id = i.conta_id AND o.empresa_id = i.empresa_id
   WHERE i.conta_id = ${contaSql()} AND ${filtro}`;

async function listarRegras(deps: DepsApi, dias: number) {
  const { pool } = deps;
  const desde = `i.comentado_em >= now() - interval '${Math.trunc(dias)} days'`;
  const { rows: regras } = await pool.query(
    `SELECT ${COLUNAS_REGRA}, n.*
       FROM comercial.instagram_regras r
       LEFT JOIN LATERAL (${numerosSql(`i.regra_id = r.id AND ${desde}`)}) n ON true
      WHERE r.conta_id = ${contaSql()}
      ORDER BY r.ligada DESC, r.criado_em DESC`,
  );
  const { rows: total } = await pool.query(numerosSql(desde));
  const { rows: pubs } = await pool.query<{ n: number }>(
    `SELECT count(DISTINCT midia_id)::int AS n FROM comercial.instagram_interacoes i
      WHERE i.conta_id = ${contaSql()} AND ${desde}`,
  );
  return { dias, total: { ...total[0], publicacoes: pubs[0]?.n ?? 0 }, regras };
}

async function abrirRegra(deps: DepsApi, id: number) {
  const { pool } = deps;
  const { rows } = await pool.query(
    `SELECT ${COLUNAS_REGRA}, n.* FROM comercial.instagram_regras r
       LEFT JOIN LATERAL (${numerosSql('i.regra_id = r.id')}) n ON true
      WHERE r.id = $1 AND r.conta_id = ${contaSql()}`,
    [id],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Regra');
  const { rows: pessoas } = await pool.query(
    `SELECT i.id::int, i.usuario, i.nome, i.comentario, i.comentado_em AS "comentadoEm", i.direct,
            i.direct_erro AS "directErro", i.resposta_publica AS "respostaPublica", i.respondeu_em AS "respondeuEm",
            i.empresa_id::int AS "empresaId", e.nome AS "leadNome", o.etapa, et.nome AS "etapaNome", et.cor AS "etapaCor",
            u.nome AS "responsavelNome", (o.agente AND o.agente_pausa IS NULL) AS "iaConduzindo",
            EXISTS (SELECT 1 FROM enriquecimento.contatos ct WHERE ct.empresa_id = i.empresa_id AND ${visivel('ct')}
                     AND ct.canal IN ('whatsapp', 'telefone') AND ct.status <> 'invalido') AS "temWhatsapp",
            (SELECT min(t.inicio) FROM comercial.tarefas t
              WHERE t.conta_id = i.conta_id AND t.empresa_id = i.empresa_id AND t.tipo = 'reuniao'
                AND t.concluida_em IS NULL AND t.inicio > now()) AS "reuniaoEm"
       FROM comercial.instagram_interacoes i
       LEFT JOIN comercial.oportunidades o ON o.conta_id = i.conta_id AND o.empresa_id = i.empresa_id
       LEFT JOIN descoberta.empresas e ON e.id = i.empresa_id
       LEFT JOIN comercial.etapas et ON et.id = o.etapa_id
       LEFT JOIN cadastro.usuarios u ON u.id = o.responsavel_id
      WHERE i.regra_id = $1 AND i.conta_id = ${contaSql()}
      ORDER BY i.comentado_em DESC
      LIMIT 500`,
    [id],
  );
  return { ...rows[0], pessoas };
}

async function listarFormularios(deps: DepsApi, dias: number) {
  const { rows } = await deps.pool.query(
    `SELECT f.id::int, f.form_id AS "formId", f.nome, f.perguntas, f.ligado, f.etapa_id AS "etapaId",
            f.responsavel_id AS "responsavelId", f.etiquetas, f.boas_vindas AS "boasVindas", f.avisar,
            n.cadastros, n.leads, n.atendidos, n.reunioes, n.anuncio, n.plataformas,
            u.nome AS "ultimoNome", u.empresa_id::int AS "ultimoEmpresaId", u.criado_em AS "ultimoEm", u.erro AS "ultimoErro",
            u.telefone AS "ultimoTelefone"
       FROM comercial.instagram_formularios f
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS cadastros, count(DISTINCT c.empresa_id)::int AS leads,
                count(DISTINCT c.empresa_id) FILTER (WHERE o.etapa NOT IN ('a_abordar'))::int AS atendidos,
                count(DISTINCT c.empresa_id) FILTER (WHERE o.etapa IN ('reuniao', 'proposta', 'ganho'))::int AS reunioes,
                (array_agg(c.anuncio ORDER BY c.criado_em DESC) FILTER (WHERE c.anuncio IS NOT NULL))[1] AS anuncio,
                array_remove(array_agg(DISTINCT c.plataforma), NULL) AS plataformas
           FROM comercial.instagram_cadastros c
           LEFT JOIN comercial.oportunidades o ON o.conta_id = c.conta_id AND o.empresa_id = c.empresa_id
          WHERE c.conta_id = f.conta_id AND c.form_id = f.form_id
            AND c.criado_em >= now() - interval '${Math.trunc(dias)} days') n ON true
       LEFT JOIN LATERAL (
         SELECT c.empresa_id, c.criado_em, c.erro, e.nome,
                (SELECT ct.valor FROM enriquecimento.contatos ct WHERE ct.empresa_id = c.empresa_id AND ${visivel('ct')}
                   AND ct.canal IN ('whatsapp', 'telefone') ORDER BY ct.principal DESC LIMIT 1) AS telefone
           FROM comercial.instagram_cadastros c LEFT JOIN descoberta.empresas e ON e.id = c.empresa_id
          WHERE c.conta_id = f.conta_id AND c.form_id = f.form_id
          ORDER BY c.criado_em DESC LIMIT 1) u ON true
      WHERE f.conta_id = ${contaSql()}
      ORDER BY f.ligado DESC, f.criado_em DESC`,
  );
  return rows;
}

/* ───────────────────────── O que a Meta chama (sem login) ───────────────────────── */

export function rotasMeta(deps: DepsApi): Router {
  const r = Router();

  /** Cadastro do webhook na Meta: devolve o desafio se a senha bate. */
  r.get('/webhook', (req: Request, res: Response) => {
    const m = servico.meta();
    const q = req.query as Record<string, string | undefined>;
    if (
      m?.tokenVerificacao &&
      q['hub.mode'] === 'subscribe' &&
      q['hub.verify_token'] === m.tokenVerificacao
    ) {
      res.type('text/plain').send(String(q['hub.challenge'] ?? ''));
      return;
    }
    res.sendStatus(403);
  });

  /** Avisos (comentários, direct, cadastros): assinados com o segredo do app. */
  r.post('/webhook', express.raw({ type: '*/*', limit: '2mb' }), async (req: Request, res: Response) => {
    const m = servico.meta();
    if (!m) {
      res.sendStatus(404);
      return;
    }
    const cru = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    if (!m.conferirAssinatura(cru, req.get('x-hub-signature-256'))) {
      res.sendStatus(401);
      return;
    }
    let aviso: unknown;
    try {
      aviso = JSON.parse(cru.toString('utf8'));
    } catch {
      res.sendStatus(400);
      return;
    }
    // Grava antes de responder (a Meta espera até 20 s); falha fica no log e a resposta é 200 (sem repetir sem fim).
    await servico
      .processarAviso(deps, aviso as Parameters<typeof servico.processarAviso>[1])
      .catch((e) => deps.log.error({ err: e }, 'instagram: aviso da Meta falhou'));
    res.sendStatus(200);
  });

  /** Volta do login: guarda a conexão e leva a pessoa de volta para a tela do Instagram. */
  r.get('/retorno', async (req: Request, res: Response) => {
    const q = req.query as Record<string, string | undefined>;
    let estado: { c: number; u: number | null; o: string };
    try {
      estado = jwt.verify(String(q.state ?? ''), deps.auth.jwtSegredo, {
        audience: AUDIENCIA,
      }) as typeof estado;
    } catch {
      res
        .status(400)
        .type('text/plain')
        .send('Link de conexão vencido. Volte ao sistema e clique em Conectar de novo.');
      return;
    }
    const volta = (params: Record<string, string>) =>
      res.redirect(`${estado.o}/instagram?${new URLSearchParams({ aba: 'conexao', ...params })}`);
    if (q.error || !q.code) return volta({ erro: q.error_description || 'A conexão foi cancelada na Meta.' });
    try {
      const r = await comConta(estado.c, () =>
        servico.concluirLogin(deps, String(q.code), enderecoDeRetorno(deps.origens), estado.u),
      );
      return volta(r === 'escolher' ? { escolher: '1' } : { conectado: '1' });
    } catch (e) {
      deps.log.warn({ err: e }, 'instagram: o login na Meta não concluiu');
      return volta({ erro: (e as Error).message.slice(0, 300) });
    }
  });

  return r;
}
