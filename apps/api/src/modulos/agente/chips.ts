import type { Executor } from '@prospeccao/db';
import type { ConversaExistente } from '@prospeccao/integrations/whatsapp';
import { AppError } from '@prospeccao/shared';
import { conta, contaSql, usuarioAtual } from '../../contexto.js';
import { numerosDeWhatsapp } from '../../recursos.js';
import * as alertas from '../alertas/repositorio.js';
import { definirResponsavel } from '../equipe/repositorio.js';
import { HOJE_SP } from './repositorio.js';

/**
 * Chips de WhatsApp da conta: cada um é um número conectado pelo próprio cliente (instância da
 * Z-API, lida pelo QR Code). Cada chip tem o seu limite de mensagens automáticas por dia e o seu
 * intervalo; o lead novo vai para o chip menos usado hoje e, depois, conversa sempre pelo mesmo
 * (é o número que ele conhece).
 */

export interface Chip {
  id: number | null;
  nome: string;
  instancia: string;
  /** null: usa o limite do dia do agente. */
  limiteDia: number | null;
  /** Teto de hoje pelo aquecimento do número (chip novo manda pouco e vai subindo); null: sem teto. */
  tetoAquecimento?: number | null;
}

/** Mensagens automáticas (IA, cadência, sequência). */
export const ORIGENS_AUTOMATICAS = `('agente', 'cadencia', 'sequencia')`;
/** Mensagens frias (o lead não escreveu antes): as que contam no limite, no intervalo e no aquecimento. */
export const ORIGENS_FRIAS = `('cadencia', 'sequencia')`;

/**
 * Aquecimento: número novo que dispara muito é banido. Teto de mensagens frias por dia conforme a
 * idade do número; depois de 31 dias vale só o limite do chip.
 */
export function tetoDeAquecimento(diasDeUso: number): number | null {
  if (diasDeUso < 4) return 10;
  if (diasDeUso < 8) return 20;
  if (diasDeUso < 15) return 40;
  if (diasDeUso < 31) return 80;
  return null;
}

/**
 * Intervalo com variação: entre uma mensagem fria e outra, o intervalo do agente mais 0 a 60% (o
 * WhatsApp desconfia de envios em ritmo de relógio). A variação sai da hora do último envio, então
 * é a mesma em todas as rodadas do motor.
 */
export function proximoEnvioPermitido(ultimaMs: number, intervaloSeg: number): number {
  if (!ultimaMs) return 0;
  const variacao = (Math.floor(ultimaMs / 1000) % 997) / 997; // 0..1, estável para o mesmo envio
  return ultimaMs + intervaloSeg * 1000 * (1 + 0.6 * variacao);
}

const diasDesde = (data: string | Date) => Math.floor((Date.now() - new Date(data).getTime()) / 86_400_000);

export async function listar(db: Executor) {
  const C = contaSql();
  const { rows } = await db.query(
    `SELECT c.id, c.nome, c.instancia, c.ativo, c.limite_dia AS "limiteDia", c.estado, c.estado_em AS "estadoEm",
            c.aquecer, c.ativado_em AS "ativadoEm", c.numero, c.provedor,
            c.usuario_id AS "usuarioId", (SELECT u.nome FROM cadastro.usuarios u WHERE u.id = c.usuario_id) AS "usuarioNome",
            c.uso_diario AS "usoDiario", c.contato_novo AS "contatoNovo", c.contatos_lidos_em AS "contatosLidosEm",
            c.contatos_leitura AS "contatosLeitura",
            (SELECT count(*)::int FROM comercial.contatos_antigos a WHERE a.chip_id = c.id AND a.trazido_em IS NULL) AS "contatosDeAntes",
            c.token_cifrado IS NOT NULL AS conectavel,
            CASE WHEN c.pausado_ate > now() THEN c.pausado_ate END AS "pausadoAte", c.pausa_motivo AS "pausaMotivo",
            (SELECT count(*)::int FROM comercial.mensagens m
              WHERE m.chip_id = c.id AND m.status = 'enviada' AND m.origem IN ${ORIGENS_FRIAS}
                AND m.enviado_em >= ${HOJE_SP}) AS "enviadosHoje",
            (SELECT count(*)::int FROM comercial.mensagens m
              WHERE m.chip_id = c.id AND m.status = 'enviada' AND m.origem = 'agente'
                AND m.enviado_em >= ${HOJE_SP}) AS "respostasHoje",
            (SELECT count(*)::int FROM comercial.oportunidades o WHERE o.conta_id = c.conta_id AND o.chip_id = c.id) AS leads
       FROM comercial.chips c WHERE c.conta_id = ${C} ORDER BY c.id`,
  );
  return rows.map((r) => ({
    ...r,
    diasDeUso: diasDesde(r.ativadoEm),
    tetoAquecimento: r.aquecer ? tetoDeAquecimento(diasDesde(r.ativadoEm)) : null,
  }));
}

