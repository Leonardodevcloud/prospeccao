import type { Executor } from '@prospeccao/db';
import {
  AppError,
  type Atendimento,
  type AtendimentoAnterior,
  type ClienteDoAtendimento,
  CONFIG_ATENDIMENTO_PADRAO,
  type ConfigAtendimento,
  type ConfigAtendimentoEntrada,
  type ContagemFilas,
  type CorEtiqueta,
  cnpjDoTexto,
  type EncerrarEntrada,
  type Etiqueta,
  type EventoAtendimento,
  type FiltrosAtendimento,
  lerCsv,
  MOTIVO_SEM_RESPOSTA,
  normalizarTelefone,
  type PainelAtendimentoCarteira,
  PERGUNTA_PESQUISA,
  type PessoaAtendimento,
  type ResultadoImportacaoCarteira,
  type ResumoCarteira,
  type TransferirEntrada,
  textoEncerramento,
} from '@prospeccao/shared';
import { contaSql, naBase, usuarioAtual } from '../../contexto.js';
import type { DepsApi } from '../../dependencias.js';
import { leadPorTelefone } from '../agente/repositorio.js';
import { enviarTexto } from '../conversas/repositorio.js';
import { lerPlanilhaExcel } from '../importacao-leads/leitura.js';
import { criarOuJuntar } from '../integracoes/leads.js';
import { notificar } from '../notificacoes/repositorio.js';

/**
 * Atendimento com carteira: as Conversas como canal de atendimento (filas, protocolo, encerrar,
 * reabrir, transferir). Abrir, assumir ao responder e a nota da pesquisa são do gatilho em
 * comercial.mensagens (migration 113); aqui ficam as ações da equipe, as filas e o painel.
 * Tudo dentro da conta da sessão.
 */

type Deps = Pick<DepsApi, 'pool' | 'servicos' | 'filas'>;

/* ───────────────────────────── Configuração ───────────────────────────── */

interface LinhaConfig {
  ativo: boolean;
  vira_dono: boolean;
  espera_dono_min: number | null;
  pausa_vai_geral: boolean;
  motivos: string[];
  mandar_encerramento: boolean;
  msg_encerramento: string;
  pesquisa: boolean;
  encerrar_sem_resposta_h: number | null;
  protocolo_na_primeira: boolean;
}

function config(l: LinhaConfig | undefined): ConfigAtendimento {
  if (!l) return { ...CONFIG_ATENDIMENTO_PADRAO };
  return {
    ativo: l.ativo,
    viraDono: l.vira_dono,
    esperaDonoMin: l.espera_dono_min,
    pausaVaiGeral: l.pausa_vai_geral,
    motivos: l.motivos,
    mandarEncerramento: l.mandar_encerramento,
    msgEncerramento: l.msg_encerramento,
    pesquisa: l.pesquisa,
    encerrarSemRespostaH: l.encerrar_sem_resposta_h,
    protocoloNaPrimeira: l.protocolo_na_primeira,
  };
}

export async function lerConfig(db: Executor): Promise<ConfigAtendimento> {
  const { rows } = await db.query<LinhaConfig>(
    `SELECT * FROM comercial.config_atendimento WHERE conta_id = ${contaSql()}`,
  );
  return config(rows[0]);
}

export async function salvarConfig(db: Executor, d: ConfigAtendimentoEntrada): Promise<ConfigAtendimento> {
  const { rows } = await db.query<LinhaConfig>(
    `INSERT INTO comercial.config_atendimento
       (conta_id, ativo, vira_dono, espera_dono_min, pausa_vai_geral, motivos, mandar_encerramento,
        msg_encerramento, pesquisa, encerrar_sem_resposta_h, protocolo_na_primeira)
     VALUES (${contaSql()}, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (conta_id) DO UPDATE SET
       ativo = EXCLUDED.ativo, vira_dono = EXCLUDED.vira_dono, espera_dono_min = EXCLUDED.espera_dono_min,
       pausa_vai_geral = EXCLUDED.pausa_vai_geral, motivos = EXCLUDED.motivos,
       mandar_encerramento = EXCLUDED.mandar_encerramento, msg_encerramento = EXCLUDED.msg_encerramento,
       pesquisa = EXCLUDED.pesquisa, encerrar_sem_resposta_h = EXCLUDED.encerrar_sem_resposta_h,
       protocolo_na_primeira = EXCLUDED.protocolo_na_primeira, atualizado_em = now()
     RETURNING *`,
    [
      d.ativo,
      d.viraDono,
      d.esperaDonoMin,
      d.pausaVaiGeral,
      d.motivos,
      d.mandarEncerramento,
      d.msgEncerramento || CONFIG_ATENDIMENTO_PADRAO.msgEncerramento,
      d.pesquisa,
      d.encerrarSemRespostaH,
      d.protocoloNaPrimeira,
    ],
  );
  return config(rows[0]);
}

/** Para a sessão (/auth/eu): o atendimento está ligado nesta conta e a pessoa está disponível. */
export async function situacaoDoAtendimento(
  db: Executor,
  contaId: number,
  usuarioId: number,
  noPlano: boolean,
): Promise<{ ativo: boolean; disponivel: boolean; pausaDesde: string | null }> {
  const { rows } = await db.query<{ ativo: boolean | null; disponivel: boolean | null; pausa: Date | null }>(
    `SELECT (SELECT ativo FROM comercial.config_atendimento WHERE conta_id = $1) AS ativo,
            u.disponivel, u.pausa_desde AS pausa
       FROM cadastro.usuarios u WHERE u.id = $2`,
    [contaId, usuarioId],
  );
  return {
    ativo: noPlano && !!rows[0]?.ativo,
    disponivel: rows[0]?.disponivel ?? true,
    pausaDesde: rows[0]?.pausa?.toISOString() ?? null,
  };
}

export async function resumoCarteira(db: Executor): Promise<ResumoCarteira> {
  const { rows } = await db.query<ResumoCarteira>(
    `SELECT count(*) FILTER (WHERE responsavel_id IS NOT NULL)::int AS "comDono",
            count(*) FILTER (WHERE responsavel_id IS NULL)::int AS "semDono",
            count(DISTINCT responsavel_id)::int AS vendedores
       FROM comercial.oportunidades WHERE conta_id = ${contaSql()} AND etapa <> 'descartado'`,
  );
  return rows[0] ?? { comDono: 0, semDono: 0, vendedores: 0 };
}

/* ───────────────────────────── Etiquetas ───────────────────────────── */

export async function etiquetas(db: Executor): Promise<Etiqueta[]> {
  const C = contaSql();
  const { rows } = await db.query<Etiqueta>(
    `SELECT et.id, et.nome, et.cor,
            (SELECT count(*)::int FROM comercial.atendimentos a
              WHERE a.conta_id = ${C} AND lower(et.nome) = ANY (SELECT lower(x) FROM unnest(a.etiquetas) x)
                AND a.aberto_em >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo') AS "usosMes",
            (SELECT count(*)::int FROM comercial.oportunidades o
              WHERE o.conta_id = ${C} AND lower(et.nome) = ANY (SELECT lower(x) FROM unnest(o.etiquetas) x)) AS clientes
       FROM comercial.etiquetas et
      WHERE et.conta_id = ${C}
      ORDER BY et.ordem, lower(et.nome)`,
  );
  return rows;
}

