import { comTransacao, type Executor, type Pool } from '@prospeccao/db';
import {
  AppError,
  type CampanhaEmailEntrada,
  type ClasseResposta,
  type ConfigEmailEntrada,
  LIMITE_ANEXOS_EMAIL,
  type ModeloEmailEntrada,
  montarEmail,
  type VariaveisEmail,
} from '@prospeccao/shared';
import { usuarioAtual } from '../../contexto.js';
import { obterConfig as configCadencia } from '../funil/cadencia.js';

/** Prospecção por e-mail (schema comercial, só a API escreve). */

export const HOJE_SP = `(date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')`;

/* ───────────── Configuração ───────────── */

export interface ConfigEmail extends ConfigEmailEntrada {
  /** Último aviso do Resend recebido (mostra se o webhook está configurado e chegando). */
  webhookEm: string | null;
}

export async function obterConfig(db: Executor): Promise<ConfigEmail> {
  const { rows } = await db.query<ConfigEmail>(
    `SELECT ligado, remetente_nome AS "remetenteNome", responder_para AS "responderPara", assinatura,
            limite_dia AS "limiteDia", intervalo_seg AS "intervaloSeg", hora_inicio AS "horaInicio",
            hora_fim AS "horaFim", dias_semana AS "diasSemana", rastrear_abertura AS "rastrearAbertura",
            webhook_em AS "webhookEm"
       FROM comercial.config_email LIMIT 1`,
  );
  const c = rows[0];
  if (!c) throw new Error('config_email vazia: a migration 028 não rodou');
  return c;
}

export async function salvarConfig(db: Executor, c: ConfigEmailEntrada): Promise<void> {
  await db.query(
    `UPDATE comercial.config_email
        SET ligado = $1, remetente_nome = $2, responder_para = $3, assinatura = $4, limite_dia = $5,
            intervalo_seg = $6, hora_inicio = $7, hora_fim = $8, dias_semana = $9, rastrear_abertura = $10,
            atualizado_em = now()`,
    [
      c.ligado,
      c.remetenteNome,
      c.responderPara,
      c.assinatura,
      c.limiteDia,
      c.intervaloSeg,
      c.horaInicio,
      c.horaFim,
      c.diasSemana,
      c.rastrearAbertura,
    ],
  );
}

/* ───────────── Modelos e anexos ───────────── */

export async function listarModelos(db: Executor) {
  const { rows } = await db.query(
    `SELECT m.id, m.nome, m.assunto, m.corpo, m.anexos::int[] AS anexos, m.atualizado_em AS "atualizadoEm",
            coalesce((SELECT json_agg(json_build_object('id', a.id, 'nome', a.nome, 'mime', a.mime, 'tamanho', a.tamanho)
                                      ORDER BY a.id)
                        FROM comercial.midias a WHERE a.id = ANY(m.anexos)), '[]') AS arquivos
       FROM comercial.modelos_email m ORDER BY m.id`,
  );
  return rows;
}

async function conferirAnexos(db: Executor, ids: number[]) {
  if (!ids.length) return;
  const { rows } = await db.query<{ n: number; total: number }>(
    'SELECT count(*)::int AS n, coalesce(sum(tamanho), 0)::int AS total FROM comercial.midias WHERE id = ANY($1::bigint[])',
    [ids],
  );
  if ((rows[0]?.n ?? 0) !== new Set(ids).size) throw AppError.naoEncontrado('Anexo');
  if ((rows[0]?.total ?? 0) > LIMITE_ANEXOS_EMAIL)
    throw AppError.invalido(
      'Os anexos somam mais de 10 MB: muitos provedores recusam o e-mail. Use um PDF menor.',
    );
}

