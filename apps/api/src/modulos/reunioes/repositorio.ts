import { randomBytes, randomUUID } from 'node:crypto';
import type { Executor } from '@prospeccao/db';
import {
  AppError,
  codigoSala,
  type EntradaSala,
  type OpcoesSala,
  partesDeFala,
  type ResumoReuniao,
  type StatusSala,
} from '@prospeccao/shared';
import { contaSql, donoDaBase, empresaNaBase } from '../../contexto.js';
import { exigirRecurso } from '../../recursos.js';

/**
 * Salas de reunião por vídeo: a sala (o link), as sessões (cada vez que foi usada), quem entrou,
 * o chat, os arquivos, as gravações e a transcrição. Tudo filtrado pela conta da requisição, menos a
 * busca pelo código do link (o convidado não tem conta: a sala diz de qual conta é).
 */

/* ───────────── Endereço do link ───────────── */

let enderecoBase = 'http://localhost:5173';

/** Endereço do sistema (o primeiro de APP_ORIGENS): o link da sala é <endereço>/r/<código>. */
export function definirEnderecoDasSalas(origem: string | undefined): void {
  if (origem) enderecoBase = origem.replace(/\/+$/, '');
}

export const linkDaSala = (codigo: string) => `${enderecoBase}/r/${codigo}`;