export async function criarEtiqueta(db: Executor, d: { nome: string; cor: CorEtiqueta }): Promise<void> {
  try {
    await db.query(
      `INSERT INTO comercial.etiquetas (conta_id, nome, cor, ordem)
       VALUES (${contaSql()}, $1, $2,
               (SELECT coalesce(max(ordem), 0) + 1 FROM comercial.etiquetas WHERE conta_id = ${contaSql()}))`,
      [d.nome, d.cor],
    );
  } catch (e) {
    if ((e as { code?: string }).code === '23505')
      throw AppError.conflito('Já existe uma etiqueta com esse nome.');
    throw e;
  }
}

/** Renomear troca também nos atendimentos e nos clientes que já têm a etiqueta. */
export async function atualizarEtiqueta(
  db: Executor,
  id: number,
  d: { nome: string; cor: CorEtiqueta },
): Promise<void> {
  const C = contaSql();
  const { rows } = await db.query<{ nome: string }>(
    `SELECT nome FROM comercial.etiquetas WHERE id = $1 AND conta_id = ${C}`,
    [id],
  );
  const antes = rows[0]?.nome;
  if (!antes) throw AppError.naoEncontrado('Etiqueta');
  try {
    await db.query(`UPDATE comercial.etiquetas SET nome = $2, cor = $3 WHERE id = $1 AND conta_id = ${C}`, [
      id,
      d.nome,
      d.cor,
    ]);
  } catch (e) {
    if ((e as { code?: string }).code === '23505')
      throw AppError.conflito('Já existe uma etiqueta com esse nome.');
    throw e;
  }
  if (antes !== d.nome) {
    await db.query(
      `UPDATE comercial.atendimentos SET etiquetas = array_replace(etiquetas, $1, $2)
        WHERE conta_id = ${C} AND $1 = ANY (etiquetas)`,
      [antes, d.nome],
    );
    await db.query(
      `UPDATE comercial.oportunidades SET etiquetas = array_replace(etiquetas, $1, $2)
        WHERE conta_id = ${C} AND $1 = ANY (etiquetas)`,
      [antes, d.nome],
    );
  }
}