export async function salvarModelo(db: Executor, d: ModeloEmailEntrada, id?: number): Promise<number> {
  await conferirAnexos(db, d.anexos);
  if (id) {
    const { rowCount } = await db.query(
      `UPDATE comercial.modelos_email SET nome = $2, assunto = $3, corpo = $4, anexos = $5, atualizado_em = now()
        WHERE id = $1`,
      [id, d.nome, d.assunto, d.corpo, d.anexos],
    );
    if (!rowCount) throw AppError.naoEncontrado('Modelo');
    return id;
  }
  const { rows } = await db.query<{ id: number }>(
    'INSERT INTO comercial.modelos_email (nome, assunto, corpo, anexos) VALUES ($1, $2, $3, $4) RETURNING id',
    [d.nome, d.assunto, d.corpo, d.anexos],
  );
  return rows[0]!.id;
}

export async function apagarModelo(db: Executor, id: number): Promise<void> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM comercial.campanhas_email
      WHERE status IN ('enviando', 'pausada', 'rascunho')
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(passos) p WHERE (p->>'modeloId')::int = $1)`,
    [id],
  );
  if ((rows[0]?.n ?? 0) > 0)
    throw AppError.invalido('Este modelo está numa campanha de e-mail em andamento.');
  await db.query('DELETE FROM comercial.modelos_email WHERE id = $1', [id]);
}

export async function obterModelo(db: Executor, id: number) {
  const { rows } = await db.query<{ id: number; assunto: string; corpo: string; anexos: number[] }>(
    'SELECT id, assunto, corpo, anexos::int[] AS anexos FROM comercial.modelos_email WHERE id = $1',
    [id],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Modelo de e-mail');
  return rows[0];
}

export async function anexosDoModelo(db: Executor, ids: number[]) {
  if (!ids.length) return [];
  const { rows } = await db.query<{ nome: string; mime: string; dados: Buffer }>(
    'SELECT coalesce(nome, $2) AS nome, mime, dados FROM comercial.midias WHERE id = ANY($1::bigint[]) ORDER BY id',
    [ids, 'anexo'],
  );
  return rows.map((r) => ({ nome: r.nome, mime: r.mime, conteudo: r.dados }));
}

/* ───────────── Dados do lead para o texto ───────────── */

export async function variaveisDoLead(db: Executor, empresaId: number): Promise<VariaveisEmail> {
  const [{ rows }, cad, cfg] = await Promise.all([
    db.query<{ nome: string; cidade: string | null; decisor: string | null }>(
      `SELECT e.nome, e.cidade,
              (SELECT p.nome FROM enriquecimento.pessoas p WHERE p.empresa_id = e.id AND p.decisor
                ORDER BY p.id LIMIT 1) AS decisor
         FROM descoberta.empresas e WHERE e.id = $1`,
      [empresaId],
    ),
    configCadencia(db),
    obterConfig(db),
  ]);
  const l = rows[0];
  if (!l) throw AppError.naoEncontrado('Empresa');
  const titulo = (s: string) => s.toLowerCase().replace(/(^|\s)\p{L}/gu, (x) => x.toUpperCase());
  return {
    nome: l.decisor ? titulo(l.decisor.trim().split(/\s+/)[0] ?? '') : null,
    empresa: l.nome === l.nome.toUpperCase() ? titulo(l.nome) : l.nome,
    cidade: l.cidade ? titulo(l.cidade) : null,
    remetente: cad.remetente || cfg.remetenteNome,
  };
}

/** Lead de exemplo para a prévia: o primeiro com decisor, ou um inventado. */
async function leadDeExemplo(db: Executor, empresaId?: number | null): Promise<VariaveisEmail> {
  if (empresaId) return variaveisDoLead(db, empresaId);
  const { rows } = await db.query<{ empresa_id: number }>(
    `SELECT p.empresa_id::int FROM enriquecimento.pessoas p WHERE p.decisor ORDER BY p.id LIMIT 1`,
  );
  if (rows[0]) return variaveisDoLead(db, rows[0].empresa_id);
  const cad = await configCadencia(db);
  return {
    nome: 'Marcos',
    empresa: 'Auto Peças Exemplo',
    cidade: 'Salvador',
    remetente: cad.remetente || 'Tutts',
  };
}

export async function previa(db: Executor, m: { assunto: string; corpo: string }, empresaId?: number | null) {
  const [v, cfg] = await Promise.all([leadDeExemplo(db, empresaId), obterConfig(db)]);
  const e = montarEmail(m, v, { assinatura: cfg.assinatura, descadastro: '#descadastro' });
  return { assunto: e.assunto, html: e.html, texto: e.texto, lead: v, remetente: cfg.remetenteNome };
}

/* ───────────── Quem recebe ───────────── */

/**
 * Leads da campanha de prospecção que podem receber: têm e-mail válido, não pediram para sair,
 * não foram descartados e (se pedido) ainda não estão sendo trabalhados no funil.
 */
function sqlElegiveis(c: Pick<CampanhaEmailEntrada, 'faixas' | 'pularNoFunil' | 'incluirContador'>) {
  return `
    WITH alvo AS (
      SELECT ce.empresa_id, e.nome, e.cidade, l.faixa, o.etapa,
             (SELECT c.valor FROM enriquecimento.contatos c
               WHERE c.empresa_id = ce.empresa_id AND c.canal = 'email' AND c.status <> 'invalido'
                 ${c.incluirContador ? '' : `AND NOT (c.status = 'atencao' AND coalesce(c.rotulo, '') ILIKE '%contador%')`}
               ORDER BY c.principal DESC, (c.fontes <@ ARRAY['receita']::text[]), c.confianca DESC
               LIMIT 1) AS email
        FROM descoberta.campanha_empresas ce
        JOIN descoberta.empresas e ON e.id = ce.empresa_id
        LEFT JOIN enriquecimento.leads l ON l.empresa_id = ce.empresa_id
        LEFT JOIN comercial.oportunidades o ON o.empresa_id = ce.empresa_id
       WHERE ce.campanha_id = $1)
    SELECT DISTINCT ON (lower(alvo.email)) alvo.empresa_id::int AS "empresaId", alvo.nome, alvo.cidade,
           alvo.faixa, lower(alvo.email) AS email
      FROM alvo
     WHERE alvo.email IS NOT NULL
       AND alvo.etapa IS DISTINCT FROM 'descartado'
       ${c.pularNoFunil ? `AND (alvo.etapa IS NULL OR alvo.etapa = 'a_abordar')` : ''}
       ${c.faixas.length ? 'AND alvo.faixa = ANY($2::text[])' : ''}
       AND NOT EXISTS (SELECT 1 FROM comercial.descadastros_email d WHERE d.email = lower(alvo.email))
       -- quem já recebeu e-mail de outra campanha nos últimos 30 dias fica de fora
       AND NOT EXISTS (SELECT 1 FROM comercial.envios_email x
                        WHERE lower(x.email) = lower(alvo.email) AND x.status = 'enviado'
                          AND x.enviado_em > now() - interval '30 days')
     ORDER BY lower(alvo.email), alvo.faixa NULLS LAST`;
}

export async function elegiveis(
  db: Executor,
  c: Pick<CampanhaEmailEntrada, 'campanhaId' | 'faixas' | 'pularNoFunil' | 'incluirContador'>,
) {
  const valores: unknown[] = [c.campanhaId];
  if (c.faixas.length) valores.push(c.faixas);
  const { rows } = await db.query<{
    empresaId: number;
    nome: string;
    cidade: string | null;
    faixa: string | null;
    email: string;
  }>(sqlElegiveis(c), valores);
  const { rows: total } = await db.query<{ leads: number; comEmail: number }>(
    `SELECT count(*)::int AS leads,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM enriquecimento.contatos c
                                            WHERE c.empresa_id = ce.empresa_id AND c.canal = 'email'
                                              AND c.status <> 'invalido'))::int AS "comEmail"
       FROM descoberta.campanha_empresas ce WHERE ce.campanha_id = $1`,
    [c.campanhaId],
  );
  return { leads: total[0]?.leads ?? 0, comEmail: total[0]?.comEmail ?? 0, elegiveis: rows };
}

/* ───────────── Campanhas de e-mail ───────────── */

export async function criarCampanha(db: Executor, d: CampanhaEmailEntrada): Promise<number> {
  for (const p of d.passos) await obterModelo(db, p.modeloId);
  const { rows: camp } = await db.query('SELECT 1 FROM cadastro.campanhas WHERE id = $1', [d.campanhaId]);
  if (!camp.length) throw AppError.naoEncontrado('Campanha de prospecção');
  const passos = d.passos.map((p, i) => ({ modeloId: p.modeloId, dias: i === 0 ? 0 : Math.max(1, p.dias) }));
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO comercial.campanhas_email (nome, campanha_id, passos, faixas, pular_no_funil, incluir_contador, criado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      d.nome,
      d.campanhaId,
      JSON.stringify(passos),
      d.faixas,
      d.pularNoFunil,
      d.incluirContador,
      usuarioAtual()?.id ?? null,
    ],
  );
  return rows[0]!.id;
}

interface CampanhaEmailRow {
  id: number;
  nome: string;
  campanhaId: number;
  passos: { modeloId: number; dias: number }[];
  faixas: ('A' | 'B' | 'C')[];
  pularNoFunil: boolean;
  incluirContador: boolean;
  status: 'rascunho' | 'enviando' | 'pausada' | 'concluida';
}

async function obterCampanhaRow(db: Executor, id: number): Promise<CampanhaEmailRow> {
  const { rows } = await db.query<CampanhaEmailRow>(
    `SELECT id, nome, campanha_id::int AS "campanhaId", passos, faixas, pular_no_funil AS "pularNoFunil",
            incluir_contador AS "incluirContador", status
       FROM comercial.campanhas_email WHERE id = $1`,
    [id],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Campanha de e-mail');
  return rows[0];
}

/** Começa (ou retoma): põe na fila o 1º e-mail de quem pode receber. */
export async function iniciarCampanha(pool: Pool, id: number): Promise<{ naFila: number }> {
  return comTransacao(pool, async (tx) => {
    const c = await obterCampanhaRow(tx, id);
    if (c.status === 'concluida') throw AppError.invalido('Esta campanha já terminou.');
    const { elegiveis: lista } = await elegiveis(tx, c);
    let naFila = 0;
    for (const l of lista) {
      const { rowCount } = await tx.query(
        `INSERT INTO comercial.envios_email (campanha_email_id, empresa_id, email, passo)
         VALUES ($1, $2, $3, 1) ON CONFLICT DO NOTHING`,
        [id, l.empresaId, l.email],
      );
      naFila += rowCount ?? 0;
    }
    await tx.query(
      `UPDATE comercial.campanhas_email SET status = 'enviando', iniciada_em = coalesce(iniciada_em, now()) WHERE id = $1`,
      [id],
    );
    return { naFila };
  });
}

export async function pausarCampanha(db: Executor, id: number): Promise<void> {
  await db.query(
    `UPDATE comercial.campanhas_email SET status = 'pausada' WHERE id = $1 AND status = 'enviando'`,
    [id],
  );
}

export async function apagarCampanha(db: Executor, id: number): Promise<void> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM comercial.envios_email WHERE campanha_email_id = $1 AND status = 'enviado'`,
    [id],
  );
  if ((rows[0]?.n ?? 0) > 0)
    throw AppError.invalido('Esta campanha já enviou e-mails: pause em vez de apagar (o histórico fica).');
  await db.query('DELETE FROM comercial.campanhas_email WHERE id = $1', [id]);
}