/** O "local" da tarefa é o link de uma sala do sistema? */
export const ehLinkDeSala = (local: string | null | undefined) =>
  !!local && /\/r\/[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$/.test(local);

/* ───────────── Sala ───────────── */

export interface Sala {
  id: number;
  contaId: number;
  tarefaId: number | null;
  empresaId: number | null;
  anfitriaoId: number | null;
  codigo: string;
  titulo: string;
  inicio: Date;
  fim: Date | null;
  abreMinutosAntes: number;
  entrada: EntradaSala;
  gravar: boolean;
  transcrever: boolean;
  status: StatusSala;
  conviteEnviadoEm: Date | null;
}

const CAMPOS_SALA = `s.id::int, s.conta_id AS "contaId", s.tarefa_id::int AS "tarefaId", s.empresa_id::int AS "empresaId",
  s.anfitriao_id AS "anfitriaoId", s.codigo, s.titulo, s.inicio, s.fim, s.abre_minutos_antes AS "abreMinutosAntes",
  s.entrada, s.gravar, s.transcrever, s.status, s.convite_enviado_em AS "conviteEnviadoEm"`;

/** Sala pelo código do link, de qualquer conta (é assim que o convidado chega). */
export async function salaPorCodigo(db: Executor, codigo: string) {
  const { rows } = await db.query<
    Sala & {
      contaNome: string;
      marcaNome: string | null;
      marcaCor: string | null;
      temLogo: boolean;
      anfitriaoNome: string | null;
      empresaNome: string | null;
    }
  >(
    `SELECT ${CAMPOS_SALA}, c.nome AS "contaNome", o.marca_nome AS "marcaNome", o.marca_cor AS "marcaCor",
            (o.marca_logo IS NOT NULL) AS "temLogo", u.nome AS "anfitriaoNome",
            coalesce(e.maps_nome, e.nome) AS "empresaNome"
       FROM comercial.salas s
       JOIN cadastro.contas c ON c.id = s.conta_id
       JOIN cadastro.organizacoes o ON o.id = c.organizacao_id
       LEFT JOIN cadastro.usuarios u ON u.id = s.anfitriao_id
       LEFT JOIN descoberta.empresas e ON e.id = s.empresa_id
      WHERE s.codigo = $1 AND c.ativa AND o.ativa`,
    [codigo],
  );
  return rows[0] ?? null;
}

export async function logoDaConta(db: Executor, contaId: number) {
  const { rows } = await db.query<{ logo: Buffer | null; tipo: string | null }>(
    `SELECT o.marca_logo AS logo, o.marca_logo_tipo AS tipo
       FROM cadastro.contas c JOIN cadastro.organizacoes o ON o.id = c.organizacao_id WHERE c.id = $1`,
    [contaId],
  );
  return rows[0]?.logo ? { dados: rows[0].logo, tipo: rows[0].tipo ?? 'image/png' } : null;
}

export async function salaDaTarefa(db: Executor, tarefaId: number): Promise<Sala | null> {
  const { rows } = await db.query<Sala>(
    `SELECT ${CAMPOS_SALA} FROM comercial.salas s WHERE s.tarefa_id = $1 AND s.conta_id = ${contaSql()}`,
    [tarefaId],
  );
  return rows[0] ?? null;
}

export async function salaPorId(db: Executor, id: number): Promise<Sala> {
  const { rows } = await db.query<Sala>(
    `SELECT ${CAMPOS_SALA} FROM comercial.salas s WHERE s.id = $1 AND s.conta_id = ${contaSql()}`,
    [id],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Reunião');
  return rows[0];
}

/**
 * Cria a sala de uma reunião da agenda (código novo, sorteado; repete se bater com um que existe).
 * Devolve o link, que vira o "local" da tarefa.
 */
export async function criarSalaDaTarefa(db: Executor, tarefaId: number, o: OpcoesSala): Promise<string> {
  await exigirRecurso(db, 'reunioes');
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const codigo = codigoSala(randomBytes(8));
    const { rows } = await db.query<{ codigo: string }>(
      `INSERT INTO comercial.salas
         (conta_id, tarefa_id, empresa_id, anfitriao_id, codigo, titulo, inicio, fim,
          abre_minutos_antes, entrada, gravar, transcrever, criado_por)
       SELECT t.conta_id, t.id, t.empresa_id, t.usuario_id, $2, t.titulo, t.inicio, t.fim, $3, $4, $5, $6, t.criado_por
         FROM comercial.tarefas t WHERE t.id = $1 AND t.conta_id = ${contaSql()}
       ON CONFLICT (codigo) DO NOTHING
       RETURNING codigo`,
      [tarefaId, codigo, o.abreMinutosAntes, o.entrada, o.gravar, o.transcrever],
    );
    if (rows[0]) return linkDaSala(rows[0].codigo);
    const { rows: existe } = await db.query(
      `SELECT 1 FROM comercial.tarefas WHERE id = $1 AND conta_id = ${contaSql()}`,
      [tarefaId],
    );
    if (!existe.length) throw AppError.naoEncontrado('Tarefa');
  }
  throw new Error('Não foi possível sortear um código de sala livre');
}

/** Opções novas da sala (e a sala volta a valer, se tinha sido cancelada). */
export async function atualizarOpcoes(db: Executor, salaId: number, o: OpcoesSala): Promise<void> {
  await db.query(
    `UPDATE comercial.salas
        SET abre_minutos_antes = $2, entrada = $3, gravar = $4, transcrever = $5,
            status = CASE WHEN status = 'cancelada' THEN 'marcada' ELSE status END
      WHERE id = $1 AND conta_id = ${contaSql()}`,
    [salaId, o.abreMinutosAntes, o.entrada, o.gravar, o.transcrever],
  );
}

/** A tarefa mudou (título, horário, responsável, lead): a sala acompanha. */
export async function sincronizarComTarefa(db: Executor, tarefaId: number): Promise<void> {
  await db.query(
    `UPDATE comercial.salas s
        SET titulo = t.titulo, inicio = t.inicio, fim = t.fim, anfitriao_id = t.usuario_id, empresa_id = t.empresa_id,
            -- Remarcou para depois: a sala encerrada volta a esperar o novo horário.
            status = CASE WHEN s.status = 'encerrada' AND t.inicio > now() THEN 'marcada' ELSE s.status END
       FROM comercial.tarefas t
      WHERE s.tarefa_id = t.id AND t.id = $1 AND s.conta_id = ${contaSql()}`,
    [tarefaId],
  );
}

/** A reunião deixou de ser na sala (ou foi apagada): o link para de funcionar. */
export async function cancelarSalaDaTarefa(db: Executor, tarefaId: number): Promise<void> {
  await db.query(
    `UPDATE comercial.salas SET status = 'cancelada'
      WHERE tarefa_id = $1 AND conta_id = ${contaSql()} AND status IN ('marcada', 'encerrada')`,
    [tarefaId],
  );
}

export async function marcarConviteEnviado(db: Executor, salaId: number): Promise<void> {
  await db.query(
    `UPDATE comercial.salas SET convite_enviado_em = now() WHERE id = $1 AND conta_id = ${contaSql()}`,
    [salaId],
  );
}

/* ───────────── Participantes ───────────── */

export interface Participante {
  id: string;
  salaId: number;
  identidade: string;
  nome: string;
  tipo: 'equipe' | 'convidado';
  usuarioId: number | null;
  situacao: 'aguardando' | 'liberado' | 'recusado';
  segredoHash: string | null;
}

const CAMPOS_PARTICIPANTE = `p.id, p.sala_id::int AS "salaId", p.identidade, p.nome, p.tipo, p.usuario_id AS "usuarioId",
  p.situacao, p.segredo_hash AS "segredoHash"`;

/** Alguém do time entrando (uma linha por pessoa e sala; o nome acompanha o cadastro). */
export async function participanteDaEquipe(
  db: Executor,
  salaId: number,
  u: { id: number; nome: string },
): Promise<Participante> {
  const { rows } = await db.query<Participante>(
    `INSERT INTO comercial.sala_participantes AS p (sala_id, conta_id, identidade, nome, tipo, usuario_id, situacao)
     VALUES ($1, ${contaSql()}, $2, $3, 'equipe', $4, 'liberado')
     ON CONFLICT (sala_id, identidade) DO UPDATE SET nome = EXCLUDED.nome
     RETURNING ${CAMPOS_PARTICIPANTE}`,
    [salaId, `u-${u.id}`, u.nome.slice(0, 80), u.id],
  );
  return rows[0]!;
}

export async function novoConvidado(
  db: Executor,
  salaId: number,
  d: { nome: string; situacao: 'aguardando' | 'liberado'; segredoHash: string; aceitouGravacao: boolean },
): Promise<Participante> {
  const id = randomUUID();
  const { rows } = await db.query<Participante>(
    `INSERT INTO comercial.sala_participantes AS p
       (id, sala_id, conta_id, identidade, nome, tipo, situacao, segredo_hash, aceitou_gravacao_em)
     VALUES ($1, $2, ${contaSql()}, $3, $4, 'convidado', $5, $6, CASE WHEN $7 THEN now() END)
     RETURNING ${CAMPOS_PARTICIPANTE}`,
    [
      id,
      salaId,
      `c-${id.replace(/-/g, '').slice(0, 16)}`,
      d.nome,
      d.situacao,
      d.segredoHash,
      d.aceitouGravacao,
    ],
  );
  return rows[0]!;
}

export async function participante(db: Executor, salaId: number, id: string): Promise<Participante | null> {
  const { rows } = await db.query<Participante>(
    `SELECT ${CAMPOS_PARTICIPANTE} FROM comercial.sala_participantes p
      WHERE p.sala_id = $1 AND p.id = $2 AND p.conta_id = ${contaSql()}`,
    [salaId, id],
  );
  return rows[0] ?? null;
}

/** O convidado voltou (recarregou a página): atualiza o nome e o aceite da gravação. */
export async function atualizarConvidado(
  db: Executor,
  id: string,
  d: { nome: string; aceitouGravacao: boolean },
): Promise<void> {
  await db.query(
    `UPDATE comercial.sala_participantes
        SET nome = $2, aceitou_gravacao_em = CASE WHEN $3 THEN coalesce(aceitou_gravacao_em, now()) ELSE aceitou_gravacao_em END
      WHERE id = $1 AND conta_id = ${contaSql()} AND tipo = 'convidado'`,
    [id, d.nome, d.aceitouGravacao],
  );
}

export async function naEspera(db: Executor, salaId: number) {
  const { rows } = await db.query<{ id: string; nome: string; desde: Date }>(
    `SELECT id, nome, criado_em AS desde FROM comercial.sala_participantes
      WHERE sala_id = $1 AND conta_id = ${contaSql()} AND situacao = 'aguardando' ORDER BY criado_em`,
    [salaId],
  );
  return rows;
}

export async function decidirEspera(
  db: Executor,
  salaId: number,
  id: string,
  situacao: 'liberado' | 'recusado',
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE comercial.sala_participantes SET situacao = $3
      WHERE sala_id = $1 AND id = $2 AND conta_id = ${contaSql()} AND situacao = 'aguardando'`,
    [salaId, id, situacao],
  );
  return !!rowCount;
}

/** Nomes de quem está na sala agora (pelos avisos do LiveKit). */
export async function presentes(db: Executor, salaId: number): Promise<string[]> {
  const { rows } = await db.query<{ nome: string }>(
    `SELECT nome FROM comercial.sala_participantes
      WHERE sala_id = $1 AND conta_id = ${contaSql()} AND presente_desde IS NOT NULL
      ORDER BY presente_desde LIMIT 12`,
    [salaId],
  );
  return rows.map((r) => r.nome);
}

/** Aviso do LiveKit: a pessoa entrou ou saiu (soma o tempo na sala). */
export async function registrarPresenca(
  db: Executor,
  salaId: number,
  identidade: string,
  evento: 'entrou' | 'saiu',
  em: Date,
): Promise<void> {
  if (evento === 'entrou')
    await db.query(
      `UPDATE comercial.sala_participantes
          SET presente_desde = coalesce(presente_desde, $3), entrou_em = coalesce(entrou_em, $3)
        WHERE sala_id = $1 AND identidade = $2 AND conta_id = ${contaSql()}`,
      [salaId, identidade, em],
    );
  else
    await db.query(
      `UPDATE comercial.sala_participantes
          SET segundos_na_sala = segundos_na_sala + greatest(0, extract(epoch FROM ($3::timestamptz - presente_desde)))::int,
              presente_desde = NULL, saiu_em = $3
        WHERE sala_id = $1 AND identidade = $2 AND conta_id = ${contaSql()} AND presente_desde IS NOT NULL`,
      [salaId, identidade, em],
    );
}

/* ───────────── Sessões ───────────── */

export interface Sessao {
  id: number;
  salaId: number;
  salaVideo: string;
  iniciadaEm: Date;
  encerradaEm: Date | null;
  gravar: boolean;
  transcrever: boolean;
  situacao: 'ao_vivo' | 'processando' | 'pronta' | 'encerrada' | 'erro';
}

const CAMPOS_SESSAO = `ss.id::int, ss.sala_id::int AS "salaId", ss.sala_video AS "salaVideo", ss.iniciada_em AS "iniciadaEm",
  ss.encerrada_em AS "encerradaEm", ss.gravar, ss.transcrever, ss.situacao`;

export async function sessaoAoVivo(db: Executor, salaId: number): Promise<Sessao | null> {
  const { rows } = await db.query<Sessao>(
    `SELECT ${CAMPOS_SESSAO} FROM comercial.sala_sessoes ss
      WHERE ss.sala_id = $1 AND ss.conta_id = ${contaSql()} AND ss.situacao = 'ao_vivo'
      ORDER BY ss.id DESC LIMIT 1`,
    [salaId],
  );
  return rows[0] ?? null;
}

/**
 * Abre uma sessão (a sala do LiveKit desta vez). Duas pessoas entrando juntas: só uma abre, a outra
 * recebe a mesma (trava na linha da sala).
 */
export async function abrirSessao(
  db: Executor,
  salaId: number,
  o: { gravar: boolean; transcrever: boolean },
): Promise<{ sessao: Sessao; nova: boolean }> {
  const C = contaSql();
  await db.query(`SELECT 1 FROM comercial.salas WHERE id = $1 AND conta_id = ${C} FOR UPDATE`, [salaId]);
  const atual = await sessaoAoVivo(db, salaId);
  if (atual) return { sessao: atual, nova: false };
  const { rows: n } = await db.query<{ n: number }>(
    `SELECT count(*)::int + 1 AS n FROM comercial.sala_sessoes WHERE sala_id = $1`,
    [salaId],
  );
  const { rows } = await db.query<Sessao>(
    `INSERT INTO comercial.sala_sessoes AS ss (sala_id, conta_id, sala_video, gravar, transcrever)
     VALUES ($1, ${C}, $2, $3, $4) RETURNING ${CAMPOS_SESSAO}`,
    [salaId, `pt-${C}-${salaId}-${n[0]!.n}`, o.gravar, o.gravar && o.transcrever],
  );
  await db.query(`UPDATE comercial.salas SET status = 'ao_vivo' WHERE id = $1`, [salaId]);
  return { sessao: rows[0]!, nova: true };
}

/** Sessão pelo nome da sala no LiveKit (os avisos chegam sem conta: a sessão diz qual é). */
export async function sessaoPorSalaVideo(db: Executor, salaVideo: string) {
  const { rows } = await db.query<Sessao & { contaId: number }>(
    `SELECT ${CAMPOS_SESSAO}, ss.conta_id AS "contaId" FROM comercial.sala_sessoes ss WHERE ss.sala_video = $1`,
    [salaVideo],
  );
  return rows[0] ?? null;
}

export async function sessao(db: Executor, id: number): Promise<Sessao> {
  const { rows } = await db.query<Sessao>(
    `SELECT ${CAMPOS_SESSAO} FROM comercial.sala_sessoes ss WHERE ss.id = $1 AND ss.conta_id = ${contaSql()}`,
    [id],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Reunião');
  return rows[0];
}

/**
 * Encerra a sessão (o LiveKit fechou a sala ou o time encerrou). Com gravação, fica processando
 * (espera os arquivos, transcreve e resume); sem, termina aqui. Devolve null se já estava encerrada.
 */
export async function encerrarSessao(db: Executor, sessaoId: number, em: Date) {
  const C = contaSql();
  const { rows } = await db.query<{ sala_id: number; gravar: boolean; segundos: number }>(
    `UPDATE comercial.sala_sessoes
        SET encerrada_em = greatest($2::timestamptz, iniciada_em),
            duracao_segundos = greatest(0, extract(epoch FROM (greatest($2::timestamptz, iniciada_em) - iniciada_em)))::int,
            situacao = CASE WHEN gravar THEN 'processando' ELSE 'encerrada' END,
            -- Espera um pouco: o LiveKit ainda está terminando de subir os arquivos.
            processar_em = now() + interval '45 seconds'
      WHERE id = $1 AND conta_id = ${C} AND situacao = 'ao_vivo'
      RETURNING sala_id::int, gravar, duracao_segundos AS segundos`,
    [sessaoId, em],
  );
  const s = rows[0];
  if (!s) return null;
  // Quem ainda estava "presente" sai agora (o aviso de saída pode não ter chegado).
  await db.query(
    `UPDATE comercial.sala_participantes
        SET segundos_na_sala = segundos_na_sala + greatest(0, extract(epoch FROM ($2::timestamptz - presente_desde)))::int,
            presente_desde = NULL, saiu_em = $2
      WHERE sala_id = $1 AND presente_desde IS NOT NULL`,
    [s.sala_id, em],
  );
  await db.query(`UPDATE comercial.salas SET status = 'encerrada' WHERE id = $1 AND status = 'ao_vivo'`, [
    s.sala_id,
  ]);
  return { salaId: s.sala_id, gravar: s.gravar, segundos: s.segundos };
}

/** Quem esteve na sessão (entrou de fato), para a ficha e para o histórico. */
export async function quemEsteve(db: Executor, salaId: number) {
  const { rows } = await db.query<{
    identidade: string;
    nome: string;
    tipo: 'equipe' | 'convidado';
    segundos: number;
  }>(
    `SELECT identidade, nome, tipo, segundos_na_sala AS segundos FROM comercial.sala_participantes
      WHERE sala_id = $1 AND conta_id = ${contaSql()} AND entrou_em IS NOT NULL
      ORDER BY tipo DESC, entrou_em`,
    [salaId],
  );
  return rows;
}

/** Sessões ao vivo há algum tempo (para conferir se a sala ainda existe no LiveKit). */
export async function sessoesParaConferir(db: Executor) {
  const { rows } = await db.query<{ id: number; contaId: number; salaVideo: string }>(
    `SELECT id::int, conta_id AS "contaId", sala_video AS "salaVideo" FROM comercial.sala_sessoes
      WHERE situacao = 'ao_vivo' AND iniciada_em < now() - interval '15 minutes'
      ORDER BY iniciada_em LIMIT 50`,
  );
  return rows;
}

/** Reuniões acontecendo agora (a api confere no LiveKit quem está e o que gravar). */
export async function sessoesAoVivo(db: Executor) {
  const { rows } = await db.query<{ id: number; contaId: number; salaId: number; salaVideo: string }>(
    `SELECT id::int, conta_id AS "contaId", sala_id::int AS "salaId", sala_video AS "salaVideo"
       FROM comercial.sala_sessoes WHERE situacao = 'ao_vivo' ORDER BY iniciada_em LIMIT 100`,
  );
  return rows;
}

/** Quem o sistema acha que está na sala (para notar quem saiu sem o aviso chegar). */
export async function identidadesPresentes(db: Executor, salaId: number): Promise<string[]> {
  const { rows } = await db.query<{ identidade: string }>(
    `SELECT identidade FROM comercial.sala_participantes
      WHERE sala_id = $1 AND conta_id = ${contaSql()} AND presente_desde IS NOT NULL`,
    [salaId],
  );
  return rows.map((r) => r.identidade);
}

/** Gravações que ainda não terminaram (a api pergunta ao LiveKit como estão). */
export async function gravacoesParaConferir(db: Executor) {
  const { rows } = await db.query<{ gravacaoId: string; contaId: number }>(
    `SELECT g.gravacao_id AS "gravacaoId", g.conta_id AS "contaId"
       FROM comercial.sala_gravacoes g JOIN comercial.sala_sessoes ss ON ss.id = g.sessao_id
      WHERE g.situacao = 'gravando' AND g.origem = 'livekit' AND g.gravacao_id NOT LIKE 'reserva:%'
        AND ss.situacao IN ('ao_vivo', 'processando')
      ORDER BY g.id LIMIT 100`,
  );
  return rows;
}

/* ───────────── Gravações ───────────── */

/**
 * Reserva a gravação antes de pedir ao LiveKit (o mesmo aviso pode chegar duas vezes: só um pedido
 * sai). Devolve o id provisório, ou null se já tinha.
 */
export async function reservarGravacao(
  db: Executor,
  sessaoId: number,
  d: { tipo: 'sala' | 'audio'; identidade?: string; nome?: string; trilhaId?: string; chave: string },
): Promise<string | null> {
  const provisorio = `reserva:${sessaoId}:${d.tipo}:${d.trilhaId ?? 'sala'}`;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO comercial.sala_gravacoes (sessao_id, conta_id, gravacao_id, tipo, identidade, nome, trilha_id, chave)
     VALUES ($1, ${contaSql()}, $2, $3, $4, $5, $6, $7)
     ON CONFLICT DO NOTHING RETURNING gravacao_id AS id`,
    [sessaoId, provisorio, d.tipo, d.identidade ?? null, d.nome ?? null, d.trilhaId ?? null, d.chave],
  );
  return rows[0]?.id ?? null;
}

