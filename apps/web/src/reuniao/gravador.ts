import {
  ConnectionQuality,
  ConnectionState,
  type LocalVideoTrack,
  type Room,
  RoomEvent,
  Track,
} from 'livekit-client';
import { type Criacao, EnvioEmPedacos } from './envio';
import { ehCelular } from './sons';

/**
 * Gravação da reunião no navegador de quem conduz (sem custo de gravação na nuvem).
 *
 * - Vídeo: a própria aba da reunião, exatamente como quem conduz vê (grade, nomes, chat, tela
 *   compartilhada), em até 1080p e 24 quadros. Computador mais fraco (4 núcleos ou menos): 720p.
 *   Se a câmera ao vivo começar a perder qualidade por falta de processador, a gravação cai para
 *   12 quadros até o aperto passar (a reunião vem primeiro).
 * - Som do vídeo: todas as vozes misturadas (as de quem está na sala e a sua), mais o som de uma tela
 *   compartilhada; os bipes de aviso da sala não entram.
 * - Transcrição: o microfone de cada pessoa gravado à parte (é o que dá o nome de quem falou).
 * - Envio: pedaços de 2 s, na ordem, guardados no computador até a api confirmar (envio.ts). Com a
 *   internet apertada, o envio espera para não atrapalhar a reunião.
 */

export type FaseGravador = 'parado' | 'gravando' | 'enviando' | 'concluido';

export interface EstadoGravador {
  fase: FaseGravador;
  desde: number | null;
  /** Bytes que ainda faltam subir e o total gravado (para a barra de envio). */
  pendentes: number;
  total: number;
  /** Algo que a pessoa precisa saber (gravação parou, outra pessoa grava…). */
  aviso: string | null;
}

/** Este navegador grava a própria aba? (Chrome ou Edge no computador.) */
export function podeGravarAba(): boolean {
  try {
    return (
      !ehCelular() &&
      typeof MediaRecorder !== 'undefined' &&
      typeof AudioContext !== 'undefined' &&
      !!navigator.mediaDevices?.getDisplayMedia &&
      // Só o Chrome e o Edge oferecem "esta aba" direto (e têm o CaptureController).
      'CaptureController' in globalThis
    );
  } catch {
    return false;
  }
}

const fraco = () => (navigator.hardwareConcurrency ?? 8) <= 4;
/** Quadros por segundo da gravação (e o mínimo quando o computador aperta). */
const QUADROS = 24;
const QUADROS_ALIVIO = 12;

/**
 * Pede para gravar esta aba. Precisa ser chamado direto no clique (o navegador exige). O Chrome
 * mostra "Compartilhar esta aba?": a pessoa clica em Compartilhar. Devolve null se ela cancelar.
 */
export async function pedirCapturaDaAba(): Promise<MediaStream | null> {
  // 24 quadros bastam para a tela da reunião e deixam o processador livre para a câmera ao vivo.
  const limite = fraco()
    ? { width: 1280, height: 720, fps: 20 }
    : { width: 1920, height: 1080, fps: QUADROS };
  try {
    return await navigator.mediaDevices.getDisplayMedia({
      video: {
        displaySurface: 'browser',
        // Só limites: a aba é gravada no tamanho real dela (nunca ampliada), até 1080p.
        width: { max: limite.width },
        height: { max: limite.height },
        frameRate: { ideal: limite.fps, max: limite.fps },
      },
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
      surfaceSwitching: 'exclude',
      monitorTypeSurfaces: 'exclude',
    } as DisplayMediaStreamOptions);
  } catch {
    return null;
  }
}

function escolherFormato(opcoes: string[]): string {
  return opcoes.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
}

/** Vídeo: H.264 (vira MP4 que toca em qualquer lugar); senão VP9/VP8. */
const formatoVideo = () =>
  escolherFormato([
    'video/webm;codecs=h264,opus',
    'video/mp4;codecs=avc1.640028,opus',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ]);
const formatoAudio = () =>
  escolherFormato(['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4']);

