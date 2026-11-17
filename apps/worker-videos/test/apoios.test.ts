import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApoioGuardado } from '@prospeccao/shared/videos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepararApoios } from '../src/apoios.js';

const temFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!temFfmpeg)('v162: preparar os vídeos de apoio', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'apoio-'));
  const guardados = new Map<string, Uint8Array>();
  let servidor: ReturnType<typeof createServer>;
  let porta = 0;
  beforeAll(async () => {
    // Um vídeo deitado de 3 s com som, como sai do celular.
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=1280x720:rate=25:duration=3',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=3',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      join(pasta, 'bruto.mp4'),
    ]);
    guardados.set('videos/1/9/apoio-a1', new Uint8Array(readFileSync(join(pasta, 'bruto.mp4'))));
    guardados.set('videos/1/9/apoio-a2', new Uint8Array([1, 2, 3]));
    servidor = createServer((req, res) => {
      const dados = guardados.get(decodeURIComponent(req.url!.slice(1)));
      if (!dados) return res.writeHead(404).end();
      res.writeHead(200).end(Buffer.from(dados));
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    porta = (servidor.address() as { port: number }).port;
  });
  afterAll(() => servidor?.close());

  it('deixa em pé e sem som, tira a capa, descreve e guarda; o que não abre fica com o motivo', async () => {
    const apoio = (id: string): ApoioGuardado => ({
      id,
      nome: `${id}.mp4`,
      tipo: 'video/mp4',
      bytes: 1,
      chave: `videos/1/9/apoio-${id}`,
      envioId: null,
      partes: [],
      enviado: true,
      chaveNorm: null,
      capaChave: null,
      duracao: null,
      descricao: '',
      erro: null,
    });
    const salvos: ApoioGuardado[][] = [];
    const deps = {
      db: {
        query: async (_sql: string, p: unknown[]) => (salvos.push(JSON.parse(p[1] as string)), { rows: [] }),
      } as never,
      arm: {
        urlAssinada: async (chave: string) => `http://127.0.0.1:${porta}/${encodeURIComponent(chave)}`,
        enviar: async (chave: string, corpo: Uint8Array) => void guardados.set(chave, corpo),
      } as never,
      log: { warn: () => undefined },
      claude: {
        modelo: 't',
        pedir: async () => ({
          dados: { fotos: [{ indice: 0, descricao: 'Barras coloridas de teste' }] },
          custoUsd: 0,
        }),
      } as never,
      subir: async (chave: string, arquivo: string) =>
        void guardados.set(chave, new Uint8Array(readFileSync(arquivo))),
    };
    const r = await prepararApoios(deps, { id: 9, conta_id: 1, apoios: [apoio('a1'), apoio('a2')] }, pasta);
    const [a1, a2] = r.apoios;
    expect(a1).toMatchObject({
      chaveNorm: 'videos/1/9/apoio-a1-pronto.mp4',
      capaChave: 'videos/1/9/apoio-a1-capa.jpg',
      erro: null,
    });
    expect(a1!.duracao).toBeGreaterThan(2.8);
    expect(a2!.erro).toContain('Não deu para abrir');
    expect(r.paraIa.map((x) => x.id)).toEqual(['a1']);
    expect(salvos.at(-1)).toHaveLength(2);
    const local = r.locais.get('a1')!;
    const info = execFileSync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type,width,height',
      '-of',
      'csv=p=0',
      local,
    ])
      .toString()
      .trim();
    expect(info).toBe('video,1080,1920');
    writeFileSync(join(pasta, 'ok'), '');
    // Na segunda vez só baixa o que já está preparado (não normaliza de novo).
    const de_novo = await prepararApoios(
      {
        ...deps,
        subir: async () => {
          throw new Error('não era para subir');
        },
      },
      { id: 9, conta_id: 1, apoios: r.apoios },
      pasta,
    );
    expect(de_novo.locais.has('a1')).toBe(true);
  }, 120_000);
});