/** Apagar tira a etiqueta do catálogo; o que já foi marcado continua no histórico. */
export async function apagarEtiqueta(db: Executor, id: number): Promise<void> {
  const { rowCount } = await db.query(
    `DELETE FROM comercial.etiquetas WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id],
  );
  if (!rowCount) throw AppError.naoEncontrado('Etiqueta');
}

/** As etiquetas escolhidas, com o nome do catálogo (maiúsculas como lá); a que não existe é erro. */
async function doCatalogo(db: Executor, nomes: string[]): Promise<string[]> {
  if (!nomes.length) return [];
  const { rows } = await db.query<{ nome: string }>(
    `SELECT nome FROM comercial.etiquetas WHERE conta_id = ${contaSql()} AND lower(nome) = ANY ($1::text[])`,
    [nomes.map((n) => n.toLowerCase())],
  );
  const achadas = new Map(rows.map((r) => [r.nome.toLowerCase(), r.nome]));
  const faltam = nomes.filter((n) => !achadas.has(n.toLowerCase()));
  if (faltam.length)
    throw AppError.invalido(
      `A etiqueta "${faltam[0]}" não existe. O administrador cria as etiquetas em Configurações › Atendimento.`,
    );
  return [...new Set(nomes.map((n) => achadas.get(n.toLowerCase()) as string))];
}

/* ───────────────────────────── Filas ───────────────────────────── */

/** O dono não respondeu a tempo: o atendimento aparece também na Fila geral. */
const semRespostaDoDono = (a: string) => `
  (${a}.situacao = 'aberto' AND ${a}.atendente_id IS NOT NULL AND cfg.espera_dono_min IS NOT NULL
   AND ${a}.ultima_cliente_em < now() - make_interval(mins => cfg.espera_dono_min)
   AND (${a}.ultima_equipe_em IS NULL OR ${a}.ultima_equipe_em < ${a}.ultima_cliente_em))`;

/** Atendimento sem pessoa: da Fila geral (ou da fila de um grupo, que só os membros veem). */
const naGeral = (a: string, eu: string, admin: boolean) => `
  (${a}.situacao = 'aberto' AND ${a}.atendente_id IS NULL
   ${
     admin
       ? ''
       : `AND (${a}.grupo_id IS NULL OR EXISTS (SELECT 1 FROM cadastro.grupo_membros gm
                                               WHERE gm.grupo_id = ${a}.grupo_id AND gm.usuario_id = ${eu}))`
   })`;

function condicaoDaFila(fila: FiltrosAtendimento['fila'], eu: string, admin: boolean): string {
  switch (fila) {
    case 'minha':
      return `a.situacao = 'aberto' AND a.atendente_id = ${eu}`;
    case 'geral':
      return `(${naGeral('a', eu, admin)} OR (${semRespostaDoDono('a')} AND a.atendente_id <> ${eu}))`;
    case 'aguardando':
      return `a.situacao = 'aguardando' AND a.atendente_id = ${eu}`;
    case 'encerrados':
      return `a.situacao = 'encerrado' AND a.encerrado_em > now() - interval '30 days'
              ${admin ? '' : `AND (a.atendente_id = ${eu} OR a.encerrado_por = ${eu})`}`;
  }
}

export async function contarFilas(db: Executor, eu: number, admin: boolean): Promise<ContagemFilas> {
  const C = contaSql();
  const E = String(eu);
  const { rows } = await db.query<ContagemFilas>(
    `WITH cfg AS (SELECT espera_dono_min FROM comercial.config_atendimento WHERE conta_id = ${C}
                  UNION ALL SELECT NULL WHERE NOT EXISTS (SELECT 1 FROM comercial.config_atendimento WHERE conta_id = ${C}))
     SELECT count(*) FILTER (WHERE ${condicaoDaFila('minha', E, admin)})::int AS minha,
            count(*) FILTER (WHERE ${condicaoDaFila('geral', E, admin)})::int AS geral,
            count(*) FILTER (WHERE ${condicaoDaFila('aguardando', E, admin)})::int AS aguardando,
            min(a.ultima_cliente_em) FILTER (WHERE ${condicaoDaFila('geral', E, admin)}) AS "geralDesde"
       FROM comercial.atendimentos a CROSS JOIN cfg
       LEFT JOIN comercial.oportunidades o ON o.conta_id = a.conta_id AND o.empresa_id = a.empresa_id
      WHERE a.conta_id = ${C} AND a.situacao <> 'encerrado' AND ${naBaseOuSemFunil()}`,
  );
  return rows[0] ?? { minha: 0, geral: 0, aguardando: 0, geralDesde: null };
}

/** naBase para o LEFT JOIN em oportunidades: contato que ainda não entrou no funil aparece para todos. */
function naBaseOuSemFunil(): string {
  const f = naBase('o');
  return f === 'true' ? 'true' : `(o.empresa_id IS NULL OR ${f})`;
}

export async function listarAtendimentos(db: Executor, f: FiltrosAtendimento, eu: number, admin: boolean) {
  const C = contaSql();
  const valores: unknown[] = [];
  const p = (v: unknown) => {
    valores.push(v);
    return `$${valores.length}`;
  };
  const where = [`a.conta_id = ${C}`, condicaoDaFila(f.fila, String(eu), admin), naBaseOuSemFunil()];
  if (f.etiqueta) {
    const x = p(f.etiqueta.toLowerCase());
    where.push(
      `(${x} = ANY (SELECT lower(y) FROM unnest(a.etiquetas) y) OR ${x} = ANY (SELECT lower(y) FROM unnest(o.etiquetas) y))`,
    );
  }
  if (f.busca) {
    const t = p(`%${f.busca}%`);
    const d = p(`%${f.busca.replace(/\D/g, '') || '§'}%`);
    where.push(
      `(e.nome ILIKE ${t} OR a.protocolo ILIKE ${t} OR e.maps_telefone LIKE ${d} OR e.cnpj LIKE ${d}
        OR EXISTS (SELECT 1 FROM comercial.contatos_lead cl WHERE cl.conta_id = ${C} AND cl.empresa_id = a.empresa_id
                    AND (cl.nome ILIKE ${t} OR cl.telefone LIKE ${d})))`,
    );
  }
  const ordem = f.fila === 'encerrados' ? 'a.encerrado_em DESC' : 'coalesce(um.em, a.aberto_em) DESC';
  const { rows } = await db.query(
    `WITH cfg AS (SELECT espera_dono_min FROM comercial.config_atendimento WHERE conta_id = ${C}
                  UNION ALL SELECT NULL WHERE NOT EXISTS (SELECT 1 FROM comercial.config_atendimento WHERE conta_id = ${C}))
     SELECT a.id::int, a.empresa_id::int AS "empresaId", a.protocolo, a.situacao, a.canal, a.origem, a.reaberto,
            a.aberto_em AS "abertoEm", a.ultima_cliente_em AS "ultimaClienteEm", a.encerrado_em AS "encerradoEm",
            a.motivo, a.etiquetas, a.atendente_id AS "atendenteId", ua.nome AS "atendenteNome",
            g.nome AS "grupoNome", e.nome, e.cidade, o.responsavel_id AS "donoId", ud.nome AS "donoNome",
            coalesce(o.etiquetas, '{}') AS "etiquetasCliente",
            um.texto AS ultima, um.direcao AS "ultimaDirecao", um.em AS "ultimaEm", um.midia_tipo AS "ultimaMidia",
            coalesce(nl.n, 0) AS "naoLidas", a.nota_cliente AS "notaCliente",
            ${semRespostaDoDono('a')} AS "semRespostaDoDono"
       FROM comercial.atendimentos a CROSS JOIN cfg
       JOIN descoberta.empresas e ON e.id = a.empresa_id
       LEFT JOIN comercial.oportunidades o ON o.conta_id = a.conta_id AND o.empresa_id = a.empresa_id
       LEFT JOIN cadastro.usuarios ua ON ua.id = a.atendente_id
       LEFT JOIN cadastro.usuarios ud ON ud.id = o.responsavel_id
       LEFT JOIN cadastro.grupos_atendimento g ON g.id = a.grupo_id
       LEFT JOIN LATERAL (
         SELECT m.texto, m.direcao, coalesce(m.enviado_em, m.criado_em) AS em, m.midia_tipo
           FROM comercial.mensagens m
          WHERE m.conta_id = a.conta_id AND m.empresa_id = a.empresa_id AND m.status <> 'descartada'
          ORDER BY coalesce(m.enviado_em, m.criado_em) DESC LIMIT 1) um ON true
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS n FROM comercial.mensagens m
          WHERE m.conta_id = a.conta_id AND m.empresa_id = a.empresa_id AND m.direcao = 'recebida'
            AND m.lida_em IS NULL) nl ON true
      WHERE ${where.join(' AND ')}
      ORDER BY ${ordem}
      LIMIT 300`,
    valores,
  );
  return rows;
}

/* ───────────────────────────── O atendimento de um cliente ───────────────────────────── */

const SELECT_ATENDIMENTO = `
  SELECT a.id::int, a.protocolo, a.canal, a.situacao, a.atendente_id AS "atendenteId", ua.nome AS "atendenteNome",
         a.grupo_id AS "grupoId", g.nome AS "grupoNome", a.origem, a.reaberto, a.aberto_em AS "abertoEm",
         a.primeira_resposta_em AS "primeiraRespostaEm", a.ultima_cliente_em AS "ultimaClienteEm",
         a.encerrado_em AS "encerradoEm", ue.nome AS "encerradoPor", a.motivo, a.etiquetas,
         a.nota_cliente AS "notaCliente"
    FROM comercial.atendimentos a
    LEFT JOIN cadastro.usuarios ua ON ua.id = a.atendente_id
    LEFT JOIN cadastro.usuarios ue ON ue.id = a.encerrado_por
    LEFT JOIN cadastro.grupos_atendimento g ON g.id = a.grupo_id`;

function datas<T extends object>(l: T): T {
  const r: Record<string, unknown> = { ...(l as Record<string, unknown>) };
  for (const [k, v] of Object.entries(r)) if (v instanceof Date) r[k] = v.toISOString();
  return r as T;
}

async function emAberto(db: Executor, empresaId: number): Promise<Atendimento | null> {
  const { rows } = await db.query<Atendimento>(
    `${SELECT_ATENDIMENTO} WHERE a.conta_id = ${contaSql()} AND a.empresa_id = $1 AND a.situacao <> 'encerrado'`,
    [empresaId],
  );
  return rows[0] ? datas(rows[0]) : null;
}

async function exigirAberto(db: Executor, empresaId: number): Promise<Atendimento> {
  const a = await emAberto(db, empresaId);
  if (!a) throw AppError.invalido('Este cliente não tem atendimento em aberto.');
  return a;
}

async function evento(
  db: Executor,
  e: {
    atendimentoId: number;
    empresaId: number;
    tipo: EventoAtendimento['tipo'];
    usuarioId?: number | null;
    paraUsuarioId?: number | null;
    paraGrupoId?: number | null;
    texto?: string | null;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO comercial.atendimento_eventos
       (conta_id, atendimento_id, empresa_id, tipo, usuario_id, para_usuario_id, para_grupo_id, texto)
     VALUES (${contaSql()}, $1, $2, $3, $4, $5, $6, $7)`,
    [
      e.atendimentoId,
      e.empresaId,
      e.tipo,
      e.usuarioId ?? null,
      e.paraUsuarioId ?? null,
      e.paraGrupoId ?? null,
      e.texto?.slice(0, 2000) ?? null,
    ],
  );
}