export async function listarCampanhas(db: Executor) {
  const { rows } = await db.query(
    `SELECT ce.id, ce.nome, ce.status, ce.passos, ce.faixas, ce.pular_no_funil AS "pularNoFunil",
            ce.incluir_contador AS "incluirContador", ce.campanha_id::int AS "campanhaId", c.nome AS "campanhaNome",
            ce.criado_em AS "criadoEm", ce.iniciada_em AS "iniciadaEm", ce.concluida_em AS "concluidaEm",
            count(DISTINCT en.empresa_id)::int AS leads,
            count(*) FILTER (WHERE en.status = 'na_fila')::int AS "naFila",
            count(*) FILTER (WHERE en.status = 'enviado')::int AS enviados,
            count(*) FILTER (WHERE en.status IN ('erro', 'devolvido'))::int AS erros,
            count(DISTINCT en.empresa_id) FILTER (WHERE en.aberto_em IS NOT NULL)::int AS abriram,
            count(DISTINCT en.empresa_id) FILTER (WHERE en.clicado_em IS NOT NULL)::int AS clicaram,
            count(DISTINCT en.empresa_id) FILTER (WHERE en.respondido_em IS NOT NULL)::int AS responderam,
            (SELECT count(DISTINCT r.empresa_id)::int FROM comercial.respostas_email r
               JOIN comercial.envios_email x ON x.id = r.envio_id
              WHERE x.campanha_email_id = ce.id AND r.classe = 'interessado') AS interessados,
            max(en.enviado_em) AS "ultimoEnvio"
       FROM comercial.campanhas_email ce
       JOIN cadastro.campanhas c ON c.id = ce.campanha_id
       LEFT JOIN comercial.envios_email en ON en.campanha_email_id = ce.id
      GROUP BY ce.id, c.nome
      ORDER BY ce.id DESC`,
  );
  return rows;
}

