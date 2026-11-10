import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Executor } from '@prospeccao/db';
import { type Armazenamento, LimiteDaTranscricao } from '@prospeccao/integrations/reuniao';
import { criarLogger } from '@prospeccao/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { comConta } from '../src/contexto.js';
import { PARTE_S, precisaDePartes, transcreverTrilha } from '../src/modulos/reunioes/transcrever.js';

const temFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const cfg = {
  baseUrl: 'https://api.groq.com/openai/v1',
  chave: 'gsk_teste',
  modelo: 'whisper-large-v3-turbo',
};
const log = criarLogger('teste', 'silent');

/** Banco de mentira só com a tabela das partes (o que a função usa). */
function bancoFalso() {
  const partes = new Map<string, { parte: number; inicio_ms: number; trechos: unknown }>();
  const db = {
    async query(sql: string, p: unknown[] = []) {
      if (sql.includes('INSERT INTO comercial.sala_transcricao_partes')) {
        partes.set(`${p[0]}:${p[1]}`, {
          parte: p[1] as number,
          inicio_ms: p[3] as number,
          trechos: JSON.parse(p[4] as string),
        });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('FROM comercial.sala_transcricao_partes'))
        return {
          rows: [...partes.entries()]
            .filter(([k]) => k.startsWith(`${p[0]}:`))
            .map(([, v]) => ({ parte: v.parte, trechos: v.trechos }))
            .sort((a, b) => a.parte - b.parte),
          rowCount: 0,
        };
      throw new Error(`consulta inesperada: ${sql}`);
    },
  } as unknown as Executor;
  return { db, partes };
}

describe.skipIf(!temFfmpeg)('reunião longa: transcrição em partes', () => {
  let pasta = '';
  let audio: Buffer;
  const arm = { urlAssinada: async () => 'https://arm/b/conta-1/audio.ogg' } as unknown as Armazenamento;

  beforeAll(() => {
    pasta = mkdtempSync(join(tmpdir(), 'longa-'));
    const arquivo = join(pasta, 'fala.ogg');
    // 50 minutos de áudio (Opus mono baixinho, só para o teste): 3 partes de até 20 min.
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=300:sample_rate=16000:duration=3000',
      '-c:a',
      'libopus',
      '-b:a',
      '6k',
      '-ac',
      '1',
      arquivo,
    ]);
    audio = readFileSync(arquivo);
  }, 180_000);
  afterAll(() => rmSync(pasta, { recursive: true, force: true }));
  afterEach(() => vi.unstubAllGlobals());

  it('até 20 minutos vai inteiro pelo link; mais que isso, em partes', () => {
    expect(precisaDePartes({ segundos: 600, bytes: 3e6 })).toBe(false);
    expect(precisaDePartes({ segundos: PARTE_S + 1, bytes: 3e6 })).toBe(true);
    expect(precisaDePartes({ segundos: 600, bytes: 30 * 1024 * 1024 })).toBe(true);
  });

  it('corta em partes de 20 min, soma o deslocamento e, no limite, continua de onde parou', async () => {
    const { db, partes } = bancoFalso();
    let chamadas = 0;
    let limite = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).startsWith('https://arm/'))
          return new Response(new Uint8Array(audio), { status: 200 });
        chamadas++;
        // A terceira parte bate no limite da primeira vez.
        if (chamadas === 3 && limite) {
          limite = false;
          return new Response('{"error":{"message":"Please try again in 5m"}}', { status: 429 });
        }
        return new Response(
          JSON.stringify({ segments: [{ start: 10, end: 12, text: `Parte ${chamadas}` }] }),
          {
            status: 200,
          },
        );
      }),
    );
    const trilha = { gravacaoId: 'nav-1', chave: 'conta-1/audio', bytes: audio.length, segundos: 3000 };
    const erro = await comConta(1, () => transcreverTrilha(db, cfg, arm, 7, trilha, log)).catch((e) => e);
    expect(erro).toBeInstanceOf(LimiteDaTranscricao);
    expect(partes.size).toBe(2);

    // Depois da espera: só a parte que faltou vai à transcrição.
    const antes = chamadas;
    const trechos = await comConta(1, () => transcreverTrilha(db, cfg, arm, 7, trilha, log));
    expect(chamadas - antes).toBe(1);
    expect(trechos.map((t) => t.texto)).toEqual(['Parte 1', 'Parte 2', 'Parte 4']);
    // Cada parte começa onde a anterior terminou (20 min = 1.200.000 ms).
    expect(trechos.map((t) => Math.round(t.inicioMs / 1000))).toEqual([10, 1210, 2410]);
  }, 60_000);
});
