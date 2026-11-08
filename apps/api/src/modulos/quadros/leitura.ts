import { comTransacao, type Executor, type Pool } from '@prospeccao/db';
import type { EntradaGatilhos, MovimentoConferido } from '@prospeccao/integrations/quadros';
import { type Logger, PARADA_QUADROS_MIN } from '@prospeccao/shared';
import { comConta, contaSql } from '../../contexto.js';
import type { ResolverServicos } from '../../servicos.js';
import { notificar } from '../notificacoes/repositorio.js';

/**
 * A leitura da IA: a cada minuto, as conversas que receberam mensagem e pararam há alguns minutos
 * (nas contas com quadro de IA ligada e coluna com gatilho) vão para a IA, uma chamada por lead para
 * todos os quadros. O que ela achar entra como sugestão (ou já move, no quadro que deixa). Lê só o
 * que chegou desde a última leitura e só o último dia (ligar um quadro não relê o passado).
 */

const LOCK = 860_117;
const POR_RODADA = 30;
const MENSAGENS = 30;

interface QuadroIa {
  id: number;
  nome: string;
  confirmar: boolean;
  colunas: { id: number; nome: string; gatilho: string | null }[];
}

async function quadrosDaConta(db: Executor): Promise<QuadroIa[]> {
  const { rows } = await db.query<QuadroIa>(
    `SELECT q.id, q.nome, q.confirmar,
            (SELECT json_agg(json_build_object('id', c.id, 'nome', c.nome, 'gatilho', nullif(btrim(c.gatilho), ''))
                     ORDER BY c.ordem, c.id)
               FROM comercial.quadro_colunas c WHERE c.quadro_id = q.id) AS colunas
       FROM comercial.quadros q
      WHERE q.conta_id = ${contaSql()} AND q.ia
        AND EXISTS (SELECT 1 FROM comercial.quadro_colunas c WHERE c.quadro_id = q.id AND btrim(coalesce(c.gatilho, '')) <> '')
      ORDER BY q.ordem, q.id`,
  );
  return rows;
}

/** Aplica o que a IA achou: sugestão (alguém confirma) ou já move. */
export async function aplicar(
  pool: Pool,
  empresaId: number,
  q: QuadroIa,
  m: MovimentoConferido,
): Promise<'sugerido' | 'movido' | null> {
  const coluna = q.colunas.find((c) => c.id === m.colunaId);
  if (!coluna) return null;
  const C = contaSql();
  return comTransacao(pool, async (tx) => {
    const { rows: atual } = await tx.query<{ coluna_id: number | null }>(
      'SELECT coluna_id FROM comercial.quadro_cartoes WHERE quadro_id = $1 AND empresa_id = $2 FOR UPDATE',
      [q.id, empresaId],
    );
    if (atual[0]?.coluna_id === coluna.id) return null;
    if (q.confirmar)
      await tx.query(
        `INSERT INTO comercial.quadro_cartoes
           (conta_id, quadro_id, empresa_id, sugerida_id, sugerida_em, origem, trecho, motivo, mensagem_id)
         VALUES (${C}, $1, $2, $3, now(), 'ia', $4, $5, $6)
         ON CONFLICT (quadro_id, empresa_id) DO UPDATE
           SET sugerida_id = $3, sugerida_em = now(), trecho = $4, motivo = $5, mensagem_id = $6`,
        [q.id, empresaId, coluna.id, m.trecho, m.motivo, m.mensagemId],
      );
    else
      await tx.query(
        `INSERT INTO comercial.quadro_cartoes
           (conta_id, quadro_id, empresa_id, coluna_id, origem, trecho, motivo, mensagem_id, movido_em)
         VALUES (${C}, $1, $2, $3, 'ia', $4, $5, $6, now())
         ON CONFLICT (quadro_id, empresa_id) DO UPDATE
           SET coluna_id = $3, sugerida_id = NULL, sugerida_em = NULL, origem = 'ia', trecho = $4, motivo = $5,
               mensagem_id = $6, movido_por = NULL, movido_em = now()`,
        [q.id, empresaId, coluna.id, m.trecho, m.motivo, m.mensagemId],
      );
    await tx.query(
      `INSERT INTO comercial.atividades (conta_id, empresa_id, tipo, texto, autor)
       VALUES (${C}, $1, 'nota', $2, 'IA dos quadros')`,
      [
        empresaId,
        `Quadro ${q.nome}: ${q.confirmar ? 'a IA sugere' : 'a IA pôs em'} "${coluna.nome}" — “${m.trecho}” (${m.motivo})`.slice(
          0,
          1000,
        ),
      ],
    );
    return q.confirmar ? 'sugerido' : 'movido';
  });
}

