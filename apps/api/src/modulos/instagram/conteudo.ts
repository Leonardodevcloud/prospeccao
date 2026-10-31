import type { Executor, Pool } from '@prospeccao/db';
import {
  AppError,
  achadosDoConteudo,
  comNome,
  type Logger,
  PRAZO_RESPOSTA_PRIVADA_DIAS,
  type PublicacaoNumeros,
} from '@prospeccao/shared';
import { conta, contaSql, usuarioAtual } from '../../contexto.js';
import { paraCadaConta } from '../../rotinas.js';
import * as funil from '../funil/repositorio.js';
import { ErroMeta } from './meta.js';
import {
  conexaoDaConta,
  criarLead,
  type DepsLead,
  guardarComentario,
  leadDoInstagram,
  meta,
  registrarErroDaMeta,
} from './servico.js';

/**
 * Análise do conteúdo: as publicações com os números do Instagram (alcance, curtidas, salvos…) ao
 * lado do que só o CRM sabe (leads, reuniões e vendas de cada post), os achados do período e todos
 * os comentários de cada publicação.
 */

/** Uma atualização por conta de cada vez. */
const atualizando = new Set<number>();

/** Busca as publicações e os números na Meta (a cada 6 h, ou na hora com `forcar`). */
export async function atualizarConteudo(
  deps: { pool: Pool; log: Logger },
  opcoes: { forcar?: boolean } = {},
): Promise<void> {
  const m = meta();
  const c = await conexaoDaConta(deps.pool);
  if (!m || !c) return;
  const contaId = conta();
  if (atualizando.has(contaId)) return;
  if (!opcoes.forcar) {
    const { rows } = await deps.pool.query(
      `SELECT 1 FROM comercial.instagram_contas
        WHERE conta_id = ${contaSql()} AND conteudo_em > now() - interval '6 hours'`,
    );
    if (rows.length) return;
  }
  atualizando.add(contaId);
  try {
    const pubs = await m.publicacoes(c.igId, c.token, 60);
    let semPermissao: string | null = null;
    for (const p of pubs) {
      await deps.pool.query(
        `INSERT INTO comercial.instagram_midias (conta_id, midia_id, legenda, tipo, link, imagem, publicado_em, comentarios)
         VALUES (${contaSql()}, $1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (conta_id, midia_id) DO UPDATE SET legenda = EXCLUDED.legenda, tipo = EXCLUDED.tipo,
           link = EXCLUDED.link, imagem = coalesce(EXCLUDED.imagem, instagram_midias.imagem),
           publicado_em = EXCLUDED.publicado_em,
           comentarios = coalesce(instagram_midias.comentarios, EXCLUDED.comentarios)`,
        [p.id, p.legenda?.slice(0, 2200) ?? null, p.tipo, p.link, p.imagem, p.em, p.comentarios],
      );
      if (semPermissao) continue;
      // Post com mais de 90 dias: os números quase não mudam (atualiza uma vez por semana).
      const { rows: recente } = await deps.pool.query(
        `SELECT 1 FROM comercial.instagram_midias
          WHERE conta_id = ${contaSql()} AND midia_id = $1
            AND (numeros_em IS NULL OR publicado_em > now() - interval '90 days' OR numeros_em < now() - interval '7 days')`,
        [p.id],
      );
      if (!recente.length && !opcoes.forcar) continue;
      try {
        const n = await m.numeros(p.id, p.tipo, c.token);
        await deps.pool.query(
          `UPDATE comercial.instagram_midias
              SET alcance = $2, visualizacoes = $3, curtidas = $4, comentarios = coalesce($5, comentarios), salvos = $6,
                  compartilhamentos = $7, visitas_perfil = $8, seguiram = $9, interacoes = $10, numeros_em = now()
            WHERE conta_id = ${contaSql()} AND midia_id = $1`,
          [
            p.id,
            n.alcance,
            n.visualizacoes,
            n.curtidas,
            n.comentarios,
            n.salvos,
            n.compartilhamentos,
            n.visitasPerfil,
            n.seguiram,
            n.interacoes,
          ],
        );
      } catch (e) {
        if (e instanceof ErroMeta && (e.semPermissao || e.tokenInvalido)) {
          semPermissao = e.tokenInvalido
            ? 'A Meta não aceita mais o acesso: conecte de novo.'
            : 'Falta a permissão das estatísticas: clique em Reconectar (aba Conexão) e aceite o que a Meta pedir.';
          await registrarErroDaMeta(deps.pool, e);
        } else deps.log.warn({ err: e, midia: p.id }, 'instagram: números da publicação não vieram');
      }
    }
    await deps.pool.query(
      `UPDATE comercial.instagram_contas SET conteudo_em = now(), estatisticas_erro = $1 WHERE conta_id = ${contaSql()}`,
      [semPermissao],
    );
  } catch (e) {
    await registrarErroDaMeta(deps.pool, e);
    throw e;
  } finally {
    atualizando.delete(contaId);
  }
}

