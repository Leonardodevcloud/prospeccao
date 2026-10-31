import { describe, expect, it } from 'vitest';
import {
  fixosDoMes,
  fracaoDoMes,
  PLANOS_PADRAO,
  planosCompletos,
  preverMes,
  segundosCobrados,
  servicoDoEndereco,
} from '../src/consumo.js';
import { CUSTOS_PADRAO, custoEstimado, custosCompletos } from '../src/plataforma.js';

describe('custos da plataforma', () => {
  it('soma o que a plataforma paga e rateia a infraestrutura', () => {
    const c = {
      ...CUSTOS_PADRAO,
      serperMil: 5,
      iaEntradaMilhao: 2,
      iaSaidaMilhao: 8,
      dolar: 5,
      whatsappNumeroMes: 100,
      reuniaoMilMinutos: 3,
      transcricaoHora: 0.2,
      armazenamentoGbMes: 0.1,
    };
    const r = custoEstimado(
      {
        serper: 2000,
        iaTokensEntrada: 1_000_000,
        iaTokensSaida: 500_000,
        emails: 0,
        numerosWhatsapp: 1,
        placesUsd: 2,
        reuniaoMinutos: 2000,
        transcricaoHoras: 10,
        armazenamentoGb: 50,
        ligacaoCelularMin: 100,
        ligacaoFixoMin: 10,
      },
      c,
      50,
      { celularMin: 0.2, fixoMin: 0.05 },
    );
    expect(r).toEqual({
      buscas: 10,
      ia: 6,
      maps: 10,
      email: 0,
      whatsapp: 100,
      reunioes: 13,
      ligacoes: 20.5,
      infra: 50,
      total: 209.5,
    });
  });
  it('campo faltando ou inválido volta para o padrão', () => {
    expect(custosCompletos({ serperMil: 9 })).toEqual({ ...CUSTOS_PADRAO, serperMil: 9 });
    expect(custosCompletos({ serperMil: -1 })).toEqual(CUSTOS_PADRAO);
    expect(custosCompletos(null)).toEqual(CUSTOS_PADRAO);
  });
});

describe('saúde e consumo', () => {
  it('cobra a ligação na cadência 3/30/6', () => {
    expect([0, 3, 4, 30, 31, 36, 37, 61].map(segundosCobrados)).toEqual([0, 0, 30, 30, 36, 36, 42, 66]);
  });
  it('acha o serviço pelo endereço', () => {
    expect(servicoDoEndereco('https://api.z-api.io/instances/x/token/y/send-text')).toBe('whatsapp');
    expect(servicoDoEndereco('https://api.openai.com/v1/audio/speech')).toBe('voz');
    expect(servicoDoEndereco('https://api.openai.com/v1/chat/completions')).toBe('ia');
    expect(servicoDoEndereco('https://projeto.livekit.cloud/twirp/livekit.RoomService/CreateRoom')).toBe(
      'livekit',
    );
    expect(servicoDoEndereco('https://google.serper.dev/search')).toBe('serper');
    expect(servicoDoEndereco('https://www.autopecasladeira.com.br/')).toBeNull();
    expect(servicoDoEndereco('não é url')).toBeNull();
  });
  it('planos: bloco faltando ou inválido volta para o padrão', () => {
    const p = planosCompletos({
      livekit: { plano: 'Build', mensalUsd: 0 },
      serper: { creditos: -5 },
      fixos: [{ nome: 'Railway', valor: 250 }],
    });
    expect(p.livekit).toEqual({ ...PLANOS_PADRAO.livekit, plano: 'Build', mensalUsd: 0 });
    expect(p.serper).toEqual(PLANOS_PADRAO.serper);
    expect(p.fixos).toEqual([{ nome: 'Railway', valor: 250 }]);
    expect(planosCompletos(null)).toEqual(PLANOS_PADRAO);
    expect(fixosDoMes(p, 5).map((f) => [f.nome, f.valor])).toEqual([
      ['Serper · 50.000 créditos', 250],
      ['Resend · plano Pro', 100],
      ['Railway', 250],
    ]);
  });
  it('fração do mês e previsão', () => {
    const f = fracaoDoMes(new Date('2026-11-16T03:00:00Z'));
    expect(f).toEqual({ fracao: 0.5, dia: 16, dias: 30 });
    expect(preverMes(100, f.fracao)).toBe(200);
  });
});