/** Chips em uso: os conectados pela Z-API (com token), ativos e fora de pausa. */
export async function emUso(
  db: Executor,
  _whatsapp?: unknown,
  incluirDesconectados = false,
): Promise<Chip[]> {
  const { rows } = await db.query<{
    id: number;
    nome: string;
    instancia: string;
    limite_dia: number;
    aquecer: boolean;
    ativado_em: string;
  }>(
    `SELECT id, nome, instancia, limite_dia, aquecer, ativado_em
       FROM comercial.chips
      WHERE conta_id = ${contaSql()} AND ativo AND token_cifrado IS NOT NULL
        AND (pausado_ate IS NULL OR pausado_ate <= now())
        AND ($1 OR estado IS NULL OR estado NOT LIKE 'desconectado%')
      ORDER BY id`,
    [incluirDesconectados],
  );
  return rows.map((r) => ({
    id: r.id,
    nome: r.nome,
    instancia: r.instancia,
    limiteDia: r.limite_dia,
    tetoAquecimento: r.aquecer ? tetoDeAquecimento(diasDesde(r.ativado_em)) : null,
  }));
}

/** Chip pela instância que mandou o webhook (com vários chips, diz por qual número o lead escreveu). */
export async function porInstancia(db: Executor, instancia: string | null): Promise<number | null> {
  if (!instancia) return null;
  const { rows } = await db.query<{ id: number }>(
    `SELECT id FROM comercial.chips WHERE conta_id = ${contaSql()} AND lower(instancia) = lower($1)`,
    [instancia],
  );
  return rows[0]?.id ?? null;
}

/** Uso de hoje de cada chip: quantas frias saíram e quando foi a última (fria ou resposta). */
async function usoDeHoje(db: Executor) {
  const { rows } = await db.query<{ chip_id: number | null; hoje: number; ultima: string | null }>(
    `SELECT chip_id, count(*) FILTER (WHERE enviado_em >= ${HOJE_SP} AND origem IN ${ORIGENS_FRIAS})::int AS hoje,
            max(enviado_em) FILTER (WHERE origem IN ${ORIGENS_FRIAS}) AS ultima
       FROM comercial.mensagens
      WHERE conta_id = ${contaSql()} AND status = 'enviada' AND origem IN ${ORIGENS_AUTOMATICAS}
        AND enviado_em > now() - interval '2 days'
      GROUP BY chip_id`,
  );
  return new Map(
    rows.map((r) => [r.chip_id ?? 0, { hoje: r.hoje, ultima: r.ultima ? new Date(r.ultima).getTime() : 0 }]),
  );
}

/** Quantas frias o chip pode mandar hoje: o limite dele, ou o do aquecimento se for menor. */
export function limiteDeHoje(c: Chip, limiteDoAgente: number): number {
  const limite = c.limiteDia ?? limiteDoAgente;
  return c.tetoAquecimento != null ? Math.min(limite, c.tetoAquecimento) : limite;
}

/**
 * Chip para mandar uma mensagem automática a este lead agora, ou null se não dá. Mensagem fria
 * respeita o limite de hoje (com o aquecimento) e o intervalo com variação; resposta a quem
 * escreveu sai na hora pelo chip do lead (é conversa, não disparo). Lead sem chip ganha o menos
 * usado hoje.
 */
