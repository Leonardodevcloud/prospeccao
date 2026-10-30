import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Pool } from '@prospeccao/db';
import type {
  Armazenamento,
  AvisoVideo,
  ConfigTranscricao,
  ServicoVideo,
} from '@prospeccao/integrations/reuniao';
import {
  AppError,
  type EntrarNaSala,
  type Logger,
  type PapelNaSala,
  situacaoDaSala,
} from '@prospeccao/shared';
import jwt from 'jsonwebtoken';
import { comConta, type UsuarioSessao } from '../../contexto.js';
import { exigirHorasDeReuniao } from '../../recursos.js';
import * as funil from '../funil/repositorio.js';
import { notificar } from '../notificacoes/repositorio.js';
import { chaveDoPedaco } from './montar.js';
import * as repo from './repositorio.js';

/**
 * Regras das reuniões por vídeo: quem entra e quando, a sala de espera, a sessão no LiveKit, as
 * gravações ligadas pelos avisos do LiveKit e o que acontece quando a reunião acaba.
 */

export interface DepsReunioes {
  /** LiveKit (sem ele, as reuniões por vídeo ficam desligadas e a tela explica). */
  video: ServicoVideo | null;
  /** Onde as gravações ficam (sem ele, as reuniões funcionam sem gravar). */
  armazenamento: Armazenamento | null;
  /** Whisper (sem ele, grava mas não transcreve). */
  transcricao: ConfigTranscricao | null;
  /**
   * Gravação pelo LiveKit (na nuvem, paga por minuto). Desligada (padrão), quem grava é o navegador
   * de quem conduz a reunião, sem custo de gravação.
   */
  gravacaoNaNuvem?: boolean;
}

type Deps = { pool: Pool; log: Logger; jwtSegredo: string; reunioes: DepsReunioes };

/* ───────────── Credencial de quem está na sala ───────────── */

/** O que o navegador de quem entrou guarda para conversar com a api durante a reunião. */
export interface Credencial {
  salaId: number;
  contaId: number;
  participanteId: string;
  identidade: string;
  nome: string;
  papel: PapelNaSala;
}

const PUBLICO_CREDENCIAL = 'sala-reuniao';

export function emitirCredencial(c: Credencial, segredo: string): string {
  return jwt.sign(
    { s: c.salaId, c: c.contaId, p: c.participanteId, i: c.identidade, n: c.nome, r: c.papel },
    segredo,
    { algorithm: 'HS256', audience: PUBLICO_CREDENCIAL, expiresIn: '14h' },
  );
}

export function lerCredencial(token: string | undefined, segredo: string): Credencial | null {
  if (!token) return null;
  try {
    const d = jwt.verify(token, segredo, {
      algorithms: ['HS256'],
      audience: PUBLICO_CREDENCIAL,
    }) as jwt.JwtPayload;
    if (
      !Number.isInteger(d.s) ||
      !Number.isInteger(d.c) ||
      typeof d.p !== 'string' ||
      typeof d.i !== 'string'
    )
      return null;
    return {
      salaId: d.s,
      contaId: d.c,
      participanteId: d.p,
      identidade: d.i,
      nome: String(d.n ?? ''),
      papel: (['anfitriao', 'equipe', 'convidado'] as const).includes(d.r) ? d.r : 'convidado',
    };
  } catch {
    return null;
  }
}

/** Link de download de um arquivo do chat (vale 14 horas; o navegador não manda cabeçalho no <a>). */
export function assinarArquivo(arquivoId: number, segredo: string, agora = Date.now()): string {
  const exp = Math.floor(agora / 1000) + 14 * 3600;
  const sig = createHmac('sha256', segredo)
    .update(`arquivo-sala.${arquivoId}.${exp}`)
    .digest('hex')
    .slice(0, 40);
  return `${exp}.${sig}`;
}

