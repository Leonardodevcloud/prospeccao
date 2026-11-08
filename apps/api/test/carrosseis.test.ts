import { criarPool, migrar, type Pool } from '@prospeccao/db';
import { bancoDeTeste } from '@prospeccao/db/teste';
import type { Armazenamento } from '@prospeccao/integrations/reuniao';
import { criarLogger } from '@prospeccao/shared';
import { IDENTIDADE_PADRAO, slideNovo } from '@prospeccao/shared/carrosseis';
import bcrypt from 'bcryptjs';
import { unzipSync } from 'fflate';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../src/app.js';
import type { ServicosConta } from '../src/servicos.js';

const URL_TESTE = process.env.TEST_DATABASE_URL;
const ORIGEM = 'http://localhost:5173';

/** Bucket de mentira na memória. */
const arquivos = new Map<string, Uint8Array>();
const armazenamento = {
  destino: { endpoint: 'https://arm', regiao: 'auto', bucket: 'b', chave: 'k', segredo: 's'.repeat(10) },
  async urlAssinada(chave: string) {
    return `https://arm/b/${chave}`;
  },
  async apagar(chaves: string[]) {
    for (const k of chaves) arquivos.delete(k);
  },
  async testar() {
    return 'ok';
  },
  async enviar(chave: string, corpo: Uint8Array) {
    arquivos.set(chave, new Uint8Array(corpo));
  },
  async ler(chave: string) {
    const a = arquivos.get(chave);
    if (!a) throw new Error(`sem ${chave}`);
    return a;
  },
} as unknown as Armazenamento;

const binario = (r: request.Request) =>
  r.buffer(true).parse((res, fim) => {
    const pedacos: Buffer[] = [];
    res.on('data', (p: Buffer) => pedacos.push(p));
    res.on('end', () => fim(null, Buffer.concat(pedacos)));
  });