export async function confirmarGravacao(
  db: Executor,
  provisorio: string,
  r: { gravacaoId: string } | { erro: string },
): Promise<void> {
  if ('gravacaoId' in r)
    await db.query('UPDATE comercial.sala_gravacoes SET gravacao_id = $2 WHERE gravacao_id = $1', [
      provisorio,
      r.gravacaoId,
    ]);
  else
    await db.query(
      `UPDATE comercial.sala_gravacoes SET situacao = 'falhou', erro = $2, encerrada_em = now() WHERE gravacao_id = $1`,
      [provisorio, r.erro.slice(0, 500)],
    );
}

/** Aviso do LiveKit sobre uma gravação (começou, terminou, falhou). */
export async function atualizarGravacao(
  db: Executor,
  gravacaoId: string,
  d: {
    situacao: 'gravando' | 'pronta' | 'falhou';
    inicio: Date | null;
    arquivo: { chave: string; bytes: number; segundos: number; inicio: Date | null; fim: Date | null } | null;
    erro: string | null;
  },
): Promise<{ sessaoId: number; tipo: 'sala' | 'audio' } | null> {
  const { rows } = await db.query<{ sessaoId: number; tipo: 'sala' | 'audio' }>(
    `UPDATE comercial.sala_gravacoes
        SET situacao = CASE WHEN situacao = 'gravando' THEN $2 ELSE situacao END,
            iniciada_em = coalesce($3, iniciada_em, $4),
            encerrada_em = CASE WHEN $2 <> 'gravando' THEN coalesce($5, now()) ELSE encerrada_em END,
            chave = coalesce($6, chave), bytes = coalesce($7, bytes), segundos = coalesce($8, segundos),
            erro = coalesce($9, erro)
      WHERE gravacao_id = $1
      RETURNING sessao_id::int AS "sessaoId", tipo`,
    [
      gravacaoId,
      d.situacao,
      d.arquivo?.inicio ?? null,
      d.inicio,
      d.arquivo?.fim ?? null,
      d.arquivo?.chave ?? null,
      d.arquivo?.bytes ?? null,
      d.arquivo?.segundos ?? null,
      d.erro ? d.erro.slice(0, 500) : null,
    ],
  );
  return rows[0] ?? null;
}

