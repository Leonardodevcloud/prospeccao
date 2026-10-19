import { comTransacao, type Executor, type Pool } from '@prospeccao/db';
import {
  AppError,
  type AtividadeEntrada,
  type EtapaFunil,
  type FiltrosFunil,
  type FunilAdicionar,
  type FunilAtualizar,
  ORDEM_ETAPA,
} from '@prospeccao/shared';
import { JUNCOES_ENRIQ } from '../empresas/repositorio.js';
import { aplicarCadencia, obterConfig } from './cadencia.js';

/**
 * Funil comercial (schema comercial, escrito só pela API). Uma oportunidade por empresa:
 * a mesma loja em duas campanhas, ou achada de novo numa nova rodada, é um card só.
 */

/** Fim do dia de hoje em São Paulo: "pendente" = próximo passo vencido ou para hoje. */
const FIM_DE_HOJE = `(date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 day') AT TIME ZONE 'America/Sao_Paulo'`;

/**
 * Telefones "da loja" de cada empresa, para achar o mesmo contato em dois cadastros.
 * Telefone que veio só da Receita fica de fora: costuma ser do contador e se repete em
 * dezenas de empresas.
 */
const TELEFONES = `
  SELECT c.empresa_id, c.valor FROM enriquecimento.contatos c
   WHERE c.canal IN ('whatsapp', 'telefone') AND NOT (c.fontes <@ ARRAY['receita']::text[])
  UNION
  SELECT e.id, e.maps_telefone FROM descoberta.empresas e WHERE e.maps_telefone IS NOT NULL`;

export interface Duplicada {
  empresaId: number;
  nome: string;
  outraEmpresaId: number;
  outraNome: string;
  outraEtapa: EtapaFunil;
  telefone: string;
}

/** Empresas (das informadas) cujo telefone já está em OUTRA empresa do funil. */
export async function duplicadas(db: Executor, empresaIds: number[]): Promise<Duplicada[]> {
  if (!empresaIds.length) return [];
  const { rows } = await db.query<Duplicada>(
    `WITH tel AS (${TELEFONES})
     SELECT DISTINCT ON (a.empresa_id)
            a.empresa_id::int AS "empresaId", ea.nome, b.empresa_id::int AS "outraEmpresaId",
            eb.nome AS "outraNome", o.etapa AS "outraEtapa", a.valor AS telefone
       FROM tel a
       JOIN tel b ON b.valor = a.valor AND b.empresa_id <> a.empresa_id
       JOIN comercial.oportunidades o ON o.empresa_id = b.empresa_id AND o.etapa <> 'descartado'
       JOIN descoberta.empresas ea ON ea.id = a.empresa_id
       JOIN descoberta.empresas eb ON eb.id = b.empresa_id
      WHERE a.empresa_id = ANY($1::bigint[])
      ORDER BY a.empresa_id, o.atualizado_em DESC`,
    [empresaIds],
  );
  return rows;
}

async function proximaPosicao(db: Executor, etapa: EtapaFunil): Promise<number> {
  const { rows } = await db.query<{ p: number }>(
    'SELECT coalesce(max(posicao), 0) + 1 AS p FROM comercial.oportunidades WHERE etapa = $1',
    [etapa],
  );
  return Number(rows[0]?.p ?? 1);
}

async function registrarEtapa(
  db: Executor,
  empresaId: number,
  de: EtapaFunil | null,
  para: EtapaFunil,
  autor: string,
  texto: string | null = null,
) {
  await db.query(
    `INSERT INTO comercial.atividades (empresa_id, tipo, de_etapa, para_etapa, texto, autor)
     VALUES ($1, 'etapa', $2, $3, $4, $5)`,
    [empresaId, de, para, texto, autor],
  );
}

