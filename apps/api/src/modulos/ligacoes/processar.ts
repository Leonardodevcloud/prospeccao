import type { Pool } from '@prospeccao/db';
import { juntarFalas, transcreverAudio } from '@prospeccao/integrations/reuniao';
import type { Logger, ResumoLigacao } from '@prospeccao/shared';
import { comConta } from '../../contexto.js';
import type { ResolverServicos } from '../../servicos.js';
import { notificar } from '../notificacoes/repositorio.js';
import { config, type DepsTelefonia, encerrar } from './servico.js';

/**
 * Depois da ligação (em segundo plano): espera os arquivos que o navegador manda ao desligar,
 * transcreve a voz de cada lado (Whisper), junta as falas pela hora e pede o resumo à IA da conta.
 * Também fecha ligações esquecidas abertas e apaga gravações mais velhas que o prazo da conta.
 */

const LOCK = 7_301_090;
const MAX_TENTATIVAS = 4;
/** Sem arquivo 10 minutos depois de desligar: a aba fechou no meio; fica sem gravação. */
const ESPERA_ARQUIVOS_MS = 10 * 60_000;
const ESPERAS_MIN = [2, 10, 60, 180];

const VOCABULARIO =
  'Ligação comercial em português do Brasil. Alô, bom dia, boa tarde, tudo bem, WhatsApp, orçamento, proposta, reunião, demonstração.';

export interface DepsProcessarLigacoes {
  pool: Pool;
  log: Logger;
  servicos: ResolverServicos;
  telefonia: DepsTelefonia;
}

interface Pendente {
  id: number;
  contaId: number;
  empresaId: number | null;
  usuarioId: number | null;
  encerradaEm: Date;
  duracaoSegundos: number;
  tentativas: number;
}

async function pegarProxima(pool: Pool): Promise<Pendente | null> {
  const { rows } = await pool.query<Pendente>(
    `UPDATE comercial.ligacoes l SET processar_em = now() + interval '10 minutes', processamento = 'processando'
      WHERE l.id = (SELECT id FROM comercial.ligacoes
                     WHERE processamento IN ('aguardando', 'processando') AND coalesce(processar_em, now()) <= now()
                     ORDER BY processar_em NULLS FIRST LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING l.id::int, l.conta_id AS "contaId", l.empresa_id::int AS "empresaId", l.usuario_id AS "usuarioId",
                coalesce(l.encerrada_em, now()) AS "encerradaEm", coalesce(l.duracao_segundos, 0) AS "duracaoSegundos",
                l.tentativas`,
  );
  return rows[0] ?? null;
}

async function adiar(pool: Pool, id: number, segundos: number, erro?: string): Promise<void> {
  await pool.query(
    `UPDATE comercial.ligacoes
        SET processamento = 'aguardando', processar_em = now() + make_interval(secs => $2),
            erro = coalesce($3, erro), tentativas = tentativas + CASE WHEN $3::text IS NULL THEN 0 ELSE 1 END
      WHERE id = $1`,
    [id, segundos, erro ?? null],
  );
}

