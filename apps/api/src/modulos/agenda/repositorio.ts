import type { Executor } from '@prospeccao/db';
import {
  AppError,
  type ConfigAgendaEntrada,
  ROTULO_TAREFA,
  type TarefaAtualizar,
  type TarefaEntrada,
  type TipoTarefa,
} from '@prospeccao/shared';
import { contaSql, usuarioAtual } from '../../contexto.js';
import { usuarioDaConta } from '../equipe/repositorio.js';

/** Agenda: reuniões com data e hora, ligações, visitas e tarefas. */

const HOJE_SP = `(date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')`;
const FIM_DE_HOJE = `(${HOJE_SP} + interval '1 day')`;

export async function obterConfig(db: Executor): Promise<ConfigAgendaEntrada> {
  const { rows } = await db.query<ConfigAgendaEntrada>(
    `SELECT lembrete_lead AS "lembreteLead", lembrete_lead_minutos AS "lembreteLeadMinutos",
            texto_lembrete_lead AS "textoLembreteLead", lembrete_usuario_minutos AS "lembreteUsuarioMinutos",
            lembrete_usuario_whatsapp AS "lembreteUsuarioWhatsapp", duracao_reuniao_min AS "duracaoReuniaoMin"
       FROM comercial.config_agenda WHERE conta_id = ${contaSql()}`,
  );
  const c = rows[0];
  if (!c) throw new Error('config_agenda vazia: a migration 027 não rodou');
  return c;
}

export async function salvarConfig(db: Executor, c: ConfigAgendaEntrada): Promise<void> {
  await db.query(
    `UPDATE comercial.config_agenda
        SET lembrete_lead = $1, lembrete_lead_minutos = $2, texto_lembrete_lead = $3,
            lembrete_usuario_minutos = $4, lembrete_usuario_whatsapp = $5, duracao_reuniao_min = $6
      WHERE conta_id = ${contaSql()}`,
    [
      c.lembreteLead,
      c.lembreteLeadMinutos,
      c.textoLembreteLead,
      c.lembreteUsuarioMinutos,
      c.lembreteUsuarioWhatsapp,
      c.duracaoReuniaoMin,
    ],
  );
}

const CAMPOS = `t.id::int, t.empresa_id::int AS "empresaId", e.nome AS "empresaNome", e.cidade AS "empresaCidade",
  t.usuario_id AS "usuarioId", u.nome AS "usuarioNome", t.tipo, t.titulo, t.descricao, t.inicio, t.fim,
  t.local, t.concluida_em AS "concluidaEm", t.lembrete_lead_em AS "lembreteLeadEm",
  (t.concluida_em IS NULL AND t.inicio < now() - interval '1 hour') AS atrasada`;
const JUNCOES = `LEFT JOIN descoberta.empresas e ON e.id = t.empresa_id
  LEFT JOIN cadastro.usuarios u ON u.id = t.usuario_id`;

/** O responsável da tarefa precisa ser alguém da conta. */
async function conferirUsuario(db: Executor, usuarioId: number) {
  const { rows } = await db.query(
    `SELECT 1 FROM cadastro.usuarios WHERE id = $1 AND conta_id = ${contaSql()} AND ativo`,
    [usuarioId],
  );
  if (!rows.length) throw AppError.naoEncontrado('Usuário');
}

async function conferirLead(db: Executor, empresaId: number) {
  const { rows } = await db.query(
    `SELECT 1 FROM comercial.oportunidades WHERE conta_id = ${contaSql()} AND empresa_id = $1`,
    [empresaId],
  );
  if (!rows.length) throw AppError.naoEncontrado('Lead no funil');
}

