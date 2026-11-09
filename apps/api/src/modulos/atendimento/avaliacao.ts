import type { Executor, Pool } from '@prospeccao/db';
import type { FalaAtendimento } from '@prospeccao/integrations/atendimento';
import type { Logger } from '@prospeccao/shared';
import {
  type CriteriosAvaliados,
  MIN_MENSAGENS_EQUIPE,
  notaDoTempo,
  notaGeral,
  PARADA_ATENDIMENTO_MIN,
  temposDeResposta,
} from '@prospeccao/shared/atendimento';
import { comConta, contaSql } from '../../contexto.js';
import { temRecurso } from '../../recursos.js';
import type { ResolverServicos } from '../../servicos.js';

/**
 * A rotina da nota do atendimento (a cada 2 minutos):
 *  - conversas: o que chegou desde a última avaliação do lead e está parado há 2 horas vira um
 *    atendimento. Precisa de pelo menos 3 mensagens da equipe; quem mais escreveu é quem atendeu.
 *    Mensagens da IA e de envios automáticos não contam para ninguém.
 *  - ligações: as transcritas, com pelo menos 3 falas de quem ligou.
 * Só nas contas com o recurso no plano. Só os últimos 3 dias (ligar o recurso não reavalia o passado).
 */

const LOCK = 860_123;
const POR_RODADA = 20;
const CONTEXTO = 8;

const nomes = async (db: Executor, empresaId: number | null) => {
  const { rows } = await db.query<{ lead: string | null; empresa: string }>(
    `SELECT (SELECT coalesce(e.maps_nome, e.nome) FROM descoberta.empresas e WHERE e.id = $1) AS lead,
            coalesce(org.marca_nome, c.nome) AS empresa
       FROM cadastro.contas c JOIN cadastro.organizacoes org ON org.id = c.organizacao_id
      WHERE c.id = ${contaSql()}`,
    [empresaId],
  );
  return { lead: rows[0]?.lead ?? 'o cliente', empresa: rows[0]?.empresa ?? 'a empresa' };
};

const nomeDe = async (db: Executor, usuarioId: number) =>
  (await db.query<{ nome: string }>('SELECT nome FROM cadastro.usuarios WHERE id = $1', [usuarioId])).rows[0]
    ?.nome ?? 'o vendedor';

interface LinhaMensagem {
  id: string;
  direcao: 'enviada' | 'recebida';
  origem: string;
  usuario_id: number | null;
  texto: string;
  criado_em: Date;
}

const quemEscreveu = (m: LinhaMensagem): FalaAtendimento['quem'] =>
  m.direcao === 'recebida' ? 'lead' : m.origem === 'humano' ? 'equipe' : 'outro';

async function guardar(
  db: Executor,
  d: {
    tipo: 'conversa' | 'ligacao';
    empresaId: number | null;
    ligacaoId?: number | null;
    usuarioId: number;
    deMensagem?: number | null;
    ateMensagem?: number | null;
    inicio: Date;
    fim: Date;
    criterios: CriteriosAvaliados;
    primeira: number | null;
    media: number | null;
    modelo: string | null;
  },
): Promise<void> {
  const nota = notaGeral(d.criterios);
  if (nota == null) return;
  await db.query(
    `INSERT INTO comercial.atendimento_notas
       (conta_id, tipo, empresa_id, ligacao_id, usuario_id, de_mensagem, ate_mensagem, inicio_em, fim_em,
        nota_ia, criterios, primeira_resposta_min, media_resposta_min, modelo)
     VALUES (${contaSql()}, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT DO NOTHING`,
    [
      d.tipo,
      d.empresaId,
      d.ligacaoId ?? null,
      d.usuarioId,
      d.deMensagem ?? null,
      d.ateMensagem ?? null,
      d.inicio,
      d.fim,
      nota,
      JSON.stringify(d.criterios),
      d.primeira,
      d.media,
      d.modelo,
    ],
  );
}

