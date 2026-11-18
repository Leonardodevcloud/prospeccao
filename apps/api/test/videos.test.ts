import { criarPool, migrar, type Pool } from '@prospeccao/db';
import { bancoDeTeste } from '@prospeccao/db/teste';
import type { Armazenamento } from '@prospeccao/integrations/reuniao';
import { criarLogger } from '@prospeccao/shared';
import { juntarPropostas } from '@prospeccao/shared/videos';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../src/app.js';
import { esquecerRecursos } from '../src/recursos.js';

const URL_TESTE = process.env.TEST_DATABASE_URL;
const ORIGEM = 'http://localhost:5173';

const arquivos = new Map<string, Uint8Array>();
const partes = new Map<string, Map<number, Uint8Array>>();
const armazenamento = {
  destino: { endpoint: 'https://arm', regiao: 'auto', bucket: 'b', chave: 'k', segredo: 's'.repeat(10) },
  async urlAssinada(chave: string, o?: { baixarComo?: string }) {
    return `https://arm/b/${chave}${o?.baixarComo ? `?como=${encodeURIComponent(o.baixarComo)}` : ''}`;
  },
  async apagar(chaves: string[]) {
    for (const k of chaves) arquivos.delete(k);
  },
  async enviar(chave: string, corpo: Uint8Array) {
    arquivos.set(chave, new Uint8Array(corpo));
  },
  async iniciarEmPartes(chave: string) {
    partes.set(chave, new Map());
    return `envio-${chave}`;
  },
  async enviarParte(chave: string, _id: string, numero: number, corpo: Uint8Array) {
    partes.get(chave)!.set(numero, new Uint8Array(corpo));
    return `"etag-${numero}"`;
  },
  async concluirEmPartes(chave: string, _id: string, lista: { numero: number }[]) {
    const p = partes.get(chave)!;
    arquivos.set(chave, new Uint8Array(Buffer.concat(lista.map((x) => Buffer.from(p.get(x.numero)!)))));
  },
  async cancelarEmPartes(chave: string) {
    partes.delete(chave);
  },
} as unknown as Armazenamento;

