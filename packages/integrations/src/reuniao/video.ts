import {
  AccessToken,
  AudioCodec,
  DataPacket_Kind,
  DirectFileOutput,
  EgressClient,
  type EgressInfo,
  EgressStatus,
  EncodedFileOutput,
  EncodedFileType,
  EncodingOptions,
  RoomServiceClient,
  S3Upload,
  TrackSource,
  TrackType,
  VideoCodec,
  type WebhookEvent,
  WebhookReceiver,
} from 'livekit-server-sdk';
import type { ConfigArmazenamento } from './armazenamento.js';

/**
 * Vídeo das reuniões pelo LiveKit (servidor de mídia com qualidade de Google Meet: servidor perto de
 * quem está na chamada, qualidade que se ajusta à internet de cada um, passagem por firewall).
 * O sistema só cria as salas, dá o acesso de cada pessoa, modera e liga as gravações; o áudio e o
 * vídeo vão direto entre os navegadores e o LiveKit.
 */

export interface ConfigVideo {
  /** wss://<projeto>.livekit.cloud */
  url: string;
  apiKey: string;
  apiSecret: string;
  /** Onde o LiveKit grava (sem isso, as reuniões funcionam sem gravação). */
  armazenamento?: ConfigArmazenamento | null;
}

export interface PessoaNaSala {
  identidade: string;
  nome: string;
  atributos: Record<string, string>;
}

/** O que o LiveKit avisa (o webhook), já traduzido para o que o sistema usa. */
export type AvisoVideo =
  | { tipo: 'sala_aberta'; id: string; sala: string; em: Date }
  | { tipo: 'sala_encerrada'; id: string; sala: string; em: Date }
  | { tipo: 'entrou'; id: string; sala: string; identidade: string; nome: string; em: Date }
  | { tipo: 'saiu'; id: string; sala: string; identidade: string; em: Date }
  | {
      tipo: 'microfone';
      id: string;
      sala: string;
      identidade: string;
      nome: string;
      trilhaId: string;
      em: Date;
    }
  | {
      tipo: 'gravacao';
      id: string;
      sala: string;
      gravacaoId: string;
      /** sala: a reunião inteira em vídeo; audio: o microfone de uma pessoa. */
      de: 'sala' | 'audio';
      trilhaId: string | null;
      situacao: 'gravando' | 'pronta' | 'falhou';
      inicio: Date | null;
      arquivo: {
        chave: string;
        bytes: number;
        segundos: number;
        inicio: Date | null;
        fim: Date | null;
      } | null;
      erro: string | null;
      em: Date;
    }
  | { tipo: 'outro'; id: string; evento: string };

export interface ServicoVideo {
  /** Endereço que o navegador usa para conectar. */
  readonly urlCliente: string;
  /** Há onde gravar (armazenamento configurado). */
  readonly gravaArquivos: boolean;
  /** Acesso de uma pessoa a uma sala (vale algumas horas). */
  acesso(p: {
    sala: string;
    identidade: string;
    nome: string;
    atributos?: Record<string, string>;
    horas?: number;
  }): Promise<string>;
  /** Cria a sala no LiveKit (se já existe, nada muda). */
  abrirSala(p: { sala: string; maxPessoas?: number }): Promise<void>;
  /** Grava a sala inteira (vídeo, com a tela compartilhada em destaque). */
  gravarSala(p: { sala: string; chave: string }): Promise<string>;
  /** Grava o microfone de uma pessoa (áudio, para a transcrição saber quem falou). */
  gravarAudio(p: { sala: string; trilhaId: string; chave: string }): Promise<string>;
  /** Manda um aviso para quem está na sala (só para algumas pessoas, se informar). */
  enviar(sala: string, topico: string, dados: unknown, identidades?: string[]): Promise<void>;
  /** Desliga o microfone de alguém. Devolve false se a pessoa não estava com microfone. */
  silenciar(sala: string, identidade: string): Promise<boolean>;
  baixarMao(sala: string, identidade: string): Promise<void>;
  remover(sala: string, identidade: string): Promise<void>;
  /** Encerra para todos. */
  encerrar(sala: string): Promise<void>;
  presentes(sala: string): Promise<PessoaNaSala[]>;
  /** Confere a assinatura do aviso e traduz (lança erro se a assinatura não bater). */
  lerAviso(corpo: string, autorizacao: string | undefined): Promise<AvisoVideo>;
  /** "ok (…)" ou lança o erro. */
  testar(): Promise<string>;
}

