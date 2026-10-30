import {
  AppError,
  arquivoSala,
  codigoSalaValido,
  criarTarefasDaReuniao,
  decisaoEspera,
  entrarNaSala,
  LIMITE_ARQUIVO_SALA,
  mensagemSala,
  situacaoDaSala,
} from '@prospeccao/shared';
import { type Request, type RequestHandler, type Response, Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { travaDaBase } from '../../base.js';
import { comConta, donoDaBase, type UsuarioSessao } from '../../contexto.js';
import type { DepsApi } from '../../dependencias.js';
import { consulta, corpo, idDaRota } from '../../middlewares/http.js';
import { COOKIE_SESSAO, carregarUsuario, exigirAdmin } from '../../middlewares/seguranca.js';
import { quando } from '../agenda/lembretes.js';
import * as agenda from '../agenda/repositorio.js';
import { chipParaEquipe, emUso as chipsEmUso } from '../agente/chips.js';
import * as agente from '../agente/repositorio.js';
import { dadosDoLead } from '../funil/cadencia.js';
import * as repo from './repositorio.js';
import {
  assinarArquivo,
  type Credencial,
  conferirArquivo,
  type DepsReunioes,
  ehDoTime,
  encerrarParaTodos,
  entrar,
  lerCredencial,
  perguntarEspera,
  type SalaPublica,
  semVideo,
  tratarAviso,
} from './servico.js';

/**
 * Rotas das reuniões por vídeo:
 *  - /salas/<código>: a página pública do link (o convidado não tem login). Informações da sala,
 *    entrar, sala de espera e, já dentro, o chat, os arquivos e a moderação (com a credencial que a
 *    api dá na entrada);
 *  - /livekit: os avisos do LiveKit (assinados);
 *  - /reunioes: as telas do CRM (próximas, gravadas, resumo, transcrição, convite).
 */

const SEM_REUNIOES: DepsReunioes = { video: null, armazenamento: null, transcricao: null };
const reunioesDe = (deps: DepsApi): NonNullable<DepsApi['reunioes']> => deps.reunioes ?? SEM_REUNIOES;
const aoEncerrarDe = (deps: DepsApi) => deps.reunioes?.aoEncerrar ?? (() => undefined);

const depsServico = (deps: DepsApi) => ({
  pool: deps.pool,
  log: deps.log,
  jwtSegredo: deps.auth.jwtSegredo,
  reunioes: reunioesDe(deps),
  aoEncerrar: aoEncerrarDe(deps),
});

/** Sessão de quem é do time (cookie do sistema), sem exigir: o convidado não tem. */
async function usuarioOpcional(deps: DepsApi, req: Request): Promise<UsuarioSessao | null> {
  const token = req.cookies?.[COOKIE_SESSAO] as string | undefined;
  if (!token) return null;
  try {
    const d = jwt.verify(token, deps.auth.jwtSegredo, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    const id = Number(d.sub);
    if (!Number.isInteger(id) || id <= 0) return null;
    const conta = Number.isInteger(d.c) && d.c > 0 ? (d.c as number) : null;
    const sessao = typeof d.s === 'string' && /^[0-9a-f-]{36}$/.test(d.s) ? d.s : null;
    const u = await carregarUsuario(deps.pool, id, conta, sessao);
    return u && !u.precisaDuasEtapas ? u : null;
  } catch {
    return null;
  }
}

async function carregarSala(deps: DepsApi, codigo: string): Promise<SalaPublica> {
  if (!codigoSalaValido(codigo)) throw AppError.naoEncontrado('Reunião');
  const sala = await repo.salaPorCodigo(deps.pool, codigo);
  if (!sala) throw AppError.naoEncontrado('Reunião');
  return sala;
}

interface LocaisSala {
  sala: SalaPublica;
  credencial: Credencial;
}
const locais = (res: Response) => res.locals as LocaisSala;

/** Mensagem do chat como o navegador recebe (com o link do arquivo, que vale 14 horas). */
function paraTela(deps: DepsApi, codigo: string, m: repo.MensagemSala) {
  return {
    ...m,
    arquivo: m.arquivo
      ? {
          ...m.arquivo,
          url: `/api/salas/${codigo}/arquivos/${m.arquivo.id}?t=${assinarArquivo(m.arquivo.id, deps.auth.jwtSegredo)}`,
        }
      : null,
  };
}

/* ───────────── Página pública da sala ───────────── */

export function rotasSalaPublica(deps: DepsApi): Router {
  const r = Router();
  const { pool, log } = deps;
  const d = () => depsServico(deps);

  const limitarEntrada = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(new AppError(429, 'muitas_tentativas', 'Muitas tentativas seguidas. Espere um minuto.')),
  });
  const limitarChat = rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(new AppError(429, 'muitas_tentativas', 'Muitas mensagens seguidas. Espere um pouco.')),
  });

  /** Quem está na sala (credencial que a api deu na entrada), dentro da conta da sala. */
  const naSala: RequestHandler = (req, res, next) => {
    const cred = lerCredencial(req.get('x-credencial-sala') ?? undefined, deps.auth.jwtSegredo);
    if (!cred) return next(AppError.naoAutorizado('Entre na reunião de novo.'));
    carregarSala(deps, String(req.params.codigo)).then((sala) => {
      if (sala.id !== cred.salaId) return next(AppError.naoAutorizado('Entre na reunião de novo.'));
      res.locals.sala = sala;
      res.locals.credencial = cred;
      comConta(sala.contaId, () => next());
    }, next);
  };
  /** Moderação: só quem é do time. */
  const doTime: RequestHandler = (_req, res, next) =>
    next(
      locais(res).credencial.papel === 'convidado'
        ? AppError.proibido('Só o time da reunião pode fazer isso.')
        : undefined,
    );

  r.get('/:codigo', async (req, res) => {
    const sala = await carregarSala(deps, String(req.params.codigo));
    const usuario = await usuarioOpcional(deps, req);
    const time = ehDoTime(usuario, sala);
    const { situacao, abreEm } = situacaoDaSala(sala);
    const reunioes = reunioesDe(deps);
    const presentes = await comConta(sala.contaId, () => repo.presentes(pool, sala.id));
    res.set('Cache-Control', 'no-store').json({
      codigo: sala.codigo,
      titulo: sala.titulo,
      inicio: sala.inicio,
      fim: sala.fim,
      abreEm,
      situacao,
      entrada: sala.entrada,
      gravar: sala.gravar && !!reunioes.video?.gravaArquivos,
      transcrever:
        sala.gravar && sala.transcrever && !!reunioes.video?.gravaArquivos && !!reunioes.transcricao,
      empresa: {
        nome: sala.marcaNome || sala.contaNome,
        cor: sala.marcaCor,
        logo: sala.temLogo ? `/api/salas/${sala.codigo}/logo` : null,
      },
      anfitriao: sala.anfitriaoNome,
      presentes,
      voce: time ? { nome: usuario.nome, doTime: true } : null,
      videoConfigurado: !!reunioes.video,
      agora: new Date(),
    });
  });

  r.get('/:codigo/logo', async (req, res) => {
    const sala = await carregarSala(deps, String(req.params.codigo));
    const logo = await repo.logoDaConta(pool, sala.contaId);
    if (!logo) throw AppError.naoEncontrado('Logo');
    res.set('Cache-Control', 'public, max-age=3600').type(logo.tipo).send(logo.dados);
  });

  r.post('/:codigo/entrar', limitarEntrada, async (req, res) => {
    const sala = await carregarSala(deps, String(req.params.codigo));
    const usuario = await usuarioOpcional(deps, req);
    // Quem é do time entra com o nome do cadastro.
    const dados = ehDoTime(usuario, sala)
      ? { nome: usuario.nome, aceitouGravacao: true }
      : corpo(req, entrarNaSala);
    const resultado = await entrar(d(), sala, usuario, dados);
    if (resultado.estado === 'liberado')
      log.info({ sala: sala.id, papel: resultado.papel }, 'reuniões: entrou na sala');
    res.json(resultado);
  });

  r.get('/:codigo/espera/:id', async (req, res) => {
    const sala = await carregarSala(deps, String(req.params.codigo));
    const { segredo } = consulta(req, z.object({ segredo: z.string().min(20).max(80) }));
    const id = z.string().uuid().parse(req.params.id);
    res.set('Cache-Control', 'no-store').json(await perguntarEspera(d(), sala, id, segredo));
  });

  /* ── Dentro da sala ── */

  r.get('/:codigo/mensagens', naSala, async (req, res) => {
    const { sala } = locais(res);
    const lista = await repo.mensagens(pool, sala.id);
    res.set('Cache-Control', 'no-store').json(lista.map((m) => paraTela(deps, String(req.params.codigo), m)));
  });

  /** Guarda a mensagem e manda para todos na sala (pelo LiveKit). */
  async function publicar(req: Request, res: Response, texto: string | null, arquivoId: number | null) {
    const { sala, credencial } = locais(res);
    const sessao = await repo.sessaoAoVivo(pool, sala.id);
    const m = await repo.novaMensagem(pool, {
      salaId: sala.id,
      sessaoId: sessao?.id ?? null,
      participanteId: credencial.participanteId,
      autor: credencial.nome,
      texto,
      arquivoId,
    });
    const tela = paraTela(deps, String(req.params.codigo), m);
    if (sessao && reunioesDe(deps).video)
      await reunioesDe(deps)
        .video!.enviar(sessao.salaVideo, 'chat', { tipo: 'mensagem', mensagem: tela })
        .catch((erro) => log.warn({ err: erro }, 'reuniões: a mensagem não foi para a sala na hora'));
    res.status(201).json(tela);
  }

  r.post('/:codigo/mensagens', limitarChat, naSala, async (req, res) => {
    const { texto } = corpo(req, mensagemSala);
    await publicar(req, res, texto, null);
  });

  r.post('/:codigo/arquivos', limitarChat, naSala, async (req, res) => {
    const a = corpo(req, arquivoSala);
    const dados = Buffer.from(a.base64, 'base64');
    if (!dados.length) throw AppError.invalido('Arquivo vazio.');
    if (dados.length > LIMITE_ARQUIVO_SALA) throw AppError.invalido('O arquivo passa de 10 MB.');
    const id = await repo.novoArquivo(pool, {
      salaId: locais(res).sala.id,
      nome: a.nome,
      mime: /^[\w.+-]+\/[\w.+-]+$/.test(a.mime) ? a.mime : 'application/octet-stream',
      dados,
    });
    await publicar(req, res, a.texto || null, id);
  });

  r.get('/:codigo/arquivos/:id', async (req, res) => {
    const sala = await carregarSala(deps, String(req.params.codigo));
    const id = idDaRota(req);
    const { t } = consulta(req, z.object({ t: z.string().max(80) }));
    if (!conferirArquivo(id, t, deps.auth.jwtSegredo))
      throw AppError.naoAutorizado('Link vencido. Abra o chat de novo.');
    const a = await comConta(sala.contaId, () => repo.arquivo(pool, sala.id, id));
    if (!a) throw AppError.naoEncontrado('Arquivo');
    enviarArquivo(res, a);
  });

  /* ── Moderação (só o time) ── */

  r.get('/:codigo/espera', naSala, doTime, async (_req, res) => {
    res.set('Cache-Control', 'no-store').json(await repo.naEspera(pool, locais(res).sala.id));
  });

  r.post('/:codigo/espera/:id', naSala, doTime, async (req, res) => {
    const { sala } = locais(res);
    const { decisao } = corpo(req, decisaoEspera);
    const id = z.string().uuid().parse(req.params.id);
    const ok = await repo.decidirEspera(
      pool,
      sala.id,
      id,
      decisao === 'deixar_entrar' ? 'liberado' : 'recusado',
    );
    if (!ok) throw AppError.naoEncontrado('Pedido para entrar');
    const sessao = await repo.sessaoAoVivo(pool, sala.id);
    if (sessao)
      await reunioesDe(deps)
        .video?.enviar(sessao.salaVideo, 'sala', { tipo: 'espera' })
        .catch(() => undefined);
    res.json({ ok: true });
  });

  const acaoPessoa = z.enum(['silenciar', 'baixar-mao', 'remover']);
  r.post('/:codigo/pessoas/:identidade/:acao', naSala, doTime, async (req, res) => {
    const { sala } = locais(res);
    const acao = acaoPessoa.parse(req.params.acao);
    const identidade = z
      .string()
      .regex(/^[uc]-[0-9a-f]{1,32}$/)
      .parse(req.params.identidade);
    const video = reunioesDe(deps).video;
    if (!video) throw semVideo();
    const sessao = await repo.sessaoAoVivo(pool, sala.id);
    if (!sessao) throw AppError.conflito('A reunião não está acontecendo agora.');
    if (acao === 'silenciar') await video.silenciar(sessao.salaVideo, identidade);
    else if (acao === 'baixar-mao') await video.baixarMao(sessao.salaVideo, identidade);
    else {
      // Tirar da sala: o convidado não volta com o mesmo link (precisa de outro).
      await pool.query(
        `UPDATE comercial.sala_participantes SET situacao = 'recusado'
          WHERE sala_id = $1 AND identidade = $2 AND tipo = 'convidado'`,
        [sala.id, identidade],
      );
      await video.remover(sessao.salaVideo, identidade);
    }
    res.json({ ok: true });
  });

  r.post('/:codigo/silenciar-todos', naSala, doTime, async (_req, res) => {
    const { sala, credencial } = locais(res);
    const video = reunioesDe(deps).video;
    const sessao = await repo.sessaoAoVivo(pool, sala.id);
    if (!video || !sessao) throw AppError.conflito('A reunião não está acontecendo agora.');
    const pessoas = await video.presentes(sessao.salaVideo);
    let n = 0;
    for (const p of pessoas)
      if (
        p.identidade !== credencial.identidade &&
        (await video.silenciar(sessao.salaVideo, p.identidade).catch(() => false))
      )
        n++;
    res.json({ silenciados: n });
  });

  r.post('/:codigo/encerrar', naSala, doTime, async (_req, res) => {
    const { sala } = locais(res);
    const sessao = await repo.sessaoAoVivo(pool, sala.id);
    if (sessao) await encerrarParaTodos(d(), sessao);
    res.json({ ok: true });
  });

  return r;
}

