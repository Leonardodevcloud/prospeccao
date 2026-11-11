import { existsSync } from 'node:fs';
import { opcoesVideoEntrada } from '@prospeccao/shared/videos';
import { describe, expect, it } from 'vitest';
import { arquivoDoEfeito, efeitosParaMisturar, somPadrao, sonsPresentes } from '../src/enfeitar.js';

describe('o som de cada vídeo', () => {
  const o = opcoesVideoEntrada.parse({});

  it('vídeo novo: música ligada se a conta tem; vídeo da v128 fica sem música e sem efeitos', () => {
    expect(somPadrao(o, { liberada: true, antigo: false })).toMatchObject({
      musica: { usar: true, clima: 'confiante', volume: 35, erro: null },
      efeitos: { ligados: true },
    });
    expect(somPadrao(o, { liberada: false, antigo: false }).musica).toMatchObject({
      usar: false,
      erro: expect.stringContaining('ligada na plataforma'),
    });
    expect(somPadrao(o, { liberada: true, antigo: true })).toMatchObject({
      musica: { usar: false },
      efeitos: { ligados: false },
    });
    expect(somPadrao({ ...o, musica: 'calma' }, { liberada: true, antigo: false }).musica.clima).toBe(
      'calma',
    );
  });

  it('os efeitos tirados não entram na mistura, e os arquivos estão no pacote', async () => {
    const som = somPadrao(o, { liberada: true, antigo: false });
    som.efeitos.desligados = ['b'];
    const lista = [
      { id: 'a', tipo: 'tique' as const, em: 1, onde: '' },
      { id: 'b', tipo: 'sopro' as const, em: 2, onde: '' },
    ];
    expect(efeitosParaMisturar(som, lista).map((e) => e.em)).toEqual([1]);
    expect(efeitosParaMisturar({ ...som, efeitos: { ...som.efeitos, ligados: false } }, lista)).toEqual([]);
    expect(await sonsPresentes()).toBe(true);
    for (const t of ['tique', 'sopro', 'estalo', 'subida'] as const)
      expect(existsSync(arquivoDoEfeito(t))).toBe(true);
  });
});

describe('v136: o andamento', async () => {
  const { resumoDosCortes, rostoEm } = await import('../src/editar.js');
  it('resume os cortes por tipo e o tempo antes e depois', () => {
    const corte = (inicio: number, fim: number, tipo: string, decisao = 'cortar') =>
      ({
        id: `${inicio}`,
        inicio,
        fim,
        tipo,
        motivo: '',
        trecho: '',
        duvida: false,
        decisao,
        conferido: false,
      }) as never;
    const r = resumoDosCortes(
      [
        corte(0, 1, 'pausa'),
        corte(3, 4, 'muleta'),
        corte(5, 6, 'recomeco'),
        corte(7, 8, 'pausa', 'devolver'),
      ],
      10,
    );
    expect(r).toMatchObject({ pausas: 1, muletas: 1, recomecos: 1, outros: 0, de: 10, para: 7 });
  });
  it('acha o rosto mais perto do momento da prévia', () => {
    const rostos = [
      { t: 0, caixas: [] },
      { t: 1.4, caixas: [{ x0: 10, y0: 20, x1: 30, y1: 40 }] },
      { t: 9, caixas: [{ x0: 1, y0: 1, x1: 2, y1: 2 }] },
    ];
    expect(rostoEm(rostos, 1.5)).toEqual({ x0: 10, y0: 20, x1: 30, y1: 40 });
    expect(rostoEm([{ t: 8, caixas: [{ x0: 1, y0: 1, x1: 2, y1: 2 }] }], 1.5)).toBeNull();
  });
});

describe('v138: a biblioteca de efeitos', async () => {
  const { prepararBiblioteca, arquivoDoEfeito } = await import('../src/enfeitar.js');
  const { execFileSync } = await import('node:child_process');
  const { readFileSync } = await import('node:fs');
  it('faz cada efeito uma vez pela ElevenLabs, nivela, guarda no armazenamento e usa', async () => {
    const mp3 = '/tmp/efeito-teste.mp3';
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=880:d=0.5', mp3]);
    const guardados = new Map<string, Uint8Array>();
    let pedidos = 0;
    const arm = {
      async urlAssinada() {
        return 'http://127.0.0.1:9/nada';
      },
      async enviar(chave: string, corpo: Uint8Array) {
        guardados.set(chave, corpo);
      },
    } as never;
    await prepararBiblioteca(
      {
        arm,
        log: { info() {}, warn() {} } as never,
        gerarEfeito: async () => {
          pedidos++;
          return new Uint8Array(readFileSync(mp3));
        },
      },
      `/tmp/sons-teste-${Date.now()}`,
    );
    expect(pedidos).toBe(4);
    expect([...guardados.keys()].sort()).toEqual([
      'sons/v1/estalo.wav',
      'sons/v1/sopro.wav',
      'sons/v1/subida.wav',
      'sons/v1/tique.wav',
    ]);
    expect(arquivoDoEfeito('sopro')).toContain('sons-teste');
  });
});
