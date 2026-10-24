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

describe('domínios no Resend (cadastro pelo cliente)', () => {
  it('converte o domínio e os registros de DNS e sugere o DMARC', async () => {
    const { converterDominio, registroDmarc } = await import('../src/email/index.js');
    const d = converterDominio({
      id: 'd1',
      name: 'loja.com.br',
      status: 'not_started',
      records: [
        {
          record: 'SPF',
          name: 'send',
          type: 'MX',
          ttl: 'Auto',
          status: 'not_started',
          value: 'feedback-smtp.sa-east-1.amazonses.com',
          priority: 10,
        },
        {
          record: 'DKIM',
          name: 'resend._domainkey',
          type: 'TXT',
          ttl: 'Auto',
          status: 'verified',
          value: 'p=MIGf',
        },
      ],
    });
    expect(d).toMatchObject({ id: 'd1', nome: 'loja.com.br', situacao: 'pendente' });
    expect(d.registros[0]).toMatchObject({
      finalidade: 'Envio (SPF)',
      tipo: 'MX',
      prioridade: 10,
      situacao: 'pendente',
    });
    expect(d.registros[1]).toMatchObject({ finalidade: 'Assinatura (DKIM)', situacao: 'verificado' });
    expect(registroDmarc('loja.com.br')).toMatchObject({
      tipo: 'TXT',
      nome: '_dmarc',
      valor: expect.stringMatching(/^v=DMARC1; p=none/),
    });
  });
});
