import { createWriteStream } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Executor } from '@prospeccao/db';
import {
  type Armazenamento,
  type ConfigTranscricao,
  MAX_BYTES_TRANSCRICAO,
  type TrechoTranscrito,
  transcreverArquivo,
  transcreverAudio,
} from '@prospeccao/integrations/reuniao';
import type { Logger } from '@prospeccao/shared';
import { contaSql } from '../../contexto.js';
import { duracao, rodar, semPrograma } from './montar.js';

/**
 * O áudio de uma pessoa na reunião, em partes quando é longo.
 *
 * Até 20 minutos (e 24 MB), vai inteiro pelo link, como sempre. Mais que isso (uma reunião de duas
 * horas), o ffmpeg corta em partes de 20 minutos sem recodificar, cada parte vai à transcrição e
 * fica guardada em `sala_transcricao_partes`: se a Groq pedir para esperar (limite de minutos por
 * hora do plano), a próxima tentativa continua da parte que faltou, sem pagar de novo pelas prontas.
 */

/** Tamanho de cada parte (20 min ≈ 7 MB num microfone a 48 kbps). */
export const PARTE_S = 20 * 60;

interface Trilha {
  gravacaoId: string;
  chave: string;
  bytes: number | null;
  segundos: number | null;
}

async function partesProntas(db: Executor, gravacaoId: string) {
  const { rows } = await db.query<{ parte: number; trechos: TrechoTranscrito[] }>(
    `SELECT parte, trechos FROM comercial.sala_transcricao_partes
      WHERE gravacao_id = $1 AND conta_id = ${contaSql()} ORDER BY parte`,
    [gravacaoId],
  );
  return new Map(rows.map((r) => [r.parte, r.trechos]));
}

async function guardarParte(
  db: Executor,
  d: { gravacaoId: string; sessaoId: number; parte: number; inicioMs: number; trechos: TrechoTranscrito[] },
) {
  await db.query(
    `INSERT INTO comercial.sala_transcricao_partes (gravacao_id, parte, sessao_id, conta_id, inicio_ms, trechos)
     VALUES ($1, $2, $3, ${contaSql()}, $4, $5)
     ON CONFLICT (gravacao_id, parte) DO UPDATE SET inicio_ms = EXCLUDED.inicio_ms, trechos = EXCLUDED.trechos`,
    [d.gravacaoId, d.parte, d.sessaoId, d.inicioMs, JSON.stringify(d.trechos)],
  );
}

/** "Tentar de novo" começa do zero (a transcrição pode ter mudado de serviço ou de modelo). */
export async function esquecerPartes(db: Executor, sessaoId: number): Promise<void> {
  await db.query(
    `DELETE FROM comercial.sala_transcricao_partes WHERE sessao_id = $1 AND conta_id = ${contaSql()}`,
    [sessaoId],
  );
}

/** É longa demais para ir inteira? */
export const precisaDePartes = (t: Pick<Trilha, 'bytes' | 'segundos'>) =>
  (t.segundos ?? 0) > PARTE_S || (t.bytes ?? 0) > MAX_BYTES_TRANSCRICAO;

/** Transcreve o áudio de uma pessoa (inteiro ou em partes). Erro de limite sobe para esperar. */
export async function transcreverTrilha(
  db: Executor,
  cfg: ConfigTranscricao,
  arm: Armazenamento,
  sessaoId: number,
  t: Trilha,
  log: Logger,
): Promise<TrechoTranscrito[]> {
  const url = await arm.urlAssinada(t.chave, { segundos: 2 * 3600 });
  if (!precisaDePartes(t)) return transcreverAudio(cfg, url);

  const prontas = await partesProntas(db, t.gravacaoId);
  const pasta = await mkdtemp(join(tmpdir(), 'transcricao-'));
  try {
    const entrada = join(pasta, 'entrada');
    const r = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000) });
    if (!r.ok || !r.body) throw new Error(`Transcrição: não baixou o áudio (HTTP ${r.status})`);
    await pipeline(Readable.fromWeb(r.body as never), createWriteStream(entrada));
    try {
      // Corta sem recodificar (Opus em Ogg), cada parte começando do zero.
      await rodar('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        entrada,
        '-vn',
        '-c:a',
        'copy',
        '-f',
        'segment',
        '-segment_time',
        String(PARTE_S),
        '-reset_timestamps',
        '1',
        join(pasta, 'parte-%03d.ogg'),
      ]);
    } catch (erro) {
      if (!semPrograma(erro)) throw erro;
      log.warn('reuniões: sem ffmpeg, o áudio longo vai inteiro para a transcrição');
      return transcreverAudio(cfg, url);
    }
    const partes = (await readdir(pasta)).filter((n) => n.startsWith('parte-')).sort();
    const trechos: TrechoTranscrito[] = [];
    let inicioMs = 0;
    for (const [i, nome] of partes.entries()) {
      const arquivo = join(pasta, nome);
      const segundos = (await duracao(arquivo)) ?? PARTE_S;
      let daParte = prontas.get(i);
      if (!daParte) {
        const crus = await transcreverArquivo(cfg, new Uint8Array(await readFile(arquivo)), { nome });
        daParte = crus.map((x) => ({ ...x, inicioMs: x.inicioMs + inicioMs, fimMs: x.fimMs + inicioMs }));
        await guardarParte(db, { gravacaoId: t.gravacaoId, sessaoId, parte: i, inicioMs, trechos: daParte });
      }
      trechos.push(...daParte);
      inicioMs += segundos * 1000;
    }
    log.info(
      { sessao: sessaoId, gravacao: t.gravacaoId, partes: partes.length },
      'reuniões: áudio longo transcrito em partes',
    );
    return trechos;
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}
