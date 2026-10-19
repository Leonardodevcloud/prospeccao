import { describe, expect, it } from 'vitest';
import { dataDoPasso, modeloDoPasso, montarMensagem, proximoPasso } from '../src/funil.js';

const cfg = { diasFollowup: [2, 3, 5], diasEncerrar: 4, diasCobrarProposta: [3, 7] };

describe('cadência de follow-up', () => {
  it('entrou no funil: primeira abordagem hoje', () => {
    expect(proximoPasso('a_abordar', 0, 'etapa', cfg)).toMatchObject({ acao: 'Primeira abordagem', dias: 0 });
  });

  it('cada mensagem sem resposta agenda o próximo follow-up e a última encerra', () => {
    const t1 = proximoPasso('abordado', 0, 'enviada', cfg);
    expect(t1).toMatchObject({ acao: 'Follow-up 1', dias: 2, tentativas: 1, encerrar: false });
    expect(proximoPasso('abordado', 1, 'enviada', cfg)).toMatchObject({ acao: 'Follow-up 2', dias: 3 });
    expect(proximoPasso('abordado', 2, 'enviada', cfg)).toMatchObject({ acao: 'Follow-up 3', dias: 5 });
    expect(proximoPasso('abordado', 3, 'enviada', cfg)).toMatchObject({
      acao: 'Sem resposta: encerrar',
      dias: 4,
      tentativas: 4,
      encerrar: true,
    });
  });

  it('arrastar para Abordado conta como a primeira mensagem', () => {
    expect(proximoPasso('abordado', 0, 'etapa', cfg)).toMatchObject({ acao: 'Follow-up 1', tentativas: 1 });
  });

  it('respondeu: responder hoje; reunião: proposta amanhã; proposta: cobra e depois decide', () => {
    expect(proximoPasso('respondeu', 0, 'recebida', cfg)).toMatchObject({ dias: 0 });
    expect(proximoPasso('reuniao', 0, 'reuniao', cfg)).toMatchObject({ acao: 'Mandar proposta', dias: 1 });
    expect(proximoPasso('proposta', 0, 'etapa', cfg)).toMatchObject({ dias: 3, tentativas: 0 });
    expect(proximoPasso('proposta', 0, 'enviada', cfg)).toMatchObject({ dias: 7, tentativas: 1 });
    expect(proximoPasso('proposta', 1, 'enviada', cfg)).toMatchObject({ acao: 'Decidir: ganho ou perdido' });
    expect(proximoPasso('ganho', 0, 'etapa', cfg)).toBeNull();
  });

  it('escolhe o modelo certo para cada envio', () => {
    expect(modeloDoPasso('a_abordar', 0, cfg)).toBe('primeira');
    expect(modeloDoPasso('abordado', 1, cfg)).toBe('followup1');
    expect(modeloDoPasso('abordado', 2, cfg)).toBe('followup2');
    expect(modeloDoPasso('abordado', 3, cfg)).toBe('ultima');
    expect(modeloDoPasso('respondeu', 0, cfg)).toBe('marcar_reuniao');
    expect(modeloDoPasso('ganho', 0, cfg)).toBeNull();
  });

  it('data do passo cai às 9h e pula fim de semana', () => {
    const sexta = new Date('2026-10-23T15:00:00-03:00');
    expect(dataDoPasso(0, sexta)).toBe('2026-10-23T12:00:00.000Z');
    expect(dataDoPasso(1, sexta)).toBe('2026-10-26T12:00:00.000Z'); // sábado → segunda
    expect(dataDoPasso(2, new Date('2026-10-19T23:30:00-03:00'))).toBe('2026-10-21T12:00:00.000Z');
  });

  it('monta a mensagem com e sem nome do decisor', () => {
    const m = '{saudacao} Aqui é {remetente} da Tutts, em {cidade}. E a {empresa}?';
    expect(montarMensagem(m, { nome: 'Maria', empresa: 'Adual', cidade: 'Salvador', remetente: 'Leo' })).toBe(
      'Olá, Maria! Aqui é Leo da Tutts, em Salvador. E a Adual?',
    );
    expect(montarMensagem(m, { empresa: 'Adual' })).toBe('Olá! Aqui é da Tutts, em sua cidade. E a Adual?');
  });
});
