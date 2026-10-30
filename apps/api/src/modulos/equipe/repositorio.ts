import { randomBytes } from 'node:crypto';
import type { Executor } from '@prospeccao/db';
import {
  AppError,
  type DistribuicaoEntrada,
  type PapelUsuario,
  type UsuarioAtualizar,
  type UsuarioNovo,
} from '@prospeccao/shared';
import { contaSql, donoDaBase, usuarioAtual } from '../../contexto.js';
import { temRecurso } from '../../recursos.js';
import { notificar } from '../notificacoes/repositorio.js';
import { exigirVagaDeUsuario } from '../plano/repositorio.js';

/** Equipe: usuários, como os leads são divididos e o desempenho de cada um. */

const HOJE_SP = `(date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')`;
const MES_SP = `(date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')`;
const ABERTO = `o.etapa NOT IN ('ganho', 'perdido', 'descartado')`;

export const DIAS_CONVITE = 7;

/** Quem está logado, se for da conta (o master visitando outra conta não vira dono de lead dela). */
export function usuarioDaConta(): number | null {
  const u = usuarioAtual();
  return u && u.contaPropria === u.contaId ? u.id : null;
}

export async function listar(db: Executor) {
  const C = contaSql();
  const [usuarios, cfg] = await Promise.all([
    db.query(
      `SELECT u.id, u.nome, u.email, u.papel, u.ativo, u.recebe_leads AS "recebeLeads", u.alcance, u.telefone,
              (u.senha_hash IS NULL) AS "convitePendente", u.ultimo_acesso AS "ultimoAcesso",
              (SELECT count(*)::int FROM comercial.oportunidades o
                WHERE o.conta_id = ${C} AND o.responsavel_id = u.id AND ${ABERTO}) AS "leadsAbertos",
              json_build_object('abordagensDia', coalesce(m.abordagens_dia, 30),
                                'reunioesMes', coalesce(m.reunioes_mes, 10),
                                'ganhosMes', coalesce(m.ganhos_mes, 3)) AS metas
         FROM cadastro.usuarios u LEFT JOIN comercial.metas m ON m.usuario_id = u.id
        WHERE u.conta_id = ${C} AND u.papel NOT IN ('gestor', 'leitura')
        ORDER BY u.ativo DESC, CASE u.papel WHEN 'admin' THEN 0 WHEN 'sdr' THEN 1 ELSE 2 END, u.nome`,
    ),
    obterDistribuicao(db),
  ]);
  const { rows: semDono } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM comercial.oportunidades o
      WHERE o.conta_id = ${C} AND o.responsavel_id IS NULL AND ${ABERTO}`,
  );
  return { usuarios: usuarios.rows, distribuicao: cfg, semDono: semDono[0]?.n ?? 0 };
}

function novoToken() {
  return randomBytes(24).toString('base64url');
}

export async function criar(db: Executor, d: UsuarioNovo): Promise<{ id: number; token: string }> {
  await exigirVagaDeUsuario(db);
  const token = novoToken();
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO cadastro.usuarios (nome, email, papel, telefone, convite_token, convite_expira, conta_id, alcance)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => ${DIAS_CONVITE}), ${contaSql()}, $6)
     ON CONFLICT ((lower(email))) DO NOTHING
     RETURNING id`,
    [
      d.nome,
      d.email,
      d.papel,
      d.telefone ?? null,
      token,
      d.papel === 'admin' ? 'unidade' : (d.alcance ?? 'unidade'),
    ],
  );
  if (!rows[0])
    throw AppError.conflito('Já existe alguém com este e-mail (nesta ou em outra empresa do sistema).');
  await db.query('INSERT INTO comercial.metas (usuario_id) VALUES ($1) ON CONFLICT DO NOTHING', [rows[0].id]);
  return { id: rows[0].id, token };
}

/** Novo link para criar senha (convite que expirou ou senha esquecida). A senha antiga deixa de valer. */
export async function novoConvite(db: Executor, id: number): Promise<string> {
  const token = novoToken();
  const { rowCount } = await db.query(
    `UPDATE cadastro.usuarios
        SET convite_token = $2, convite_expira = now() + make_interval(days => ${DIAS_CONVITE}), senha_hash = NULL
      WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id, token],
  );
  if (!rowCount) throw AppError.naoEncontrado('Usuário');
  return token;
}

async function admins(db: Executor, exceto: number): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM cadastro.usuarios
      WHERE conta_id = ${contaSql()} AND papel = 'admin' AND ativo AND id <> $1`,
    [exceto],
  );
  return rows[0]?.n ?? 0;
}