function enviarArquivo(res: Response, a: { nome: string; mime: string; dados: Buffer }) {
  const nome = a.nome.replace(/["\r\n\\]/g, '');
  res
    .set('Cache-Control', 'private, max-age=3600')
    .set(
      'Content-Disposition',
      `attachment; filename="${nome.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
    )
    .set('X-Content-Type-Options', 'nosniff')
    .type(a.mime)
    .send(a.dados);
}

/* ───────────── Avisos do LiveKit ───────────── */

export function rotasAvisoVideo(deps: DepsApi): Router {
  const r = Router();
  r.post('/', async (req, res) => {
    const video = reunioesDe(deps).video;
    if (!video) throw semVideo();
    const corpoBruto = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    let aviso: Awaited<ReturnType<typeof video.lerAviso>>;
    try {
      aviso = await video.lerAviso(corpoBruto, req.get('authorization') ?? undefined);
    } catch (erro) {
      // Mais comum: o webhook do LiveKit com outra chave de assinatura (tem que ser a LIVEKIT_API_KEY).
      deps.log.warn({ err: erro }, 'reuniões: aviso do LiveKit recusado (assinatura)');
      throw new AppError(401, 'assinatura_invalida', 'Aviso sem assinatura válida.');
    }
    await tratarAviso(depsServico(deps), aviso);
    res.json({ ok: true });
  });
  return r;
}

/* ───────────── Telas do CRM ───────────── */

const filtroLista = z.object({
  quais: z.enum(['proximas', 'realizadas']).default('proximas'),
  usuario: z
    .string()
    .regex(/^(eu|todos|\d+)$/)
    .default('todos'),
});

export function rotasReunioes(deps: DepsApi): Router {
  const r = Router();
  const { pool, log } = deps;
  r.param('empresaId', travaDaBase(pool));

  const quem = (req: Request, v: string) => {
    if (donoDaBase()) return req.usuario!.id;
    if (v === 'todos') return null;
    if (v === 'eu') return req.usuario!.id;
    return Number(v);
  };
  const comLink = <T extends { codigo: string }>(x: T) => ({ ...x, link: repo.linkDaSala(x.codigo) });

  /** O que está configurado (a tela mostra o que falta). */
  r.get('/estado', (_req, res) => {
    const x = reunioesDe(deps);
    res.json({
      video: !!x.video,
      gravacao: !!x.video?.gravaArquivos,
      transcricao: !!x.video?.gravaArquivos && !!x.transcricao,
    });
  });

  r.get('/', async (req, res) => {
    const f = consulta(req, filtroLista);
    const usuarioId = quem(req, f.usuario);
    const lista =
      f.quais === 'proximas'
        ? await repo.proximas(pool, usuarioId)
        : await repo.realizadas(pool, { usuarioId });
    res.json((lista as { codigo: string }[]).map(comLink));
  });

  r.get('/lead/:empresaId', async (req, res) => {
    const empresaId = idDaRota(req, 'empresaId');
    const lista = await repo.realizadas(pool, { usuarioId: null, empresaId });
    res.json((lista as { codigo: string }[]).map(comLink));
  });

  r.get('/arquivos/:id', async (req, res) => {
    enviarArquivo(res, await repo.arquivoVisivel(pool, idDaRota(req)));
  });

  /** Convite pelo WhatsApp para o lead, com o link e o horário. */
  r.post('/salas/:salaId/convite', async (req, res) => {
    const sala = await repo.salaPorId(pool, idDaRota(req, 'salaId'));
    if (!sala.empresaId)
      throw AppError.invalido('Esta reunião não é com um lead: copie o link e mande você mesmo.');
    if (sala.status === 'cancelada') throw AppError.invalido('Esta reunião foi cancelada.');
    const { whatsapp } = await deps.servicos(sala.contaId);
    if (!whatsapp)
      throw AppError.invalido(
        'Conecte um número de WhatsApp (Agente › Números de WhatsApp) para mandar o convite.',
      );
    const lead = await dadosDoLead(pool, sala.empresaId);
    if (!lead.telefone)
      throw AppError.invalido('O lead não tem WhatsApp cadastrado. Copie o link e mande por outro canal.');
    const remetente = req.usuario!.nome.split(' ')[0];
    const texto =
      `Olá! Nossa reunião "${sala.titulo}" está marcada para ${quando(new Date(sala.inicio))}. ` +
      `Para entrar, é só abrir este link no celular ou no computador (não precisa instalar nada):\n${repo.linkDaSala(sala.codigo)}` +
      `\n\nA sala abre ${sala.abreMinutosAntes} minutos antes. Até lá! ${remetente}`;
    const chip = await chipParaEquipe(pool, sala.empresaId, await chipsEmUso(pool, whatsapp));
    const envio = await whatsapp.enviar(lead.telefone, texto, chip?.instancia);
    await agente.criarMensagem(pool, {
      chipId: chip?.id ?? null,
      empresaId: sala.empresaId,
      direcao: 'enviada',
      texto,
      telefone: lead.telefone,
      status: 'enviada',
      origem: 'humano',
      idExterno: envio.idExterno,
      usuarioId: req.usuario!.id,
      nota: 'Convite da reunião',
    });
    await repo.marcarConviteEnviado(pool, sala.id);
    log.info({ sala: sala.id }, 'reuniões: convite mandado pelo WhatsApp');
    res.json({ ok: true, telefone: lead.telefone });
  });

  r.get('/:id', async (req, res) => {
    const id = idDaRota(req);
    const d = await repo.detalhe(pool, id);
    const { resumoCompleto, mensagens, ...resto } = d as typeof d & { codigo: string; temVideo: boolean };
    res.json({
      ...resto,
      link: repo.linkDaSala(resto.codigo),
      resumo: resumoCompleto,
      videoUrl: resto.temVideo ? `/api/reunioes/${id}/video` : null,
      mensagens: mensagens.map((m) => ({
        ...m,
        arquivo: m.arquivo ? { ...m.arquivo, url: `/api/reunioes/arquivos/${m.arquivo.id}` } : null,
      })),
    });
  });

  /** A gravação: redireciona para um link temporário do armazenamento (assistir ou baixar). */
  r.get('/:id/video', async (req, res) => {
    const s = await repo.sessaoVisivel(pool, idDaRota(req));
    const arm = reunioesDe(deps).armazenamento;
    if (!s.videoChave || !arm) throw AppError.naoEncontrado('Gravação');
    const baixar = req.query.baixar === '1';
    const data = new Date(s.iniciadaEm).toISOString().slice(0, 10);
    const url = await arm.urlAssinada(s.videoChave, {
      segundos: 3 * 3600,
      ...(baixar ? { baixarComo: `${s.titulo.slice(0, 80)} ${data}.mp4` } : {}),
    });
    res.set('Cache-Control', 'no-store').redirect(302, url);
  });

  /** Os próximos passos marcados viram tarefas na agenda (do anfitrião). */
  r.post('/:id/tarefas', async (req, res) => {
    const id = idDaRota(req);
    const s = await repo.sessaoVisivel(pool, id);
    const { passos } = corpo(req, criarTarefasDaReuniao);
    const ids: number[] = [];
    for (const p of passos)
      ids.push(
        await agenda.criar(pool, {
          empresaId: s.empresaId,
          usuarioId: s.anfitriaoId ?? req.usuario!.id,
          tipo: 'tarefa',
          titulo: p.texto,
          inicio: p.inicio,
          descricao: `Combinado na reunião "${s.titulo}".`,
        }),
      );
    await repo.marcarTarefasCriadas(pool, id);
    res.status(201).json({ criadas: ids.length });
  });

  /** Tenta de novo a transcrição e o resumo. */
  r.post('/:id/processar', async (req, res) => {
    const id = idDaRota(req);
    const s = await repo.sessaoVisivel(pool, id);
    if (req.usuario!.papel !== 'admin' && s.anfitriaoId !== req.usuario!.id)
      throw AppError.proibido('Só quem conduziu a reunião ou um administrador pode fazer isso.');
    if (!(await repo.reprocessar(pool, id)))
      throw AppError.conflito('Esta reunião não tem gravação para processar.');
    reunioesDe(deps).aoEncerrar?.(id);
    res.json({ ok: true });
  });

  /** Apaga a gravação e a transcrição (o resumo e o histórico ficam). */
  r.delete('/:id/gravacao', exigirAdmin, async (req, res) => {
    const id = idDaRota(req);
    await repo.sessaoVisivel(pool, id);
    const chaves = await repo.chavesGravadas(pool, { sessaoId: id });
    const arm = reunioesDe(deps).armazenamento;
    if (arm && chaves.length) await arm.apagar(chaves);
    await repo.apagarGravacao(pool, id);
    log.info({ sessao: id, autor: req.usuario!.id }, 'reuniões: gravação apagada');
    res.status(204).end();
  });

  return r;
}