describe.skipIf(!URL_TESTE)('carrosséis (com Postgres)', () => {
  let pool: Pool;
  let app: ReturnType<typeof criarApp>;
  let master = '';
  const log = criarLogger('teste', (process.env.LOG_TESTE as 'error') ?? 'silent');
  const servicos = async (id: number): Promise<ServicosConta> => ({
    contaId: id,
    whatsapp: null,
    ia: null,
    classificarEmail: null,
    personalizarAbertura: null,
    email: null,
    assistente: null,
    geocodificar: async () => null,
    rotas: null,
    origem: { places: null, ors: null, resend: null, whatsapp: null, ia: null },
    iaDescricao: null,
    erro: null,
  });
  const cookieDe = (r: request.Response) =>
    (r.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
  const ler = (rota: string, c: string) => request(app).get(rota).set('Cookie', c);
  const mandar = (
    metodo: 'post' | 'put' | 'patch' | 'delete',
    rota: string,
    corpo: object | undefined,
    c: string,
  ) => request(app)[metodo](rota).set('Origin', ORIGEM).set('Cookie', c).send(corpo);
  const entrar = (email: string, senha: string) =>
    request(app).post('/auth/login').set('Origin', ORIGEM).send({ email, senha });

  async function cliente(nome: string, email: string) {
    const r = await mandar(
      'post',
      '/master/contas',
      { nome, admin: { nome: 'Rui', email }, plano: { plano: 'escala', modulos: [] } },
      master,
    );
    expect(r.status).toBe(201);
    const conta = (await ler(`/master/contas/${r.body.id}`, master)).body as { usuarios: { id: number }[] };
    await mandar(
      'patch',
      `/master/usuarios/${conta.usuarios[0]!.id}/acesso`,
      { senha: 'senha-forte-1' },
      master,
    );
    return { contaId: r.body.id as number, cookie: cookieDe(await entrar(email, 'senha-forte-1')) };
  }
  const liberar = async (contaId: number, modulos: string[]) => {
    const r = await mandar('put', `/master/contas/${contaId}/plano`, { plano: 'escala', modulos }, master);
    expect(r.status).toBe(200);
  };

  let rui = { contaId: 0, cookie: '' };
  let bia = { contaId: 0, cookie: '' };

  beforeAll(async () => {
    pool = criarPool({
      url: await bancoDeTeste(URL_TESTE!, 'carrosseis'),
      aplicacao: 'teste-carrosseis',
      max: 4,
    });
    await migrar(pool, log);
    app = criarApp({
      pool,
      log,
      filas: {
        async publicar() {
          return 'job';
        },
        async publicarVarios(_n, p) {
          return p.length;
        },
        async cancelarPendentes() {
          return 0;
        },
        async tamanhos() {
          return {};
        },
      },
      auth: {
        jwtSegredo: 'c'.repeat(40),
        adminEmail: 'dona@exemplo.com',
        adminSenhaHash: await bcrypt.hash('senha-forte-123', 4),
        sessaoHoras: 1,
        cookieSeguro: false,
      },
      origens: [ORIGEM],
      servicos,
      credenciais: { chave: null, ambiente: {}, invalidar() {} },
      reunioes: { armazenamento } as never,
    });
    master = cookieDe(await entrar('dona@exemplo.com', 'senha-forte-123'));
    rui = await cliente('Auto Peças Horizonte', 'rui@horizonte.com.br');
    bia = await cliente('Distribuidora Sul', 'bia@sul.com.br');
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  it('sem o módulo: a situação responde e o resto fica fechado', async () => {
    const s = await ler('/carrosseis/situacao', rui.cookie);
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ modulo: false, armazenamento: true });
    const lista = await ler('/carrosseis', rui.cookie);
    expect(lista.status).toBe(403);
    expect(lista.body.erro.codigo).toBe('fora_do_plano');
    expect(lista.body.erro.mensagem).toMatch(/módulo à parte/);
  });

  it('com o módulo: franquia do plano, e só o administrador entra', async () => {
    await liberar(rui.contaId, ['carrosseis']);
    const s = await ler('/carrosseis/situacao', rui.cookie);
    expect(s.body).toMatchObject({ modulo: true, franquia: { usados: 0, limite: 20 } });

    const conv = await mandar(
      'post',
      '/equipe',
      { nome: 'Lia Souza', email: 'lia@horizonte.com.br', papel: 'sdr' },
      rui.cookie,
    );
    expect(conv.status).toBe(201);
    const token = (conv.body.convite as string).split('/').at(-1)!;
    const lia = await request(app)
      .post(`/auth/convite/${token}`)
      .set('Origin', ORIGEM)
      .send({ senha: 'senha-da-lia-1' });
    expect(lia.status).toBe(200);
    expect((await ler('/carrosseis', cookieDe(lia))).status).toBe(403);
  });

  it('identidade visual: padrão, salvar e avisar o contraste ajustado', async () => {
    const antes = await ler('/carrosseis/identidade', rui.cookie);
    expect(antes.status).toBe(200);
    expect(antes.body).toMatchObject({ salva: false, logos: { claro: null, escuro: null } });
    expect(antes.body.identidade.cores).toEqual(IDENTIDADE_PADRAO.cores);

    const ruim = { ...IDENTIDADE_PADRAO, cores: { ...IDENTIDADE_PADRAO.cores, principal: 'azul' } };
    expect((await mandar('put', '/carrosseis/identidade', ruim, rui.cookie)).status).toBe(422);

    const nova = {
      ...IDENTIDADE_PADRAO,
      cores: { principal: '#E63946', destaque: '#FFD166', claro: '#FFFFFF', texto: '#1D1D1D' },
      estilo: 'impacto',
      assinatura: '@horizontepecas',
      vende: 'Peças de freio e suspensão',
    };
    const r = await mandar('put', '/carrosseis/identidade', nova, rui.cookie);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.ajustes)).toBe(true);
    const depois = (await ler('/carrosseis/identidade', rui.cookie)).body;
    expect(depois).toMatchObject({
      salva: true,
      identidade: { estilo: 'impacto', assinatura: '@horizontepecas' },
    });
  });

  it('logo própria vai para o armazenamento e troca a antiga', async () => {
    const png = await sharp({
      create: { width: 600, height: 200, channels: 4, background: { r: 230, g: 57, b: 70, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const env = () =>
      request(app)
        .post('/carrosseis/identidade/logo/claro')
        .set('Origin', ORIGEM)
        .set('Cookie', rui.cookie)
        .set('Content-Type', 'image/png')
        .send(png);
    expect((await env()).status).toBe(201);
    const primeira = [...arquivos.keys()].filter((k) => k.includes('/logos/'));
    expect(primeira).toHaveLength(1);
    expect(primeira[0]).toMatch(new RegExp(`^carrosseis/${rui.contaId}/logos/claro-`));
    expect((await env()).status).toBe(201);
    const segunda = [...arquivos.keys()].filter((k) => k.includes('/logos/'));
    expect(segunda).toHaveLength(1);
    expect(segunda[0]).not.toBe(primeira[0]);

    const id = (await ler('/carrosseis/identidade', rui.cookie)).body;
    expect(id.logos.claro).toMatchObject({ origem: 'propria', largura: 600, altura: 200 });
    const img = await binario(ler('/carrosseis/identidade/logo/claro', rui.cookie));
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');

    expect((await mandar('delete', '/carrosseis/identidade/logo/claro', undefined, rui.cookie)).status).toBe(
      200,
    );
    expect([...arquivos.keys()].filter((k) => k.includes('/logos/'))).toHaveLength(0);
  });

  let fotoId = 0;
  it('fotos da empresa: pequena demais não entra; a boa fica e sai reduzida', async () => {
    const enviar = (b: Buffer) =>
      request(app)
        .post('/carrosseis/fotos?nome=Loja.jpg')
        .set('Origin', ORIGEM)
        .set('Cookie', rui.cookie)
        .set('Content-Type', 'image/jpeg')
        .send(b);
    const pequena = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#888' } })
      .jpeg()
      .toBuffer();
    const r1 = await enviar(pequena);
    expect(r1.status).toBe(422);
    expect(r1.body.erro.mensagem).toMatch(/pequena demais/);

    const boa = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#5a6b7c' } })
      .jpeg()
      .toBuffer();
    const r2 = await enviar(boa);
    expect(r2.status).toBe(201);
    expect(r2.body).toMatchObject({ nome: 'Loja', largura: 2160, altura: 1440 });
    fotoId = r2.body.id;

    const lista = (await ler('/carrosseis/fotos', rui.cookie)).body;
    expect(lista.fotos).toHaveLength(1);
    const mini = await binario(ler(`/carrosseis/fotos/${fotoId}/imagem?largura=300`, rui.cookie));
    expect(mini.status).toBe(200);
    expect((await sharp(mini.body as Buffer).metadata()).width).toBe(300);
  });

  let id = 0;
  it('cria, edita com versão (conflito é 409), duplica e não deixa outra conta ver', async () => {
    const novo = await mandar(
      'post',
      '/carrosseis',
      { titulo: 'Freio que chia', comeco: 'roteiro' },
      rui.cookie,
    );
    expect(novo.status).toBe(201);
    expect(novo.body).toMatchObject({
      titulo: 'Freio que chia',
      estilo: 'impacto',
      situacao: 'rascunho',
      versao: 1,
    });
    expect(novo.body.conteudo.length).toBeGreaterThanOrEqual(3);
    expect(novo.body.conteudo[0]).toMatchObject({ modelo: 'capa', titulo: 'Freio que chia' });
    id = novo.body.id;

    const slides = [
      { ...slideNovo('capa', 'a'), titulo: 'Freio chiando?', fotoId },
      {
        ...slideNovo('texto', 'b'),
        titulo: 'O que pode ser',
        texto: 'Pastilha gasta, disco riscado ou falta de lubrificação.',
      },
      { ...slideNovo('chamada', 'c'), titulo: 'Fale com a gente', texto: 'Orçamento no WhatsApp.' },
    ];
    const salvo = await mandar(
      'put',
      `/carrosseis/${id}`,
      {
        titulo: 'Freio chiando',
        estilo: 'impacto',
        slides,
        legenda: 'Seu freio está chiando? Veja as causas.',
        versao: 1,
      },
      rui.cookie,
    );
    expect(salvo.status).toBe(200);
    expect(salvo.body.versao).toBe(2);
    expect(salvo.body.conteudo[0].fotoId).toBe(fotoId);

    // Outra aba ainda na versão 1.
    const velho = await mandar(
      'put',
      `/carrosseis/${id}`,
      { titulo: 'X', estilo: 'impacto', slides, legenda: '', versao: 1 },
      rui.cookie,
    );
    expect(velho.status).toBe(409);
    expect(velho.body.erro.codigo).toBe('versao');

    // Foto de outra conta (ou inexistente) sai do slide.
    const semFoto = await mandar(
      'put',
      `/carrosseis/${id}`,
      {
        titulo: 'Freio chiando',
        estilo: 'impacto',
        slides: [{ ...slides[0]!, fotoId: 999_999 }, ...slides.slice(1)],
        legenda: 'Seu freio está chiando? Veja as causas.',
        versao: 2,
      },
      rui.cookie,
    );
    expect(semFoto.body.conteudo[0].fotoId).toBeNull();
    await mandar(
      'put',
      `/carrosseis/${id}`,
      {
        titulo: 'Freio chiando',
        estilo: 'impacto',
        slides,
        legenda: 'Seu freio está chiando? Veja as causas.',
        versao: 3,
      },
      rui.cookie,
    );

    const copia = await mandar('post', `/carrosseis/${id}/duplicar`, undefined, rui.cookie);
    expect(copia.status).toBe(201);
    expect(copia.body).toMatchObject({ titulo: 'Freio chiando (cópia)', situacao: 'rascunho' });
    expect((await ler('/carrosseis', rui.cookie)).body.carrosseis).toHaveLength(2);

    // A outra conta, mesmo com o módulo, não enxerga.
    await liberar(bia.contaId, ['carrosseis']);
    expect((await ler(`/carrosseis/${id}`, bia.cookie)).status).toBe(404);
    expect((await ler('/carrosseis', bia.cookie)).body.carrosseis).toHaveLength(0);
    expect((await mandar('delete', `/carrosseis/${id}`, undefined, bia.cookie)).status).toBe(404);
  });

  it('prévia, miniatura com ETag e o .zip com as imagens e a legenda', async () => {
    const previa = await binario(
      mandar(
        'post',
        '/carrosseis/previa',
        {
          slide: { ...slideNovo('numero', 'z'), numero: '87%', texto: 'dos clientes voltam' },
          indice: 1,
          total: 5,
          estilo: 'clean',
          largura: 540,
        },
        rui.cookie,
      ),
    );
    expect(previa.status).toBe(200);
    expect(previa.headers['content-type']).toBe('image/jpeg');
    expect(await sharp(previa.body as Buffer).metadata()).toMatchObject({
      format: 'jpeg',
      width: 540,
      height: 675,
    });

    const mini = await binario(ler(`/carrosseis/${id}/slides/0?largura=270`, rui.cookie));
    expect(mini.status).toBe(200);
    const etag = mini.headers.etag as string;
    expect(etag).toBeTruthy();
    expect(
      (await ler(`/carrosseis/${id}/slides/0?largura=270`, rui.cookie).set('If-None-Match', etag)).status,
    ).toBe(304);
    expect((await ler(`/carrosseis/${id}/slides/9`, rui.cookie)).status).toBe(404);

    const zip = await binario(ler(`/carrosseis/${id}/imagens.zip`, rui.cookie));
    expect(zip.status).toBe(200);
    expect(zip.headers['content-type']).toBe('application/zip');
    const dentro = unzipSync(new Uint8Array(zip.body as Buffer));
    expect(Object.keys(dentro).sort()).toEqual([
      '01-capa.jpg',
      '02-texto.jpg',
      '03-chamada.jpg',
      'legenda.txt',
    ]);
    expect(await sharp(Buffer.from(dentro['01-capa.jpg']!)).metadata()).toMatchObject({
      width: 1080,
      height: 1350,
    });
    expect(new TextDecoder().decode(dentro['legenda.txt'])).toBe('Seu freio está chiando? Veja as causas.');
  }, 60_000);

  it('apagar a foto tira ela dos slides; apagar o carrossel some da lista', async () => {
    expect((await mandar('delete', `/carrosseis/fotos/${fotoId}`, undefined, rui.cookie)).status).toBe(200);
    expect((await ler(`/carrosseis/${id}`, rui.cookie)).body.conteudo[0].fotoId).toBeNull();
    expect([...arquivos.keys()].filter((k) => k.includes('/fotos/'))).toHaveLength(0);
    expect((await mandar('delete', `/carrosseis/${id}`, undefined, rui.cookie)).status).toBe(200);
    expect((await ler('/carrosseis', rui.cookie)).body.carrosseis).toHaveLength(1);
  });
});