export async function chipParaAutomatica(
  db: Executor,
  empresaId: number,
  chips: Chip[],
  limites: { limiteDia: number; intervaloSeg: number },
  agora = Date.now(),
  opcoes: { resposta?: boolean } = {},
): Promise<Chip | null> {
  if (!chips.length) return null;
  const uso = await usoDeHoje(db);
  const livre = (c: Chip) => {
    if (opcoes.resposta) return true;
    const u = uso.get(c.id ?? 0) ?? { hoje: 0, ultima: 0 };
    return (
      u.hoje < limiteDeHoje(c, limites.limiteDia) &&
      agora >= proximoEnvioPermitido(u.ultima, limites.intervaloSeg)
    );
  };
  const doLead = await chipDoLead(db, empresaId);
  const dele = doLead != null ? chips.find((c) => c.id === doLead) : undefined;
  if (dele) return livre(dele) ? dele : null;
  const candidatos = chips
    .filter(livre)
    .sort((a, b) => (uso.get(a.id ?? 0)?.hoje ?? 0) - (uso.get(b.id ?? 0)?.hoje ?? 0));
  const escolhido = candidatos[0] ?? null;
  if (escolhido?.id) await fixarChip(db, empresaId, escolhido.id);
  return escolhido;
}

/** Chip para a equipe mandar à mão (sem limite): o do lead ou o primeiro em uso. */
export async function chipParaEquipe(db: Executor, empresaId: number, chips: Chip[]): Promise<Chip | null> {
  const doLead = await chipDoLead(db, empresaId);
  const dele = doLead != null ? chips.find((c) => c.id === doLead) : undefined;
  if (dele) return dele;
  // Lead sem número ainda: quem tem número próprio manda pelo dele.
  const eu = usuarioAtual()?.id;
  const meus = eu ? await chipsDoUsuario(db, eu) : [];
  const primeiro = chips.find((c) => c.id != null && meus.includes(c.id)) ?? chips[0] ?? null;
  if (primeiro?.id) await fixarChip(db, empresaId, primeiro.id);
  return primeiro;
}

async function chipsDoUsuario(db: Executor, usuarioId: number): Promise<number[]> {
  const { rows } = await db.query<{ id: number }>(
    `SELECT id FROM comercial.chips WHERE conta_id = ${contaSql()} AND usuario_id = $1`,
    [usuarioId],
  );
  return rows.map((r) => r.id);
}

/** Lead novo que chegou por um número com dono: fica com essa pessoa e segue nesse número. */
export async function entregarAoDonoDoNumero(
  db: Executor,
  empresaId: number,
  chipId: number | null,
): Promise<void> {
  if (!chipId) return;
  const { rows } = await db.query<{ usuario_id: number }>(
    `SELECT c.usuario_id FROM comercial.chips c JOIN cadastro.usuarios u ON u.id = c.usuario_id AND u.ativo
      WHERE c.id = $1 AND c.conta_id = ${contaSql()}`,
    [chipId],
  );
  await fixarChip(db, empresaId, chipId);
  if (rows[0]) await definirResponsavel(db, empresaId, rows[0].usuario_id, 'chegou pelo número dele');
}

async function chipDoLead(db: Executor, empresaId: number): Promise<number | null> {
  const { rows } = await db.query<{ chip_id: number | null }>(
    `SELECT chip_id FROM comercial.oportunidades WHERE conta_id = ${contaSql()} AND empresa_id = $1`,
    [empresaId],
  );
  return rows[0]?.chip_id ?? null;
}

export async function fixarChip(db: Executor, empresaId: number, chipId: number): Promise<void> {
  await db.query(
    `UPDATE comercial.oportunidades SET chip_id = $2
      WHERE conta_id = ${contaSql()} AND empresa_id = $1 AND chip_id IS NULL`,
    [empresaId, chipId],
  );
}

/* ───────────── Cadastro ───────────── */