/** wss://x → https://x (a API do servidor usa HTTP). */
export function urlDaApi(url: string): string {
  return url.replace(/^ws(s?):\/\//i, 'http$1://').replace(/\/+$/, '');
}

const nsParaData = (ns: bigint | undefined): Date | null =>
  ns && ns > 0n ? new Date(Number(ns / 1_000_000n)) : null;

/** Qualidade da gravação: 720p, 24 quadros, ~1,9 Mbps (texto da tela compartilhada legível sem arquivo enorme). */
export function opcoesGravacao(): EncodingOptions {
  return new EncodingOptions({
    width: 1280,
    height: 720,
    depth: 24,
    framerate: 24,
    videoCodec: VideoCodec.H264_MAIN,
    videoBitrate: 1800,
    audioCodec: AudioCodec.AAC,
    audioBitrate: 128,
    audioFrequency: 48000,
    keyFrameInterval: 4,
  });
}

function destinoS3(a: ConfigArmazenamento): S3Upload {
  return new S3Upload({
    accessKey: a.chave,
    secret: a.segredo,
    region: a.regiao || 'auto',
    endpoint: a.endpoint,
    bucket: a.bucket,
    forcePathStyle: true,
  });
}

function situacaoGravacao(s: EgressStatus): 'gravando' | 'pronta' | 'falhou' {
  if (s === EgressStatus.EGRESS_COMPLETE) return 'pronta';
  if (
    s === EgressStatus.EGRESS_FAILED ||
    s === EgressStatus.EGRESS_ABORTED ||
    s === EgressStatus.EGRESS_LIMIT_REACHED
  )
    return 'falhou';
  return 'gravando';
}

/** Traduz um aviso de gravação (egress_*). */
export function traduzirGravacao(info: EgressInfo, id: string, em: Date): AvisoVideo {
  const req = info.request;
  let de: 'sala' | 'audio' = 'sala';
  let trilhaId: string | null = null;
  if (req.case === 'track') {
    de = 'audio';
    trilhaId = req.value.trackId || null;
  } else if (req.case === 'egress' && req.value.source.case === 'media') {
    de = 'audio';
  }
  const f = info.fileResults[0] ?? (info.result.case === 'file' ? info.result.value : undefined);
  const chave = f ? f.filename || new URL(f.location || 'http://x/').pathname.replace(/^\/+/, '') : '';
  const situacao = situacaoGravacao(info.status);
  return {
    tipo: 'gravacao',
    id,
    sala: info.roomName,
    gravacaoId: info.egressId,
    de,
    trilhaId,
    situacao,
    inicio: nsParaData(info.startedAt),
    arquivo:
      f && chave && situacao === 'pronta'
        ? {
            chave,
            bytes: Number(f.size ?? 0n),
            segundos: Math.round(Number((f.duration ?? 0n) / 1_000_000n) / 1000),
            inicio: nsParaData(f.startedAt),
            fim: nsParaData(f.endedAt),
          }
        : null,
    erro: info.error || null,
    em,
  };
}

/** Traduz o aviso do LiveKit para o que o sistema entende. */
export function traduzirAviso(ev: WebhookEvent): AvisoVideo {
  const em = ev.createdAt ? new Date(Number(ev.createdAt) * 1000) : new Date();
  const id = ev.id || `${ev.event}-${em.getTime()}`;
  const sala = ev.room?.name ?? ev.egressInfo?.roomName ?? '';
  switch (ev.event) {
    case 'room_started':
      return { tipo: 'sala_aberta', id, sala, em };
    case 'room_finished':
      return { tipo: 'sala_encerrada', id, sala, em };
    case 'participant_joined':
      return {
        tipo: 'entrou',
        id,
        sala,
        identidade: ev.participant?.identity ?? '',
        nome: ev.participant?.name ?? '',
        em,
      };
    case 'participant_left':
    case 'participant_connection_aborted':
      return { tipo: 'saiu', id, sala, identidade: ev.participant?.identity ?? '', em };
    case 'track_published':
      if (ev.track?.type === TrackType.AUDIO && ev.track.source === TrackSource.MICROPHONE)
        return {
          tipo: 'microfone',
          id,
          sala,
          identidade: ev.participant?.identity ?? '',
          nome: ev.participant?.name ?? '',
          trilhaId: ev.track.sid,
          em,
        };
      return { tipo: 'outro', id, evento: ev.event };
    case 'egress_started':
    case 'egress_updated':
    case 'egress_ended':
      return ev.egressInfo
        ? traduzirGravacao(ev.egressInfo, id, em)
        : { tipo: 'outro', id, evento: ev.event };
    default:
      return { tipo: 'outro', id, evento: ev.event };
  }
}

export function criarServicoVideo(cfg: ConfigVideo): ServicoVideo {
  const host = urlDaApi(cfg.url);
  const salas = new RoomServiceClient(host, cfg.apiKey, cfg.apiSecret);
  const gravacoes = new EgressClient(host, cfg.apiKey, cfg.apiSecret);
  const avisos = new WebhookReceiver(cfg.apiKey, cfg.apiSecret);
  const arm = cfg.armazenamento ?? null;
  const codificar = new TextEncoder();

  const exigirArmazenamento = (): ConfigArmazenamento => {
    if (!arm) throw new Error('Gravação sem armazenamento configurado');
    return arm;
  };

  return {
    urlCliente: cfg.url.replace(/\/+$/, ''),
    gravaArquivos: !!arm,

    async acesso(p) {
      const t = new AccessToken(cfg.apiKey, cfg.apiSecret, {
        identity: p.identidade,
        name: p.nome,
        ttl: `${p.horas ?? 12}h`,
        attributes: p.atributos ?? {},
      });
      t.addGrant({
        roomJoin: true,
        room: p.sala,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
        // Levantar a mão é um atributo que a própria pessoa muda.
        canUpdateOwnMetadata: true,
      });
      return t.toJwt();
    },

    async abrirSala(p) {
      await salas.createRoom({
        name: p.sala,
        // Sala criada e ninguém entrou: fecha em 30 min. Todo mundo saiu: espera 5 min (queda de internet).
        emptyTimeout: 30 * 60,
        departureTimeout: 5 * 60,
        maxParticipants: p.maxPessoas ?? 50,
      });
    },

    async gravarSala(p) {
      const a = exigirArmazenamento();
      const info = await gravacoes.startRoomCompositeEgress(
        p.sala,
        {
          file: new EncodedFileOutput({
            fileType: EncodedFileType.MP4,
            filepath: p.chave,
            output: { case: 's3', value: destinoS3(a) },
          }),
        },
        // "speaker": quem fala (ou a tela compartilhada) em destaque, os outros ao lado.
        { layout: 'speaker', encodingOptions: opcoesGravacao() },
      );
      return info.egressId;
    },

    async gravarAudio(p) {
      const a = exigirArmazenamento();
      const info = await gravacoes.startTrackEgress(
        p.sala,
        new DirectFileOutput({ filepath: p.chave, output: { case: 's3', value: destinoS3(a) } }),
        p.trilhaId,
      );
      return info.egressId;
    },

    async enviar(sala, topico, dados, identidades) {
      await salas.sendData(sala, codificar.encode(JSON.stringify(dados)), DataPacket_Kind.RELIABLE, {
        topic: topico,
        ...(identidades?.length ? { destinationIdentities: identidades } : {}),
      });
    },

    async silenciar(sala, identidade) {
      const p = await salas.getParticipant(sala, identidade);
      const mics = p.tracks.filter((t) => t.source === TrackSource.MICROPHONE && !t.muted);
      for (const t of mics) await salas.mutePublishedTrack(sala, identidade, t.sid, true);
      return mics.length > 0;
    },

    async baixarMao(sala, identidade) {
      // Atributo vazio é apagado.
      await salas.updateParticipant(sala, identidade, { attributes: { mao: '' } });
    },

    async remover(sala, identidade) {
      await salas.removeParticipant(sala, identidade);
    },

    async encerrar(sala) {
      await salas.deleteRoom(sala).catch((erro: Error) => {
        // Já encerrada: tudo certo.
        if (!/not.?found|404/i.test(erro.message)) throw erro;
      });
    },

    async presentes(sala) {
      const lista = await salas.listParticipants(sala).catch((erro: Error) => {
        if (/not.?found|404/i.test(erro.message)) return [];
        throw erro;
      });
      return lista
        .filter((p) => p.kind === 0) // pessoas (não as gravações nem robôs)
        .map((p) => ({ identidade: p.identity, nome: p.name, atributos: { ...p.attributes } }));
    },

    async lerAviso(corpo, autorizacao) {
      return traduzirAviso(await avisos.receive(corpo, autorizacao));
    },

    async testar() {
      await salas.listRooms();
      return `ok (${new URL(host).hostname}${arm ? ', com gravação' : ', sem gravação'})`;
    },
  };
}
