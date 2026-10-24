import type { Executor } from '@prospeccao/db';
import { AppError, LIMITE_MIDIA_BYTES, type MidiaEntrada } from '@prospeccao/shared';
import { conta, contaSql, usuarioAtual } from '../../contexto.js';
import type { DepsApi } from '../../dependencias.js';
import { visivel } from '../../visibilidade.js';
import { chipParaEquipe, emUso as chipsEmUso } from '../agente/chips.js';
import * as agente from '../agente/repositorio.js';
import * as contatos from '../contatos/repositorio.js';
import { dadosDoLead } from '../funil/cadencia.js';
import * as funil from '../funil/repositorio.js';
import { lerAvisosDoLead } from '../notificacoes/repositorio.js';

/**
 * Caixa de entrada do WhatsApp. A conversa junta as mensagens do sistema (IA, cadência, você
 * pela tela, o lead pelo webhook) e o que foi registrado à mão como contato de WhatsApp.
 */

/**
 * A conversa do lead nos dois canais: WhatsApp (mensagens do sistema e o que foi registrado à
 * mão, sem repetir) e e-mail (os da sequência, as respostas dele e o que a equipe respondeu).
 */
const conversa = () => `
  SELECT m.empresa_id, 'm' || m.id AS id, 'whatsapp' AS canal, NULL::text AS assunto, m.direcao, m.texto, m.status,
         m.origem, m.erro, m.nota, m.midia_tipo, m.midia_id, coalesce(m.enviado_em, m.criado_em) AS em, m.usuario_id,
         m.telefone, m.contato_id
    FROM comercial.mensagens m
   WHERE m.conta_id = ${contaSql()} AND m.status <> 'descartada'
  UNION ALL
  SELECT a.empresa_id, 'a' || a.id, 'whatsapp', NULL, a.direcao, a.texto, 'registrada', 'registro', NULL, NULL,
         NULL, NULL, a.criado_em, a.usuario_id, NULL, NULL
    FROM comercial.atividades a
   WHERE a.conta_id = ${contaSql()} AND a.tipo = 'whatsapp' AND a.direcao IS NOT NULL AND a.texto IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM comercial.mensagens m
                      WHERE m.conta_id = a.conta_id AND m.empresa_id = a.empresa_id AND m.direcao = a.direcao
                        AND m.texto = a.texto
                        AND abs(extract(epoch FROM coalesce(m.enviado_em, m.criado_em) - a.criado_em)) < 600)
  UNION ALL
  -- E-mails da sequência (o assunto; o texto completo fica na aba E-mail)
  SELECT en.empresa_id, 'e' || en.id, 'email', en.assunto, 'enviada', coalesce(en.assunto, '(e-mail)'), 'enviada',
         'sequencia', NULL, ce.nome, NULL, NULL, en.enviado_em, NULL, NULL, NULL
    FROM comercial.envios_email en JOIN comercial.campanhas_email ce ON ce.id = en.campanha_email_id
   WHERE en.conta_id = ${contaSql()} AND en.canal = 'email' AND en.status = 'enviado'
  UNION ALL
  -- Respostas do lead por e-mail
  SELECT r.empresa_id, 'r' || r.id, 'email', r.assunto, 'recebida', r.texto, 'recebida', 'lead', NULL,
         r.resumo, NULL, NULL, r.recebido_em, NULL, NULL, NULL
    FROM comercial.respostas_email r
   WHERE r.conta_id = ${contaSql()} AND r.empresa_id IS NOT NULL AND r.classe <> 'automatica'
  UNION ALL
  -- O que a equipe respondeu por e-mail (pela tela)
  SELECT a.empresa_id, 'a' || a.id, 'email', NULL, 'enviada', a.texto, 'enviada', 'humano', NULL, NULL,
         NULL, NULL, a.criado_em, a.usuario_id, NULL, NULL
    FROM comercial.atividades a
   WHERE a.conta_id = ${contaSql()} AND a.tipo = 'email' AND a.direcao = 'enviada' AND a.texto IS NOT NULL
     AND a.usuario_id IS NOT NULL`;