export async function gravacoesDaSessao(db: Executor, sessaoId: number) {
  const { rows } = await db.query<{
    gravacaoId: string;
    tipo: 'sala' | 'audio';
    identidade: string | null;
    nome: string | null;
    chave: string | null;
    situacao: 'gravando' | 'pronta' | 'falhou';
    iniciadaEm: Date | null;
    bytes: number | null;
    segundos: number | null;
    erro: string | null;
    origem: 'livekit' | 'navegador';
  }>(
    `SELECT gravacao_id AS "gravacaoId", tipo, identidade, nome, chave, situacao, iniciada_em AS "iniciadaEm",
            bytes, segundos, erro, origem
       FROM comercial.sala_gravacoes WHERE sessao_id = $1 AND conta_id = ${contaSql()} ORDER BY id`,
    [sessaoId],
  );
  return rows;
}

/* ───────────── Gravação pelo navegador ───────────── */

export interface GravacaoNavegador {
  gravacaoId: string;
  sessaoId: number;
  salaId: number;
  contaId: number;
  tipo: 'sala' | 'audio';
  situacao: 'gravando' | 'pronta' | 'falhou';
  gravadoPor: string | null;
  chave: string;
  mime: string | null;
  sessaoAoVivo: boolean;
}

/** Começa uma gravação do navegador (a do vídeo da reunião ou a do microfone de uma pessoa). */
export async function criarGravacaoNavegador(
  db: Executor,
  d: {
    sessaoId: number;
    chaveBase: string;
    tipo: 'sala' | 'audio';
    identidade: string | null;
    nome: string | null;
    trilhaId: string | null;
    mime: string;
    gravadoPor: string;
    /** Há quanto tempo o navegador já está gravando (o início fica na hora da api). */
    desdeMs: number;
  },
): Promise<string> {
  const id = `nav-${randomUUID()}`;
  await db.query(
    `INSERT INTO comercial.sala_gravacoes
       (sessao_id, conta_id, gravacao_id, tipo, identidade, nome, trilha_id, chave, origem, mime, gravado_por, iniciada_em)
     VALUES ($1, ${contaSql()}, $2, $3, $4, $5, $6, $7, 'navegador', $8, $9, now() - make_interval(secs => $10))`,
    [
      d.sessaoId,
      id,
      d.tipo,
      d.identidade,
      d.nome,
      d.trilhaId,
      `${d.chaveBase}/${id}`,
      d.mime,
      d.gravadoPor,
      Math.min(Math.max(d.desdeMs, 0), 120_000) / 1000,
    ],
  );
  return id;
}