export async function envios(
  db: Executor,
  f: {
    campanhaEmailId?: number;
    filtro?: 'todos' | 'abriram' | 'responderam' | 'erros' | 'fila';
    busca?: string;
  },
) {
  const where = ['true'];
  const valores: unknown[] = [];
  const p = (v: unknown) => {
    valores.push(v);
    return `$${valores.length}`;
  };
  if (f.campanhaEmailId) where.push(`en.campanha_email_id = ${p(f.campanhaEmailId)}`);
  if (f.filtro === 'abriram') where.push('en.aberto_em IS NOT NULL');
  if (f.filtro === 'responderam') where.push('en.respondido_em IS NOT NULL');
  if (f.filtro === 'erros') where.push(`en.status IN ('erro', 'devolvido')`);
  if (f.filtro === 'fila') where.push(`en.status = 'na_fila'`);
  if (f.busca) where.push(`(e.nome ILIKE ${p(`%${f.busca}%`)} OR en.email ILIKE ${p(`%${f.busca}%`)})`);
  const { rows } = await db.query(
    `SELECT en.id::int, en.empresa_id::int AS "empresaId", e.nome, e.cidade, en.email, en.passo, en.status,
            en.assunto, en.erro, en.enviado_em AS "enviadoEm", en.aberto_em AS "abertoEm", en.aberturas,
            en.clicado_em AS "clicadoEm", en.cliques, en.respondido_em AS "respondidoEm",
            ce.nome AS "campanhaNome", ce.id AS "campanhaEmailId",
            (SELECT r.classe FROM comercial.respostas_email r WHERE r.envio_id = en.id
              ORDER BY r.recebido_em DESC LIMIT 1) AS "classeResposta",
            o.etapa AS "etapaFunil"
       FROM comercial.envios_email en
       JOIN comercial.campanhas_email ce ON ce.id = en.campanha_email_id
       JOIN descoberta.empresas e ON e.id = en.empresa_id
       LEFT JOIN comercial.oportunidades o ON o.empresa_id = en.empresa_id
      WHERE ${where.join(' AND ')}
      ORDER BY coalesce(en.respondido_em, en.enviado_em, en.criado_em) DESC, en.id DESC
      LIMIT 500`,
    valores,
  );
  return rows;
}

