import type { Executor, Pool } from '@prospeccao/db';
import {
  AppError,
  type ContatoLeadAtualizar,
  type ContatoLeadEntrada,
  type IndicacaoAchada,
  normalizarTelefone,
  type VincularEntrada,
} from '@prospeccao/shared';
import { contaSql, usuarioAtual } from '../../contexto.js';

/**
 * Contatos da negociação: as pessoas que a equipe conheceu conversando com a empresa (quem atendeu,
 * quem essa pessoa indicou, até chegar a quem decide). Um card só por empresa: os contatos e as
 * mensagens de todos eles ficam no mesmo lead.
 */

/** Mesmo número: DDD + 8 últimos dígitos (o 9 do celular às vezes vem, às vezes não). */
export const mesmoNumero = (coluna: string, param: string) =>
  `(left(${coluna}, 2) = left(${param}, 2) AND right(${coluna}, 8) = right(${param}, 8))`;

export interface ContatoLead {
  id: number;
  nome: string;
  cargo: string | null;
  telefone: string | null;
  email: string | null;
  indicadoPorId: number | null;
  indicadoPorNome: string | null;
  indicadoPorTexto: string | null;
  decisor: boolean;
  status: 'sugerido' | 'confirmado';
  origem: 'manual' | 'ia' | 'nao_identificado';
  evidencia: string | null;
  criadoEm: string;
  criadoPorNome: string | null;
  /** Mensagens trocadas com este número. */
  mensagens: number;
}

export async function listar(db: Executor, empresaId: number): Promise<ContatoLead[]> {
  const C = contaSql();
  const { rows } = await db.query<ContatoLead>(
    `SELECT cl.id::int, cl.nome, cl.cargo, cl.telefone, cl.email, cl.indicado_por_id::int AS "indicadoPorId",
            ip.nome AS "indicadoPorNome", cl.indicado_por_texto AS "indicadoPorTexto", cl.decisor, cl.status,
            cl.origem, cl.evidencia, cl.criado_em AS "criadoEm", u.nome AS "criadoPorNome",
            (SELECT count(*)::int FROM comercial.mensagens m
              WHERE m.conta_id = cl.conta_id AND m.empresa_id = cl.empresa_id AND m.contato_id = cl.id) AS mensagens
       FROM comercial.contatos_lead cl
       LEFT JOIN comercial.contatos_lead ip ON ip.id = cl.indicado_por_id
       LEFT JOIN cadastro.usuarios u ON u.id = cl.criado_por
      WHERE cl.conta_id = ${C} AND cl.empresa_id = $1
      ORDER BY cl.status DESC, cl.criado_em, cl.id`,
    [empresaId],
  );
  return rows;
}

export interface OpcaoEnvio {
  telefone: string;
  nome: string;
  detalhe: string | null;
  tipo: 'empresa' | 'contato';
  contatoId: number | null;
  whatsapp: boolean | null;
}

/**
 * Números para o "enviar para": os da empresa (enriquecimento, com WhatsApp ou o principal) e os
 * contatos da negociação. Número marcado como errado fica de fora.
 */