/** Painel do cliente na conversa: dados, carteira, etiquetas, o atendimento e o histórico. */
export async function doCliente(db: Executor, empresaId: number): Promise<ClienteDoAtendimento> {
  const C = contaSql();
  const { rows: info } = await db.query<{
    nome: string;
    cnpj: string | null;
    cidade: string | null;
    uf: string | null;
    desde: Date | null;
    dono_id: number | null;
    dono: string | null;
    etiquetas: string[] | null;
  }>(
    `SELECT e.nome, e.cnpj, e.cidade, e.uf, o.criado_em AS desde, o.responsavel_id AS dono_id, u.nome AS dono,
            o.etiquetas
       FROM descoberta.empresas e
       LEFT JOIN comercial.oportunidades o ON o.conta_id = ${C} AND o.empresa_id = e.id
       LEFT JOIN cadastro.usuarios u ON u.id = o.responsavel_id
      WHERE e.id = $1`,
    [empresaId],
  );
  const i = info[0];
  if (!i) throw AppError.naoEncontrado('Cliente');
  const [atual, ultimo, eventos, anteriores, desde] = await Promise.all([
    emAberto(db, empresaId),
    db.query<Atendimento>(
      `${SELECT_ATENDIMENTO} WHERE a.conta_id = ${C} AND a.empresa_id = $1 AND a.situacao = 'encerrado'
        ORDER BY a.encerrado_em DESC LIMIT 1`,
      [empresaId],
    ),
    db.query<EventoAtendimento>(
      `SELECT ev.id::int, ev.atendimento_id::int AS "atendimentoId", a.protocolo, ev.tipo, u.nome AS usuario,
              ev.usuario_id AS "usuarioId", coalesce(up.nome, gp.nome) AS para, ev.texto, ev.criado_em AS em
         FROM comercial.atendimento_eventos ev
         JOIN comercial.atendimentos a ON a.id = ev.atendimento_id
         LEFT JOIN cadastro.usuarios u ON u.id = ev.usuario_id
         LEFT JOIN cadastro.usuarios up ON up.id = ev.para_usuario_id
         LEFT JOIN cadastro.grupos_atendimento gp ON gp.id = ev.para_grupo_id
        WHERE ev.conta_id = ${C} AND ev.empresa_id = $1 AND ev.criado_em > now() - interval '180 days'
        ORDER BY ev.criado_em, ev.id
        LIMIT 500`,
      [empresaId],
    ),
    db.query<AtendimentoAnterior>(
      `SELECT a.id::int, a.protocolo, a.motivo, a.etiquetas, u.nome AS atendente, a.origem,
              a.encerrado_em AS "encerradoEm", a.nota_cliente AS "notaCliente",
              a.pesquisa_em IS NOT NULL AS "pesquisaPedida"
         FROM comercial.atendimentos a LEFT JOIN cadastro.usuarios u ON u.id = coalesce(a.atendente_id, a.encerrado_por)
        WHERE a.conta_id = ${C} AND a.empresa_id = $1 AND a.situacao = 'encerrado'
        ORDER BY a.encerrado_em DESC LIMIT 10`,
      [empresaId],
    ),
    db.query<{ em: Date }>(
      `SELECT max(criado_em) AS em FROM comercial.atendimento_eventos
        WHERE conta_id = ${C} AND empresa_id = $1 AND tipo = 'carteira'`,
      [empresaId],
    ),
  ]);
  return {
    empresaId,
    nome: i.nome,
    cnpj: i.cnpj,
    cidade: i.cidade,
    uf: i.uf,
    clienteDesde: (i.desde ?? new Date()).toISOString(),
    donoId: i.dono_id,
    donoNome: i.dono,
    donoDesde: i.dono_id && desde.rows[0]?.em ? desde.rows[0].em.toISOString() : null,
    etiquetas: i.etiquetas ?? [],
    atual,
    ultimo: atual ? null : ultimo.rows[0] ? datas(ultimo.rows[0]) : null,
    eventos: eventos.rows.map(datas),
    anteriores: anteriores.rows.map(datas),
  };
}

/** A pessoa é da equipe desta conta (e não o master de passagem). */
function eu(): { id: number; admin: boolean; nome: string } {
  const u = usuarioAtual();
  if (!u || u.contaPropria !== u.contaId)
    throw AppError.proibido('Só quem é da equipe desta conta atende pelas filas.');
  return { id: u.id, admin: u.papel === 'admin', nome: u.nome };
}

/** Pegar o atendimento para si (da Fila geral, ou do dono que não respondeu a tempo). */
export async function assumir(db: Executor, empresaId: number): Promise<void> {
  const quem = eu();
  const a = await exigirAberto(db, empresaId);
  if (a.atendenteId === quem.id) return;
  const C = contaSql();
  const { rowCount } = await db.query(
    `WITH cfg AS (SELECT espera_dono_min FROM comercial.config_atendimento WHERE conta_id = ${C})
     UPDATE comercial.atendimentos a SET atendente_id = $2, grupo_id = NULL
       FROM cfg
      WHERE a.id = $1 AND a.situacao <> 'encerrado'
        AND (a.atendente_id IS NULL OR $3::boolean OR ${semRespostaDoDono('a')})`,
    [a.id, quem.id, quem.admin],
  );
  if (!rowCount) {
    const agora = await emAberto(db, empresaId);
    throw AppError.conflito(`Este atendimento já está com ${agora?.atendenteNome ?? 'outra pessoa'}.`);
  }
  await evento(db, { atendimentoId: a.id, empresaId, tipo: 'assumiu', usuarioId: quem.id });
  const cfg = await lerConfig(db);
  if (cfg.viraDono) await virarDonoSeSemDono(db, a.id, empresaId, quem.id);
}

async function virarDonoSeSemDono(db: Executor, atendimentoId: number, empresaId: number, usuarioId: number) {
  const { rowCount } = await db.query(
    `UPDATE comercial.oportunidades SET responsavel_id = $2
      WHERE conta_id = ${contaSql()} AND empresa_id = $1 AND responsavel_id IS NULL`,
    [empresaId, usuarioId],
  );
  if (rowCount)
    await evento(db, { atendimentoId, empresaId, tipo: 'carteira', usuarioId, paraUsuarioId: usuarioId });
}

async function usuarioDaEquipe(db: Executor, id: number): Promise<{ id: number; nome: string }> {
  const { rows } = await db.query<{ id: number; nome: string }>(
    `SELECT id, nome FROM cadastro.usuarios WHERE id = $1 AND conta_id = ${contaSql()} AND ativo`,
    [id],
  );
  if (!rows[0]) throw AppError.invalido('Esta pessoa não está ativa na equipe.');
  return rows[0];
}

export async function transferir(db: Executor, empresaId: number, d: TransferirEntrada): Promise<void> {
  const quem = eu();
  const a = await exigirAberto(db, empresaId);
  if (!quem.admin && a.atendenteId && a.atendenteId !== quem.id)
    throw AppError.proibido('Só quem está com o atendimento (ou o administrador) transfere.');
  const C = contaSql();
  let para: { id: number; nome: string } | null = null;
  let grupo: { id: number; nome: string } | null = null;
  if (d.usuarioId) para = await usuarioDaEquipe(db, d.usuarioId);
  else {
    const { rows } = await db.query<{ id: number; nome: string }>(
      `SELECT id, nome FROM cadastro.grupos_atendimento WHERE id = $1 AND conta_id = ${C}`,
      [d.grupoId],
    );
    if (!rows[0]) throw AppError.naoEncontrado('Grupo');
    grupo = rows[0];
  }
  if (para?.id === a.atendenteId) throw AppError.invalido('O atendimento já está com essa pessoa.');
  // Transferido volta a esperar a equipe (quem recebe vê na Minha carteira, ou na fila do grupo).
  await db.query(
    `UPDATE comercial.atendimentos SET atendente_id = $2, grupo_id = $3, situacao = 'aberto' WHERE id = $1`,
    [a.id, para?.id ?? null, grupo?.id ?? null],
  );
  await evento(db, {
    atendimentoId: a.id,
    empresaId,
    tipo: 'transferiu',
    usuarioId: quem.id,
    paraUsuarioId: para?.id ?? null,
    paraGrupoId: grupo?.id ?? null,
    texto: d.nota || null,
  });
  const { rows: emp } = await db.query<{ nome: string }>(
    'SELECT nome FROM descoberta.empresas WHERE id = $1',
    [empresaId],
  );
  const cliente = emp[0]?.nome ?? 'Cliente';
  if (para)
    await notificar(db, para.id, {
      tipo: 'atribuido',
      titulo: `${quem.nome} passou um atendimento para você`,
      texto: [cliente, d.nota].filter(Boolean).join(' · '),
      empresaId,
      link: `/conversas?lead=${empresaId}`,
    });
  if (d.passarCarteira && para) {
    if (quem.admin) await passarDono(db, empresaId, para.id, a.id);
    else {
      // Só o administrador troca a carteira: para os outros, vira um pedido no sino dele.
      const { rows: admins } = await db.query<{ id: number }>(
        `SELECT id FROM cadastro.usuarios WHERE conta_id = ${C} AND ativo AND papel = 'admin'`,
      );
      for (const ad of admins)
        await notificar(db, ad.id, {
          tipo: 'sistema',
          titulo: `${quem.nome} pediu para passar ${cliente} para a carteira de ${para.nome}`,
          texto: 'Abra o cliente na conversa e troque o dono no painel da direita.',
          empresaId,
          link: `/conversas?lead=${empresaId}`,
        });
    }
  }
}

