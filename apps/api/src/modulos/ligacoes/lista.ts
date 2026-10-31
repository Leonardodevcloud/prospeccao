import type { Executor, Pool } from '@prospeccao/db';
import {
  AppError,
  HORARIO_DE_LIGAR,
  horarioDeLigar,
  type ListaLigacaoEntrada,
  MAX_TENTATIVAS_LISTA,
  type ResultadoLigacao,
} from '@prospeccao/shared';
import { contaSql, naBase, usuarioAtual } from '../../contexto.js';
import { exigirMinutos, exigirModulo, telefonesDosLeads } from './servico.js';

/**
 * Lista de ligação: o comercial escolhe os leads e o CRM disca um depois do outro (ou até 3 ao
 * mesmo tempo). O navegador pede o próximo item (reservado para ele), liga e, no fim, o resultado
 * marca o item; quem não atendeu volta para o fim da lista com o próximo número do lead.
 */

const ABERTAS = `('ativa', 'pausada')`;

/** O relógio da lista (os testes trocam para conferir o horário de ligar). */
export const relogio = { agora: () => new Date() };

function eu(): number {
  const u = usuarioAtual();
  if (!u) throw AppError.naoAutorizado();
  return u.id;
}

/** Leads que dá para pôr numa lista: os do funil em aberto, com o melhor número de cada um. */
export async function candidatos(db: Executor, f: { etapaId?: number | null; responsavel: number | null }) {
  const valores: unknown[] = [];
  const where = [
    `o.conta_id = ${contaSql()}`,
    `o.etapa NOT IN ('ganho', 'perdido', 'descartado')`,
    'o.nao_ligar_em IS NULL',
    naBase('o'),
  ];
  if (f.etapaId) {
    valores.push(f.etapaId);
    where.push(`o.etapa_id = $${valores.length}`);
  }
  if (f.responsavel) {
    valores.push(f.responsavel);
    where.push(`o.responsavel_id = $${valores.length}`);
  }
  const { rows } = await db.query<{
    empresaId: number;
    nome: string;
    etapa: string;
    etapaNome: string | null;
    proximaAcaoEm: string | null;
  }>(
    `SELECT o.empresa_id::int AS "empresaId", coalesce(e.maps_nome, e.nome) AS nome, o.etapa,
            et.nome AS "etapaNome", o.proxima_acao_em AS "proximaAcaoEm"
       FROM comercial.oportunidades o
       JOIN descoberta.empresas e ON e.id = o.empresa_id
       LEFT JOIN comercial.etapas et ON et.id = o.etapa_id
      WHERE ${where.join(' AND ')}
      ORDER BY o.proxima_acao_em ASC NULLS LAST, o.posicao, o.empresa_id
      LIMIT 200`,
    valores,
  );
  const tels = await telefonesDosLeads(
    db,
    rows.map((r) => r.empresaId),
  );
  return rows
    .map((r) => {
      const t = tels.get(r.empresaId) ?? [];
      const melhor = t.find((x) => x.ordem === 1) ?? null;
      return {
        ...r,
        telefone: melhor?.numero ?? null,
        tipo: melhor?.tipo ?? null,
        numeros: t.filter((x) => !x.errado).length,
        tentativas: t.reduce((s, x) => s + x.tentativas, 0),
      };
    })
    .filter((r) => r.telefone);
}

/** A lista em andamento desta pessoa (com os itens), ou null. */
export async function atual(db: Executor) {
  const { rows } = await db.query<{
    id: number;
    nome: string;
    linhas: number;
    tentarProximo: boolean;
    pausaSegundos: number;
    situacao: 'ativa' | 'pausada';
    criadaEm: string;
  }>(
    `SELECT id::int, nome, linhas, tentar_proximo AS "tentarProximo", pausa_segundos AS "pausaSegundos",
            situacao, criada_em AS "criadaEm"
       FROM comercial.listas_ligacao
      WHERE conta_id = ${contaSql()} AND usuario_id = $1 AND situacao IN ${ABERTAS}`,
    [eu()],
  );
  const l = rows[0];
  if (!l) return null;
  const { rows: itens } = await db.query(
    `SELECT i.id::int, i.empresa_id::int AS "empresaId", coalesce(e.maps_nome, e.nome) AS nome, i.telefone,
            i.situacao, i.resultado, i.tentativa, i.ligacao_id::int AS "ligacaoId",
            lg.duracao_segundos AS "duracaoSegundos", lg.situacao AS "situacaoLigacao"
       FROM comercial.lista_ligacao_itens i
       JOIN descoberta.empresas e ON e.id = i.empresa_id
       LEFT JOIN comercial.ligacoes lg ON lg.id = i.ligacao_id
      WHERE i.lista_id = $1
      ORDER BY CASE i.situacao WHEN 'chamando' THEN 0 WHEN 'retornar' THEN 1 WHEN 'na_fila' THEN 2 ELSE 3 END,
               CASE WHEN i.situacao IN ('feito', 'pulado') THEN -extract(epoch FROM i.atualizado_em) ELSE i.ordem END`,
    [l.id],
  );
  return { ...l, itens, foraDoHorario: !horarioDeLigar(relogio.agora()), horario: HORARIO_DE_LIGAR };
}