export async function criar(
  db: Executor,
  d: { nome: string; instancia: string; limiteDia: number; aquecer?: boolean; diasDeUso?: number },
): Promise<number> {
  try {
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO comercial.chips (conta_id, nome, instancia, limite_dia, aquecer, ativado_em)
       VALUES (${contaSql()}, $1, $2, $3, $4, current_date - $5::int)
       RETURNING id`,
      [d.nome, d.instancia, d.limiteDia, d.aquecer ?? true, d.diasDeUso ?? 0],
    );
    return rows[0]!.id;
  } catch (erro) {
    if ((erro as { code?: string }).code === '23505')
      throw AppError.conflito('Esta instância já está cadastrada como chip desta conta.');
    throw erro;
  }
}

export async function atualizar(
  db: Executor,
  id: number,
  d: {
    nome?: string;
    ativo?: boolean;
    limiteDia?: number;
    aquecer?: boolean;
    diasDeUso?: number;
    usuarioId?: number | null;
    usoDiario?: boolean;
    contatoNovo?: 'padrao' | 'ignorar' | 'sem_lead' | 'lead';
  },
): Promise<void> {
  if (d.usoDiario !== undefined || d.contatoNovo !== undefined)
    await db.query(
      `UPDATE comercial.chips SET uso_diario = coalesce($2, uso_diario), contato_novo = coalesce($3, contato_novo)
        WHERE id = $1 AND conta_id = ${contaSql()}`,
      [id, d.usoDiario ?? null, d.contatoNovo ?? null],
    );
  if (d.usuarioId) {
    const { rowCount } = await db.query(
      `SELECT 1 FROM cadastro.usuarios WHERE id = $1 AND conta_id = ${contaSql()} AND ativo
          AND papel IN ('admin', 'sdr', 'closer')`,
      [d.usuarioId],
    );
    if (!rowCount) throw AppError.naoEncontrado('Pessoa da equipe');
  }
  if (d.usuarioId !== undefined)
    await db.query(`UPDATE comercial.chips SET usuario_id = $2 WHERE id = $1 AND conta_id = ${contaSql()}`, [
      id,
      d.usuarioId,
    ]);
  const { rowCount } = await db.query(
    `UPDATE comercial.chips SET nome = coalesce($2, nome), ativo = coalesce($3, ativo), limite_dia = coalesce($4, limite_dia),
            aquecer = coalesce($5, aquecer),
            -- reativar à mão também tira a pausa automática por falhas
            pausado_ate = CASE WHEN $3::boolean THEN NULL ELSE pausado_ate END,
            ativado_em = CASE WHEN $6::int IS NULL THEN ativado_em ELSE current_date - $6::int END
      WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id, d.nome ?? null, d.ativo ?? null, d.limiteDia ?? null, d.aquecer ?? null, d.diasDeUso ?? null],
  );
  if (!rowCount) throw AppError.naoEncontrado('Chip');
  if (d.ativo) await fecharAlertaSaude(db, id);
}