async function passarDono(db: Executor, empresaId: number, usuarioId: number | null, atendimentoId?: number) {
  const quem = usuarioAtual();
  const C = contaSql();
  const { rowCount } = await db.query(
    `UPDATE comercial.oportunidades SET responsavel_id = $2 WHERE conta_id = ${C} AND empresa_id = $1`,
    [empresaId, usuarioId],
  );
  if (!rowCount) throw AppError.naoEncontrado('Cliente no funil');
  const nome = usuarioId ? (await usuarioDaEquipe(db, usuarioId)).nome : null;
  await db.query(
    `INSERT INTO comercial.atividades (conta_id, empresa_id, tipo, texto, autor, usuario_id)
     VALUES (${C}, $1, 'nota', $2, $3, $4)`,
    [
      empresaId,
      nome ? `Carteira: passou para ${nome}` : 'Carteira: o cliente ficou sem dono',
      quem?.nome ?? 'sistema',
      quem?.id ?? null,
    ],
  );
  const alvo =
    atendimentoId ??
    (
      await db.query<{ id: number }>(
        `SELECT id::int FROM comercial.atendimentos WHERE conta_id = ${C} AND empresa_id = $1
          ORDER BY aberto_em DESC LIMIT 1`,
        [empresaId],
      )
    ).rows[0]?.id;
  if (alvo)
    await evento(db, {
      atendimentoId: alvo,
      empresaId,
      tipo: 'carteira',
      usuarioId: quem?.id ?? null,
      paraUsuarioId: usuarioId,
    });
}

/** Trocar o dono do cliente (só o administrador). */
export async function trocarDono(db: Executor, empresaId: number, usuarioId: number | null): Promise<void> {
  if (usuarioId) await usuarioDaEquipe(db, usuarioId);
  await passarDono(db, empresaId, usuarioId);
}

export async function encerrar(
  deps: Deps,
  empresaId: number,
  d: EncerrarEntrada,
): Promise<{ mensagemEnviada: boolean; aviso: string | null }> {
  const quem = eu();
  const db = deps.pool;
  const a = await exigirAberto(db, empresaId);
  if (!quem.admin && a.atendenteId && a.atendenteId !== quem.id)
    throw AppError.proibido(`Este atendimento está com ${a.atendenteNome ?? 'outra pessoa'}.`);
  const cfg = await lerConfig(db);
  if (!cfg.motivos.includes(d.motivo) && d.motivo !== MOTIVO_SEM_RESPOSTA)
    throw AppError.invalido('Escolha um dos motivos de encerramento da lista.');
  const marcadas = await doCatalogo(db, d.etiquetas);

  // Mensagem de encerramento e a pergunta da nota saem juntas (uma mensagem só: menos envios).
  const partes: string[] = [];
  if (d.mandarMensagem && cfg.mandarEncerramento && cfg.msgEncerramento) {
    const { rows } = await db.query<{ nome: string | null }>(
      `SELECT coalesce(
                (SELECT split_part(cl.nome, ' ', 1) FROM comercial.contatos_lead cl
                  WHERE cl.conta_id = ${contaSql()} AND cl.empresa_id = $1 AND cl.status = 'confirmado' AND cl.nome IS NOT NULL
                  ORDER BY cl.id LIMIT 1),
                (SELECT nome FROM descoberta.empresas WHERE id = $1)) AS nome`,
      [empresaId],
    );
    partes.push(
      textoEncerramento(cfg.msgEncerramento, { nome: rows[0]?.nome ?? '', protocolo: a.protocolo }),
    );
  }
  const pedirNota = d.pedirNota && cfg.pesquisa && a.canal === 'whatsapp';
  if (pedirNota) partes.push(PERGUNTA_PESQUISA);
  let enviada = false;
  let aviso: string | null = null;
  if (partes.length && a.canal === 'whatsapp') {
    try {
      await enviarTexto(deps, empresaId, partes.join('\n\n'));
      enviada = true;
    } catch (e) {
      aviso =
        e instanceof AppError
          ? `O atendimento foi encerrado, mas a mensagem não saiu: ${e.message}`
          : 'O atendimento foi encerrado, mas a mensagem não saiu.';
    }
  } else if (partes.length) aviso = 'No direct do Instagram o encerramento não manda mensagem.';

  await db.query(
    `UPDATE comercial.atendimentos
        SET situacao = 'encerrado', encerrado_em = now(), encerrado_por = $2, motivo = $3, etiquetas = $4,
            atendente_id = coalesce(atendente_id, $2), pesquisa_em = CASE WHEN $5 THEN now() END
      WHERE id = $1`,
    [a.id, quem.id, d.motivo, marcadas, pedirNota && enviada],
  );
  await evento(db, { atendimentoId: a.id, empresaId, tipo: 'encerrou', usuarioId: quem.id, texto: d.motivo });
  return { mensagemEnviada: enviada, aviso };
}

/** Reabrir o último atendimento encerrado (fica com quem reabriu). */
export async function reabrir(db: Executor, empresaId: number): Promise<void> {
  const quem = eu();
  if (await emAberto(db, empresaId)) throw AppError.invalido('Este cliente já tem um atendimento em aberto.');
  const { rows } = await db.query<{ id: number }>(
    `UPDATE comercial.atendimentos a
        SET situacao = 'aberto', reaberto = true, atendente_id = $2, grupo_id = NULL, encerrado_em = NULL,
            encerrado_por = NULL, motivo = NULL, pesquisa_em = NULL
      WHERE a.id = (SELECT id FROM comercial.atendimentos
                     WHERE conta_id = ${contaSql()} AND empresa_id = $1 AND situacao = 'encerrado'
                     ORDER BY encerrado_em DESC LIMIT 1)
      RETURNING a.id::int`,
    [empresaId, quem.id],
  );
  if (!rows[0]) throw AppError.invalido('Este cliente ainda não teve atendimento para reabrir.');
  await evento(db, { atendimentoId: rows[0].id, empresaId, tipo: 'reaberto', usuarioId: quem.id });
}

