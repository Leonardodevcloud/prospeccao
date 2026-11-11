import { divulgarEntrada } from '@prospeccao/shared/carrosseis-time';
import { describe, expect, it } from 'vitest';
import { type ClienteClaude, escreverDirect, type PedidoClaude, USO_ZERO } from '../src/carrosseis/index.js';
import { MANUAL_REDACAO } from '../src/saber/index.js';
import {
  chamadaDoPost,
  escreverTextoDoPost,
  mensagemDoTextoPost,
  textoPostPadrao,
} from '../src/videos/index.js';

function claudeFalso(dados: Record<string, unknown>) {
  const pedidos: PedidoClaude[] = [];
  const c: ClienteClaude = {
    modelo: 'claude-sonnet-5-5',
    async pedir(p) {
      pedidos.push(p);
      return { dados, uso: USO_ZERO, custoUsd: 0.001 };
    },
  };
  return { c, pedidos };
}

const promo = divulgarEntrada.parse({
  tipo: 'promocao',
  titulo: 'Pastilha Cobreq Onix',
  produto: 'Pastilha Cobreq do Onix',
  precoDe: 'R$ 162,00',
  precoPor: 'R$ 139,90',
  validade: 'até sábado',
});

const entrada = {
  empresa: 'Auto Peças Horizonte',
  dossieTexto: 'EMPRESA: Auto Peças Horizonte',
  titulo: 'Pastilha chiando',
  assunto: 'Promoção de pastilha',
  fala: 'Freio chiando de manhã? É a pastilha avisando. Comente FREIO.',
  chamada: { tipo: 'comente' as const, palavra: 'FREIO', texto: '' },
  promocao: promo,
};

describe('v131: o texto do post do Reels', () => {
  it('sem a redatora, o padrão com o assunto e a chamada', async () => {
    const r = await escreverTextoDoPost(null, entrada);
    expect(r.daRedatora).toBe(false);
    expect(r.texto).toBe(textoPostPadrao(entrada));
    expect(r.texto).toContain('Comente FREIO');
    expect(chamadaDoPost({ tipo: 'whatsapp', palavra: '', texto: '' })).toContain('WhatsApp');
  });

  it('a redatora escreve com o manual de redação; hashtags limpas e sem # no texto', async () => {
    const { c, pedidos } = claudeFalso({
      texto:
        'Freio chiando de manhã não é frescura. A pastilha do Onix sai por R$ 139,90 até sábado. #freio\n\nComente FREIO que a gente manda no direct.',
      hashtags: ['#AutoPecas', 'freios!', 'freios', 'x'],
    });
    const r = await escreverTextoDoPost(c, entrada);
    expect(r.daRedatora).toBe(true);
    expect(r.texto).not.toContain('#freio');
    expect(r.hashtags).toEqual(['autopecas', 'freios']);
    expect(pedidos[0]!.sistema[0]).toMatchObject({ cache: true });
    expect(pedidos[0]!.sistema[0]!.texto).toContain(MANUAL_REDACAO);
    expect(mensagemDoTextoPost(entrada)).toContain('R$ 139,90');
  });

  it('preço que não veio da promoção ou sem a palavra do "Comente": entra o padrão', async () => {
    const inventado = claudeFalso({ texto: 'Pastilha por R$ 99,00 só hoje. Comente FREIO.', hashtags: [] });
    expect((await escreverTextoDoPost(inventado.c, entrada)).daRedatora).toBe(false);
    const semPalavra = claudeFalso({
      texto: 'Freio chiando de manhã é a pastilha avisando. Chama a gente!',
      hashtags: [],
    });
    expect((await escreverTextoDoPost(semPalavra.c, entrada)).daRedatora).toBe(false);
  });

  it('o direct de um vídeo usa a fala no lugar dos slides', async () => {
    const { c, pedidos } = claudeFalso({ mensagem: 'Oi, {nome}! Segue o checklist do freio.', botao: 'Ver' });
    const r = await escreverDirect(c, {
      empresa: 'Auto Peças Horizonte',
      dossieTexto: 'EMPRESA: Auto Peças Horizonte',
      titulo: 'Pastilha chiando',
      slides: [],
      legenda: 'Comente FREIO',
      fala: entrada.fala,
      palavra: 'FREIO',
      entrega: 'link',
      material: 'site.com/freio',
      promocao: null,
    });
    expect(r.daRedatora).toBe(true);
    expect(pedidos[0]!.mensagem).toContain('O QUE A PESSOA FALA NO VÍDEO');
    expect(pedidos[0]!.mensagem).toContain('no vídeo abaixo');
  });
});