export function conferirArquivo(arquivoId: number, t: string, segredo: string, agora = Date.now()): boolean {
  const [exp, sig] = t.split('.');
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) * 1000 < agora) return false;
  const esperado = createHmac('sha256', segredo)
    .update(`arquivo-sala.${arquivoId}.${exp}`)
    .digest('hex')
    .slice(0, 40);
  return sig.length === esperado.length && timingSafeEqual(Buffer.from(sig), Buffer.from(esperado));
}

const hashSegredo = (s: string) => createHash('sha256').update(s).digest('hex');

/* ───────────── Entrar ───────────── */

export type SalaPublica = NonNullable<Awaited<ReturnType<typeof repo.salaPorCodigo>>>;

export type ResultadoEntrada =
  | {
      estado: 'liberado';
      participanteId: string;
      segredo: string | null;
      nome: string;
      papel: PapelNaSala;
      url: string;
      token: string;
      credencial: string;
      sessaoId: number;
      gravando: boolean;
      /** Quem grava: o navegador de alguém do time, o LiveKit, ou ninguém. */
      gravacao: 'navegador' | 'nuvem' | null;
      transcrever: boolean;
    }
  | { estado: 'aguardando'; participanteId: string; segredo: string }
  | { estado: 'recusado' };

/** Quem do time pode entrar como time nesta sala (a pessoa está na conta da sala). */
export function ehDoTime(u: UsuarioSessao | null | undefined, sala: { contaId: number }): u is UsuarioSessao {
  return !!u && u.contaId === sala.contaId;
}

/** Explica por que o convidado ainda não pode entrar. */
export function exigirSalaAberta(sala: SalaPublica, agora = new Date()): void {
  const { situacao, abreEm } = situacaoDaSala(sala, agora);
  if (situacao === 'cancelada') throw new AppError(410, 'sala_cancelada', 'Esta reunião foi cancelada.');
  if (situacao === 'encerrada')
    throw new AppError(410, 'sala_encerrada', 'Esta reunião já terminou. Se precisar, peça um link novo.');
  if (situacao === 'antes')
    throw new AppError(409, 'sala_fechada', 'A sala ainda não abriu.', {
      detalhes: { abreEm: abreEm.toISOString() },
    });
}

/**
 * Garante a sessão ao vivo (abre a sala no LiveKit se for a primeira pessoa) e devolve o acesso.
 * Quem do time entra numa sala encerrada abre outra sessão (a reunião continua noutro dia).
 */
async function liberar(
  d: Deps,
  sala: SalaPublica,
  p: repo.Participante,
  papel: PapelNaSala,
  segredo: string | null,
): Promise<ResultadoEntrada> {
  const video = d.reunioes.video;
  if (!video) throw semVideo();
  const gravar = sala.gravar && video.gravaArquivos;
  // Reunião começando agora (ninguém na sala): confere o plano e as horas do mês.
  if (!(await repo.sessaoAoVivo(d.pool, sala.id))) await exigirHorasDeReuniao(d.pool);
  const { sessao, nova } = await abrirSessaoTransacao(d.pool, sala.id, {
    gravar,
    transcrever: sala.transcrever && !!d.reunioes.transcricao,
  });
  if (nova) {
    try {
      await video.abrirSala({
        sala: sessao.salaVideo,
        // Para a página da gravação mostrar o título e a marca, como na tela de quem conduz.
        dados: { titulo: sala.titulo, empresa: sala.marcaNome || sala.contaNome, cor: sala.marcaCor },
      });
    } catch (erro) {
      d.log.error({ err: erro, sala: sala.id }, 'reuniões: o LiveKit não abriu a sala');
      throw AppError.externo('Vídeo', 'não deu para abrir a sala agora. Tente de novo em instantes.', erro);
    }
  }
  const token = await video.acesso({
    sala: sessao.salaVideo,
    identidade: p.identidade,
    nome: p.nome,
    atributos: { papel },
  });
  const credencial = emitirCredencial(
    {
      salaId: sala.id,
      contaId: sala.contaId,
      participanteId: p.id,
      identidade: p.identidade,
      nome: p.nome,
      papel,
    },
    d.jwtSegredo,
  );
  return {
    estado: 'liberado',
    participanteId: p.id,
    segredo,
    nome: p.nome,
    papel,
    url: video.urlCliente,
    token,
    credencial,
    sessaoId: sessao.id,
    gravando: sessao.gravar,
    gravacao: sessao.gravar ? (d.reunioes.gravacaoNaNuvem ? 'nuvem' : 'navegador') : null,
    transcrever: sessao.transcrever,
  };
}