/** Lê um lead: monta a conversa, pergunta à IA e aplica. */
async function lerLead(
  pool: Pool,
  servicos: ResolverServicos,
  contaId: number,
  empresaId: number,
  ultima: number,
): Promise<void> {
  const C = contaSql();
  const marcar = (ok: boolean) =>
    pool.query(
      `INSERT INTO comercial.quadro_leituras (conta_id, empresa_id, ate_mensagem, lido_em, tentado_em)
       VALUES (${C}, $1, CASE WHEN $2::boolean THEN $3::bigint ELSE 0 END, CASE WHEN $2::boolean THEN now() END, CASE WHEN $2::boolean THEN NULL ELSE now() END)
       ON CONFLICT (conta_id, empresa_id) DO UPDATE
         SET ate_mensagem = CASE WHEN $2::boolean THEN $3::bigint ELSE comercial.quadro_leituras.ate_mensagem END,
             lido_em = CASE WHEN $2::boolean THEN now() ELSE comercial.quadro_leituras.lido_em END,
             tentado_em = CASE WHEN $2::boolean THEN NULL ELSE now() END`,
      [empresaId, ok, ultima],
    );
  const ia = (await servicos(contaId)).quadros;
  const quadros = await quadrosDaConta(pool);
  if (!ia || !quadros.length) {
    // Sem IA (desligada, sem chave): marca como lida para não tentar a cada minuto.
    await marcar(true);
    return;
  }
  const [{ rows: lido }, { rows: info }, { rows: msgs }, { rows: onde }] = await Promise.all([
    pool.query<{ ate: number }>(
      `SELECT ate_mensagem::bigint AS ate FROM comercial.quadro_leituras WHERE conta_id = ${C} AND empresa_id = $1`,
      [empresaId],
    ),
    pool.query<{ lead: string; empresa: string; dono: number | null }>(
      `SELECT coalesce(e.maps_nome, e.nome) AS lead, coalesce(org.marca_nome, c.nome) AS empresa,
              (SELECT o.responsavel_id FROM comercial.oportunidades o WHERE o.conta_id = c.id AND o.empresa_id = e.id) AS dono
         FROM descoberta.empresas e, cadastro.contas c JOIN cadastro.organizacoes org ON org.id = c.organizacao_id
        WHERE e.id = $1 AND c.id = ${C}`,
      [empresaId],
    ),
    pool.query<{ id: string; direcao: string; texto: string; criado_em: Date }>(
      `SELECT * FROM (
         SELECT id, direcao, texto, criado_em FROM comercial.mensagens
          WHERE conta_id = ${C} AND empresa_id = $1 AND status IN ('enviada', 'recebida') AND id <= $2
          ORDER BY id DESC LIMIT ${MENSAGENS}) m ORDER BY id`,
      [empresaId, ultima],
    ),
    pool.query<{ quadro_id: number; coluna: string | null }>(
      `SELECT k.quadro_id, c.nome AS coluna FROM comercial.quadro_cartoes k
         JOIN comercial.quadro_colunas c ON c.id = coalesce(k.sugerida_id, k.coluna_id)
        WHERE k.conta_id = ${C} AND k.empresa_id = $1`,
      [empresaId],
    ),
  ]);
  const ate = Number(lido[0]?.ate ?? 0);
  const i = info[0];
  if (!i || !msgs.length) {
    await marcar(true);
    return;
  }
  const entrada: EntradaGatilhos = {
    empresa: i.empresa,
    lead: i.lead,
    agora: new Date(),
    mensagens: msgs.map((m) => ({
      id: Number(m.id),
      quem: m.direcao === 'recebida' ? 'lead' : 'empresa',
      texto: m.texto,
      em: m.criado_em,
      nova: Number(m.id) > ate,
    })),
    quadros: quadros.map((q) => ({
      id: q.id,
      nome: q.nome,
      colunaAtual: onde.find((o) => o.quadro_id === q.id)?.coluna ?? null,
      colunas: q.colunas.flatMap((c) => (c.gatilho ? [{ id: c.id, nome: c.nome, gatilho: c.gatilho }] : [])),
    })),
  };
  let movimentos: MovimentoConferido[];
  try {
    movimentos = await ia.ler(entrada);
  } catch (e) {
    await marcar(false);
    throw e;
  }
  for (const m of movimentos) {
    const q = quadros.find((x) => x.id === m.quadroId);
    if (!q) continue;
    const feito = await aplicar(pool, empresaId, q, m);
    const coluna = q.colunas.find((c) => c.id === m.colunaId)?.nome ?? '';
    // Sugestão: avisa o dono do lead (sem dono, ninguém: a sugestão fica no quadro).
    if (feito === 'sugerido' && i.dono)
      await notificar(pool, i.dono, {
        tipo: 'sistema',
        titulo: `${i.lead}: ${coluna}?`,
        texto: `A IA sugere a coluna "${coluna}" no quadro ${q.nome}: “${m.trecho}”`.slice(0, 300),
        empresaId,
        link: `/quadros?quadro=${q.id}`,
      }).catch(() => undefined);
  }
  await marcar(true);
}

