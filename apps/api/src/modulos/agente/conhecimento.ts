import type { Executor } from '@prospeccao/db';
import { dividirEmTrechos, termosDaBusca } from '@prospeccao/integrations/agente';
import { AppError } from '@prospeccao/shared';
import { contaSql, usuarioAtual } from '../../contexto.js';

/**
 * Base de conhecimento do agente (por conta). Cada item vira trechos com índice de busca em
 * português; a IA recebe só os trechos que combinam com a pergunta do lead. O que a IA aprende numa
 * conversa entra como "sugerido" e só vale depois que alguém aprova.
 */

export interface ItemConhecimento {
  id: number;
  tipo: 'texto' | 'faq' | 'arquivo';
  titulo: string;
  pergunta: string | null;
  conteudo: string;
  origem: 'manual' | 'arquivo' | 'conversa';
  status: 'ativo' | 'sugerido' | 'arquivado';
  empresaId: number | null;
  empresaNome: string | null;
  usos: number;
  usadoEm: string | null;
  criadoEm: string;
  criadoPorNome: string | null;
}

export async function listar(db: Executor): Promise<ItemConhecimento[]> {
  const { rows } = await db.query<ItemConhecimento>(
    `SELECT k.id::int, k.tipo, k.titulo, k.pergunta, k.conteudo, k.origem, k.status,
            k.empresa_id::int AS "empresaId", e.nome AS "empresaNome", k.usos, k.usado_em AS "usadoEm",
            k.criado_em AS "criadoEm", u.nome AS "criadoPorNome"
       FROM comercial.conhecimento k
       LEFT JOIN descoberta.empresas e ON e.id = k.empresa_id
       LEFT JOIN cadastro.usuarios u ON u.id = k.criado_por
      WHERE k.conta_id = ${contaSql()} AND k.status <> 'arquivado'
      ORDER BY (k.status = 'sugerido') DESC, k.atualizado_em DESC
      LIMIT 500`,
  );
  return rows;
}

/** Texto que vai para a busca: a pergunta (FAQ) ajuda a achar a resposta. */
function textoIndexado(d: { tipo: string; pergunta?: string | null; titulo: string; conteudo: string }) {
  return d.tipo === 'faq' && d.pergunta
    ? `Pergunta: ${d.pergunta}\nResposta: ${d.conteudo}`
    : `${d.titulo}\n${d.conteudo}`;
}

async function reindexar(db: Executor, id: number) {
  const { rows } = await db.query<{
    tipo: string;
    pergunta: string | null;
    titulo: string;
    conteudo: string;
  }>(
    `SELECT tipo, pergunta, titulo, conteudo FROM comercial.conhecimento WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id],
  );
  const k = rows[0];
  if (!k) return;
  await db.query('DELETE FROM comercial.conhecimento_trechos WHERE conhecimento_id = $1', [id]);
  // FAQ fica num trecho só (pergunta e resposta juntas); o resto é dividido.
  const trechos = k.tipo === 'faq' ? [textoIndexado(k)] : dividirEmTrechos(textoIndexado(k));
  for (const [i, t] of trechos.entries())
    await db.query(
      `INSERT INTO comercial.conhecimento_trechos (conhecimento_id, conta_id, ordem, texto)
       VALUES ($1, ${contaSql()}, $2, $3)`,
      [id, i, t],
    );
}

export async function criar(
  db: Executor,
  d: {
    tipo: 'texto' | 'faq' | 'arquivo';
    titulo: string;
    pergunta?: string | null;
    conteudo: string;
    origem?: 'manual' | 'arquivo' | 'conversa';
    status?: 'ativo' | 'sugerido';
    empresaId?: number | null;
  },
): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO comercial.conhecimento (conta_id, tipo, titulo, pergunta, conteudo, origem, status, empresa_id, criado_por)
     VALUES (${contaSql()}, $1, $2, $3, $4, $5, $6, $7, $8) RETURNING id::int`,
    [
      d.tipo,
      d.titulo.slice(0, 200),
      d.pergunta ?? null,
      d.conteudo,
      d.origem ?? 'manual',
      d.status ?? 'ativo',
      d.empresaId ?? null,
      d.origem === 'conversa' ? null : (usuarioAtual()?.id ?? null),
    ],
  );
  const id = rows[0]!.id;
  await reindexar(db, id);
  return id;
}

