import { criarPool, migrar, type Pool } from '@prospeccao/db';
import { bancoDeTeste } from '@prospeccao/db/teste';
import { criarLogger, PERGUNTA_PESQUISA } from '@prospeccao/shared';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../src/app.js';
import { comConta } from '../src/contexto.js';
import { encerrarParados } from '../src/modulos/carteira/repositorio.js';
import type { ServicosConta } from '../src/servicos.js';

const URL_TESTE = process.env.TEST_DATABASE_URL;
const ORIGEM = 'http://localhost:5173';

describe.skipIf(!URL_TESTE)('atendimento com carteira', () => {
  let pool: Pool;
  let app: ReturnType<typeof criarApp>;
  let master = '';
  let contaId = 0;
  let ip = 0;
  const log = criarLogger('teste', 'silent');
  const enviados: { tel: string; texto: string }[] = [];
  const servicos = async (id: number): Promise<ServicosConta> => ({
    contaId: id,
    whatsapp: {
      async enviar(tel: string, texto: string) {
        enviados.push({ tel, texto });
        return { idExterno: `ext-${enviados.length}` };
      },
    } as never,
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
    ((r.headers['set-cookie'] as unknown as string[] | undefined) ?? [])[0]?.split(';')[0] ?? '';
  const entrar = (email: string, senha: string) =>
    request(app)
      .post('/auth/login')
      .set('Origin', ORIGEM)
      .set('X-Forwarded-For', `10.81.${Math.floor(++ip / 250)}.${ip % 250}`)
      .send({ email, senha });
  const comoMaster = (metodo: 'post' | 'patch', rota: string, corpo?: object) =>
    request(app)[metodo](rota).set('Origin', ORIGEM).set('Cookie', master).send(corpo);
  const como = (cookie: string) => ({
    get: (rota: string) => request(app).get(rota).set('Cookie', cookie),
    enviar: (metodo: 'post' | 'put' | 'patch' | 'delete', rota: string, corpo?: object) =>
      request(app)[metodo](rota).set('Origin', ORIGEM).set('Cookie', cookie).send(corpo),
  });
  const idDe = async (email: string) =>
    (await pool.query<{ id: number }>('SELECT id FROM cadastro.usuarios WHERE email = $1', [email])).rows[0]!
      .id;
  let ana: ReturnType<typeof como>;
  let bia: ReturnType<typeof como>;
  let caio: ReturnType<typeof como>;
  let biaId = 0;
  let caioId = 0;
  let daBia = 0;
  let semDono = 0;

  /** O cliente escreveu (o que o webhook do WhatsApp grava). */
  const chegou = (empresaId: number, texto: string) =>
    pool.query(
      `INSERT INTO comercial.mensagens (conta_id, empresa_id, direcao, texto, telefone, status, origem)
       VALUES ($1, $2, 'recebida', $3, '71999990000', 'recebida', 'lead')`,
      [contaId, empresaId, texto],
    );

  beforeAll(async () => {
    pool = criarPool({
      url: await bancoDeTeste(URL_TESTE!, 'atendimento_carteira'),
      aplicacao: 'teste-atendimento-carteira',
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
        jwtSegredo: 'c'.repeat(40),
        adminEmail: 'dona@exemplo.com',
        adminSenhaHash: await bcrypt.hash('senha-forte-123', 4),
        sessaoHoras: 1,
        cookieSeguro: false,
      },
      origens: [ORIGEM],
      servicos,
      credenciais: { chave: null, ambiente: {}, invalidar() {} },
    } as never);
    master = cookieDe(await entrar('dona@exemplo.com', 'senha-forte-123'));
    const r = await comoMaster('post', '/master/contas', {
      nome: 'Autopeças Atendimento',
      primeiroAcesso: 'admin',
      admin: { nome: 'Ana Admin', email: 'ana@atend.com.br' },
      plano: { plano: 'escala', modulos: [] },
    });
    expect(r.status).toBe(201);
    contaId = r.body.id;
    for (const [nome, email] of [
      ['Bia Vendas', 'bia@atend.com.br'],
      ['Caio Vendas', 'caio@atend.com.br'],
    ] as const) {
      const u = await comoMaster('post', `/master/contas/${contaId}/usuarios`, {
        nome,
        email,
        papel: 'sdr',
        alcance: 'proprios',
      });
      expect(u.status).toBe(201);
    }
    for (const email of ['ana@atend.com.br', 'bia@atend.com.br', 'caio@atend.com.br'])
      expect(
        (
          await comoMaster('patch', `/master/usuarios/${await idDe(email)}/acesso`, {
            senha: 'Senha-forte-1',
          })
        ).status,
      ).toBe(200);
    biaId = await idDe('bia@atend.com.br');
    caioId = await idDe('caio@atend.com.br');
    ana = como(cookieDe(await entrar('ana@atend.com.br', 'Senha-forte-1')));
    await ana.enviar('post', '/nichos', { nome: 'Oficinas', cnaes: ['4520-0/01'], termosMaps: ['oficina'] });
    const l1 = await ana.enviar('post', '/funil/leads', {
      empresa: 'Oficina do Joel',
      telefone: '71998124410',
    });
    expect(l1.status).toBe(201);
    daBia = l1.body.empresaId;
    expect((await ana.enviar('patch', `/funil/${daBia}`, { responsavelId: biaId })).status).toBe(200);
    const l2 = await ana.enviar('post', '/funil/leads', {
      empresa: 'Mecânica Bom Jesus',
      telefone: '71998880001',
    });
    semDono = l2.body.empresaId;
    expect((await ana.enviar('patch', `/funil/${semDono}`, { responsavelId: null })).status).toBe(200);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('só o administrador liga e muda as regras; ligado, a sessão avisa e o time vê os sem dono', async () => {
    const lido = await ana.get('/carteira/config');
    expect(lido.body.config.ativo).toBe(false);
    expect((await ana.get('/auth/eu')).body.atendimento).toMatchObject({ ativo: false, disponivel: true });
    bia = como(cookieDe(await entrar('bia@atend.com.br', 'Senha-forte-1')));
    expect((await bia.enviar('put', '/carteira/config', { ...lido.body.config, ativo: true })).status).toBe(
      403,
    );
    const salvo = await ana.enviar('put', '/carteira/config', {
      ...lido.body.config,
      ativo: true,
      motivos: ['Venda fechada', 'Orçamento enviado', 'Venda fechada'],
    });
    expect(salvo.status).toBe(200);
    expect(salvo.body.motivos).toEqual(['Venda fechada', 'Orçamento enviado']);
    expect((await ana.enviar('post', '/carteira/etiquetas', { nome: 'Pedido', cor: 'azul' })).status).toBe(
      201,
    );
    expect((await ana.enviar('post', '/carteira/etiquetas', { nome: 'pedido' })).status).toBe(409);
    const et = await ana.enviar('post', '/carteira/etiquetas', { nome: 'Troca', cor: 'laranja' });
    expect(et.body.map((e: { nome: string }) => e.nome)).toEqual(['Pedido', 'Troca']);
    // Sessão nova: o atendimento ligado faz quem vê só a própria base enxergar os clientes sem dono.
    bia = como(cookieDe(await entrar('bia@atend.com.br', 'Senha-forte-1')));
    caio = como(cookieDe(await entrar('caio@atend.com.br', 'Senha-forte-1')));
    expect((await bia.get('/auth/eu')).body).toMatchObject({
      filaSemDono: true,
      atendimento: { ativo: true },
    });
  });

  it('cliente com dono cai na carteira do dono; sem dono, na Fila geral, e quem pega vira dono', async () => {
    await chegou(daBia, 'Bom dia! Tem pastilha de freio do Onix 2019?');
    const fb = await bia.get('/carteira/filas');
    expect(fb.body).toMatchObject({ minha: 1, geral: 0, aguardando: 0 });
    const lista = await bia.get('/carteira/atendimentos?fila=minha');
    expect(lista.body).toHaveLength(1);
    expect(lista.body[0]).toMatchObject({ empresaId: daBia, situacao: 'aberto', origem: 'carteira' });
    expect(lista.body[0].protocolo).toMatch(/^\d{4}-\d{4}-0001$/);
    expect((await caio.get('/carteira/filas')).body.minha).toBe(0);
    // O cliente da Bia não aparece para o Caio.
    expect((await caio.get(`/carteira/cliente/${daBia}`)).status).toBe(404);

    await chegou(semDono, 'Vocês têm kit embreagem do Gol G5?');
    expect((await caio.get('/carteira/filas')).body).toMatchObject({ geral: 1 });
    expect((await bia.get('/carteira/atendimentos?fila=geral')).body[0]).toMatchObject({
      empresaId: semDono,
      origem: 'geral',
    });
    expect((await caio.enviar('post', `/carteira/cliente/${semDono}/assumir`)).status).toBe(200);
    expect((await bia.enviar('post', `/carteira/cliente/${semDono}/assumir`)).status).toBe(404);
    const { rows } = await pool.query(
      'SELECT responsavel_id FROM comercial.oportunidades WHERE empresa_id = $1',
      [semDono],
    );
    expect(rows[0].responsavel_id).toBe(caioId);
    expect((await caio.get('/carteira/filas')).body).toMatchObject({ minha: 1, geral: 0 });
  });

  it('responder põe em Aguardando; transferir mostra o cliente para quem recebe, com a nota', async () => {
    const r = await bia.enviar('post', `/conversas/${daBia}/mensagens`, {
      texto: 'Bom dia, Joel! Tenho da Cobreq.',
    });
    expect(r.status).toBe(201);
    expect((await bia.get('/carteira/filas')).body).toMatchObject({ minha: 0, aguardando: 1 });
    const cli = await bia.get(`/carteira/cliente/${daBia}`);
    expect(cli.body.atual).toMatchObject({ situacao: 'aguardando', atendenteId: biaId });
    expect(cli.body.atual.primeiraRespostaEm).not.toBeNull();

    expect(
      (await bia.enviar('post', `/carteira/cliente/${daBia}/nota`, { texto: 'Só 2 jogos no estoque.' }))
        .status,
    ).toBe(201);
    const t = await bia.enviar('post', `/carteira/cliente/${daBia}/transferir`, {
      usuarioId: caioId,
      nota: 'Ele quer o kit com rolamento.',
      passarCarteira: true,
    });
    expect(t.status).toBe(200);
    // Vendedor não passa a carteira: vira pedido para o administrador.
    expect(t.body.donoId).toBe(biaId);
    expect(t.body.eventos.map((e: { tipo: string }) => e.tipo)).toEqual(['aberto', 'nota', 'transferiu']);
    const aviso = await pool.query(
      `SELECT titulo FROM comercial.notificacoes WHERE usuario_id = $1 AND tipo = 'sistema'`,
      [await idDe('ana@atend.com.br')],
    );
    expect(aviso.rows[0]?.titulo).toContain('pediu para passar');
    // O Caio agora abre a conversa do cliente da Bia (enquanto o atendimento estiver com ele).
    expect((await caio.get(`/carteira/cliente/${daBia}`)).status).toBe(200);
    expect((await caio.get(`/conversas/${daBia}`)).status).toBe(200);
    expect((await caio.get('/carteira/filas')).body.minha).toBe(2);
    expect(
      (await bia.enviar('post', `/carteira/cliente/${daBia}/encerrar`, { motivo: 'Venda fechada' })).status,
    ).toBe(403);
  });

  it('encerrar manda a mensagem com o protocolo e a pesquisa; a nota não reabre, a conversa sim', async () => {
    expect(
      (
        await caio.enviar('post', `/carteira/cliente/${daBia}/encerrar`, {
          motivo: 'Inventado',
          etiquetas: [],
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await caio.enviar('post', `/carteira/cliente/${daBia}/encerrar`, {
          motivo: 'Venda fechada',
          etiquetas: ['Urgente'],
        })
      ).status,
    ).toBe(422);
    const antes = enviados.length;
    const e = await caio.enviar('post', `/carteira/cliente/${daBia}/encerrar`, {
      motivo: 'Venda fechada',
      etiquetas: ['pedido'],
    });
    expect(e.status).toBe(200);
    expect(e.body.mensagemEnviada).toBe(true);
    const msg = enviados[antes]!.texto;
    expect(msg).toContain(e.body.cliente.anteriores[0].protocolo);
    expect(msg).toContain(PERGUNTA_PESQUISA);
    expect(e.body.cliente.atual).toBeNull();
    expect(e.body.cliente.anteriores[0]).toMatchObject({ motivo: 'Venda fechada', etiquetas: ['Pedido'] });
    // Encerrado, o cliente da Bia some para o Caio.
    expect((await caio.get(`/carteira/cliente/${daBia}`)).status).toBe(404);

    await chegou(daBia, ' 5 ');
    let cli = await bia.get(`/carteira/cliente/${daBia}`);
    expect(cli.body.atual).toBeNull();
    expect(cli.body.anteriores[0].notaCliente).toBe(5);

    await chegou(daBia, 'Chegou certinho, obrigado. Agora preciso de óleo.');
    cli = await bia.get(`/carteira/cliente/${daBia}`);
    expect(cli.body.atual).toMatchObject({ situacao: 'aberto', atendenteId: biaId, reaberto: true });
    expect(cli.body.atual.protocolo).not.toBe(cli.body.anteriores[0].protocolo);
  });

  it('em pausa, o que espera resposta vai para a Fila geral; o painel conta tudo', async () => {
    const p = await bia.enviar('put', '/carteira/disponivel', { disponivel: false });
    expect(p.body).toEqual({ paraFila: 1 });
    expect((await caio.get('/carteira/filas')).body.geral).toBe(1);
    expect((await bia.get('/auth/eu')).body.atendimento.disponivel).toBe(false);
    // Da Fila geral, outro vendedor atende (o cliente continua na carteira dela).
    expect((await caio.enviar('post', `/carteira/cliente/${daBia}/assumir`)).status).toBe(200);
    await bia.enviar('put', '/carteira/disponivel', { disponivel: true });

    expect((await bia.get('/carteira/painel')).status).toBe(403);
    const painel = await ana.get('/carteira/painel?periodo=hoje');
    expect(painel.status).toBe(200);
    expect(painel.body).toMatchObject({ encerrados: 1, vendas: 1, notaMedia: 5, notas: 1 });
    expect(painel.body.motivos).toEqual([{ motivo: 'Venda fechada', total: 1 }]);
    expect(painel.body.porPessoa.find((x: { id: number }) => x.id === biaId).paraFila).toBe(1);
  });

  it('a carteira: trocar o dono, passar de uma pessoa para outra e importar por planilha', async () => {
    expect((await bia.enviar('put', `/carteira/cliente/${daBia}/dono`, { usuarioId: caioId })).status).toBe(
      403,
    );
    expect(
      (await ana.enviar('put', `/carteira/cliente/${semDono}/dono`, { usuarioId: biaId })).body.donoId,
    ).toBe(biaId);
    const passou = await ana.enviar('post', '/carteira/passar', { de: biaId, para: caioId });
    expect(passou.body.passados).toBe(2);

    const csv = [
      'cnpj ou telefone;e-mail do vendedor;nome',
      '71998124410;bia@atend.com.br;Oficina do Joel',
      '71 3333-2222;bia@atend.com.br;Auto Center Itapuã',
      '71977776666;ninguem@atend.com.br;Retífica',
      'abc;bia@atend.com.br;Sem número',
    ].join('\n');
    const imp = await ana.enviar('post', '/carteira/importar', { csv });
    expect(imp.status).toBe(200);
    expect(imp.body).toMatchObject({ linhas: 4, atribuidos: 1, criados: 1 });
    expect(imp.body.semVendedor).toEqual(['ninguem@atend.com.br']);
    expect(imp.body.naoEncontrados).toEqual(['abc']);
    expect((await ana.get('/carteira/config')).body.carteira).toMatchObject({ comDono: 3, vendedores: 2 });
  });

  it('aguardando o cliente por mais horas do que a conta quer: encerra sozinho', async () => {
    await caio.enviar('post', `/conversas/${daBia}/mensagens`, { texto: 'Tenho o óleo 5W30, mando?' });
    await pool.query(
      `UPDATE comercial.atendimentos SET ultima_equipe_em = now() - interval '30 hours'
        WHERE empresa_id = $1 AND situacao = 'aguardando'`,
      [daBia],
    );
    expect(await comConta(contaId, () => encerrarParados(pool))).toBe(1);
    const cli = await ana.get(`/carteira/cliente/${daBia}`);
    expect(cli.body.atual).toBeNull();
    expect(cli.body.anteriores[0].motivo).toBe('Cliente não respondeu');
  });

  it('fora do plano Escala: ler as regras vale; usar as filas, não', async () => {
    const r = await comoMaster('post', '/master/contas', {
      nome: 'Loja Time',
      primeiroAcesso: 'admin',
      admin: { nome: 'Teo Admin', email: 'teo@time.com.br' },
      plano: { plano: 'time', modulos: [] },
    });
    await comoMaster('patch', `/master/usuarios/${await idDe('teo@time.com.br')}/acesso`, {
      senha: 'Senha-forte-1',
    });
    const teo = como(cookieDe(await entrar('teo@time.com.br', 'Senha-forte-1')));
    expect(r.status).toBe(201);
    expect((await teo.get('/carteira/config')).status).toBe(200);
    const f = await teo.get('/carteira/filas');
    expect(f.status).toBe(403);
    expect(f.body.erro.codigo).toBe('fora_do_plano');
  });
});
