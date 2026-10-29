import type { Executor } from '@prospeccao/db';
import {
  AppError,
  type ConversaArgosDTO,
  type RespostaAssistenteDTO,
  type TrocaArgosDTO,
  type TurnoAnterior,
} from '@prospeccao/shared';

/**
 * Histórico do Argos: cada conversa é de uma pessoa só. Toda consulta filtra pelo usuário da
 * sessão — nem o gestor, nem o master leem a conversa de outra pessoa.
 */

const LIMITE_LISTA = 100;

const titular = (pergunta: string) => {
  const t = pergunta
    .replace(/\s*\[áudio pouco claro\]\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > 80 ? `${t.slice(0, 79)}…` : t || 'Conversa';
};

/** A conversa é desta pessoa? (senão, para quem pergunta, ela não existe). */
async function conferirDona(db: Executor, usuarioId: number, id: number): Promise<void> {
  const { rowCount } = await db.query(
    'SELECT 1 FROM comercial.argos_conversas WHERE id = $1 AND usuario_id = $2',
    [id, usuarioId],
  );
  if (!rowCount) throw AppError.naoEncontrado('Conversa');
}

export async function listar(
  db: Executor,
  usuarioId: number,
  busca?: string | null,
): Promise<ConversaArgosDTO[]> {
  const termo = busca?.trim() ? `%${busca.trim().slice(0, 80)}%` : null;
  const { rows } = await db.query<ConversaArgosDTO>(
    `SELECT c.id::int, c.titulo, ct.nome AS unidade, c.criado_em AS "criadoEm", c.atualizado_em AS "atualizadoEm",
            (SELECT count(*)::int FROM comercial.argos_trocas t WHERE t.conversa_id = c.id) AS trocas
       FROM comercial.argos_conversas c
       JOIN cadastro.contas ct ON ct.id = c.conta_id
      WHERE c.usuario_id = $1
        AND ($2::text IS NULL OR c.titulo ILIKE $2 OR EXISTS (
              SELECT 1 FROM comercial.argos_trocas t WHERE t.conversa_id = c.id AND t.pergunta ILIKE $2))
      ORDER BY c.atualizado_em DESC
      LIMIT ${LIMITE_LISTA}`,
    [usuarioId, termo],
  );
  return rows;
}

export async function abrir(
  db: Executor,
  usuarioId: number,
  id: number,
): Promise<{ id: number; titulo: string; trocas: TrocaArgosDTO[] }> {
  const { rows } = await db.query<{ titulo: string }>(
    'SELECT titulo FROM comercial.argos_conversas WHERE id = $1 AND usuario_id = $2',
    [id, usuarioId],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Conversa');
  const trocas = await db.query<TrocaArgosDTO>(
    `SELECT id::int, pergunta, resposta, via, criado_em AS "criadoEm"
       FROM comercial.argos_trocas WHERE conversa_id = $1 ORDER BY id`,
    [id],
  );
  return { id, titulo: rows[0].titulo, trocas: trocas.rows };
}

/** As últimas trocas da conversa, como contexto para a próxima pergunta. */
export async function historico(db: Executor, usuarioId: number, id: number): Promise<TurnoAnterior[]> {
  await conferirDona(db, usuarioId, id);
  const { rows } = await db.query<{ pergunta: string; resposta: RespostaAssistenteDTO }>(
    `SELECT pergunta, resposta FROM (
       SELECT id, pergunta, resposta FROM comercial.argos_trocas WHERE conversa_id = $1 ORDER BY id DESC LIMIT 8
     ) t ORDER BY id`,
    [id],
  );
  return rows.map((t) => ({ pergunta: t.pergunta.slice(0, 1000), resposta: resumoResposta(t.resposta) }));
}

/** O que o Argos precisa lembrar de uma resposta: a fala, a análise e um resumo da tabela. */
function resumoResposta(r: RespostaAssistenteDTO): string {
  let texto = r.detalhe ? `${r.fala}\n${r.detalhe}` : r.fala;
  const d = r.dados;
  if (d) {
    const destaques = d.destaques.map((x) => `${x.rotulo}: ${x.valor}`).join('; ');
    const colunas = d.colunas.slice(0, 8);
    const linhas = d.linhas
      .slice(0, 12)
      .map((l) => colunas.map((c) => String(l[c] ?? '')).join(' | '))
      .join('\n');
    texto += `\n[Tabela mostrada: ${d.titulo}${destaques ? ` — ${destaques}` : ''}]\n${colunas.join(' | ')}\n${linhas}`;
  }
  return texto.slice(0, 4000);
}

/** Guarda a troca (cria a conversa se for a primeira) e devolve o id da conversa. */
export async function guardar(
  db: Executor,
  d: {
    usuarioId: number;
    contaId: number;
    conversaId: number | null;
    pergunta: string;
    resposta: RespostaAssistenteDTO;
    via: 'texto' | 'voz';
  },
): Promise<number> {
  let id = d.conversaId;
  if (id) await conferirDona(db, d.usuarioId, id);
  else {
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO comercial.argos_conversas (usuario_id, conta_id, titulo) VALUES ($1, $2, $3) RETURNING id::int`,
      [d.usuarioId, d.contaId, titular(d.pergunta)],
    );
    id = rows[0]!.id;
  }
  // A voz já tocou (o id não vale mais) e os tempos são só para medir: não vão para o histórico.
  const { voz: _voz, tempos: _tempos, ...guardada } = d.resposta;
  await db.query(
    `INSERT INTO comercial.argos_trocas (conversa_id, pergunta, resposta, via) VALUES ($1, $2, $3, $4)`,
    [id, d.pergunta.slice(0, 1000), JSON.stringify(guardada), d.via],
  );
  await db.query('UPDATE comercial.argos_conversas SET atualizado_em = now() WHERE id = $1', [id]);
  return id;
}

export async function renomear(db: Executor, usuarioId: number, id: number, titulo: string): Promise<void> {
  const { rowCount } = await db.query(
    'UPDATE comercial.argos_conversas SET titulo = $3 WHERE id = $1 AND usuario_id = $2',
    [id, usuarioId, titulo],
  );
  if (!rowCount) throw AppError.naoEncontrado('Conversa');
}

export async function apagar(db: Executor, usuarioId: number, id: number): Promise<void> {
  const { rowCount } = await db.query(
    'DELETE FROM comercial.argos_conversas WHERE id = $1 AND usuario_id = $2',
    [id, usuarioId],
  );
  if (!rowCount) throw AppError.naoEncontrado('Conversa');
}