/** Qualidade do vídeo pelo tamanho da aba: 1080p24 ≈ 3,5 Mbps; 720p ≈ 2 Mbps (texto nítido). */
function bitrateDoVideo(t: MediaStreamTrack): number {
  const s = t.getSettings();
  const pixels = (s.width ?? 1920) * (s.height ?? 1080) * (s.frameRate ?? QUADROS);
  return Math.round(Math.min(6_000_000, Math.max(2_000_000, pixels * 0.07)));
}

interface Fonte {
  no: MediaStreamAudioSourceNode;
  gravador: MediaRecorder | null;
  envio: EnvioEmPedacos | null;
}

class Gravador {
  estado: EstadoGravador = { fase: 'parado', desde: null, pendentes: 0, total: 0, aviso: null };
  private ouvintes = new Set<(e: EstadoGravador) => void>();
  private room: Room | null = null;
  private captura: MediaStream | null = null;
  private contexto: AudioContext | null = null;
  private mistura: MediaStreamAudioDestinationNode | null = null;
  private gravadorVideo: MediaRecorder | null = null;
  private envios: EnvioEmPedacos[] = [];
  private fontes = new Map<string, Fonte>();
  private relogio: ReturnType<typeof setInterval> | null = null;
  private desligar: (() => void) | null = null;
  private cfg: { codigo: string; credencial: string; transcrever: boolean } | null = null;

  ouvir(f: (e: EstadoGravador) => void): () => void {
    this.ouvintes.add(f);
    f(this.estado);
    return () => this.ouvintes.delete(f);
  }

  private mudar(x: Partial<EstadoGravador>) {
    this.estado = { ...this.estado, ...x };
    for (const f of this.ouvintes) f(this.estado);
  }

  private progresso = () => {
    const pendentes = this.envios.reduce((s, e) => s + e.pendentes, 0);
    const total = this.envios.reduce((s, e) => s + e.pendentes + e.enviados, 0);
    this.mudar({ pendentes, total });
    if (this.estado.fase === 'enviando' && this.envios.every((e) => e.vazio))
      this.mudar({ fase: 'concluido' });
  };

  /** O que a câmera e a tela ao vivo estão sofrendo agora (medido a cada 3 s). */
  private limitado: { cpu: boolean; banda: boolean } = { cpu: false, banda: false };
  private aliviado = false;
  private semAperto = 0;

  /**
   * A reunião ao vivo tem prioridade sobre a gravação. A cada 3 s confere a câmera e a tela que você
   * está mandando: se o navegador estiver baixando a qualidade delas por falta de processador, a
   * gravação passa a 12 quadros (alivia o computador); por falta de internet, o envio da gravação
   * espera. Passado o aperto (30 s), volta ao normal.
   */
  private async vigiar() {
    const r = this.room;
    const video = this.captura?.getVideoTracks()[0];
    if (!r || !video || this.estado.fase !== 'gravando') return;
    let cpu = false;
    let banda = false;
    for (const fonte of [Track.Source.Camera, Track.Source.ScreenShare]) {
      const faixa = r.localParticipant.getTrackPublication(fonte)?.track as LocalVideoTrack | undefined;
      if (!faixa || faixa.isMuted) continue;
      const stats = await faixa.getSenderStats().catch(() => []);
      cpu ||= stats.some((x) => x.qualityLimitationReason === 'cpu');
      banda ||= stats.some((x) => x.qualityLimitationReason === 'bandwidth');
    }
    this.limitado = { cpu, banda };
    if (cpu || banda) this.semAperto = 0;
    else this.semAperto += 3;
    if (cpu && !this.aliviado) {
      this.aliviado = true;
      await video.applyConstraints({ frameRate: { max: QUADROS_ALIVIO } }).catch(() => undefined);
    } else if (this.aliviado && this.semAperto >= 30) {
      this.aliviado = false;
      await video.applyConstraints({ frameRate: { max: fraco() ? 20 : QUADROS } }).catch(() => undefined);
    }
  }

  /** Reunião primeiro: só sobe pedaço com a internet folgada (o resto sobe quando der ou no fim). */
  private podeEnviar = (): boolean => {
    const r = this.room;
    if (!r || r.state !== ConnectionState.Connected) return true;
    if (this.limitado.banda) return false;
    const q = r.localParticipant.connectionQuality;
    if (q === ConnectionQuality.Excellent) return true;
    if (q === ConnectionQuality.Good) return !r.localParticipant.isScreenShareEnabled;
    return q === ConnectionQuality.Unknown;
  };