/** Cria a oportunidade guardando de onde veio e a nota do momento. */
async function criarOportunidade(
  db: Executor,
  empresaId: number,
  etapa: EtapaFunil,
  motivo: string | null,
  autor: string,
) {
  const posicao = await proximaPosicao(db, etapa);
  const { rowCount } = await db.query(
    `INSERT INTO comercial.oportunidades (empresa_id, campanha_id, etapa, posicao, motivo, faixa_entrada, score_entrada)
     SELECT e.id,
            (SELECT ce.campanha_id FROM descoberta.campanha_empresas ce WHERE ce.empresa_id = e.id
              ORDER BY ce.adicionada_em LIMIT 1),
            $2, $3, $4, l.faixa, l.score
       FROM descoberta.empresas e
       LEFT JOIN enriquecimento.leads l ON l.empresa_id = e.id
      WHERE e.id = $1
     ON CONFLICT (empresa_id) DO NOTHING`,
    [empresaId, etapa, posicao, motivo],
  );
  if (rowCount) {
    await registrarEtapa(db, empresaId, null, etapa, autor, motivo);
    await aplicarCadencia(db, empresaId, 'etapa');
  }
  return (rowCount ?? 0) > 0;
}

export interface ResultadoAdicionar {
  adicionadas: number;
  jaNoFunil: number;
  duplicadas: Duplicada[];
  naoEncontradas: number;
}

/**
 * Manda leads para o funil (ou descarta). Quem já está no funil não é duplicado; quem tem o
 * mesmo telefone de outra empresa já trabalhada fica de fora, a menos que `forcar`.
 */
export async function adicionar(pool: Pool, d: FunilAdicionar, autor: string): Promise<ResultadoAdicionar> {
  return comTransacao(pool, async (tx) => {
    const ids = [...new Set(d.empresaIds)];
    const { rows: existentes } = await tx.query<{ id: number; etapa: EtapaFunil | null }>(
      `SELECT e.id::int, o.etapa FROM descoberta.empresas e
         LEFT JOIN comercial.oportunidades o ON o.empresa_id = e.id
        WHERE e.id = ANY($1::bigint[])`,
      [ids],
    );
    const r: ResultadoAdicionar = {
      adicionadas: 0,
      jaNoFunil: 0,
      duplicadas: [],
      naoEncontradas: ids.length - existentes.length,
    };

    if (d.etapa === 'descartado') {
      for (const e of existentes) {
        if (e.etapa === 'descartado') {
          r.jaNoFunil++;
          continue;
        }
        if (e.etapa) await mover(tx, e.id, e.etapa, 'descartado', d.motivo ?? null, autor);
        else await criarOportunidade(tx, e.id, 'descartado', d.motivo ?? null, autor);
        r.adicionadas++;
      }
      return r;
    }

    const candidatas = existentes.filter((e) => e.etapa === null || e.etapa === 'descartado');
    r.jaNoFunil = existentes.length - candidatas.length;
    const bloqueadas = d.forcar
      ? []
      : await duplicadas(
          tx,
          candidatas.map((e) => e.id),
        );
    r.duplicadas = bloqueadas;
    const bloqueio = new Set(bloqueadas.map((b) => b.empresaId));
    for (const e of candidatas) {
      if (bloqueio.has(e.id)) continue;
      if (e.etapa === 'descartado') {
        await mover(tx, e.id, 'descartado', 'a_abordar', 'voltou para o funil', autor);
        await aplicarCadencia(tx, e.id, 'etapa');
      } else await criarOportunidade(tx, e.id, 'a_abordar', null, autor);
      r.adicionadas++;
    }
    return r;
  });
}

async function mover(
  db: Executor,
  empresaId: number,
  de: EtapaFunil,
  para: EtapaFunil,
  motivo: string | null,
  autor: string,
  posicao?: number,
) {
  const fechando = para === 'ganho' || para === 'perdido' || para === 'descartado';
  await db.query(
    `UPDATE comercial.oportunidades
        SET etapa = $2, etapa_desde = now(), posicao = $3,
            motivo = CASE WHEN $2 IN ('perdido', 'descartado') THEN $4 ELSE motivo END,
            proxima_acao = CASE WHEN $5 THEN NULL ELSE proxima_acao END,
            proxima_acao_em = CASE WHEN $5 THEN NULL ELSE proxima_acao_em END,
            tentativas = 0, encerrar_em = NULL
      WHERE empresa_id = $1`,
    [empresaId, para, posicao ?? (await proximaPosicao(db, para)), motivo, fechando],
  );
  await registrarEtapa(db, empresaId, de, para, autor, motivo);
}