/** Apaga o chip: os leads dele passam para o próximo chip que mandar mensagem. */
export async function apagar(db: Executor, id: number): Promise<void> {
  await fecharAlertaSaude(db, id);
  const { rowCount } = await db.query(
    `DELETE FROM comercial.chips WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id],
  );
  if (!rowCount) throw AppError.naoEncontrado('Chip');
}

export interface ChipCadastro {
  id: number;
  instancia: string;
  provedor: 'zapi' | 'evolution';
  /** Tem token (instância da Z-API criada pela plataforma). */
  zapi: boolean;
  assinado: boolean;
}

export async function obter(db: Executor, id: number): Promise<ChipCadastro> {
  const { rows } = await db.query<ChipCadastro>(
    `SELECT id, instancia, provedor, token_cifrado IS NOT NULL AS zapi, assinado_em IS NOT NULL AS assinado
       FROM comercial.chips WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Chip');
  return rows[0];
}

/* ───────────── Números pela Z-API (o cliente conecta sozinho) ───────────── */

/**
 * Quantos números esta unidade pode conectar: os do plano da organização (2 com o módulo de
 * WhatsApp, mais os extras contratados), divididos entre as unidades, e o limite próprio da
 * unidade (master), se houver. Sem plano: sem limite.
 */
export async function limiteDeNumeros(db: Executor): Promise<{ limite: number | null; usados: number }> {
  const { rows } = await db.query<{ limite: number | null; usados: number }>(
    `SELECT c.limite_chips AS limite,
            (SELECT count(*)::int FROM comercial.chips h WHERE h.conta_id = c.id AND h.token_cifrado IS NOT NULL) AS usados
       FROM cadastro.contas c WHERE c.id = ${contaSql()}`,
  );
  const daConta = rows[0] ?? { limite: null, usados: 0 };
  const org = await numerosDeWhatsapp(db);
  const daOrganizacao = org.limite == null ? null : daConta.usados + Math.max(0, org.limite - org.usados);
  const limites = [daConta.limite, daOrganizacao].filter((x): x is number => x != null);
  return { limite: limites.length ? Math.min(...limites) : null, usados: daConta.usados };
}

/** Número novo: a instância já criada na Z-API, com o token cifrado. Começa aquecendo. */
export async function criarNumero(
  db: Executor,
  d: { nome: string; instancia: string; tokenCifrado: string; limiteDia?: number },
): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO comercial.chips (conta_id, nome, instancia, token_cifrado, provedor, limite_dia, aquecer, ativado_em,
                                  estado, estado_em)
     VALUES (${contaSql()}, $1, $2, $3, 'zapi', $4, true, current_date, 'desconectado: leia o QR Code para conectar', now())
     RETURNING id`,
    [d.nome, d.instancia, d.tokenCifrado, d.limiteDia ?? 40],
  );
  return rows[0]!.id;
}

/**
 * Conexão do número mudou (webhook da Z-API ou a tela conferindo). Conectou: guarda o número e
 * devolve se ainda falta assinar a instância (a assinatura é feita na primeira conexão).
 */
export async function marcarConexao(
  db: Executor,
  chip: { id?: number; instancia?: string },
  conectado: boolean,
  numero?: string | null,
): Promise<{ id: number; instancia: string; assinar: boolean } | null> {
  const { rows } = await db.query<{ id: number; instancia: string; assinar: boolean }>(
    `UPDATE comercial.chips
        SET estado = CASE WHEN $3 THEN 'ok (WhatsApp conectado)' ELSE 'desconectado: leia o QR Code para conectar' END,
            estado_em = now(),
            numero = CASE WHEN $3 THEN coalesce($4, numero) ELSE numero END,
            ativo = CASE WHEN $3 THEN true ELSE ativo END
      WHERE conta_id = ${contaSql()} AND ($1::int IS NULL OR id = $1) AND ($2::text IS NULL OR instancia = $2)
        AND ($1::int IS NOT NULL OR $2::text IS NOT NULL)
      RETURNING id, instancia, (assinado_em IS NULL AND token_cifrado IS NOT NULL AND $3) AS assinar`,
    [chip.id ?? null, chip.instancia ?? null, conectado, numero ?? null],
  );
  return rows[0] ?? null;
}

export async function marcarAssinado(db: Executor, id: number): Promise<void> {
  await db.query(
    `UPDATE comercial.chips SET assinado_em = now() WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id],
  );
}

export async function guardarEstado(db: Executor, id: number, estado: string): Promise<void> {
  await db.query(`UPDATE comercial.chips SET estado = $2, estado_em = now() WHERE id = $1`, [
    id,
    estado.slice(0, 200),
  ]);
}

/* ───────────── Saúde do chip ───────────── */

/** Falhas seguidas que pausam o chip, e por quanto tempo. */
export const FALHAS_PARA_PAUSAR = 3;
export const PAUSA_POR_FALHAS_MIN = 60;

/**
 * Depois de uma falha de envio: se o chip falhou 3 vezes ou mais nos últimos 30 minutos e falhou
 * em pelo menos metade das tentativas, fica pausado por 1 hora (os leads dele esperam) e os
 * administradores recebem um alerta. Volta sozinho; "Reativar" na tela tira a pausa na hora.
 */
