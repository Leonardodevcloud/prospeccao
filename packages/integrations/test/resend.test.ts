import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assinaturaValida, htmlParaTexto, lerEndereco, textoNovo } from '../src/email/index.js';

const SEGREDO = `whsec_${Buffer.from('chave-de-teste').toString('base64')}`;
const assinar = (id: string, ts: string, corpo: string) =>
  `v1,${createHmac('sha256', Buffer.from('chave-de-teste')).update(`${id}.${ts}.${corpo}`).digest('base64')}`;

describe('Resend', () => {
  it('confere a assinatura do webhook (Svix) e recusa a velha ou adulterada', () => {
    const agora = 1_760_000_000_000;
    const ts = String(agora / 1000);
    const corpo = '{"type":"email.delivered"}';
    const ok = { id: 'msg_1', timestamp: ts, assinatura: `v1,xxx ${assinar('msg_1', ts, corpo)}` };
    expect(assinaturaValida(SEGREDO, ok, corpo, agora)).toBe(true);
    expect(assinaturaValida(SEGREDO, ok, '{"type":"email.bounced"}', agora)).toBe(false);
    expect(assinaturaValida(SEGREDO, ok, corpo, agora + 10 * 60_000)).toBe(false);
    expect(assinaturaValida(SEGREDO, { ...ok, assinatura: undefined }, corpo, agora)).toBe(false);
  });

  it('separa o que o lead escreveu do e-mail citado e lê o remetente', () => {
    expect(
      textoNovo(
        'Tenho interesse, me liga.\n\nEm seg., 19 de out. de 2026 às 10:00, Leonardo <c@t.com> escreveu:\n> Olá!',
      ),
    ).toBe('Tenho interesse, me liga.');
    expect(htmlParaTexto('<div>Oi<br>tudo bem?</div><p>Abraço &amp; até</p>')).toBe(
      'Oi\ntudo bem?\nAbraço & até',
    );
    expect(lerEndereco('"João da Silva" <Joao@Loja.com.br>')).toEqual({
      email: 'joao@loja.com.br',
      nome: 'João da Silva',
    });
    expect(lerEndereco('compras@loja.com.br')).toEqual({ email: 'compras@loja.com.br', nome: null });
  });
});