export async function obter(db: Executor, id: number) {
  const { rows } = await db.query(
    `SELECT ${CAMPOS} FROM comercial.tarefas t ${JUNCOES} WHERE t.id = $1 AND t.conta_id = ${contaSql()}`,
    [id],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Tarefa');
  return rows[0];
}

/** Reunião ou visita com o lead vira o próximo passo dele (aparece no card com data e hora). */
async function sincronizarProximoPasso(db: Executor, empresaId: number, tipo: TipoTarefa, inicio: string) {
  if (tipo !== 'reuniao' && tipo !== 'visita') return;
  await db.query(
    `UPDATE comercial.oportunidades
        SET proxima_acao = $2, proxima_acao_em = $3, encerrar_em = NULL
      WHERE conta_id = ${contaSql()} AND empresa_id = $1 AND etapa NOT IN ('ganho', 'perdido', 'descartado')`,
    [empresaId, ROTULO_TAREFA[tipo], inicio],
  );
}

export async function criar(db: Executor, d: TarefaEntrada): Promise<number> {
  const C = contaSql();
  // Quem registra (o master visitando outra conta não vira dono da tarefa de lá).
  const quem = usuarioDaConta();
  let usuarioId = d.usuarioId;
  if (d.empresaId) {
    const { rows } = await db.query<{ r: number | null }>(
      `SELECT responsavel_id AS r FROM comercial.oportunidades WHERE conta_id = ${C} AND empresa_id = $1`,
      [d.empresaId],
    );
    if (!rows.length) throw AppError.naoEncontrado('Lead no funil');
    if (usuarioId === undefined) usuarioId = rows[0]?.r ?? quem;
  }
  if (usuarioId) await conferirUsuario(db, usuarioId);
  let fim = d.fim ?? null;
  if (!fim && (d.tipo === 'reuniao' || d.tipo === 'visita')) {
    const cfg = await obterConfig(db);
    fim = new Date(new Date(d.inicio).getTime() + cfg.duracaoReuniaoMin * 60_000).toISOString();
  }
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO comercial.tarefas
       (conta_id, empresa_id, usuario_id, tipo, titulo, descricao, inicio, fim, local, criado_por)
     VALUES (${C}, $1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id::int`,
    [
      d.empresaId ?? null,
      usuarioId ?? quem,
      d.tipo,
      d.titulo,
      d.descricao ?? null,
      d.inicio,
      fim,
      d.local ?? null,
      usuarioAtual()?.id ?? null,
    ],
  );
  if (d.empresaId) await sincronizarProximoPasso(db, d.empresaId, d.tipo, d.inicio);
  return rows[0]!.id;
}

/** Reunião marcada para o lead (pela tela ou pela IA). */
export async function criarReuniaoDoLead(
  db: Executor,
  empresaId: number,
  inicio: string,
  local: string | null,
): Promise<number> {
  const { rows } = await db.query<{ nome: string }>('SELECT nome FROM descoberta.empresas WHERE id = $1', [
    empresaId,
  ]);
  // (a conta do lead é conferida em criar)
  return criar(db, {
    empresaId,
    tipo: 'reuniao',
    titulo: `Reunião com ${rows[0]?.nome ?? 'o lead'}`,
    inicio: new Date(inicio).toISOString(),
    local,
  });
}

export async function atualizar(db: Executor, id: number, d: TarefaAtualizar): Promise<void> {
  const atual = (await obter(db, id)) as { empresaId: number | null; tipo: TipoTarefa; inicio: Date };
  const sets: string[] = [];
  const valores: unknown[] = [id];
  const set = (coluna: string, v: unknown) => {
    valores.push(v);
    sets.push(`${coluna} = $${valores.length}`);
  };
  if (d.titulo !== undefined) set('titulo', d.titulo);
  if (d.descricao !== undefined) set('descricao', d.descricao);
  if (d.tipo !== undefined) set('tipo', d.tipo);
  if (d.inicio !== undefined) {
    set('inicio', d.inicio);
    // Remarcou: os lembretes valem de novo para o horário novo.
    sets.push('lembrete_lead_em = NULL', 'lembrete_usuario_em = NULL');
  }
  if (d.fim !== undefined) set('fim', d.fim);
  if (d.local !== undefined) set('local', d.local);
  if (d.usuarioId !== undefined) {
    if (d.usuarioId) await conferirUsuario(db, d.usuarioId);
    set('usuario_id', d.usuarioId);
  }
  if (d.empresaId !== undefined) {
    if (d.empresaId) await conferirLead(db, d.empresaId);
    set('empresa_id', d.empresaId);
  }
  if (d.concluida !== undefined) sets.push(`concluida_em = ${d.concluida ? 'now()' : 'NULL'}`);
  if (sets.length)
    await db.query(
      `UPDATE comercial.tarefas SET ${sets.join(', ')} WHERE id = $1 AND conta_id = ${contaSql()}`,
      valores,
    );
  const empresaId = d.empresaId ?? atual.empresaId;
  if (empresaId && d.inicio) await sincronizarProximoPasso(db, empresaId, d.tipo ?? atual.tipo, d.inicio);
}

export async function apagar(db: Executor, id: number): Promise<void> {
  const { rowCount } = await db.query(
    `DELETE FROM comercial.tarefas WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id],
  );
  if (!rowCount) throw AppError.naoEncontrado('Tarefa');
}

