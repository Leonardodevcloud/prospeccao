import { readFileSync } from 'node:fs';
import { slideNovo } from '@prospeccao/shared/carrosseis';
import { opcoesVideoEntrada, type PalavraVideo } from '@prospeccao/shared/videos';
import { describe, expect, it } from 'vitest';
import { type ClienteClaude, escreverDirect, type PedidoClaude, USO_ZERO } from '../src/carrosseis/index.js';
import {
  FONTES_DO_SABER,
  MANUAIS,
  MANUAL_EDITOR_VIDEO,
  MANUAL_MOTION,
  MANUAL_REDACAO,
  MANUAL_REVISAO,
} from '../src/saber/index.js';
import { pedirDecisao, pedirEnfeites, pedirImagemPara, promptDaImagem } from '../src/videos/index.js';

function claudeFalso(dados: Record<string, unknown>) {
  const pedidos: PedidoClaude[] = [];
  const c: ClienteClaude = {
    modelo: 'claude-sonnet-5-5',
    async pedir(p) {
      pedidos.push(p);
      return { dados, uso: USO_ZERO, custoUsd: 0 };
    },
  };
  return { c, pedidos };
}

const palavras: PalavraVideo[] = ['Freio', 'chiando', 'de', 'manhã', 'é', 'sinal'].map((t, k) => ({
  t,
  i: k * 0.4,
  f: k * 0.4 + 0.35,
}));

describe('o saber dos agentes', () => {
  it('cada manual tem corpo (o bloco do cache passa de 1024 tokens) e não traz propaganda nem estatística de terceiros', () => {
    for (const [nome, texto] of Object.entries(MANUAIS)) {
      expect(texto.length, nome).toBeGreaterThan(3000);
      expect(texto, nome).toMatch(/^MANUAL /);
      expect(texto, nome).not.toMatch(/vyral|remotion|hormozi|mrbeast|kallaway|\.com\b/i);
      expect(texto, nome).not.toMatch(/\b\d{2}% (dos|das) /);
    }
  });

  it('os créditos citam toda fonte usada e as licenças', () => {
    const creditos = readFileSync(new URL('../src/saber/CREDITOS.md', import.meta.url), 'utf8');
    for (const f of FONTES_DO_SABER) expect(creditos).toContain(f.url);
    expect(creditos).toContain('CC BY 4.0');
    expect(creditos).toContain('Apache');
    expect(creditos).toContain('Permission is hereby granted');
  });

  it('o editor de vídeo corta com o manual, e o manual vai para o cache', async () => {
    const { c, pedidos } = claudeFalso({
      inicio: 0,
      fim: 5,
      cortes: [],
      fortes: [1],
      titulo: 'FREIO CHIANDO',
    });
    await pedirDecisao(c, { palavras, silencios: [], opcoes: opcoesVideoEntrada.parse({}) });
    const s = pedidos[0]!.sistema;
    expect(s[0]!.texto).toBe(MANUAL_EDITOR_VIDEO);
    expect(s.at(-1)).toMatchObject({ cache: true });
    expect(s.map((b) => b.texto).join('\n')).toContain('Nunca corte no meio de uma ideia');
  });

  it('o editor de motion planeja e escolhe imagem com o manual', async () => {
    const { c, pedidos } = claudeFalso({
      momentos: [],
      imagens: [],
      sem_imagem: [],
      musica: { clima: 'calma', estilo: 'soft piano' },
    });
    await pedirEnfeites(c, {
      palavras,
      ficam: [{ inicio: 0, fim: 3 }],
      opcoes: opcoesVideoEntrada.parse({}),
      fotos: [],
      promocoes: [],
      comTitulo: true,
    });
    const pedido = claudeFalso({ foto_id: null, gerar: 'oficina', encaixe: 'cheia', motivo: 'x' });
    await pedirImagemPara(pedido.c, { fala: 'a oficina', assunto: '', fotos: [], modo: 'ia' });
    for (const p of [pedidos[0]!, pedido.pedidos[0]!]) {
      expect(p.sistema[0]!.texto).toBe(MANUAL_MOTION);
      expect(p.sistema.at(-1)).toMatchObject({ cache: true });
    }
  });

  it('a redatora do direct escreve com o manual de redação', async () => {
    const { c, pedidos } = claudeFalso({ mensagem: 'Oi, {nome}! Segue o checklist.', botao: 'Baixar' });
    await escreverDirect(c, {
      empresa: 'Auto Peças Horizonte',
      dossieTexto: 'EMPRESA: Auto Peças Horizonte',
      titulo: '5 sinais',
      slides: [{ ...slideNovo('capa', 's1'), titulo: '5 sinais' }],
      legenda: 'Seu freio avisa.',
      palavra: 'FREIO',
      entrega: 'arquivo',
      material: 'checklist.pdf',
      promocao: null,
    });
    expect(pedidos[0]!.sistema[0]).toMatchObject({ cache: true });
    expect(pedidos[0]!.sistema[0]!.texto).toContain(MANUAL_REDACAO);
    expect(pedidos[0]!.sistema[0]!.texto).not.toContain(MANUAL_REVISAO);
  });

  it('a imagem gerada é pedida como foto de campanha, em cenário brasileiro', () => {
    expect(promptDaImagem('oficina', 'cheia')).toMatch(/Composição: .*campanha/);
    expect(promptDaImagem('pastilha de freio', 'acima')).toMatch(/catálogo/);
    expect(promptDaImagem('rua', 'cheia')).toContain('Brasil');
  });
});