async function abrirSessaoTransacao(
  pool: Pool,
  salaId: number,
  o: { gravar: boolean; transcrever: boolean },
) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const r = await repo.abrirSessao(cliente, salaId, o);
    await cliente.query('COMMIT');
    return r;
  } catch (erro) {
    await cliente.query('ROLLBACK').catch(() => undefined);
    throw erro;
  } finally {
    cliente.release();
  }
}

export const semVideo = () =>
  new AppError(
    503,
    'video_desligado',
    'As reuniões por vídeo ainda não foram configuradas neste sistema. Avise quem administra.',
  );

/**
 * Entrar na sala. Do time: entra a qualquer hora (e reabre a sala encerrada). Convidado: a partir
 * do horário de abrir; com "eu aprovo cada pessoa", fica na sala de espera.
 */
export async function entrar(
  d: Deps,
  sala: SalaPublica,
  usuario: UsuarioSessao | null,
  dados: EntrarNaSala,
): Promise<ResultadoEntrada> {
  if (!d.reunioes.video) throw semVideo();
  return comConta(sala.contaId, async () => {
    if (ehDoTime(usuario, sala)) {
      if (sala.status === 'cancelada')
        throw new AppError(410, 'sala_cancelada', 'Esta reunião foi cancelada.');
      const p = await repo.participanteDaEquipe(d.pool, sala.id, { id: usuario.id, nome: usuario.nome });
      return liberar(d, sala, p, sala.anfitriaoId === usuario.id ? 'anfitriao' : 'equipe', null);
    }

    exigirSalaAberta(sala);
    if (sala.gravar && !dados.aceitouGravacao)
      throw AppError.invalido('Para entrar, confirme que leu o aviso de gravação.');

    // Voltou (recarregou a página): a mesma identidade, sem passar pela espera de novo.
    if (dados.participanteId && dados.segredo) {
      const atual = await repo.participante(d.pool, sala.id, dados.participanteId);
      if (atual && atual.tipo === 'convidado' && atual.segredoHash === hashSegredo(dados.segredo)) {
        if (atual.situacao === 'recusado') return { estado: 'recusado' };
        await repo.atualizarConvidado(d.pool, atual.id, {
          nome: dados.nome,
          aceitouGravacao: dados.aceitouGravacao,
        });
        if (atual.situacao === 'aguardando')
          return { estado: 'aguardando', participanteId: atual.id, segredo: dados.segredo };
        return liberar(d, sala, { ...atual, nome: dados.nome }, 'convidado', dados.segredo);
      }
    }

    const segredo = randomBytes(24).toString('base64url');
    const aprovar = sala.entrada === 'aprovacao';
    const p = await repo.novoConvidado(d.pool, sala.id, {
      nome: dados.nome,
      situacao: aprovar ? 'aguardando' : 'liberado',
      segredoHash: hashSegredo(segredo),
      aceitouGravacao: dados.aceitouGravacao,
    });
    if (aprovar) {
      await avisarEspera(d, sala, p.nome);
      return { estado: 'aguardando', participanteId: p.id, segredo };
    }
    return liberar(d, sala, p, 'convidado', segredo);
  });
}

