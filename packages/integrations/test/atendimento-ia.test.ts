import { describe, expect, it } from 'vitest';
import {
  assuntoSensivel,
  avisoDePassagem,
  emBolhas,
  juntarMemoria,
  lerAprendizado,
  lerDecisao,
  lerResumo,
  parecenca,
  pediuHumano,
  promptAgente,
  resumoEmTexto,
  tempoDigitando,
  verificarMensagem,
} from '../src/agente/index.js';

const fontes = [
  'Somos a Entrega Já, entregas rápidas para autopeças em Salvador e Lauro de Freitas.',
  'Plano mensal a partir de R$ 890. Site: entregaja.com.br. Telefone (71) 3333-4444.',
];

describe('verificações antes de enviar', () => {
  const verificar = (texto: string, extra: Partial<Parameters<typeof verificarMensagem>[0]> = {}) =>
    verificarMensagem({ texto, fontes, enviadasAntes: [], acao: 'responder', ...extra }).map((p) => p.regra);

  it('deixa passar o que está na base', () => {
    expect(
      verificar('O plano mensal começa em R$ 890. Posso te explicar numa ligação de 15 min amanhã às 10h?'),
    ).toEqual([]);
    expect(verificar('Dá uma olhada em entregaja.com.br, lá tem os detalhes.')).toEqual([]);
  });

  it('barra preço, link e contato que não estão na base', () => {
    expect(verificar('Fica R$ 450 por mês.')).toContain('preco_fora_da_base');
    expect(verificar('Temos 20% de desconto essa semana.')).toEqual(
      expect.arrayContaining(['preco_fora_da_base', 'promessa']),
    );
    expect(verificar('Veja em https://outrosite.com/oferta')).toContain('link_fora_da_base');
    expect(verificar('Me chama no (71) 99999-1234')).toContain('contato_fora_da_base');
    expect(verificar('Me chama no (71) 3333-4444')).toEqual([]);
  });

  it('barra markdown, campo de modelo e falar de prompt', () => {
    expect(verificar('**Oi {nome}**, tudo bem?')).toContain('formatacao');
    expect(verificar('Segundo minha base de conhecimento, atendemos Salvador.')).toContain('texto_de_robo');
    // Dizer que é assistente virtual (quando perguntam) pode.
    expect(verificar('Sou o assistente virtual da Entrega Já. Quer que eu chame alguém do time?')).toEqual(
      [],
    );
  });

  it('barra repetição (mas não se o horário mudou)', () => {
    const antes = ['Podemos conversar 15 minutos amanhã às 10h para te mostrar como funciona?'];
    expect(
      verificar('Podemos conversar 15 minutos amanhã às 10h para te mostrar como funciona?', {
        enviadasAntes: antes,
      }),
    ).toContain('repetida');
    expect(
      verificar('Podemos conversar 15 minutos amanhã às 14h para te mostrar como funciona?', {
        enviadasAntes: antes,
      }),
    ).not.toContain('repetida');
    expect(parecenca('a b c d e', 'x y z')).toBe(0);
  });

  it('barra "vou verificar e te retorno" sem passar para o time e reunião "marcada" sem marcar', () => {
    expect(verificar('Vou verificar com o time e te retorno já já.')).toContain('retorno_sem_passar');
    expect(
      verificar('Vou verificar com o time e te retorno já já.', { acao: 'passar_para_humano' }),
    ).not.toContain('retorno_sem_passar');
    expect(verificar('Perfeito, está agendado para amanhã às 10h!')).toContain('agenda_sem_reuniao');
    expect(verificar('Perfeito, está agendado para amanhã às 10h!', { acao: 'marcar_reuniao' })).toEqual([]);
  });

  it('barra mensagem longa e perguntas demais', () => {
    expect(verificar('a'.repeat(800))).toContain('longa');
    expect(verificar('Quantas entregas? Em que bairros? Qual horário? Quem decide?')).toContain(
      'perguntas_demais',
    );
  });
});

