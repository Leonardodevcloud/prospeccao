import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { criarPool, migrar, type Pool } from '@prospeccao/db';
import { bancoDeTeste } from '@prospeccao/db/teste';
import { criarLogger } from '@prospeccao/shared';
import { DOSSIE_VAZIO } from '@prospeccao/shared/carrosseis-time';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../src/app.js';
import { comConta } from '../src/contexto.js';
import { fontesParaOsFatos } from '../src/modulos/carrosseis/cerebro.js';
import { permitirRedeLocal } from '../src/modulos/segundo-cerebro/servico.js';
import type { ServicosConta } from '../src/servicos.js';

const URL_TESTE = process.env.TEST_DATABASE_URL;
const ORIGEM = 'http://localhost:5173';
const TOKEN = `cbr_${'a'.repeat(40)}`;

/** O Cérebro de mentira: responde como o /api/externo do repositório brain. */
const pedidos: { metodo: string; caminho: string; corpo: unknown; cabecalhos: Record<string, unknown> }[] =
  [];
let foraDoAr = false;
const rascunhos = new Map<string, string>();

function cerebroFalso(): Server {
  return createServer((req, res) => {
    let bruto = '';
    req.on('data', (p) => {
      bruto += p;
    });
    req.on('end', () => {
      const corpo = bruto ? JSON.parse(bruto) : null;
      pedidos.push({ metodo: req.method ?? '', caminho: req.url ?? '', corpo, cabecalhos: req.headers });
      const json = (status: number, d: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(d));
      };
      if (foraDoAr) return json(503, { erro: { codigo: 'fora', mensagem: 'Cérebro em manutenção.' } });
      if (req.headers.authorization !== `Bearer ${TOKEN}`)
        return json(401, {
          erro: { codigo: 'nao_autenticado', mensagem: 'Token do Cérebro inválido ou revogado.' },
        });
      if (req.url === '/api/externo/saude')
        return json(200, {
          ok: true,
          cerebro: 'Cérebro · Central Tutts',
          usuario: { nome: 'Leonardo', papel: 'admin' },
          pode: { buscar: true, ler: true, guardarRascunho: true },
        });
      if (req.url === '/api/externo/buscar') {
        const p = String(corpo?.pergunta ?? '');
        if (/zebra/.test(p)) return json(200, { itens: [], lacuna: true });
        return json(200, {
          itens: [
            {
              codigo: 'POL-002',
              titulo: 'Prazo de entrega em Salvador',
              tipo: 'politica',
              tipoNome: 'Política',
              status: 'vigente',
              versao: 2,
              emRevisao: false,
              trecho: 'Entrega em até 40 minutos em Salvador, das 8h às 18h. Contato: [EMAIL_1].',
              link: 'https://cerebro.exemplo/registros/POL-002',
            },
          ],
          lacuna: false,
        });
      }
      if (req.url === '/api/externo/rascunhos') {
        const chave = String(corpo?.idExterno ?? '');
        const ja = rascunhos.get(chave);
        if (ja)
          return json(200, {
            codigo: ja,
            status: 'rascunho',
            link: `https://cerebro.exemplo/registros/${ja}`,
            jaExistia: true,
          });
        const codigo = `NOT-${String(rascunhos.size + 1).padStart(3, '0')}`;
        rascunhos.set(chave, codigo);
        return json(201, {
          codigo,
          status: 'rascunho',
          link: `https://cerebro.exemplo/registros/${codigo}`,
          jaExistia: false,
        });
      }
      json(404, { erro: { codigo: 'nao_encontrado', mensagem: 'Rota não encontrada.' } });
    });
  });
}