export async function atualizar(db: Executor, id: number, d: UsuarioAtualizar): Promise<void> {
  const { rows } = await db.query<{ papel: PapelUsuario; ativo: boolean }>(
    `SELECT papel, ativo FROM cadastro.usuarios
      WHERE id = $1 AND conta_id = ${contaSql()} AND papel NOT IN ('gestor', 'leitura')`,
    [id],
  );
  const u = rows[0];
  if (!u) throw AppError.naoEncontrado('Usuário');
  // Reativar ocupa uma vaga do plano.
  if (d.ativo === true && !u.ativo) await exigirVagaDeUsuario(db);
  const tiraAdmin = u.papel === 'admin' && ((d.papel && d.papel !== 'admin') || d.ativo === false);
  if (tiraAdmin && (await admins(db, id)) === 0)
    throw AppError.invalido('Precisa ficar pelo menos um administrador ativo.');

  const sets: string[] = [];
  const valores: unknown[] = [id];
  const set = (coluna: string, v: unknown) => {
    valores.push(v);
    sets.push(`${coluna} = $${valores.length}`);
  };
  if (d.nome !== undefined) set('nome', d.nome);
  if (d.papel !== undefined) set('papel', d.papel);
  if (d.ativo !== undefined) set('ativo', d.ativo);
  if (d.recebeLeads !== undefined) set('recebe_leads', d.recebeLeads);
  // Administrador sempre vê a unidade toda.
  const papelFinal = d.papel ?? u.papel;
  if (papelFinal === 'admin') set('alcance', 'unidade');
  else if (d.alcance !== undefined) set('alcance', d.alcance);
  if (d.telefone !== undefined) set('telefone', d.telefone);
  if (sets.length)
    await db.query(
      `UPDATE cadastro.usuarios SET ${sets.join(', ')} WHERE id = $1 AND conta_id = ${contaSql()}`,
      valores,
    );
  if (d.metas)
    await db.query(
      `INSERT INTO comercial.metas (usuario_id, abordagens_dia, reunioes_mes, ganhos_mes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (usuario_id) DO UPDATE
          SET abordagens_dia = EXCLUDED.abordagens_dia, reunioes_mes = EXCLUDED.reunioes_mes,
              ganhos_mes = EXCLUDED.ganhos_mes`,
      [id, d.metas.abordagensDia, d.metas.reunioesMes, d.metas.ganhosMes],
    );
  // Desativado: os leads abertos dele ficam sem dono (entram na redistribuição).
  if (d.ativo === false)
    await db.query(
      `UPDATE comercial.oportunidades o SET responsavel_id = NULL
        WHERE o.conta_id = ${contaSql()} AND o.responsavel_id = $1 AND ${ABERTO}`,
      [id],
    );
}

/* ───────────── Distribuição dos leads ───────────── */

export async function obterDistribuicao(db: Executor): Promise<DistribuicaoEntrada> {
  const { rows } = await db.query<DistribuicaoEntrada>(
    `SELECT distribuicao_sdr AS sdr, distribuicao_closer AS closer FROM comercial.config_equipe
      WHERE conta_id = ${contaSql()}`,
  );
  return rows[0] ?? { sdr: 'rodizio', closer: 'rodizio' };
}

export async function salvarDistribuicao(db: Executor, d: DistribuicaoEntrada): Promise<void> {
  await db.query(
    `UPDATE comercial.config_equipe SET distribuicao_sdr = $1, distribuicao_closer = $2
      WHERE conta_id = ${contaSql()}`,
    [d.sdr, d.closer],
  );
}

/** Próxima pessoa do rodízio (SDR ou closer) que está ativa e recebendo leads. */
export async function proximoDoRodizio(db: Executor, papel: 'sdr' | 'closer'): Promise<number | null> {
  const coluna = papel === 'sdr' ? 'ultimo_sdr' : 'ultimo_closer';
  const C = contaSql();
  const { rows: cfg } = await db.query<{ ultimo: number | null }>(
    `SELECT ${coluna} AS ultimo FROM comercial.config_equipe WHERE conta_id = ${C} FOR UPDATE`,
  );
  const { rows } = await db.query<{ id: number }>(
    `SELECT id FROM cadastro.usuarios WHERE conta_id = ${C} AND ativo AND recebe_leads AND papel = $1
      ORDER BY (id <= $2), id LIMIT 1`,
    [papel, cfg[0]?.ultimo ?? 0],
  );
  const id = rows[0]?.id ?? null;
  if (id) await db.query(`UPDATE comercial.config_equipe SET ${coluna} = $1 WHERE conta_id = ${C}`, [id]);
  return id;
}