/** Mensagens e e-mails do lead ainda não lidos. */
const naoLidasSql = (C: string, empresa: string) => `
  (SELECT count(*) FROM comercial.mensagens m
    WHERE m.conta_id = ${C} AND m.empresa_id = ${empresa} AND m.direcao = 'recebida' AND m.lida_em IS NULL)
  + (SELECT count(*) FROM comercial.respostas_email r
    WHERE r.conta_id = ${C} AND r.empresa_id = ${empresa} AND r.lida_em IS NULL AND r.classe <> 'automatica')`;

export async function listar(
  db: Executor,
  f: { filtro: 'todas' | 'nao_lidas' | 'minhas'; busca?: string },
  usuarioId: number,
) {
  const C = contaSql();
  const where = ['true'];
  const valores: unknown[] = [];
  const p = (v: unknown) => {
    valores.push(v);
    return `$${valores.length}`;
  };
  if (f.filtro === 'nao_lidas') where.push('nl.n > 0');
  if (f.filtro === 'minhas') where.push(`o.responsavel_id = ${p(usuarioId)}`);
  if (f.busca)
    where.push(
      `(e.nome ILIKE ${p(`%${f.busca}%`)} OR e.maps_telefone LIKE ${p(`%${f.busca.replace(/\D/g, '') || '§'}%`)}
        OR EXISTS (SELECT 1 FROM comercial.contatos_lead cl WHERE cl.conta_id = o.conta_id AND cl.empresa_id = o.empresa_id
                    AND (cl.nome ILIKE ${p(`%${f.busca}%`)} OR cl.telefone LIKE ${p(`%${f.busca.replace(/\D/g, '') || '§'}%`)})))`,
    );
  const { rows } = await db.query(
    `WITH c AS (${conversa()}),
     ult AS (
       SELECT DISTINCT ON (empresa_id) empresa_id, texto, direcao, em, midia_tipo, status, origem, canal
         FROM c WHERE em IS NOT NULL ORDER BY empresa_id, em DESC)
     SELECT ult.empresa_id::int AS "empresaId", e.nome, e.cidade, o.etapa, et.nome AS "etapaNome",
            et.cor AS "etapaCor", o.responsavel_id AS "responsavelId", u.nome AS "responsavelNome",
            o.agente, o.agente_pausa AS "agentePausa", ult.texto AS "ultima", ult.direcao AS "ultimaDirecao",
            ult.em AS "ultimaEm", ult.midia_tipo AS "ultimaMidia", ult.origem AS "ultimaOrigem",
            ult.canal AS "ultimoCanal",
            coalesce(nl.n, 0) AS "naoLidas",
            (SELECT cl.nome FROM comercial.contatos_lead cl
              WHERE cl.conta_id = o.conta_id AND cl.empresa_id = o.empresa_id AND cl.status = 'confirmado'
                AND o.whatsapp_destino IS NOT NULL AND left(cl.telefone, 2) = left(o.whatsapp_destino, 2)
                AND right(cl.telefone, 8) = right(o.whatsapp_destino, 8) LIMIT 1) AS "falandoCom",
            (SELECT count(*)::int FROM comercial.contatos_lead cl
              WHERE cl.conta_id = o.conta_id AND cl.empresa_id = o.empresa_id AND cl.status = 'sugerido') AS "sugestoes"
       FROM ult
       JOIN comercial.oportunidades o ON o.conta_id = ${C} AND o.empresa_id = ult.empresa_id
       JOIN descoberta.empresas e ON e.id = ult.empresa_id
       LEFT JOIN comercial.etapas et ON et.id = o.etapa_id
       LEFT JOIN cadastro.usuarios u ON u.id = o.responsavel_id
       LEFT JOIN LATERAL (SELECT (${naoLidasSql(C, 'ult.empresa_id')})::int AS n) nl ON true
      WHERE ${where.join(' AND ')}
      ORDER BY ult.em DESC
      LIMIT 300`,
    valores,
  );
  return rows;
}