export async function conferirSaude(db: Executor, chip: Chip): Promise<boolean> {
  if (!chip.id) return false;
  const { rows } = await db.query<{ erros: number; total: number; ultimo: string | null }>(
    `SELECT count(*) FILTER (WHERE status = 'erro')::int AS erros, count(*)::int AS total,
            (SELECT erro FROM comercial.mensagens WHERE chip_id = $1 AND status = 'erro'
              ORDER BY tentado_em DESC NULLS LAST LIMIT 1) AS ultimo
       FROM comercial.mensagens
      WHERE chip_id = $1 AND tentado_em > now() - interval '30 minutes'`,
    [chip.id],
  );
  const r = rows[0];
  if (!r || r.erros < FALHAS_PARA_PAUSAR || r.erros * 2 < r.total) return false;
  const motivo = `${r.erros} falhas de envio em 30 minutos${r.ultimo ? ` (${r.ultimo.slice(0, 120)})` : ''}`;
  await db.query(
    `UPDATE comercial.chips SET pausado_ate = now() + make_interval(mins => $2), pausa_motivo = $3
      WHERE id = $1 AND conta_id = ${contaSql()}`,
    [chip.id, PAUSA_POR_FALHAS_MIN, motivo.slice(0, 300)],
  );
  await alertas.abrir(db, conta(), `saude-chip:${chip.instancia.toLowerCase()}`, {
    nivel: 'aviso',
    titulo: `O chip “${chip.nome}” foi pausado por 1 hora`,
    texto: `${motivo}. Os leads dele esperam; confira a conexão na Evolution.`,
    link: '/agente',
  });
  return true;
}

/** Envio deu certo: se o chip tinha sido pausado por falhas, o alerta fecha. */
export async function envioOk(db: Executor, chip: Chip): Promise<void> {
  if (chip.id) await alertas.fechar(db, conta(), `saude-chip:${chip.instancia.toLowerCase()}`);
}

