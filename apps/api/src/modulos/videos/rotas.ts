import { randomUUID } from 'node:crypto';
import { prepararImagem } from '@prospeccao/integrations/slides';
import { AppError } from '@prospeccao/shared';
import { MAX_FOTOS_CONTA } from '@prospeccao/shared/carrosseis';
import {
  ENTREGAS,
  escolherPostEntrada,
  LIMITE_ARQUIVO_DIRECT,
  publicacaoEntrada,
  TIPOS_ARQUIVO_DIRECT,
} from '@prospeccao/shared/carrosseis-publicacao';
import {
  LIMITE_BYTES_VIDEO,
  LIMITE_SEGUNDOS_VIDEO,
  MAX_FOTO_BYTES,
  novoVideoEntrada,
  revisaoEntrada,
  TAMANHO_PARTE_ENVIO,
  TIPOS_FOTO,
  textoPostEntrada,
  vocabularioEntrada,
} from '@prospeccao/shared/videos';
import express, { type Request, Router } from 'express';
import { z } from 'zod';
import { conta } from '../../contexto.js';
import type { DepsApi } from '../../dependencias.js';
import { consulta, corpo, idDaRota } from '../../middlewares/http.js';
import { exigirAdmin } from '../../middlewares/seguranca.js';
import { contratoDaConta, rotaComModulo, temModulo } from '../../recursos.js';
import * as pub from '../carrosseis/publicacao.js';
import * as fotos from '../carrosseis/repositorio.js';
import * as publicar from '../instagram/publicar.js';
import * as publicacao from './publicacao.js';
import * as repo from './repositorio.js';

/**
 * Vídeos com IA (módulo à parte, só o administrador, como os Carrosséis). O navegador manda o vídeo
 * em partes de 8 MB (a api repassa para o armazenamento, sem guardar tudo na memória); ao concluir,
 * o vídeo entra na fila do worker-videos, que edita e avisa no sino.
 */