/** Conversa aberta: o lead, as mensagens e os dados para as respostas rápidas. */
export async function abrir(db: Executor, empresaId: number) {
  const [lead, msgs] = await Promise.all([
    dadosDoLead(db, empresaId),
    db.query(
      `WITH c AS (${conversa()})
       SELECT c.id, c.canal, c.assunto, c.direcao, c.texto, c.status, c.origem, c.erro, c.nota,
              c.midia_tipo AS "midiaTipo", c.midia_id::int AS "midiaId", c.em,
              c.telefone, c.contato_id::int AS "contatoId", cl.nome AS "contatoNome", cl.cargo AS "contatoCargo",
              CASE WHEN c.origem = 'agente' THEN 'IA'
                   WHEN c.origem = 'cadencia' THEN coalesce(u.nome, 'Cadência')
                   WHEN c.origem = 'sequencia' THEN 'Sequência'
                   WHEN c.direcao = 'recebida' THEN NULL
                   ELSE coalesce(u.nome, 'Você') END AS autor
         FROM c LEFT JOIN cadastro.usuarios u ON u.id = c.usuario_id
                LEFT JOIN comercial.contatos_lead cl ON cl.id = c.contato_id
        WHERE c.empresa_id = $1 AND c.em IS NOT NULL
        ORDER BY c.em, c.id
        LIMIT 1000`,
      [empresaId],
    ),
  ]);
  const { rows: info } = await db.query(
    `SELECT e.nome, e.cidade, o.etapa, et.nome AS "etapaNome", et.cor AS "etapaCor",
            o.responsavel_id AS "responsavelId", u.nome AS "responsavelNome",
            o.agente, o.agente_pausa AS "agentePausa", o.whatsapp_destino AS "destinoEscolhido",
            CASE WHEN o.agente_pausa IS NOT NULL THEN o.agente_resumo END AS "agenteResumo",
            o.agente_memoria AS "agenteMemoria"
       FROM comercial.oportunidades o
       JOIN descoberta.empresas e ON e.id = o.empresa_id
       LEFT JOIN comercial.etapas et ON et.id = o.etapa_id
       LEFT JOIN cadastro.usuarios u ON u.id = o.responsavel_id
      WHERE o.conta_id = ${contaSql()} AND o.empresa_id = $1`,
    [empresaId],
  );
  const { rows: email } = await db.query<{ email: string | null; temConversa: boolean }>(
    `SELECT (SELECT c.valor FROM enriquecimento.contatos c
              WHERE c.empresa_id = $1 AND c.canal = 'email' AND c.status <> 'invalido' AND ${visivel('c')}
              ORDER BY c.principal DESC, c.confianca DESC LIMIT 1) AS email,
            EXISTS (SELECT 1 FROM comercial.respostas_email r
                     WHERE r.conta_id = ${contaSql()} AND r.empresa_id = $1 AND r.classe <> 'automatica') AS "temConversa"`,
    [empresaId],
  );
  const [contatosLead, opcoes] = await Promise.all([
    contatos.listar(db, empresaId),
    contatos.opcoesDeEnvio(db, empresaId),
  ]);
  const { destinoEscolhido: _d, ...dados } = (info[0] ?? {}) as Record<string, unknown>;
  return {
    empresaId,
    ...dados,
    /** Contatos da negociação (com a cadeia de quem indicou quem) e as sugestões a confirmar. */
    contatos: contatosLead,
    /** Números para o "enviar para"; telefone (abaixo) é o escolhido. */
    opcoesEnvio: opcoes,
    email: email[0]?.email ?? null,
    /** O lead já respondeu por e-mail: a resposta vai na mesma conversa. */
    emailEmConversa: email[0]?.temConversa ?? false,
    telefone: lead.telefone,
    variaveis: lead.variaveis,
    mensagens: msgs.rows,
  };
}