async function fecharAlertaSaude(db: Executor, id: number) {
  const { rows } = await db.query<{ instancia: string }>(
    `SELECT instancia FROM comercial.chips WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id],
  );
  if (rows[0]) await alertas.fechar(db, conta(), `saude-chip:${rows[0].instancia.toLowerCase()}`);
}

/* ───────────── Número usado no dia a dia: as conversas que já existiam ───────────── */

/** Mesmo número (DDD + 8 últimos dígitos), com ou sem 55 e o 9 a mais. */
const MESMO_FONE = (coluna: string, param: string) =>
  `(right(${coluna}, 8) = right(${param}, 8) AND substr(regexp_replace(${coluna}, '^55(?=\\d{10,11}$)', ''), 1, 2) = substr(regexp_replace(${param}, '^55(?=\\d{10,11}$)', ''), 1, 2))`;

export async function regraDoChip(
  db: Executor,
  chipId: number,
): Promise<{ usoDiario: boolean; contatoNovo: 'padrao' | 'ignorar' | 'sem_lead' | 'lead' } | null> {
  const { rows } = await db.query<{
    usoDiario: boolean;
    contatoNovo: 'padrao' | 'ignorar' | 'sem_lead' | 'lead';
  }>(
    `SELECT uso_diario AS "usoDiario", contato_novo AS "contatoNovo" FROM comercial.chips WHERE id = $1 AND conta_id = ${contaSql()}`,
    [chipId],
  );
  return rows[0] ?? null;
}

/** O contato é "de antes" neste número (e ninguém o trouxe para o CRM)? */
export async function ehDeAntes(db: Executor, chipId: number, telefone: string): Promise<boolean> {
  const fone = telefone.replace(/\D/g, '');
  if (fone.length < 10) return false;
  const { rowCount } = await db.query(
    `SELECT 1 FROM comercial.contatos_antigos
      WHERE conta_id = ${contaSql()} AND chip_id = $1 AND trazido_em IS NULL AND ${MESMO_FONE('telefone', '$2')}
      LIMIT 1`,
    [chipId, fone],
  );
  return (rowCount ?? 0) > 0;
}

export async function marcarDeAntes(
  db: Executor,
  chipId: number,
  telefone: string,
  nome: string | null,
  origem: 'conversa' | 'celular' | 'ignorado',
  ultimaEm: string | null = null,
): Promise<void> {
  const fone = telefone.replace(/\D/g, '');
  if (fone.length < 10) return;
  await db.query(
    `INSERT INTO comercial.contatos_antigos (conta_id, chip_id, telefone, nome, ultima_em, origem)
     VALUES (${contaSql()}, $1, $2, $3, coalesce($4::timestamptz, now()), $5)
     ON CONFLICT (chip_id, telefone) DO UPDATE
        SET nome = coalesce(EXCLUDED.nome, comercial.contatos_antigos.nome),
            ultima_em = greatest(EXCLUDED.ultima_em, comercial.contatos_antigos.ultima_em)`,
    [chipId, fone, nome, ultimaEm, origem],
  );
}

const LENDO = new Set<number>();

/**
 * Lê a lista de conversas do WhatsApp do número e guarda todos como "de antes" (segundo plano; uma
 * leitura por número de cada vez). Contato que já é lead no funil não entra: a conversa dele segue.
 */
export async function lerConversasAntigas(
  db: Executor,
  chipId: number,
  instancia: string,
  conversas: (
    instancia: string,
    pagina: number,
  ) => Promise<{ conversas: ConversaExistente[]; lidas: number }>,
): Promise<number> {
  if (LENDO.has(chipId)) return 0;
  LENDO.add(chipId);
  let total = 0;
  try {
    await db.query(
      `UPDATE comercial.chips SET contatos_leitura = 'lendo' WHERE id = $1 AND conta_id = ${contaSql()}`,
      [chipId],
    );
    for (let pagina = 1; pagina <= 100; pagina++) {
      const r = await conversas(instancia, pagina);
      for (const c of r.conversas) {
        const { rowCount: jaLead } = await db.query(
          `SELECT 1 FROM comercial.oportunidades o
             JOIN comercial.contatos_lead cl ON cl.conta_id = o.conta_id AND cl.empresa_id = o.empresa_id
            WHERE o.conta_id = ${contaSql()} AND o.etapa <> 'descartado' AND cl.telefone IS NOT NULL
              AND ${MESMO_FONE('cl.telefone', '$1')}
           UNION ALL
           SELECT 1 FROM comercial.oportunidades o
            WHERE o.conta_id = ${contaSql()} AND o.etapa <> 'descartado' AND o.whatsapp_destino IS NOT NULL
              AND ${MESMO_FONE('o.whatsapp_destino', '$1')}
           LIMIT 1`,
          [c.telefone],
        );
        if (jaLead) continue;
        await marcarDeAntes(db, chipId, c.telefone, c.nome, 'conversa', c.ultimaEm);
        total++;
      }
      if (r.lidas < 100) break;
    }
    await db.query(
      `UPDATE comercial.chips SET contatos_lidos_em = now(), contatos_leitura = $2 WHERE id = $1 AND conta_id = ${contaSql()}`,
      [chipId, `${total} ${total === 1 ? 'conversa separada' : 'conversas separadas'}`],
    );
    return total;
  } catch (erro) {
    await db.query(
      `UPDATE comercial.chips SET contatos_leitura = $2 WHERE id = $1 AND conta_id = ${contaSql()}`,
      [chipId, `erro: ${(erro instanceof Error ? erro.message : String(erro)).slice(0, 200)}`],
    );
    throw erro;
  } finally {
    LENDO.delete(chipId);
  }
}

export async function listarDeAntes(db: Executor, chipId: number, busca?: string) {
  const digitos = (busca ?? '').replace(/\D/g, '');
  const { rows } = await db.query(
    `SELECT telefone, nome, ultima_em AS "ultimaEm", origem, trazido_em AS "trazidoEm"
       FROM comercial.contatos_antigos
      WHERE conta_id = ${contaSql()} AND chip_id = $1
        AND ($2::text IS NULL OR nome ILIKE $2 OR ($3 <> '' AND telefone LIKE $3))
      ORDER BY trazido_em IS NOT NULL, ultima_em DESC NULLS LAST
      LIMIT 300`,
    [chipId, busca?.trim() ? `%${busca.trim()}%` : null, digitos.length >= 4 ? `%${digitos}%` : ''],
  );
  return rows;
}

/** Trazer para o CRM: daqui em diante a conversa desse contato segue o fluxo normal. */
export async function trazerParaCrm(
  db: Executor,
  chipId: number,
  telefone: string,
  usuarioId: number | null,
) {
  const { rowCount } = await db.query(
    `UPDATE comercial.contatos_antigos SET trazido_em = now(), trazido_por = $3
      WHERE conta_id = ${contaSql()} AND chip_id = $1 AND telefone = $2 AND trazido_em IS NULL`,
    [chipId, telefone.replace(/\D/g, ''), usuarioId],
  );
  if (!rowCount) throw AppError.naoEncontrado('Contato');
}