export async function opcoesDeEnvio(db: Executor, empresaId: number): Promise<OpcaoEnvio[]> {
  const C = contaSql();
  const { rows } = await db.query<OpcaoEnvio & { ordem: number }>(
    `SELECT * FROM (
       SELECT DISTINCT ON (c.valor) c.valor AS telefone,
              coalesce(p.nome, CASE WHEN c.canal = 'whatsapp' THEN 'WhatsApp da empresa' ELSE 'Telefone da empresa' END) AS nome,
              coalesce(p.cargo, c.rotulo) AS detalhe, 'empresa' AS tipo, NULL::int AS "contatoId",
              CASE WHEN c.canal = 'whatsapp' THEN true ELSE c.whatsapp END AS whatsapp,
              (CASE WHEN c.principal THEN 0 ELSE 1 END) AS ordem
         FROM enriquecimento.contatos c
         LEFT JOIN enriquecimento.pessoas p ON p.id = c.pessoa_id
        WHERE c.empresa_id = $1 AND c.status <> 'invalido'
          AND (c.canal = 'whatsapp' OR (c.canal = 'telefone' AND (c.whatsapp IS NOT FALSE)))
          AND NOT EXISTS (SELECT 1 FROM comercial.feedback f WHERE f.empresa_id = c.empresa_id
                           AND f.tipo = 'numero_errado' AND f.valor = c.valor)
        ORDER BY c.valor, c.principal DESC
     ) e
     UNION ALL
     SELECT cl.telefone, cl.nome, cl.cargo, 'contato', cl.id::int, NULL, 2
       FROM comercial.contatos_lead cl
      WHERE cl.conta_id = ${C} AND cl.empresa_id = $1 AND cl.status = 'confirmado' AND cl.telefone IS NOT NULL
     ORDER BY ordem, whatsapp DESC NULLS LAST
     LIMIT 20`,
    [empresaId],
  );
  // O mesmo número na empresa e num contato: vale o contato (tem nome e cargo).
  const porNumero = new Map<string, OpcaoEnvio>();
  for (const { ordem: _o, ...r } of rows) {
    const chave = `${r.telefone.slice(0, 2)}${r.telefone.slice(-8)}`;
    const atual = porNumero.get(chave);
    if (!atual || r.tipo === 'contato') porNumero.set(chave, r);
  }
  return [...porNumero.values()];
}

async function exigirLead(db: Executor, empresaId: number) {
  const { rows } = await db.query(
    `SELECT 1 FROM comercial.oportunidades WHERE conta_id = ${contaSql()} AND empresa_id = $1`,
    [empresaId],
  );
  if (!rows.length) throw AppError.naoEncontrado('Lead no funil');
}

async function exigirIndicadoPor(
  db: Executor,
  empresaId: number,
  id: number | null | undefined,
  eu?: number,
) {
  if (!id) return;
  if (id === eu) throw AppError.invalido('Um contato não pode ter sido indicado por ele mesmo.');
  const { rows } = await db.query(
    `SELECT 1 FROM comercial.contatos_lead WHERE id = $1 AND conta_id = ${contaSql()} AND empresa_id = $2`,
    [id, empresaId],
  );
  if (!rows.length) throw AppError.invalido('Quem indicou precisa ser um contato desta mesma empresa.');
}

/** Um decisor por negociação: marcar um desmarca os outros. */
async function marcarDecisor(db: Executor, empresaId: number, id: number) {
  await db.query(
    `UPDATE comercial.contatos_lead SET decisor = (id = $2)
      WHERE conta_id = ${contaSql()} AND empresa_id = $1 AND (decisor OR id = $2)`,
    [empresaId, id],
  );
}

export async function definirDestino(db: Executor, empresaId: number, telefone: string | null) {
  await db.query(
    `UPDATE comercial.oportunidades SET whatsapp_destino = $2 WHERE conta_id = ${contaSql()} AND empresa_id = $1`,
    [empresaId, telefone],
  );
}

/** Contato com o mesmo número já existe neste lead? */
async function porNumero(db: Executor, empresaId: number, telefone: string) {
  const { rows } = await db.query<{ id: number; nome: string; status: string }>(
    `SELECT id::int, nome, status FROM comercial.contatos_lead
      WHERE conta_id = ${contaSql()} AND empresa_id = $1 AND telefone IS NOT NULL AND ${mesmoNumero('telefone', '$2')}
      LIMIT 1`,
    [empresaId, telefone],
  );
  return rows[0] ?? null;
}

/** Mensagens já trocadas com o número passam a mostrar o nome do contato. */
async function ligarMensagens(db: Executor, empresaId: number, id: number, telefone: string | null) {
  if (!telefone) return;
  await db.query(
    `UPDATE comercial.mensagens SET contato_id = $2
      WHERE conta_id = ${contaSql()} AND empresa_id = $1 AND telefone IS NOT NULL AND ${mesmoNumero('telefone', '$3')}`,
    [empresaId, id, telefone],
  );
}

