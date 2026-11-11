import { describe, expect, it } from 'vitest';
import {
  fixosDoMes,
  fracaoDoMes,
  PLANOS_PADRAO,
  planosCompletos,
  precoCreditoSerper,
  preverMes,
  saldoSerper,
  segundosCobrados,
  servicoDoEndereco,
  somarMeses,
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
        carrosseisUsd: 3,
        videosUsd: 2,
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
      // Claude dos carrosséis: US$ 3 × 5.
      carrosseis: 15,
      // Vídeos com IA: US$ 2 × 5.
      videos: 10,
      infra: 50,
      total: 234.5,
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
    expect(servicoDoEndereco('https://api.anthropic.com/v1/messages')).toBe('claude');
    expect(servicoDoEndereco('https://www.autopecasladeira.com.br/')).toBeNull();
    expect(servicoDoEndereco('não é url')).toBeNull();
  });
  it('planos: bloco faltando ou inválido volta para o padrão', () => {
    const p = planosCompletos({
      livekit: { plano: 'Build', mensalUsd: 0 },
      serper: { validadeMeses: 0 },
      fixos: [{ nome: 'Railway', valor: 250 }],
    });
    expect(p.livekit).toEqual({ ...PLANOS_PADRAO.livekit, plano: 'Build', mensalUsd: 0 });
    expect(p.serper).toEqual(PLANOS_PADRAO.serper);
    expect(p.fixos).toEqual([{ nome: 'Railway', valor: 250 }]);
    expect(planosCompletos(null)).toEqual(PLANOS_PADRAO);
    // O Serper é pré-pago: não entra nos fixos.
    expect(fixosDoMes(p, 5).map((f) => [f.nome, f.valor])).toEqual([
      ['Resend · plano Pro', 100],
      ['Railway', 250],
    ]);
  });
  it('Serper: saldo dos pacotes, o que vence antes é gasto primeiro e o que venceu se perde', () => {
    expect(somarMeses('2026-08-31', 6)).toBe('2027-02-28');
    expect(somarMeses('2026-05-10', 6)).toBe('2026-11-10');
    const planos = {
      validadeMeses: 6,
      pacotes: [
        { compradoEm: '2026-10-20', creditos: 50_000, usd: 50 },
        { compradoEm: '2026-05-10', creditos: 2_500, usd: 0 },
      ],
    };
    const uso = [
      // Antes de qualquer pacote: fica sem pacote.
      { dia: '2026-04-01', buscas: 300 },
      { dia: '2026-06-01', buscas: 1_000 },
      { dia: '2026-10-05', buscas: 1_100 },
      // Sobram 400 do grátis (vence em 10/11): gasta eles primeiro e depois o pago.
      { dia: '2026-11-03', buscas: 900 },
      // O grátis já venceu: tudo do pago.
      { dia: '2026-11-12', buscas: 1_000 },
    ];
    const s = saldoSerper(planos, uso, '2026-11-15', '2026-11-01');
    expect(s.pacotes.map((p) => [p.compradoEm, p.usados, p.restante, p.vencido])).toEqual([
      ['2026-05-10', 2_500, 0, true],
      ['2026-10-20', 1_500, 48_500, false],
    ]);
    expect(s.semPacote).toBe(300);
    expect(s).toMatchObject({ saldo: 48_500, totalValendo: 50_000, usadosMes: 1_900, perdidosMes: 0 });
    // 400 do grátis (US$ 0) + 500 do pago (US$ 0,001) em 03/11 e 1.000 do pago em 12/11.
    expect(s.custoMesUsd).toBeCloseTo(1.5, 5);
    expect(s.ritmoDia).toBeCloseTo(1_900 / 15, 5);
    expect(s.precoCreditoUsd).toBe(0.001);

    // Sem uso, o grátis vence em 10/11 com tudo: 2.500 perdidos no mês (custaram US$ 0).
    const parado = saldoSerper(planos, [], '2026-11-15', '2026-11-01');
    expect(parado).toMatchObject({ saldo: 50_000, perdidosMes: 2_500, perdidosMesUsd: 0 });
    expect(precoCreditoSerper({ validadeMeses: 6, pacotes: [] })).toBe(0.001);
  });
  it('fração do mês e previsão', () => {
    const f = fracaoDoMes(new Date('2026-11-16T03:00:00Z'));
    expect(f).toEqual({ fracao: 0.5, dia: 16, dias: 30 });
    expect(preverMes(100, f.fracao)).toBe(200);
  });
});
