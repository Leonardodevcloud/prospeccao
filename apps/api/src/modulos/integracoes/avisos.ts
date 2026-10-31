import { createHmac, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { cifrar, decifrar, type Executor, type Pool } from '@prospeccao/db';
import {
  AppError,
  type AvisoEntrada,
  CABECALHO_ASSINATURA,
  DIAS_PARA_PAUSAR_AVISO,
  ESPERAS_AVISO_MIN,
  type EventoAviso,
  type Logger,
  MAX_TENTATIVAS_AVISO,
} from '@prospeccao/shared';
import { comConta, contaSql } from '../../contexto.js';
import { avisarAdmins } from '../instagram/servico.js';
import { leadApi } from './leads.js';

/**
 * Avisos (webhooks): o CRM avisa o sistema do cliente quando algo acontece. Os gatilhos do banco
 * anotam o evento para cada aviso que pediu por ele (webhook_entregas); o motor monta o corpo,
 * assina (HMAC-SHA256 com o segredo do aviso) e manda, com novas tentativas e histórico.
 */

export interface OpcoesAvisos {
  /** CHAVE_CREDENCIAIS: cifra o segredo de cada aviso. */
  chave: string | null;
  /** Só nos testes: deixa mandar para endereços da rede local. */
  redeLocal?: boolean;
}

const exigirChave = (o: OpcoesAvisos) => {
  if (!o.chave)
    throw AppError.invalido(
      'Falta a CHAVE_CREDENCIAIS na api para guardar o segredo dos avisos. Fale com o suporte.',
    );
  return o.chave;
};

export const gerarSegredo = () => `whsec_${randomBytes(24).toString('base64url')}`;

export async function listar(db: Executor) {
  const { rows } = await db.query(
    `SELECT w.id::int, w.nome, w.url, w.eventos, w.situacao, w.pausado_motivo AS "pausadoMotivo",
            w.falhando_desde AS "falhandoDesde", w.criado_em AS "criadoEm", (w.chave_id IS NOT NULL) AS "pelaApi",
            coalesce(s.entregues, 0)::int AS entregues, coalesce(s.falhas, 0)::int AS falhas,
            coalesce(s.pendentes, 0)::int AS pendentes, s.ultima_em AS "ultimaEm"
       FROM comercial.webhooks w
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE e.situacao = 'entregue') AS entregues,
                count(*) FILTER (WHERE e.situacao = 'falhou') AS falhas,
                count(*) FILTER (WHERE e.situacao = 'pendente') AS pendentes,
                max(e.criado_em) AS ultima_em
           FROM comercial.webhook_entregas e
          WHERE e.webhook_id = w.id AND e.criado_em > now() - interval '30 days'
       ) s ON true
      WHERE w.conta_id = ${contaSql()}
      ORDER BY w.criado_em`,
  );
  return rows;
}

export async function criar(db: Executor, o: OpcoesAvisos, d: AvisoEntrada, chaveId: number | null = null) {
  const segredo = gerarSegredo();
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO comercial.webhooks (conta_id, nome, url, eventos, segredo_cifrado, chave_id)
     VALUES (${contaSql()}, $1, $2, $3, $4, $5) RETURNING id::int`,
    [d.nome, d.url, d.eventos, cifrar(exigirChave(o), segredo), chaveId],
  );
  return { id: rows[0]!.id, segredo };
}

async function meu(db: Executor, id: number) {
  const { rows } = await db.query<{ id: number; segredo_cifrado: string; situacao: string }>(
    `SELECT id::int, segredo_cifrado, situacao FROM comercial.webhooks WHERE id = $1 AND conta_id = ${contaSql()}`,
    [id],
  );
  if (!rows[0]) throw AppError.naoEncontrado('Aviso');
  return rows[0];
}

export async function atualizar(db: Executor, id: number, d: AvisoEntrada): Promise<void> {
  await meu(db, id);
  await db.query(`UPDATE comercial.webhooks SET nome = $2, url = $3, eventos = $4 WHERE id = $1`, [
    id,
    d.nome,
    d.url,
    d.eventos,
  ]);
}

export async function mudarSituacao(db: Executor, id: number, situacao: 'ativo' | 'pausado'): Promise<void> {
  await meu(db, id);
  await db.query(
    `UPDATE comercial.webhooks SET situacao = $2, pausado_motivo = CASE WHEN $2 = 'pausado' THEN 'Pausado por você' END,
            falhando_desde = NULL
      WHERE id = $1`,
    [id, situacao],
  );
}

export async function apagar(db: Executor, id: number, chaveId?: number): Promise<void> {
  const { rowCount } = await db.query(
    `DELETE FROM comercial.webhooks WHERE id = $1 AND conta_id = ${contaSql()} ${chaveId ? `AND chave_id = ${Math.trunc(chaveId)}` : ''}`,
    [id],
  );
  if (!rowCount) throw AppError.naoEncontrado('Aviso');
}

export async function segredo(db: Executor, o: OpcoesAvisos, id: number): Promise<string> {
  return decifrar(exigirChave(o), (await meu(db, id)).segredo_cifrado);
}

export async function trocarSegredo(db: Executor, o: OpcoesAvisos, id: number): Promise<string> {
  await meu(db, id);
  const s = gerarSegredo();
  await db.query('UPDATE comercial.webhooks SET segredo_cifrado = $2 WHERE id = $1', [
    id,
    cifrar(exigirChave(o), s),
  ]);
  return s;
}

export async function entregas(db: Executor, webhookId: number) {
  await meu(db, webhookId);
  const { rows } = await db.query(
    `SELECT e.id::int, e.evento, e.empresa_id::int AS "empresaId", coalesce(em.maps_nome, em.nome) AS lead,
            e.situacao, e.tentativas, e.proxima_em AS "proximaEm", e.status_http AS "statusHttp",
            e.resposta, e.duracao_ms AS "duracaoMs", e.erro, e.corpo, e.criado_em AS "criadoEm",
            e.entregue_em AS "entregueEm"
       FROM comercial.webhook_entregas e
       LEFT JOIN descoberta.empresas em ON em.id = e.empresa_id
      WHERE e.webhook_id = $1
      ORDER BY e.criado_em DESC LIMIT 50`,
    [webhookId],
  );
  return rows;
}

/** Manda de novo (a entrega volta para a fila agora, com mais uma tentativa). */
export async function reenviar(db: Executor, entregaId: number): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE comercial.webhook_entregas SET situacao = 'pendente', proxima_em = now(),
            tentativas = least(tentativas, ${MAX_TENTATIVAS_AVISO - 1})
      WHERE id = $1 AND conta_id = ${contaSql()}`,
    [entregaId],
  );
  if (!rowCount) throw AppError.naoEncontrado('Entrega');
}