async function minhaLista(db: Executor, id: number) {
  const { rows } = await db.query<{ id: number; situacao: string; tentar_proximo: boolean }>(
    `SELECT id::int, situacao, tentar_proximo FROM comercial.listas_ligacao
      WHERE id = $1 AND conta_id = ${contaSql()} AND usuario_id = $2`,
    [id, eu()],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Lista de ligação');
  return rows[0];
}

/** Monta a lista (a anterior em andamento é encerrada). Leads sem número ou com "não ligar" ficam fora. */
export async function criar(db: Executor, d: ListaLigacaoEntrada) {
  await exigirModulo(db);
  await exigirMinutos(db);
  const usuarioId = eu();
  const visiveis = await db.query<{ empresa_id: number }>(
    `SELECT empresa_id::int FROM comercial.oportunidades o
      WHERE o.conta_id = ${contaSql()} AND o.empresa_id = ANY($1::bigint[]) AND o.nao_ligar_em IS NULL
        AND ${naBase('o')}`,
    [d.empresaIds],
  );
  const ok = new Set(visiveis.rows.map((r) => r.empresa_id));
  const tels = await telefonesDosLeads(db, [...ok]);
  const itens = d.empresaIds
    .filter((id, i, a) => ok.has(id) && a.indexOf(id) === i)
    .map((id) => ({ id, telefone: tels.get(id)?.find((t) => t.ordem === 1)?.numero ?? null }))
    .filter((x): x is { id: number; telefone: string } => !!x.telefone);
  if (!itens.length) throw AppError.invalido('Nenhum dos leads escolhidos tem telefone para ligar.');
  await db.query(
    `UPDATE comercial.listas_ligacao SET situacao = 'encerrada', encerrada_em = now()
      WHERE conta_id = ${contaSql()} AND usuario_id = $1 AND situacao IN ${ABERTAS}`,
    [usuarioId],
  );
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO comercial.listas_ligacao (conta_id, usuario_id, nome, linhas, tentar_proximo, pausa_segundos)
     VALUES (${contaSql()}, $1, $2, $3, $4, $5) RETURNING id::int`,
    [
      usuarioId,
      d.nome?.trim() ||
        `Lista de ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
      d.linhas,
      d.tentarProximo,
      d.pausaSegundos,
    ],
  );
  const listaId = rows[0]!.id;
  await db.query(
    `INSERT INTO comercial.lista_ligacao_itens (lista_id, conta_id, empresa_id, telefone, ordem)
     SELECT $1, ${contaSql()}, x.empresa_id, x.telefone, x.ordem
       FROM unnest($2::bigint[], $3::text[]) WITH ORDINALITY AS x (empresa_id, telefone, ordem)`,
    [listaId, itens.map((i) => i.id), itens.map((i) => i.telefone)],
  );
  return { listaId, entraram: itens.length, ficaramFora: d.empresaIds.length - itens.length };
}

/**
 * Reserva o próximo item para ligar (quem ouviu o recado de retorno vem primeiro). Fora do horário
 * de ligar, a lista não anda.
 */
export async function proximo(db: Executor, listaId: number) {
  const l = await minhaLista(db, listaId);
  if (l.situacao !== 'ativa') throw AppError.conflito('A lista está pausada.');
  if (!horarioDeLigar(relogio.agora()))
    throw AppError.conflito(`Fora do horário de ligar (${HORARIO_DE_LIGAR}). A lista continua depois.`);
  await exigirMinutos(db);
  const { rows } = await db.query<{ id: number; empresaId: number; telefone: string; nome: string }>(
    `UPDATE comercial.lista_ligacao_itens i SET situacao = 'chamando', ligacao_id = NULL, atualizado_em = now()
      WHERE i.id = (SELECT id FROM comercial.lista_ligacao_itens
                     WHERE lista_id = $1 AND situacao IN ('retornar', 'na_fila')
                     ORDER BY (situacao = 'retornar') DESC, ordem
                     LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING i.id::int, i.empresa_id::int AS "empresaId", i.telefone,
                (SELECT coalesce(e.maps_nome, e.nome) FROM descoberta.empresas e WHERE e.id = i.empresa_id) AS nome`,
    [listaId],
  );
  return rows[0] ?? null;
}

/** A linha foi desligada antes de atender (outra atendeu): o item volta para o fim da fila. */
export async function devolver(db: Executor, itemId: number) {
  await db.query(
    `UPDATE comercial.lista_ligacao_itens i
        SET situacao = 'na_fila', atualizado_em = now(),
            ordem = (SELECT max(ordem) + 1 FROM comercial.lista_ligacao_itens x WHERE x.lista_id = i.lista_id)
      WHERE i.id = $1 AND i.conta_id = ${contaSql()} AND i.situacao = 'chamando'
        AND EXISTS (SELECT 1 FROM comercial.listas_ligacao l WHERE l.id = i.lista_id AND l.usuario_id = $2)`,
    [itemId, eu()],
  );
}