async function etapaAtual(db: Executor, empresaId: number): Promise<EtapaFunil | null> {
  const { rows } = await db.query<{ etapa: EtapaFunil }>(
    'SELECT etapa FROM comercial.oportunidades WHERE empresa_id = $1 FOR UPDATE',
    [empresaId],
  );
  return rows[0]?.etapa ?? null;
}

/** Posição para soltar o card antes de outro (meio do caminho entre ele e o de cima). */
async function posicaoAntesDe(db: Executor, etapa: EtapaFunil, antesDe: number, empresaId: number) {
  const { rows } = await db.query<{ alvo: number | null; anterior: number | null }>(
    `SELECT a.posicao AS alvo,
            (SELECT max(o.posicao) FROM comercial.oportunidades o
              WHERE o.etapa = $1 AND o.posicao < a.posicao AND o.empresa_id <> $3) AS anterior
       FROM comercial.oportunidades a WHERE a.empresa_id = $2 AND a.etapa = $1`,
    [etapa, antesDe, empresaId],
  );
  const alvo = rows[0]?.alvo;
  if (alvo == null) return undefined;
  const anterior = rows[0]?.anterior ?? alvo - 1;
  return (Number(anterior) + Number(alvo)) / 2;
}

export async function atualizar(pool: Pool, empresaId: number, d: FunilAtualizar, autor: string) {
  await comTransacao(pool, async (tx) => {
    const atual = await etapaAtual(tx, empresaId);
    if (!atual) throw AppError.naoEncontrado('Lead no funil');
    const para = d.etapa ?? atual;
    if (para === 'perdido' && atual !== 'perdido' && !d.motivo)
      throw AppError.invalido('Diga o motivo da perda: ajuda a entender o que não funcionou.');

    const posicao = d.antesDe != null ? await posicaoAntesDe(tx, para, d.antesDe, empresaId) : undefined;
    if (para !== atual) {
      await mover(tx, empresaId, atual, para, d.motivo ?? null, autor, posicao);
      // Arrastou de etapa: o próximo passo segue a cadência (a não ser que já venha um junto).
      if (d.proximaAcao === undefined && d.proximaAcaoEm === undefined)
        await aplicarCadencia(tx, empresaId, 'etapa');
    } else if (posicao != null)
      await tx.query('UPDATE comercial.oportunidades SET posicao = $2 WHERE empresa_id = $1', [
        empresaId,
        posicao,
      ]);

    const sets: string[] = [];
    const valores: unknown[] = [empresaId];
    const set = (coluna: string, v: unknown) => {
      valores.push(v);
      sets.push(`${coluna} = $${valores.length}`);
    };
    if (d.valorMensal !== undefined) set('valor_mensal', d.valorMensal);
    if (d.proximaAcao !== undefined) set('proxima_acao', d.proximaAcao);
    if (d.proximaAcaoEm !== undefined) {
      set('proxima_acao_em', d.proximaAcaoEm);
      // Data escolhida à mão: o encerramento automático deixa de valer.
      sets.push('encerrar_em = NULL');
    }
    if (d.motivo !== undefined && para === atual) set('motivo', d.motivo);
    if (sets.length)
      await tx.query(`UPDATE comercial.oportunidades SET ${sets.join(', ')} WHERE empresa_id = $1`, valores);
  });
}

/**
 * Registra um contato ou nota. Se o lead ainda não está no funil, entra. A etapa avança
 * sozinha quando faz sentido: mandou mensagem → "abordado"; ele respondeu → "respondeu";
 * reunião registrada → "reunião". Nunca volta etapa.
 */
