import type { Executor } from '@prospeccao/db';
import { AppError, LIMITE_MIDIA_BYTES, type MidiaEntrada } from '@prospeccao/shared';
import { usuarioAtual } from '../../contexto.js';
import type { DepsApi } from '../../dependencias.js';
import * as agente from '../agente/repositorio.js';
import { dadosDoLead } from '../funil/cadencia.js';
import * as funil from '../funil/repositorio.js';
import { lerAvisosDoLead } from '../notificacoes/repositorio.js';

/**
 * Caixa de entrada do WhatsApp. A conversa junta as mensagens do sistema (IA, cadência, você
 * pela tela, o lead pelo webhook) e o que foi registrado à mão como contato de WhatsApp.
 */

/** Tudo de WhatsApp de um lead, sem repetir o que aparece nos dois lugares. */
const CONVERSA = `
  SELECT m.empresa_id, 'm' || m.id AS id, m.direcao, m.texto, m.status, m.origem, m.erro, m.nota,
         m.midia_tipo, m.midia_id, coalesce(m.enviado_em, m.criado_em) AS em, m.usuario_id
    FROM comercial.mensagens m
   WHERE m.status <> 'descartada'
  UNION ALL
  SELECT a.empresa_id, 'a' || a.id, a.direcao, a.texto, 'registrada', 'registro', NULL, NULL,
         NULL, NULL, a.criado_em, a.usuario_id
    FROM comercial.atividades a
   WHERE a.tipo = 'whatsapp' AND a.direcao IS NOT NULL AND a.texto IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM comercial.mensagens m
                      WHERE m.empresa_id = a.empresa_id AND m.direcao = a.direcao AND m.texto = a.texto
                        AND abs(extract(epoch FROM coalesce(m.enviado_em, m.criado_em) - a.criado_em)) < 600)`;

