import { slideNovo } from '@prospeccao/shared/carrosseis';
import { divulgarEntrada } from '@prospeccao/shared/carrosseis-time';
import { describe, expect, it } from 'vitest';
import {
  type ClienteClaude,
  type EntradaDirect,
  escreverDirect,
  mensagemDoDirect,
  type PedidoClaude,
  USO_ZERO,
} from '../src/carrosseis/index.js';

function claudeFalso(dados: Record<string, unknown>) {
  const pedidos: PedidoClaude[] = [];
  const c: ClienteClaude = {
    modelo: 'claude-sonnet-5-5',
    async pedir(p) {
      pedidos.push(p);
      return { dados, uso: { ...USO_ZERO, entrada: 400, saida: 80 }, custoUsd: 0.001 };
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

const entrada = (extra: Partial<EntradaDirect> = {}): EntradaDirect => ({
  empresa: 'Auto Peças Horizonte',
  dossieTexto: 'EMPRESA: Auto Peças Horizonte',
  titulo: '5 sinais de que o freio pede revisão',
  slides: [{ ...slideNovo('capa', 's1'), titulo: '5 sinais de que o freio pede revisão' }],
  legenda: 'Seu freio avisa antes de falhar.',
  palavra: 'FREIO',
  entrega: 'arquivo',
  material: 'checklist-freio.pdf',
  promocao: null,
  ...extra,
});

describe('a redatora escreve o direct', () => {
  it('pede o que a pessoa recebe e devolve o texto e o botão', async () => {
    const { c, pedidos } = claudeFalso({
      mensagem: 'Oi, {nome}! Aqui está o checklist dos 5 sinais. Leve na oficina e confira um por um.',
      botao: 'Baixar o checklist',
    });
    const r = await escreverDirect(c, entrada());
    expect(r).toMatchObject({ daRedatora: true, botao: 'Baixar o checklist' });
    expect(r.mensagem).toContain('checklist');
    expect(pedidos[0]!.mensagem).toContain('ARQUIVO');
    expect(pedidos[0]!.mensagem).toContain('checklist-freio.pdf');
  });

  it('promoção: preço e prazo como foram digitados; errado, vale o padrão', async () => {
    const certo = claudeFalso({
      mensagem:
        'Oi, {nome}! A Pastilha Cobreq do Onix está de R$ 162,00 por R$ 139,90 até sábado. Quer que eu separe?',
      botao: 'Pedir no WhatsApp',
    });
    expect(
      (await escreverDirect(certo.c, entrada({ entrega: 'promocao', promocao: promo }))).daRedatora,
    ).toBe(true);
    expect(mensagemDoDirect(entrada({ entrega: 'promocao', promocao: promo }))).toContain(
      'de R$ 162,00 por R$ 139,90',
    );

    const errado = claudeFalso({
      mensagem: 'Oi, {nome}! A pastilha está por R$ 99,90 só hoje!',
      botao: 'Pedir',
    });
    const r = await escreverDirect(errado.c, entrada({ entrega: 'promocao', promocao: promo }));
    expect(r.daRedatora).toBe(false);
    expect(r.mensagem).toContain('de R$ 162,00 por R$ 139,90 até sábado');
  });

  it('preço inventado fora da promoção também derruba', async () => {
    const { c } = claudeFalso({ mensagem: 'Oi, {nome}! A revisão sai por R$ 49,90.', botao: '' });
    expect((await escreverDirect(c, entrada({ entrega: 'conversa' }))).daRedatora).toBe(false);
  });

  it('só a conversa não tem botão; sem o time ligado, o padrão', async () => {
    const { c } = claudeFalso({ mensagem: 'Oi, {nome}! Qual é o carro e o ano?', botao: 'Responder' });
    expect((await escreverDirect(c, entrada({ entrega: 'conversa' }))).botao).toBe('');
    const sem = await escreverDirect(null, entrada({ entrega: 'link' }));
    expect(sem).toMatchObject({ daRedatora: false, botao: 'Abrir o link' });
  });
});
