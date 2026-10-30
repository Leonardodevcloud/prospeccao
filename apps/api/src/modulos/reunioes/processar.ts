import type { Pool } from '@prospeccao/db';
import { juntarFalas, transcreverAudio } from '@prospeccao/integrations/reuniao';
import type { Logger, ResumoReuniao } from '@prospeccao/shared';
import { comConta } from '../../contexto.js';
import type { ResolverServicos } from '../../servicos.js';
import * as funil from '../funil/repositorio.js';
import { notificar } from '../notificacoes/repositorio.js';
import { chaveDoPedaco, montarArquivo } from './montar.js';
import * as repo from './repositorio.js';
import { type AoEncerrar, acompanharSessoes, conferirSessoesAbertas, type DepsReunioes } from './servico.js';

/**
 * Depois da reunião (uma por vez, em segundo plano): espera os arquivos do LiveKit, transcreve o
 * áudio de cada pessoa, junta as falas pela hora, pede o resumo à IA da conta e avisa o anfitrião.
 * Falha na transcrição ou na IA tenta de novo mais tarde (algumas vezes); a gravação nunca se perde.
 */

const LOCK = 7_301_060;
/** Trava da conferência das salas ao vivo (uma instância da api por vez). */
const LOCK_AO_VIVO = 7_301_061;
const MAX_TENTATIVAS = 4;
/** Espera máxima pelos arquivos do LiveKit depois que a reunião acabou. */
const ESPERA_ARQUIVOS_MS = 20 * 60_000;
/**
 * Gravação do navegador sem pedaço novo há 10 min (a aba foi fechada no meio do envio): monta com o
 * que chegou. Enquanto os pedaços continuam chegando (internet lenta subindo o que ficou para trás),
 * espera, até 12 horas depois da reunião.
 */
const NAVEGADOR_PARADO_S = 10 * 60;
const NAVEGADOR_ESPERA_MAX_MS = 12 * 3600_000;

export interface DepsProcessar {
  pool: Pool;
  log: Logger;
  servicos: ResolverServicos;
  reunioes: DepsReunioes;
  jwtSegredo: string;
}

interface SessaoParaProcessar {
  id: number;
  contaId: number;
  salaId: number;
  iniciadaEm: Date;
  encerradaEm: Date;
  duracaoSegundos: number;
  transcrever: boolean;
  tentativas: number;
}

/** Espera crescente entre as tentativas (5 min, 15 min, 1 h). */
const ESPERAS_MIN = [5, 15, 60, 180];

async function pegarProxima(pool: Pool): Promise<SessaoParaProcessar | null> {
  // Reserva por 15 minutos (outra instância da api não pega a mesma).
  const { rows } = await pool.query<SessaoParaProcessar>(
    `UPDATE comercial.sala_sessoes ss SET processar_em = now() + interval '15 minutes'
      WHERE ss.id = (SELECT id FROM comercial.sala_sessoes
                      WHERE situacao = 'processando' AND coalesce(processar_em, now()) <= now()
                      ORDER BY processar_em NULLS FIRST LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING ss.id::int, ss.conta_id AS "contaId", ss.sala_id::int AS "salaId", ss.iniciada_em AS "iniciadaEm",
                ss.encerrada_em AS "encerradaEm", coalesce(ss.duracao_segundos, 0) AS "duracaoSegundos",
                ss.transcrever, ss.tentativas`,
  );
  return rows[0] ?? null;
}

async function adiar(pool: Pool, id: number, segundos: number, erro?: string): Promise<void> {
  await pool.query(
    `UPDATE comercial.sala_sessoes
        SET processar_em = now() + make_interval(secs => $2), erro = coalesce($3, erro),
            tentativas = tentativas + CASE WHEN $3::text IS NULL THEN 0 ELSE 1 END
      WHERE id = $1`,
    [id, segundos, erro ?? null],
  );
}