export async function respostas(db: Executor, f: { classe?: ClasseResposta; naoLidas?: boolean }) {
  const { rows } = await db.query(
    `SELECT r.id::int, r.empresa_id::int AS "empresaId", e.nome, e.cidade, r.de_email AS "deEmail",
            r.de_nome AS "deNome", r.assunto, r.texto, r.recebido_em AS "recebidoEm", r.classe, r.resumo,
            r.classificado_por AS "classificadoPor", r.lida_em AS "lidaEm", o.etapa AS "etapaFunil",
            ce.nome AS "campanhaNome"
       FROM comercial.respostas_email r
       LEFT JOIN descoberta.empresas e ON e.id = r.empresa_id
       LEFT JOIN comercial.oportunidades o ON o.empresa_id = r.empresa_id
       LEFT JOIN comercial.envios_email en ON en.id = r.envio_id
       LEFT JOIN comercial.campanhas_email ce ON ce.id = en.campanha_email_id
      WHERE ($1::text IS NULL OR r.classe = $1) AND (NOT $2 OR r.lida_em IS NULL)
      ORDER BY r.recebido_em DESC LIMIT 300`,
    [f.classe ?? null, f.naoLidas ?? false],
  );
  return rows;
}

export async function resumo(db: Executor) {
  const { rows } = await db.query<{ enviadosHoje: number; naFila: number; respostasNaoLidas: number }>(
    `SELECT (SELECT count(*) FROM comercial.envios_email WHERE status = 'enviado' AND enviado_em >= ${HOJE_SP})::int
              AS "enviadosHoje",
            (SELECT count(*) FROM comercial.envios_email en JOIN comercial.campanhas_email ce
                ON ce.id = en.campanha_email_id
              WHERE en.status = 'na_fila' AND ce.status = 'enviando')::int AS "naFila",
            (SELECT count(*) FROM comercial.respostas_email WHERE lida_em IS NULL AND classe <> 'automatica')::int
              AS "respostasNaoLidas"`,
  );
  return rows[0]!;
}