describe('decisão, memória e bolhas', () => {
  it('lê memória e pergunta sem resposta', () => {
    const d = lerDecisao(
      JSON.stringify({
        acao: 'passar_para_humano',
        resposta: '',
        motivo: 'Perguntou de Feira de Santana',
        memoria: ['Usa motoboy próprio', '  ', 'Faz 30 entregas por dia'],
        semResposta: 'Vocês atendem em Feira de Santana?',
      }),
    );
    expect(d).toMatchObject({
      acao: 'passar_para_humano',
      memoria: ['Usa motoboy próprio', 'Faz 30 entregas por dia'],
      semResposta: 'Vocês atendem em Feira de Santana?',
    });
    expect(lerDecisao('lixo').acao).toBe('passar_para_humano');
  });

  it('junta memória sem repetir e guarda as mais recentes', () => {
    expect(juntarMemoria(['Usa motoboy próprio'], ['usa motoboy PRÓPRIO', 'Compra às sextas'])).toEqual([
      'Usa motoboy próprio',
      'Compra às sextas',
    ]);
    expect(juntarMemoria(['a1', 'a2', 'a3'], ['a4'], 3)).toEqual(['a2', 'a3', 'a4']);
  });

  it('divide em bolhas e calcula o "digitando"', () => {
    expect(emBolhas('Oi, Marcos!\n\nAtendemos sim.\n\nPosso te ligar?\n\nAbraço')).toEqual([
      'Oi, Marcos!',
      'Atendemos sim.',
      'Posso te ligar?\n\nAbraço',
    ]);
    expect(emBolhas('Uma só')).toEqual(['Uma só']);
    expect(tempoDigitando('ok')).toBe(1200);
    expect(tempoDigitando('x'.repeat(1000))).toBe(7500);
  });

  it('prompt leva base, ficha, memória e a correção', () => {
    const p = promptAgente({
      empresa: 'Entrega Já',
      sobreEmpresa: 'Entregas rápidas.',
      regras: '',
      horariosReuniao: 'seg a sex, 9h às 17h',
      remetente: 'Ana',
      agora: 'hoje',
      lead: { empresa: 'Peças Lima', cidade: 'Salvador', contato: 'Marcos', etapa: 'respondeu' },
      conversa: [{ de: 'lead', texto: 'Atende Lauro?', em: '' }],
      conhecimento: [{ titulo: 'Cidades', texto: 'Atendemos Salvador e Lauro de Freitas.' }],
      memoria: ['Faz 30 entregas por dia'],
      ficha: ['Ramo: Autopeças'],
      correcao: { texto: 'Fica R$ 450', problemas: ['Valor que não está na base'] },
    });
    expect(p).toContain('Atendemos Salvador e Lauro de Freitas.');
    expect(p).toContain('Faz 30 entregas por dia');
    expect(p).toContain('Ramo: Autopeças');
    expect(p).toContain('foi barrada');
  });
});

describe('passagem para o time', () => {
  it('pedido de pessoa e assunto sério vão direto para o time', () => {
    expect(pediuHumano('Quero falar com um atendente')).toBe(true);
    expect(pediuHumano('posso falar com o responsável?')).toBe(true);
    expect(pediuHumano('Você é um robô?')).toBe(true);
    expect(pediuHumano('Quanto custa a entrega?')).toBe(false);
    expect(assuntoSensivel('Vou abrir reclamação no Procon')).toBe(true);
    expect(assuntoSensivel('Vocês entregam no sábado?')).toBe(false);
  });

  it('lê o resumo e monta o texto do aviso', () => {
    const r = lerResumo(
      JSON.stringify({
        situacao: 'Gostou da proposta, mas acha caro.',
        combinado: ['Mandar tabela por e-mail'],
        objecoes: ['Preço alto'],
        perguntasEmAberto: [],
        interesse: 'medio',
        proximoPasso: 'Ligar amanhã',
      }),
    );
    expect(r?.interesse).toBe('medio');
    expect(resumoEmTexto(r!)).toBe(
      'Gostou da proposta, mas acha caro. Combinado: Mandar tabela por e-mail. Objeções: Preço alto. Próximo passo: Ligar amanhã',
    );
    expect(lerResumo('{}')).toBeNull();
  });

  it('aprendizado só vale quando é útil para outros leads', () => {
    expect(
      lerAprendizado(
        JSON.stringify({
          util: true,
          titulo: 'Feira de Santana',
          pergunta: 'Atendem Feira?',
          resposta: 'Sim, às terças.',
        }),
      ),
    ).toMatchObject({ pergunta: 'Atendem Feira?' });
    expect(
      lerAprendizado(JSON.stringify({ util: false, titulo: 'x', pergunta: 'x', resposta: 'x' })),
    ).toBeNull();
  });
});

describe('retorno combinado e aviso ao lead', () => {
  it('lê o retorno combinado e recusa data fora do razoável', () => {
    const semana = new Date(Date.now() + 7 * 86_400_000).toISOString();
    expect(
      lerDecisao(
        JSON.stringify({ acao: 'agendar_retorno', resposta: 'Combinado!', retornoEm: semana, motivo: 'x' }),
      ),
    ).toMatchObject({ acao: 'agendar_retorno', retornoEm: semana });
    // Data no passado: vira resposta simples (se tem texto) ou passa para o time.
    expect(
      lerDecisao(
        JSON.stringify({
          acao: 'agendar_retorno',
          resposta: 'Combinado!',
          retornoEm: '2020-01-01',
          motivo: 'x',
        }),
      ).acao,
    ).toBe('responder');
    expect(lerDecisao(JSON.stringify({ acao: 'agendar_retorno', resposta: '', motivo: 'x' })).acao).toBe(
      'passar_para_humano',
    );
  });

  it('aviso ao lead muda dentro e fora do horário', () => {
    expect(avisoDePassagem({ dentroDoHorario: false, volta: 'amanhã a partir das 8h' })).toBe(
      'Anotei aqui! Nosso time te responde amanhã a partir das 8h.',
    );
    expect(avisoDePassagem({ dentroDoHorario: true, volta: null, motivo: 'pediu_pessoa' }, 0)).toMatch(
      /chamando/,
    );
    expect(avisoDePassagem({ dentroDoHorario: true, volta: null, motivo: 'sensivel' })).toMatch(
      /responsável/,
    );
  });
});