/** Uma rodada: as conversas paradas com mensagem nova, nas contas com quadro de IA. */
export async function rodadaQuadros(pool: Pool, servicos: ResolverServicos, log: Logger): Promise<number> {
  const cliente = await pool.connect();
  try {
    const { rows: trava } = await cliente.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [
      LOCK,
    ]);
    if (!trava[0]?.ok) return 0;
    try {
      const { rows } = await cliente.query<{ conta_id: number; empresa_id: number; ultima: string }>(
        `WITH contas AS (
           SELECT DISTINCT q.conta_id FROM comercial.quadros q
             JOIN comercial.quadro_colunas c ON c.quadro_id = q.id
            WHERE q.ia AND btrim(coalesce(c.gatilho, '')) <> '')
         SELECT m.conta_id, m.empresa_id::int, max(m.id)::text AS ultima
           FROM comercial.mensagens m
           JOIN contas ct ON ct.conta_id = m.conta_id
           LEFT JOIN comercial.quadro_leituras l ON l.conta_id = m.conta_id AND l.empresa_id = m.empresa_id
          WHERE m.criado_em > now() - interval '1 day' AND m.status IN ('enviada', 'recebida')
            AND m.id > coalesce(l.ate_mensagem, 0)
            AND (l.tentado_em IS NULL OR l.tentado_em < now() - interval '15 minutes')
          GROUP BY m.conta_id, m.empresa_id
         HAVING max(m.criado_em) < now() - make_interval(mins => $1)
          ORDER BY max(m.criado_em)
          LIMIT ${POR_RODADA}`,
        [PARADA_QUADROS_MIN],
      );
      for (const r of rows)
        await comConta(r.conta_id, () =>
          lerLead(pool, servicos, r.conta_id, r.empresa_id, Number(r.ultima)),
        ).catch((e) =>
          log.warn({ err: e, conta: r.conta_id, empresa: r.empresa_id }, 'quadros: leitura da IA falhou'),
        );
      return rows.length;
    } finally {
      await cliente.query('SELECT pg_advisory_unlock($1)', [LOCK]);
    }
  } finally {
    cliente.release();
  }
}

/** A cada minuto. */
export function iniciarQuadros(d: { pool: Pool; servicos: ResolverServicos; log: Logger }): () => void {
  let rodando = false;
  const t = setInterval(() => {
    if (rodando) return;
    rodando = true;
    void rodadaQuadros(d.pool, d.servicos, d.log)
      .catch((e) => d.log.warn({ err: e }, 'quadros: rodada falhou'))
      .finally(() => {
        rodando = false;
      });
  }, 60_000);
  t.unref();
  return () => clearInterval(t);
}
