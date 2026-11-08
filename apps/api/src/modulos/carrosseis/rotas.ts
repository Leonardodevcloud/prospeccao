import { randomUUID } from 'node:crypto';
import { refazerSlide } from '@prospeccao/integrations/carrosseis';
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
  avisoResolverEntrada,
  divulgarEntrada,
  dossieEntrada,
  PEDIDO_RAPIDO,
  pedidoSlideEntrada,
  textoDoDossie,
} from '@prospeccao/shared/carrosseis-time';
import express, { type Request, type Response, Router } from 'express';
import { strToU8, zipSync } from 'fflate';
import { z } from 'zod';
import { conta } from '../../contexto.js';
import type { DepsApi } from '../../dependencias.js';
import { consulta, corpo, idDaRota } from '../../middlewares/http.js';
import { exigirAdmin } from '../../middlewares/seguranca.js';
import { rotaComModulo, temModulo } from '../../recursos.js';
import * as marca from '../marca/repositorio.js';
import { organizacaoDaConta } from '../plano/repositorio.js';
import * as cerebro from './cerebro.js';
import { desenhar, materialDaConta } from './desenho.js';
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

  r.get('/situacao', async (_req, res) => {
    const modulo = await temModulo(pool, 'carrosseis');
    res.json({
      modulo,
      armazenamento: !!arm(),
      franquia: await franquia(),
      ia: {
        ligada: !!ia(),
        cerebroConferido: modulo ? !!(await cerebro.cerebro(pool)).conferidoEm : false,
      },
    });
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

  /**
   * Pedido ao redator num slide ("mais curto", ou o que a pessoa escrever). Devolve o slide novo
   * sem salvar: o editor troca e salva sozinho (assim não briga com o que está aberto na tela).
   */
  r.post('/:id/slides/:n/pedir', async (req, res) => {
    const cfg = ia();
    if (!cfg) throw new AppError(503, 'indisponivel', 'O time de IA ainda não foi ligado na plataforma.');
    const d = corpo(
      req,
      z.object({
        pedido: pedidoSlideEntrada,
        slides: z.array(slideEntrada).min(1).max(MAX_SLIDES),
        estilo: z.enum(ESTILOS),
      }),
    );
    const c = await repo.carrossel(pool, idDaRota(req));
    const n = Number(req.params.n);
    if (!Number.isInteger(n) || !d.slides[n]) throw AppError.naoEncontrado('Slide');
    const cb = await cerebro.cerebro(pool);
    const empresa = await cerebro.nomeDaEmpresa(pool);
    const { identidade } = await repo.identidade(pool);
    const rel = c.relatorio;
    const divulgar = rel?.divulgarId ? await cerebro.divulgar(pool, rel.divulgarId).catch(() => null) : null;
    const instrucao = [d.pedido.rapido ? PEDIDO_RAPIDO[d.pedido.rapido].instrucao : '', d.pedido.texto]
      .filter(Boolean)
      .join(' ');
    const pedidoCarrossel = {
      objetivo: rel?.objetivo ?? ('ensinar' as const),
      chamada: rel?.chamada ?? ('salvar' as const),
      palavra: rel?.palavra ?? '',
      assunto: rel?.assunto ?? c.titulo,
    };
    const r = await refazerSlide(cfg.cliente(pool, conta()), {
      empresa,
      dossieTexto: textoDoDossie(cb.dossie, empresa),
      fontes: await cerebro.fontesParaOsFatos(pool, {
        dossie: cb.dossie,
        empresa,
        divulgar,
        assunto: pedidoCarrossel.assunto,
      }),
      identidade,
      estilo: d.estilo,
      divulgar,
      pedido: pedidoCarrossel,
      slides: d.slides,
      indice: n,
      instrucao,
      hoje: new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'full' }).format(
        new Date(),
      ),
    });
    res.json({ slide: r.slide, avisos: r.avisos });
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
    await repo.apagar(pool, idDaRota(req));
    res.json({ ok: true });
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