export async function gravacaoNavegador(db: Executor, gravacaoId: string): Promise<GravacaoNavegador | null> {
  const { rows } = await db.query<GravacaoNavegador>(
    `SELECT g.gravacao_id AS "gravacaoId", g.sessao_id::int AS "sessaoId", ss.sala_id::int AS "salaId",
            g.conta_id AS "contaId", g.tipo, g.situacao, g.gravado_por AS "gravadoPor", g.chave, g.mime,
            (ss.situacao = 'ao_vivo') AS "sessaoAoVivo"
       FROM comercial.sala_gravacoes g JOIN comercial.sala_sessoes ss ON ss.id = g.sessao_id
      WHERE g.gravacao_id = $1 AND g.origem = 'navegador' AND g.conta_id = ${contaSql()}`,
    [gravacaoId],
  );
  return rows[0] ?? null;
}

/**
 * Quem está gravando o vídeo desta reunião agora (mandou um pedaço há menos de 45 s e não
 * terminou). Só uma pessoa do time grava por vez.
 */
export async function gravadorAtivo(db: Executor, sessaoId: number) {
  const { rows } = await db.query<{ gravadoPor: string; nome: string | null }>(
    `SELECT g.gravado_por AS "gravadoPor", p.nome
       FROM comercial.sala_gravacoes g
       JOIN comercial.sala_sessoes ss ON ss.id = g.sessao_id
       LEFT JOIN comercial.sala_participantes p ON p.sala_id = ss.sala_id AND p.identidade = g.gravado_por
      WHERE g.sessao_id = $1 AND g.conta_id = ${contaSql()} AND g.origem = 'navegador' AND g.tipo = 'sala'
        AND g.situacao = 'gravando' AND g.concluida_cliente_em IS NULL
        AND coalesce(g.ultimo_pedaco_em, g.criado_em) > now() - interval '45 seconds'
      ORDER BY g.id DESC LIMIT 1`,
    [sessaoId],
  );
  return rows[0] ?? null;
}

