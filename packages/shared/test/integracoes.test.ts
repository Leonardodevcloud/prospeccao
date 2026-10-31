import { describe, expect, it } from 'vitest';
import {
  achatarEnvio,
  aprenderCampos,
  campoSugeridoSite,
  chaveApiEntrada,
  ipOuFaixaValido,
  leadDoEnvio,
} from '../src/integracoes.js';

describe('formulários do site: o envio vira campos', () => {
  it('formulário HTML comum (chave = valor) e os campos internos ficam de fora', () => {
    const r = achatarEnvio({
      nome: 'Fernanda Rocha',
      whatsapp: '(71) 99876-5432',
      email: 'fernanda@sorriso.com.br',
      empresa: 'Clínica Sorriso Pleno',
      _wpcf7: '12',
      'g-recaptcha-response': 'xxx',
      utm_campaign: 'black-friday',
    });
    expect(r.map((c) => c.chave)).toEqual(['nome', 'whatsapp', 'email', 'empresa', 'utm_campaign']);
    const l = leadDoEnvio(r, []);
    expect(l).toMatchObject({
      contato: 'Fernanda Rocha',
      telefone: '(71) 99876-5432',
      email: 'fernanda@sorriso.com.br',
      empresa: 'Clínica Sorriso Pleno',
      origem: 'Utm campaign: black-friday',
    });
  });

  it('Elementor: usa o título do campo como rótulo', () => {
    const r = achatarEnvio({
      form: { id: 'a1', name: 'Contato' },
      fields: {
        name: { id: 'name', type: 'text', title: 'Nome', value: 'Mariana Souza' },
        field_3a: { id: 'field_3a', type: 'tel', title: 'WhatsApp', value: '71 98877-6655' },
        field_9c: { id: 'field_9c', type: 'select', title: 'Quantos vendedores?', value: '5 a 10' },
      },
    });
    expect(r).toEqual([
      { chave: 'fields.name', rotulo: 'Nome', valor: 'Mariana Souza' },
      { chave: 'fields.field_3a', rotulo: 'WhatsApp', valor: '71 98877-6655' },
      { chave: 'fields.field_9c', rotulo: 'Quantos vendedores?', valor: '5 a 10' },
    ]);
    const l = leadDoEnvio(r, []);
    expect(l.contato).toBe('Mariana Souza');
    expect(l.telefone).toBe('71 98877-6655');
    expect(l.anotacao).toBe('Quantos vendedores?: 5 a 10');
  });

  it('Typeform e RD Station', () => {
    const t = achatarEnvio({
      form_response: {
        definition: {
          fields: [
            { id: 'f1', ref: 'nome', title: 'Qual o seu nome?' },
            { id: 'f2', title: 'Plano' },
          ],
        },
        answers: [
          { type: 'text', text: 'Paula', field: { id: 'f1', ref: 'nome' } },
          { type: 'choice', choice: { label: 'Time' }, field: { id: 'f2', ref: 'plano' } },
        ],
        hidden: { utm_source: 'instagram' },
      },
    });
    expect(t).toEqual([
      { chave: 'nome', rotulo: 'Qual o seu nome?', valor: 'Paula' },
      { chave: 'plano', rotulo: 'Plano', valor: 'Time' },
      { chave: 'utm_source', rotulo: 'Utm source', valor: 'instagram' },
    ]);
    const rd = achatarEnvio({
      leads: [{ name: 'Ricardo', email: 'r@x.com', personal_phone: '71 99123-0011' }],
    });
    expect(leadDoEnvio(rd, [])).toMatchObject({
      contato: 'Ricardo',
      email: 'r@x.com',
      telefone: '71 99123-0011',
    });
  });

  it('o mapa manda: campo escolhido vale mais que a sugestão; campo novo fica marcado', () => {
    const recebidos = [
      { chave: 'empresa', rotulo: 'Empresa', valor: 'Odonto Vida' },
      { chave: 'mensagem', rotulo: 'Mensagem', valor: 'Quero um orçamento' },
    ];
    const mapa = aprenderCampos([], recebidos);
    expect(mapa.map((m) => [m.chave, m.campo, m.novo])).toEqual([
      ['empresa', 'empresa', false],
      ['mensagem', 'anotacao', false],
    ]);
    const depois = aprenderCampos(mapa, [
      ...recebidos,
      { chave: 'cnpj', rotulo: 'CNPJ', valor: '12.345.678/0001-90' },
    ]);
    expect(depois[2]).toMatchObject({ chave: 'cnpj', campo: 'cnpj', novo: true });
    const comMapa = leadDoEnvio(recebidos, [{ chave: 'mensagem', rotulo: 'Mensagem', campo: 'ignorar' }]);
    expect(comMapa.anotacao).toBeNull();
    expect(campoSugeridoSite('pt_confirmar', '')).toBe('ignorar');
    expect(campoSugeridoSite('field_x', 'Nome da empresa')).toBe('empresa');
  });
});

describe('chaves', () => {
  it('confere IPs e faixas', () => {
    expect(ipOuFaixaValido('201.17.40.0/24')).toBe(true);
    expect(ipOuFaixaValido('201.17.40.10')).toBe(true);
    expect(ipOuFaixaValido('2001:db8::/32')).toBe(true);
    expect(ipOuFaixaValido('300.1.1.1')).toBe(false);
    expect(ipOuFaixaValido('10.0.0.0/40')).toBe(false);
    expect(chaveApiEntrada.safeParse({ nome: 'ERP', permissoes: [] }).success).toBe(false);
    expect(chaveApiEntrada.parse({ nome: 'ERP', permissoes: ['leads:criar'] })).toMatchObject({
      validadeDias: null,
      ips: [],
    });
  });
});