/** Troca o dono do lead, registra no histórico e avisa quem recebeu. */
export async function definirResponsavel(
  db: Executor,
  empresaId: number,
  usuarioId: number | null,
  motivo?: string,
): Promise<void> {
  const C = contaSql();
  const { rows } = await db.query<{ antes: number | null; nome: string | null; empresa: string }>(
    `SELECT o.responsavel_id AS antes, u.nome, e.nome AS empresa
       FROM comercial.oportunidades o
       JOIN descoberta.empresas e ON e.id = o.empresa_id
       LEFT JOIN cadastro.usuarios u ON u.id = $2 AND u.conta_id = ${C}
      WHERE o.conta_id = ${C} AND o.empresa_id = $1`,
    [empresaId, usuarioId],
  );
  const r = rows[0];
  if (!r || r.antes === usuarioId) return;
  if (usuarioId && !r.nome) throw AppError.naoEncontrado('Usuário');
  await db.query(
    `UPDATE comercial.oportunidades SET responsavel_id = $2 WHERE conta_id = ${C} AND empresa_id = $1`,
    [empresaId, usuarioId],
  );
  const quem = usuarioAtual();
  await db.query(
    `INSERT INTO comercial.atividades (conta_id, empresa_id, tipo, texto, autor, usuario_id)
     VALUES (${C}, $1, 'nota', $2, $3, $4)`,
    [
      empresaId,
      `${usuarioId ? `Responsável: ${r.nome}` : 'Ficou sem responsável'}${motivo ? ` (${motivo})` : ''}`,
      quem?.nome ?? 'sistema',
      quem?.id ?? null,
    ],
  );
  if (usuarioId && usuarioId !== quem?.id)
    await notificar(db, usuarioId, {
      tipo: 'atribuido',
      titulo: `Lead novo para você: ${r.empresa}`,
      texto: motivo ?? null,
      empresaId,
    });
}

/** Lead que entrou no funil: rodízio entre os SDRs, ou fica com quem mandou. */
export async function atribuirNaEntrada(db: Executor, empresaId: number): Promise<void> {
  // Quem trabalha só a própria base fica com o lead que pôs no funil (fora do rodízio).
  const dono = donoDaBase();
  if (dono) return definirResponsavel(db, empresaId, dono);
  const cfg = await obterDistribuicao(db);
  const quem = usuarioDaConta();
  // O rodízio é do trabalho em equipe; sem ele no plano, o lead fica com quem o pôs no funil.
  const rodizio = cfg.sdr === 'rodizio' && (await temRecurso(db, 'equipe'));
  const id = rodizio ? ((await proximoDoRodizio(db, 'sdr')) ?? quem) : quem;
  if (id) await definirResponsavel(db, empresaId, id, rodizio ? 'rodízio' : undefined);
}

/** Reunião marcada: passa para um closer (rodízio) ou continua com o SDR. */
export async function atribuirNaReuniao(db: Executor, empresaId: number): Promise<void> {
  const cfg = await obterDistribuicao(db);
  if (cfg.closer !== 'rodizio' || !(await temRecurso(db, 'equipe'))) return;
  const id = await proximoDoRodizio(db, 'closer');
  if (id) await definirResponsavel(db, empresaId, id, 'reunião marcada');
}

/** Leads abertos sem dono: SDR para quem ainda está na prospecção, closer para reunião e proposta. */
export async function distribuirSemDono(db: Executor): Promise<number> {
  const { rows } = await db.query<{ empresa_id: number; etapa: string }>(
    `SELECT o.empresa_id::int, o.etapa FROM comercial.oportunidades o
      WHERE o.conta_id = ${contaSql()} AND o.responsavel_id IS NULL AND ${ABERTO}
      ORDER BY o.criado_em LIMIT 5000`,
  );
  let n = 0;
  for (const o of rows) {
    const papel = o.etapa === 'reuniao' || o.etapa === 'proposta' ? 'closer' : 'sdr';
    const id =
      (await proximoDoRodizio(db, papel)) ?? (await proximoDoRodizio(db, papel === 'sdr' ? 'closer' : 'sdr'));
    if (!id) break;
    await definirResponsavel(db, o.empresa_id, id, 'distribuição dos leads sem dono');
    n++;
  }
  return n;
}

/* ───────────── Desempenho ───────────── */