export async function registrarPedaco(db: Executor, gravacaoId: string, n: number, bytes: number) {
  await db.query(
    `INSERT INTO comercial.sala_gravacao_pedacos (gravacao_id, n, bytes) VALUES ($1, $2, $3)
     ON CONFLICT (gravacao_id, n) DO UPDATE SET bytes = EXCLUDED.bytes, recebido_em = now()`,
    [gravacaoId, n, bytes],
  );
  await db.query('UPDATE comercial.sala_gravacoes SET ultimo_pedaco_em = now() WHERE gravacao_id = $1', [
    gravacaoId,
  ]);
}

export async function concluirPeloNavegador(db: Executor, gravacaoId: string, pedacos: number) {
  await db.query(
    `UPDATE comercial.sala_gravacoes SET concluida_cliente_em = now(), pedacos_esperados = $2
      WHERE gravacao_id = $1 AND situacao = 'gravando'`,
    [gravacaoId, pedacos],
  );
}

/** Gravações do navegador desta sessão que ainda não viraram arquivo (com o que já chegou). */
export async function gravacoesParaMontar(db: Executor, sessaoId: number) {
  const { rows } = await db.query<{
    gravacaoId: string;
    tipo: 'sala' | 'audio';
    chave: string;
    mime: string | null;
    concluida: boolean;
    esperados: number | null;
    recebidos: number;
    paradaHaSegundos: number;
  }>(
    `SELECT g.gravacao_id AS "gravacaoId", g.tipo, g.chave, g.mime,
            (g.concluida_cliente_em IS NOT NULL) AS concluida, g.pedacos_esperados AS esperados,
            (SELECT count(*)::int FROM comercial.sala_gravacao_pedacos p WHERE p.gravacao_id = g.gravacao_id) AS recebidos,
            extract(epoch FROM now() - coalesce(g.ultimo_pedaco_em, g.criado_em))::int AS "paradaHaSegundos"
       FROM comercial.sala_gravacoes g
      WHERE g.sessao_id = $1 AND g.origem = 'navegador' AND g.situacao = 'gravando'
      ORDER BY g.id`,
    [sessaoId],
  );
  return rows;
}

export async function pedacosDaGravacao(db: Executor, gravacaoId: string): Promise<number[]> {
  const { rows } = await db.query<{ n: number }>(
    'SELECT n FROM comercial.sala_gravacao_pedacos WHERE gravacao_id = $1 ORDER BY n',
    [gravacaoId],
  );
  return rows.map((r) => r.n);
}

export async function gravacaoMontada(
  db: Executor,
  gravacaoId: string,
  r: { chave: string; bytes: number; segundos: number | null } | { erro: string },
) {
  if ('erro' in r)
    await db.query(
      `UPDATE comercial.sala_gravacoes SET situacao = 'falhou', erro = $2, encerrada_em = now() WHERE gravacao_id = $1`,
      [gravacaoId, r.erro.slice(0, 500)],
    );
  else
    await db.query(
      `UPDATE comercial.sala_gravacoes
          SET situacao = 'pronta', chave = $2, bytes = $3, segundos = $4,
              encerrada_em = coalesce(iniciada_em + make_interval(secs => coalesce($4, 0)), now())
        WHERE gravacao_id = $1`,
      [gravacaoId, r.chave, r.bytes, r.segundos],
    );
  await db.query('DELETE FROM comercial.sala_gravacao_pedacos WHERE gravacao_id = $1', [gravacaoId]);
}

/** Todas as chaves de arquivos gravados (para apagar do armazenamento). */
export async function chavesGravadas(db: Executor, filtro: { sessaoId: number } | { salaIds: number[] }) {
  const { rows } = await db.query<{ chave: string }>(
    'sessaoId' in filtro
      ? 'SELECT chave FROM comercial.sala_gravacoes WHERE sessao_id = $1 AND chave IS NOT NULL'
      : `SELECT g.chave FROM comercial.sala_gravacoes g JOIN comercial.sala_sessoes ss ON ss.id = g.sessao_id
          WHERE ss.sala_id = ANY($1::bigint[]) AND g.chave IS NOT NULL`,
    ['sessaoId' in filtro ? filtro.sessaoId : filtro.salaIds],
  );
  return rows.map((r) => r.chave);
}

/* ───────────── Chat e arquivos ───────────── */

export interface MensagemSala {
  id: number;
  participanteId: string | null;
  autor: string;
  texto: string | null;
  arquivo: { id: number; nome: string; mime: string; tamanho: number } | null;
  criadoEm: Date;
}

const CAMPOS_MENSAGEM = `m.id::int, m.participante_id AS "participanteId", m.autor, m.texto, m.criado_em AS "criadoEm",
  CASE WHEN a.id IS NULL THEN NULL
       ELSE json_build_object('id', a.id, 'nome', a.nome, 'mime', a.mime, 'tamanho', a.tamanho) END AS arquivo`;

export async function mensagens(db: Executor, salaId: number): Promise<MensagemSala[]> {
  const { rows } = await db.query<MensagemSala>(
    `SELECT ${CAMPOS_MENSAGEM} FROM comercial.sala_mensagens m
       LEFT JOIN comercial.sala_arquivos a ON a.id = m.arquivo_id
      WHERE m.sala_id = $1 AND m.conta_id = ${contaSql()} ORDER BY m.id DESC LIMIT 300`,
    [salaId],
  );
  return rows.reverse();
}

export async function novaMensagem(
  db: Executor,
  d: {
    salaId: number;
    sessaoId: number | null;
    participanteId: string;
    autor: string;
    texto: string | null;
    arquivoId?: number | null;
  },
): Promise<MensagemSala> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO comercial.sala_mensagens (sala_id, conta_id, sessao_id, participante_id, autor, texto, arquivo_id)
     VALUES ($1, ${contaSql()}, $2, $3, $4, $5, $6) RETURNING id::int`,
    [d.salaId, d.sessaoId, d.participanteId, d.autor, d.texto, d.arquivoId ?? null],
  );
  const { rows: m } = await db.query<MensagemSala>(
    `SELECT ${CAMPOS_MENSAGEM} FROM comercial.sala_mensagens m
       LEFT JOIN comercial.sala_arquivos a ON a.id = m.arquivo_id WHERE m.id = $1`,
    [rows[0]!.id],
  );
  return m[0]!;
}

export async function novoArquivo(
  db: Executor,
  d: { salaId: number; nome: string; mime: string; dados: Buffer },
): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO comercial.sala_arquivos (sala_id, conta_id, nome, mime, tamanho, dados)
     VALUES ($1, ${contaSql()}, $2, $3, $4, $5) RETURNING id::int`,
    [d.salaId, d.nome, d.mime, d.dados.length, d.dados],
  );
  return rows[0]!.id;
}

