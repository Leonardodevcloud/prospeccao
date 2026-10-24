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
    expect(
      interpretarWebhook({
        event: 'messages.upsert',
        data: {
          key: { remoteJid: '5571988776655@s.whatsapp.net', fromMe: false, id: 'IMG1' },
          message: { imageMessage: { caption: 'nossa fachada', mimetype: 'image/jpeg' }, base64: 'AAAA' },
        },
      }),
    ).toMatchObject({
      texto: 'nossa fachada',
      midia: { tipo: 'imagem', mime: 'image/jpeg', base64: 'AAAA' },
    });
    expect(
      interpretarWebhook({
        event: 'messages.upsert',
        data: {
          key: { remoteJid: '5571988776655@s.whatsapp.net', id: 'DOC1' },
          message: { documentMessage: { fileName: 'tabela.pdf', mimetype: 'application/pdf' } },
        },
      }),
    ).toMatchObject({ texto: '[documento]', midia: { tipo: 'documento', nome: 'tabela.pdf', base64: null } });
    expect(
      interpretarWebhook({
        event: 'messages.upsert',
        data: {
          key: { remoteJid: '5571988776655@s.whatsapp.net', id: 'STK1' },
          message: { stickerMessage: { mimetype: 'image/webp' } },
        },
      }),
    ).toMatchObject({ texto: '[figurinha]', midia: { tipo: 'imagem', mime: 'image/webp' } });
    expect(
      interpretarWebhook({
        event: 'messages.upsert',
        data: {
          key: { remoteJid: '5571988776655@s.whatsapp.net', id: 'LNK1' },
          message: {
            extendedTextMessage: {
              text: 'Nosso site: https://autopecas.com.br/loja',
              matchedText: 'https://autopecas.com.br/loja',
            },
          },
        },
      }),
    ).toMatchObject({ texto: 'Nosso site: https://autopecas.com.br/loja', midia: null });
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
      empresa: 'Rota Norte',
      sobreEmpresa: 'A Rota Norte distribui peças.',
      regras: 'Não prometa preço.',
      horariosReuniao: 'seg a sex 9h-17h',
      remetente: 'Paulo',
      agora: 'segunda',
      lead: { empresa: 'Ceave', cidade: 'Salvador', contato: 'Marcos', etapa: 'respondeu' },
      conversa: [{ de: 'lead', texto: 'Quanto custa?', em: '' }],
    });
    expect(p).toContain('Você é Paulo, da Rota Norte');
    expect(p).toContain('SOBRE A ROTA NORTE');
    expect(p).toContain('Não prometa preço.');
    expect(p).toContain('LEAD: Quanto custa?');
  });
});

describe('WhatsApp (Z-API)', () => {
  const base = {
    type: 'ReceivedCallback',
    instanceId: 'INST1',
    messageId: 'MSG1',
    phone: '5516992490094',
    fromMe: false,
    momment: 1760900000000,
    senderName: 'Marcos',
    chatName: 'Marcos Loja',
    isGroup: false,
  };

  it('lê texto, foto com legenda, áudio e cartão de contato', () => {
    expect(interpretarWebhook({ ...base, text: { message: 'Quanto custa?' } })).toMatchObject({
      telefone: '16992490094',
      texto: 'Quanto custa?',
      idExterno: 'MSG1',
      deMim: false,
      nome: 'Marcos',
      instancia: 'INST1',
      em: new Date(1760900000000).toISOString(),
      midia: null,
    });
    expect(
      interpretarWebhook({
        ...base,
        image: { imageUrl: 'https://z/f.jpg', caption: 'nossa vitrine', mimeType: 'image/jpeg' },
      }),
    ).toMatchObject({
      texto: 'nossa vitrine',
      midia: { tipo: 'imagem', url: 'https://z/f.jpg', mime: 'image/jpeg', base64: null },
    });
    expect(
      interpretarWebhook({
        ...base,
        audio: { audioUrl: 'https://z/a.ogg', mimeType: 'audio/ogg', ptt: true },
      }),
    ).toMatchObject({ texto: '[áudio]', midia: { tipo: 'audio', url: 'https://z/a.ogg' } });
    const cartao = interpretarWebhook({
      ...base,
      contact: {
        displayName: 'Rafael Compras',
        vCard:
          'BEGIN:VCARD\nVERSION:3.0\nFN:Rafael Compras\nTEL;type=CELL;waid=5516991112233:+55 16 99111-2233\nEND:VCARD',
      },
    });
    expect(cartao?.contatos).toEqual([{ nome: 'Rafael Compras', telefones: ['16991112233'] }]);
  });

  it('ignora grupo, canal, status e outros eventos; reconhece conexão e desconexão', async () => {
    const { eventoDeConexao } = await import('../src/whatsapp/index.js');
    expect(interpretarWebhook({ ...base, isGroup: true, text: { message: 'oi' } })).toBeNull();
    expect(interpretarWebhook({ ...base, phone: '120363-group', text: { message: 'oi' } })).toBeNull();
    expect(interpretarWebhook({ ...base, isNewsletter: true, text: { message: 'oi' } })).toBeNull();
    expect(
      interpretarWebhook({ type: 'MessageStatusCallback', status: 'READ', instanceId: 'INST1' }),
    ).toBeNull();
    expect(eventoDeConexao({ type: 'DisconnectedCallback', instanceId: 'INST1' })).toEqual({
      instancia: 'INST1',
      conectado: false,
    });
    expect(eventoDeConexao({ type: 'ConnectedCallback', instanceId: 'INST1', phone: '5516…' })).toEqual({
      instancia: 'INST1',
      conectado: true,
    });
    expect(eventoDeConexao({ ...base, text: { message: 'oi' } })).toBeNull();
  });

  it('mensagem enviada pelo celular vem como "de mim"', () => {
    expect(interpretarWebhook({ ...base, fromMe: true, text: { message: 'Bom dia!' } })?.deMim).toBe(true);
  });
});