describe.skipIf(!URL_TESTE)('segundo cérebro: o Prospect Team lê o Cérebro e devolve o que aprendeu', () => {
  let pool: Pool;
  let app: ReturnType<typeof criarApp>;
  let brain: Server;
  let urlBrain = '';
  let master = '';
  let rui = { contaId: 0, cookie: '' };
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
  const ler = (rota: string, c = rui.cookie) => request(app).get(rota).set('Cookie', c);
  const mandar = (
    metodo: 'post' | 'put' | 'patch' | 'delete',
    rota: string,
    corpo?: object,
    c = rui.cookie,
  ) => request(app)[metodo](rota).set('Origin', ORIGEM).set('Cookie', c).send(corpo);
  const entrar = (email: string, senha: string) =>
    request(app).post('/auth/login').set('Origin', ORIGEM).send({ email, senha });

  beforeAll(async () => {
    permitirRedeLocal(true);
    brain = cerebroFalso().listen(0);
    urlBrain = `http://127.0.0.1:${(brain.address() as AddressInfo).port}`;
    pool = criarPool({
      url: await bancoDeTeste(URL_TESTE!, 'segundo_cerebro'),
      aplicacao: 'teste-cerebro',
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
        jwtSegredo: 't'.repeat(40),
        adminEmail: 'dona@exemplo.com',
        adminSenhaHash: await bcrypt.hash('senha-forte-123', 4),
        sessaoHoras: 1,
        cookieSeguro: false,
      },
      origens: [ORIGEM],
      servicos,
      credenciais: { chave: 'c'.repeat(32), ambiente: {}, invalidar() {} },
      meta: null,
    });
    master = cookieDe(await entrar('dona@exemplo.com', 'senha-forte-123'));
    // Plano sem a API aberta: o segundo cérebro vale para qualquer conta.
    const r = await mandar(
      'post',
      '/master/contas',
      {
        nome: 'Auto Peças Horizonte',
        admin: { nome: 'Rui', email: 'rui@horizonte.com.br' },
        plano: { plano: 'start' },
      },
      master,
    );
    expect(r.status).toBe(201);
    const conta = (await ler(`/master/contas/${r.body.id}`, master)).body as { usuarios: { id: number }[] };
    await request(app)
      .patch(`/master/usuarios/${conta.usuarios[0]!.id}/acesso`)
      .set('Origin', ORIGEM)
      .set('Cookie', master)
      .send({ senha: 'senha-forte-1' });
    rui = { contaId: r.body.id, cookie: cookieDe(await entrar('rui@horizonte.com.br', 'senha-forte-1')) };
  }, 60_000);

  afterAll(async () => {
    permitirRedeLocal(false);
    brain?.close();
    await pool?.end();
  });

  it('começa desconectado e recusa token errado sem guardar nada', async () => {
    expect((await ler('/segundo-cerebro')).body).toMatchObject({ conectado: false });
    const ruim = await mandar('put', '/segundo-cerebro', { url: urlBrain, token: `cbr_${'b'.repeat(40)}` });
    expect(ruim.status).toBe(422);
    expect(ruim.body.erro.mensagem).toContain('Token do Cérebro inválido');
    const semCbr = await mandar('put', '/segundo-cerebro', { url: urlBrain, token: 'x'.repeat(40) });
    expect(semCbr.status).toBe(422);
    expect((await ler('/segundo-cerebro')).body).toMatchObject({ conectado: false });
  });

  it('conecta testando, completa o endereço e guarda o token cifrado', async () => {
    const r = await mandar('put', '/segundo-cerebro', { url: urlBrain, token: TOKEN });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      conectado: true,
      ligado: true,
      url: `${urlBrain}/api/externo`,
      tokenFinal: 'aaaa',
      usuarioNoCerebro: 'Leonardo',
    });
    expect(JSON.stringify(r.body)).not.toContain(TOKEN);
    const { rows } = await pool.query<{ token_cifrado: string }>(
      'SELECT token_cifrado FROM comercial.segundo_cerebro WHERE conta_id = $1',
      [rui.contaId],
    );
    expect(rows[0]!.token_cifrado).not.toContain(TOKEN);
    expect(pedidos.at(-1)!.cabecalhos['x-sistema']).toBe('Prospect Team');
  });

  it('o time recebe os trechos do Cérebro como fontes (e a busca vazia não quebra)', async () => {
    const fontes = await comConta(rui.contaId, () =>
      fontesParaOsFatos(pool, {
        dossie: DOSSIE_VAZIO,
        empresa: 'Auto Peças Horizonte',
        divulgar: null,
        assunto: 'Prazo de entrega',
      }),
    );
    const doCerebro = fontes.find((f) => f.rotulo.startsWith('Segundo cérebro'));
    expect(doCerebro?.rotulo).toBe('Segundo cérebro · POL-002 Prazo de entrega em Salvador');
    expect(doCerebro?.texto).toContain('40 minutos');
    expect(pedidos.filter((p) => p.caminho === '/api/externo/buscar').at(-1)!.corpo).toMatchObject({
      pergunta: 'Prazo de entrega',
    });
    const exp = await mandar('post', '/segundo-cerebro/experimentar', { pergunta: 'prazo de entrega' });
    expect(exp.status).toBe(200);
    expect(exp.body.itens[0]).toMatchObject({ codigo: 'POL-002' });
    expect(exp.body.estado.leituras).toBeGreaterThan(0);
    const vazio = await mandar('post', '/segundo-cerebro/experimentar', { pergunta: 'zebra voadora' });
    expect(vazio.body.itens).toEqual([]);
  });

  it('Cérebro fora do ar: o time segue sem ele e o erro aparece na tela', async () => {
    foraDoAr = true;
    const exp = await mandar('post', '/segundo-cerebro/experimentar', { pergunta: 'prazo' });
    expect(exp.status).toBe(200);
    expect(exp.body.itens).toEqual([]);
    expect(exp.body.estado.erro).toContain('manutenção');
    const teste = await mandar('post', '/segundo-cerebro/testar');
    expect(teste.status).toBe(422);
    foraDoAr = false;
    const volta = await mandar('post', '/segundo-cerebro/testar');
    expect(volta.status).toBe(200);
    expect(volta.body.erro).toBeNull();
  });

  it('sem números do Instagram, não manda nota vazia', async () => {
    const r = await mandar('post', '/segundo-cerebro/enviar-agora');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ enviado: false });
    expect(r.body.motivo).toContain('Instagram');
  });

  it('manda o que o Instagram ensinou como rascunho, sem duplicar na semana', async () => {
    await pool.query(
      `INSERT INTO comercial.instagram_midias (conta_id, midia_id, tipo, legenda, publicado_em, alcance, salvos, compartilhamentos, interacoes)
       SELECT $1, 'm' || g, 'CAROUSEL_ALBUM', 'Freio chiando? Veja quando trocar a pastilha ' || g, now() - (g || ' days')::interval,
              1000 + g * 100, 10 + g, 3 + g, 50 + g
         FROM generate_series(1, 6) g`,
      [rui.contaId],
    );
    const r = await mandar('post', '/segundo-cerebro/enviar-agora');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ enviado: true, codigo: 'NOT-001', jaExistia: false });
    const envio = pedidos.filter((p) => p.caminho === '/api/externo/rascunhos').at(-1)!;
    expect(envio.corpo).toMatchObject({ tipo: 'nota', area: 'marketing' });
    const c = envio.corpo as { titulo: string; conteudo: string; idExterno: string };
    expect(c.titulo).toContain('Aprendizados do Instagram — Auto Peças Horizonte');
    expect(c.conteudo).toContain('Posts que mais trouxeram resultado');
    expect(c.idExterno).toMatch(new RegExp(`^aprendizados-${rui.contaId}-\\d{4}-W\\d{2}$`));
    const de_novo = await mandar('post', '/segundo-cerebro/enviar-agora');
    expect(de_novo.body).toMatchObject({ enviado: true, codigo: 'NOT-001', jaExistia: true });
    expect((await ler('/segundo-cerebro')).body.ultimoEnvio).toMatchObject({ codigo: 'NOT-001' });
  });

  it('desligado, o time não chama o Cérebro; desconectar apaga a ligação', async () => {
    expect((await mandar('patch', '/segundo-cerebro', { ligado: false })).body.ligado).toBe(false);
    const antes = pedidos.length;
    const exp = await mandar('post', '/segundo-cerebro/experimentar', { pergunta: 'prazo' });
    expect(exp.body.itens).toEqual([]);
    expect(pedidos.length).toBe(antes);
    expect((await mandar('delete', '/segundo-cerebro')).status).toBe(200);
    expect((await ler('/segundo-cerebro')).body.conectado).toBe(false);
  });
});