export async function listar(
  db: Executor,
  f: { filtro: 'todas' | 'nao_lidas' | 'minhas'; busca?: string },
  usuarioId: number,
) {
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
      `(e.nome ILIKE ${p(`%${f.busca}%`)} OR e.maps_telefone LIKE ${p(`%${f.busca.replace(/\D/g, '') || '§'}%`)})`,
    );
  const { rows } = await db.query(
    `WITH c AS (${CONVERSA}),
     ult AS (
       SELECT DISTINCT ON (empresa_id) empresa_id, texto, direcao, em, midia_tipo, status, origem
         FROM c ORDER BY empresa_id, em DESC)
     SELECT ult.empresa_id::int AS "empresaId", e.nome, e.cidade, o.etapa, et.nome AS "etapaNome",
            et.cor AS "etapaCor", o.responsavel_id AS "responsavelId", u.nome AS "responsavelNome",
            o.agente, o.agente_pausa AS "agentePausa", ult.texto AS "ultima", ult.direcao AS "ultimaDirecao",
            ult.em AS "ultimaEm", ult.midia_tipo AS "ultimaMidia", ult.origem AS "ultimaOrigem",
            coalesce(nl.n, 0) AS "naoLidas"
       FROM ult
       JOIN comercial.oportunidades o ON o.empresa_id = ult.empresa_id
       JOIN descoberta.empresas e ON e.id = ult.empresa_id
       LEFT JOIN comercial.etapas et ON et.id = o.etapa_id
       LEFT JOIN cadastro.usuarios u ON u.id = o.responsavel_id
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS n FROM comercial.mensagens m
          WHERE m.empresa_id = ult.empresa_id AND m.direcao = 'recebida' AND m.lida_em IS NULL) nl ON true
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
      `WITH c AS (${CONVERSA})
       SELECT c.id, c.direcao, c.texto, c.status, c.origem, c.erro, c.nota, c.midia_tipo AS "midiaTipo",
              c.midia_id::int AS "midiaId", c.em,
              CASE WHEN c.origem = 'agente' THEN 'IA'
                   WHEN c.origem = 'cadencia' THEN coalesce(u.nome, 'Cadência')
                   WHEN c.direcao = 'recebida' THEN NULL
                   ELSE coalesce(u.nome, 'Você') END AS autor
         FROM c LEFT JOIN cadastro.usuarios u ON u.id = c.usuario_id
        WHERE c.empresa_id = $1
        ORDER BY c.em, c.id
        LIMIT 1000`,
      [empresaId],
    ),
  ]);
  const { rows: info } = await db.query(
    `SELECT e.nome, e.cidade, o.etapa, et.nome AS "etapaNome", et.cor AS "etapaCor",
            o.responsavel_id AS "responsavelId", u.nome AS "responsavelNome",
            o.agente, o.agente_pausa AS "agentePausa"
       FROM comercial.oportunidades o
       JOIN descoberta.empresas e ON e.id = o.empresa_id
       LEFT JOIN comercial.etapas et ON et.id = o.etapa_id
       LEFT JOIN cadastro.usuarios u ON u.id = o.responsavel_id
      WHERE o.empresa_id = $1`,
    [empresaId],
  );
  return {
    empresaId,
    ...info[0],
    telefone: lead.telefone,
    variaveis: lead.variaveis,
    mensagens: msgs.rows,
  };
}

export async function marcarLidas(db: Executor, empresaId: number): Promise<void> {
  await db.query(
    `UPDATE comercial.mensagens SET lida_em = now()
      WHERE empresa_id = $1 AND direcao = 'recebida' AND lida_em IS NULL`,
    [empresaId],
  );
  const u = usuarioAtual();
  if (u) await lerAvisosDoLead(db, u.id, empresaId);
}

/** Você assumiu a conversa: a IA para de responder este lead (dá para devolver na ficha). */
async function assumir(db: Executor, empresaId: number) {
  await db.query(
    `UPDATE comercial.oportunidades SET agente_pausa = 'Você assumiu a conversa.'
      WHERE empresa_id = $1 AND agente AND agente_pausa IS NULL`,
    [empresaId],
  );
}

type Deps = Pick<DepsApi, 'pool' | 'whatsapp'>;

function exigirWhatsapp(deps: Deps) {
  if (!deps.whatsapp)
    throw AppError.invalido(
      'O WhatsApp não está conectado: configure a Evolution (EVOLUTION_URL, EVOLUTION_API_KEY e EVOLUTION_INSTANCIA) na API.',
    );
  return deps.whatsapp;
}

export async function enviarTexto(deps: Deps, empresaId: number, texto: string): Promise<void> {
  const whatsapp = exigirWhatsapp(deps);
  const lead = await dadosDoLead(deps.pool, empresaId);
  if (!lead.telefone) throw AppError.invalido('Este lead não tem telefone.');
  const quem = usuarioAtual();
  const r = await whatsapp.enviar(lead.telefone, texto);
  await agente.criarMensagem(deps.pool, {
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
    'INSERT INTO comercial.midias (mime, nome, tamanho, dados) VALUES ($1, $2, $3, $4) RETURNING id::int',
    [m.mime, m.nome ?? null, dados.length, dados],
  );
  return rows[0]!.id;
}

export async function enviarMidia(deps: Deps, empresaId: number, m: MidiaEntrada): Promise<void> {
  const whatsapp = exigirWhatsapp(deps);
  if (!whatsapp.enviarMidia) throw AppError.invalido('Envio de arquivos não disponível.');
  const lead = await dadosDoLead(deps.pool, empresaId);
  if (!lead.telefone) throw AppError.invalido('Este lead não tem telefone.');
  const midiaId = await guardarMidia(deps.pool, m);
  const quem = usuarioAtual();
  const r = await whatsapp.enviarMidia(lead.telefone, {
    tipo: m.tipo,
    mime: m.mime,
    base64: m.base64,
    nome: m.nome,
    legenda: m.legenda,
  });
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
    'SELECT mime, nome, dados FROM comercial.midias WHERE id = $1',
    [id],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Arquivo');
  return rows[0];
}

/** Conversas com mensagem não lida (dos seus leads; o administrador vê todas). */
export async function resumo(db: Executor, usuarioId: number | null): Promise<{ naoLidas: number }> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(DISTINCT m.empresa_id)::int AS n FROM comercial.mensagens m
       JOIN comercial.oportunidades o ON o.empresa_id = m.empresa_id
      WHERE m.direcao = 'recebida' AND m.lida_em IS NULL
        AND ($1::int IS NULL OR o.responsavel_id = $1 OR o.responsavel_id IS NULL)`,
    [usuarioId],
  );
  return { naoLidas: rows[0]?.n ?? 0 };
}

/* ───────────── Respostas rápidas ───────────── */

export async function respostas(db: Executor) {
  const { rows } = await db.query(
    'SELECT id, atalho, texto FROM comercial.respostas_rapidas ORDER BY atalho',
  );
  return rows;
}

export async function salvarResposta(db: Executor, d: { atalho: string; texto: string }, id?: number) {
  if (id) {
    const { rowCount } = await db.query(
      'UPDATE comercial.respostas_rapidas SET atalho = $2, texto = $3 WHERE id = $1',
      [id, d.atalho, d.texto],
    );
    if (!rowCount) throw AppError.naoEncontrado('Resposta rápida');
    return;
  }
  await db.query('INSERT INTO comercial.respostas_rapidas (atalho, texto) VALUES ($1, $2)', [
    d.atalho,
    d.texto,
  ]);
}

export async function apagarResposta(db: Executor, id: number) {
  await db.query('DELETE FROM comercial.respostas_rapidas WHERE id = $1', [id]);
}