/** Processa uma sessão (dentro da conta dela). */
export async function processarSessao(
  d: DepsProcessar,
  s: SessaoParaProcessar,
): Promise<'pronta' | 'adiada'> {
  const desdeOFim = Date.now() - new Date(s.encerradaEm).getTime();

  // Gravações do navegador: monta as que terminaram de chegar; espera as que ainda estão subindo.
  const arm = d.reunioes.armazenamento;
  let aindaSubindo = false;
  for (const g of await repo.gravacoesParaMontar(d.pool, s.id)) {
    const chegouTudo = g.concluida && g.recebidos >= (g.esperados ?? 0);
    const parou = g.paradaHaSegundos >= NAVEGADOR_PARADO_S;
    if (!chegouTudo && !parou && desdeOFim < NAVEGADOR_ESPERA_MAX_MS) {
      aindaSubindo = true;
      continue;
    }
    if (!arm) break;
    try {
      const pedacos = await repo.pedacosDaGravacao(d.pool, g.gravacaoId);
      const m = await montarArquivo(arm, g, pedacos, d.log);
      await repo.gravacaoMontada(d.pool, g.gravacaoId, m);
      await arm
        .apagar(pedacos.map((n) => chaveDoPedaco(g.chave, n)))
        .catch((erro) => d.log.warn({ err: erro, gravacao: g.gravacaoId }, 'reuniões: pedaços não apagados'));
      d.log.info(
        {
          sessao: s.id,
          gravacao: g.gravacaoId,
          tipo: g.tipo,
          mb: Math.round(m.bytes / 1e6),
          segundos: m.segundos,
        },
        'reuniões: gravação do navegador montada',
      );
    } catch (erro) {
      d.log.error(
        { err: erro, sessao: s.id, gravacao: g.gravacaoId },
        'reuniões: não deu para montar a gravação',
      );
      if (s.tentativas + 1 < MAX_TENTATIVAS) {
        await adiar(
          d.pool,
          s.id,
          (ESPERAS_MIN[s.tentativas] ?? 60) * 60,
          `Gravação: ${(erro as Error).message}`,
        );
        return 'adiada';
      }
      await repo.gravacaoMontada(d.pool, g.gravacaoId, { erro: (erro as Error).message });
    }
  }
  if (aindaSubindo) {
    await adiar(d.pool, s.id, 30);
    return 'adiada';
  }

  const gravacoes = await repo.gravacoesDaSessao(d.pool, s.id);
  const esperando = gravacoes.some((g) => g.origem === 'livekit' && g.situacao === 'gravando');
  if (esperando && desdeOFim < ESPERA_ARQUIVOS_MS) {
    await adiar(d.pool, s.id, 60);
    return 'adiada';
  }

  // Vídeo da sala inteira (pelo navegador pode haver mais de um trecho: fica o mais longo).
  const video = gravacoes
    .filter((g) => g.tipo === 'sala' && g.situacao === 'pronta' && g.chave)
    .sort((a, b) => (b.segundos ?? 0) - (a.segundos ?? 0) || (b.bytes ?? 0) - (a.bytes ?? 0))[0];
  if (video)
    await d.pool.query(`UPDATE comercial.sala_sessoes SET video_chave = $2, video_bytes = $3 WHERE id = $1`, [
      s.id,
      video.chave,
      video.bytes,
    ]);

  // Transcrição: o áudio de cada pessoa.
  const audios = gravacoes.filter((g) => g.tipo === 'audio' && g.situacao === 'pronta' && g.chave);
  const cfgVoz = d.reunioes.transcricao;
  let transcricao: 'pronta' | 'sem_audio' | 'desligada' | 'erro' = 'desligada';
  if (s.transcrever && cfgVoz && arm) {
    if (!audios.length) transcricao = 'sem_audio';
    else {
      try {
        const trilhas = [];
        for (const g of audios) {
          const url = await arm.urlAssinada(g.chave!, { segundos: 2 * 3600 });
          const trechos = await transcreverAudio(cfgVoz, url);
          const inicio = g.iniciadaEm ? new Date(g.iniciadaEm).getTime() : new Date(s.iniciadaEm).getTime();
          trilhas.push({
            identidade: g.identidade ?? 'desconhecido',
            nome: g.nome ?? 'Participante',
            deslocamentoMs: Math.max(0, inicio - new Date(s.iniciadaEm).getTime()),
            trechos,
          });
        }
        const falas = juntarFalas(trilhas);
        await repo.gravarFalas(d.pool, s.id, falas);
        transcricao = falas.length ? 'pronta' : 'sem_audio';
      } catch (erro) {
        const msg = (erro as Error).message;
        d.log.warn({ err: erro, sessao: s.id }, 'reuniões: transcrição falhou');
        if (s.tentativas + 1 < MAX_TENTATIVAS) {
          await adiar(d.pool, s.id, (ESPERAS_MIN[s.tentativas] ?? 60) * 60, `Transcrição: ${msg}`);
          return 'adiada';
        }
        transcricao = 'erro';
      }
    }
  }

  // Resumo da IA (com a IA da conta).
  let resumo: ResumoReuniao | null = null;
  const falas = transcricao === 'pronta' ? await repo.falas(d.pool, s.id) : [];
  if (falas.length) {
    const serv = await d.servicos(s.contaId);
    if (serv.reuniao) {
      try {
        const sala = await repo.salaPorId(d.pool, s.salaId);
        const quem = await repo.quemEsteve(d.pool, s.salaId);
        const { rows: ctx } = await d.pool.query<{
          conta: string;
          lead: string | null;
          etapa: string | null;
        }>(
          `SELECT coalesce(org.marca_nome, c.nome) AS conta, coalesce(e.maps_nome, e.nome) AS lead,
                  coalesce(et.nome, o.etapa) AS etapa
             FROM cadastro.contas c
             JOIN cadastro.organizacoes org ON org.id = c.organizacao_id
             LEFT JOIN descoberta.empresas e ON e.id = $2
             LEFT JOIN comercial.oportunidades o ON o.conta_id = c.id AND o.empresa_id = $2
             LEFT JOIN comercial.etapas et ON et.id = o.etapa_id
            WHERE c.id = $1`,
          [s.contaId, sala.empresaId],
        );
        const chat = await repo.mensagens(d.pool, s.salaId);
        resumo = await serv.reuniao.resumir({
          empresa: ctx[0]?.conta ?? 'a empresa',
          lead: ctx[0]?.lead ?? null,
          etapa: ctx[0]?.etapa ?? null,
          titulo: sala.titulo,
          duracaoSegundos: s.duracaoSegundos,
          participantes: quem.map((p) => ({ nome: p.nome, doTime: p.tipo === 'equipe' })),
          falas: falas.map((f) => ({ segundo: Math.floor(f.inicioMs / 1000), nome: f.nome, texto: f.texto })),
          chat: chat.filter((m) => m.texto).map((m) => `${m.autor}: ${m.texto}`),
        });
      } catch (erro) {
        const msg = (erro as Error).message;
        d.log.warn({ err: erro, sessao: s.id }, 'reuniões: resumo da IA falhou');
        if (s.tentativas + 1 < MAX_TENTATIVAS) {
          await adiar(d.pool, s.id, (ESPERAS_MIN[s.tentativas] ?? 60) * 60, `Resumo: ${msg}`);
          return 'adiada';
        }
      }
    }
  }

  await d.pool.query(
    `UPDATE comercial.sala_sessoes
        SET situacao = 'pronta', transcricao = $2, resumo = coalesce($3::jsonb, resumo),
            resumo_em = CASE WHEN $3::jsonb IS NULL THEN resumo_em ELSE now() END,
            processar_em = NULL, erro = NULL
      WHERE id = $1`,
    [s.id, transcricao, resumo ? JSON.stringify(resumo) : null],
  );

  // Avisa quem conduziu e põe o resumo no histórico do lead.
  const sala = await repo.salaPorId(d.pool, s.salaId);
  if (resumo && sala.empresaId)
    await funil
      .registrarAtividade(
        d.pool,
        sala.empresaId,
        { tipo: 'nota', direcao: null, texto: `Resumo da reunião: ${resumo.resumo}` },
        'reuniao',
      )
      .catch((erro) => d.log.warn({ err: erro, sessao: s.id }, 'reuniões: resumo não foi para o histórico'));
  if (sala.anfitriaoId)
    await notificar(d.pool, sala.anfitriaoId, {
      tipo: 'reuniao',
      titulo: resumo ? 'Resumo da reunião pronto' : 'Gravação da reunião pronta',
      texto: sala.titulo,
      empresaId: sala.empresaId,
      link: `/reunioes/${s.id}`,
    }).catch(() => undefined);
  return 'pronta';
}

