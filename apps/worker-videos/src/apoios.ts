import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Executor } from '@prospeccao/db';
import type { ClienteClaude } from '@prospeccao/integrations/carrosseis';
import type { Armazenamento } from '@prospeccao/integrations/reuniao';
import {
  type ApoioParaIa,
  argumentosDeNormalizarApoio,
  descreverFotos,
} from '@prospeccao/integrations/videos';
import { type ApoioGuardado, LIMITE_SEGUNDOS_APOIO } from '@prospeccao/shared/videos';
import { duracaoDoVideo, rodar, sdrDoVideo } from './ferramentas.js';
import * as repo from './repositorio.js';

/**
 * Vídeos de apoio (v162). Na primeira vez, o editor deixa cada apoio no formato do vídeo (em pé,
 * 1080×1920, sem som), tira a capa, pede à IA de visão uma frase do que ele mostra
 * e guarda tudo; nas seguintes, só baixa o que já está preparado. Apoio que não abre fica com o
 * motivo (a tela mostra) e não entra no vídeo.
 */

/** O apoio é preparado inteiro (até o limite do envio). */
const MAX_SEGUNDOS_PREPARADO = LIMITE_SEGUNDOS_APOIO;

async function baixar(arm: Armazenamento, chave: string, destino: string) {
  const url = await arm.urlAssinada(chave, { segundos: 3600 });
  const r = await fetch(url, { signal: AbortSignal.timeout(15 * 60_000) });
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
  await pipeline(
    Readable.fromWeb(r.body as import('node:stream/web').ReadableStream),
    createWriteStream(destino),
  );
}

export async function prepararApoios(
  d: {
    db: Executor;
    arm: Armazenamento;
    log: { warn: (o: object, m: string) => void };
    claude: ClienteClaude | null;
    subir: (chave: string, arquivo: string, tipo: string) => Promise<void>;
  },
  v: { id: number; conta_id: number; apoios: ApoioGuardado[] },
  pasta: string,
): Promise<{ apoios: ApoioGuardado[]; locais: Map<string, string>; paraIa: ApoioParaIa[] }> {
  const apoios = v.apoios.map((a) => ({ ...a }));
  const locais = new Map<string, string>();
  let mudou = false;
  for (const a of apoios) {
    if (!a.enviado) continue;
    const local = join(pasta, `apoio-${a.id}.mp4`);
    try {
      if (a.chaveNorm) {
        await baixar(d.arm, a.chaveNorm, local);
      } else {
        const bruto = join(pasta, `apoio-${a.id}-bruto`);
        await baixar(d.arm, a.chave, bruto);
        await rodar(
          'ffmpeg',
          argumentosDeNormalizarApoio({
            entrada: bruto,
            saida: local,
            maxSegundos: MAX_SEGUNDOS_PREPARADO,
            // v168: o apoio gravado em HDR (iPhone) também vira imagem comum.
            sdr: (await sdrDoVideo(bruto)).filtro,
          }),
          { timeoutMs: 10 * 60_000 },
        );
        const duracao = await duracaoDoVideo(local);
        if (!duracao || duracao < 1) throw new Error('vídeo curto demais ou sem imagem');
        const base = `videos/${v.conta_id}/${v.id}/apoio-${a.id}`;
        await d.subir(`${base}-pronto.mp4`, local, 'video/mp4');
        const capa = join(pasta, `apoio-${a.id}.jpg`);
        await rodar(
          'ffmpeg',
          [
            '-v',
            'error',
            '-y',
            '-ss',
            Math.min(1, duracao / 3).toFixed(2),
            '-i',
            local,
            '-frames:v',
            '1',
            '-vf',
            'scale=540:960',
            '-q:v',
            '4',
            capa,
          ],
          { timeoutMs: 60_000 },
        );
        const jpeg = new Uint8Array(await readFile(capa));
        await d.arm.enviar(`${base}-capa.jpg`, jpeg, 'image/jpeg');
        Object.assign(a, {
          chaveNorm: `${base}-pronto.mp4`,
          capaChave: `${base}-capa.jpg`,
          duracao,
          erro: null,
        });
        mudou = true;
        if (d.claude && !a.descricao)
          try {
            // Um quadro do meio diz o que o apoio mostra (uma chamada ao modelo leve).
            const meio = join(pasta, `apoio-${a.id}-meio.jpg`);
            await rodar(
              'ffmpeg',
              [
                '-v',
                'error',
                '-y',
                '-ss',
                (duracao / 2).toFixed(2),
                '-i',
                local,
                '-frames:v',
                '1',
                '-vf',
                'scale=540:960',
                '-q:v',
                '5',
                meio,
              ],
              { timeoutMs: 60_000 },
            );
            const [r] = await descreverFotos(d.claude, [
              { id: 0, nome: a.nome, jpeg: new Uint8Array(await readFile(meio)) },
            ]);
            if (r?.descricao) a.descricao = r.descricao.slice(0, 300);
          } catch (erro) {
            d.log.warn({ err: erro, videoId: v.id, apoio: a.id }, 'o apoio ficou sem descrição');
          }
      }
      locais.set(a.id, local);
    } catch (erro) {
      d.log.warn({ err: erro, videoId: v.id, apoio: a.id }, 'o vídeo de apoio não pôde ser preparado');
      a.erro = 'Não deu para abrir este vídeo de apoio. Envie de novo em MP4 ou MOV.';
      mudou = true;
    }
  }
  if (mudou) await repo.salvarApoios(d.db, v.id, apoios);
  return {
    apoios,
    locais,
    paraIa: apoios
      .filter((a) => locais.has(a.id) && a.duracao)
      .map((a) => ({ id: a.id, descricao: a.descricao || a.nome, duracao: a.duracao! })),
  };
}
