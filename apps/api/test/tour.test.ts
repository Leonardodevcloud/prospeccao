import { criarPool, migrar, type Pool } from '@prospeccao/db';
import { bancoDeTeste } from '@prospeccao/db/teste';
import { criarLogger } from '@prospeccao/shared';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../src/app.js';
import type { ServicosConta } from '../src/servicos.js';

const URL_TESTE = process.env.TEST_DATABASE_URL;
const ORIGEM = 'http://localhost:5173';

/** O tour do sistema: o convite some depois de visto e o áudio é gerado uma vez e guardado. */
describe.skipIf(!URL_TESTE)('tour do sistema', () => {
  let pool: Pool;
  let app: ReturnType<typeof criarApp>;
  let rui = '';
  const falados: { texto: string; voz: string; velocidade: number }[] = [];
  const log = criarLogger('teste', 'silent');
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
  const entrar = (email: string, senha: string) =>
    request(app).post('/auth/login').set('Origin', ORIGEM).send({ email, senha });

  beforeAll(async () => {
    pool = criarPool({ url: await bancoDeTeste(URL_TESTE!, 'tour'), aplicacao: 'teste-tour', max: 4 });
    await migrar(pool, log);
    app = criarApp({
      pool,
      log,
      filas: {
        async publicar() {
          return 'job';
        },
        async publicarVarios(_n: string, p: unknown[]) {
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
        jwtSegredo: 't'.repeat(40),
        adminEmail: 'dona@exemplo.com',
        adminSenhaHash: await bcrypt.hash('senha-forte-123', 4),
        sessaoHoras: 1,
        cookieSeguro: false,
      },
      origens: [ORIGEM],
      servicos,
      credenciais: { chave: null, ambiente: {}, invalidar() {} },
      assistente: {
        leitura: null,
        chave: null,
        voz: null,
        raciocinio: 'desligado',
        erro: null,
        fala: {
          nome: 'teste',
          async falar(texto: string, opcoes: { voz: string; velocidade: number }) {
            falados.push({ texto, ...opcoes });
            return new TextEncoder().encode(`mp3:${texto.slice(0, 10)}`);
          },
          async falarFluxo() {
            throw new Error('não usado');
          },
        },
      },
    } as never);
    const master = cookieDe(await entrar('dona@exemplo.com', 'senha-forte-123'));
    const r = await request(app)
      .post('/master/contas')
      .set('Origin', ORIGEM)
      .set('Cookie', master)
      .send({
        nome: 'Clínica Horizonte',
        admin: { nome: 'Rui', email: 'rui@horizonte.com.br' },
        plano: { plano: 'time', modulos: ['whatsapp'] },
      });
    expect(r.status).toBe(201);
    const conta = (await request(app).get(`/master/contas/${r.body.id}`).set('Cookie', master)).body as {
      usuarios: { id: number }[];
    };
    await request(app)
      .patch(`/master/usuarios/${conta.usuarios[0]!.id}/acesso`)
      .set('Origin', ORIGEM)
      .set('Cookie', master)
      .send({ senha: 'senha-forte-1' });
    rui = cookieDe(await entrar('rui@horizonte.com.br', 'senha-forte-1'));
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('convite até ver, voz da plataforma e áudio guardado', async () => {
    expect((await request(app).get('/auth/eu').set('Cookie', rui)).body.tour).toEqual({ visto: false });
    const cfg = await request(app).get('/tour').set('Cookie', rui);
    expect(cfg.body).toEqual({ vozServidor: true, velocidade: 1.12 });

    const a1 = await request(app).get('/tour/audio/meu-dia?v=-').set('Cookie', rui);
    expect(a1.status).toBe(200);
    expect(a1.headers['content-type']).toBe('audio/mpeg');
    expect(falados).toHaveLength(1);
    expect(falados[0]).toMatchObject({ voz: 'marin', velocidade: 1.12 });
    expect(falados[0]!.texto).toMatch(/^Começando pelo Meu dia/);
    // A segunda vez sai do banco (mesmo depois de reiniciar: a chave é a voz + a velocidade + o texto).
    await request(app).get('/tour/audio/meu-dia?v=-').set('Cookie', rui);
    expect(falados).toHaveLength(1);
    expect((await pool.query('SELECT count(*)::int AS n FROM cadastro.tour_audios')).rows[0].n).toBe(1);
    // Só as falas do tour.
    expect((await request(app).get('/tour/audio/qualquer-coisa').set('Cookie', rui)).status).toBe(404);

    expect((await request(app).post('/tour/visto').set('Origin', ORIGEM).set('Cookie', rui)).status).toBe(
      200,
    );
    expect((await request(app).get('/auth/eu').set('Cookie', rui)).body.tour).toEqual({ visto: true });
  });
});