export async function criar(
  db: Executor,
  empresaId: number,
  d: ContatoLeadEntrada & { origem?: 'manual' | 'nao_identificado' },
): Promise<number> {
  await exigirLead(db, empresaId);
  await exigirIndicadoPor(db, empresaId, d.indicadoPorId);
  if (d.telefone) {
    const existe = await porNumero(db, empresaId, d.telefone);
    if (existe?.status === 'confirmado')
      throw AppError.invalido(`Este número já está nos contatos deste lead (${existe.nome}).`);
    // Era uma sugestão: confirma com os dados que a pessoa preencheu.
    if (existe) {
      await atualizar(db, empresaId, existe.id, { ...d, email: d.email || null, confirmar: true });
      return existe.id;
    }
  }
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO comercial.contatos_lead
       (conta_id, empresa_id, nome, cargo, telefone, email, indicado_por_id, indicado_por_texto, origem, criado_por)
     VALUES (${contaSql()}, $1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id::int`,
    [
      empresaId,
      d.nome,
      d.cargo || null,
      d.telefone ?? null,
      d.email || null,
      d.indicadoPorId ?? null,
      d.indicadoPorId ? null : d.indicadoPorTexto || null,
      d.origem ?? 'manual',
      usuarioAtual()?.id ?? null,
    ],
  );
  const id = rows[0]!.id;
  if (d.decisor) await marcarDecisor(db, empresaId, id);
  if (d.conversarCom && d.telefone) await definirDestino(db, empresaId, d.telefone);
  await ligarMensagens(db, empresaId, id, d.telefone ?? null);
  return id;
}

export async function atualizar(db: Executor, empresaId: number, id: number, d: ContatoLeadAtualizar) {
  const C = contaSql();
  const { rows } = await db.query<{ telefone: string | null; email: string | null }>(
    `SELECT telefone, email FROM comercial.contatos_lead WHERE id = $1 AND conta_id = ${C} AND empresa_id = $2`,
    [id, empresaId],
  );
  const atual = rows[0];
  if (!atual) throw AppError.naoEncontrado('Contato');
  await exigirIndicadoPor(db, empresaId, d.indicadoPorId, id);
  if (d.telefone) {
    const outro = await porNumero(db, empresaId, d.telefone);
    if (outro && outro.id !== id)
      throw AppError.invalido(`Este número já está nos contatos deste lead (${outro.nome}).`);
  }
  const telefone = d.telefone === undefined ? atual.telefone : d.telefone;
  const email = d.email === undefined ? atual.email : d.email || null;
  if (!telefone && !email) throw AppError.invalido('Informe o telefone ou o e-mail.');
  const sets: string[] = [];
  const valores: unknown[] = [id];
  const set = (coluna: string, v: unknown) => {
    valores.push(v);
    sets.push(`${coluna} = $${valores.length}`);
  };
  if (d.nome !== undefined) set('nome', d.nome);
  if (d.cargo !== undefined) set('cargo', d.cargo || null);
  if (d.telefone !== undefined) set('telefone', d.telefone);
  if (d.email !== undefined) set('email', d.email || null);
  if (d.indicadoPorId !== undefined) {
    set('indicado_por_id', d.indicadoPorId);
    if (d.indicadoPorId) set('indicado_por_texto', null);
  }
  if (d.indicadoPorTexto !== undefined && !d.indicadoPorId)
    set('indicado_por_texto', d.indicadoPorTexto || null);
  if (d.decisor === false) set('decisor', false);
  if (d.confirmar) {
    set('status', 'confirmado');
    set('criado_por', usuarioAtual()?.id ?? null);
  }
  if (sets.length)
    await db.query(
      `UPDATE comercial.contatos_lead SET ${sets.join(', ')} WHERE id = $1 AND conta_id = ${C}`,
      valores,
    );
  if (d.decisor) await marcarDecisor(db, empresaId, id);
  if (d.conversarCom && telefone) await definirDestino(db, empresaId, telefone);
  await ligarMensagens(db, empresaId, id, telefone);
}

/** Remove o contato (ou descarta a sugestão). Se a conversa seguia com ele, volta para a empresa. */
export async function remover(db: Executor, empresaId: number, id: number) {
  const C = contaSql();
  const { rows } = await db.query<{ telefone: string | null }>(
    `DELETE FROM comercial.contatos_lead WHERE id = $1 AND conta_id = ${C} AND empresa_id = $2 RETURNING telefone`,
    [id, empresaId],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Contato');
  const tel = rows[0].telefone;
  if (tel)
    await db.query(
      `UPDATE comercial.oportunidades SET whatsapp_destino = NULL
        WHERE conta_id = ${C} AND empresa_id = $1 AND whatsapp_destino IS NOT NULL AND ${mesmoNumero('whatsapp_destino', '$2')}`,
      [empresaId, tel],
    );
}

/**
 * Sugestões tiradas de uma mensagem (cartão de contato ou telefone no texto). Número que já é da
 * empresa ou já está nos contatos não vira sugestão. Devolve quantas foram criadas.
 */
export async function sugerir(
  db: Executor,
  empresaId: number,
  achadas: IndicacaoAchada[],
  mensagemId: number | null,
  indicadoPorId: number | null,
): Promise<number> {
  let n = 0;
  for (const a of achadas.slice(0, 5)) {
    const { rows } = await db.query(
      `SELECT 1 FROM comercial.contatos_lead
        WHERE conta_id = ${contaSql()} AND empresa_id = $1 AND telefone IS NOT NULL AND ${mesmoNumero('telefone', '$2')}
       UNION ALL
       SELECT 1 FROM enriquecimento.contatos
        WHERE empresa_id = $1 AND canal IN ('whatsapp', 'telefone') AND ${mesmoNumero('valor', '$2')}
       LIMIT 1`,
      [empresaId, a.telefone],
    );
    if (rows.length) continue;
    await db.query(
      `INSERT INTO comercial.contatos_lead
         (conta_id, empresa_id, nome, cargo, telefone, indicado_por_id, status, origem, evidencia, mensagem_id)
       VALUES (${contaSql()}, $1, $2, $3, $4, $5, 'sugerido', 'ia', $6, $7)
       ON CONFLICT DO NOTHING`,
      [
        empresaId,
        a.nome ?? (a.cargo ? `Contato de ${a.cargo.toLowerCase()}` : 'Contato indicado'),
        a.cargo,
        a.telefone,
        indicadoPorId,
        a.evidencia,
        mensagemId,
      ],
    );
    n++;
  }
  return n;
}

/* ───────────── Mensagens de números que não são de nenhum lead ───────────── */

export async function guardarNaoIdentificada(
  db: Executor,
  m: {
    telefone: string;
    nome: string | null;
    deMim: boolean;
    texto: string;
    midiaTipo: string | null;
    idExterno: string | null;
    chipId: number | null;
    em: string;
  },
): Promise<{ primeira: boolean }> {
  const C = contaSql();
  const { rows: antes } = await db.query(
    `SELECT 1 FROM comercial.nao_identificadas
      WHERE conta_id = ${C} AND resolvida_em IS NULL AND ${mesmoNumero('telefone', '$1')} LIMIT 1`,
    [m.telefone],
  );
  await db.query(
    `INSERT INTO comercial.nao_identificadas
       (conta_id, telefone, nome, direcao, texto, midia_tipo, id_externo, chip_id, recebida_em)
     VALUES (${C}, $1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (conta_id, id_externo) WHERE id_externo IS NOT NULL DO NOTHING`,
    [
      m.telefone,
      m.deMim ? null : m.nome,
      m.deMim ? 'enviada' : 'recebida',
      m.texto,
      m.midiaTipo,
      m.idExterno,
      m.chipId,
      m.em,
    ],
  );
  return { primeira: !antes.length };
}

export interface NaoIdentificado {
  telefone: string;
  nome: string | null;
  ultima: string;
  ultimaDirecao: 'enviada' | 'recebida';
  ultimaEm: string;
  quantidade: number;
  mensagens: {
    id: number;
    direcao: 'enviada' | 'recebida';
    texto: string;
    midiaTipo: string | null;
    em: string;
  }[];
  /** Este número já foi indicado numa conversa: o lead provável. */
  indicadoEm: {
    empresaId: number;
    empresa: string;
    contatoId: number;
    contatoNome: string;
    indicadoPorId: number | null;
  } | null;
}

export async function listarNaoIdentificados(db: Executor): Promise<NaoIdentificado[]> {
  const { rows } = await db.query<NaoIdentificado>(
    `SELECT n.telefone,
            (SELECT x.nome FROM comercial.nao_identificadas x
              WHERE x.conta_id = n.conta_id AND x.telefone = n.telefone AND x.resolvida_em IS NULL AND x.nome IS NOT NULL
              ORDER BY x.recebida_em DESC LIMIT 1) AS nome,
            (array_agg(n.texto ORDER BY n.recebida_em DESC))[1] AS ultima,
            (array_agg(n.direcao ORDER BY n.recebida_em DESC))[1] AS "ultimaDirecao",
            max(n.recebida_em) AS "ultimaEm", count(*)::int AS quantidade,
            json_agg(json_build_object('id', n.id, 'direcao', n.direcao, 'texto', n.texto,
                                       'midiaTipo', n.midia_tipo, 'em', n.recebida_em)
                     ORDER BY n.recebida_em) AS mensagens,
            (SELECT json_build_object('empresaId', cl.empresa_id, 'empresa', e.nome, 'contatoId', cl.id,
                                      'contatoNome', cl.nome, 'indicadoPorId', cl.indicado_por_id)
               FROM comercial.contatos_lead cl JOIN descoberta.empresas e ON e.id = cl.empresa_id
              WHERE cl.conta_id = n.conta_id AND cl.telefone IS NOT NULL
                AND ${mesmoNumero('cl.telefone', 'n.telefone')}
              ORDER BY cl.criado_em DESC LIMIT 1) AS "indicadoEm"
       FROM comercial.nao_identificadas n
      WHERE n.conta_id = ${contaSql()} AND n.resolvida_em IS NULL
      GROUP BY n.conta_id, n.telefone
      ORDER BY max(n.recebida_em) DESC
      LIMIT 200`,
  );
  return rows;
}

export async function contarNaoIdentificados(db: Executor): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(DISTINCT telefone)::int AS n FROM comercial.nao_identificadas
      WHERE conta_id = ${contaSql()} AND resolvida_em IS NULL AND direcao = 'recebida'`,
  );
  return rows[0]?.n ?? 0;
}

/**
 * Vincula o número a um lead: vira contato da negociação, as mensagens passam para a conversa do
 * lead (na ordem em que aconteceram) e a conversa segue com ele. Devolve quantas mensagens recebidas
 * vieram (para a etapa andar e a sequência parar, como em qualquer resposta).
 */
export async function vincular(
  pool: Pool,
  telefone: string,
  d: VincularEntrada,
): Promise<{ contatoId: number; recebidas: number; ultimaRecebida: string | null }> {
  const C = contaSql();
  const tel = normalizarTelefone(telefone) ?? telefone.replace(/\D/g, '');
  const { rows: abertas } = await pool.query<{
    id: number;
    direcao: 'enviada' | 'recebida';
    texto: string;
    midia_tipo: string | null;
    id_externo: string | null;
    chip_id: number | null;
    recebida_em: string;
  }>(
    `SELECT id::int, direcao, texto, midia_tipo, id_externo, chip_id::int, recebida_em
       FROM comercial.nao_identificadas
      WHERE conta_id = ${C} AND resolvida_em IS NULL AND ${mesmoNumero('telefone', '$1')}
      ORDER BY recebida_em`,
    [tel],
  );
  if (!abertas.length) throw AppError.naoEncontrado('Conversa sem identificação');
  const contatoId = await criar(pool, d.empresaId, {
    nome: d.nome,
    cargo: d.cargo,
    telefone: tel,
    indicadoPorId: d.indicadoPorId,
    indicadoPorTexto: d.indicadoPorTexto,
    conversarCom: d.conversarCom,
    origem: 'nao_identificado',
  });
  for (const m of abertas) {
    await pool.query(
      `INSERT INTO comercial.mensagens
         (conta_id, empresa_id, direcao, texto, telefone, status, origem, id_externo, enviado_em, criado_em,
          midia_tipo, chip_id, contato_id, lida_em)
       VALUES (${C}, $1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, $11, CASE WHEN $2 = 'enviada' THEN now() END)
       ON CONFLICT (conta_id, id_externo) WHERE id_externo IS NOT NULL DO NOTHING`,
      [
        d.empresaId,
        m.direcao,
        m.texto,
        tel,
        m.direcao === 'enviada' ? 'enviada' : 'recebida',
        m.direcao === 'enviada' ? 'humano' : 'lead',
        m.id_externo,
        m.recebida_em,
        m.midia_tipo,
        m.chip_id,
        contatoId,
      ],
    );
  }
  await pool.query(
    `UPDATE comercial.nao_identificadas SET resolvida_em = now(), empresa_id = $2
      WHERE conta_id = ${C} AND resolvida_em IS NULL AND ${mesmoNumero('telefone', '$1')}`,
    [tel, d.empresaId],
  );
  const recebidas = abertas.filter((m) => m.direcao === 'recebida');
  return { contatoId, recebidas: recebidas.length, ultimaRecebida: recebidas.at(-1)?.texto ?? null };
}

export async function descartarNaoIdentificado(db: Executor, telefone: string) {
  const { rowCount } = await db.query(
    `UPDATE comercial.nao_identificadas SET resolvida_em = now(), descartada = true
      WHERE conta_id = ${contaSql()} AND resolvida_em IS NULL AND ${mesmoNumero('telefone', '$1')}`,
    [telefone.replace(/\D/g, '')],
  );
  if (!rowCount) throw AppError.naoEncontrado('Conversa sem identificação');
}

/** Leads do funil pelo nome da empresa, de um contato ou pelo telefone (para vincular um número). */
export async function buscarLeads(db: Executor, busca: string) {
  const C = contaSql();
  const digitos = busca.replace(/\D/g, '');
  const { rows } = await db.query(
    `SELECT o.empresa_id::int AS "empresaId", e.nome, e.cidade, coalesce(et.nome, o.etapa) AS etapa
       FROM comercial.oportunidades o
       JOIN descoberta.empresas e ON e.id = o.empresa_id
       LEFT JOIN comercial.etapas et ON et.id = o.etapa_id
      WHERE o.conta_id = ${C} AND o.etapa <> 'descartado'
        AND (e.nome ILIKE $1 OR e.razao_social ILIKE $1
             OR ($2 <> '' AND (e.maps_telefone LIKE $2
                  OR EXISTS (SELECT 1 FROM enriquecimento.contatos c WHERE c.empresa_id = o.empresa_id AND c.valor LIKE $2)))
             OR EXISTS (SELECT 1 FROM comercial.contatos_lead cl WHERE cl.conta_id = o.conta_id AND cl.empresa_id = o.empresa_id
                         AND (cl.nome ILIKE $1 OR ($2 <> '' AND cl.telefone LIKE $2))))
      ORDER BY o.atualizado_em DESC
      LIMIT 10`,
    [`%${busca}%`, digitos.length >= 4 ? `%${digitos}%` : ''],
  );
  return rows as { empresaId: number; nome: string; cidade: string | null; etapa: string }[];
}
