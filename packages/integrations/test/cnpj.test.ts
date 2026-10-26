import { describe, expect, it } from 'vitest';
import { cnpjConfere, cnpjsNoTexto, converterBrasilApi } from '../src/enriquecimento/cnpj.js';
import { emailDescartavel } from '../src/enriquecimento/site.js';

const BRUTO = {
  cnpj: '19131243000197',
  razao_social: 'OPEN KNOWLEDGE BRASIL',
  nome_fantasia: 'REDE PELO CONHECIMENTO LIVRE',
  cnae_fiscal: 9430800,
  codigo_porte: 5,
  porte: 'DEMAIS',
  situacao_cadastral: 2,
  data_inicio_atividade: '2013-10-03',
  descricao_tipo_de_logradouro: 'AVENIDA',
  logradouro: 'PAULISTA 37',
  numero: '37',
  bairro: 'BELA VISTA',
  cep: '01311902',
  municipio: 'SAO PAULO',
  uf: 'SP',
  ddd_telefone_1: '1123851939',
  ddd_telefone_2: '',
  email: 'Contato@Exemplo.org',
  opcao_pelo_mei: false,
  qsa: [
    {
      identificador_de_socio: 2,
      nome_socio: 'FERNANDA CAMPAGNUCCI PEREIRA',
      qualificacao_socio: 'Presidente',
      data_entrada_sociedade: '2016-05-03',
    },
    { identificador_de_socio: 1, nome_socio: 'ALGUMA HOLDING LTDA', qualificacao_socio: 'Sócio' },
  ],
};

describe('CNPJ de quem veio só do Maps', () => {
  it('acha CNPJs válidos no texto, com ou sem pontuação, sem repetir', () => {
    const t =
      'CNPJ: 19.131.243/0001-97 · também 19131243000197 · inválido 11.111.111/1111-11 · 12.345.678/0001-00';
    expect(cnpjsNoTexto(t)).toEqual(['19131243000197']);
  });

  it('lê a resposta da BrasilAPI (porte, situação, telefones, sócios)', () => {
    const d = converterBrasilApi(BRUTO)!;
    expect(d).toMatchObject({
      cnpj: '19131243000197',
      razaoSocial: 'OPEN KNOWLEDGE BRASIL',
      cnaePrincipal: '9430800',
      porte: 'demais',
      situacao: '02',
      dataAbertura: '2013-10-03',
      logradouro: 'AVENIDA PAULISTA 37',
      cidade: 'SAO PAULO',
      uf: 'SP',
      telefones: ['1123851939'],
      email: 'contato@exemplo.org',
      mei: false,
    });
    expect(d.socios.map((s) => [s.nome, s.tipo])).toEqual([
      ['FERNANDA CAMPAGNUCCI PEREIRA', 'pf'],
      ['ALGUMA HOLDING LTDA', 'pj'],
    ]);
    expect(converterBrasilApi({ cnpj: '123' })).toBeNull();
  });

  it('só confere se for da mesma cidade e tiver o nome ou um telefone da loja', () => {
    const d = converterBrasilApi(BRUTO)!;
    const loja = { nome: 'Rede Conhecimento Livre', cidade: 'São Paulo', uf: 'SP', telefones: [] };
    expect(cnpjConfere(d, loja)).toEqual({ ok: true, motivo: 'nome confere ("rede")' });
    expect(cnpjConfere(d, { ...loja, nome: 'Pizzaria do Zé', telefones: ['(11) 2385-1939'] }).ok).toBe(true);
    expect(cnpjConfere(d, { ...loja, nome: 'Pizzaria do Zé' })).toEqual({
      ok: false,
      motivo: 'nome diferente',
    });
    expect(cnpjConfere(d, { ...loja, cidade: 'Franca' }).ok).toBe(false);
    expect(cnpjConfere(d, { ...loja, uf: 'MG' })).toEqual({ ok: false, motivo: 'é de SP' });
  });

  it('descarta e-mail técnico (Sentry/Wix) e de exemplo', () => {
    expect(emailDescartavel('605a7baede844d278b89dc95ae0a9123@sentry-next.wixpress.com')).toBe(true);
    expect(emailDescartavel('e0b4d631da7b4200828051f7f9aa1234@sentry.wixpress.com')).toBe(true);
    expect(emailDescartavel('seuemail@gmail.com')).toBe(true);
    expect(emailDescartavel('contato@obotecodopatio.com.br')).toBe(false);
    expect(emailDescartavel('compras@empresarialsul.com.br')).toBe(false);
  });
});