/** Nota interna: só a equipe vê (aparece na conversa, nunca vai para o cliente). */
export async function notaInterna(db: Executor, empresaId: number, texto: string): Promise<void> {
  const quem = eu();
  const { rows } = await db.query<{ id: number }>(
    `SELECT id::int FROM comercial.atendimentos WHERE conta_id = ${contaSql()} AND empresa_id = $1
      ORDER BY (situacao <> 'encerrado') DESC, aberto_em DESC LIMIT 1`,
    [empresaId],
  );
  if (!rows[0]) throw AppError.invalido('Este cliente ainda não teve atendimento.');
  await evento(db, { atendimentoId: rows[0].id, empresaId, tipo: 'nota', usuarioId: quem.id, texto });
}

export async function etiquetarAtendimento(
  db: Executor,
  empresaId: number,
  nomes: string[],
): Promise<string[]> {
  const a = await exigirAberto(db, empresaId);
  const marcadas = await doCatalogo(db, nomes);
  await db.query('UPDATE comercial.atendimentos SET etiquetas = $2 WHERE id = $1', [a.id, marcadas]);
  return marcadas;
}

export async function etiquetarCliente(db: Executor, empresaId: number, nomes: string[]): Promise<string[]> {
  const marcadas = await doCatalogo(db, nomes);
  const { rowCount } = await db.query(
    `UPDATE comercial.oportunidades SET etiquetas = $2 WHERE conta_id = ${contaSql()} AND empresa_id = $1`,
    [empresaId, marcadas],
  );
  if (!rowCount) throw AppError.naoEncontrado('Cliente no funil');
  return marcadas;
}

/* ───────────────────────────── Equipe ───────────────────────────── */

export async function pessoas(db: Executor): Promise<PessoaAtendimento[]> {
  const C = contaSql();
  const { rows } = await db.query<Omit<PessoaAtendimento, 'pausaDesde'> & { pausaDesde: Date | null }>(
    `SELECT u.id, u.nome, u.disponivel, u.pausa_desde AS "pausaDesde",
            (SELECT count(*)::int FROM comercial.atendimentos a
              WHERE a.conta_id = ${C} AND a.atendente_id = u.id AND a.situacao <> 'encerrado') AS "emAtendimento",
            coalesce((SELECT array_agg(g.nome ORDER BY g.ordem, g.nome) FROM cadastro.grupo_membros gm
                        JOIN cadastro.grupos_atendimento g ON g.id = gm.grupo_id
                       WHERE gm.usuario_id = u.id AND g.conta_id = ${C}), '{}') AS grupos
       FROM cadastro.usuarios u
      WHERE u.conta_id = ${C} AND u.ativo AND NOT u.master AND u.papel IN ('admin', 'sdr', 'closer')
      ORDER BY u.nome`,
  );
  return rows.map((r) => ({
    ...r,
    pausaDesde: r.pausaDesde ? r.pausaDesde.toISOString() : null,
  }));
}

export async function grupos(db: Executor): Promise<{ id: number; nome: string; membros: number }[]> {
  const { rows } = await db.query<{ id: number; nome: string; membros: number }>(
    `SELECT g.id, g.nome, (SELECT count(*)::int FROM cadastro.grupo_membros gm WHERE gm.grupo_id = g.id) AS membros
       FROM cadastro.grupos_atendimento g WHERE g.conta_id = ${contaSql()} ORDER BY g.ordem, g.nome`,
  );
  return rows;
}

/**
 * Disponível ou Em pausa. Entrando em pausa (e a conta quer assim), os clientes que estão esperando
 * resposta dela vão para a Fila geral; continuam na carteira.
 */
export async function marcarDisponivel(db: Executor, disponivel: boolean): Promise<{ paraFila: number }> {
  const quem = eu();
  const C = contaSql();
  await db.query(
    `UPDATE cadastro.usuarios
        SET disponivel = $2, pausa_desde = CASE WHEN $2 THEN NULL ELSE coalesce(pausa_desde, now()) END
      WHERE id = $1`,
    [quem.id, disponivel],
  );
  if (disponivel) return { paraFila: 0 };
  const cfg = await lerConfig(db);
  if (!cfg.ativo || !cfg.pausaVaiGeral) return { paraFila: 0 };
  const { rows } = await db.query<{ id: number; empresa_id: number }>(
    `UPDATE comercial.atendimentos SET atendente_id = NULL
      WHERE conta_id = ${C} AND atendente_id = $1 AND situacao = 'aberto'
        AND (ultima_equipe_em IS NULL OR ultima_equipe_em < ultima_cliente_em)
      RETURNING id::int, empresa_id::int`,
    [quem.id],
  );
  for (const r of rows)
    await evento(db, {
      atendimentoId: r.id,
      empresaId: r.empresa_id,
      tipo: 'transferiu',
      usuarioId: quem.id,
      texto: 'Em pausa: foi para a Fila geral',
    });
  return { paraFila: rows.length };
}

/* ───────────────────────────── Carteira (administrador) ───────────────────────────── */

export async function passarCarteira(
  db: Executor,
  d: { de: number; para: number; etiqueta?: string },
): Promise<{ passados: number }> {
  const C = contaSql();
  const quem = usuarioAtual();
  await usuarioDaEquipe(db, d.para);
  const { rows: de } = await db.query<{ nome: string }>(
    `SELECT nome FROM cadastro.usuarios WHERE id = $1 AND conta_id = ${C}`,
    [d.de],
  );
  if (!de[0]) throw AppError.invalido('Esta pessoa não é da equipe.');
  const para = await usuarioDaEquipe(db, d.para);
  const { rows } = await db.query<{ empresa_id: number }>(
    `UPDATE comercial.oportunidades SET responsavel_id = $2
      WHERE conta_id = ${C} AND responsavel_id = $1 AND etapa <> 'descartado'
        ${d.etiqueta ? 'AND lower($3) = ANY (SELECT lower(x) FROM unnest(etiquetas) x)' : ''}
      RETURNING empresa_id::int`,
    d.etiqueta ? [d.de, d.para, d.etiqueta] : [d.de, d.para],
  );
  if (rows.length) {
    const ids = rows.map((r) => r.empresa_id);
    await db.query(
      `INSERT INTO comercial.atividades (conta_id, empresa_id, tipo, texto, autor, usuario_id)
       SELECT ${C}, x, 'nota', $2, $3, $4 FROM unnest($1::bigint[]) x`,
      [ids, `Carteira: passou de ${de[0].nome} para ${para.nome}`, quem?.nome ?? 'sistema', quem?.id ?? null],
    );
    // O que estava em atendimento com quem saiu acompanha o cliente.
    await db.query(
      `UPDATE comercial.atendimentos SET atendente_id = $2
        WHERE conta_id = ${C} AND atendente_id = $1 AND situacao <> 'encerrado' AND empresa_id = ANY ($3::bigint[])`,
      [d.de, d.para, ids],
    );
  }
  return { passados: rows.length };
}

const MAX_LINHAS_IMPORTACAO = 5000;

/**
 * Importa a carteira por planilha: uma linha por cliente com CNPJ ou telefone e o e-mail do
 * vendedor (o nome é opcional). Cliente que ainda não está no CRM é criado; o que já está só ganha o dono.
 */
