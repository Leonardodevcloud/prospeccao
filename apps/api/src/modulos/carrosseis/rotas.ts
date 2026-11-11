import { randomUUID } from 'node:crypto';
import { prepararImagem } from '@prospeccao/integrations/slides';
import { AppError } from '@prospeccao/shared';
import {
  carrosselEntrada,
  carrosselNovoEntrada,
  ESTILOS,
  identidadeCarrosselEntrada,
  MAX_CARROSSEIS_CONTA,
  MAX_FOTOS_CONTA,
  MAX_SLIDES,
  MODELO,
  paletaDaIdentidade,
  roteiroInicial,
  slideEntrada,
  slideNovo,
} from '@prospeccao/shared/carrosseis';
import {
  ENTREGAS,
  escolherPostEntrada,
  LIMITE_ARQUIVO_DIRECT,
  publicacaoEntrada,
  TIPOS_ARQUIVO_DIRECT,
} from '@prospeccao/shared/carrosseis-publicacao';
import {
  avisoResolverEntrada,
  conversaEntrada,
  decisaoConversaEntrada,
  divulgarEntrada,
  dossieEntrada,
} from '@prospeccao/shared/carrosseis-time';
import express, { type Request, type Response, Router } from 'express';
import { strToU8, zipSync } from 'fflate';
import { z } from 'zod';
import { conta } from '../../contexto.js';
import type { DepsApi } from '../../dependencias.js';
import { consulta, corpo, idDaRota } from '../../middlewares/http.js';
import { exigirAdmin } from '../../middlewares/seguranca.js';
import { rotaComModulo, temModulo } from '../../recursos.js';
import * as publicar from '../instagram/publicar.js';
import * as marca from '../marca/repositorio.js';
import { organizacaoDaConta } from '../plano/repositorio.js';
import * as aprender from './aprender.js';
import * as cerebro from './cerebro.js';
import * as conversa from './conversa.js';
import { desenhar, materialDaConta } from './desenho.js';
import * as imagens from './imagens.js';
import { imagensLigadas } from './imagens.js';
import * as publicacao from './publicacao.js';
import * as repo from './repositorio.js';
import * as time from './time.js';

/**
 * Carrosséis com IA (módulo à parte). Só o administrador da conta entra (configuração e conteúdo
 * da marca); a situação vale sempre, para a tela mostrar o que falta liberar.
 */

const LIMITE_FOTO = 15 * 1024 * 1024;
const TIPOS_IMAGEM = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const TIPOS_LOGO = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
const tipoLogo = z.enum(['claro', 'escuro']);

const larguraConsulta = z.object({ largura: z.coerce.number().int().min(120).max(1080).default(1080) });