/** O convidado na espera pergunta se já pode entrar. */
export async function perguntarEspera(
  d: Deps,
  sala: SalaPublica,
  participanteId: string,
  segredo: string,
): Promise<ResultadoEntrada> {
  return comConta(sala.contaId, async () => {
    const p = await repo.participante(d.pool, sala.id, participanteId);
    if (p?.tipo !== 'convidado' || p.segredoHash !== hashSegredo(segredo))
      throw AppError.naoEncontrado('Pedido para entrar');
    if (p.situacao === 'recusado') return { estado: 'recusado' };
    if (p.situacao === 'aguardando') return { estado: 'aguardando', participanteId: p.id, segredo };
    exigirSalaAberta(sala);
    return liberar(d, sala, p, 'convidado', segredo);
  });
}

/** Alguém chegou na sala de espera: avisa o time que está na sala (e o anfitrião, no sino e no celular). */
async function avisarEspera(d: Deps, sala: SalaPublica, nome: string): Promise<void> {
  const sessao = await repo.sessaoAoVivo(d.pool, sala.id);
  if (sessao && d.reunioes.video)
    await d.reunioes.video
      .enviar(sessao.salaVideo, 'sala', { tipo: 'espera', nome })
      .catch((erro) => d.log.warn({ err: erro }, 'reuniões: aviso da sala de espera não chegou na sala'));
  if (sala.anfitriaoId)
    await notificar(d.pool, sala.anfitriaoId, {
      tipo: 'reuniao',
      titulo: `${nome} quer entrar na reunião`,
      texto: sala.titulo,
      empresaId: sala.empresaId,
      link: `/r/${sala.codigo}`,
    }).catch(() => undefined);
}

/* ───────────── Avisos do LiveKit ───────────── */

const chaveDaSessao = (contaId: number, salaId: number, sessaoId: number) =>
  `conta-${contaId}/sala-${salaId}/sessao-${sessaoId}`;

/** Trata um aviso do LiveKit (entrou, saiu, microfone, gravação, sala encerrada). */
export async function tratarAviso(d: Deps & { aoEncerrar: AoEncerrar }, a: AvisoVideo): Promise<void> {
  if (a.tipo === 'outro' || a.tipo === 'sala_aberta') return;
  if (a.tipo === 'gravacao') {
    const s = await repo.sessaoPorSalaVideo(d.pool, a.sala);
    if (!s) return;
    await comConta(s.contaId, () => repo.atualizarGravacao(d.pool, a.gravacaoId, a));
    if (a.situacao === 'falhou')
      d.log.warn({ gravacao: a.gravacaoId, erro: a.erro, sala: a.sala }, 'reuniões: gravação falhou');
    return;
  }
  const s = await repo.sessaoPorSalaVideo(d.pool, a.sala);
  if (!s) return;
  await comConta(s.contaId, async () => {
    const video = d.reunioes.video;
    switch (a.tipo) {
      case 'entrou': {
        await repo.registrarPresenca(d.pool, s.salaId, a.identidade, 'entrou', a.em);
        // A primeira pessoa liga a gravação da sala (só uma vez por sessão).
        if (s.situacao === 'ao_vivo' && s.gravar && video?.gravaArquivos && d.reunioes.gravacaoNaNuvem) {
          const chave = `${chaveDaSessao(s.contaId, s.salaId, s.id)}/reuniao.mp4`;
          const reserva = await repo.reservarGravacao(d.pool, s.id, { tipo: 'sala', chave });
          if (reserva)
            await video
              .gravarSala({ sala: s.salaVideo, chave })
              .then((id) => repo.confirmarGravacao(d.pool, reserva, { gravacaoId: id }))
              .catch(async (erro: Error) => {
                d.log.error({ err: erro, sessao: s.id }, 'reuniões: não deu para ligar a gravação da sala');
                await repo.confirmarGravacao(d.pool, reserva, { erro: erro.message });
              });
        }
        return;
      }
      case 'saiu':
        await repo.registrarPresenca(d.pool, s.salaId, a.identidade, 'saiu', a.em);
        return;
      case 'microfone': {
        // Áudio de cada pessoa separado: é o que deixa a transcrição saber quem falou.
        if (
          s.situacao !== 'ao_vivo' ||
          !s.transcrever ||
          !video?.gravaArquivos ||
          !d.reunioes.gravacaoNaNuvem
        )
          return;
        const chave = `${chaveDaSessao(s.contaId, s.salaId, s.id)}/audio-${a.identidade}-${a.trilhaId}.ogg`;
        const reserva = await repo.reservarGravacao(d.pool, s.id, {
          tipo: 'audio',
          identidade: a.identidade,
          nome: a.nome,
          trilhaId: a.trilhaId,
          chave,
        });
        if (reserva)
          await video
            .gravarAudio({ sala: s.salaVideo, trilhaId: a.trilhaId, chave })
            .then((id) => repo.confirmarGravacao(d.pool, reserva, { gravacaoId: id }))
            .catch(async (erro: Error) => {
              d.log.warn({ err: erro, sessao: s.id }, 'reuniões: não deu para gravar o áudio de uma pessoa');
              await repo.confirmarGravacao(d.pool, reserva, { erro: erro.message });
            });
        return;
      }
      case 'sala_encerrada':
        await encerrar(d, s.id, a.em, d.aoEncerrar);
        return;
    }
  });
}