export function rotasVideos(deps: DepsApi): Router {
  const { pool, filas } = deps;
  const arm = () => deps.reunioes?.armazenamento ?? null;
  const exigirArmazenamento = () => {
    const a = arm();
    if (!a)
      throw new AppError(
        503,
        'indisponivel',
        'O armazenamento de arquivos não está ligado: o vídeo não pode ser guardado. Fale com a gente.',
      );
    return a;
  };
  const franquia = async () => {
    const c = await contratoDaConta(pool).catch(() => null);
    return { usados: await repo.usadosNoMes(pool), limite: c ? c.videosMes : null };
  };

  // A música segue o plano: toda conta com o módulo Vídeos (a rota já exige) tem, se o worker tiver a chave.
  const recursos = async () => ({
    imagensGeradas: !!deps.videos?.imagensGeradas,
    musica: deps.videos?.musicaLiberada
      ? deps.videos.musicaLiberada(conta())
      : await repo.musicaNoWorker(pool).catch(() => false),
  });

  const r = Router();
  r.use(exigirAdmin);
  r.use(rotaComModulo(pool, 'videos', (req) => req.method === 'GET' && req.path === '/situacao'));

  r.get('/situacao', async (_req, res) => {
    const modulo = await temModulo(pool, 'videos');
    res.json({
      modulo,
      armazenamento: !!arm(),
      servico: modulo ? await repo.servicoNoAr(pool) : false,
      franquia: modulo ? await franquia() : { usados: 0, limite: 0 },
      limiteSegundos: LIMITE_SEGUNDOS_VIDEO,
      limiteBytes: LIMITE_BYTES_VIDEO,
      tamanhoParte: TAMANHO_PARTE_ENVIO,
      recursos: await recursos(),
      fotosDaEmpresa: modulo ? (await repo.fotosDaEmpresa(pool)).length : 0,
    });
  });

  /**
   * Fotos da empresa também por aqui (as mesmas dos Carrosséis): quem tem só o módulo de vídeos
   * precisa subir as fotos dos produtos e da loja para a IA usar.
   */
  r.post(
    '/fotos',
    express.raw({ type: [...TIPOS_FOTO, 'image/heic', 'image/heif'], limit: 15 * 1024 * 1024 }),
    async (req, res) => {
      const a = exigirArmazenamento();
      const { nome } = consulta(req, z.object({ nome: z.string().trim().max(80).default('Foto') }));
      if (!Buffer.isBuffer(req.body) || req.body.byteLength < 500) throw AppError.invalido('Envie a foto.');
      if ((await fotos.contarFotos(pool)) >= MAX_FOTOS_CONTA)
        throw AppError.invalido(
          `Até ${MAX_FOTOS_CONTA} fotos por conta: apague alguma antes de enviar outra.`,
        );
      const img = await prepararImagem(req.body, { maxLado: 2160 }).catch(() => {
        throw AppError.invalido('Não deu para ler esta foto. Use JPG, PNG ou WEBP.');
      });
      if (Math.min(img.largura, img.altura) < 500)
        throw AppError.invalido('Foto pequena demais: use uma com pelo menos 500 px no lado menor.');
      const chave = `carrosseis/${conta()}/fotos/${randomUUID()}.jpg`;
      await a.enviar(chave, new Uint8Array(img.dados), 'image/jpeg');
      const f = await fotos.adicionarFoto(pool, {
        nome: nome.replace(/\.[a-z0-9]{2,5}$/i, '') || 'Foto',
        chave,
        largura: img.largura,
        altura: img.altura,
        bytes: img.dados.byteLength,
      });
      res.status(201).json(f);
    },
  );

  r.delete('/fotos/:id', async (req, res) => {
    const chave = await fotos.apagarFoto(pool, idDaRota(req));
    await arm()
      ?.apagar([chave])
      .catch(() => undefined);
    res.json({ ok: true });
  });

  /** As fotos da empresa (as dos Carrosséis), para trocar uma imagem do vídeo. */
  r.get('/fotos', async (_req, res) => {
    const a = arm();
    const fotos = await repo.fotosDaEmpresa(pool);
    res.json({
      fotos: await Promise.all(
        fotos.map(async (f) => ({
          id: f.id,
          nome: f.nome,
          descricao: f.descricao,
          url: a ? await a.urlAssinada(f.chave, { segundos: 3600 }) : null,
        })),
      ),
    });
  });

  r.get('/', async (_req, res) => {
    res.json({ videos: await repo.listar(pool), franquia: await franquia() });
  });

  /* ── v131: o vídeo no Instagram (a mesma regra e o mesmo reconhecimento dos carrosséis) ── */

  const ia = () => deps.carrosseisIa ?? null;
  const pecaDa = (req: Request) => publicacao.peca(idDaRota(req));
  const aba = (req: Request) => pub.publicacao(pool, pecaDa(req), !!ia());

  r.get('/publicacao/posts', async (_req, res) => {
    res.json({ posts: await pub.ultimasPublicacoes(pool) });
  });

  r.get('/:id/publicacao', async (req, res) => {
    res.json(await aba(req));
  });

  r.put('/:id/publicacao', async (req, res) => {
    await pub.salvar(pool, pecaDa(req), corpo(req, publicacaoEntrada));
    res.json(await aba(req));
  });

  r.post(
    '/:id/publicacao/arquivo',
    express.raw({ type: [...TIPOS_ARQUIVO_DIRECT], limit: LIMITE_ARQUIVO_DIRECT }),
    async (req, res) => {
      const nome = decodeURIComponent(String(req.get('x-nome-arquivo') ?? '')).slice(0, 200);
      await pub.guardarArquivo(pool, exigirArmazenamento(), pecaDa(req), {
        corpo: Buffer.isBuffer(req.body) ? new Uint8Array(req.body) : new Uint8Array(),
        tipo: String(req.get('content-type') ?? '')
          .split(';')[0]!
          .trim(),
        nome,
      });
      res.json(await aba(req));
    },
  );

  r.get('/:id/publicacao/arquivo', async (req, res) => {
    res.redirect(302, await pub.linkDoArquivo(pool, exigirArmazenamento(), pecaDa(req)));
  });

  /** A redatora (re)escreve o direct para a entrega escolhida (não salva: a pessoa confere antes). */
  r.post('/:id/publicacao/direct', async (req, res) => {
    const d = corpo(
      req,
      z.object({
        entrega: z.enum(ENTREGAS),
        palavra: z.string().trim().min(2).max(40),
        divulgarId: z.number().int().positive().nullable().default(null),
        material: z.string().trim().max(300).default(''),
      }),
    );
    const claude = ia()?.cliente(pool, conta()) ?? null;
    const x = await pub.directDaPeca(pool, claude, { peca: pecaDa(req), ...d });
    res.json({ mensagem: x.mensagem, botao: x.botao, daRedatora: x.daRedatora });
  });

  r.post('/:id/publicacao/post', async (req, res) => {
    const { midiaId } = corpo(req, escolherPostEntrada);
    await pub.escolherPost(deps, pecaDa(req), midiaId);
    res.json(await aba(req));
  });

  r.delete('/:id/publicacao/post', async (req, res) => {
    await pub.naoEOPost(pool, pecaDa(req));
    res.json(await aba(req));
  });

  /* ── v133: publicar e agendar pelo CRM ── */

  const publicarEntrada = z.object({
    /** null: agora. */
    para: z.string().datetime({ offset: true }).nullable().default(null),
    legenda: z.string().max(2200).nullable().default(null),
    comente: z.boolean().default(true),
  });

  r.get('/:id/publicar', async (req, res) => {
    const peca = { tipo: 'video', id: idDaRota(req) } as const;
    res.json({
      situacao: await publicar.situacao(pool),
      agendamento: await publicar.agendamentoDa(pool, peca),
    });
  });

  r.post('/:id/publicar', async (req, res) => {
    const d = corpo(req, publicarEntrada);
    const peca = { tipo: 'video', id: idDaRota(req) } as const;
    const a = await publicar.agendar(
      pool,
      peca,
      { para: d.para ? new Date(d.para) : null, legenda: d.legenda, comente: d.comente },
      req.usuario?.id ?? null,
    );
    // "Publicar agora": a rotina pega no próximo minuto; a tela acompanha.
    res.status(201).json({ situacao: await publicar.situacao(pool), agendamento: a });
  });

  r.delete('/:id/publicar', async (req, res) => {
    const peca = { tipo: 'video', id: idDaRota(req) } as const;
    await publicar.cancelar(pool, peca);
    res.json({
      situacao: await publicar.situacao(pool),
      agendamento: await publicar.agendamentoDa(pool, peca),
    });
  });

  /** O texto do post do Reels que a pessoa editou. */
  r.put('/:id/publicacao/texto', async (req, res) => {
    const d = corpo(req, textoPostEntrada);
    await repo.salvarTextoPost(pool, idDaRota(req), {
      texto: d.texto,
      hashtags: d.hashtags,
      daRedatora: false,
    });
    res.json(await repo.buscar(pool, idDaRota(req)));
  });

  /** A redatora escreve (ou reescreve) o texto do post; sem ela, entra o texto padrão. */
  r.post('/:id/publicacao/texto', async (req, res) => {
    const claude = ia()?.cliente(pool, conta()) ?? null;
    const x = await publicacao.escreverTexto(pool, claude, idDaRota(req));
    res.json({ ...(await repo.buscar(pool, idDaRota(req))), daRedatora: x.daRedatora });
  });

  /* ── Envio em partes ── */

  r.post('/', async (req, res) => {
    const d = corpo(req, novoVideoEntrada);
    const a = exigirArmazenamento();
    if (d.duracao != null && d.duracao > LIMITE_SEGUNDOS_VIDEO + 1)
      throw AppError.invalido(
        `O vídeo passa de ${Math.round(LIMITE_SEGUNDOS_VIDEO / 60)} minutos. Corte um trecho antes de enviar.`,
      );
    if (d.opcoes.chamada.tipo === 'comente' && !d.opcoes.chamada.palavra)
      throw AppError.invalido('Escreva a palavra do "Comente…" da chamada no fim.');
    const f = await franquia();
    if (f.limite != null && f.usados >= f.limite)
      throw new AppError(
        403,
        'franquia',
        `Os ${f.limite} vídeos do mês já foram usados. Fale com a gente para aumentar a franquia; no dia 1º ela volta.`,
        { detalhes: { recurso: 'videos', usado: f.usados, limite: f.limite } },
      );
    const id = await repo.criar(pool, d, (v) => `videos/${conta()}/${v}/original-${Date.now().toString(36)}`);
    const { original: chave } = await repo.arquivos(pool, id);
    const envioId = await a.iniciarEmPartes(chave, d.tipo);
    await repo.guardarEnvio(pool, id, envioId);
    res.status(201).json({ id, tamanhoParte: TAMANHO_PARTE_ENVIO });
  });

  r.put(
    '/:id/partes/:numero',
    express.raw({ type: () => true, limit: TAMANHO_PARTE_ENVIO + 1024 }),
    async (req, res) => {
      const id = idDaRota(req);
      const numero = z.coerce.number().int().min(1).max(200).parse(req.params.numero);
      const bytes = req.body as Buffer;
      if (!Buffer.isBuffer(bytes) || !bytes.length) throw AppError.invalido('Parte vazia.');
      const e = await repo.envio(pool, id);
      const etag = await exigirArmazenamento().enviarParte(e.chave, e.envioId, numero, new Uint8Array(bytes));
      await repo.anotarParte(pool, id, { numero, etag });
      res.json({ ok: true });
    },
  );

  r.post('/:id/concluir', async (req, res) => {
    const id = idDaRota(req);
    const { partes } = corpo(req, z.object({ partes: z.number().int().min(1).max(200) }));
    const e = await repo.envio(pool, id);
    const lista = [...e.partes].sort((a, b) => a.numero - b.numero);
    if (lista.length !== partes || lista.some((p, k) => p.numero !== k + 1))
      throw AppError.invalido('O envio não chegou inteiro. Tente enviar de novo.');
    await exigirArmazenamento().concluirEmPartes(e.chave, e.envioId, lista);
    await repo.paraFila(pool, id);
    await filas.publicar('video.editar', { videoId: id, modo: 'primeira' });
    res.json(await repo.buscar(pool, id));
  });

  /* ── O vídeo ── */

  r.get('/:id', async (req, res) => {
    const id = idDaRota(req);
    const v = await repo.buscar(pool, id);
    res.json({ ...v, naFrente: v.situacao === 'na_fila' ? await repo.naFrente(pool, id) : 0 });
  });

  /** Link temporário: o vídeo pronto (para tocar ou baixar), a capa ou o original. */
  r.get('/:id/arquivo', async (req, res) => {
    const id = idDaRota(req);
    const { tipo, baixar, imagem } = consulta(
      req,
      z.object({
        tipo: z.enum(['final', 'capa', 'original', 'imagem', 'musica', 'previa']).default('final'),
        baixar: z.enum(['sim', 'nao']).default('nao'),
        imagem: z.string().max(40).optional(),
      }),
    );
    const a = exigirArmazenamento();
    const f = await repo.arquivos(pool, id);
    const chave =
      tipo === 'final'
        ? f.final
        : tipo === 'capa'
          ? f.capa
          : tipo === 'imagem'
            ? (f.imagens.find((i) => i.id === imagem)?.chave ?? null)
            : tipo === 'musica'
              ? f.musica
              : tipo === 'previa'
                ? f.previa
                : f.situacao === 'enviando'
                  ? null
                  : f.original;
    if (!chave) throw AppError.naoEncontrado('Arquivo');
    if (tipo === 'final' && baixar === 'sim') await repo.marcarBaixado(pool, id);
    const nome = `${f.titulo.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'video'}.mp4`;
    const url = await a.urlAssinada(chave, {
      segundos: 3600,
      ...(baixar === 'sim' ? { baixarComo: nome } : {}),
    });
    res.json({ url });
  });

  r.put('/:id/revisao', async (req, res) => {
    const rc = await recursos();
    res.json(
      await repo.revisar(pool, idDaRota(req), corpo(req, revisaoEntrada), {
        imagensGeradas: rc.imagensGeradas,
        musicaLiberada: rc.musica,
      }),
    );
  });

  /** Foto sua para uma imagem do vídeo (?imagem=id) ou para pôr uma imagem nova (?em=segundos). */
  r.post(
    '/:id/imagens/foto',
    express.raw({ type: [...TIPOS_FOTO], limit: MAX_FOTO_BYTES }),
    async (req, res) => {
      const id = idDaRota(req);
      const a = exigirArmazenamento();
      const { imagem, em } = consulta(
        req,
        z.object({
          imagem: z.string().min(1).max(40).optional(),
          em: z.coerce.number().min(0).max(LIMITE_SEGUNDOS_VIDEO).optional(),
        }),
      );
      if (!Buffer.isBuffer(req.body) || req.body.byteLength < 500) throw AppError.invalido('Envie a foto.');
      const img = await prepararImagem(req.body, { maxLado: 1920 }).catch(() => {
        throw AppError.invalido('Não deu para ler esta foto. Use JPG, PNG ou WEBP.');
      });
      if (Math.min(img.largura, img.altura) < 400)
        throw AppError.invalido('Foto pequena demais: use uma com pelo menos 400 px no lado menor.');
      const chave = `videos/${conta()}/${id}/propria-${Date.now().toString(36)}.jpg`;
      await a.enviar(chave, new Uint8Array(img.dados), 'image/jpeg');
      try {
        const { detalhe, antiga } = await repo.usarFotoPropria(pool, id, {
          imagemId: imagem ?? null,
          em: em ?? null,
          chave,
        });
        if (antiga) await a.apagar([antiga]).catch(() => undefined);
        res.json(detalhe);
      } catch (erro) {
        await a.apagar([chave]).catch(() => undefined);
        throw erro;
      }
    },
  );

  r.post('/:id/gerar', async (req, res) => {
    const id = idDaRota(req);
    await repo.pedirDeNovo(pool, id);
    await filas.publicar('video.editar', { videoId: id, modo: 'refazer' });
    res.json(await repo.buscar(pool, id));
  });

  r.delete('/:id', async (req, res) => {
    const l = await repo.apagar(pool, idDaRota(req));
    const a = arm();
    if (a) {
      if (l.envio_id) await a.cancelarEmPartes(l.original_chave, l.envio_id).catch(() => undefined);
      await a.apagar([...repo.arquivosDoVideo(l), ...l.arquivosDaRegra]).catch(() => undefined);
    }
    res.json({ ok: true });
  });

  /* ── Palavras sempre escritas assim ── */

  r.get('/preferencias/vocabulario', async (_req, res) => {
    res.json({ palavras: await repo.vocabulario(pool) });
  });
  r.put('/preferencias/vocabulario', async (req, res) => {
    const { palavras } = corpo(req, vocabularioEntrada);
    await repo.salvarVocabulario(pool, palavras);
    res.json({ palavras });
  });

  return r;
}