/** Avalia o que o lead conversou desde a última avaliação (até a mensagem `ultima`). */
export async function avaliarConversa(
  pool: Pool,
  servicos: ResolverServicos,
  contaId: number,
  empresaId: number,
  ultima: number,
): Promise<'avaliada' | 'pulada' | 'falhou'> {
  const C = contaSql();
  const marcar = (ok: boolean) =>
    pool.query(
      `INSERT INTO comercial.atendimento_leituras (conta_id, empresa_id, ate_mensagem, tentado_em)
       VALUES (${C}, $1, CASE WHEN $2::boolean THEN $3::bigint ELSE 0 END, CASE WHEN $2::boolean THEN NULL ELSE now() END)
       ON CONFLICT (conta_id, empresa_id) DO UPDATE
         SET ate_mensagem = CASE WHEN $2::boolean THEN $3::bigint ELSE comercial.atendimento_leituras.ate_mensagem END,
             tentado_em = CASE WHEN $2::boolean THEN NULL ELSE now() END`,
      [empresaId, ok, ultima],
    );
  const { rows: lido } = await pool.query<{ ate: string }>(
    `SELECT ate_mensagem AS ate FROM comercial.atendimento_leituras WHERE conta_id = ${C} AND empresa_id = $1`,
    [empresaId],
  );
  const ate = Number(lido[0]?.ate ?? 0);
  const colunas = 'id, direcao, origem, usuario_id, texto, criado_em';
  const [{ rows: msgs }, { rows: antes }] = await Promise.all([
    pool.query<LinhaMensagem>(
      `SELECT ${colunas} FROM comercial.mensagens
        WHERE conta_id = ${C} AND empresa_id = $1 AND status IN ('enviada', 'recebida')
          AND id > $2 AND id <= $3 AND criado_em > now() - interval '3 days'
        ORDER BY criado_em, id`,
      [empresaId, ate, ultima],
    ),
    pool.query<LinhaMensagem>(
      `SELECT * FROM (SELECT ${colunas} FROM comercial.mensagens
         WHERE conta_id = ${C} AND empresa_id = $1 AND status IN ('enviada', 'recebida') AND id <= $2
           AND criado_em > now() - interval '7 days'
         ORDER BY id DESC LIMIT ${CONTEXTO}) m ORDER BY criado_em, id`,
      [empresaId, ate],
    ),
  ]);
  const daEquipe = msgs.filter((m) => quemEscreveu(m) === 'equipe' && m.usuario_id);
  if (daEquipe.length < MIN_MENSAGENS_EQUIPE || !msgs.some((m) => quemEscreveu(m) === 'lead')) {
    await marcar(true);
    return 'pulada';
  }
  // Quem atendeu: quem mais escreveu da equipe (empate: quem escreveu por último).
  const conta = new Map<number, number>();
  for (const m of daEquipe) conta.set(m.usuario_id!, (conta.get(m.usuario_id!) ?? 0) + 1);
  const maximo = Math.max(...conta.values());
  const usuarioId = [...daEquipe].reverse().find((m) => conta.get(m.usuario_id!) === maximo)!.usuario_id!;
  const serv = await servicos(contaId);
  if (!serv.atendimento) {
    await marcar(true);
    return 'pulada';
  }
  const { lead, empresa } = await nomes(pool, empresaId);
  const tempos = temposDeResposta(msgs.map((m) => ({ quem: quemEscreveu(m), em: m.criado_em })));
  let avaliacao: Awaited<ReturnType<NonNullable<typeof serv.atendimento>['avaliar']>>;
  try {
    avaliacao = await serv.atendimento.avaliar({
      tipo: 'conversa',
      empresa,
      vendedor: await nomeDe(pool, usuarioId),
      lead,
      falas: [
        ...antes.map((m) => ({ quem: quemEscreveu(m), texto: m.texto, em: m.criado_em, contexto: true })),
        ...msgs.map((m) => ({ quem: quemEscreveu(m), texto: m.texto, em: m.criado_em })),
      ],
    });
  } catch (e) {
    await marcar(false);
    throw e;
  }
  if (!avaliacao) {
    await marcar(false);
    return 'falhou';
  }
  const criterios: CriteriosAvaliados = { ...avaliacao };
  if (tempos.mediaMin != null)
    criterios.tempo = {
      nota: notaDoTempo(tempos.mediaMin),
      comentario: `Primeira resposta em ${tempos.primeiraMin} min; média de ${tempos.mediaMin} min.`,
      trecho: null,
      sugestao: null,
    };
  await guardar(pool, {
    tipo: 'conversa',
    empresaId,
    usuarioId,
    deMensagem: Number(msgs[0]!.id),
    ateMensagem: ultima,
    inicio: msgs[0]!.criado_em,
    fim: msgs.at(-1)!.criado_em,
    criterios,
    primeira: tempos.primeiraMin,
    media: tempos.mediaMin,
    modelo: serv.iaDescricao,
  });
  await marcar(true);
  return 'avaliada';
}