/** Leads de cada publicação: quem veio de um comentário, de uma regra ou de um direct dela. */
const leadsDosPosts = () => `
  SELECT DISTINCT x.midia_id, x.empresa_id FROM (
    SELECT midia_id, empresa_id FROM comercial.instagram_interacoes WHERE conta_id = ${contaSql()} AND empresa_id IS NOT NULL
    UNION
    SELECT midia_id, empresa_id FROM comercial.instagram_comentarios WHERE conta_id = ${contaSql()} AND empresa_id IS NOT NULL
    UNION
    SELECT origem_instagram->>'midiaId', empresa_id FROM comercial.oportunidades
     WHERE conta_id = ${contaSql()} AND origem_instagram->>'midiaId' IS NOT NULL) x`;

const TIPOS = ['REELS', 'CAROUSEL_ALBUM', 'IMAGE', 'VIDEO'] as const;

export async function listarConteudo(db: Executor, dias: number, tipo: string | null) {
  const d = Math.trunc(dias);
  const filtroTipo = tipo && (TIPOS as readonly string[]).includes(tipo) ? tipo : null;
  const { rows: posts } = await db.query<
    PublicacaoNumeros & {
      link: string | null;
      imagem: string | null;
      publicadoEm: string | null;
      visualizacoes: number | null;
      curtidas: number | null;
      comentarios: number | null;
      salvos: number | null;
      compartilhamentos: number | null;
      interacoes: number | null;
      regraId: number | null;
    }
  >(
    `WITH lp AS (${leadsDosPosts()})
     SELECT m.midia_id AS "midiaId", m.legenda, m.tipo, m.link, m.imagem, m.publicado_em AS "publicadoEm",
            m.alcance, m.visualizacoes, m.curtidas, m.comentarios, m.salvos, m.compartilhamentos, m.interacoes,
            coalesce(n.leads, 0) AS leads, coalesce(n.reunioes, 0) AS reunioes, coalesce(n.vendas, 0) AS vendas,
            coalesce(n.valor, 0)::float AS "valorVendas",
            (SELECT count(*)::int FROM comercial.instagram_comentarios ic
              WHERE ic.conta_id = m.conta_id AND ic.midia_id = m.midia_id AND ic.interesse IS NOT NULL
                AND ic.empresa_id IS NULL) AS interesse,
            (SELECT r.id::int FROM comercial.instagram_regras r
              WHERE r.conta_id = m.conta_id AND r.midia_id = m.midia_id ORDER BY r.ligada DESC, r.id LIMIT 1) AS "regraId"
       FROM comercial.instagram_midias m
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS leads,
                count(*) FILTER (WHERE o.etapa IN ('reuniao', 'proposta', 'ganho'))::int AS reunioes,
                count(*) FILTER (WHERE o.etapa = 'ganho')::int AS vendas,
                sum(o.valor_mensal) FILTER (WHERE o.etapa = 'ganho') AS valor
           FROM lp JOIN comercial.oportunidades o ON o.conta_id = m.conta_id AND o.empresa_id = lp.empresa_id
          WHERE lp.midia_id = m.midia_id) n ON true
      WHERE m.conta_id = ${contaSql()} AND m.publicado_em >= now() - interval '${d} days'
        AND ($1::text IS NULL OR m.tipo = $1)
      ORDER BY leads DESC, m.alcance DESC NULLS LAST, m.publicado_em DESC`,
    [filtroTipo],
  );
  const { rows: tot } = await db.query<{
    alcance_antes: number | null;
    leads: number;
    leads_comentario: number;
    leads_direct: number;
    reunioes: number;
    vendas: number;
    valor: number;
  }>(
    `SELECT (SELECT sum(alcance)::int FROM comercial.instagram_midias
              WHERE conta_id = ${contaSql()} AND ($1::text IS NULL OR tipo = $1)
                AND publicado_em >= now() - interval '${d * 2} days' AND publicado_em < now() - interval '${d} days') AS alcance_antes,
            count(*)::int AS leads,
            count(*) FILTER (WHERE o.origem_instagram->>'tipo' = 'comentario')::int AS leads_comentario,
            count(*) FILTER (WHERE o.origem_instagram->>'tipo' = 'direct')::int AS leads_direct,
            count(*) FILTER (WHERE o.etapa IN ('reuniao', 'proposta', 'ganho'))::int AS reunioes,
            count(*) FILTER (WHERE o.etapa = 'ganho')::int AS vendas,
            coalesce(sum(o.valor_mensal) FILTER (WHERE o.etapa = 'ganho'), 0)::float AS valor
       FROM comercial.oportunidades o
      WHERE o.conta_id = ${contaSql()} AND o.origem_instagram->>'tipo' IN ('comentario', 'direct')
        AND o.criado_em >= now() - interval '${d} days'`,
    [filtroTipo],
  );
  const { rows: info } = await db.query<{
    em: string | null;
    erro: string | null;
    contagem: Record<string, number>;
  }>(
    `SELECT ic.conteudo_em AS em, ic.estatisticas_erro AS erro,
            (SELECT coalesce(jsonb_object_agg(tipo, n), '{}') FROM (
               SELECT tipo, count(*)::int AS n FROM comercial.instagram_midias
                WHERE conta_id = ${contaSql()} AND publicado_em >= now() - interval '${d} days' GROUP BY tipo) t) AS contagem
       FROM comercial.instagram_contas ic WHERE ic.conta_id = ${contaSql()}`,
  );
  const soma = (k: 'alcance' | 'interacoes') => posts.reduce((s, p) => s + (p[k] ?? 0), 0);
  const t = tot[0]!;
  return {
    dias: d,
    atualizadoEm: info[0]?.em ?? null,
    estatisticasErro: info[0]?.erro ?? null,
    formatos: info[0]?.contagem ?? {},
    total: {
      alcance: posts.some((p) => p.alcance != null) ? soma('alcance') : null,
      alcanceAntes: t.alcance_antes,
      interacoes: posts.some((p) => p.interacoes != null) ? soma('interacoes') : null,
      leads: t.leads,
      leadsComentario: t.leads_comentario,
      leadsDirect: t.leads_direct,
      reunioes: t.reunioes,
      vendas: t.vendas,
      valorVendas: t.valor,
    },
    achados: achadosDoConteudo(posts),
    posts,
  };
}

