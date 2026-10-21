import { describe, expect, it } from 'vitest';
import { contatoLeadEntrada, indicacoesNoTexto, lerVcard } from '../src/indicacoes.js';

describe('indicação numa mensagem', () => {
  it('nome, cargo e telefone escritos de jeitos diferentes', () => {
    expect(
      indicacoesNoTexto('Quem cuida disso é o Carlos das compras, chama ele no (71) 99876-5432'),
    ).toEqual([expect.objectContaining({ nome: 'Carlos', cargo: 'Compras', telefone: '71998765432' })]);
    expect(indicacoesNoTexto('fala com a dona Marta, 71 9 8765 4321 ela que decide')[0]).toMatchObject({
      nome: 'Marta',
      telefone: '71987654321',
    });
    expect(indicacoesNoTexto('Pode falar com o gerente: +55 (71) 3333-4444')[0]).toMatchObject({
      cargo: 'Gerente',
      telefone: '7133334444',
    });
  });

  it('sem telefone não é indicação; o próprio número de quem escreveu fica de fora', () => {
    expect(indicacoesNoTexto('Fala com o Carlos amanhã')).toEqual([]);
    expect(indicacoesNoTexto('meu número é 71 99876-5432', '5571998765432')).toEqual([]);
    expect(indicacoesNoTexto('Pedido 123456, valor 1500')).toEqual([]);
  });

  it('cartão de contato do WhatsApp', () => {
    const v =
      'BEGIN:VCARD\nVERSION:3.0\nN:;Carlos Lima;;;\nFN:Carlos Lima\nitem1.TEL;waid=5571998765432:+55 71 99876-5432\nEND:VCARD';
    expect(lerVcard(v)).toEqual({ nome: 'Carlos Lima', telefones: ['71998765432'] });
  });

  it('entrada da tela: telefone normalizado e obrigatório telefone ou e-mail', () => {
    expect(contatoLeadEntrada.parse({ nome: 'Carlos', telefone: '(71) 99876-5432' }).telefone).toBe(
      '71998765432',
    );
    expect(contatoLeadEntrada.safeParse({ nome: 'Carlos' }).success).toBe(false);
    expect(contatoLeadEntrada.safeParse({ nome: 'Carlos', telefone: '123' }).success).toBe(false);
  });
});