  private novoEnvio(c: Criacao, inicio: number): EnvioEmPedacos {
    const cfg = this.cfg!;
    const e = new EnvioEmPedacos(cfg.codigo, cfg.credencial, c, inicio, this.podeEnviar);
    e.aoMudar = this.progresso;
    this.envios.push(e);
    return e;
  }

  iniciar(
    room: Room,
    captura: MediaStream,
    cfg: { codigo: string; credencial: string; transcrever: boolean },
  ) {
    if (this.estado.fase === 'gravando') {
      // Já grava (a tela redesenhou e pediu de novo): só descarta uma captura nova e diferente.
      if (captura !== this.captura) for (const t of captura.getTracks()) t.stop();
      return;
    }
    const video = captura.getVideoTracks()[0];
    // A pessoa já parou de compartilhar a aba antes de a sala abrir.
    if (video?.readyState !== 'live') return;
    this.room = room;
    this.captura = captura;
    this.cfg = cfg;
    this.envios = [];
    video.contentHint = 'detail';

    const ctx = new AudioContext({ sampleRate: 48_000, latencyHint: 'playback' });
    this.contexto = ctx;
    this.mistura = ctx.createMediaStreamDestination();

    const mime = formatoVideo();
    const inicio = performance.now();
    const rec = new MediaRecorder(new MediaStream([video, ...this.mistura.stream.getAudioTracks()]), {
      ...(mime ? { mimeType: mime } : {}),
      videoBitsPerSecond: bitrateDoVideo(video),
      audioBitsPerSecond: 160_000,
    });
    const envio = this.novoEnvio({ tipo: 'sala', mime: rec.mimeType || mime || 'video/webm' }, inicio);
    envio.aoRecusar = (motivo) => {
      void this.parar(motivo);
    };
    rec.ondataavailable = (e) => envio.adicionar(e.data);
    rec.start(2000);
    this.gravadorVideo = rec;

    // Parar de compartilhar a aba (pela barra do Chrome) para a gravação.
    video.addEventListener('ended', () => {
      void this.parar('A gravação parou porque o compartilhamento da aba foi encerrado.');
    });

    const sincronizar = () => this.sincronizar();
    const eventos = [
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.ParticipantDisconnected,
    ] as const;
    for (const ev of eventos) room.on(ev, sincronizar);
    const aoSair = () => void this.parar();
    room.on(RoomEvent.Disconnected, aoSair);
    // O microfone pode trocar de aparelho (a faixa muda): confere a cada segundo.
    // E a cada 3 s, se a gravação está apertando a câmera ao vivo (vigiar).
    let tique = 0;
    this.relogio = setInterval(() => {
      sincronizar();
      if (++tique % 3 === 0) void this.vigiar();
    }, 1000);
    this.desligar = () => {
      for (const ev of eventos) room.off(ev, sincronizar);
      room.off(RoomEvent.Disconnected, aoSair);
    };
    this.sincronizar();
    void room.localParticipant.setAttributes({ gravando: '1' }).catch(() => undefined);
    this.mudar({ fase: 'gravando', desde: Date.now(), aviso: null });
  }