/** Uma publicação aberta: números, o funil até a venda e os comentários (busca os novos na Meta). */
export async function abrirPost(deps: { pool: Pool; log: Logger }, midiaId: string) {
  const { pool } = deps;
  const { rows } = await pool.query(
    `SELECT midia_id AS "midiaId", legenda, tipo, link, imagem, publicado_em AS "publicadoEm", alcance, visualizacoes,
            curtidas, comentarios, salvos, compartilhamentos, visitas_perfil AS "visitasPerfil", seguiram, interacoes,
            numeros_em AS "numerosEm", comentarios_em AS "comentariosEm",
            (SELECT r.id::int FROM comercial.instagram_regras r
              WHERE r.conta_id = m.conta_id AND r.midia_id = m.midia_id ORDER BY r.ligada DESC, r.id LIMIT 1) AS "regraId"
       FROM comercial.instagram_midias m WHERE conta_id = ${contaSql()} AND midia_id = $1`,
    [midiaId],
  );
  const post = rows[0] as Record<string, unknown> | undefined;
  if (!post) throw AppError.naoEncontrado('Publicação');
  // Comentários novos (no máximo a cada 10 minutos por post).
  const recente =
    post.comentariosEm && Date.now() - new Date(post.comentariosEm as string).getTime() < 10 * 60_000;
  const m = meta();
  const c = await conexaoDaConta(pool);
  if (!recente && m && c) {
    try {
      for (const x of await m.comentarios(midiaId, c.token, 300))
        await guardarComentario(pool, {
          comentarioId: x.id,
          midiaId,
          pessoaId: x.pessoaId,
          usuario: x.usuario,
          texto: x.texto,
          em: x.em ? new Date(x.em) : new Date(),
        });
      await pool.query(
        `UPDATE comercial.instagram_midias SET comentarios_em = now() WHERE conta_id = ${contaSql()} AND midia_id = $1`,
        [midiaId],
      );
    } catch (e) {
      await registrarErroDaMeta(pool, e);
      deps.log.warn({ err: e, midia: midiaId }, 'instagram: comentários da publicação não vieram');
    }
  }
  const { rows: funilRows } = await pool.query<{
    leads: number;
    reunioes: number;
    vendas: number;
    valor: number;
    clientes: string[] | null;
    comentaram: number;
  }>(
    `WITH lp AS (${leadsDosPosts()})
     SELECT count(*)::int AS leads,
            count(*) FILTER (WHERE o.etapa IN ('reuniao', 'proposta', 'ganho'))::int AS reunioes,
            count(*) FILTER (WHERE o.etapa = 'ganho')::int AS vendas,
            coalesce(sum(o.valor_mensal) FILTER (WHERE o.etapa = 'ganho'), 0)::float AS valor,
            array_agg(e.nome ORDER BY e.nome) FILTER (WHERE o.etapa = 'ganho') AS clientes,
            (SELECT count(DISTINCT coalesce(pessoa_id, comentario_id))::int FROM comercial.instagram_comentarios
              WHERE conta_id = ${contaSql()} AND midia_id = $1) AS comentaram
       FROM lp JOIN comercial.oportunidades o ON o.conta_id = ${contaSql()} AND o.empresa_id = lp.empresa_id
       JOIN descoberta.empresas e ON e.id = o.empresa_id
      WHERE lp.midia_id = $1`,
    [midiaId],
  );
  const { rows: comentarios } = await pool.query(
    `SELECT ic.comentario_id AS id, ic.usuario, ic.texto, ic.comentado_em AS "comentadoEm", ic.interesse,
            ic.respondido_em AS "respondidoEm", ic.resposta, ic.direct_em AS "directEm",
            coalesce(ic.empresa_id, o.empresa_id)::int AS "empresaId", o.etapa, et.nome AS "etapaNome",
            et.cor AS "etapaCor"
       FROM comercial.instagram_comentarios ic
       LEFT JOIN comercial.oportunidades o ON o.conta_id = ic.conta_id
             AND (o.empresa_id = ic.empresa_id OR (ic.empresa_id IS NULL AND ic.pessoa_id IS NOT NULL AND o.instagram_id = ic.pessoa_id))
       LEFT JOIN comercial.etapas et ON et.id = o.etapa_id
      WHERE ic.conta_id = ${contaSql()} AND ic.midia_id = $1
      ORDER BY (ic.interesse IS NOT NULL AND o.empresa_id IS NULL) DESC, ic.comentado_em DESC
      LIMIT 500`,
    [midiaId],
  );
  return { ...post, funil: funilRows[0], listaComentarios: comentarios };
}