export async function importarCarteira(
  deps: Deps,
  arquivo: { csv?: string; xlsx?: string },
): Promise<ResultadoImportacaoCarteira> {
  const db = deps.pool;
  const C = contaSql();
  const brutas = arquivo.xlsx
    ? (await lerPlanilhaExcel(Buffer.from(arquivo.xlsx, 'base64'))).linhas
    : lerCsv(arquivo.csv ?? '');
  const linhas = brutas.map((l) => l.map((c) => String(c ?? ''))).filter((l) => l.some((c) => c.trim()));
  if (!linhas.length) throw AppError.invalido('A planilha está vazia.');
  const cab = (linhas[0] ?? []).map((c) => c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim());
  const achar = (...nomes: RegExp[]) => cab.findIndex((c) => nomes.some((n) => n.test(c)));
  const temCabecalho = cab.some((c) => /cnpj|telefone|whats|vendedor|e-?mail|nome|cliente|empresa/.test(c));
  let iId = temCabecalho ? achar(/cnpj|telefone|whats|celular|documento/) : 0;
  const iEmail = temCabecalho ? achar(/vendedor|e-?mail|responsavel|dono/) : 1;
  const iNome = temCabecalho ? achar(/^nome|cliente|empresa|razao/) : 2;
  if (iId < 0) iId = 0;
  if (iEmail < 0) throw AppError.invalido('Não achei a coluna com o e-mail do vendedor.');
  const dados = temCabecalho ? linhas.slice(1) : linhas;
  if (dados.length > MAX_LINHAS_IMPORTACAO)
    throw AppError.invalido(`Mande até ${MAX_LINHAS_IMPORTACAO} linhas por vez.`);

  const { rows: equipe } = await db.query<{ id: number; email: string }>(
    `SELECT id, lower(email) AS email FROM cadastro.usuarios WHERE conta_id = ${C} AND ativo`,
  );
  const porEmail = new Map(equipe.map((u) => [u.email, u.id]));
  const r: ResultadoImportacaoCarteira = {
    linhas: dados.length,
    atribuidos: 0,
    criados: 0,
    semVendedor: [],
    naoEncontrados: [],
  };
  const quem = usuarioAtual();
  for (const l of dados) {
    const bruto = (l[iId] ?? '').trim();
    const email = (l[iEmail] ?? '').trim().toLowerCase();
    const nome = iNome >= 0 ? (l[iNome] ?? '').trim() : '';
    const vendedor = porEmail.get(email);
    if (!vendedor) {
      if (r.semVendedor.length < 50) r.semVendedor.push(email || '(sem e-mail)');
      continue;
    }
    const digitos = bruto.replace(/\D/g, '');
    const cnpj = digitos.length === 14 ? cnpjDoTexto(bruto) : null;
    const telefone = !cnpj && digitos.length >= 10 ? normalizarTelefone(bruto) : null;
    if (!cnpj && !telefone) {
      if (r.naoEncontrados.length < 50) r.naoEncontrados.push(bruto || '(linha sem CNPJ ou telefone)');
      continue;
    }
    let empresaId: number | null = null;
    if (telefone) empresaId = (await leadPorTelefone(db, telefone))?.empresaId ?? null;
    if (!empresaId && cnpj) {
      const { rows } = await db.query<{ id: number }>(
        `SELECT o.empresa_id::int AS id FROM comercial.oportunidades o JOIN descoberta.empresas e ON e.id = o.empresa_id
          WHERE o.conta_id = ${C} AND e.cnpj = $1 LIMIT 1`,
        [cnpj],
      );
      empresaId = rows[0]?.id ?? null;
    }
    if (empresaId) {
      const { rowCount } = await db.query(
        `UPDATE comercial.oportunidades SET responsavel_id = $2
          WHERE conta_id = ${C} AND empresa_id = $1 AND responsavel_id IS DISTINCT FROM $2`,
        [empresaId, vendedor],
      );
      if (rowCount) r.atribuidos++;
      continue;
    }
    const novo = await criarOuJuntar(
      deps,
      { empresa: nome || bruto, cnpj, telefone },
      { responsavelId: vendedor },
      quem?.nome ?? 'importação da carteira',
      'Importação da carteira',
    );
    if (novo.novo) r.criados++;
    else {
      await db.query(
        `UPDATE comercial.oportunidades SET responsavel_id = $2 WHERE conta_id = ${C} AND empresa_id = $1`,
        [novo.empresaId, vendedor],
      );
      r.atribuidos++;
    }
  }
  return r;
}

/** Primeira resposta do atendimento e a conta quer o protocolo nela: o protocolo a mandar junto. */
export async function protocoloParaPrimeira(db: Executor, empresaId: number): Promise<string | null> {
  const { rows } = await db.query<{ protocolo: string }>(
    `SELECT a.protocolo FROM comercial.atendimentos a
       JOIN comercial.config_atendimento cfg ON cfg.conta_id = a.conta_id AND cfg.ativo AND cfg.protocolo_na_primeira
      WHERE a.conta_id = ${contaSql()} AND a.empresa_id = $1 AND a.situacao <> 'encerrado'
        AND a.primeira_resposta_em IS NULL`,
    [empresaId],
  );
  return rows[0]?.protocolo ?? null;
}

/* ───────────────────────────── Rotina ───────────────────────────── */

/** Aguardando o cliente há mais de X horas: encerra sozinho, sem mandar mensagem. */
export async function encerrarParados(db: Executor): Promise<number> {
  const C = contaSql();
  const { rows } = await db.query<{ id: number; empresa_id: number }>(
    `UPDATE comercial.atendimentos a
        SET situacao = 'encerrado', encerrado_em = now(), motivo = $1
       FROM comercial.config_atendimento cfg
      WHERE cfg.conta_id = ${C} AND cfg.ativo AND cfg.encerrar_sem_resposta_h IS NOT NULL
        AND a.conta_id = ${C} AND a.situacao = 'aguardando'
        AND a.ultima_equipe_em < now() - make_interval(hours => cfg.encerrar_sem_resposta_h)
      RETURNING a.id::int, a.empresa_id::int`,
    [MOTIVO_SEM_RESPOSTA],
  );
  for (const r of rows)
    await evento(db, {
      atendimentoId: r.id,
      empresaId: r.empresa_id,
      tipo: 'encerrou',
      texto: `${MOTIVO_SEM_RESPOSTA} (encerrado sozinho)`,
    });
  return rows.length;
}

/* ───────────────────────────── Painel do gestor ───────────────────────────── */

const INICIO = {
  hoje: `date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'`,
  semana: `date_trunc('week', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'`,
  mes: `date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'`,
} as const;

/** 1ª resposta só de quem chamou (o atendimento aberto pela equipe começa já respondido). */
const PRIMEIRA = `a.primeira_resposta_em - a.aberto_em`;
const TEM_PRIMEIRA = `a.primeira_resposta_em > a.aberto_em`;