  /** Liga (e desliga) cada som da sala na mistura e, se transcreve, num gravador por microfone. */
  private sincronizar() {
    const room = this.room;
    const ctx = this.contexto;
    const mistura = this.mistura;
    if (!room || !ctx || !mistura || this.estado.fase !== 'gravando') return;
    const atuais = new Map<
      string,
      { faixa: MediaStreamTrack; identidade: string; nome: string; sid: string; mic: boolean }
    >();
    const lp = room.localParticipant;
    const meu = lp.getTrackPublication(Track.Source.Microphone);
    const minha = meu?.track?.mediaStreamTrack;
    if (minha && minha.readyState === 'live' && meu?.trackSid)
      atuais.set(minha.id, {
        faixa: minha,
        identidade: lp.identity,
        nome: lp.name || lp.identity,
        sid: meu.trackSid,
        mic: true,
      });
    for (const p of room.remoteParticipants.values())
      for (const pub of p.trackPublications.values()) {
        const faixa =
          pub.kind === Track.Kind.Audio && pub.isSubscribed ? pub.track?.mediaStreamTrack : undefined;
        if (faixa?.readyState !== 'live') continue;
        atuais.set(faixa.id, {
          faixa,
          identidade: p.identity,
          nome: p.name || p.identity,
          sid: pub.trackSid,
          mic: pub.source === Track.Source.Microphone,
        });
      }

    for (const [id, f] of this.fontes)
      if (!atuais.has(id)) {
        this.fecharFonte(f);
        this.fontes.delete(id);
      }

    // O microfone de cada pessoa só começa a ser gravado depois que a api aceitou esta gravação
    // (se outra pessoa do time já grava, não sai transcrição em dobro).
    const aceita = !!this.envios[0]?.id;
    for (const [id, a] of atuais) {
      let f = this.fontes.get(id);
      if (!f) {
        const no = ctx.createMediaStreamSource(new MediaStream([a.faixa]));
        no.connect(mistura);
        f = { no, gravador: null, envio: null };
        this.fontes.set(id, f);
      }
      if (
        f.gravador ||
        !aceita ||
        !a.mic ||
        !this.cfg?.transcrever ||
        !/^[uc]-[0-9a-f]{1,32}$/.test(a.identidade)
      )
        continue;
      const destino = ctx.createMediaStreamDestination();
      f.no.connect(destino);
      const mime = formatoAudio();
      const gravador = new MediaRecorder(destino.stream, {
        ...(mime ? { mimeType: mime } : {}),
        audioBitsPerSecond: 48_000,
      });
      const envio = this.novoEnvio(
        {
          tipo: 'audio',
          identidade: a.identidade,
          nome: a.nome.slice(0, 80),
          trilhaId: a.sid,
          mime: gravador.mimeType || mime || 'audio/webm',
        },
        performance.now(),
      );
      gravador.ondataavailable = (ev) => envio.adicionar(ev.data);
      gravador.start(4000);
      f.gravador = gravador;
      f.envio = envio;
    }
  }

  private fecharFonte(f: Fonte) {
    try {
      f.no.disconnect();
    } catch {
      // já desligada
    }
    if (f.gravador && f.gravador.state !== 'inactive') {
      const envio = f.envio;
      f.gravador.addEventListener('stop', () => void envio?.concluir(), { once: true });
      f.gravador.stop();
    } else void f.envio?.concluir();
  }

  /** Para tudo e sobe o que falta (a aba pode continuar aberta mostrando o progresso). */
  async parar(aviso?: string): Promise<void> {
    if (this.estado.fase !== 'gravando') return;
    if (this.relogio) clearInterval(this.relogio);
    this.relogio = null;
    this.desligar?.();
    this.desligar = null;
    const rec = this.gravadorVideo;
    const envioVideo = this.envios[0];
    const parou = new Promise<void>((resolve) => {
      if (!rec || rec.state === 'inactive') return resolve();
      rec.addEventListener('stop', () => resolve(), { once: true });
      rec.stop();
    });
    for (const f of this.fontes.values()) this.fecharFonte(f);
    this.fontes.clear();
    await parou;
    void envioVideo?.concluir();
    for (const t of this.captura?.getTracks() ?? []) t.stop();
    this.captura = null;
    void this.contexto?.close().catch(() => undefined);
    this.contexto = null;
    this.mistura = null;
    const room = this.room;
    if (room?.state === ConnectionState.Connected)
      void room.localParticipant.setAttributes({ gravando: '' }).catch(() => undefined);
    this.mudar({ fase: 'enviando', aviso: aviso ?? null });
    this.progresso();
  }

  /** Há gravação gravando ou ainda subindo (para avisar antes de fechar a aba). */
  get ocupado() {
    return this.estado.fase === 'gravando' || (this.estado.fase === 'enviando' && this.estado.pendentes > 0);
  }
}

export const gravador = new Gravador();

// Fechar a aba no meio: o navegador pergunta antes (o que já foi gravado continua guardado).
if (typeof window !== 'undefined')
  window.addEventListener('beforeunload', (e) => {
    if (!gravador.ocupado) return;
    e.preventDefault();
    e.returnValue = '';
  });