export async function registrarAtividade(
  pool: Pool,
  empresaId: number,
  d: AtividadeEntrada,
  autor: string,
): Promise<{ etapa: EtapaFunil }> {
  return comTransacao(pool, async (tx) => {
    let atual = await etapaAtual(tx, empresaId);
    if (!atual) {
      const criada = await criarOportunidade(tx, empresaId, 'a_abordar', null, autor);
      if (!criada) throw AppError.naoEncontrado('Empresa');
      atual = 'a_abordar';
    }
    await tx.query(
      `INSERT INTO comercial.atividades (empresa_id, tipo, direcao, texto, contato, autor)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [empresaId, d.tipo, d.tipo === 'nota' ? null : d.direcao, d.texto ?? null, d.contato ?? null, autor],
    );

    let para: EtapaFunil = atual;
    if (d.tipo !== 'nota' && ORDEM_ETAPA[atual] < ORDEM_ETAPA.ganho) {
      const alvo: EtapaFunil =
        d.tipo === 'reuniao' ? 'reuniao' : d.direcao === 'recebida' ? 'respondeu' : 'abordado';
      if (ORDEM_ETAPA[alvo] > ORDEM_ETAPA[atual]) para = alvo;
    }
    if (para !== atual) await mover(tx, empresaId, atual, para, null, autor);
    // Próximo passo automático: follow-up depois de mensagem sem resposta, responder no mesmo
    // dia quando ele responde, mandar proposta depois da reunião.
    if (d.tipo !== 'nota' && ORDEM_ETAPA[para] < ORDEM_ETAPA.ganho)
      await aplicarCadencia(
        tx,
        empresaId,
        d.tipo === 'reuniao' ? 'reuniao' : d.direcao === 'recebida' ? 'recebida' : 'enviada',
      );

    const sets = d.tipo === 'nota' ? [] : ['ultimo_contato_em = now()'];
    const valores: unknown[] = [empresaId];
    if (d.proximaAcao !== undefined) {
      valores.push(d.proximaAcao);
      sets.push(`proxima_acao = $${valores.length}`);
    }
    if (d.proximaAcaoEm !== undefined) {
      valores.push(d.proximaAcaoEm);
      sets.push(`proxima_acao_em = $${valores.length}`, 'encerrar_em = NULL');
    }
    if (sets.length)
      await tx.query(`UPDATE comercial.oportunidades SET ${sets.join(', ')} WHERE empresa_id = $1`, valores);
    return { etapa: para };
  });
}

export async function remover(db: Executor, empresaId: number): Promise<boolean> {
  const { rowCount } = await db.query('DELETE FROM comercial.oportunidades WHERE empresa_id = $1', [
    empresaId,
  ]);
  return (rowCount ?? 0) > 0;
}

/** Oportunidade, histórico e avisos de duplicidade de uma empresa (para a ficha). */
export async function detalhe(db: Executor, empresaId: number) {
  const [op, atividades, dup] = await Promise.all([
    db.query(
      `SELECT o.etapa, o.motivo, o.valor_mensal::float8 AS "valorMensal", o.proxima_acao AS "proximaAcao",
              o.proxima_acao_em AS "proximaAcaoEm", o.ultimo_contato_em AS "ultimoContatoEm",
              o.etapa_desde AS "etapaDesde", o.criado_em AS "criadoEm", o.faixa_entrada AS "faixaEntrada",
              o.campanha_id AS "campanhaId", (o.proxima_acao_em < ${FIM_DE_HOJE}) AS pendente,
              o.tentativas, o.encerrar_em AS "encerrarEm"
         FROM comercial.oportunidades o WHERE o.empresa_id = $1`,
      [empresaId],
    ),
    db.query(
      `SELECT id, tipo, direcao, texto, contato, de_etapa AS "deEtapa", para_etapa AS "paraEtapa", autor,
              criado_em AS "em"
         FROM comercial.atividades WHERE empresa_id = $1 ORDER BY criado_em DESC, id DESC LIMIT 200`,
      [empresaId],
    ),
    duplicadas(db, [empresaId]),
  ]);
  return { oportunidade: op.rows[0] ?? null, atividades: atividades.rows, duplicada: dup[0] ?? null };
}

/** Cards do quadro (sem os descartados), com o que precisa para decidir o próximo passo. */
export async function quadro(db: Executor, f: FiltrosFunil) {
  const where = [`o.etapa <> 'descartado'`];
  const valores: unknown[] = [];
  const p = (v: unknown) => {
    valores.push(v);
    return `$${valores.length}`;
  };
  if (f.campanhaId)
    where.push(
      `EXISTS (SELECT 1 FROM descoberta.campanha_empresas ce WHERE ce.empresa_id = o.empresa_id AND ce.campanha_id = ${p(f.campanhaId)})`,
    );
  if (f.faixa) where.push(`l.faixa = ${p(f.faixa)}`);
  if (f.busca) {
    const termo = p(`%${f.busca}%`);
    where.push(`(e.nome ILIKE ${termo} OR e.razao_social ILIKE ${termo})`);
  }
  if (f.pendentes) where.push(`o.proxima_acao_em < ${FIM_DE_HOJE} AND o.etapa NOT IN ('ganho', 'perdido')`);

  const { rows } = await db.query(
    `SELECT o.empresa_id::int AS "empresaId", o.etapa, o.posicao, o.proxima_acao AS "proximaAcao",
            o.proxima_acao_em AS "proximaAcaoEm", (o.proxima_acao_em < ${FIM_DE_HOJE}) AS pendente,
            o.ultimo_contato_em AS "ultimoContatoEm", o.etapa_desde AS "etapaDesde",
            o.valor_mensal::float8 AS "valorMensal", o.motivo, o.tentativas, o.encerrar_em AS "encerrarEm",
            e.nome, e.cidade, e.uf, e.maps_categoria AS "categoria",
            l.faixa, l.score, dec.nome AS "decisorNome", dec.cargo AS "decisorCargo",
            pc.canal AS "contatoCanal", pc.valor AS "contatoValor", pc.status AS "contatoStatus",
            coalesce(pc.valor, e.maps_telefone) AS "telefone",
            (SELECT count(*)::int FROM comercial.atividades a
              WHERE a.empresa_id = o.empresa_id AND a.tipo <> 'etapa') AS contatos
       FROM comercial.oportunidades o
       JOIN descoberta.empresas e ON e.id = o.empresa_id
       ${JUNCOES_ENRIQ}
      WHERE ${where.join(' AND ')}
      ORDER BY o.posicao, o.empresa_id
      LIMIT 2000`,
    valores,
  );
  const resumo = await db.query<{ pendentes: number; descartados: number }>(
    `SELECT count(*) FILTER (WHERE proxima_acao_em < ${FIM_DE_HOJE}
                               AND etapa NOT IN ('ganho', 'perdido', 'descartado'))::int AS pendentes,
            count(*) FILTER (WHERE etapa = 'descartado')::int AS descartados
       FROM comercial.oportunidades`,
  );
  const cfg = await obterConfig(db);
  return { cards: rows, ...resumo.rows[0], totalTentativas: cfg.diasFollowup.length + 1 };
}

/** Contagem leve para o menu: follow-ups vencidos ou para hoje. */
export async function resumo(db: Executor): Promise<{ pendentes: number }> {
  const { rows } = await db.query<{ pendentes: number }>(
    `SELECT count(*)::int AS pendentes FROM comercial.oportunidades
      WHERE proxima_acao_em < ${FIM_DE_HOJE} AND etapa NOT IN ('ganho', 'perdido', 'descartado')`,
  );
  return rows[0] ?? { pendentes: 0 };
}

/**
 * Quem recebeu a última tentativa e não respondeu até o prazo vai para "Perdido: sem resposta".
 * Roda de tempos em tempos (ver automacao.ts). Devolve quantos foram encerrados.
 */
export async function encerrarSemResposta(pool: Pool): Promise<number> {
  return comTransacao(pool, async (tx) => {
    const { rows } = await tx.query<{ empresa_id: number; tentativas: number }>(
      `SELECT o.empresa_id::int, o.tentativas FROM comercial.oportunidades o
        WHERE o.etapa = 'abordado' AND o.encerrar_em < now()
          AND (SELECT encerrar_sem_resposta FROM comercial.config_cadencia LIMIT 1)
        ORDER BY o.encerrar_em
        LIMIT 500
        FOR UPDATE SKIP LOCKED`,
    );
    for (const o of rows)
      await mover(
        tx,
        o.empresa_id,
        'abordado',
        'perdido',
        `Sem resposta após ${o.tentativas} ${o.tentativas === 1 ? 'mensagem' : 'mensagens'}`,
        'sistema',
      );
    return rows.length;
  });
}