export async function desempenho(db: Executor, dias: number) {
  const desde = dias > 0 ? `now() - make_interval(days => ${Math.floor(dias)})` : `'-infinity'::timestamptz`;
  const C = contaSql();
  const { rows } = await db.query(
    `WITH contatos AS (
       SELECT a.usuario_id,
              count(*) FILTER (WHERE a.criado_em >= ${desde})::int AS periodo,
              count(*) FILTER (WHERE a.criado_em >= ${HOJE_SP})::int AS hoje
         FROM comercial.atividades a
        WHERE a.conta_id = ${C} AND a.direcao = 'enviada' AND a.tipo IN ('whatsapp', 'ligacao', 'email', 'visita')
          AND a.usuario_id IS NOT NULL
        GROUP BY 1),
     pela_ia AS (
       SELECT o.responsavel_id AS usuario_id, count(*)::int AS n
         FROM comercial.atividades a
         JOIN comercial.oportunidades o ON o.conta_id = a.conta_id AND o.empresa_id = a.empresa_id
        WHERE a.conta_id = ${C} AND a.autor = 'agente' AND a.direcao = 'enviada' AND a.criado_em >= ${desde}
        GROUP BY 1),
     respostas AS (
       SELECT o.responsavel_id AS usuario_id, count(DISTINCT a.empresa_id)::int AS n
         FROM comercial.atividades a
         JOIN comercial.oportunidades o ON o.conta_id = a.conta_id AND o.empresa_id = a.empresa_id
        WHERE a.conta_id = ${C} AND a.direcao = 'recebida' AND a.criado_em >= ${desde}
        GROUP BY 1),
     etapas AS (
       SELECT a.usuario_id,
              count(*) FILTER (WHERE a.para_etapa = 'reuniao' AND a.criado_em >= ${desde})::int AS reunioes,
              count(*) FILTER (WHERE a.para_etapa = 'reuniao' AND a.criado_em >= ${MES_SP})::int AS reunioes_mes,
              count(*) FILTER (WHERE a.para_etapa = 'ganho' AND a.criado_em >= ${desde})::int AS ganhos,
              count(*) FILTER (WHERE a.para_etapa = 'ganho' AND a.criado_em >= ${MES_SP})::int AS ganhos_mes
         FROM comercial.atividades a
        WHERE a.conta_id = ${C} AND a.tipo = 'etapa' AND a.de_etapa IS DISTINCT FROM a.para_etapa
          AND a.para_etapa IN ('reuniao', 'ganho') AND a.usuario_id IS NOT NULL
        GROUP BY 1),
     valor AS (
       SELECT o.responsavel_id AS usuario_id, sum(o.valor_mensal)::float8 AS ganho
         FROM comercial.oportunidades o
        WHERE o.conta_id = ${C} AND o.etapa = 'ganho' AND o.etapa_desde >= ${desde}
        GROUP BY 1),
     abertos AS (
       SELECT o.responsavel_id AS usuario_id, count(*)::int AS n,
              count(*) FILTER (WHERE o.proxima_acao_em < now())::int AS atrasados
         FROM comercial.oportunidades o WHERE o.conta_id = ${C} AND ${ABERTO} GROUP BY 1)
     SELECT u.id, u.nome, u.papel,
            coalesce(c.hoje, 0) AS "contatosHoje", coalesce(c.periodo, 0) AS contatos,
            coalesce(ia.n, 0) AS "pelaIa", coalesce(r.n, 0) AS respostas,
            coalesce(et.reunioes, 0) AS reunioes, coalesce(et.reunioes_mes, 0) AS "reunioesMes",
            coalesce(et.ganhos, 0) AS ganhos, coalesce(et.ganhos_mes, 0) AS "ganhosMes",
            coalesce(v.ganho, 0) AS "valorGanho",
            coalesce(ab.n, 0) AS abertos, coalesce(ab.atrasados, 0) AS atrasados,
            json_build_object('abordagensDia', coalesce(m.abordagens_dia, 30),
                              'reunioesMes', coalesce(m.reunioes_mes, 10),
                              'ganhosMes', coalesce(m.ganhos_mes, 3)) AS metas
       FROM cadastro.usuarios u
       LEFT JOIN comercial.metas m ON m.usuario_id = u.id
       LEFT JOIN contatos c ON c.usuario_id = u.id
       LEFT JOIN pela_ia ia ON ia.usuario_id = u.id
       LEFT JOIN respostas r ON r.usuario_id = u.id
       LEFT JOIN etapas et ON et.usuario_id = u.id
       LEFT JOIN valor v ON v.usuario_id = u.id
       LEFT JOIN abertos ab ON ab.usuario_id = u.id
      WHERE u.ativo AND u.conta_id = ${C} AND (${donoDaBase() ?? 'NULL'}::int IS NULL OR u.id = ${donoDaBase() ?? 'NULL'}::int)
      ORDER BY coalesce(et.ganhos, 0) DESC, coalesce(et.reunioes, 0) DESC, coalesce(c.periodo, 0) DESC, u.nome`,
  );
  return rows;
}
