import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  converterPerfil,
  extrairContatos,
  instagramNosResultados,
  interpretarLinkedin,
  lerAvaliacao,
  lerSite,
  normalizarSite,
  usuarioInstagram,
  variacoesDoSite,
  verificarWhatsapp,
} from '../src/enriquecimento/index.js';

const HOME = `<html><head><title>Auto Peças Ladeira | Salvador</title><script>var x="naoeemail@sentry.io"</script></head>
<body>
  <a href="/fale-conosco">Fale conosco</a> <a href="https://outro.com/contato">fora</a>
  <a href="https://wa.me/5571998124410?text=oi">WhatsApp</a>
  <a href="https://www.instagram.com/autopecasladeira/">Insta</a>
  <a href="https://www.facebook.com/sharer/sharer.php?u=x">compartilhar</a>
  <a href="https://www.facebook.com/autopecasladeira">Face</a>
  <a href="https://www.linkedin.com/company/ladeira-pecas">LinkedIn</a>
  <p>Ligue (71) 3241-0098 · CNPJ 11.222.333/0001-81 · logo@2x.png</p>
</body></html>`;
const CONTATO = `<html><body><h1>Contato</h1><p>Compras: <a href="mailto:compras@ladeira.com.br">compras@ladeira.com.br</a></p>
<p>Gerente: Carlos Mendes</p><a href="tel:+55 71 3241-0099">tel</a></body></html>`;