export async function marcarLidas(db: Executor, empresaId: number): Promise<void> {
  await db.query(
    `UPDATE comercial.mensagens SET lida_em = now()
      WHERE conta_id = ${contaSql()} AND empresa_id = $1 AND direcao = 'recebida' AND lida_em IS NULL`,
    [empresaId],
  );
  await db.query(
    `UPDATE comercial.respostas_email SET lida_em = now()
      WHERE conta_id = ${contaSql()} AND empresa_id = $1 AND lida_em IS NULL`,
    [empresaId],
  );
  const u = usuarioAtual();
  if (u) await lerAvisosDoLead(db, u.id, empresaId);
}

/** Você assumiu a conversa: a IA para de responder este lead (dá para devolver na ficha). */
async function assumir(db: Executor, empresaId: number) {
  await db.query(
    `UPDATE comercial.oportunidades SET agente_pausa = 'Você assumiu a conversa.'
      WHERE conta_id = ${contaSql()} AND empresa_id = $1 AND agente AND agente_pausa IS NULL`,
    [empresaId],
  );
}

type Deps = Pick<DepsApi, 'pool' | 'servicos'>;

async function exigirWhatsapp(deps: Deps) {
  const { whatsapp } = await deps.servicos(conta());
  if (!whatsapp)
    throw AppError.invalido(
      'O WhatsApp ainda não está ativo nesta conta. Fale com o suporte do Prospect Team.',
    );
  return whatsapp;
}

export async function enviarTexto(deps: Deps, empresaId: number, texto: string): Promise<void> {
  const whatsapp = await exigirWhatsapp(deps);
  const lead = await dadosDoLead(deps.pool, empresaId);
  if (!lead.telefone) throw AppError.invalido('Este lead não tem telefone.');
  const quem = usuarioAtual();
  const chip = await chipParaEquipe(deps.pool, empresaId, await chipsEmUso(deps.pool, whatsapp));
  const r = await whatsapp.enviar(lead.telefone, texto, chip?.instancia);
  await agente.criarMensagem(deps.pool, {
    chipId: chip?.id ?? null,
    empresaId,
    direcao: 'enviada',
    texto,
    telefone: lead.telefone,
    status: 'enviada',
    origem: 'humano',
    idExterno: r.idExterno,
    usuarioId: quem?.id ?? null,
  });
  await funil.registrarAtividade(
    deps.pool,
    empresaId,
    { tipo: 'whatsapp', direcao: 'enviada', texto, contato: lead.telefone },
    quem?.nome ?? 'sistema',
  );
  await assumir(deps.pool, empresaId);
  await marcarLidas(deps.pool, empresaId);
}

const ROTULO_MIDIA = {
  imagem: '[foto]',
  audio: '[áudio]',
  video: '[vídeo]',
  documento: '[documento]',
} as const;

