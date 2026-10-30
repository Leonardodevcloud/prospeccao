import { criarPool, migrar, type Pool } from '@prospeccao/db';
import { bancoDeTeste } from '@prospeccao/db/teste';
import { criarLogger } from '@prospeccao/shared';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../src/app.js';
import type { DominiosSite, SituacaoDominio } from '../src/modulos/marca/vercel.js';
import { linkDaSala } from '../src/modulos/reunioes/repositorio.js';
import type { ServicosConta } from '../src/servicos.js';

const URL_TESTE = process.env.TEST_DATABASE_URL;
const ORIGEM = 'http://localhost:5173';
const DOMINIO = 'crm.horizonte.com.br';
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** Vercel de mentira: o DNS "chega" quando o teste manda. */
const vercel = {
  configurado: false,
  adicionados: [] as string[],
  removidos: [] as string[],
  situacao(d: string): SituacaoDominio {
    return {
      verificado: true,
      configurado: this.configurado,
      registros: [
        { tipo: 'CNAME', nome: d.split('.')[0]!, host: d, valor: 'a229daa01fd8d731.vercel-dns-016.com' },
      ],
    };
  },
};
const site: DominiosSite = {
  async adicionar(d) {
    vercel.adicionados.push(d);
    return vercel.situacao(d);
  },
  async conferir(d) {
    return vercel.situacao(d);
  },
  async remover(d) {
    vercel.removidos.push(d);
  },
};