/** Uma rodada: confere salas esquecidas abertas e processa o que acabou. */
export async function rodarProcessamento(d: DepsProcessar & { aoEncerrar: AoEncerrar }): Promise<void> {
  const cliente = await d.pool.connect();
  try {
    const { rows } = await cliente.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [LOCK]);
    if (!rows[0]?.ok) return;
    try {
      await conferirSessoesAbertas({ ...d, reunioes: d.reunioes });
      for (let i = 0; i < 5; i++) {
        const s = await pegarProxima(d.pool);
        if (!s) break;
        try {
          await comConta(s.contaId, () => processarSessao(d, s));
        } catch (erro) {
          d.log.error({ err: erro, sessao: s.id }, 'reuniões: processamento falhou');
          if (s.tentativas + 1 >= MAX_TENTATIVAS)
            await d.pool.query(
              `UPDATE comercial.sala_sessoes SET situacao = 'erro', erro = $2, processar_em = NULL WHERE id = $1`,
              [s.id, (erro as Error).message.slice(0, 500)],
            );
          else await adiar(d.pool, s.id, (ESPERAS_MIN[s.tentativas] ?? 60) * 60, (erro as Error).message);
        }
      }
    } finally {
      await cliente.query('SELECT pg_advisory_unlock($1)', [LOCK]);
    }
  } catch (erro) {
    d.log.error({ err: erro }, 'reuniões: rodada de processamento falhou');
  } finally {
    cliente.release();
  }
}