/** Avalia uma ligação transcrita (sem tempo de resposta: só os 4 pontos da IA). */
export async function avaliarLigacao(
  pool: Pool,
  servicos: ResolverServicos,
  contaId: number,
  ligacaoId: number,
): Promise<'avaliada' | 'falhou'> {
  const tentou = () =>
    pool.query('UPDATE comercial.ligacoes SET nota_tentada_em = now() WHERE id = $1', [ligacaoId]);
  const { rows: l } = await pool.query<{
    empresa_id: string | null;
    usuario_id: number;
    inicio: Date;
    fim: Date | null;
  }>(
    `SELECT empresa_id, usuario_id, coalesce(atendida_em, iniciada_em) AS inicio, encerrada_em AS fim
       FROM comercial.ligacoes WHERE id = $1 AND conta_id = ${contaSql()}`,
    [ligacaoId],
  );
  const lig = l[0];
  if (!lig) return 'falhou';
  const { rows: falas } = await pool.query<{ quem: 'voce' | 'lead'; inicio_ms: number; texto: string }>(
    'SELECT quem, inicio_ms, texto FROM comercial.ligacao_falas WHERE ligacao_id = $1 ORDER BY inicio_ms',
    [ligacaoId],
  );
  const serv = await servicos(contaId);
  if (!serv.atendimento) {
    await tentou();
    return 'falhou';
  }
  const empresaId = lig.empresa_id == null ? null : Number(lig.empresa_id);
  const { lead, empresa } = await nomes(pool, empresaId);
  let avaliacao: Awaited<ReturnType<NonNullable<typeof serv.atendimento>['avaliar']>>;
  try {
    avaliacao = await serv.atendimento.avaliar({
      tipo: 'ligacao',
      empresa,
      vendedor: await nomeDe(pool, lig.usuario_id),
      lead,
      falas: falas.map((f) => ({
        quem: f.quem === 'voce' ? 'equipe' : 'lead',
        texto: f.texto,
        em: new Date(lig.inicio.getTime() + f.inicio_ms),
      })),
    });
  } catch (e) {
    await tentou();
    throw e;
  }
  if (!avaliacao) {
    await tentou();
    return 'falhou';
  }
  await guardar(pool, {
    tipo: 'ligacao',
    empresaId,
    ligacaoId,
    usuarioId: lig.usuario_id,
    inicio: lig.inicio,
    fim: lig.fim ?? lig.inicio,
    criterios: { ...avaliacao },
    primeira: null,
    media: null,
    modelo: serv.iaDescricao,
  });
  return 'avaliada';
}

