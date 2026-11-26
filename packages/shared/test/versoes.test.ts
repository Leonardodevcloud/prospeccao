import { describe, expect, it } from 'vitest';
import { respostaRapidaEntrada } from '../src/equipe.js';
import { escolherVersao, versoesParecidas } from '../src/porteiro.js';

describe('versões de uma mensagem pronta', () => {
  const a = 'Bom dia! O prazo de entrega para a sua região é de 2 horas depois da confirmação do pedido.';
  const b = 'Boa tarde! O prazo de entrega para a sua região é de 2 horas depois da confirmação do pedido.';
  const c = 'Oi! Confirmando o pedido, a gente entrega aí em até 2 horas, sem custo extra na sua região.';

  it('acha o par parecido demais; texto curto não conta', () => {
    expect(versoesParecidas([a, c])).toBeNull();
    expect(versoesParecidas([a, c, b])).toEqual([0, 2]);
    expect(versoesParecidas(['Ok, obrigado!', 'Ok, obrigado!'])).toBeNull();
  });

  it('sorteia entre as versões que têm texto', () => {
    expect(escolherVersao([a, '', null, c], () => 0)).toBe(a);
    expect(escolherVersao([a, '', null, c], () => 0.99)).toBe(c);
    expect(escolherVersao(['', undefined])).toBe('');
  });

  it('a resposta rápida não aceita versão parecida demais', () => {
    const r = respostaRapidaEntrada.safeParse({ atalho: 'prazo', texto: a, versoes: [b] });
    expect(r.success).toBe(false);
    expect(respostaRapidaEntrada.safeParse({ atalho: 'prazo', texto: a, versoes: [c] }).success).toBe(true);
  });
});
