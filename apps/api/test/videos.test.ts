import { criarPool, migrar, type Pool } from '@prospeccao/db';
import { bancoDeTeste } from '@prospeccao/db/teste';
import type { Armazenamento } from '@prospeccao/integrations/reuniao';
import { criarLogger } from '@prospeccao/shared';
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

    const link = await ler(`/videos/${videoId}/arquivo?tipo=final&baixar=sim`);
    expect(link.body.url).toContain('videos/1/x/editado.mp4');
    expect(link.body.url).toContain('como=Promo');

    publicados.length = 0;
    const g = await enviar('post', `/videos/${videoId}/gerar`);
    expect(g.status).toBe(200);
    expect(g.body.situacao).toBe('na_fila');
    expect(publicados).toEqual([{ nome: 'video.editar', payload: { videoId, modo: 'refazer' } }]);
    // Na fila: não dá para revisar nem pedir de novo.
    expect((await enviar('put', `/videos/${videoId}/revisao`, { versao: 3 })).status).toBeGreaterThanOrEqual(
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