export async function guardarMidia(
  db: Executor,
  m: { mime: string; nome?: string | null; base64: string },
): Promise<number> {
  const dados = Buffer.from(m.base64, 'base64');
  if (!dados.length) throw AppError.invalido('Arquivo vazio.');
  if (dados.length > LIMITE_MIDIA_BYTES) throw AppError.invalido('Arquivo grande demais (até 10 MB).');
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO comercial.midias (conta_id, mime, nome, tamanho, dados)
     VALUES (${contaSql()}, $1, $2, $3, $4) RETURNING id::int`,
    [m.mime, m.nome ?? null, dados.length, dados],
  );
  return rows[0]!.id;
}

export async function enviarMidia(deps: Deps, empresaId: number, m: MidiaEntrada): Promise<void> {
  const whatsapp = await exigirWhatsapp(deps);
  if (!whatsapp.enviarMidia) throw AppError.invalido('Envio de arquivos não disponível.');
  const lead = await dadosDoLead(deps.pool, empresaId);
  if (!lead.telefone) throw AppError.invalido('Este lead não tem telefone.');
  const midiaId = await guardarMidia(deps.pool, m);
  const quem = usuarioAtual();
  const chip = await chipParaEquipe(deps.pool, empresaId, await chipsEmUso(deps.pool, whatsapp));
  const r = await whatsapp.enviarMidia(
    lead.telefone,
    {
      tipo: m.tipo,
      mime: m.mime,
      base64: m.base64,
      nome: m.nome,
      legenda: m.legenda,
    },
    chip?.instancia,
  );
  const texto =
    m.legenda || (m.tipo === 'documento' && m.nome ? `[documento] ${m.nome}` : ROTULO_MIDIA[m.tipo]);
  await agente.criarMensagem(deps.pool, {
    empresaId,
    direcao: 'enviada',
    texto,
    telefone: lead.telefone,
    status: 'enviada',
    origem: 'humano',
    idExterno: r.idExterno,
    usuarioId: quem?.id ?? null,
    midiaTipo: m.tipo,
    midiaId,
    chipId: chip?.id ?? null,
  });
  await funil.registrarAtividade(
    deps.pool,
    empresaId,
    { tipo: 'whatsapp', direcao: 'enviada', texto, contato: lead.telefone },
    quem?.nome ?? 'sistema',
  );
  await assumir(deps.pool, empresaId);
  await marcarLidas(deps.pool, empresaId);
}

export async function midia(db: Executor, id: number) {
  const { rows } = await db.query<{ mime: string; nome: string | null; dados: Buffer }>(
    `SELECT mime, nome, dados FROM comercial.midias WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Arquivo');
  return rows[0];
}

/** Conversas com mensagem não lida (dos seus leads; o administrador vê todas). */
export async function resumo(db: Executor, usuarioId: number | null): Promise<{ naoLidas: number }> {
  const C = contaSql();
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(DISTINCT x.empresa_id)::int AS n FROM (
       SELECT m.empresa_id FROM comercial.mensagens m
        WHERE m.conta_id = ${C} AND m.direcao = 'recebida' AND m.lida_em IS NULL
       UNION ALL
       SELECT r.empresa_id FROM comercial.respostas_email r
        WHERE r.conta_id = ${C} AND r.lida_em IS NULL AND r.classe <> 'automatica' AND r.empresa_id IS NOT NULL) x
       JOIN comercial.oportunidades o ON o.conta_id = ${C} AND o.empresa_id = x.empresa_id
      WHERE ($1::int IS NULL OR o.responsavel_id = $1 OR o.responsavel_id IS NULL)`,
    [usuarioId],
  );
  return { naoLidas: (rows[0]?.n ?? 0) + (await contatos.contarNaoIdentificados(db)) };
}

/* ───────────── Respostas rápidas ───────────── */

export async function respostas(db: Executor) {
  const { rows } = await db.query(
    `SELECT id, atalho, texto FROM comercial.respostas_rapidas WHERE conta_id = ${contaSql()} ORDER BY atalho`,
  );
  return rows;
}

export async function salvarResposta(db: Executor, d: { atalho: string; texto: string }, id?: number) {
  if (id) {
    const { rowCount } = await db.query(
      `UPDATE comercial.respostas_rapidas SET atalho = $2, texto = $3 WHERE id = $1 AND conta_id = ${contaSql()}`,
      [id, d.atalho, d.texto],
    );
    if (!rowCount) throw AppError.naoEncontrado('Resposta rápida');
    return;
  }
  await db.query(
    `INSERT INTO comercial.respostas_rapidas (conta_id, atalho, texto) VALUES (${contaSql()}, $1, $2)`,
    [d.atalho, d.texto],
  );
}

export async function apagarResposta(db: Executor, id: number) {
  await db.query(`DELETE FROM comercial.respostas_rapidas WHERE id = $1 AND conta_id = ${contaSql()}`, [id]);
}