/**
 * Rede de segurança do webhook: confere no LiveKit quem está em cada reunião ao vivo e como estão as
 * gravações. Se um aviso não chegou (webhook não configurado, fora do ar ou atrasado), o efeito é o
 * mesmo: a gravação começa, o áudio de cada microfone é gravado e a presença é contada.
 */
export async function acompanharSessoes(d: Deps & { aoEncerrar: AoEncerrar }): Promise<void> {
  const video = d.reunioes.video;
  if (!video) return;
  const agora = new Date();
  for (const s of await repo.sessoesAoVivo(d.pool)) {
    try {
      const estado = await video.estado(s.salaVideo);
      if (!estado) continue; // a sala ainda não existe ou já fechou (quem cuida é conferirSessoesAbertas)
      const aqui = new Set(estado.pessoas.map((p) => p.identidade));
      const antes = await comConta(s.contaId, () => repo.identidadesPresentes(d.pool, s.salaId));
      for (const id of antes)
        if (!aqui.has(id))
          await tratarAviso(d, {
            tipo: 'saiu',
            id: `conferido-${s.id}-${id}`,
            sala: s.salaVideo,
            identidade: id,
            em: agora,
          });
      for (const p of estado.pessoas) {
        await tratarAviso(d, {
          tipo: 'entrou',
          id: `conferido-${s.id}-${p.identidade}`,
          sala: s.salaVideo,
          identidade: p.identidade,
          nome: p.nome,
          em: agora,
        });
        for (const trilhaId of p.microfones)
          await tratarAviso(d, {
            tipo: 'microfone',
            id: `conferido-${trilhaId}`,
            sala: s.salaVideo,
            identidade: p.identidade,
            nome: p.nome,
            trilhaId,
            em: agora,
          });
      }
    } catch (erro) {
      d.log.warn({ err: erro, sessao: s.id }, 'reuniões: não conferiu quem está na sala');
    }
  }
  for (const g of await repo.gravacoesParaConferir(d.pool)) {
    try {
      const aviso = await video.gravacao(g.gravacaoId);
      if (!aviso || aviso.situacao === 'gravando') continue;
      await comConta(g.contaId, () => repo.atualizarGravacao(d.pool, g.gravacaoId, aviso));
      if (aviso.situacao === 'falhou')
        d.log.warn({ gravacao: g.gravacaoId, erro: aviso.erro }, 'reuniões: gravação falhou');
    } catch (erro) {
      d.log.warn({ err: erro, gravacao: g.gravacaoId }, 'reuniões: não conferiu a gravação');
    }
  }
}

/* ───────────── Gravação pelo navegador ───────────── */