/** Uma rodada: as conversas paradas há 2 horas e as ligações transcritas sem nota. */
export async function rodadaAtendimento(
  pool: Pool,
  servicos: ResolverServicos,
  log: Logger,
): Promise<number> {
  const cliente = await pool.connect();
  try {
    const { rows: trava } = await cliente.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [
      LOCK,
    ]);
    if (!trava[0]?.ok) return 0;
    try {
      const { rows: conversas } = await cliente.query<{
        conta_id: number;
        empresa_id: number;
        ultima: string;
      }>(
        `SELECT m.conta_id, m.empresa_id::int, max(m.id)::text AS ultima
           FROM comercial.mensagens m
           LEFT JOIN comercial.atendimento_leituras l ON l.conta_id = m.conta_id AND l.empresa_id = m.empresa_id
          WHERE m.criado_em > now() - interval '3 days' AND m.status IN ('enviada', 'recebida')
            AND m.id > coalesce(l.ate_mensagem, 0)
            AND (l.tentado_em IS NULL OR l.tentado_em < now() - interval '30 minutes')
          GROUP BY m.conta_id, m.empresa_id
         HAVING max(m.criado_em) < now() - make_interval(mins => $1)
          ORDER BY max(m.criado_em)
          LIMIT ${POR_RODADA}`,
        [PARADA_ATENDIMENTO_MIN],
      );
      const { rows: ligacoes } = await cliente.query<{ conta_id: number; id: string }>(
        `SELECT l.conta_id, l.id FROM comercial.ligacoes l
          WHERE l.processamento = 'pronto' AND l.transcricao = 'pronta' AND l.usuario_id IS NOT NULL
            AND l.encerrada_em > now() - interval '3 days'
            AND (l.nota_tentada_em IS NULL OR l.nota_tentada_em < now() - interval '30 minutes')
            AND NOT EXISTS (SELECT 1 FROM comercial.atendimento_notas n WHERE n.ligacao_id = l.id)
            AND (SELECT count(*) FROM comercial.ligacao_falas f WHERE f.ligacao_id = l.id AND f.quem = 'voce')
                >= ${MIN_MENSAGENS_EQUIPE}
          ORDER BY l.encerrada_em LIMIT ${POR_RODADA}`,
      );
      const comRecurso = new Map<number, boolean>();
      const temNaConta = async (contaId: number) => {
        if (!comRecurso.has(contaId)) comRecurso.set(contaId, await temRecurso(pool, 'atendimento', contaId));
        return comRecurso.get(contaId)!;
      };
      for (const r of conversas)
        await comConta(r.conta_id, async () => {
          if (!(await temNaConta(r.conta_id))) {
            // Sem o recurso: marca como lido (ligar depois não reavalia o passado).
            await pool.query(
              `INSERT INTO comercial.atendimento_leituras (conta_id, empresa_id, ate_mensagem)
               VALUES ($1, $2, $3) ON CONFLICT (conta_id, empresa_id) DO UPDATE SET ate_mensagem = $3, tentado_em = NULL`,
              [r.conta_id, r.empresa_id, r.ultima],
            );
            return;
          }
          await avaliarConversa(pool, servicos, r.conta_id, r.empresa_id, Number(r.ultima));
        }).catch((e) =>
          log.warn(
            { err: e, conta: r.conta_id, empresa: r.empresa_id },
            'atendimento: avaliação da conversa falhou',
          ),
        );
      for (const r of ligacoes)
        await comConta(r.conta_id, async () => {
          if (!(await temNaConta(r.conta_id))) {
            await pool.query('UPDATE comercial.ligacoes SET nota_tentada_em = now() WHERE id = $1', [r.id]);
            return;
          }
          await avaliarLigacao(pool, servicos, r.conta_id, Number(r.id));
        }).catch((e) =>
          log.warn({ err: e, conta: r.conta_id, ligacao: r.id }, 'atendimento: avaliação da ligação falhou'),
        );
      return conversas.length + ligacoes.length;
    } finally {
      await cliente.query('SELECT pg_advisory_unlock($1)', [LOCK]);
    }
  } finally {
    cliente.release();
  }
}

/** A cada 2 minutos. */
export function iniciarAtendimento(d: { pool: Pool; servicos: ResolverServicos; log: Logger }): () => void {
  let rodando = false;
  const t = setInterval(() => {
    if (rodando) return;
    rodando = true;
    void rodadaAtendimento(d.pool, d.servicos, d.log)
      .catch((e) => d.log.warn({ err: e }, 'atendimento: rodada falhou'))
      .finally(() => {
        rodando = false;
      });
  }, 120_000);
  t.unref();
  return () => clearInterval(t);
}