/** E-mails de um lead (para a ficha): o que foi enviado e o que ele respondeu. */
export async function doLead(db: Executor, empresaId: number) {
  const [env, resp] = await Promise.all([
    db.query(
      `SELECT en.id::int, en.email, en.passo, en.status, en.assunto, en.enviado_em AS "enviadoEm",
              en.aberto_em AS "abertoEm", en.aberturas, en.clicado_em AS "clicadoEm", en.respondido_em AS "respondidoEm",
              ce.nome AS "campanhaNome"
         FROM comercial.envios_email en JOIN comercial.campanhas_email ce ON ce.id = en.campanha_email_id
        WHERE en.empresa_id = $1 AND en.status <> 'cancelado' ORDER BY en.id DESC LIMIT 50`,
      [empresaId],
    ),
    db.query(
      `SELECT r.id::int, r.de_email AS "deEmail", r.assunto, r.texto, r.recebido_em AS "recebidoEm", r.classe, r.resumo
         FROM comercial.respostas_email r WHERE r.empresa_id = $1 ORDER BY r.recebido_em DESC LIMIT 50`,
      [empresaId],
    ),
  ]);
  return { envios: env.rows, respostas: resp.rows };
}

export async function descadastrar(db: Executor, email: string, motivo: string): Promise<void> {
  await db.query(
    `INSERT INTO comercial.descadastros_email (email, motivo) VALUES (lower($1), $2) ON CONFLICT (email) DO NOTHING`,
    [email, motivo],
  );
  await db.query(
    `UPDATE comercial.envios_email SET status = 'cancelado', erro = 'Pediu para sair da lista'
      WHERE lower(email) = lower($1) AND status = 'na_fila'`,
    [email],
  );
}