export function rotasCarrosseis(deps: DepsApi): Router {
  const { pool } = deps;
  const arm = () => deps.reunioes?.armazenamento ?? null;
  const exigirArmazenamento = () => {
    const a = arm();
    if (!a)
      throw new AppError(
        503,
        'indisponivel',
        'O armazenamento de arquivos não está ligado: as imagens não podem ser guardadas. Fale com a gente.',
      );
    return a;
  };
  const r = Router();
  r.use(exigirAdmin);
  r.use(rotaComModulo(pool, 'carrosseis', (req) => req.method === 'GET' && req.path === '/situacao'));

  const franquia = () => time.franquia(pool);
  const ia = () => deps.carrosseisIa ?? null;

  r.get('/situacao', async (req, res) => {
    const modulo = await temModulo(pool, 'carrosseis');
    const visto = await pool.query<{ visto: boolean }>(
      'SELECT time_carrosseis_visto_em IS NOT NULL AS visto FROM cadastro.usuarios WHERE id = $1',
      [req.usuario!.id],
    );
    res.json({
      modulo,
      /** A pessoa já viu a apresentação do time de IA (aparece uma vez, na primeira entrada). */
      timeVisto: visto.rows[0]?.visto ?? true,
      armazenamento: !!arm(),
      /** O Comente e receba: o Instagram no plano e conectado (o pedido ao time avisa quando não). */
      instagram: await publicacao.instagramDaConta(pool),
      franquia: await franquia(),
      ia: {
        ligada: !!ia(),
        cerebroConferido: modulo ? !!(await cerebro.cerebro(pool)).conferidoEm : false,
        /** v132: o time pode fazer imagens (a chave da OpenAI e o armazenamento ligados). */
        imagens: imagensLigadas(ia()),
      },
    });
  });

  r.post('/time-visto', async (req, res) => {
    await pool.query('UPDATE cadastro.usuarios SET time_carrosseis_visto_em = now() WHERE id = $1', [
      req.usuario!.id,
    ]);
    res.json({ ok: true });
  });

  /* ── Cérebro da marca ── */

  r.get('/cerebro', async (_req, res) => {
    res.json({ ...(await cerebro.cerebro(pool)), pedido: await time.pedidoDoDossie(pool), iaLigada: !!ia() });
  });

  r.put('/cerebro', async (req, res) => {
    const d = corpo(req, z.object({ dossie: dossieEntrada, conferir: z.boolean().default(false) }));
    await cerebro.salvarDossie(pool, d.dossie, d.conferir);
    res.json(await cerebro.cerebro(pool));
  });

  /** A IA lê o que o CRM sabe da empresa e monta um rascunho (a pessoa confere depois). */
  r.post('/cerebro/gerar', async (_req, res) => {
    res.status(202).json(await time.pedirDossie(pool, ia()));
  });

  /* ── O que divulgar ── */

  r.get('/divulgar', async (req, res) => {
    const { antigos } = consulta(req, z.object({ antigos: z.enum(['sim', 'nao']).default('nao') }));
    res.json({ itens: await cerebro.listarDivulgar(pool, antigos === 'sim') });
  });
  r.post('/divulgar', async (req, res) => {
    res.status(201).json(await cerebro.criarDivulgar(pool, corpo(req, divulgarEntrada)));
  });
  r.put('/divulgar/:id', async (req, res) => {
    res.json(await cerebro.atualizarDivulgar(pool, idDaRota(req), corpo(req, divulgarEntrada)));
  });
  r.delete('/divulgar/:id', async (req, res) => {
    await cerebro.apagarDivulgar(pool, idDaRota(req));
    res.json({ ok: true });
  });

  /* ── O time de IA ── */

  r.get('/time', async (_req, res) => {
    res.json({ pedidos: await time.pedidosRecentes(pool), franquia: await franquia(), iaLigada: !!ia() });
  });
  r.post('/time', async (req, res) => {
    res.status(201).json(await time.pedirCarrossel(pool, ia(), req.body));
  });
  r.get('/time/:id', async (req, res) => {
    res.json(await time.pedido(pool, idDaRota(req)));
  });
  r.post('/time/:id/cancelar', async (req, res) => {
    await time.cancelar(pool, idDaRota(req));
    res.json({ ok: true });
  });

  /* ── v134: o que o time aprendeu, as ideias e as contas de referência ── */

  r.get('/aprendizados', async (_req, res) => {
    res.json(await aprender.oQueAprendeu(pool));
  });
  r.get('/ideias', async (_req, res) => {
    res.json({
      ideias: await aprender.ideias(pool),
      buscando: await aprender.buscaEmAndamento(pool),
      iaLigada: !!ia(),
    });
  });
  r.post('/ideias/buscar', async (_req, res) => {
    res.status(202).json(await aprender.pedirBuscaDeIdeias(pool, ia()));
  });
  r.post('/ideias/:id/descartar', async (req, res) => {
    await aprender.descartarIdeia(pool, idDaRota(req));
    res.json({ ok: true });
  });
  r.get('/referencias-contas', async (_req, res) => {
    res.json({ contas: await aprender.referencias(pool), max: aprender.MAX_REFERENCIAS });
  });
  r.post('/referencias-contas', async (req, res) => {
    const { usuario } = corpo(req, z.object({ usuario: z.string().min(1).max(120) }));
    res.status(201).json({ contas: await aprender.adicionarReferencia(pool, usuario) });
  });
  r.delete('/referencias-contas/:id', async (req, res) => {
    await aprender.apagarReferencia(pool, idDaRota(req));
    res.json({ ok: true });
  });

  /* ── Identidade visual ── */

  r.get('/identidade', async (_req, res) => {
    const g = await repo.identidade(pool);
    const org = await organizacaoDaConta(pool, conta());
    const m = await marca.dados(pool, org);
    // As logos que entram nos slides (as próprias ou as de Marca e domínio), com o tamanho delas.
    const material = await materialDaConta(pool, arm(), { ...g.identidade, usarLogoDaMarca: true });
    const logo = (tipo: 'claro' | 'escuro') => {
      const l = tipo === 'claro' ? material.logoClaro : material.logoEscuro;
      return l ? { origem: g.logos[tipo] ? 'propria' : 'marca', largura: l.largura, altura: l.altura } : null;
    };
    res.json({
      identidade: g.identidade,
      salva: g.salva,
      logos: { claro: logo('claro'), escuro: logo('escuro') },
      versao: material.versao,
      // Para o botão "Usar as cores de Marca e domínio" (só o que a marca tem).
      marca: {
        nome: m.nome ?? m.organizacaoNome,
        cores: {
          principal: m.corSecundaria ?? m.cor,
          destaque: m.corDestaque,
          claro: m.corClara,
        },
      },
      ajustes: paletaDaIdentidade(g.identidade.cores).ajustes,
      atualizadaEm: g.atualizadaEm,
    });
  });

  r.put('/identidade', async (req, res) => {
    const d = corpo(req, identidadeCarrosselEntrada);
    await repo.salvarIdentidade(pool, d);
    res.json({ ok: true, ajustes: paletaDaIdentidade(d.cores).ajustes });
  });

  r.get('/identidade/logo/:tipo', async (req, res) => {
    const tipo = tipoLogo.parse(req.params.tipo);
    // Mostra também a de Marca e domínio (a tela deixa escolher se usa ou não).
    const { identidade } = await repo.identidade(pool);
    const material = await materialDaConta(pool, arm(), { ...identidade, usarLogoDaMarca: true });
    const logo = tipo === 'claro' ? material.logoClaro : material.logoEscuro;
    if (!logo) throw AppError.naoEncontrado('Logo');
    const [cabeca, base64] = logo.src.split(',');
    res.setHeader('Content-Type', /image\/png/.test(cabeca ?? '') ? 'image/png' : 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.send(Buffer.from(base64 ?? '', 'base64'));
  });

  r.post(
    '/identidade/logo/:tipo',
    express.raw({ type: TIPOS_LOGO, limit: 5 * 1024 * 1024 }),
    async (req, res) => {
      const tipo = tipoLogo.parse(req.params.tipo);
      const a = exigirArmazenamento();
      if (!Buffer.isBuffer(req.body) || req.body.byteLength < 100)
        throw AppError.invalido('Envie a logo (PNG, JPG ou SVG).');
      const img = await prepararImagem(req.body, { maxLado: 1200, manterTransparencia: true }).catch(() => {
        throw AppError.invalido('Não deu para ler esta imagem. Use PNG, JPG ou SVG.');
      });
      const ext = img.tipo === 'image/png' ? 'png' : 'jpg';
      const chave = `carrosseis/${conta()}/logos/${tipo}-${randomUUID()}.${ext}`;
      await a.enviar(chave, new Uint8Array(img.dados), img.tipo);
      const antiga = await repo.definirLogo(pool, tipo, { chave, largura: img.largura, altura: img.altura });
      if (antiga) await a.apagar([antiga]).catch(() => undefined);
      res.status(201).json({ ok: true });
    },
  );

  r.delete('/identidade/logo/:tipo', async (req, res) => {
    const tipo = tipoLogo.parse(req.params.tipo);
    const antiga = await repo.definirLogo(pool, tipo, null);
    if (antiga)
      await arm()
        ?.apagar([antiga])
        .catch(() => undefined);
    res.json({ ok: true });
  });

  /* ── Fotos da empresa ── */

  r.get('/fotos', async (_req, res) => {
    res.json({ fotos: await repo.fotos(pool), max: MAX_FOTOS_CONTA });
  });

  r.post('/fotos', express.raw({ type: TIPOS_IMAGEM, limit: LIMITE_FOTO }), async (req, res) => {
    const a = exigirArmazenamento();
    const { nome } = consulta(req, z.object({ nome: z.string().trim().max(80).default('Foto') }));
    if (!Buffer.isBuffer(req.body) || req.body.byteLength < 500) throw AppError.invalido('Envie a foto.');
    if ((await repo.contarFotos(pool)) >= MAX_FOTOS_CONTA)
      throw AppError.invalido(`Até ${MAX_FOTOS_CONTA} fotos por conta: apague alguma antes de enviar outra.`);
    const img = await prepararImagem(req.body, { maxLado: 2160 }).catch(() => {
      throw AppError.invalido('Não deu para ler esta foto. Use JPG, PNG ou WEBP.');
    });
    if (Math.min(img.largura, img.altura) < 500)
      throw AppError.invalido(
        'Foto pequena demais: use uma com pelo menos 500 px no lado menor, para não ficar borrada.',
      );
    const chave = `carrosseis/${conta()}/fotos/${randomUUID()}.jpg`;
    await a.enviar(chave, new Uint8Array(img.dados), 'image/jpeg');
    const f = await repo.adicionarFoto(pool, {
      nome: nome.replace(/\.[a-z0-9]{2,5}$/i, '') || 'Foto',
      chave,
      largura: img.largura,
      altura: img.altura,
      bytes: img.dados.byteLength,
    });
    res.status(201).json(f);
  });

  /* ── v132: imagens feitas pela IA ── */

  /** A referência de estilo (um post de que a empresa gostou): guarda e lê o estilo. */
  r.post('/referencias', express.raw({ type: TIPOS_IMAGEM, limit: LIMITE_FOTO }), async (req, res) => {
    const { nome } = consulta(req, z.object({ nome: z.string().trim().max(80).default('Referência') }));
    if (!Buffer.isBuffer(req.body) || req.body.byteLength < 500) throw AppError.invalido('Envie a imagem.');
    if (!ia()) throw AppError.invalido('O time de IA não está ligado: a referência não tem quem leia.');
    res.status(201).json(await imagens.guardarReferencia(pool, ia(), new Uint8Array(req.body), nome));
  });

  /** "Cenários para o produto": três cenários conferidos a partir de uma foto enviada. */
  r.post('/fotos/:id/cenarios', async (req, res) => {
    const d = corpo(
      req,
      z.object({
        carrosselId: z.number().int().positive().nullable().default(null),
        referenciaId: z.number().int().positive().nullable().default(null),
      }),
    );
    res.json(await imagens.cenarios(pool, ia(), idDaRota(req), d));
  });

  r.get('/fotos/:id/cenarios', async (req, res) => {
    res.json({ cenarios: await repo.cenariosDaFoto(pool, idDaRota(req)) });
  });

  r.get('/fotos/:id/imagem', async (req, res) => {
    const f = await repo.foto(pool, idDaRota(req));
    const a = arm();
    if (!f || !a) throw AppError.naoEncontrado('Foto');
    const { largura } = consulta(req, larguraConsulta);
    const dados = await a.ler(f.chave);
    const img = await prepararImagem(dados, { maxLado: largura });
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(img.dados);
  });

  r.delete('/fotos/:id', async (req, res) => {
    const chave = await repo.apagarFoto(pool, idDaRota(req));
    await arm()
      ?.apagar([chave])
      .catch(() => undefined);
    res.json({ ok: true });
  });

  /* ── Prévia (a imagem final de um slide que ainda não foi salvo) ── */

  r.post('/previa', async (req, res) => {
    const d = corpo(
      req,
      z.object({
        slide: slideEntrada,
        indice: z
          .number()
          .int()
          .min(0)
          .max(MAX_SLIDES - 1),
        total: z.number().int().min(1).max(MAX_SLIDES),
        estilo: z.enum(ESTILOS),
        identidade: identidadeCarrosselEntrada.optional(),
        largura: z.number().int().min(120).max(1080).default(720),
      }),
    );
    const [slide] = await repo.conferirFotos(pool, [d.slide]);
    const material = await materialDaConta(pool, arm(), d.identidade);
    const img = await desenhar(pool, arm(), material, {
      slide: slide!,
      indice: d.indice,
      total: d.total,
      estilo: d.estilo,
      largura: d.largura,
    });
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.send(img.jpeg);
  });

  /* ── Carrosséis ── */

  r.get('/', async (_req, res) => {
    res.json({
      carrosseis: await repo.listar(pool),
      franquia: await franquia(),
      pedidos: await time.pedidosRecentes(pool),
    });
  });

  r.post('/', async (req, res) => {
    const d = corpo(req, carrosselNovoEntrada);
    if ((await repo.contar(pool)) >= MAX_CARROSSEIS_CONTA)
      throw AppError.invalido(`Até ${MAX_CARROSSEIS_CONTA} carrosséis por conta: apague os antigos.`);
    const { identidade } = await repo.identidade(pool);
    const id = await repo.criar(pool, {
      titulo: d.titulo,
      estilo: d.estilo ?? identidade.estilo,
      slides:
        d.comeco === 'capa'
          ? [{ ...slideNovo('capa', 's1'), titulo: d.titulo }]
          : roteiroInicial().map((s, i) => (i === 0 ? { ...s, titulo: d.titulo } : s)),
    });
    res.status(201).json(await repo.carrossel(pool, id));
  });

  /** O calendário do mês (AAAA-MM): os carrosséis e vídeos agendados e publicados. */
  r.get('/calendario', async (req, res) => {
    const { mes } = consulta(req, z.object({ mes: z.string().regex(/^\d{4}-\d{2}$/) }));
    res.json({ itens: await publicar.calendario(pool, mes), situacao: await publicar.situacao(pool) });
  });

  r.get('/:id', async (req, res) => {
    res.json(await repo.carrossel(pool, idDaRota(req)));
  });

  r.put('/:id', async (req, res) => {
    const d = corpo(req, carrosselEntrada);
    const ids = new Set<string>();
    for (const s of d.slides) {
      if (ids.has(s.id)) throw AppError.invalido('Dois slides com o mesmo identificador.');
      ids.add(s.id);
      if (s.fotoId && !MODELO[s.modelo].foto) s.fotoId = null;
    }
    const slides = await repo.conferirFotos(pool, d.slides);
    res.json(await repo.atualizar(pool, idDaRota(req), { ...d, slides }));
  });

  /* ── A conversa com o time (o pedido de ajuste no editor) ── */

  r.get('/:id/conversa', async (req, res) => {
    const id = idDaRota(req);
    await repo.carrossel(pool, id);
    res.json({ mensagens: await conversa.historico(pool, id) });
  });

  /** O time responde em segundo plano: a tela pergunta a conversa até a resposta chegar. */
  r.post('/:id/conversa', async (req, res) => {
    const d = corpo(req, conversaEntrada);
    res.status(202).json(await conversa.pedir(pool, ia(), deps.log, idDaRota(req), d));
  });

  r.post('/:id/conversa/:msg', async (req, res) => {
    const { acao } = corpo(req, decisaoConversaEntrada);
    const msg = Number(req.params.msg);
    if (!Number.isInteger(msg) || msg <= 0) throw AppError.naoEncontrado('Mensagem');
    res.json(await conversa.decidir(pool, idDaRota(req), msg, acao));
  });

  /** A pessoa decidiu um aviso do revisor (a sugestão, se usou, já foi aplicada no editor). */
  r.post('/:id/avisos/:aviso', async (req, res) => {
    const { acao } = corpo(req, avisoResolverEntrada);
    const c = await repo.carrossel(pool, idDaRota(req));
    if (!c.relatorio) throw AppError.naoEncontrado('Aviso');
    const alvo = c.relatorio.avisos.find((a) => a.id === req.params.aviso);
    if (!alvo) throw AppError.naoEncontrado('Aviso');
    const relatorio = {
      ...c.relatorio,
      avisos: c.relatorio.avisos.map((a) =>
        a.id === alvo.id
          ? { ...a, resolvido: acao === 'usar' ? ('usou' as const) : ('manteve' as const) }
          : a,
      ),
    };
    await repo.salvarRelatorio(pool, c.id, { relatorio });
    res.json({ relatorio });
  });

  r.post('/:id/duplicar', async (req, res) => {
    const c = await repo.carrossel(pool, idDaRota(req));
    if ((await repo.contar(pool)) >= MAX_CARROSSEIS_CONTA)
      throw AppError.invalido(`Até ${MAX_CARROSSEIS_CONTA} carrosséis por conta: apague os antigos.`);
    const id = await repo.criar(pool, {
      titulo: `${c.titulo} (cópia)`.slice(0, 120),
      estilo: c.estilo,
      slides: c.conteudo,
      legenda: c.legenda,
      relatorio: c.relatorio,
    });
    res.status(201).json(await repo.carrossel(pool, id));
  });

  r.delete('/:id', async (req, res) => {
    const arquivos = await repo.apagar(pool, idDaRota(req));
    if (arquivos.length)
      await arm()
        ?.apagar(arquivos)
        .catch(() => undefined);
    res.json({ ok: true });
  });

  /* ── Publicação: a regra do Comente e receba e o post ── */

  const peca = (req: Request): publicacao.Peca => ({ tipo: 'carrossel', id: idDaRota(req) });
  const aba = (req: Request) => publicacao.publicacao(pool, peca(req), !!ia());

  r.get('/:id/publicacao', async (req, res) => {
    res.json(await aba(req));
  });

  r.put('/:id/publicacao', async (req, res) => {
    await publicacao.salvar(pool, peca(req), corpo(req, publicacaoEntrada));
    res.json(await aba(req));
  });

  r.post(
    '/:id/publicacao/arquivo',
    express.raw({ type: [...TIPOS_ARQUIVO_DIRECT], limit: LIMITE_ARQUIVO_DIRECT }),
    async (req, res) => {
      const nome = decodeURIComponent(String(req.get('x-nome-arquivo') ?? '')).slice(0, 200);
      await publicacao.guardarArquivo(pool, exigirArmazenamento(), peca(req), {
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
    res.redirect(302, await publicacao.linkDoArquivo(pool, exigirArmazenamento(), peca(req)));
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
    const r2 = await publicacao.directDaPeca(pool, claude, { peca: peca(req), ...d });
    res.json({ mensagem: r2.mensagem, botao: r2.botao, daRedatora: r2.daRedatora });
  });

  r.get('/publicacao/posts', async (_req, res) => {
    res.json({ posts: await publicacao.ultimasPublicacoes(pool) });
  });

  r.post('/:id/publicacao/post', async (req, res) => {
    const { midiaId } = corpo(req, escolherPostEntrada);
    await publicacao.escolherPost(deps, peca(req), midiaId);
    res.json(await aba(req));
  });

  r.delete('/:id/publicacao/post', async (req, res) => {
    await publicacao.naoEOPost(pool, peca(req));
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
    const peca = { tipo: 'carrossel', id: idDaRota(req) } as const;
    res.json({
      situacao: await publicar.situacao(pool),
      agendamento: await publicar.agendamentoDa(pool, peca),
    });
  });

  r.post('/:id/publicar', async (req, res) => {
    const d = corpo(req, publicarEntrada);
    const peca = { tipo: 'carrossel', id: idDaRota(req) } as const;
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
    const peca = { tipo: 'carrossel', id: idDaRota(req) } as const;
    await publicar.cancelar(pool, peca);
    res.json({
      situacao: await publicar.situacao(pool),
      agendamento: await publicar.agendamentoDa(pool, peca),
    });
  });

  /** Um slide do carrossel salvo (miniatura na lista e no editor). */
  r.get('/:id/slides/:n', async (req: Request, res: Response) => {
    const c = await repo.carrossel(pool, idDaRota(req));
    const n = Number(req.params.n);
    const slide = Number.isInteger(n) ? c.conteudo[n] : undefined;
    if (!slide) throw AppError.naoEncontrado('Slide');
    const { largura } = consulta(req, larguraConsulta);
    const material = await materialDaConta(pool, arm());
    const img = await desenhar(pool, arm(), material, {
      slide,
      indice: n,
      total: c.conteudo.length,
      estilo: c.estilo,
      largura,
    });
    const etag = `"${img.etag}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, no-cache');
    if (req.headers['if-none-match'] === etag) return void res.status(304).end();
    res.setHeader('Content-Type', 'image/jpeg');
    res.send(img.jpeg);
  });

  /** Todas as imagens do carrossel em 1080 × 1350, num .zip, com a legenda junto. */
  r.get('/:id/imagens.zip', async (req, res) => {
    const c = await repo.carrossel(pool, idDaRota(req));
    const material = await materialDaConta(pool, arm());
    const arquivos: Record<string, Uint8Array> = {};
    for (const [i, slide] of c.conteudo.entries()) {
      const img = await desenhar(pool, arm(), material, {
        slide,
        indice: i,
        total: c.conteudo.length,
        estilo: c.estilo,
      });
      arquivos[`${String(i + 1).padStart(2, '0')}-${slide.modelo}.jpg`] = new Uint8Array(img.jpeg);
    }
    if (c.legenda.trim()) arquivos['legenda.txt'] = strToU8(c.legenda);
    await repo.marcarBaixado(pool, c.id);
    // JPEG já vem comprimido: guarda sem comprimir de novo (mais rápido, mesmo tamanho).
    const zip = zipSync(arquivos, { level: 0 });
    const nome =
      c.titulo
        .replace(/[^\p{L}\p{N} _-]/gu, '')
        .trim()
        .slice(0, 60) || 'carrossel';
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="carrossel.zip"; filename*=UTF-8''${encodeURIComponent(`${nome}.zip`)}`,
    );
    res.send(Buffer.from(zip));
  });

  return r;
}