/** Maior pedaço aceito (o navegador manda um a cada 2 s; 16 MB sobra até para 4K). */
export const LIMITE_PEDACO = 16 * 1024 * 1024;

/**
 * Alguém do time começa a gravar pelo navegador: o vídeo da reunião (só uma pessoa por vez) ou o
 * microfone de uma pessoa (para a transcrição saber quem falou).
 */
export async function comecarGravacao(
  d: Deps,
  sala: SalaPublica,
  cred: Credencial,
  g: {
    tipo: 'sala' | 'audio';
    identidade?: string;
    nome?: string;
    trilhaId?: string;
    mime: string;
    desdeMs: number;
  },
): Promise<{ id: string }> {
  if (cred.papel === 'convidado') throw AppError.proibido('Só o time grava a reunião.');
  if (!d.reunioes.armazenamento)
    throw AppError.conflito('As gravações não estão configuradas neste sistema.');
  if (d.reunioes.gravacaoNaNuvem) throw AppError.conflito('Esta reunião já é gravada pelo servidor.');
  const sessao = await repo.sessaoAoVivo(d.pool, sala.id);
  if (!sessao) throw AppError.conflito('A reunião não está acontecendo agora.');
  if (!sessao.gravar) throw AppError.conflito('Esta reunião não é gravada.');
  if (g.tipo === 'audio' && !sessao.transcrever) throw AppError.conflito('Esta reunião não é transcrita.');
  if (g.tipo === 'sala') {
    const ativo = await repo.gravadorAtivo(d.pool, sessao.id);
    if (ativo && ativo.gravadoPor !== cred.identidade)
      throw new AppError(
        409,
        'outra_pessoa_gravando',
        `${ativo.nome ?? 'Outra pessoa do time'} já está gravando esta reunião.`,
        { detalhes: { gravadoPor: ativo.nome } },
      );
  }
  const id = await repo.criarGravacaoNavegador(d.pool, {
    sessaoId: sessao.id,
    chaveBase: chaveDaSessao(sala.contaId, sala.id, sessao.id),
    tipo: g.tipo,
    identidade: g.tipo === 'audio' ? (g.identidade ?? null) : cred.identidade,
    nome: g.tipo === 'audio' ? (g.nome ?? null) : cred.nome,
    trilhaId: g.tipo === 'audio' ? (g.trilhaId ?? null) : null,
    mime: g.mime,
    gravadoPor: cred.identidade,
    desdeMs: g.desdeMs,
  });
  d.log.info(
    { sala: sala.id, sessao: sessao.id, tipo: g.tipo, gravacao: id },
    'reuniões: gravação pelo navegador começou',
  );
  return { id };
}

async function gravacaoDeQuemGrava(d: Deps, sala: SalaPublica, cred: Credencial, gravacaoId: string) {
  const g = await repo.gravacaoNavegador(d.pool, gravacaoId);
  if (!g || g.salaId !== sala.id) throw AppError.naoEncontrado('Gravação');
  if (g.gravadoPor !== cred.identidade) throw AppError.proibido('Esta gravação é de outra pessoa.');
  if (g.situacao !== 'gravando') throw new AppError(409, 'gravacao_fechada', 'Esta gravação já foi fechada.');
  return g;
}

/** Um pedaço da gravação (o navegador manda na ordem e repete o que falhou; repetir não duplica). */
export async function receberPedaco(
  d: Deps,
  sala: SalaPublica,
  cred: Credencial,
  gravacaoId: string,
  n: number,
  corpo: Buffer,
): Promise<void> {
  const arm = d.reunioes.armazenamento;
  if (!arm) throw AppError.conflito('As gravações não estão configuradas neste sistema.');
  if (!corpo.length) throw AppError.invalido('Pedaço vazio.');
  const g = await gravacaoDeQuemGrava(d, sala, cred, gravacaoId);
  await arm.enviar(chaveDoPedaco(g.chave, n), corpo, 'application/octet-stream');
  await repo.registrarPedaco(d.pool, gravacaoId, n, corpo.length);
}