describe('consulta pública de CNPJ com reserva', () => {
  const CNPJ_WS = {
    razao_social: 'PATIO BAR LTDA',
    porte: { id: '01', descricao: 'Micro Empresa' },
    simples: { mei: 'Não' },
    socios: [
      {
        nome: 'MARCOS PEREIRA',
        tipo: 'Pessoa Física',
        data_entrada: '2015-03-10',
        qualificacao_socio: { descricao: 'Sócio-Administrador' },
      },
    ],
    estabelecimento: {
      cnpj: '19131243000197',
      nome_fantasia: 'BOTECO DO PATIO',
      situacao_cadastral: 'Ativa',
      data_inicio_atividade: '2015-03-10',
      atividade_principal: { id: '5611201' },
      tipo_logradouro: 'Rua',
      logradouro: 'DAS FLORES',
      numero: '10',
      bairro: 'CENTRO',
      cep: '14400000',
      ddd1: '16',
      telefone1: '37207447',
      email: null,
      cidade: { nome: 'Franca' },
      estado: { sigla: 'SP' },
    },
  };
  const RECEITA_WS = {
    status: 'OK',
    cnpj: '19.131.243/0001-97',
    nome: 'PATIO BAR LTDA',
    fantasia: 'BOTECO DO PATIO',
    abertura: '10/03/2015',
    situacao: 'ATIVA',
    porte: 'MICRO EMPRESA',
    atividade_principal: [{ code: '56.11-2-01', text: 'Restaurantes' }],
    logradouro: 'RUA DAS FLORES',
    numero: '10',
    bairro: 'CENTRO',
    cep: '14.400-000',
    municipio: 'FRANCA',
    uf: 'SP',
    telefone: '(16) 3720-7447 / (16) 99249-0094',
    email: '',
    qsa: [{ nome: 'MARCOS PEREIRA', qual: '49-Sócio-Administrador' }],
    simei: { optante: false },
  };

  it('lê CNPJ.ws e ReceitaWS no mesmo formato', async () => {
    const { converterCnpjWs, converterReceitaWs } = await import('../src/enriquecimento/cnpj.js');
    const a = converterCnpjWs(CNPJ_WS)!;
    const b = converterReceitaWs(RECEITA_WS)!;
    for (const d of [a, b]) {
      expect(d).toMatchObject({
        cnpj: '19131243000197',
        razaoSocial: 'PATIO BAR LTDA',
        cnaePrincipal: '5611201',
        porte: 'me',
        situacao: '02',
        dataAbertura: '2015-03-10',
        cep: '14400000',
        uf: 'SP',
        mei: false,
      });
      expect(d.telefones).toContain('1637207447');
      expect(d.socios[0]).toMatchObject({ nome: 'MARCOS PEREIRA', qualificacao: 'Sócio-Administrador' });
    }
    expect(b.telefones).toEqual(['1637207447', '16992490094']);
  });

  it('BrasilAPI recusa: tenta Minha Receita e CNPJ.ws; todas fora: erro curto, sem o JSON do servidor', async () => {
    const { consultarCnpjPublico, ConsultaCnpjIndisponivel } = await import('../src/enriquecimento/cnpj.js');
    const chamadas: string[] = [];
    const resposta = (status: number, corpo: unknown) =>
      new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
    const original = globalThis.fetch;
    try {
      globalThis.fetch = (async (url: string, init?: RequestInit) => {
        chamadas.push(
          `${new URL(url).hostname} ${(init?.headers as Record<string, string> | undefined)?.['user-agent'] ? 'com-ua' : 'sem-ua'}`,
        );
        if (url.includes('brasilapi') || url.includes('minhareceita'))
          return resposta(403, { error: { code: '403', message: 'Forbidden' } });
        return resposta(200, CNPJ_WS);
      }) as typeof fetch;
      const d = await consultarCnpjPublico('19.131.243/0001-97');
      expect(d?.razaoSocial).toBe('PATIO BAR LTDA');
      expect(chamadas).toEqual([
        'brasilapi.com.br com-ua',
        'minhareceita.org com-ua',
        'publica.cnpj.ws com-ua',
      ]);

      globalThis.fetch = (async () => resposta(429, { erro: 'muitas' })) as unknown as typeof fetch;
      const erro = await consultarCnpjPublico('19131243000197').catch((e) => e);
      expect(erro).toBeInstanceOf(ConsultaCnpjIndisponivel);
      expect(erro.message).toBe(
        'Consulta pública da Receita indisponível agora (BrasilAPI: limite de consultas por minuto; Minha Receita: limite de consultas por minuto; CNPJ.ws: limite de consultas por minuto; ReceitaWS: limite de consultas por minuto).',
      );

      globalThis.fetch = (async () => resposta(404, {})) as unknown as typeof fetch;
      expect(await consultarCnpjPublico('19131243000197')).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });
});
