import type { PalavraVideo } from '@prospeccao/shared/videos';
import { type ConfigTranscricao, esperaDoLimite, LimiteDaTranscricao } from '../reuniao/transcricao.js';

/**
 * A fala do vídeo palavra por palavra (Whisper pela Groq, com o tempo de cada palavra). O vocabulário
 * da empresa (marca, produtos, siglas) vai no prompt e corrige a escrita depois.
 */

interface PalavraWhisper {
  word?: string;
  start?: number;
  end?: number;
}
interface SegmentoWhisper {
  start?: number;
  end?: number;
  avg_logprob?: number;
  no_speech_prob?: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Prompt curto com o vocabulário (o Whisper lê só os últimos ~220 tokens). */
export function promptDaFala(vocabulario: string[], assunto: string): string {
  const v = vocabulario.slice(0, 40).join(', ');
  return [
    'Vídeo comercial gravado no celular, em português do Brasil.',
    assunto ? `Assunto: ${assunto}.` : '',
    v ? `Palavras: ${v}.` : '',
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 600);
}

const semAcento = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Corrige a escrita com o vocabulário: palavra que bate sem acento e sem diferença de maiúscula
 * vira a forma da empresa (mantendo a pontuação em volta).
 */
export function aplicarVocabulario(palavras: PalavraVideo[], vocabulario: string[]): PalavraVideo[] {
  const mapa = new Map(vocabulario.filter((v) => !/\s/.test(v)).map((v) => [semAcento(v), v]));
  if (!mapa.size) return palavras;
  return palavras.map((p) => {
    const m = /^([^\p{L}\p{N}]*)([\p{L}\p{N}][\p{L}\p{N}'-]*)([^\p{L}\p{N}]*)$/u.exec(p.t);
    if (!m) return p;
    const certo = mapa.get(semAcento(m[2]!));
    return certo ? { ...p, t: `${m[1]}${certo}${m[3]}` } : p;
  });
}

/** Lê a resposta do Whisper: palavras com tempo, marcando as de trecho inseguro para conferir. */
export function lerPalavras(j: { words?: PalavraWhisper[]; segments?: SegmentoWhisper[] }): PalavraVideo[] {
  const inseguros = (j.segments ?? []).filter(
    (s) => (s.avg_logprob ?? 0) < -0.75 || ((s.no_speech_prob ?? 0) > 0.5 && (s.avg_logprob ?? 0) < -0.4),
  );
  const out: PalavraVideo[] = [];
  for (const w of j.words ?? []) {
    const t = (w.word ?? '').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    const i = Math.max(0, w.start ?? 0);
    const f = Math.max(i, w.end ?? i);
    const conferir = inseguros.some((s) => i >= (s.start ?? 0) - 0.01 && i <= (s.end ?? 0) + 0.01);
    out.push({ t, i: r3(i), f: r3(f), ...(conferir ? { conferir: true } : {}) });
  }
  return out;
}

/** Transcreve o áudio do vídeo (até 24 MB: 3 min em FLAC mono 16 kHz cabem com folga). */
export async function transcreverPalavras(
  cfg: ConfigTranscricao,
  audio: Uint8Array<ArrayBuffer>,
  opcoes: { vocabulario: string[]; assunto: string; tipo?: string; nome?: string },
): Promise<PalavraVideo[]> {
  const formulario = new FormData();
  formulario.append('model', cfg.modelo);
  formulario.append('language', 'pt');
  formulario.append('response_format', 'verbose_json');
  formulario.append('timestamp_granularities[]', 'word');
  formulario.append('timestamp_granularities[]', 'segment');
  formulario.append('temperature', '0');
  formulario.append('prompt', promptDaFala(opcoes.vocabulario, opcoes.assunto));
  formulario.append(
    'file',
    new Blob([audio], { type: opcoes.tipo ?? 'audio/flac' }),
    opcoes.nome ?? 'fala.flac',
  );
  const base = cfg.baseUrl.replace(/\/+$/, '');
  const resposta = await fetch(`${base}/audio/transcriptions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${cfg.chave}` },
    body: formulario,
    signal: AbortSignal.timeout(cfg.timeoutMs ?? 300_000),
  });
  if (!resposta.ok) {
    const corpo = await resposta.text().catch(() => '');
    if (resposta.status === 429)
      throw new LimiteDaTranscricao(
        `Transcrição: limite do serviço de transcrição (HTTP 429): ${corpo.slice(0, 200)}`,
        esperaDoLimite(resposta.headers.get('retry-after'), corpo),
      );
    throw new Error(`Transcrição falhou (HTTP ${resposta.status}): ${corpo.slice(0, 300)}`);
  }
  const j = (await resposta.json()) as { words?: PalavraWhisper[]; segments?: SegmentoWhisper[] };
  return aplicarVocabulario(lerPalavras(j), opcoes.vocabulario);
}

/** O texto das palavras de volta (para conferir uma junção ou mandar para a IA). */
export const textoDasPalavras = (p: { t: string }[]) => p.map((x) => x.t).join(' ');
