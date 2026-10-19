import { describe, expect, it } from 'vitest';
import { lerDecisao, pediuParaParar, promptAgente } from '../src/agente/index.js';
import { interpretarWebhook, numeroWhatsapp } from '../src/whatsapp/index.js';

describe('WhatsApp (Evolution)', () => {
  it('lê o webhook de mensagem recebida (v2) e ignora grupo e status', () => {
    expect(
      interpretarWebhook({
        event: 'messages.upsert',
        data: {
          key: { remoteJid: '5571988776655@s.whatsapp.net', fromMe: false, id: 'ABC' },
          pushName: 'Marcos',
          message: { extendedTextMessage: { text: 'Quanto custa?' } },
          messageTimestamp: 1760900000,
        },
      }),
    ).toMatchObject({
      telefone: '71988776655',
      texto: 'Quanto custa?',
      idExterno: 'ABC',
      deMim: false,
      nome: 'Marcos',
    });
    expect(
      interpretarWebhook({
        event: 'messages.upsert',
        data: { key: { remoteJid: '1203@g.us' }, message: { conversation: 'oi' } },
      }),
    ).toBeNull();
    expect(interpretarWebhook({ event: 'connection.update', data: {} })).toBeNull();
    expect(
      interpretarWebhook({
        event: 'MESSAGES_UPSERT',
        data: {
          key: { remoteJid: '5571988776655@s.whatsapp.net', fromMe: true },
          message: { audioMessage: {} },
        },
      }),
    ).toMatchObject({ texto: '[áudio]', deMim: true });
    expect(numeroWhatsapp('(71) 98877-6655')).toBe('5571988776655');
  });
});

describe('decisão do agente', () => {
  it('aceita decisão válida e protege as inválidas', () => {
    const amanha = new Date(Date.now() + 86_400_000).toISOString();
    expect(
      lerDecisao(
        JSON.stringify({ acao: 'marcar_reuniao', resposta: 'Combinado!', reuniaoEm: amanha, motivo: 'ok' }),
      ),
    ).toMatchObject({ acao: 'marcar_reuniao', reuniaoEm: amanha });
    // Reunião sem data, resposta vazia ou JSON quebrado: passa para o vendedor.
    expect(lerDecisao(JSON.stringify({ acao: 'marcar_reuniao', resposta: 'ok', motivo: '' })).acao).toBe(
      'passar_para_humano',
    );
    expect(lerDecisao(JSON.stringify({ acao: 'responder', resposta: '', motivo: '' })).acao).toBe(
      'passar_para_humano',
    );
    expect(lerDecisao('não é json').acao).toBe('passar_para_humano');
    expect(lerDecisao(JSON.stringify({ acao: 'hackear', resposta: 'x', motivo: '' })).acao).toBe(
      'passar_para_humano',
    );
  });

  it('reconhece pedido para parar de receber mensagens', () => {
    expect(pediuParaParar('Por favor PARE de mandar mensagem')).toBe(true);
    expect(pediuParaParar('não quero mais receber isso')).toBe(true);
    expect(pediuParaParar('Me remova da lista')).toBe(true);
    expect(pediuParaParar('Parece interessante, me manda a tabela')).toBe(false);
    expect(pediuParaParar('Pode me mandar a proposta?')).toBe(false);
  });

  it('o prompt leva a base de conhecimento, as regras e a conversa', () => {
    const p = promptAgente({
      sobreEmpresa: 'A Tutts faz entregas.',
      regras: 'Não prometa preço.',
      horariosReuniao: 'seg a sex 9h-17h',
      remetente: 'Leonardo',
      agora: 'segunda',
      lead: { empresa: 'Ceave', cidade: 'Salvador', contato: 'Marcos', etapa: 'respondeu' },
      conversa: [{ de: 'lead', texto: 'Quanto custa?', em: '' }],
    });
    expect(p).toContain('Você é Leonardo da Tutts');
    expect(p).toContain('Não prometa preço.');
    expect(p).toContain('LEAD: Quanto custa?');
  });
});