export async function listar(db: Executor, de: string, ate: string, usuarioId: number | null) {
  const { rows } = await db.query(
    `SELECT ${CAMPOS} FROM comercial.tarefas t ${JUNCOES}
      WHERE t.conta_id = ${contaSql()} AND t.inicio >= $1 AND t.inicio < $2 AND ($3::int IS NULL OR t.usuario_id = $3)
      ORDER BY t.inicio, t.id LIMIT 1000`,
    [de, ate, usuarioId],
  );
  return rows;
}

export async function doLead(db: Executor, empresaId: number) {
  const { rows } = await db.query(
    `SELECT ${CAMPOS} FROM comercial.tarefas t ${JUNCOES}
      WHERE t.conta_id = ${contaSql()} AND t.empresa_id = $1 ORDER BY (t.concluida_em IS NOT NULL), t.inicio DESC LIMIT 50`,
    [empresaId],
  );
  return rows;
}

/**
 * "Meu dia": o que fazer hoje, numa lista só. Tarefas e reuniões atrasadas e de hoje,
 * follow-ups da cadência vencidos ou de hoje (dos seus leads) e conversas por responder.
 */
export async function meuDia(db: Executor, usuarioId: number | null) {
  const C = contaSql();
  const [tarefas, followups, conversas, proximas] = await Promise.all([
    db.query(
      `SELECT ${CAMPOS} FROM comercial.tarefas t ${JUNCOES}
        WHERE t.conta_id = ${C} AND t.concluida_em IS NULL AND t.inicio < ${FIM_DE_HOJE}
          AND ($1::int IS NULL OR t.usuario_id = $1)
        ORDER BY t.inicio LIMIT 300`,
      [usuarioId],
    ),
    db.query(
      `SELECT o.empresa_id::int AS "empresaId", e.nome, e.cidade, o.etapa, et.nome AS "etapaNome",
              et.cor AS "etapaCor", o.proxima_acao AS "proximaAcao", o.proxima_acao_em AS "proximaAcaoEm",
              (o.proxima_acao_em < ${HOJE_SP}) AS atrasado, o.tentativas, o.agente,
              o.agente_pausa AS "agentePausa", u.nome AS "responsavelNome"
         FROM comercial.oportunidades o
         JOIN descoberta.empresas e ON e.id = o.empresa_id
         LEFT JOIN comercial.etapas et ON et.id = o.etapa_id
         LEFT JOIN cadastro.usuarios u ON u.id = o.responsavel_id
        WHERE o.conta_id = ${C} AND o.proxima_acao_em < ${FIM_DE_HOJE}
          AND o.etapa NOT IN ('ganho', 'perdido', 'descartado')
          AND ($1::int IS NULL OR o.responsavel_id = $1)
          -- a IA cuida sozinha; só aparece se ela passou o lead para você
          AND NOT (o.agente AND o.agente_pausa IS NULL)
          -- reunião/visita marcada já aparece como compromisso
          AND NOT EXISTS (SELECT 1 FROM comercial.tarefas t WHERE t.conta_id = ${C} AND t.empresa_id = o.empresa_id
                           AND t.concluida_em IS NULL AND t.tipo IN ('reuniao', 'visita')
                           AND t.inicio < ${FIM_DE_HOJE})
        ORDER BY o.proxima_acao_em LIMIT 300`,
      [usuarioId],
    ),
    db.query(
      `SELECT m.empresa_id::int AS "empresaId", e.nome, count(*)::int AS "naoLidas",
              max(m.criado_em) AS "ultimaEm",
              (array_agg(m.texto ORDER BY m.criado_em DESC))[1] AS "ultima"
         FROM comercial.mensagens m
         JOIN comercial.oportunidades o ON o.conta_id = m.conta_id AND o.empresa_id = m.empresa_id
         JOIN descoberta.empresas e ON e.id = m.empresa_id
        WHERE m.conta_id = ${C} AND m.direcao = 'recebida' AND m.lida_em IS NULL
          AND ($1::int IS NULL OR o.responsavel_id = $1)
        GROUP BY m.empresa_id, e.nome ORDER BY max(m.criado_em) DESC LIMIT 50`,
      [usuarioId],
    ),
    db.query(
      `SELECT ${CAMPOS} FROM comercial.tarefas t ${JUNCOES}
        WHERE t.conta_id = ${C} AND t.concluida_em IS NULL AND t.inicio >= ${FIM_DE_HOJE}
          AND t.inicio < ${FIM_DE_HOJE} + interval '7 days'
          AND ($1::int IS NULL OR t.usuario_id = $1)
        ORDER BY t.inicio LIMIT 50`,
      [usuarioId],
    ),
  ]);
  return {
    tarefas: tarefas.rows,
    followups: followups.rows,
    conversas: conversas.rows,
    proximas: proximas.rows,
  };
}