describe.skipIf(!URL_TESTE)('vídeos com IA (com Postgres)', () => {
  let pool: Pool;
  let app: ReturnType<typeof criarApp>;
  let cookie = '';
  const log = criarLogger('teste', (process.env.LOG_TESTE as 'error') ?? 'silent');
  const publicados: { nome: string; payload: unknown }[] = [];
  const pedidosDaIa: string[] = [];
  let respostaDaIa: Record<string, unknown> = {};
  const enviar = (metodo: 'post' | 'put' | 'delete', caminho: string, corpo?: unknown) =>
    request(app)
      [metodo](caminho)
      .set('Origin', ORIGEM)
      .set('Cookie', cookie)
      .send(corpo as object);
  const ler = (caminho: string) => request(app).get(caminho).set('Cookie', cookie);
  const opcoes = {
    assunto: 'Promoção de pastilha de freio',
    estilo: 'acesa',
    ritmo: 'dinamico',
    transicao: 'alternada',
    chamada: { tipo: 'comente', palavra: 'pastilha', texto: '' },
    instrucoes: '',
  };

  beforeAll(async () => {
    pool = criarPool({ url: await bancoDeTeste(URL_TESTE!, 'videos'), aplicacao: 'teste-videos', max: 4 });
    await migrar(pool, log);
    app = criarApp({
      pool,
      log,
      filas: {
        async publicar(nome, payload) {
          publicados.push({ nome, payload });
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
        jwtSegredo: 'j'.repeat(40),
        adminEmail: 'dona@exemplo.com',
        adminSenhaHash: await bcrypt.hash('senha-forte-123', 4),
        sessaoHoras: 1,
        cookieSeguro: false,
      },
      origens: [ORIGEM],
      servicos: {} as never,
      credenciais: { chave: 'c'.repeat(32), ambiente: {}, invalidar() {} },
      reunioes: { armazenamento } as never,
      videos: { imagensGeradas: true, musicaLiberada: () => true },
      carrosseisIa: {
        modelo: 'teste',
        cliente: () => ({
          modelo: 'teste',
          async pedir(p: { mensagem: string }) {
            pedidosDaIa.push(p.mensagem);
            return { dados: respostaDaIa, custoUsd: 0 } as never;
          },
        }),
        async testar() {
          return 'ok';
        },
      } as never,
    });
    const ok = await request(app)
      .post('/auth/login')
      .set('Origin', ORIGEM)
      .send({ email: 'dona@exemplo.com', senha: 'senha-forte-123' });
    cookie = (ok.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
  });

  afterAll(async () => {
    await pool?.end();
  });

  let videoId = 0;

  it('a situação diz que o módulo vale e o serviço ainda não deu sinal', async () => {
    const r = await ler('/videos/situacao');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ modulo: true, armazenamento: true, servico: false, limiteSegundos: 180 });
  });

  it('recusa vídeo acima de 3 minutos e o "Comente" sem palavra', async () => {
    const longo = await enviar('post', '/videos', {
      nome: 'a.mp4',
      tipo: 'video/mp4',
      bytes: 10,
      duracao: 240,
      opcoes,
    });
    expect(longo.status).toBeGreaterThanOrEqual(400);
    expect(longo.body.erro.mensagem).toMatch(/3 minutos/);
    const semPalavra = await enviar('post', '/videos', {
      nome: 'a.mp4',
      tipo: 'video/mp4',
      bytes: 10,
      duracao: 30,
      opcoes: { ...opcoes, chamada: { tipo: 'comente', palavra: '', texto: '' } },
    });
    expect(semPalavra.status).toBeGreaterThanOrEqual(400);
  });

  it('envia em partes, junta no armazenamento e põe na fila do worker', async () => {
    const parte1 = Buffer.alloc(8 * 1024 * 1024, 1);
    const parte2 = Buffer.from('fim-do-video');
    const c = await enviar('post', '/videos', {
      nome: 'freio.mp4',
      tipo: 'video/mp4',
      bytes: parte1.length + parte2.length,
      duracao: 42,
      titulo: '',
      opcoes,
    });
    expect(c.status).toBe(201);
    videoId = c.body.id;
    expect(c.body.tamanhoParte).toBe(8 * 1024 * 1024);
    for (const [n, p] of [parte1, parte2].entries()) {
      const r = await request(app)
        .put(`/videos/${videoId}/partes/${n + 1}`)
        .set('Origin', ORIGEM)
        .set('Cookie', cookie)
        .set('Content-Type', 'application/octet-stream')
        .send(p);
      expect(r.status).toBe(200);
    }
    // Faltando parte: recusa.
    expect(
      (await enviar('post', `/videos/${videoId}/concluir`, { partes: 3 })).status,
    ).toBeGreaterThanOrEqual(400);
    const fim = await enviar('post', `/videos/${videoId}/concluir`, { partes: 2 });
    expect(fim.status).toBe(200);
    expect(fim.body).toMatchObject({ situacao: 'na_fila', titulo: 'Promoção de pastilha de freio' });
    expect(fim.body.opcoes.chamada.palavra).toBe('PASTILHA');
    expect(publicados.at(-1)).toEqual({ nome: 'video.editar', payload: { videoId, modo: 'primeira' } });
    const { rows } = await pool.query<{ original_chave: string }>(
      'SELECT original_chave FROM comercial.videos WHERE id = $1',
      [videoId],
    );
    expect(arquivos.get(rows[0]!.original_chave)?.length).toBe(parte1.length + parte2.length);
    // Já enviado: não aceita mais partes.
    const tarde = await request(app)
      .put(`/videos/${videoId}/partes/3`)
      .set('Origin', ORIGEM)
      .set('Cookie', cookie)
      .set('Content-Type', 'application/octet-stream')
      .send(parte2);
    expect(tarde.status).toBeGreaterThanOrEqual(400);
  }, 30_000);

  it('revisão: devolve a dúvida, corrige a palavra, recusa versão velha e gera de novo', async () => {
    // O que o worker grava ao terminar.
    const cortes = [
      {
        id: 'c1',
        inicio: 0,
        fim: 1.2,
        tipo: 'inicio',
        motivo: 'Começo antes de falar',
        trecho: '',
        duvida: false,
        decisao: 'cortar',
        conferido: true,
      },
      {
        id: 'c2',
        inicio: 5,
        fim: 5.4,
        tipo: 'pausa',
        motivo: 'Pausa de 0,6 s encurtada',
        trecho: '',
        duvida: false,
        decisao: 'cortar',
        conferido: true,
      },
      {
        id: 'c3',
        inicio: 20,
        fim: 22,
        tipo: 'recomeco',
        motivo: 'Frase recomeçada',
        trecho: 'o 5W30 serve pra',
        duvida: true,
        decisao: 'cortar',
        conferido: false,
      },
    ];
    const palavras = [
      { t: 'Qual', i: 1.3, f: 1.5 },
      { t: 'óleo', i: 1.5, f: 1.8, forte: true },
      { t: '5', i: 2, f: 2.2, conferir: true },
    ];
    await pool.query(
      `UPDATE comercial.videos SET situacao = 'revisar', duracao_original = 42, duracao_final = 38, cortes = $2, palavras = $3,
              animacoes = $4, final_chave = 'videos/1/x/editado.mp4', capa_chave = 'videos/1/x/capa.jpg', contou_em = now(),
              analise = $5, pronto_em = now()
        WHERE id = $1`,
      [
        videoId,
        JSON.stringify(cortes),
        JSON.stringify(palavras),
        JSON.stringify({
          titulo: { usar: true, texto: 'O ÓLEO CERTO' },
          chamada: { usar: true, tipo: 'comente', palavra: 'PASTILHA', texto: '' },
        }),
        JSON.stringify({
          duracao: 42,
          silencios: [
            { inicio: 5, fim: 5.8 },
            { inicio: 30, fim: 31.5 },
          ],
          rostos: [],
          fps: 6,
          recorteX: null,
        }),
      ],
    );
    const lista = await ler('/videos');
    expect(lista.body.videos[0]).toMatchObject({
      id: videoId,
      situacao: 'revisar',
      duvidas: 1,
      temCapa: true,
    });
    expect(lista.body.franquia).toEqual({ usados: 1, limite: null });

    const d = await ler(`/videos/${videoId}`);
    expect(d.body.versao).toBe(1);
    const r = await enviar('put', `/videos/${videoId}/revisao`, {
      versao: 1,
      cortes: [{ id: 'c3', decisao: 'devolver', conferido: true }],
      palavras: [{ indice: 2, texto: '5W30' }],
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ situacao: 'pronto', mudancasPendentes: true, versao: 2, duvidas: 0 });
    expect(r.body.cortes.find((c: { id: string }) => c.id === 'c3').decisao).toBe('devolver');
    expect(r.body.palavras[2]).toMatchObject({ t: '5W30', conferir: false });

    // Outra aba com a versão antiga.
    expect(
      (
        await enviar('put', `/videos/${videoId}/revisao`, {
          versao: 1,
          palavras: [{ indice: 0, texto: 'Que' }],
        })
      ).status,
    ).toBe(409);

    // Ritmo novo: as pausas são refeitas pelos silêncios guardados; o recomeço devolvido continua.
    const ritmo = await enviar('put', `/videos/${videoId}/revisao`, { versao: 2, ritmo: 'pausas' });
    expect(ritmo.status).toBe(200);
    const tipos = ritmo.body.cortes.map((c: { tipo: string }) => c.tipo);
    expect(tipos).toContain('recomeco');
    expect(ritmo.body.cortes.filter((c: { tipo: string }) => c.tipo === 'pausa')).toHaveLength(1);
    expect(ritmo.body.opcoes.ritmo).toBe('pausas');

    // v142: cortar um trecho escolhido palavra por palavra (vira corte "manual") e devolver de novo.
    const manual = await enviar('put', `/videos/${videoId}/revisao`, {
      versao: 3,
      trechos: [{ acao: 'cortar', inicio: 1.45, fim: 1.85 }],
    });
    expect(manual.status).toBe(200);
    const m = manual.body.cortes.find((c: { tipo: string }) => c.tipo === 'manual');
    expect(m).toMatchObject({ decisao: 'cortar', trecho: 'óleo', conferido: true });
    expect(manual.body.mudancasPendentes).toBe(true);
    const volta = await enviar('put', `/videos/${videoId}/revisao`, {
      versao: 4,
      trechos: [{ acao: 'devolver', inicio: 1.4, fim: 1.9 }],
    });
    expect(volta.status).toBe(200);
    expect(volta.body.cortes.find((c: { id: string }) => c.id === m.id).decisao).toBe('devolver');
    expect(
      (
        await enviar('put', `/videos/${videoId}/revisao`, {
          versao: 5,
          trechos: [{ acao: 'cortar', inicio: 2, fim: 2 }],
        })
      ).status,
    ).toBe(422);

    const link = await ler(`/videos/${videoId}/arquivo?tipo=final&baixar=sim`);
    expect(link.body.url).toContain('videos/1/x/editado.mp4');
    expect(link.body.url).toContain('como=Promo');

    publicados.length = 0;
    const g = await enviar('post', `/videos/${videoId}/gerar`);
    expect(g.status).toBe(200);
    expect(g.body.situacao).toBe('na_fila');
    expect(publicados).toEqual([{ nome: 'video.editar', payload: { videoId, modo: 'refazer' } }]);
    // Na fila: não dá para revisar nem pedir de novo.
    expect((await enviar('put', `/videos/${videoId}/revisao`, { versao: 5 })).status).toBeGreaterThanOrEqual(
      400,
    );
    expect((await enviar('post', `/videos/${videoId}/gerar`)).status).toBeGreaterThanOrEqual(400);
  });

  it('a franquia do plano trava o vídeo novo; gerar de novo não conta', async () => {
    const org = (
      await pool.query<{ o: number }>('SELECT organizacao_id AS o FROM cadastro.contas ORDER BY id LIMIT 1')
    ).rows[0]!.o;
    await pool.query(
      `UPDATE cadastro.organizacoes SET plano = 'time', modulos = '{videos}', limite_videos_mes = 1 WHERE id = $1`,
      [org],
    );
    esquecerRecursos();
    const c = await enviar('post', '/videos', {
      nome: 'b.mp4',
      tipo: 'video/mp4',
      bytes: 100,
      duracao: 30,
      opcoes,
    });
    expect(c.status).toBe(403);
    expect(c.body.erro.mensagem).toMatch(/1 vídeos do mês/);
    expect((await ler('/videos')).body.franquia).toEqual({ usados: 1, limite: 1 });
    await pool.query(`UPDATE cadastro.organizacoes SET modulos = '{}' WHERE id = $1`, [org]);
    esquecerRecursos();
    // Sem o módulo: a situação responde (para a tela explicar), o resto não.
    expect((await ler('/videos/situacao')).body.modulo).toBe(false);
    expect((await ler('/videos')).status).toBe(403);
    await pool.query(
      `UPDATE cadastro.organizacoes SET plano = NULL, modulos = '{}', limite_videos_mes = NULL WHERE id = $1`,
      [org],
    );
    esquecerRecursos();
  });

  it('v129: imagens, animações e som na revisão, foto própria e os arquivos do vídeo', async () => {
    const sharp = (await import('sharp')).default;
    const { rows: c } = await pool.query<{ conta_id: number }>(
      'SELECT conta_id FROM comercial.videos WHERE id = $1',
      [videoId],
    );
    const conta = c[0]!.conta_id;
    const palavras = Array.from({ length: 75 }, (_, k) => ({ t: `p${k}`, i: k * 0.4, f: k * 0.4 + 0.3 }));
    const { rows: f } = await pool.query<{ id: number }>(
      `INSERT INTO comercial.carrossel_fotos (conta_id, nome, chave, largura, altura, bytes, descricao_ia)
       VALUES ($1, 'fachada.jpg', 'carrosseis/x/fotos/f.jpg', 1080, 1080, 100, 'A fachada da loja') RETURNING id`,
      [conta],
    );
    arquivos.set('carrosseis/x/fotos/f.jpg', new Uint8Array([9]));
    arquivos.set('videos/x/gerada.jpg', new Uint8Array([1]));
    arquivos.set('videos/x/musica.mp3', new Uint8Array([2]));
    const momento = {
      id: 'm1',
      tipo: 'lista',
      inicio: 5,
      fim: 9,
      fala: 'três sinais',
      usar: true,
      titulo: '3 SINAIS',
      numero: '',
      itens: [
        { texto: 'CHIADO', em: 6 },
        { texto: 'PEDAL', em: 7 },
      ],
      divulgarId: null,
      oferta: null,
      manual: false,
    };
    const imagem = (id: string, origem: string, inicio: number, chave: string) => ({
      id,
      inicio,
      fim: inicio + 3,
      fala: 'x',
      motivo: 'x',
      origem,
      fotoId: null,
      chave,
      descricao: 'oficina',
      encaixe: 'cheia',
      usar: true,
      pedido: null,
      conferencia: 'Conferida.',
      posta: 'cheia',
      manual: false,
    });
    const { rows: v } = await pool.query<{ id: number }>(
      `INSERT INTO comercial.videos (conta_id, titulo, situacao, opcoes, original_chave, original_nome, original_tipo,
              original_bytes, duracao_original, analise, cortes, palavras, animacoes, imagens, som, final_chave)
       VALUES ($1, 'Com enfeites', 'pronto', '{}', 'videos/x/original', 'v.mp4', 'video/mp4', 1, 30,
               '{"duracao": 30, "silencios": []}', '[]', $2, $3, $4, $5, 'videos/x/final.mp4') RETURNING id`,
      [
        conta,
        JSON.stringify(palavras),
        JSON.stringify({
          titulo: { usar: true, texto: 'T' },
          chamada: { usar: false, tipo: 'nenhuma', palavra: '', texto: '' },
          momentos: [momento],
        }),
        JSON.stringify([
          imagem('i1', 'gerada', 12, 'videos/x/gerada.jpg'),
          imagem('i2', 'gerada', 20, 'videos/x/outra.jpg'),
        ]),
        JSON.stringify({
          musica: {
            usar: true,
            clima: 'confiante',
            descricao: '',
            estiloIa: 'x',
            volume: 35,
            chave: 'videos/x/musica.mp3',
            segundos: 30,
            pedirOutra: false,
            erro: null,
          },
          efeitos: {
            ligados: true,
            desligados: [],
            lista: [{ id: 'm1:0', tipo: 'tique', em: 6, onde: 'Item 1' }],
          },
        }),
      ],
    );
    const id = v[0]!.id;
    const situacao = await ler('/videos/situacao');
    expect(situacao.body.recursos).toEqual({ imagensGeradas: true, musica: true });
    expect(situacao.body.fotosDaEmpresa).toBe(1);

    let r = await enviar('put', `/videos/${id}/revisao`, {
      versao: 1,
      momentos: [{ id: 'm1', titulo: 'dois sinais', itens: ['chiado alto', 'pedal mole'] }],
      novoMomento: { tipo: 'selo', em: 15, titulo: 'dica' },
      imagens: [
        { id: 'i1', usar: false },
        { id: 'i2', pedido: 'gerar_outra' },
      ],
      musica: { clima: 'calma', volume: 50 },
      efeitos: { desligados: ['m1:0'] },
    });
    expect(r.status).toBe(200);
    const m = r.body.animacoes.momentos;
    expect(m[0]).toMatchObject({
      titulo: 'DOIS SINAIS',
      itens: [{ texto: 'CHIADO ALTO' }, { texto: 'PEDAL MOLE' }],
    });
    expect(m[1]).toMatchObject({ tipo: 'selo', titulo: 'DICA', manual: true });
    expect(r.body.imagens.map((i: { usar: boolean; pedido: string | null }) => [i.usar, i.pedido])).toEqual([
      [false, null],
      [true, 'gerar_outra'],
    ]);
    expect(r.body.som.musica).toMatchObject({ clima: 'calma', volume: 50, pedirOutra: true });
    expect(r.body.som.efeitos.desligados).toEqual(['m1:0']);
    expect(r.body.mudancasPendentes).toBe(true);

    // Regras ao pôr imagem à mão: nada nos 2 primeiros segundos; selo sem texto não vale.
    r = await enviar('put', `/videos/${id}/revisao`, { versao: 2, novaImagem: { em: 1 } });
    expect(r.status).toBe(422);
    expect(r.body.erro.mensagem).toContain('2 primeiros segundos');
    r = await enviar('put', `/videos/${id}/revisao`, { versao: 2, novoMomento: { tipo: 'selo', em: 4 } });
    expect(r.status).toBe(422);
    r = await enviar('put', `/videos/${id}/revisao`, { versao: 2, novaImagem: { em: 4 } });
    expect(r.status).toBe(200);
    expect(r.body.imagens.find((i: { manual: boolean }) => i.manual)).toMatchObject({
      origem: 'gerada',
      pedido: 'escolher',
      chave: null,
    });
    r = await enviar('put', `/videos/${id}/revisao`, {
      versao: 3,
      imagens: [{ id: 'i1', fotoId: f[0]!.id }],
    });
    expect(r.body.imagens.find((i: { id: string }) => i.id === 'i1')).toMatchObject({
      origem: 'empresa',
      chave: 'carrosseis/x/fotos/f.jpg',
      descricao: 'A fachada da loja',
      usar: true,
    });

    // Foto da própria pessoa: reduzida e guardada só para este vídeo.
    const jpeg = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#336699' } })
      .jpeg()
      .toBuffer();
    r = await request(app)
      .post(`/videos/${id}/imagens/foto?imagem=i2`)
      .set('Origin', ORIGEM)
      .set('Cookie', cookie)
      .set('content-type', 'image/jpeg')
      .send(jpeg);
    expect(r.status).toBe(200);
    const propria = r.body.imagens.find((i: { id: string }) => i.id === 'i2');
    expect(propria).toMatchObject({ origem: 'propria', pedido: null });
    expect(propria.chave).toMatch(new RegExp(`^videos/${conta}/${id}/propria-`));
    expect(arquivos.has(propria.chave)).toBe(true);
    const link = await ler(`/videos/${id}/arquivo?tipo=imagem&imagem=i2`);
    expect(link.body.url).toContain(propria.chave);
    expect((await ler(`/videos/${id}/arquivo?tipo=musica`)).body.url).toContain('videos/x/musica.mp3');

    // Fotos da empresa também pelo módulo de vídeos (sem precisar dos Carrosséis).
    const grande = await sharp({ create: { width: 800, height: 800, channels: 3, background: '#aa5500' } })
      .jpeg()
      .toBuffer();
    const nova = await request(app)
      .post('/videos/fotos?nome=balcao.jpg')
      .set('Origin', ORIGEM)
      .set('Cookie', cookie)
      .set('content-type', 'image/jpeg')
      .send(grande);
    expect(nova.status).toBe(201);
    expect((await ler('/videos/fotos')).body.fotos.map((x: { nome: string }) => x.nome)).toContain('balcao');
    expect((await enviar('delete', `/videos/fotos/${nova.body.id}`)).status).toBe(200);
    expect((await ler('/videos/fotos')).body.fotos).toHaveLength(1);

    // Apagar leva as imagens e a música do vídeo; a foto da empresa fica.
    expect((await enviar('delete', `/videos/${id}`)).status).toBe(200);
    expect(arquivos.has(propria.chave)).toBe(false);
    expect(arquivos.has('videos/x/musica.mp3')).toBe(false);
    expect(arquivos.has('carrosseis/x/fotos/f.jpg')).toBe(true);
  });

  it('v161: peça à editora propõe, a revisão aplica e o Desfazer volta', async () => {
    const { rows: c } = await pool.query<{ conta_id: number }>(
      'SELECT conta_id FROM comercial.videos WHERE id = $1',
      [videoId],
    );
    const palavras =
      'oi gente a gente a gente atende em Salvador Recife e Natal todo dia com entrega rápida fala com a gente'
        .split(' ')
        .map((t, k) => ({ t, i: k, f: k + 0.8 }));
    const { rows: v } = await pool.query<{ id: number }>(
      `INSERT INTO comercial.videos (conta_id, titulo, situacao, opcoes, original_chave, original_nome, original_tipo,
              original_bytes, duracao_original, analise, cortes, palavras, animacoes, imagens, som, final_chave)
       VALUES ($1, 'Pedido', 'pronto', '{}', 'videos/p/original', 'v.mp4', 'video/mp4', 1, 22,
               '{"duracao": 22, "silencios": []}', '[]', $2, $3, '[]', $4, 'videos/p/final.mp4') RETURNING id`,
      [
        c[0]!.conta_id,
        JSON.stringify(palavras),
        JSON.stringify({
          titulo: { usar: true, texto: 'T' },
          chamada: { usar: false, tipo: 'nenhuma', palavra: '', texto: '' },
          momentos: [
            {
              id: 'm1',
              tipo: 'selo',
              inicio: 7.5,
              fim: 10,
              fala: 'x',
              usar: true,
              titulo: 'NORDESTE',
              numero: '',
              itens: [],
              divulgarId: null,
              oferta: null,
              manual: false,
            },
          ],
        }),
        JSON.stringify({
          musica: {
            usar: true,
            clima: 'confiante',
            descricao: '',
            estiloIa: '',
            volume: 35,
            chave: null,
            segundos: null,
            pedirOutra: false,
            erro: null,
          },
          efeitos: { ligados: true, desligados: [], lista: [] },
        }),
      ],
    );
    const id = v[0]!.id;
    respostaDaIa = {
      resposta: 'Achei os três pontos.',
      mudancas: [
        { acao: 'cortar', resumo: 'Tirar “a gente” repetido', detalhe: 'Fica uma vez só.', de: 2, ate: 3 },
        {
          acao: 'nova_animacao',
          resumo: 'Nomes das 3 cidades',
          tipo: 'nomes',
          de: 7,
          ate: 10,
          titulo: 'Onde atendemos',
          itens: [
            { texto: 'Salvador', palavra: 7 },
            { texto: 'Recife', palavra: 8 },
            { texto: 'Natal', palavra: 10 },
          ],
        },
        { acao: 'musica', resumo: 'Música mais baixa', volume: 22 },
        { acao: 'cortar', resumo: 'Índice fora da fala', de: 900, ate: 901 },
        { acao: 'tirar_animacao', resumo: 'Animação que não existe', animacao_id: 'zz' },
      ],
    };
    const p = await enviar('post', `/videos/${id}/pedido`, {
      texto: 'corta o gaguejo e bota as cidades',
      em: 7.5,
    });
    expect(p.status).toBe(200);
    expect(pedidosDaIa.at(-1)).toContain('parou o vídeo em 7.5 s');
    expect(pedidosDaIa.at(-1)).toContain('id m1');
    expect(p.body.propostas.map((x: { area: string }) => x.area)).toEqual(['corte', 'animacao', 'som']);
    // Pedir não muda nada.
    expect((await ler(`/videos/${id}`)).body).toMatchObject({
      versao: 1,
      mudancasPendentes: false,
      podeDesfazerPedido: false,
    });

    const revisao = juntarPropostas(p.body.propostas);
    const r = await enviar('put', `/videos/${id}/revisao`, { versao: 1, ...revisao, doPedido: true });
    expect(r.status).toBe(200);
    expect(r.body.cortes).toHaveLength(1);
    expect(r.body.cortes[0]).toMatchObject({ tipo: 'manual', trecho: 'a gente' });
    const momentos = r.body.animacoes.momentos as {
      tipo: string;
      usar: boolean;
      itens: { texto: string }[];
    }[];
    expect(momentos.map((m) => [m.tipo, m.usar])).toEqual([
      ['selo', false],
      ['nomes', true],
    ]);
    expect(momentos[1]!.itens.map((i) => i.texto)).toEqual(['SALVADOR', 'RECIFE', 'NATAL']);
    expect(r.body.som.musica.volume).toBe(22);
    expect(r.body).toMatchObject({ mudancasPendentes: true, podeDesfazerPedido: true });

    const d = await enviar('post', `/videos/${id}/pedido/desfazer`, { versao: 2 });
    expect(d.status).toBe(200);
    expect(d.body.cortes).toHaveLength(0);
    expect(d.body.animacoes.momentos).toHaveLength(1);
    expect(d.body.som.musica.volume).toBe(35);
    expect(d.body).toMatchObject({ mudancasPendentes: false, podeDesfazerPedido: false });
    expect((await enviar('post', `/videos/${id}/pedido/desfazer`, { versao: 3 })).status).toBe(422);

    // v169: desfazer tira só o que o pedido mudou. O que a pessoa mexeu depois dele fica.
    const p2 = await enviar('put', `/videos/${id}/revisao`, { versao: 3, ...revisao, doPedido: true });
    expect(p2.body.cortes).toHaveLength(1);
    const manual = await enviar('put', `/videos/${id}/revisao`, {
      versao: p2.body.versao,
      estilo: 'balao',
      cores: { primaria: '#0f766e', destaque: '#22d3ee' },
      musica: { volume: 50 },
    });
    expect(manual.body).toMatchObject({ podeDesfazerPedido: true });
    const d2 = await enviar('post', `/videos/${id}/pedido/desfazer`, { versao: manual.body.versao });
    expect(d2.status).toBe(200);
    // O corte e a animação do pedido saíram…
    expect(d2.body.cortes).toHaveLength(0);
    expect(d2.body.animacoes.momentos).toHaveLength(1);
    // …e o estilo, as cores e o volume mexidos depois ficaram.
    expect(d2.body.opcoes).toMatchObject({
      estilo: 'balao',
      cores: { primaria: '#0f766e', destaque: '#22d3ee' },
    });
    expect(d2.body.som.musica.volume).toBe(50);
    expect(d2.body.mudancasPendentes).toBe(true);
    await enviar('put', `/videos/${id}/revisao`, {
      versao: d2.body.versao,
      estilo: 'acesa',
      cores: null,
      musica: { volume: 35 },
    });

    // A IA não propôs nada que feche: a pessoa recebe a orientação, não uma lista vazia.
    respostaDaIa = {
      resposta: 'Vou cortar.',
      mudancas: [{ acao: 'cortar', resumo: 'x', de: 500, ate: 501 }],
    };
    const vazio = await enviar('post', `/videos/${id}/pedido`, { texto: 'corta aquilo' });
    expect(vazio.body.propostas).toHaveLength(0);
    expect(vazio.body.resposta).toContain('Falar deste momento');

    // v162: vídeo de apoio na revisão: envia em partes, põe um trecho num momento, troca, tira.
    const ap = await enviar('post', `/videos/${id}/apoios`, {
      nome: 'moto-passando.mp4',
      tipo: 'video/mp4',
      bytes: 9,
      duracao: 8,
    });
    expect(ap.status).toBe(201);
    const apoioId = ap.body.apoioId as string;
    const parte = (n: number, corpo: Buffer) =>
      request(app)
        .put(`/videos/${id}/apoios/${apoioId}/partes/${n}`)
        .set('Origin', ORIGEM)
        .set('Cookie', cookie)
        .set('Content-Type', 'application/octet-stream')
        .send(corpo);
    expect((await parte(1, Buffer.from('apoio')))?.status).toBe(200);
    expect((await enviar('post', `/videos/${id}/apoios/${apoioId}/concluir`, { partes: 2 })).status).toBe(
      422,
    );
    expect((await parte(2, Buffer.from('fim!')))?.status).toBe(200);
    const pronto = await enviar('post', `/videos/${id}/apoios/${apoioId}/concluir`, { partes: 2 });
    expect(pronto.status).toBe(200);
    expect(pronto.body.apoios).toEqual([
      expect.objectContaining({
        id: apoioId,
        nome: 'moto-passando.mp4',
        enviado: true,
        preparado: false,
        duracao: 8,
      }),
    ]);
    const { rows: g } = await pool.query<{ apoios: { chave: string }[] }>(
      'SELECT apoios FROM comercial.videos WHERE id = $1',
      [id],
    );
    const chaveApoio = g[0]!.apoios[0]!.chave;
    expect(Buffer.from(arquivos.get(chaveApoio)!).toString()).toBe('apoiofim!');
    expect((await parte(3, Buffer.from('x')))?.status).toBe(422);
    expect((await ler(`/videos/${id}/arquivo?tipo=apoio&apoio=${apoioId}`)).body.url).toContain(chaveApoio);

    let versao = pronto.body.versao as number;
    let r2 = await enviar('put', `/videos/${id}/revisao`, { versao, novaImagem: { em: 5, apoioId } });
    expect(r2.status).toBe(200);
    expect(r2.body.imagens).toEqual([
      expect.objectContaining({
        origem: 'apoio',
        apoioId,
        apoioDe: 0,
        encaixe: 'cheia',
        pedido: null,
        chave: null,
      }),
    ]);
    versao = r2.body.versao;
    // O segundo trecho continua de onde o primeiro parou; mexer no começo respeita o tamanho do apoio.
    r2 = await enviar('put', `/videos/${id}/revisao`, { versao, novaImagem: { em: 12, apoioId } });
    expect(r2.body.imagens[1]).toMatchObject({ apoioId, apoioDe: 3 });
    versao = r2.body.versao;
    r2 = await enviar('put', `/videos/${id}/revisao`, {
      versao,
      imagens: [{ id: r2.body.imagens[1].id, apoioDe: 99 }],
    });
    expect(r2.body.imagens[1].apoioDe).toBe(5);
    // v169: aumentar o tempo na tela do trecho de apoio (até a próxima imagem e até o apoio acabar).
    const primeiro = r2.body.imagens[0] as { id: string; inicio: number; fim: number };
    let r3 = await enviar('put', `/videos/${id}/revisao`, {
      versao: r2.body.versao,
      imagens: [{ id: primeiro.id, segundos: 6 }],
    });
    expect(r3.status).toBe(200);
    expect(r3.body.imagens[0].fim - r3.body.imagens[0].inicio).toBeCloseTo(6, 2);
    expect(r3.body.mudancasPendentes).toBe(true);
    r3 = await enviar('put', `/videos/${id}/revisao`, {
      versao: r3.body.versao,
      imagens: [{ id: primeiro.id, segundos: 60 }],
    });
    // Não entra na próxima imagem nem passa do tamanho do apoio (8 s).
    expect(r3.body.imagens[0].fim).toBeLessThanOrEqual(r3.body.imagens[1].inicio - 0.2 + 0.001);
    expect(r3.body.imagens[0].fim - r3.body.imagens[0].inicio).toBeLessThanOrEqual(8);
    expect(
      r3.body.imagens[0].apoioDe + (r3.body.imagens[0].fim - r3.body.imagens[0].inicio),
    ).toBeLessThanOrEqual(8.001);
    r3 = await enviar('put', `/videos/${id}/revisao`, {
      versao: r3.body.versao,
      imagens: [{ id: primeiro.id, segundos: 2 }],
    });
    expect(r3.body.imagens[0].fim - r3.body.imagens[0].inicio).toBeCloseTo(2, 2);
    r2 = r3;
    expect(
      (
        await enviar('put', `/videos/${id}/revisao`, {
          versao: r2.body.versao,
          novaImagem: { em: 17, apoioId: 'zz' },
        })
      ).status,
    ).toBe(422);
    // v163: espalhar o apoio pelo vídeo (sem a IA) e as cores só deste vídeo.
    const antesDeEspalhar = (await ler(`/videos/${id}`)).body;
    const esp = await enviar('post', `/videos/${id}/apoios/espalhar`, { versao: antesDeEspalhar.versao });
    expect(esp.status).toBe(200);
    expect(esp.body.imagens.length).toBeGreaterThan(antesDeEspalhar.imagens.length);
    expect(esp.body.imagens.every((i: { origem: string }) => i.origem === 'apoio')).toBe(true);
    const cor = await enviar('put', `/videos/${id}/revisao`, {
      versao: esp.body.versao,
      cores: { primaria: '#6d28d9', destaque: '#ff7a00' },
    });
    expect(cor.body.opcoes.cores).toEqual({ primaria: '#6d28d9', destaque: '#ff7a00' });
    expect(
      (await enviar('put', `/videos/${id}/revisao`, { versao: cor.body.versao, cores: null })).body.opcoes
        .cores,
    ).toBeNull();
    const fora = await enviar('delete', `/videos/${id}/apoios/${apoioId}`);
    expect(fora.status).toBe(200);
    expect(fora.body).toMatchObject({ apoios: [], imagens: [], mudancasPendentes: true });
    expect(arquivos.has(chaveApoio)).toBe(false);

    // v164: ouvir a fala de novo e refazer a edição do zero.
    const zero = await enviar('post', `/videos/${id}/do-zero`, {});
    expect(zero.status).toBe(200);
    expect(zero.body).toMatchObject({ situacao: 'na_fila', mudancasPendentes: false });
    expect(publicados.at(-1)).toEqual({ nome: 'video.editar', payload: { videoId: id, modo: 'primeira' } });
    expect((await enviar('post', `/videos/${id}/do-zero`, {})).status).toBe(422);
    await pool.query('DELETE FROM comercial.videos WHERE id = $1', [id]);
  });

  it('v166: a revisão guarda a fonte, as cores e o lugar da legenda e das camadas', async () => {
    await pool.query(`UPDATE comercial.videos SET situacao = 'pronto' WHERE id = $1`, [videoId]);
    const antes = await ler(`/videos/${videoId}`);
    expect(antes.body.opcoes.legenda).toMatchObject({ fonte: 'montserrat', tamanho: 1, dx: 0, dy: 0 });
    // Vídeo editado antes da v166: ainda não há o desenho para a prévia.
    expect(antes.body.desenho).toBeNull();
    const legenda = {
      fonte: 'poppins',
      tamanho: 1.2,
      corTexto: null,
      corAcesa: '#e11d48',
      corContorno: null,
      corForte: '#ffffff',
      dx: 0,
      dy: 80,
      trechos: { '4': { dx: 0, dy: 120, escala: 1.1 } },
    };
    const camadas = { titulo: { dx: 0, dy: 40 }, animacoes: { dx: -60, dy: 0 } };
    const r = await enviar('put', `/videos/${videoId}/revisao`, {
      versao: antes.body.versao,
      legenda,
      camadas,
    });
    expect(r.status).toBe(200);
    expect(r.body.opcoes.legenda).toEqual(legenda);
    expect(r.body.opcoes.camadas).toEqual(camadas);
    expect(r.body.mudancasPendentes).toBe(true);
    const ruim = await enviar('put', `/videos/${videoId}/revisao`, {
      versao: r.body.versao,
      legenda: { ...legenda, fonte: 'comic' },
    });
    expect(ruim.status).toBe(422);
    // v167: estilo novo, acabamento de filme, transição nova e a tarja de nome.
    const v167 = await enviar('put', `/videos/${videoId}/revisao`, {
      versao: r.body.versao,
      estilo: 'pilula',
      acabamento: 'filme',
      transicaoApoio: 'chicote',
      tarja: { nome: 'Ana Souza', cargo: 'Gerente da loja' },
    });
    expect(v167.status).toBe(200);
    expect(v167.body.opcoes).toMatchObject({
      estilo: 'pilula',
      acabamento: 'filme',
      transicaoApoio: 'chicote',
      tarja: { nome: 'Ana Souza', cargo: 'Gerente da loja' },
    });
    expect(
      (await enviar('put', `/videos/${videoId}/revisao`, { versao: v167.body.versao, acabamento: 'sepia' }))
        .status,
    ).toBe(422);
    // As cores das animações só deste vídeo, e a volta às da marca.
    const cores = await enviar('put', `/videos/${videoId}/revisao`, {
      versao: v167.body.versao,
      cores: { primaria: '#0f766e', destaque: '#22d3ee' },
    });
    expect(cores.body.opcoes.cores).toEqual({ primaria: '#0f766e', destaque: '#22d3ee' });
    const volta = await enviar('put', `/videos/${videoId}/revisao`, {
      versao: cores.body.versao,
      cores: null,
    });
    expect(volta.body.opcoes.cores).toBeNull();
    // Com o desenho guardado pelo editor, a tela recebe o desenho e o link do vídeo sem legenda.
    await pool.query(
      `UPDATE comercial.videos SET analise = COALESCE(analise, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
      [
        videoId,
        JSON.stringify({
          desenho: {
            videoChave: 'videos/1/x/limpo-1.mp4',
            estilo: 'acesa',
            cores: { primaria: '#7c3aed', destaque: '#facc15' },
            legendas: [
              { k: 0, ini: 0, fim: 1, topo: 1200, tam: 84, altura: 120, palavras: [['OI', 0, 1, 0]] },
            ],
            titulo: null,
            animacoes: [],
            rostos: [],
            tamanho: 1.2,
          },
        }),
      ],
    );
    arquivos.set('videos/1/x/limpo-1.mp4', new Uint8Array([1]));
    const d = await ler(`/videos/${videoId}`);
    expect(d.body.desenho).toMatchObject({ temVideo: true, tamanho: 1.2 });
    expect(d.body.desenho.videoChave).toBeUndefined();
    const link = await ler(`/videos/${videoId}/arquivo?tipo=limpo`);
    expect(link.status).toBe(200);
    expect(typeof link.body.url).toBe('string');
  });

  it('palavras sempre escritas assim e apagar o vídeo com os arquivos', async () => {
    const v = await enviar('put', '/videos/preferencias/vocabulario', {
      palavras: ['Horizonte', '5W30', 'Horizonte'],
    });
    expect(v.body.palavras).toEqual(['Horizonte', '5W30']);
    expect((await ler('/videos/preferencias/vocabulario')).body.palavras).toEqual(['Horizonte', '5W30']);
    arquivos.set('videos/1/x/editado.mp4', new Uint8Array([1]));
    const { rows } = await pool.query<{ original_chave: string }>(
      'SELECT original_chave FROM comercial.videos WHERE id = $1',
      [videoId],
    );
    expect((await enviar('delete', `/videos/${videoId}`)).status).toBe(200);
    expect(arquivos.has(rows[0]!.original_chave)).toBe(false);
    expect(arquivos.has('videos/1/x/editado.mp4')).toBe(false);
    expect((await ler(`/videos/${videoId}`)).status).toBe(404);
  });
});