export async function atualizar(
  db: Executor,
  id: number,
  d: { titulo?: string; pergunta?: string | null; conteudo?: string; aprovar?: boolean },
): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE comercial.conhecimento
        SET titulo = coalesce($2, titulo), pergunta = CASE WHEN $3::boolean THEN $4 ELSE pergunta END,
            conteudo = coalesce($5, conteudo),
            status = CASE WHEN $6 THEN 'ativo' ELSE status END,
            criado_por = CASE WHEN $6 THEN $7 ELSE criado_por END
      WHERE id = $1 AND conta_id = ${contaSql()} AND status <> 'arquivado'`,
    [
      id,
      d.titulo ?? null,
      d.pergunta !== undefined,
      d.pergunta ?? null,
      d.conteudo ?? null,
      !!d.aprovar,
      usuarioAtual()?.id ?? null,
    ],
  );
  if (!rowCount) throw AppError.naoEncontrado('Item da base');
  await reindexar(db, id);
  // Aprovou um aprendizado ligado a uma pergunta sem resposta: a lacuna fica resolvida.
  if (d.aprovar)
    await db.query(
      `UPDATE comercial.lacunas_ia SET resolvida_em = now(), conhecimento_id = $1
        WHERE conta_id = ${contaSql()} AND resolvida_em IS NULL AND conhecimento_id = $1`,
      [id],
    );
}

/** Tira da base (sugestão recusada ou conteúdo que não vale mais). */
export async function arquivar(db: Executor, id: number): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE comercial.conhecimento SET status = 'arquivado' WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id],
  );
  if (!rowCount) throw AppError.naoEncontrado('Item da base');
  await db.query('DELETE FROM comercial.conhecimento_trechos WHERE conhecimento_id = $1', [id]);
  // Sugestão recusada: a pergunta volta para a lista do que falta ensinar.
  await db.query(
    `UPDATE comercial.lacunas_ia SET conhecimento_id = NULL
      WHERE conta_id = ${contaSql()} AND conhecimento_id = $1 AND resolvida_em IS NULL`,
    [id],
  );
}

export interface TrechoAchado {
  conhecimentoId: number;
  titulo: string;
  texto: string;
  relevancia: number;
}

/**
 * Trechos que combinam com o que o lead escreveu (qualquer termo vale; os que têm mais termos e
 * mais raros vêm primeiro). Até `limite` trechos, sem repetir o mesmo item mais de duas vezes.
 */
export async function buscarTrechos(db: Executor, texto: string, limite = 5): Promise<TrechoAchado[]> {
  const termos = termosDaBusca(texto);
  if (!termos.length) return [];
  const { rows } = await db.query<TrechoAchado>(
    `WITH q AS (
       SELECT to_tsquery('portuguese', string_agg(quote_literal(t) || ':*', ' | ')) AS consulta
         FROM unnest($1::text[]) t
     )
     SELECT k.id::int AS "conhecimentoId", k.titulo, tr.texto,
            ts_rank_cd(tr.tsv, q.consulta)::float8 AS relevancia
       FROM comercial.conhecimento_trechos tr
       JOIN comercial.conhecimento k ON k.id = tr.conhecimento_id AND k.status = 'ativo'
       CROSS JOIN q
      WHERE tr.conta_id = ${contaSql()} AND tr.tsv @@ q.consulta
      ORDER BY relevancia DESC
      LIMIT 20`,
    [termos],
  );
  const porItem = new Map<number, number>();
  const saida: TrechoAchado[] = [];
  for (const r of rows) {
    const n = porItem.get(r.conhecimentoId) ?? 0;
    if (n >= 2) continue;
    porItem.set(r.conhecimentoId, n + 1);
    saida.push(r);
    if (saida.length >= limite) break;
  }
  return saida;
}

/** Conta o uso (a tela mostra o que a IA mais consulta e o que nunca foi usado). */
export async function marcarUso(db: Executor, ids: number[]): Promise<void> {
  if (!ids.length) return;
  await db.query(
    `UPDATE comercial.conhecimento SET usos = usos + 1, usado_em = now()
      WHERE conta_id = ${contaSql()} AND id = ANY($1::bigint[])`,
    [[...new Set(ids)]],
  );
}

/** Texto de um arquivo enviado: PDF, TXT, Markdown ou CSV. */
export async function textoDoArquivo(m: { nome: string; mime: string; base64: string }): Promise<string> {
  const dados = Buffer.from(m.base64, 'base64');
  if (!dados.length) throw AppError.invalido('Arquivo vazio.');
  if (dados.length > 10 * 1024 * 1024) throw AppError.invalido('Arquivo grande demais (até 10 MB).');
  const nome = m.nome.toLowerCase();
  if (m.mime === 'application/pdf' || nome.endsWith('.pdf')) {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(dados));
    const { text } = await extractText(pdf, { mergePages: true });
    const t = (Array.isArray(text) ? text.join('\n') : text).trim();
    if (!t) throw AppError.invalido('Não consegui ler texto neste PDF (pode ser imagem escaneada).');
    return t;
  }
  if (/\.(txt|md|csv)$/.test(nome) || m.mime.startsWith('text/')) return dados.toString('utf8');
  throw AppError.invalido('Envie PDF, TXT, Markdown ou CSV.');
}

/* ───────────── Lacunas: o que a IA não soube responder ───────────── */

export async function registrarLacuna(
  db: Executor,
  d: { empresaId: number; pergunta: string; motivo: string },
): Promise<void> {
  // A mesma pergunta do mesmo lead não vira duas lacunas.
  await db.query(
    `INSERT INTO comercial.lacunas_ia (conta_id, empresa_id, pergunta, motivo)
     SELECT ${contaSql()}, $1, $2, $3
      WHERE NOT EXISTS (SELECT 1 FROM comercial.lacunas_ia
                         WHERE conta_id = ${contaSql()} AND empresa_id = $1 AND pergunta = $2 AND resolvida_em IS NULL)`,
    [d.empresaId, d.pergunta.slice(0, 600), d.motivo.slice(0, 300)],
  );
}

export async function lacunas(db: Executor) {
  const { rows } = await db.query(
    `SELECT l.id::int, l.empresa_id::int AS "empresaId", e.nome AS "empresaNome", l.pergunta, l.motivo,
            l.criado_em AS "criadoEm", l.conhecimento_id::int AS "sugestaoId"
       FROM comercial.lacunas_ia l LEFT JOIN descoberta.empresas e ON e.id = l.empresa_id
      WHERE l.conta_id = ${contaSql()} AND l.resolvida_em IS NULL
      ORDER BY l.criado_em DESC LIMIT 100`,
  );
  return rows;
}

/** Ensinou (virou item da base) ou dispensou: some da lista. */
export async function resolverLacuna(db: Executor, id: number, conhecimentoId: number | null) {
  const { rowCount } = await db.query(
    `UPDATE comercial.lacunas_ia SET resolvida_em = now(), conhecimento_id = $2
      WHERE id = $1 AND conta_id = ${contaSql()} AND resolvida_em IS NULL`,
    [id, conhecimentoId],
  );
  if (!rowCount) throw AppError.naoEncontrado('Pergunta');
}

/** Números da base para a tela: itens ativos, sugestões esperando e perguntas sem resposta. */
export async function numeros(db: Executor) {
  const C = contaSql();
  const { rows } = await db.query<{ ativos: number; sugeridos: number; lacunas: number; barradas7d: number }>(
    `SELECT (SELECT count(*) FROM comercial.conhecimento WHERE conta_id = ${C} AND status = 'ativo')::int AS ativos,
            (SELECT count(*) FROM comercial.conhecimento WHERE conta_id = ${C} AND status = 'sugerido')::int AS sugeridos,
            (SELECT count(*) FROM comercial.lacunas_ia WHERE conta_id = ${C} AND resolvida_em IS NULL)::int AS lacunas,
            (SELECT count(*) FROM comercial.verificacoes_ia WHERE conta_id = ${C}
               AND criado_em > now() - interval '7 days')::int AS "barradas7d"`,
  );
  return rows[0]!;
}

/** O que as verificações barraram nos últimos dias (para a equipe conferir a IA). */
export async function verificacoes(db: Executor) {
  const { rows } = await db.query(
    `SELECT v.id::int, v.empresa_id::int AS "empresaId", e.nome AS "empresaNome", v.texto, v.problemas,
            v.resultado, v.criado_em AS "criadoEm"
       FROM comercial.verificacoes_ia v LEFT JOIN descoberta.empresas e ON e.id = v.empresa_id
      WHERE v.conta_id = ${contaSql()} ORDER BY v.criado_em DESC LIMIT 50`,
  );
  return rows;
}
