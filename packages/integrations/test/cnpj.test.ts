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