/** Um aviso de teste (evento "teste"), para conferir o endereço e a assinatura. */
export async function testar(db: Executor, webhookId: number): Promise<number> {
  await meu(db, webhookId);
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO comercial.webhook_entregas (webhook_id, conta_id, evento, dados)
     VALUES ($1, ${contaSql()}, 'teste', '{}') RETURNING id::int`,
    [webhookId],
  );
  return rows[0]!.id;
}

/* ───────────────────────────── Motor de entrega ───────────────────────────── */

/** Endereço privado, da própria máquina ou de metadados da nuvem: não manda para lá. */
export function ipInterno(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a = 0, b = 0] = ip.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x.startsWith('::ffff:')) return ipInterno(x.slice(7));
    return x === '::1' || x === '::' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x);
  }
  return true;
}

async function conferirDestino(url: string, redeLocal: boolean): Promise<void> {
  const u = new URL(url);
  if (!redeLocal && u.protocol !== 'https:') throw new Error('Use um endereço https://');
  if (redeLocal) return;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^localhost$|\.local$|\.internal$/i.test(host)) throw new Error('Endereço interno não é permitido.');
  const ips = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!ips.length || ips.some((i) => ipInterno(i.address)))
    throw new Error('Endereço interno não é permitido.');
}

/** Assinatura: t=<segundos>,v1=<hmac sha256 hex de "<t>.<corpo>">. */
export function assinar(segredoTexto: string, corpo: string, t = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac('sha256', segredoTexto).update(`${t}.${corpo}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

interface Pendente {
  id: number;
  webhook_id: number;
  conta_id: number;
  evento: EventoAviso | 'teste';
  empresa_id: number | null;
  dados: Record<string, unknown>;
  corpo: Record<string, unknown> | null;
  tentativas: number;
  criado_em: string;
  url: string;
  segredo_cifrado: string;
  nome: string;
  falhando_desde: string | null;
}

/** O que vai no aviso: o lead como na API e o que é próprio de cada evento. */
async function montarCorpo(db: Executor, e: Pendente): Promise<Record<string, unknown>> {
  const base: Record<string, unknown> = {
    id: `evt_${e.id}`,
    evento: e.evento,
    em: new Date(e.criado_em).toISOString(),
    contaId: e.conta_id,
  };
  if (e.evento === 'teste') return { ...base, mensagem: 'Aviso de teste do Prospect Team. Está tudo certo.' };
  const lead = e.empresa_id ? await leadApi(db, e.empresa_id) : null;
  const extra: Record<string, unknown> = {};
  if (e.evento === 'lead.etapa') {
    const { rows } = await db.query<{ nome: string }>('SELECT nome FROM comercial.etapas WHERE id = $1', [
      e.dados.deEtapaId ?? null,
    ]);
    extra.de = {
      etapaId: e.dados.deEtapaId ?? null,
      nome: rows[0]?.nome ?? null,
      papel: e.dados.deEtapa ?? null,
    };
  } else if (e.evento === 'lead.responsavel') {
    const { rows } = await db.query<{ id: number; nome: string }>(
      'SELECT id, nome FROM cadastro.usuarios WHERE id = $1',
      [e.dados.deResponsavelId ?? null],
    );
    extra.de = rows[0] ? { id: rows[0].id, nome: rows[0].nome } : null;
  } else if (e.evento === 'mensagem.recebida') {
    const { rows } = await db.query(
      `SELECT id::int, texto, canal, telefone, criado_em AS em FROM comercial.mensagens WHERE id = $1 AND conta_id = $2`,
      [e.dados.mensagemId ?? null, e.conta_id],
    );
    extra.mensagem = rows[0] ?? null;
  } else if (e.evento === 'reuniao.marcada') {
    const { rows } = await db.query(
      `SELECT t.id::int, t.titulo, t.inicio, t.fim, t.local, u.nome AS responsavel
         FROM comercial.tarefas t LEFT JOIN cadastro.usuarios u ON u.id = t.usuario_id
        WHERE t.id = $1 AND t.conta_id = $2`,
      [e.dados.tarefaId ?? null, e.conta_id],
    );
    extra.reuniao = rows[0] ?? null;
  } else if (e.evento === 'ligacao.encerrada') {
    const { rows } = await db.query(
      `SELECT l.id::int, l.direcao, l.resultado, l.duracao_segundos AS "duracaoSegundos", l.nota,
              l.resumo->>'resumo' AS resumo, l.resumo->>'clima' AS clima, l.resumo->>'proximoPasso' AS "proximoPasso",
              u.nome AS "quemLigou"
         FROM comercial.ligacoes l LEFT JOIN cadastro.usuarios u ON u.id = l.usuario_id
        WHERE l.id = $1 AND l.conta_id = $2`,
      [e.dados.ligacaoId ?? null, e.conta_id],
    );
    extra.ligacao = rows[0] ?? null;
  }
  return { ...base, lead, ...extra };
}

/** Manda uma entrega (já reservada). */
async function entregar(pool: Pool, log: Logger, o: OpcoesAvisos, e: Pendente): Promise<void> {
  const corpo = e.corpo ?? (await comConta(e.conta_id, () => montarCorpo(pool, e)));
  const texto = JSON.stringify(corpo);
  const tentativa = e.tentativas + 1;
  const inicio = Date.now();
  let status: number | null = null;
  let resposta: string | null = null;
  let erro: string | null = null;
  try {
    await conferirDestino(e.url, !!o.redeLocal);
    const segredoTexto = decifrar(exigirChave(o), e.segredo_cifrado);
    const r = await fetch(e.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ProspectTeam-Avisos/1',
        'X-Prospect-Evento': e.evento,
        'X-Prospect-Entrega': `evt_${e.id}`,
        [CABECALHO_ASSINATURA]: assinar(segredoTexto, texto),
      },
      body: texto,
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    status = r.status;
    resposta = (await r.text().catch(() => '')).slice(0, 500);
    if (r.status < 200 || r.status >= 300) erro = `O sistema respondeu ${r.status}.`;
  } catch (x) {
    const m =
      (x as Error).name === 'TimeoutError'
        ? 'O sistema demorou mais de 10 s para responder.'
        : (x as Error).message;
    erro = m.slice(0, 300);
  }
  const duracao = Date.now() - inicio;
  if (!erro) {
    await pool.query(
      `UPDATE comercial.webhook_entregas SET situacao = 'entregue', tentativas = $2, corpo = $3, status_http = $4,
              resposta = $5, duracao_ms = $6, erro = NULL, entregue_em = now()
        WHERE id = $1`,
      [e.id, tentativa, texto, status, resposta, duracao],
    );
    await pool.query('UPDATE comercial.webhooks SET falhando_desde = NULL WHERE id = $1', [e.webhook_id]);
    return;
  }
  const acabou = tentativa >= MAX_TENTATIVAS_AVISO;
  const espera = ESPERAS_AVISO_MIN[tentativa - 1] ?? ESPERAS_AVISO_MIN[ESPERAS_AVISO_MIN.length - 1]!;
  await pool.query(
    `UPDATE comercial.webhook_entregas SET situacao = $2, tentativas = $3, corpo = $4, status_http = $5,
            resposta = $6, duracao_ms = $7, erro = $8, proxima_em = now() + make_interval(mins => $9)
      WHERE id = $1`,
    [e.id, acabou ? 'falhou' : 'pendente', tentativa, texto, status, resposta, duracao, erro, espera],
  );
  // Falhando há dias sem nenhum sucesso: pausa e avisa os administradores.
  const { rows } = await pool.query<{ pausar: boolean }>(
    `UPDATE comercial.webhooks SET falhando_desde = coalesce(falhando_desde, now()) WHERE id = $1
     RETURNING (falhando_desde < now() - make_interval(days => ${DIAS_PARA_PAUSAR_AVISO}) AND situacao = 'ativo') AS pausar`,
    [e.webhook_id],
  );
  if (rows[0]?.pausar) {
    await pool.query(
      `UPDATE comercial.webhooks SET situacao = 'pausado',
              pausado_motivo = 'Pausado sozinho: ${DIAS_PARA_PAUSAR_AVISO} dias sem conseguir entregar.'
        WHERE id = $1`,
      [e.webhook_id],
    );
    await comConta(e.conta_id, () =>
      avisarAdmins(
        pool,
        `Aviso "${e.nome}" pausado`,
        `Faz ${DIAS_PARA_PAUSAR_AVISO} dias que o endereço não recebe os avisos (último erro: ${erro}). Confira em Gestão › Integrações e ative de novo.`,
      ),
    ).catch((x) => log.warn({ err: x }, 'avisos: não deu para avisar os administradores'));
  }
}

/** Uma rodada: reserva até 50 entregas vencidas (por 2 min) e manda, 8 de cada vez. */
export async function rodadaAvisos(pool: Pool, log: Logger, o: OpcoesAvisos): Promise<number> {
  const { rows } = await pool.query<Pendente>(
    `UPDATE comercial.webhook_entregas e SET proxima_em = now() + interval '2 minutes'
       FROM comercial.webhooks w
      WHERE e.id IN (SELECT x.id FROM comercial.webhook_entregas x
                      WHERE x.situacao = 'pendente' AND x.proxima_em <= now()
                      ORDER BY x.proxima_em LIMIT 50 FOR UPDATE SKIP LOCKED)
        AND w.id = e.webhook_id
      RETURNING e.id::int, e.webhook_id::int, e.conta_id, e.evento, e.empresa_id::int, e.dados, e.corpo,
                e.tentativas, e.criado_em, w.url, w.segredo_cifrado, w.nome, w.falhando_desde`,
  );
  for (let i = 0; i < rows.length; i += 8)
    await Promise.all(
      rows
        .slice(i, i + 8)
        .map((e) =>
          entregar(pool, log, o, e).catch((x) =>
            log.warn({ err: x, entrega: e.id }, 'avisos: falha ao entregar'),
          ),
        ),
    );
  // Limpeza de vez em quando: entregas com mais de 30 dias.
  if (Math.random() < 0.01)
    await pool
      .query(
        `DELETE FROM comercial.webhook_entregas WHERE criado_em < now() - interval '30 days' AND situacao <> 'pendente'`,
      )
      .catch(() => undefined);
  return rows.length;
}

export function iniciarAvisos(d: { pool: Pool; log: Logger; chave: string | null }): () => void {
  let rodando = false;
  const t = setInterval(() => {
    if (rodando) return;
    rodando = true;
    void rodadaAvisos(d.pool, d.log, { chave: d.chave })
      .catch((e) => d.log.warn({ err: e }, 'avisos: rodada falhou'))
      .finally(() => {
        rodando = false;
      });
  }, 5_000);
  t.unref();
  return () => clearInterval(t);
}