describe.skipIf(!URL_TESTE)('marca própria e domínio do cliente', () => {
  let pool: Pool;
  let app: ReturnType<typeof criarApp>;
  let master = '';
  let rui = '';
  let contaId = 0;
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
  const ler = (rota: string, c = rui) => request(app).get(rota).set('Cookie', c);
  const mandar = (
    metodo: 'post' | 'put' | 'patch' | 'delete',
    rota: string,
    corpo?: object,
    c = rui,
    origem = ORIGEM,
  ) => request(app)[metodo](rota).set('Origin', origem).set('Cookie', c).send(corpo);
  const entrar = (email: string, senha: string, origem = ORIGEM) =>
    request(app).post('/auth/login').set('Origin', origem).send({ email, senha });

  async function cliente(nome: string, email: string, plano: string) {
    const r = await mandar(
      'post',
      '/master/contas',
      { nome, admin: { nome: 'Rui', email }, plano: { plano, modulos: [] } },
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

  beforeAll(async () => {
    pool = criarPool({ url: await bancoDeTeste(URL_TESTE!, 'marca'), aplicacao: 'teste-marca', max: 4 });
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
        jwtSegredo: 'm'.repeat(40),
        adminEmail: 'dona@exemplo.com',
        adminSenhaHash: await bcrypt.hash('senha-forte-123', 4),
        sessaoHoras: 1,
        cookieSeguro: false,
      },
      origens: [ORIGEM],
      servicos,
      credenciais: { chave: null, ambiente: {}, invalidar() {} },
      dominiosSite: site,
    });
    master = cookieDe(await entrar('dona@exemplo.com', 'senha-forte-123'));
    const c = await cliente('Construtora Horizonte', 'rui@horizonte.com.br', 'escala');
    contaId = c.contaId;
    rui = c.cookie;
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('o administrador (uma unidade só) salva nome, cor, logo, ícone e imagem', async () => {
    const antes = (await ler('/marca')).body;
    expect(antes).toMatchObject({ podeEditar: true, dominioDisponivel: true, dominio: null, logo: false });
    expect((await mandar('put', '/marca', { icone: 'data:image/png;base64,AAAA' })).status).toBe(422);
    const r = await mandar('put', '/marca', {
      nome: 'Horizonte',
      cor: '#c2410c',
      logo: PNG,
      icone: PNG,
      imagem: PNG,
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      nome: 'Horizonte',
      cor: '#c2410c',
      logo: true,
      icone: true,
      imagem: true,
    });
    const ic = await ler('/marca/arquivo/icone');
    expect(ic.status).toBe(200);
    expect(ic.headers['content-type']).toBe('image/png');
    expect((await ler('/auth/eu')).body.marca.icone).toMatch(/^\/marca\/arquivo\/icone\?v=/);
  });

  it('domínio próprio: pendente não muda nada; ativo leva marca, login e links para o domínio; removido volta', async () => {
    expect((await mandar('post', '/marca/dominio', { dominio: 'app.prospectteam.com.br' })).status).toBe(422);
    const r = await mandar('post', '/marca/dominio', { dominio: 'https://CRM.Horizonte.com.br/login' });
    expect(r.status).toBe(200);
    expect(r.body.dominio).toMatchObject({
      endereco: DOMINIO,
      situacao: 'pendente',
      registros: [{ tipo: 'CNAME', nome: 'crm', valor: 'a229daa01fd8d731.vercel-dns-016.com' }],
    });
    expect(vercel.adicionados).toEqual([DOMINIO]);
    // Pendente: o endereço ainda não vale (nem marca, nem login por ele).
    expect((await request(app).get(`/publico/marca?host=${DOMINIO}`)).body).toEqual({ marca: null });
    expect((await entrar('rui@horizonte.com.br', 'senha-forte-1', `https://${DOMINIO}`)).status).toBe(403);

    // O DNS chegou.
    vercel.configurado = true;
    const conferiu = await mandar('post', '/marca/dominio/conferir');
    expect(conferiu.body.dominio).toMatchObject({ situacao: 'ativo', erro: null });

    const publica = (await request(app).get(`/publico/marca?host=${DOMINIO.toUpperCase()}`)).body.marca;
    expect(publica).toMatchObject({ nome: 'Horizonte', cor: '#c2410c' });
    expect(publica.logo).toContain('/publico/marca/arquivo/logo?host=');
    const img = await request(app).get(`/publico/marca/arquivo/imagem?host=${DOMINIO}`);
    expect(img.status).toBe(200);
    expect((await request(app).get(`/publico/marca/manifest?host=${DOMINIO}`)).body).toMatchObject({
      name: 'Horizonte',
      theme_color: '#c2410c',
    });
    // Login pelo domínio dele passa; links da conta saem com o domínio.
    expect((await entrar('rui@horizonte.com.br', 'senha-forte-1', `https://${DOMINIO}`)).status).toBe(200);
    expect((await ler('/auth/eu')).body.enderecoApp).toBe(`https://${DOMINIO}`);
    expect(linkDaSala('abcd-efgh', contaId)).toBe(`https://${DOMINIO}/r/abcd-efgh`);
    const conv = await mandar('post', '/equipe', {
      nome: 'Lia Souza',
      email: 'lia@horizonte.com.br',
      papel: 'sdr',
    });
    expect(conv.status).toBe(201);
    expect(conv.body.convite).toMatch(new RegExp(`^https://${DOMINIO.replace(/\./g, '\\.')}/convite/`));

    // Outra empresa não pega o mesmo endereço.
    const outro = await cliente('Outra Escala', 'ana@outra.com.br', 'escala');
    expect((await mandar('post', '/marca/dominio', { dominio: DOMINIO }, outro.cookie)).status).toBe(409);
    // Plano sem marca própria: não configura.
    const start = await cliente('Pet Start', 'leo@petstart.com.br', 'start');
    expect((await mandar('put', '/marca', { nome: 'Pet' }, start.cookie)).status).not.toBe(200);
    expect(
      (await mandar('post', '/marca/dominio', { dominio: 'crm.petstart.com.br' }, start.cookie)).status,
    ).not.toBe(200);

    // Removeu: volta ao endereço do sistema.
    const tirou = await mandar('delete', '/marca/dominio');
    expect(tirou.body.dominio).toBeNull();
    expect(vercel.removidos).toEqual([DOMINIO]);
    expect((await request(app).get(`/publico/marca?host=${DOMINIO}`)).body).toEqual({ marca: null });
    expect(linkDaSala('abcd-efgh', contaId)).not.toContain(DOMINIO);
    expect((await entrar('rui@horizonte.com.br', 'senha-forte-1', `https://${DOMINIO}`)).status).toBe(403);
  });
});