/* ───────────── Calendário (.ics) para o Google Agenda ───────────── */

function dataIcs(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function escaparIcs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Quebra linhas longas (o formato pede no máximo 75 bytes por linha). */
function dobrar(linha: string): string {
  const partes: string[] = [];
  let resto = linha;
  while (Buffer.byteLength(resto) > 74) {
    let corte = 74;
    while (Buffer.byteLength(resto.slice(0, corte)) > 74) corte--;
    partes.push(resto.slice(0, corte));
    resto = resto.slice(corte);
  }
  partes.push(resto);
  return partes.join('\r\n ');
}

/** Agenda de uma pessoa no formato que o Google Agenda assina ("Adicionar agenda por URL"). */
export async function calendario(db: Executor, token: string): Promise<string | null> {
  const { rows: us } = await db.query<{ id: number; nome: string; conta_id: number }>(
    'SELECT id, nome, conta_id FROM cadastro.usuarios WHERE agenda_token = $1 AND ativo',
    [token],
  );
  const u = us[0];
  if (!u) return null;
  const { rows } = await db.query<{
    id: number;
    tipo: TipoTarefa;
    titulo: string;
    descricao: string | null;
    inicio: Date;
    fim: Date | null;
    local: string | null;
    empresa: string | null;
    telefone: string | null;
    concluida_em: Date | null;
    atualizado: Date;
  }>(
    `SELECT t.id::int, t.tipo, t.titulo, t.descricao, t.inicio, t.fim, t.local, e.nome AS empresa,
            e.maps_telefone AS telefone, t.concluida_em, coalesce(t.concluida_em, t.criado_em) AS atualizado
       FROM comercial.tarefas t LEFT JOIN descoberta.empresas e ON e.id = t.empresa_id
      WHERE t.usuario_id = $1 AND t.conta_id = $2
        AND t.inicio > now() - interval '60 days' AND t.inicio < now() + interval '365 days'
      ORDER BY t.inicio`,
    [u.id, u.conta_id],
  );
  const linhas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tutts//Prospeccao//PT-BR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escaparIcs(`Prospect Team · ${u.nome}`)}`,
    'X-WR-TIMEZONE:America/Sao_Paulo',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  for (const t of rows) {
    const inicio = new Date(t.inicio);
    const fim = t.fim ? new Date(t.fim) : new Date(inicio.getTime() + 30 * 60_000);
    const desc = [t.descricao, t.empresa && `Lead: ${t.empresa}`, t.telefone && `Telefone: ${t.telefone}`]
      .filter(Boolean)
      .join('\n');
    linhas.push(
      'BEGIN:VEVENT',
      `UID:tarefa-${t.id}@prospeccao`,
      `DTSTAMP:${dataIcs(new Date(t.atualizado))}`,
      `DTSTART:${dataIcs(inicio)}`,
      `DTEND:${dataIcs(fim)}`,
      `SUMMARY:${escaparIcs(`${t.concluida_em ? '✓ ' : ''}${t.titulo}`)}`,
      ...(desc ? [`DESCRIPTION:${escaparIcs(desc)}`] : []),
      ...(t.local ? [`LOCATION:${escaparIcs(t.local)}`] : []),
      `CATEGORIES:${ROTULO_TAREFA[t.tipo]}`,
      ...(t.tipo === 'reuniao' || t.tipo === 'visita'
        ? ['BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Lembrete', 'TRIGGER:-PT15M', 'END:VALARM']
        : []),
      'END:VEVENT',
    );
  }
  linhas.push('END:VCALENDAR');
  return `${linhas.map(dobrar).join('\r\n')}\r\n`;
}
