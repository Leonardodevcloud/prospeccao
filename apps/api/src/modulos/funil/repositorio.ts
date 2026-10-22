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
import { contaSql, usuarioAtual } from '../../contexto.js';
import { criarReuniaoDoLead } from '../agenda/repositorio.js';
import { pararSequencia } from '../email/sequencia.js';
import { daConta, juncoesEnriq } from '../empresas/repositorio.js';
import { atribuirNaEntrada, atribuirNaReuniao, definirResponsavel } from '../equipe/repositorio.js';
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
  const C = contaSql();
  const { rows } = await db.query<Duplicada>(
    `WITH tel AS (${TELEFONES})
     SELECT DISTINCT ON (a.empresa_id)
            a.empresa_id::int AS "empresaId", ea.nome, b.empresa_id::int AS "outraEmpresaId",
            eb.nome AS "outraNome", o.etapa AS "outraEtapa", a.valor AS telefone
       FROM tel a
       JOIN tel b ON b.valor = a.valor AND b.empresa_id <> a.empresa_id
       JOIN comercial.oportunidades o
         ON o.conta_id = ${C} AND o.empresa_id = b.empresa_id AND o.etapa <> 'descartado'
       JOIN descoberta.empresas ea ON ea.id = a.empresa_id
       JOIN descoberta.empresas eb ON eb.id = b.empresa_id
      WHERE a.empresa_id = ANY($1::bigint[])
      ORDER BY a.empresa_id, o.atualizado_em DESC`,
    [empresaIds],
  );
  return rows;
}

async function proximaPosicao(db: Executor, etapaId: number | null, papel: EtapaFunil): Promise<number> {
  const { rows } = await db.query<{ p: number }>(
    `SELECT coalesce(max(posicao), 0) + 1 AS p FROM comercial.oportunidades
      WHERE conta_id = ${contaSql()}
        AND (($1::int IS NOT NULL AND etapa_id = $1) OR ($1::int IS NULL AND etapa = $2))`,
    [etapaId, papel],
  );
  return Number(rows[0]?.p ?? 1);
}

export interface EtapaResolvida {
  id: number;
  nome: string;
  papel: EtapaFunil;
  pipelineId: number;
}

export async function obterEtapa(db: Executor, etapaId: number): Promise<EtapaResolvida | null> {
  const { rows } = await db.query<EtapaResolvida>(
    `SELECT id, nome, papel, pipeline_id AS "pipelineId" FROM comercial.etapas
      WHERE id = $1 AND conta_id = ${contaSql()}`,
    [etapaId],
  );
  return rows[0] ?? null;
}

/**
 * Etapa para um papel: a primeira com esse papel no pipeline em que o lead está; se o pipeline
 * não tem (ex.: reunião no SDR), a do primeiro pipeline que tem (o lead passa para o Closer).
 * Descartado não tem etapa (sai do quadro).
 */
export async function resolverEtapa(
  db: Executor,
  empresaId: number,
  papel: EtapaFunil,
): Promise<EtapaResolvida | null> {
  if (papel === 'descartado') return null;
  const C = contaSql();
  const { rows } = await db.query<EtapaResolvida>(
    `SELECT et.id, et.nome, et.papel, et.pipeline_id AS "pipelineId"
       FROM comercial.etapas et JOIN comercial.pipelines p ON p.id = et.pipeline_id
      WHERE et.conta_id = ${C} AND et.papel = $2
      ORDER BY (et.pipeline_id = (SELECT e2.pipeline_id FROM comercial.oportunidades o
                                   JOIN comercial.etapas e2 ON e2.id = o.etapa_id
                                  WHERE o.conta_id = ${C} AND o.empresa_id = $1)) IS NOT TRUE,
               p.ordem, et.ordem
      LIMIT 1`,
    [empresaId, papel],
  );
  return rows[0] ?? null;
}

async function nomeEtapaAtual(db: Executor, empresaId: number): Promise<string | null> {
  const { rows } = await db.query<{ nome: string }>(
    `SELECT et.nome FROM comercial.oportunidades o JOIN comercial.etapas et ON et.id = o.etapa_id
      WHERE o.conta_id = ${contaSql()} AND o.empresa_id = $1`,
    [empresaId],
  );
  return rows[0]?.nome ?? null;
}