/** Processa uma ligação (dentro da conta dela). */
export async function processarLigacao(d: DepsProcessarLigacoes, l: Pendente): Promise<'pronta' | 'adiada'> {
  const { pool, telefonia } = d;
  const arm = telefonia.armazenamento;
  const { rows: audios } = await pool.query<{
    quem: 'voce' | 'lead' | 'conversa';
    chave: string;
    deslocamento: number;
  }>(
    `SELECT quem, chave, deslocamento_ms AS deslocamento FROM comercial.ligacao_audios WHERE ligacao_id = $1`,
    [l.id],
  );
  const vozes = audios.filter((a) => a.quem !== 'conversa');
  const desdeOFim = Date.now() - new Date(l.encerradaEm).getTime();
  if (vozes.length < 2 && desdeOFim < ESPERA_ARQUIVOS_MS) {
    await adiar(pool, l.id, 30);
    return 'adiada';
  }

  const cfg = await config(pool);
  let transcricao: 'pronta' | 'sem_audio' | 'desligada' | 'erro' = 'desligada';
  const falas: { quem: 'voce' | 'lead'; nome: string; inicioMs: number; fimMs: number; texto: string }[] = [];
  const { rows: nomes } = await pool.query<{
    comercial: string | null;
    lead: string | null;
    etapa: string | null;
    conta: string;
  }>(
    `SELECT u.nome AS comercial, coalesce(e.maps_nome, e.nome) AS lead, coalesce(et.nome, o.etapa) AS etapa,
            coalesce(org.marca_nome, c.nome) AS conta
       FROM comercial.ligacoes l
       JOIN cadastro.contas c ON c.id = l.conta_id
       JOIN cadastro.organizacoes org ON org.id = c.organizacao_id
       LEFT JOIN cadastro.usuarios u ON u.id = l.usuario_id
       LEFT JOIN descoberta.empresas e ON e.id = l.empresa_id
       LEFT JOIN comercial.oportunidades o ON o.conta_id = l.conta_id AND o.empresa_id = l.empresa_id
       LEFT JOIN comercial.etapas et ON et.id = o.etapa_id
      WHERE l.id = $1`,
    [l.id],
  );
  const n = nomes[0];
  const comercial = n?.comercial ?? 'Você';
  if (cfg.transcrever && telefonia.transcricao && arm) {
    if (!vozes.length) transcricao = 'sem_audio';
    else {
      try {
        const trilhas = [];
        for (const a of vozes) {
          const url = await arm.urlAssinada(a.chave, { segundos: 2 * 3600 });
          const trechos = await transcreverAudio(telefonia.transcricao, url, { vocabulario: VOCABULARIO });
          trilhas.push({
            identidade: a.quem,
            nome: a.quem === 'voce' ? comercial : (n?.lead ?? 'Lead'),
            deslocamentoMs: a.deslocamento,
            trechos,
          });
        }
        for (const f of juntarFalas(trilhas))
          falas.push({ ...f, quem: f.identidade === 'voce' ? 'voce' : 'lead' });
        await pool.query('DELETE FROM comercial.ligacao_falas WHERE ligacao_id = $1', [l.id]);
        for (const f of falas)
          await pool.query(
            `INSERT INTO comercial.ligacao_falas (ligacao_id, conta_id, quem, nome, inicio_ms, fim_ms, texto)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [l.id, l.contaId, f.quem, f.nome, f.inicioMs, f.fimMs, f.texto],
          );
        transcricao = falas.length ? 'pronta' : 'sem_audio';
      } catch (erro) {
        const msg = (erro as Error).message;
        d.log.warn({ err: erro, ligacao: l.id }, 'ligações: transcrição falhou');
        if (l.tentativas + 1 < MAX_TENTATIVAS) {
          await adiar(pool, l.id, (ESPERAS_MIN[l.tentativas] ?? 60) * 60, `Transcrição: ${msg}`);
          return 'adiada';
        }
        transcricao = 'erro';
      }
    }
  }

  let resumo: ResumoLigacao | null = null;
  if (falas.length) {
    const serv = await d.servicos(l.contaId);
    if (serv.ligacao)
      try {
        resumo = await serv.ligacao.resumir({
          empresa: n?.conta ?? 'a empresa',
          comercial,
          lead: n?.lead ?? null,
          etapa: n?.etapa ?? null,
          agora: new Date(),
          duracaoSegundos: l.duracaoSegundos,
          falas: falas.map((f) => ({ segundo: Math.floor(f.inicioMs / 1000), quem: f.quem, texto: f.texto })),
        });
      } catch (erro) {
        const msg = (erro as Error).message;
        d.log.warn({ err: erro, ligacao: l.id }, 'ligações: resumo da IA falhou');
        if (l.tentativas + 1 < MAX_TENTATIVAS) {
          await adiar(pool, l.id, (ESPERAS_MIN[l.tentativas] ?? 60) * 60, `Resumo: ${msg}`);
          return 'adiada';
        }
      }
  }

  await pool.query(
    `UPDATE comercial.ligacoes
        SET processamento = 'pronto', transcricao = $2, resumo = coalesce($3::jsonb, resumo),
            resumo_em = CASE WHEN $3::jsonb IS NULL THEN resumo_em ELSE now() END, processar_em = NULL, erro = NULL,
            audio_bytes = (SELECT sum(bytes) FROM comercial.ligacao_audios a WHERE a.ligacao_id = $1)
      WHERE id = $1`,
    [l.id, transcricao, resumo ? JSON.stringify(resumo) : null],
  );
  // Resultado já salvo antes do resumo chegar: o histórico do lead ganha o resumo.
  if (resumo)
    await pool.query(
      `UPDATE comercial.atividades SET texto = 'Resumo da ligação: ' || $2
        WHERE ligacao_id = $1 AND (texto IS NULL OR texto LIKE '%(ligação pelo CRM)')`,
      [l.id, resumo.resumo],
    );
  // Avisa só quem ainda não salvou o "Como foi?" (fechou o painel antes do resumo chegar).
  const { rows: salvo } = await pool.query<{ ok: boolean }>(
    'SELECT resultado IS NOT NULL AS ok FROM comercial.ligacoes WHERE id = $1',
    [l.id],
  );
  if (resumo && l.usuarioId && !salvo[0]?.ok)
    await notificar(pool, l.usuarioId, {
      tipo: 'sistema',
      titulo: 'Resumo da ligação pronto',
      texto: n?.lead ?? 'Ligação',
      empresaId: l.empresaId,
      link: l.empresaId ? `/funil?empresa=${l.empresaId}` : '/ligacoes',
    }).catch(() => undefined);
  return 'pronta';
}

/** Ligações abertas há muito tempo (aba fechada, internet caiu): encerra. */
async function fecharEsquecidas(d: DepsProcessarLigacoes): Promise<void> {
  const { rows } = await d.pool.query<{ id: number; conta_id: number; sala: string; situacao: string }>(
    `SELECT id::int, conta_id, sala, situacao FROM comercial.ligacoes
      WHERE situacao IN ('preparando', 'chamando', 'tocando', 'em_andamento')
        AND iniciada_em < now() - CASE WHEN situacao = 'em_andamento' THEN interval '15 seconds' ELSE interval '3 minutes' END
      ORDER BY iniciada_em LIMIT 50`,
  );
  for (const r of rows) {
    // Em andamento: confere no LiveKit se o lado do lead ainda está lá.
    if (r.situacao === 'em_andamento') {
      if (!d.telefonia.servico) continue;
      const e = await d.telefonia.servico.estado(r.sala).catch(() => 'erro' as const);
      if (e === 'atendida' || e === 'erro') continue;
    }
    await comConta(r.conta_id, () => encerrar(d.pool, d.telefonia, r.id, 'sala fechou')).catch((erro) =>
      d.log.warn({ err: erro, ligacao: r.id }, 'ligações: não deu para encerrar a esquecida'),
    );
  }
  // Sem telefonia para conferir: em andamento há mais de 4 horas não existe.
  await d.pool.query(
    `UPDATE comercial.ligacoes SET situacao = 'encerrada', encerrada_em = now(), motivo_fim = 'esquecida',
            duracao_segundos = least(4 * 3600, greatest(0, extract(epoch FROM now() - coalesce(atendida_em, now()))::int)),
            processamento = CASE WHEN gravar AND atendida_em IS NOT NULL THEN 'aguardando' ELSE 'sem_gravacao' END,
            processar_em = now()
      WHERE situacao IN ('preparando', 'chamando', 'tocando', 'em_andamento') AND iniciada_em < now() - interval '4 hours'`,
  );
}

/** Gravações mais velhas que o prazo de cada conta (Gestão › Telefonia): apaga os arquivos. */
async function apagarVelhas(d: DepsProcessarLigacoes): Promise<void> {
  const arm = d.telefonia.armazenamento;
  if (!arm) return;
  const { rows } = await d.pool.query<{ id: number; chave: string }>(
    `SELECT a.id::int, a.chave FROM comercial.ligacao_audios a
       LEFT JOIN comercial.telefonia_contas t ON t.conta_id = a.conta_id
      WHERE a.criado_em < now() - make_interval(months => coalesce(t.guardar_meses, 12))
      LIMIT 200`,
  );
  if (!rows.length) return;
  await arm.apagar(rows.map((r) => r.chave));
  await d.pool.query('DELETE FROM comercial.ligacao_audios WHERE id = ANY($1::bigint[])', [
    rows.map((r) => r.id),
  ]);
}

export async function rodarLigacoes(d: DepsProcessarLigacoes): Promise<void> {
  const cliente = await d.pool.connect();
  try {
    const { rows } = await cliente.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [LOCK]);
    if (!rows[0]?.ok) return;
    try {
      await fecharEsquecidas(d);
      for (let i = 0; i < 5; i++) {
        const l = await pegarProxima(d.pool);
        if (!l) break;
        try {
          await comConta(l.contaId, () => processarLigacao(d, l));
        } catch (erro) {
          d.log.error({ err: erro, ligacao: l.id }, 'ligações: processamento falhou');
          if (l.tentativas + 1 >= MAX_TENTATIVAS)
            await d.pool.query(
              `UPDATE comercial.ligacoes SET processamento = 'erro', erro = $2, processar_em = NULL WHERE id = $1`,
              [l.id, (erro as Error).message.slice(0, 500)],
            );
          else await adiar(d.pool, l.id, (ESPERAS_MIN[l.tentativas] ?? 60) * 60, (erro as Error).message);
        }
      }
      if (Math.random() < 0.02)
        await apagarVelhas(d).catch((e) => d.log.warn({ err: e }, 'ligações: limpeza falhou'));
    } finally {
      await cliente.query('SELECT pg_advisory_unlock($1)', [LOCK]);
    }
  } catch (erro) {
    d.log.error({ err: erro }, 'ligações: rodada falhou');
  } finally {
    cliente.release();
  }
}

/** A cada 15 s (e logo depois que chega a gravação, pela própria rodada). */
export function iniciarLigacoes(d: DepsProcessarLigacoes): () => void {
  let rodando = false;
  const t = setInterval(() => {
    if (rodando) return;
    rodando = true;
    void rodarLigacoes(d).finally(() => {
      rodando = false;
    });
  }, 15_000);
  t.unref();
  return () => clearInterval(t);
}