export async function painel(
  db: Executor,
  periodo: keyof typeof INICIO,
  grupo?: number,
): Promise<PainelAtendimentoCarteira> {
  const C = contaSql();
  const ini = INICIO[periodo];
  const doGrupo = grupo
    ? `AND a.atendente_id IN (SELECT gm.usuario_id FROM cadastro.grupo_membros gm
                               JOIN cadastro.grupos_atendimento g ON g.id = gm.grupo_id
                              WHERE g.id = ${Number(grupo)} AND g.conta_id = ${C})`
    : '';
  // Agora: a Fila geral conta sempre; o que está com alguém, só as pessoas do grupo.
  const agoraDoGrupo = grupo
    ? doGrupo.replace('AND a.atendente_id IN', 'AND (a.atendente_id IS NULL OR a.atendente_id IN').concat(')')
    : '';
  const [agora, kpi, ontem, porPessoa, motivos, origens, etiq] = await Promise.all([
    db.query(
      `SELECT count(*) FILTER (WHERE atendente_id IS NULL AND situacao = 'aberto')::int AS "naFila",
              min(ultima_cliente_em) FILTER (WHERE atendente_id IS NULL AND situacao = 'aberto') AS "filaDesde",
              count(*) FILTER (WHERE atendente_id IS NOT NULL)::int AS "emAtendimento",
              count(DISTINCT atendente_id)::int AS pessoas
         FROM comercial.atendimentos a WHERE a.conta_id = ${C} AND a.situacao <> 'encerrado' ${agoraDoGrupo}`,
    ),
    db.query(
      `SELECT (percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM ${PRIMEIRA}) / 60)
                FILTER (WHERE ${TEM_PRIMEIRA} AND a.aberto_em >= ${ini}))::float AS primeira,
              avg(extract(epoch FROM a.encerrado_em - a.aberto_em) / 60)
                FILTER (WHERE a.encerrado_em >= ${ini})::float AS duracao,
              count(*) FILTER (WHERE a.encerrado_em >= ${ini})::int AS encerrados,
              count(*) FILTER (WHERE a.encerrado_em >= ${ini} AND a.motivo ILIKE 'venda%')::int AS vendas,
              avg(a.nota_cliente) FILTER (WHERE a.nota_em >= ${ini})::float AS nota,
              count(a.nota_cliente) FILTER (WHERE a.nota_em >= ${ini})::int AS notas
         FROM comercial.atendimentos a
        WHERE a.conta_id = ${C} AND (a.aberto_em >= ${ini} OR a.encerrado_em >= ${ini} OR a.nota_em >= ${ini}) ${doGrupo}`,
    ),
    db.query(
      `SELECT (percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM ${PRIMEIRA}) / 60))::float AS primeira
         FROM comercial.atendimentos a
        WHERE a.conta_id = ${C} AND ${TEM_PRIMEIRA} ${doGrupo}
          AND a.aberto_em >= ${INICIO.hoje} - interval '1 day' AND a.aberto_em < ${INICIO.hoje}`,
    ),
    db.query(
      `SELECT u.id, u.nome, u.disponivel, u.pausa_desde AS "pausaDesde",
              (SELECT count(*)::int FROM comercial.oportunidades o
                WHERE o.conta_id = ${C} AND o.responsavel_id = u.id AND o.etapa <> 'descartado') AS carteira,
              count(a.id) FILTER (WHERE a.situacao = 'aberto')::int AS esperando,
              count(a.id) FILTER (WHERE a.situacao <> 'encerrado')::int AS "emAtendimento",
              count(a.id) FILTER (WHERE a.aberto_em >= ${ini} OR a.encerrado_em >= ${ini})::int AS hoje,
              (SELECT count(*)::int FROM comercial.atendimento_eventos ev
                WHERE ev.conta_id = ${C} AND ev.usuario_id = u.id AND ev.tipo = 'transferiu'
                  AND ev.para_usuario_id IS NULL AND ev.para_grupo_id IS NULL AND ev.criado_em >= ${ini}) AS "paraFila",
              (percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM ${PRIMEIRA}) / 60)
                FILTER (WHERE ${TEM_PRIMEIRA} AND a.aberto_em >= ${ini}))::float AS "primeiraRespostaMin",
              avg(a.nota_cliente) FILTER (WHERE a.nota_em >= ${ini})::float AS nota
         FROM cadastro.usuarios u
         LEFT JOIN comercial.atendimentos a ON a.conta_id = ${C} AND a.atendente_id = u.id
              AND (a.situacao <> 'encerrado' OR a.encerrado_em >= ${ini} OR a.aberto_em >= ${ini} OR a.nota_em >= ${ini})
        WHERE u.conta_id = ${C} AND u.ativo AND NOT u.master AND u.papel IN ('admin', 'sdr', 'closer')
          ${grupo ? `AND u.id IN (SELECT gm.usuario_id FROM cadastro.grupo_membros gm WHERE gm.grupo_id = ${Number(grupo)})` : ''}
        GROUP BY u.id
        ORDER BY count(a.id) FILTER (WHERE a.situacao <> 'encerrado') DESC, u.nome`,
    ),
    db.query(
      `SELECT a.motivo, count(*)::int AS total FROM comercial.atendimentos a
        WHERE a.conta_id = ${C} AND a.encerrado_em >= ${ini} AND a.motivo IS NOT NULL ${doGrupo}
        GROUP BY a.motivo ORDER BY total DESC, a.motivo`,
    ),
    db.query(
      `SELECT count(*) FILTER (WHERE a.origem = 'carteira')::int AS carteira,
              count(*) FILTER (WHERE a.origem = 'geral')::int AS geral,
              (SELECT count(*)::int FROM comercial.atendimento_eventos ev
                WHERE ev.conta_id = ${C} AND ev.tipo = 'carteira' AND ev.criado_em >= ${ini}
                  AND ev.usuario_id = ev.para_usuario_id) AS "viraramDono"
         FROM comercial.atendimentos a WHERE a.conta_id = ${C} AND a.aberto_em >= ${ini} ${doGrupo}`,
    ),
    db.query(
      `SELECT x AS nome, count(*)::int AS total
         FROM comercial.atendimentos a, unnest(a.etiquetas) x
        WHERE a.conta_id = ${C} AND a.aberto_em >= ${ini} ${doGrupo}
        GROUP BY x ORDER BY total DESC, x LIMIT 12`,
    ),
  ]);
  const k = kpi.rows[0] ?? {};
  const ag = agora.rows[0] ?? {};
  const arred = (v: unknown) => (v == null ? null : Math.round(Number(v) * 10) / 10);
  return {
    agora: {
      naFila: ag.naFila ?? 0,
      filaDesde: ag.filaDesde ? new Date(ag.filaDesde).toISOString() : null,
      emAtendimento: ag.emAtendimento ?? 0,
      pessoas: ag.pessoas ?? 0,
    },
    primeiraRespostaMin: arred(k.primeira),
    primeiraRespostaOntemMin: arred(ontem.rows[0]?.primeira),
    duracaoMin: arred(k.duracao),
    encerrados: k.encerrados ?? 0,
    vendas: k.vendas ?? 0,
    notaMedia: arred(k.nota),
    notas: k.notas ?? 0,
    porPessoa: porPessoa.rows.map((p) => ({
      ...p,
      pausaDesde: p.pausaDesde ? new Date(p.pausaDesde).toISOString() : null,
      primeiraRespostaMin: arred(p.primeiraRespostaMin),
      nota: arred(p.nota),
    })),
    motivos: motivos.rows,
    origens: origens.rows[0] ?? { carteira: 0, geral: 0, viraramDono: 0 },
    etiquetas: etiq.rows,
  };
}