async function registrarEtapa(
  db: Executor,
  empresaId: number,
  de: EtapaFunil | null,
  para: EtapaFunil,
  autor: string,
  texto: string | null = null,
  nomes: { de?: string | null; para?: string | null } = {},
) {
  // Quem moveu; se foi o sistema (IA, cadência), conta para o dono do lead naquele momento.
  const C = contaSql();
  await db.query(
    `INSERT INTO comercial.atividades
       (conta_id, empresa_id, tipo, de_etapa, para_etapa, texto, autor, de_nome, para_nome, usuario_id)
     VALUES (${C}, $1, 'etapa', $2, $3, $4, $5, $6, $7,
             coalesce($8, (SELECT responsavel_id FROM comercial.oportunidades
                            WHERE conta_id = ${C} AND empresa_id = $1)))`,
    [empresaId, de, para, texto, autor, nomes.de ?? null, nomes.para ?? null, usuarioAtual()?.id ?? null],
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
  const alvo = await resolverEtapa(db, empresaId, etapa);
  const posicao = await proximaPosicao(db, alvo?.id ?? null, etapa);
  const C = contaSql();
  // Só entra empresa que alguma campanha da conta achou (a base de empresas é de todas as contas).
  const { rowCount } = await db.query(
    `INSERT INTO comercial.oportunidades
       (conta_id, empresa_id, campanha_id, etapa, etapa_id, posicao, motivo, faixa_entrada, score_entrada)
     SELECT ${C}, e.id, ce.campanha_id, $2, $5, $3, $4, l.faixa, l.score
       FROM descoberta.empresas e
       JOIN LATERAL (
         SELECT x.campanha_id FROM descoberta.campanha_empresas x
          WHERE x.empresa_id = e.id AND x.conta_id = ${C}
          ORDER BY x.adicionada_em LIMIT 1
       ) ce ON true
       LEFT JOIN enriquecimento.leads l ON l.empresa_id = e.id
      WHERE e.id = $1
     ON CONFLICT (conta_id, empresa_id) DO NOTHING`,
    [empresaId, etapa, posicao, motivo, alvo?.id ?? null],
  );
  if (rowCount) {
    await registrarEtapa(db, empresaId, null, etapa, autor, motivo, { para: alvo?.nome });
    await aplicarCadencia(db, empresaId, 'etapa');
    if (etapa !== 'descartado') await atribuirNaEntrada(db, empresaId);
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
    const C = contaSql();
    const { rows: existentes } = await tx.query<{ id: number; etapa: EtapaFunil | null }>(
      `SELECT e.id::int, o.etapa FROM descoberta.empresas e
         LEFT JOIN comercial.oportunidades o ON o.conta_id = ${C} AND o.empresa_id = e.id
        WHERE e.id = ANY($1::bigint[]) AND ${daConta('e.id')}`,
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
  etapaId?: number,
) {
  const fechando = para === 'ganho' || para === 'perdido' || para === 'descartado';
  const alvo = etapaId ? await obterEtapa(db, etapaId) : await resolverEtapa(db, empresaId, para);
  const deNome = await nomeEtapaAtual(db, empresaId);
  await db.query(
    `UPDATE comercial.oportunidades
        SET etapa = $2, etapa_id = $6, etapa_desde = now(), posicao = $3,
            motivo = CASE WHEN $2 IN ('perdido', 'descartado') THEN $4 ELSE motivo END,
            proxima_acao = CASE WHEN $5 THEN NULL ELSE proxima_acao END,
            proxima_acao_em = CASE WHEN $5 THEN NULL ELSE proxima_acao_em END,
            tentativas = 0, encerrar_em = NULL
      WHERE conta_id = ${contaSql()} AND empresa_id = $1`,
    [
      empresaId,
      para,
      posicao ?? (await proximaPosicao(db, alvo?.id ?? null, para)),
      motivo,
      fechando,
      alvo?.id ?? null,
    ],
  );
  await registrarEtapa(db, empresaId, de, para, autor, motivo, { de: deNome, para: alvo?.nome });
  // Lead que respondeu, avançou ou fechou sai da sequência automática (e-mail, WhatsApp, ligação).
  if (ORDEM_ETAPA[para] > ORDEM_ETAPA.abordado || fechando)
    await pararSequencia(db, empresaId, `Foi para ${alvo?.nome ?? para}`);
  // Dono: reunião marcada passa para o closer; quem volta do descarte entra no rodízio de novo.
  if ((para === 'reuniao' || para === 'proposta') && ORDEM_ETAPA[de] < ORDEM_ETAPA.reuniao)
    await atribuirNaReuniao(db, empresaId);
  else if (de === 'descartado' && para === 'a_abordar') {
    const { rows } = await db.query<{ r: number | null }>(
      `SELECT responsavel_id AS r FROM comercial.oportunidades WHERE conta_id = ${contaSql()} AND empresa_id = $1`,
      [empresaId],
    );
    if (!rows[0]?.r) await atribuirNaEntrada(db, empresaId);
  }
}

/** Troca de etapa com o mesmo papel (ex.: Proposta enviada → Negociação): a cadência continua. */
async function trocarEtapa(
  db: Executor,
  empresaId: number,
  papel: EtapaFunil,
  alvo: EtapaResolvida,
  autor: string,
  posicao?: number,
) {
  const deNome = await nomeEtapaAtual(db, empresaId);
  await db.query(
    `UPDATE comercial.oportunidades SET etapa_id = $2, etapa_desde = now(), posicao = $3
      WHERE conta_id = ${contaSql()} AND empresa_id = $1`,
    [empresaId, alvo.id, posicao ?? (await proximaPosicao(db, alvo.id, papel))],
  );
  await registrarEtapa(db, empresaId, papel, papel, autor, null, { de: deNome, para: alvo.nome });
}

async function etapaAtual(db: Executor, empresaId: number): Promise<EtapaFunil | null> {
  const { rows } = await db.query<{ etapa: EtapaFunil }>(
    `SELECT etapa FROM comercial.oportunidades WHERE conta_id = ${contaSql()} AND empresa_id = $1 FOR UPDATE`,
    [empresaId],
  );
  return rows[0]?.etapa ?? null;
}

/** Posição para soltar o card antes de outro (meio do caminho entre ele e o de cima). */
async function posicaoAntesDe(db: Executor, antesDe: number, empresaId: number) {
  const C = contaSql();
  const { rows } = await db.query<{ alvo: number | null; anterior: number | null }>(
    `SELECT a.posicao AS alvo,
            (SELECT max(o.posicao) FROM comercial.oportunidades o
              WHERE o.conta_id = ${C} AND o.etapa_id IS NOT DISTINCT FROM a.etapa_id
                AND o.posicao < a.posicao AND o.empresa_id <> $2) AS anterior
       FROM comercial.oportunidades a WHERE a.conta_id = ${C} AND a.empresa_id = $1`,
    [antesDe, empresaId],
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
    const destino = d.etapaId ? await obterEtapa(tx, d.etapaId) : null;
    if (d.etapaId && !destino) throw AppError.naoEncontrado('Etapa');
    const para = destino?.papel ?? d.etapa ?? atual;
    if (para === 'perdido' && atual !== 'perdido' && !d.motivo)
      throw AppError.invalido('Diga o motivo da perda: ajuda a entender o que não funcionou.');

    const posicao = d.antesDe != null ? await posicaoAntesDe(tx, d.antesDe, empresaId) : undefined;
    const { rows: atualId } = await tx.query<{ etapa_id: number | null }>(
      `SELECT etapa_id FROM comercial.oportunidades WHERE conta_id = ${contaSql()} AND empresa_id = $1`,
      [empresaId],
    );
    if (destino && para === atual && destino.id !== atualId[0]?.etapa_id) {
      await trocarEtapa(tx, empresaId, para, destino, autor, posicao);
    } else if (para !== atual) {
      await mover(tx, empresaId, atual, para, d.motivo ?? null, autor, posicao, destino?.id);
      // Arrastou de etapa: o próximo passo segue a cadência (a não ser que já venha um junto).
      if (d.proximaAcao === undefined && d.proximaAcaoEm === undefined)
        await aplicarCadencia(tx, empresaId, 'etapa');
    } else if (posicao != null)
      await tx.query(
        `UPDATE comercial.oportunidades SET posicao = $2 WHERE conta_id = ${contaSql()} AND empresa_id = $1`,
        [empresaId, posicao],
      );

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
    if (d.agente !== undefined) {
      set('agente', d.agente);
      sets.push('agente_pausa = NULL', 'agente_resumo = NULL');
    }
    if (d.devolverParaIa) sets.push('agente_pausa = NULL', 'agente_resumo = NULL');
    if (d.etiquetas !== undefined) set('etiquetas', [...new Set(d.etiquetas)]);
    if (sets.length)
      await tx.query(
        `UPDATE comercial.oportunidades SET ${sets.join(', ')} WHERE conta_id = ${contaSql()} AND empresa_id = $1`,
        valores,
      );
    if (d.responsavelId !== undefined) await definirResponsavel(tx, empresaId, d.responsavelId);
    if (d.reuniao) await criarReuniaoDoLead(tx, empresaId, d.reuniao.inicio, d.reuniao.local ?? null);
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
      `INSERT INTO comercial.atividades (conta_id, empresa_id, tipo, direcao, texto, contato, autor, usuario_id)
       VALUES (${contaSql()}, $1, $2, $3, $4, $5, $6, $7)`,
      [
        empresaId,
        d.tipo,
        d.tipo === 'nota' ? null : d.direcao,
        d.texto ?? null,
        d.contato ?? null,
        autor,
        usuarioAtual()?.id ?? null,
      ],
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
      await tx.query(
        `UPDATE comercial.oportunidades SET ${sets.join(', ')} WHERE conta_id = ${contaSql()} AND empresa_id = $1`,
        valores,
      );
    return { etapa: para };
  });
}

export async function remover(db: Executor, empresaId: number): Promise<boolean> {
  const { rowCount } = await db.query(
    `DELETE FROM comercial.oportunidades WHERE conta_id = ${contaSql()} AND empresa_id = $1`,
    [empresaId],
  );
  return (rowCount ?? 0) > 0;
}

/** Oportunidade, histórico e avisos de duplicidade de uma empresa (para a ficha). */
export async function detalhe(db: Executor, empresaId: number) {
  const C = contaSql();
  const [op, atividades, dup] = await Promise.all([
    db.query(
      `SELECT o.etapa, o.motivo, o.valor_mensal::float8 AS "valorMensal", o.proxima_acao AS "proximaAcao",
              o.proxima_acao_em AS "proximaAcaoEm", o.ultimo_contato_em AS "ultimoContatoEm",
              o.etapa_desde AS "etapaDesde", o.criado_em AS "criadoEm", o.faixa_entrada AS "faixaEntrada",
              o.campanha_id AS "campanhaId", (o.proxima_acao_em < ${FIM_DE_HOJE}) AS pendente,
              o.tentativas, o.encerrar_em AS "encerrarEm", o.agente, o.agente_pausa AS "agentePausa",
              o.etapa_id AS "etapaId", et.nome AS "etapaNome", et.cor AS "etapaCor", p.nome AS "pipelineNome",
              o.etiquetas, o.responsavel_id AS "responsavelId", u.nome AS "responsavelNome"
         FROM comercial.oportunidades o
         LEFT JOIN cadastro.usuarios u ON u.id = o.responsavel_id
         LEFT JOIN comercial.etapas et ON et.id = o.etapa_id
         LEFT JOIN comercial.pipelines p ON p.id = et.pipeline_id
        WHERE o.conta_id = ${C} AND o.empresa_id = $1`,
      [empresaId],
    ),
    db.query(
      `SELECT a.id, a.tipo, a.direcao, a.texto, a.contato, a.de_etapa AS "deEtapa", a.para_etapa AS "paraEtapa",
              CASE WHEN a.tipo = 'etapa' AND a.autor IN ('agente', 'sistema') THEN a.autor
                   ELSE coalesce(u.nome, a.autor) END AS autor,
              a.de_nome AS "deNome", a.para_nome AS "paraNome", a.criado_em AS "em"
         FROM comercial.atividades a LEFT JOIN cadastro.usuarios u ON u.id = a.usuario_id
        WHERE a.conta_id = ${C} AND a.empresa_id = $1 ORDER BY a.criado_em DESC, a.id DESC LIMIT 200`,
      [empresaId],
    ),
    duplicadas(db, [empresaId]),
  ]);
  return { oportunidade: op.rows[0] ?? null, atividades: atividades.rows, duplicada: dup[0] ?? null };
}

/** Cards do quadro (sem os descartados), com o que precisa para decidir o próximo passo. */
const ORDEM_QUADRO: Record<FiltrosFunil['ordem'], string> = {
  manual: 'o.posicao, o.empresa_id',
  recentes: 'o.criado_em DESC, o.empresa_id',
  proximo: 'o.proxima_acao_em ASC NULLS LAST, o.posicao',
  nota: 'l.score DESC NULLS LAST, o.posicao',
  contato: 'o.ultimo_contato_em DESC NULLS LAST, o.posicao',
  valor: 'o.valor_mensal DESC NULLS LAST, o.posicao',
};

export async function quadro(db: Executor, f: FiltrosFunil) {
  const valores: unknown[] = [];
  const p = (v: unknown) => {
    valores.push(v);
    return `$${valores.length}`;
  };
  const C = contaSql();
  // Pipeline do quadro: o pedido ou o primeiro.
  const { rows: pip } = await db.query<{ id: number }>(
    `SELECT id FROM comercial.pipelines WHERE conta_id = ${C} AND ($1::int IS NULL OR id = $1)
      ORDER BY ordem, id LIMIT 1`,
    [f.pipelineId ?? null],
  );
  const pipelineId = pip[0]?.id ?? null;
  const where = [
    `o.conta_id = ${C}`,
    `o.etapa <> 'descartado'`,
    `o.etapa_id IN (SELECT id FROM comercial.etapas WHERE pipeline_id = ${p(pipelineId)})`,
  ];
  if (f.etiqueta) where.push(`${p(f.etiqueta)} = ANY(o.etiquetas)`);
  if (f.responsavel === 'sem') where.push('o.responsavel_id IS NULL');
  else if (f.responsavel) where.push(`o.responsavel_id = ${p(Number(f.responsavel))}`);
  if (f.dias) where.push(`o.criado_em >= now() - make_interval(days => ${p(f.dias)})`);
  if (f.campanhaId)
    where.push(
      `EXISTS (SELECT 1 FROM descoberta.campanha_empresas ce
                WHERE ce.empresa_id = o.empresa_id AND ce.conta_id = ${C} AND ce.campanha_id = ${p(f.campanhaId)})`,
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
            o.agente, o.agente_pausa AS "agentePausa", o.etapa_id AS "etapaId", o.etiquetas,
            o.criado_em AS "criadoEm", o.responsavel_id AS "responsavelId", resp.nome AS "responsavelNome",
            (SELECT count(*)::int FROM comercial.mensagens m
              WHERE m.conta_id = ${C} AND m.empresa_id = o.empresa_id AND m.direcao = 'recebida'
                AND m.lida_em IS NULL) AS "naoLidas",
            -- negociação com pessoas indicadas: com quem a conversa segue e quantos contatos
            (SELECT cl.nome || coalesce(' · ' || cl.cargo, '') FROM comercial.contatos_lead cl
              WHERE cl.conta_id = ${C} AND cl.empresa_id = o.empresa_id AND cl.status = 'confirmado'
                AND o.whatsapp_destino IS NOT NULL AND left(cl.telefone, 2) = left(o.whatsapp_destino, 2)
                AND right(cl.telefone, 8) = right(o.whatsapp_destino, 8) LIMIT 1) AS "falandoCom",
            (SELECT count(*) FILTER (WHERE cl.status = 'confirmado')::int FROM comercial.contatos_lead cl
              WHERE cl.conta_id = ${C} AND cl.empresa_id = o.empresa_id) AS "contatosNegociacao",
            (SELECT count(*) FILTER (WHERE cl.status = 'sugerido')::int FROM comercial.contatos_lead cl
              WHERE cl.conta_id = ${C} AND cl.empresa_id = o.empresa_id) AS "indicacoesNovas",
            (SELECT min(t.inicio) FROM comercial.tarefas t
              WHERE t.conta_id = ${C} AND t.empresa_id = o.empresa_id AND t.tipo IN ('reuniao', 'visita')
                AND t.concluida_em IS NULL
                AND t.inicio > now() - interval '2 hours') AS "reuniaoEm",
            e.nome, e.cidade, e.uf, coalesce(e.maps_categoria, l.maps_categoria) AS "categoria",
            l.faixa, l.score,
            -- decisor confirmado na negociação vale mais que o do enriquecimento
            coalesce((SELECT cl.nome FROM comercial.contatos_lead cl
                       WHERE cl.conta_id = ${C} AND cl.empresa_id = o.empresa_id AND cl.decisor LIMIT 1), dec.nome) AS "decisorNome",
            coalesce((SELECT cl.cargo FROM comercial.contatos_lead cl
                       WHERE cl.conta_id = ${C} AND cl.empresa_id = o.empresa_id AND cl.decisor LIMIT 1), dec.cargo) AS "decisorCargo",
            pc.canal AS "contatoCanal", pc.valor AS "contatoValor", pc.status AS "contatoStatus",
            coalesce(o.whatsapp_destino, pc.valor, e.maps_telefone) AS "telefone",
            (SELECT count(*)::int FROM comercial.atividades a
              WHERE a.conta_id = ${C} AND a.empresa_id = o.empresa_id AND a.tipo NOT IN ('etapa', 'nota')) AS contatos,
            ult.texto AS "ultimaDoLead", ult.criado_em AS "ultimaDoLeadEm"
       FROM comercial.oportunidades o
       LEFT JOIN LATERAL (
         SELECT a.texto, a.criado_em FROM comercial.atividades a
          WHERE a.conta_id = ${C} AND a.empresa_id = o.empresa_id AND a.direcao = 'recebida'
          ORDER BY a.criado_em DESC LIMIT 1
       ) ult ON true
       JOIN descoberta.empresas e ON e.id = o.empresa_id
       LEFT JOIN cadastro.usuarios resp ON resp.id = o.responsavel_id
       ${juncoesEnriq()}
      WHERE ${where.join(' AND ')}
      ORDER BY ${ORDEM_QUADRO[f.ordem]}
      LIMIT 2000`,
    valores,
  );
  const resumo = await db.query<{ pendentes: number; descartados: number }>(
    `SELECT count(*) FILTER (WHERE proxima_acao_em < ${FIM_DE_HOJE}
                               AND etapa NOT IN ('ganho', 'perdido', 'descartado'))::int AS pendentes,
            count(*) FILTER (WHERE etapa = 'descartado')::int AS descartados
       FROM comercial.oportunidades WHERE conta_id = ${C}`,
  );
  const cfg = await obterConfig(db);
  const { rows: etiquetas } = await db.query<{ e: string }>(
    `SELECT DISTINCT unnest(etiquetas) AS e FROM comercial.oportunidades WHERE conta_id = ${C} ORDER BY 1 LIMIT 100`,
  );
  return {
    pipelineId,
    cards: rows,
    ...resumo.rows[0],
    totalTentativas: cfg.diasFollowup.length + 1,
    etiquetas: etiquetas.map((x) => x.e),
  };
}

/** Contagem leve para o menu: follow-ups vencidos ou para hoje (só os seus, se informado). */
export async function resumo(db: Executor, usuarioId: number | null = null): Promise<{ pendentes: number }> {
  const { rows } = await db.query<{ pendentes: number }>(
    `SELECT count(*)::int AS pendentes FROM comercial.oportunidades
      WHERE conta_id = ${contaSql()} AND proxima_acao_em < ${FIM_DE_HOJE}
        AND etapa NOT IN ('ganho', 'perdido', 'descartado')
        AND ($1::int IS NULL OR responsavel_id = $1)`,
    [usuarioId],
  );
  return rows[0] ?? { pendentes: 0 };
}

/**
 * Quem recebeu a última tentativa e não respondeu até o prazo vai para "Perdido: sem resposta".
 * Roda de tempos em tempos (ver automacao.ts). Devolve quantos foram encerrados.
 */
export async function encerrarSemResposta(pool: Pool): Promise<number> {
  return comTransacao(pool, async (tx) => {
    const C = contaSql();
    const { rows } = await tx.query<{ empresa_id: number; tentativas: number }>(
      `SELECT o.empresa_id::int, o.tentativas FROM comercial.oportunidades o
        WHERE o.conta_id = ${C} AND o.etapa = 'abordado' AND o.encerrar_em < now()
          AND (SELECT encerrar_sem_resposta FROM comercial.config_cadencia WHERE conta_id = ${C})
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