/* ───── Ações num comentário ───── */

interface LinhaComentario {
  comentario_id: string;
  midia_id: string;
  pessoa_id: string | null;
  usuario: string | null;
  texto: string;
  comentado_em: Date;
  direct_em: Date | null;
  empresa_id: number | null;
}

async function comentario(db: Executor, id: string): Promise<LinhaComentario> {
  const { rows } = await db.query<LinhaComentario>(
    `SELECT comentario_id, midia_id, pessoa_id, usuario, texto, comentado_em, direct_em, empresa_id::int
       FROM comercial.instagram_comentarios WHERE conta_id = ${contaSql()} AND comentario_id = $1`,
    [id],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Comentário');
  return rows[0];
}

function exigir() {
  const m = meta();
  if (!m) throw AppError.invalido('A integração com o Instagram ainda não foi liberada na plataforma.');
  return m;
}

async function conexao(db: Executor) {
  const c = await conexaoDaConta(db);
  if (!c) throw AppError.invalido('Conecte o Instagram da empresa primeiro (aba Conexão).');
  return c;
}

/** Responde em público, embaixo do comentário. */
export async function responderComentario(db: Executor, id: string, texto: string): Promise<void> {
  const m = exigir();
  const c = await conexao(db);
  const x = await comentario(db, id);
  try {
    await m.responderComentario(x.comentario_id, comNome(texto, null), c.token);
  } catch (e) {
    await registrarErroDaMeta(db, e);
    throw AppError.invalido(`O Instagram não aceitou a resposta: ${(e as Error).message}`);
  }
  await db.query(
    `UPDATE comercial.instagram_comentarios SET respondido_em = now(), resposta = $2
      WHERE conta_id = ${contaSql()} AND comentario_id = $1`,
    [id, texto.slice(0, 1000)],
  );
}

/** Direct para quem comentou (resposta privada: uma por comentário, até 7 dias depois dele). */
export async function directDoComentario(db: Executor, id: string, texto: string): Promise<void> {
  const m = exigir();
  const c = await conexao(db);
  const x = await comentario(db, id);
  if (x.direct_em) throw AppError.invalido('Este comentário já recebeu um direct (o Instagram deixa só um).');
  if (Date.now() - x.comentado_em.getTime() > PRAZO_RESPOSTA_PRIVADA_DIAS * 86_400_000)
    throw AppError.invalido(
      `O Instagram só deixa mandar o direct até ${PRAZO_RESPOSTA_PRIVADA_DIAS} dias depois do comentário. Responda em público ou crie o lead à mão.`,
    );
  const { rows: ja } = await db.query(
    `SELECT 1 FROM comercial.instagram_interacoes WHERE conta_id = ${contaSql()} AND comentario_id = $1 AND direct = 'enviado'`,
    [id],
  );
  if (ja.length) throw AppError.invalido('Este comentário já recebeu o direct da regra de comente e receba.');
  try {
    await m.respostaPrivada(c.paginaId, x.comentario_id, { texto }, c.token);
  } catch (e) {
    await registrarErroDaMeta(db, e);
    throw AppError.invalido(`O Instagram não aceitou o direct: ${(e as Error).message}`);
  }
  await db.query(
    `UPDATE comercial.instagram_comentarios SET direct_em = now() WHERE conta_id = ${contaSql()} AND comentario_id = $1`,
    [id],
  );
  // Quando a pessoa responder, ela vira lead e o direct entra na conversa (como no comente e receba).
  if (x.pessoa_id)
    await db.query(
      `INSERT INTO comercial.instagram_interacoes
         (conta_id, regra_id, midia_id, comentario_id, pessoa_id, usuario, comentario, comentado_em, direct, mensagem, empresa_id)
       VALUES (${contaSql()}, NULL, $1, $2, $3, $4, $5, $6, 'enviado', $7, $8)
       ON CONFLICT (conta_id, comentario_id) DO UPDATE SET direct = 'enviado', mensagem = EXCLUDED.mensagem`,
      [x.midia_id, x.comentario_id, x.pessoa_id, x.usuario, x.texto, x.comentado_em, texto, x.empresa_id],
    );
}

/** "Criar lead" num comentário: a pessoa vai para o funil (sem enriquecimento). */
export async function leadDoComentario(deps: DepsLead, id: string): Promise<number> {
  const x = await comentario(deps.pool, id);
  const ja = x.empresa_id ?? (x.pessoa_id ? await leadDoInstagram(deps.pool, x.pessoa_id) : null);
  if (ja) {
    await deps.pool.query(
      `UPDATE comercial.instagram_comentarios SET empresa_id = $2 WHERE conta_id = ${contaSql()} AND comentario_id = $1`,
      [id, ja],
    );
    return ja;
  }
  const { rows: pub } = await deps.pool.query<{
    legenda: string | null;
    link: string | null;
    tipo: string | null;
  }>(
    `SELECT legenda, link, tipo FROM comercial.instagram_midias WHERE conta_id = ${contaSql()} AND midia_id = $1`,
    [x.midia_id],
  );
  const quem = usuarioAtual()?.nome ?? 'Instagram';
  const { empresaId } = await criarLead(
    deps,
    {
      empresa: x.usuario ? `@${x.usuario}` : 'Contato do Instagram',
      instagram: x.usuario ? `https://instagram.com/${x.usuario}` : null,
    },
    { etapaId: null, responsavelId: null, etiquetas: ['instagram'], agente: false },
    quem,
  );
  await deps.pool.query(
    `UPDATE comercial.oportunidades SET instagram_id = coalesce(instagram_id, $2), instagram_usuario = coalesce(instagram_usuario, $3),
            origem_instagram = coalesce(origem_instagram, $4::jsonb)
      WHERE conta_id = ${contaSql()} AND empresa_id = $1`,
    [
      empresaId,
      x.pessoa_id,
      x.usuario,
      JSON.stringify({
        tipo: 'comentario',
        regraId: null,
        midiaId: x.midia_id,
        legenda: pub[0]?.legenda?.slice(0, 200) ?? null,
        link: pub[0]?.link ?? null,
        midiaTipo: pub[0]?.tipo ?? null,
        comentario: x.texto.slice(0, 300),
      }),
    ],
  );
  await deps.pool.query(
    `UPDATE comercial.instagram_comentarios SET empresa_id = $2
      WHERE conta_id = ${contaSql()} AND (comentario_id = $1 OR ($3::text IS NOT NULL AND pessoa_id = $3 AND empresa_id IS NULL))`,
    [id, empresaId, x.pessoa_id],
  );
  await funil.registrarAtividade(
    deps.pool,
    empresaId,
    {
      tipo: 'nota',
      direcao: null,
      texto: `Comentou “${x.texto.slice(0, 200)}” no Instagram (lead criado à mão).`,
    },
    quem,
  );
  return empresaId;
}

/** De 6 em 6 horas, os números de todas as contas conectadas. */
export function iniciarConteudo(deps: { pool: Pool; log: Logger }): () => void {
  const rodar = () =>
    void paraCadaConta(deps.pool, deps.log, 'instagram', () => atualizarConteudo(deps)).catch((e) =>
      deps.log.warn({ err: e }, 'instagram: atualização do conteúdo falhou'),
    );
  const t = setInterval(rodar, 6 * 3_600_000);
  t.unref();
  return () => clearInterval(t);
}