/** Atendeu junto com outra linha e ouviu o recado: volta para o começo da fila (retornar). */
export async function paraRetornar(pool: Pool, ligacaoId: number) {
  await pool.query(
    `UPDATE comercial.lista_ligacao_itens i SET situacao = 'retornar', atualizado_em = now()
      WHERE i.ligacao_id = $1 AND i.conta_id = ${contaSql()}`,
    [ligacaoId],
  );
  await pool.query(
    `UPDATE comercial.ligacoes SET nota = 'Atendeu junto com outra ligação e ouviu o recado de retorno.'
      WHERE id = $1 AND conta_id = ${contaSql()}`,
    [ligacaoId],
  );
}

export async function mudarSituacao(
  db: Executor,
  listaId: number,
  situacao: 'ativa' | 'pausada' | 'encerrada',
) {
  const l = await minhaLista(db, listaId);
  if (l.situacao === 'encerrada') return;
  await db.query(
    `UPDATE comercial.listas_ligacao SET situacao = $2,
            encerrada_em = CASE WHEN $2 = 'encerrada' THEN now() ELSE NULL END
      WHERE id = $1`,
    [listaId, situacao],
  );
  if (situacao === 'encerrada')
    await db.query(
      `UPDATE comercial.lista_ligacao_itens SET situacao = 'pulado', atualizado_em = now()
        WHERE lista_id = $1 AND situacao IN ('na_fila', 'retornar')`,
      [listaId],
    );
}

export async function pular(db: Executor, itemId: number) {
  await db.query(
    `UPDATE comercial.lista_ligacao_itens i SET situacao = 'pulado', atualizado_em = now()
      WHERE i.id = $1 AND i.conta_id = ${contaSql()} AND i.situacao IN ('na_fila', 'retornar')
        AND EXISTS (SELECT 1 FROM comercial.listas_ligacao l WHERE l.id = i.lista_id AND l.usuario_id = $2)`,
    [itemId, eu()],
  );
}

/**
 * O resultado da ligação marca o item. Não atendeu (ou número errado) com "tentar o próximo
 * número": o lead volta no fim da lista com um número ainda não tentado nesta lista.
 */
export async function aposResultado(db: Executor, ligacaoId: number, resultado: ResultadoLigacao) {
  const { rows } = await db.query<{
    id: number;
    lista_id: number;
    empresa_id: number;
    tentativa: number;
    tentar_proximo: boolean;
    situacao_lista: string;
  }>(
    `UPDATE comercial.lista_ligacao_itens i SET situacao = 'feito', resultado = $2, atualizado_em = now()
       FROM comercial.listas_ligacao l
      WHERE i.ligacao_id = $1 AND l.id = i.lista_id AND i.conta_id = ${contaSql()}
      RETURNING i.id::int, i.lista_id::int, i.empresa_id::int, i.tentativa, l.tentar_proximo,
                l.situacao AS situacao_lista`,
    [ligacaoId, resultado],
  );
  const it = rows[0];
  if (!it || !it.tentar_proximo || it.situacao_lista === 'encerrada') return;
  if (!['nao_atendeu', 'caixa_postal', 'ocupado', 'numero_errado'].includes(resultado)) return;
  if (it.tentativa >= MAX_TENTATIVAS_LISTA) return;
  const { rows: usados } = await db.query<{ telefone: string }>(
    `SELECT telefone FROM comercial.lista_ligacao_itens WHERE lista_id = $1 AND empresa_id = $2`,
    [it.lista_id, it.empresa_id],
  );
  const ja = new Set(usados.map((u) => u.telefone.slice(-8)));
  const tels = (await telefonesDosLeads(db, [it.empresa_id])).get(it.empresa_id) ?? [];
  const proximoNumero = tels.find((t) => !t.errado && !ja.has(t.numero.slice(-8)));
  if (!proximoNumero) return;
  await db.query(
    `INSERT INTO comercial.lista_ligacao_itens (lista_id, conta_id, empresa_id, telefone, ordem, tentativa)
     SELECT $1, ${contaSql()}, $2, $3, max(ordem) + 1, $4 FROM comercial.lista_ligacao_itens WHERE lista_id = $1`,
    [it.lista_id, it.empresa_id, proximoNumero.numero, it.tentativa + 1],
  );
}

/** Itens presos em "chamando" (a aba fechou no meio): voltam para a fila. */
export async function destravarItens(db: Executor): Promise<void> {
  await db.query(
    `UPDATE comercial.lista_ligacao_itens i SET situacao = 'na_fila', atualizado_em = now()
      WHERE i.situacao = 'chamando' AND i.atualizado_em < now() - interval '5 minutes'
        AND NOT EXISTS (SELECT 1 FROM comercial.ligacoes lg WHERE lg.id = i.ligacao_id
                         AND (lg.situacao IN ('preparando', 'chamando', 'tocando', 'em_andamento') OR lg.resultado IS NOT NULL))`,
  );
}