/** A cada 10 s: confere no LiveKit as reuniões ao vivo e as gravações (sem depender do webhook). */
export async function rodarAcompanhamento(d: DepsProcessar & { aoEncerrar: AoEncerrar }): Promise<void> {
  if (!d.reunioes.video) return;
  const cliente = await d.pool.connect();
  try {
    const { rows } = await cliente.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [
      LOCK_AO_VIVO,
    ]);
    if (!rows[0]?.ok) return;
    try {
      await acompanharSessoes({ ...d, reunioes: d.reunioes });
    } finally {
      await cliente.query('SELECT pg_advisory_unlock($1)', [LOCK_AO_VIVO]);
    }
  } catch (erro) {
    d.log.error({ err: erro }, 'reuniões: conferência das salas ao vivo falhou');
  } finally {
    cliente.release();
  }
}

/** Roda a cada 30 s (e logo depois que uma reunião gravada acaba). */
export function iniciarProcessamento(d: DepsProcessar): { parar: () => void; aoEncerrar: AoEncerrar } {
  let agendado: NodeJS.Timeout | null = null;
  const aoEncerrar: AoEncerrar = () => {
    // Os arquivos do LiveKit levam alguns segundos para subir.
    if (agendado) return;
    agendado = setTimeout(() => {
      agendado = null;
      void rodarProcessamento({ ...d, aoEncerrar });
    }, 60_000);
    agendado.unref();
  };
  const t = setInterval(() => void rodarProcessamento({ ...d, aoEncerrar }), 30_000);
  t.unref();
  let acompanhando = false;
  const v = setInterval(() => {
    if (acompanhando) return;
    acompanhando = true;
    void rodarAcompanhamento({ ...d, aoEncerrar }).finally(() => {
      acompanhando = false;
    });
  }, 10_000);
  v.unref();
  return {
    parar: () => {
      clearInterval(t);
      clearInterval(v);
      if (agendado) clearTimeout(agendado);
    },
    aoEncerrar,
  };
}