/** O navegador terminou de gravar (e diz quantos pedaços mandou). A montagem é em segundo plano. */
export async function concluirGravacaoNavegador(
  d: Deps & { aoEncerrar?: AoEncerrar },
  sala: SalaPublica,
  cred: Credencial,
  gravacaoId: string,
  pedacos: number,
): Promise<void> {
  const g = await gravacaoDeQuemGrava(d, sala, cred, gravacaoId);
  await repo.concluirPeloNavegador(d.pool, gravacaoId, pedacos);
  // Reunião já encerrada: o processamento roda logo (em vez de esperar a próxima rodada).
  if (!g.sessaoAoVivo) d.aoEncerrar?.(g.sessaoId);
}

/* ───────────── Fim da reunião ───────────── */

export type AoEncerrar = (sessaoId: number) => void;

/**
 * A reunião acabou: fecha a sessão, registra no histórico do lead quem participou e por quanto
 * tempo, e conclui a reunião na agenda (se de fato houve conversa). Roda dentro da conta.
 */
export async function encerrar(
  d: Pick<Deps, 'pool' | 'log'>,
  sessaoId: number,
  em: Date,
  aoEncerrar?: AoEncerrar,
): Promise<void> {
  const fim = await repo.encerrarSessao(d.pool, sessaoId, em);
  if (!fim) return;
  const sala = await repo.salaPorId(d.pool, fim.salaId);
  const quem = await repo.quemEsteve(d.pool, sala.id);
  const convidados = quem.filter((p) => p.tipo === 'convidado');
  const houveConversa = quem.length >= 2 && fim.segundos >= 120;
  if (houveConversa && sala.tarefaId)
    await d.pool.query(
      'UPDATE comercial.tarefas SET concluida_em = coalesce(concluida_em, now()) WHERE id = $1 AND conta_id = $2',
      [sala.tarefaId, sala.contaId],
    );
  if (houveConversa && sala.empresaId) {
    const min = Math.max(1, Math.round(fim.segundos / 60));
    const nomes = convidados.map((p) => p.nome).join(', ');
    await funil
      .registrarAtividade(
        d.pool,
        sala.empresaId,
        {
          tipo: 'reuniao',
          direcao: 'enviada',
          texto: `Reunião por vídeo de ${min} min${nomes ? ` com ${nomes}` : ''}${fim.gravar ? ' (gravada)' : ''}.`,
        },
        'reuniao',
      )
      .catch((erro) => d.log.warn({ err: erro, sessao: sessaoId }, 'reuniões: não registrou no histórico'));
  }
  if (fim.gravar) aoEncerrar?.(sessaoId);
}

/** O time encerrou para todos (o LiveKit fecha a sala e manda o aviso; aqui já fecha a sessão). */
export async function encerrarParaTodos(
  d: Deps & { aoEncerrar: AoEncerrar },
  sessao: repo.Sessao,
): Promise<void> {
  await d.reunioes.video?.encerrar(sessao.salaVideo);
  await encerrar(d, sessao.id, new Date(), d.aoEncerrar);
}

/**
 * Sessão que ficou "ao vivo" sem o aviso de encerramento (o aviso do LiveKit não chegou): se a sala
 * não existe mais lá, encerra aqui.
 */
export async function conferirSessoesAbertas(d: Deps & { aoEncerrar: AoEncerrar }): Promise<number> {
  const video = d.reunioes.video;
  if (!video) return 0;
  let n = 0;
  for (const s of await repo.sessoesParaConferir(d.pool)) {
    try {
      const pessoas = await video.presentes(s.salaVideo);
      if (pessoas.length) continue;
      await comConta(s.contaId, () => encerrar(d, s.id, new Date(), d.aoEncerrar));
      n++;
    } catch (erro) {
      d.log.warn({ err: erro, sessao: s.id }, 'reuniões: não conferiu a sala no LiveKit');
    }
  }
  return n;
}