export async function arquivo(db: Executor, salaId: number, id: number) {
  const { rows } = await db.query<{ nome: string; mime: string; dados: Buffer }>(
    `SELECT nome, mime, dados FROM comercial.sala_arquivos WHERE id = $1 AND sala_id = $2 AND conta_id = ${contaSql()}`,
    [id, salaId],
  );
  return rows[0] ?? null;
}

/* ───────────── Transcrição e resumo ───────────── */

export async function gravarFalas(
  db: Executor,
  sessaoId: number,
  falas: { identidade: string; nome: string; inicioMs: number; fimMs: number; texto: string }[],
): Promise<void> {
  await db.query(`DELETE FROM comercial.sala_falas WHERE sessao_id = $1 AND conta_id = ${contaSql()}`, [
    sessaoId,
  ]);
  // Em lotes (uma reunião longa tem centenas de trechos).
  for (let i = 0; i < falas.length; i += 200) {
    const lote = falas.slice(i, i + 200);
    await db.query(
      `INSERT INTO comercial.sala_falas (sessao_id, conta_id, identidade, nome, inicio_ms, fim_ms, texto)
       SELECT $1, ${contaSql()}, f.identidade, f.nome, f.inicio, greatest(f.fim, f.inicio), f.texto
         FROM jsonb_to_recordset($2::jsonb) AS f(identidade text, nome text, inicio int, fim int, texto text)`,
      [
        sessaoId,
        JSON.stringify(
          lote.map((f) => ({
            identidade: f.identidade,
            nome: f.nome,
            inicio: Math.round(f.inicioMs),
            fim: Math.round(f.fimMs),
            texto: f.texto.slice(0, 4000),
          })),
        ),
      ],
    );
  }
}

export async function falas(db: Executor, sessaoId: number) {
  const { rows } = await db.query<{
    identidade: string;
    nome: string;
    inicioMs: number;
    fimMs: number;
    texto: string;
  }>(
    `SELECT identidade, nome, inicio_ms AS "inicioMs", fim_ms AS "fimMs", texto FROM comercial.sala_falas
      WHERE sessao_id = $1 AND conta_id = ${contaSql()} ORDER BY inicio_ms, id`,
    [sessaoId],
  );
  return rows;
}

/* ───────────── Telas do CRM ───────────── */

/** Quem vê só a própria base vê as reuniões que conduz e as dos próprios leads. */
function filtroDaBase(alias = 's'): string {
  const d = donoDaBase();
  return d ? `(${alias}.anfitriao_id = ${d} OR ${empresaNaBase(`${alias}.empresa_id`)})` : 'true';
}

const CAMPOS_LISTA = `s.id::int AS "salaId", s.codigo, s.titulo, s.inicio, s.fim, s.status, s.gravar, s.transcrever,
  s.entrada, s.abre_minutos_antes AS "abreMinutosAntes", s.empresa_id::int AS "empresaId",
  coalesce(e.maps_nome, e.nome) AS "empresaNome", s.anfitriao_id AS "anfitriaoId", u.nome AS "anfitriaoNome",
  s.tarefa_id::int AS "tarefaId", s.convite_enviado_em AS "conviteEnviadoEm"`;

/** Reuniões que ainda vão acontecer (ou estão acontecendo agora). */
export async function proximas(db: Executor, usuarioId: number | null) {
  const { rows } = await db.query(
    `SELECT ${CAMPOS_LISTA}
       FROM comercial.salas s
       LEFT JOIN descoberta.empresas e ON e.id = s.empresa_id
       LEFT JOIN cadastro.usuarios u ON u.id = s.anfitriao_id
      WHERE s.conta_id = ${contaSql()} AND ${filtroDaBase()}
        AND (s.status = 'ao_vivo' OR (s.status = 'marcada' AND s.inicio > now() - interval '12 hours'))
        AND ($1::int IS NULL OR s.anfitriao_id = $1)
      ORDER BY (s.status = 'ao_vivo') DESC, s.inicio LIMIT 100`,
    [usuarioId],
  );
  return rows;
}

const CAMPOS_SESSAO_LISTA = `ss.id::int, ss.iniciada_em AS "iniciadaEm", ss.encerrada_em AS "encerradaEm",
  ss.duracao_segundos AS "duracaoSegundos", ss.situacao, ss.transcricao, (ss.video_chave IS NOT NULL) AS "temVideo",
  ss.resumo->>'resumo' AS resumo, ss.resumo->>'interesse' AS interesse, ss.erro,
  (SELECT count(*)::int FROM comercial.sala_participantes sp
    WHERE sp.sala_id = s.id AND sp.entrou_em IS NOT NULL AND sp.entrou_em <= coalesce(ss.encerrada_em, now())
      AND coalesce(sp.saiu_em, now()) >= ss.iniciada_em) AS pessoas`;

/** Reuniões que já aconteceram (uma linha por sessão). */
export async function realizadas(db: Executor, f: { usuarioId: number | null; empresaId?: number | null }) {
  const { rows } = await db.query(
    `SELECT ${CAMPOS_SESSAO_LISTA}, ${CAMPOS_LISTA}
       FROM comercial.sala_sessoes ss
       JOIN comercial.salas s ON s.id = ss.sala_id
       LEFT JOIN descoberta.empresas e ON e.id = s.empresa_id
       LEFT JOIN cadastro.usuarios u ON u.id = s.anfitriao_id
      WHERE ss.conta_id = ${contaSql()} AND ${filtroDaBase()} AND ss.situacao <> 'ao_vivo'
        AND ($1::int IS NULL OR s.anfitriao_id = $1)
        AND ($2::bigint IS NULL OR s.empresa_id = $2)
      ORDER BY ss.iniciada_em DESC LIMIT 100`,
    [f.usuarioId, f.empresaId ?? null],
  );
  return rows;
}