describe('site da empresa', () => {
  let servidor: Server;
  let base: string;
  beforeAll(async () => {
    servidor = createServer((req, res) => {
      if (req.url === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end(HOME);
      if (req.url === '/fale-conosco')
        return res.writeHead(200, { 'content-type': 'text/html' }).end(CONTATO);
      res.writeHead(404).end();
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((ok) => servidor.close(() => ok())));

  it('extrai contatos e perfis do HTML, sem lixo', () => {
    const c = extrairContatos(HOME);
    expect(c.whatsapps).toEqual(['71998124410']);
    expect(c.telefones).toEqual(['7132410098']);
    expect(c.instagram).toBe('autopecasladeira');
    expect(c.facebook).toBe('https://www.facebook.com/autopecasladeira');
    expect(c.linkedinEmpresa).toContain('/company/ladeira-pecas');
    expect(c.cnpjs).toEqual(['11222333000181']);
    expect(c.emails).toEqual([]); // sentry e imagem @2x descartados
  });

  it('lê a home e a página de contato do mesmo domínio', async () => {
    const r = await lerSite(base);
    expect(r?.paginas.map((p) => new URL(p.url).pathname)).toEqual(['/', '/fale-conosco']);
    expect(r?.emails).toEqual(['compras@ladeira.com.br']);
    expect(r?.telefones).toEqual(expect.arrayContaining(['7132410098', '7132410099']));
    expect(r?.texto).toContain('Gerente: Carlos Mendes');
  });

  it('site fora do ar não quebra', async () => {
    expect(await lerSite(`${base}/nada`)).toBeNull();
  });

  it('não confunde rede social com site', () => {
    expect(normalizarSite('instagram.com/loja')).toBeNull();
    expect(normalizarSite('www.ladeira.com.br/')).toBe('https://www.ladeira.com.br');
    expect(usuarioInstagram('https://instagram.com/p/abc')).toBeNull();
    expect(usuarioInstagram('@Loja.Pecas')).toBe('loja.pecas');
  });
});

describe('Google, LinkedIn e Instagram', () => {
  it('lê pessoa do título do LinkedIn', () => {
    expect(
      interpretarLinkedin({
        titulo: 'Maria Souza - Compradora - Ladeira Auto Peças | LinkedIn',
        url: 'https://br.linkedin.com/in/mariasouza?trk=x',
        descricao: '',
      }),
    ).toEqual({
      nome: 'Maria Souza',
      cargo: 'Compradora',
      empresa: 'Ladeira Auto Peças',
      url: 'https://br.linkedin.com/in/mariasouza',
    });
    expect(
      interpretarLinkedin({
        titulo: 'Ladeira | LinkedIn',
        url: 'https://linkedin.com/company/x',
        descricao: '',
      }),
    ).toBeNull();
  });

  it('ignora páginas de tópico do Instagram e perfis de outra empresa', () => {
    const resultados = [
      {
        titulo: 'Auto peças em Salvador',
        url: 'https://www.instagram.com/popular/auto-pecas-salvador/',
        descricao: '',
      },
      {
        titulo: 'Casa das Peças (@casadaspecas)',
        url: 'https://www.instagram.com/casadaspecas/',
        descricao: '',
      },
      {
        titulo: 'Lojão Auto Peças (@lojaoautopecas)',
        url: 'https://www.instagram.com/lojaoautopecas/',
        descricao: '',
      },
    ];
    expect(instagramNosResultados(resultados, 'Lojão Auto Peças - Baixa de Quintas')).toBe('lojaoautopecas');
    expect(instagramNosResultados(resultados.slice(0, 2), 'Lojão Auto Peças')).toBeNull();
    expect(usuarioInstagram('https://www.instagram.com/popular/x/')).toBeNull();
  });

  it('tenta o site com e sem www e sem https', () => {
    expect(variacoesDoSite('https://lojao.com.br')).toEqual([
      'https://lojao.com.br',
      'https://www.lojao.com.br',
      'http://lojao.com.br',
      'http://www.lojao.com.br',
    ]);
  });

  it('acha o perfil de Instagram nos resultados', () => {
    expect(
      instagramNosResultados([
        { titulo: 'post', url: 'https://www.instagram.com/p/Cx1/', descricao: '' },
        {
          titulo: 'Ladeira (@autopecasladeira)',
          url: 'https://www.instagram.com/autopecasladeira/',
          descricao: '',
        },
      ]),
    ).toBe('autopecasladeira');
  });

  it('converte perfil do Instagram com WhatsApp na bio', () => {
    const p = converterPerfil({
      username: 'AutoPecasLadeira',
      fullName: 'Ladeira Auto Peças',
      biography: 'Peças para todas as marcas 🚗 Entregamos em Salvador! Pedidos: (71) 99812-4410',
      externalUrl: 'https://wa.me/5571998124410',
      followersCount: 4210,
      businessEmail: 'Contato@Ladeira.com.br',
    });
    expect(p).toMatchObject({
      usuario: 'autopecasladeira',
      seguidores: 4210,
      email: 'contato@ladeira.com.br',
      whatsapps: ['71998124410'],
      telefonesNaBio: [],
    });
  });
});

describe('IA e WhatsApp', () => {
  it('valida a resposta da IA', () => {
    const a = lerAvaliacao(
      JSON.stringify({
        faixa: 'Z',
        score: 140,
        motivo: 'x',
        resumo: 'y',
        pessoas: [
          { nome: 'Carlos Mendes', cargo: 'Gerente', papel: 'gestao' },
          { nome: 'Carlos', papel: 'outro' },
        ],
      }),
    );
    expect(a.faixa).toBe('C');
    expect(a.score).toBe(100);
    expect(a.pessoas).toEqual([{ nome: 'Carlos Mendes', cargo: 'Gerente', papel: 'gestao', trecho: null }]);
  });

  it('confere WhatsApp pela Z-API (um número por vez, com o Client-Token)', async () => {
    const pedidos: string[] = [];
    const s = createServer((req, res) => {
      pedidos.push(`${req.method} ${req.url} ${req.headers['client-token'] ?? '-'}`);
      const tem = req.url?.endsWith('/phone-exists/5571998124410');
      // A Z-API já respondeu em objeto e em lista: os dois valem.
      const corpo = tem ? [{ exists: true, phone: '5571998124410', lid: '1@lid' }] : { exists: false };
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(corpo));
    });
    await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
    const base = `http://127.0.0.1:${(s.address() as AddressInfo).port}/instances`;
    const r = await verificarWhatsapp({ instancia: 'inst1', token: 'tok', clientToken: 'ct', base }, [
      '71998124410',
      '7132410098',
    ]);
    expect(pedidos).toEqual([
      'GET /instances/inst1/token/tok/phone-exists/5571998124410 ct',
      'GET /instances/inst1/token/tok/phone-exists/557132410098 ct',
    ]);
    expect([...r]).toEqual([
      ['71998124410', true],
      ['7132410098', false],
    ]);
    await new Promise<void>((ok) => s.close(() => ok()));
  });
});