/** Tudo de uma reunião que aconteceu: gravação, resumo, transcrição, quem esteve, chat. */
export async function detalhe(db: Executor, sessaoId: number) {
  const { rows } = await db.query<
    Record<string, unknown> & {
      salaId: number;
      resumoCompleto: ResumoReuniao | null;
      iniciadaEm: Date;
      encerradaEm: Date | null;
    }
  >(
    `SELECT ${CAMPOS_SESSAO_LISTA}, ${CAMPOS_LISTA}, ss.resumo AS "resumoCompleto",
            ss.tarefas_criadas_em AS "tarefasCriadasEm", ss.transcrever, ss.gravar AS "gravou",
            o.etapa, et.nome AS "etapaNome"
       FROM comercial.sala_sessoes ss
       JOIN comercial.salas s ON s.id = ss.sala_id
       LEFT JOIN descoberta.empresas e ON e.id = s.empresa_id
       LEFT JOIN cadastro.usuarios u ON u.id = s.anfitriao_id
       LEFT JOIN comercial.oportunidades o ON o.conta_id = s.conta_id AND o.empresa_id = s.empresa_id
       LEFT JOIN comercial.etapas et ON et.id = o.etapa_id
      WHERE ss.id = $1 AND ss.conta_id = ${contaSql()} AND ${filtroDaBase()}`,
    [sessaoId],
  );
  const d = rows[0];
  if (!d) throw AppError.naoEncontrado('Reunião');
  const [lista, pessoas, chat] = await Promise.all([
    falas(db, sessaoId),
    db.query<{ identidade: string; nome: string; tipo: string; segundos: number }>(
      `SELECT identidade, nome, tipo, segundos_na_sala AS segundos FROM comercial.sala_participantes
        WHERE sala_id = $1 AND entrou_em IS NOT NULL AND entrou_em <= coalesce($3::timestamptz, now())
          AND coalesce(saiu_em, now()) >= $2::timestamptz
        ORDER BY tipo DESC, entrou_em`,
      [d.salaId, d.iniciadaEm, d.encerradaEm],
    ),
    db.query<MensagemSala>(
      `SELECT ${CAMPOS_MENSAGEM} FROM comercial.sala_mensagens m
         LEFT JOIN comercial.sala_arquivos a ON a.id = m.arquivo_id
        WHERE m.sala_id = $1 AND (m.sessao_id = $2 OR m.sessao_id IS NULL) ORDER BY m.id LIMIT 500`,
      [d.salaId, sessaoId],
    ),
  ]);
  const partes = partesDeFala(lista);
  return {
    ...d,
    falas: lista,
    participantes: pessoas.rows.map((p) => ({ ...p, parteDaFala: partes.get(p.identidade) ?? null })),
    mensagens: chat.rows,
  };
}

/** Marca a sessão para processar de novo (transcrição e resumo). */
export async function reprocessar(db: Executor, sessaoId: number): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE comercial.sala_sessoes
        SET situacao = 'processando', processar_em = now(), tentativas = 0, erro = NULL
      WHERE id = $1 AND conta_id = ${contaSql()} AND situacao IN ('pronta', 'erro') AND gravar`,
    [sessaoId],
  );
  return !!rowCount;
}

/** Apaga a gravação e a transcrição de uma sessão (o resumo e o histórico ficam). */
export async function apagarGravacao(db: Executor, sessaoId: number): Promise<void> {
  await db.query(
    `UPDATE comercial.sala_sessoes SET video_chave = NULL, video_bytes = NULL WHERE id = $1 AND conta_id = ${contaSql()}`,
    [sessaoId],
  );
  await db.query(`UPDATE comercial.sala_gravacoes SET chave = NULL WHERE sessao_id = $1`, [sessaoId]);
  await db.query(`DELETE FROM comercial.sala_falas WHERE sessao_id = $1`, [sessaoId]);
}

export async function marcarTarefasCriadas(db: Executor, sessaoId: number): Promise<void> {
  await db.query(
    `UPDATE comercial.sala_sessoes SET tarefas_criadas_em = now() WHERE id = $1 AND conta_id = ${contaSql()}`,
    [sessaoId],
  );
}

/** Sessão que esta pessoa pode ver (para assistir, baixar, reprocessar). */
export async function sessaoVisivel(db: Executor, sessaoId: number) {
  const { rows } = await db.query<{
    salaId: number;
    titulo: string;
    empresaId: number | null;
    anfitriaoId: number | null;
    videoChave: string | null;
    iniciadaEm: Date;
  }>(
    `SELECT s.id::int AS "salaId", s.titulo, s.empresa_id::int AS "empresaId", s.anfitriao_id AS "anfitriaoId",
            ss.video_chave AS "videoChave", ss.iniciada_em AS "iniciadaEm"
       FROM comercial.sala_sessoes ss JOIN comercial.salas s ON s.id = ss.sala_id
      WHERE ss.id = $1 AND ss.conta_id = ${contaSql()} AND ${filtroDaBase()}`,
    [sessaoId],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Reunião');
  return rows[0];
}

/** Arquivo do chat que esta pessoa pode baixar (pela tela da reunião, no CRM). */
export async function arquivoVisivel(db: Executor, id: number) {
  const { rows } = await db.query<{ nome: string; mime: string; dados: Buffer }>(
    `SELECT a.nome, a.mime, a.dados FROM comercial.sala_arquivos a JOIN comercial.salas s ON s.id = a.sala_id
      WHERE a.id = $1 AND a.conta_id = ${contaSql()} AND ${filtroDaBase()}`,
    [id],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Arquivo');
  return rows[0];
}

/** Salas de um lead (para a LGPD apagar tudo dele na organização). */
export async function salasDoLead(db: Executor, empresaId: number, contas: string) {
  const { rows } = await db.query<{ id: number }>(
    `SELECT id::int FROM comercial.salas WHERE empresa_id = $1 AND conta_id IN ${contas}`,
    [empresaId],
  );
  return rows.map((r) => r.id);
}
