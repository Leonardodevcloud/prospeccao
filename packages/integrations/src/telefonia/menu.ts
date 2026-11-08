import { spawn } from 'node:child_process';

/*
 * Menu de voz das ligações recebidas ("para a loja Centro, digite 1"). Um participante "menu" entra
 * na sala lig-in-… do LiveKit junto com quem ligou, fala as opções, ouve a tecla (DTMF, que o
 * LiveKit entrega como evento da sala) e, depois da escolha, toca o tom de chamada até um
 * vendedor atender. A conversa (o que falar, quantas vezes repetir) fica na api; aqui é só o som.
 */

/** Identidade do menu na sala (não é quem ligou nem um vendedor). */
export const IDENTIDADE_MENU = 'menu';

/** O celular do siga-me (o mesmo de IDENTIDADE_SIGA_ME no index). */
const SIGA_ME = 'siga-me';

export const TAXA = 48_000;
const QUADRO = TAXA / 50; // 20 ms

export type RespostaMenu = { tecla: string } | { semResposta: true } | { desligou: true };

export interface SessaoMenu {
  /** Fala o áudio (mp3) e espera uma tecla por até esperaMs depois de terminar. Tecla corta a fala. */
  perguntar(mp3: Uint8Array, esperaMs: number): Promise<RespostaMenu>;
  /** Fala (sem esperar tecla). */
  falar(mp3: Uint8Array): Promise<'ok' | 'desligou'>;
  /**
   * Toca o tom de chamada até um vendedor entrar (ou o celular do siga-me atender), quem ligou
   * desligar ou passar do limite.
   */
  chamar(limiteMs: number): Promise<'atendeu' | 'desligou' | 'limite'>;
  sair(): Promise<void>;
}

export interface RoboMenu {
  entrar(p: { url: string; token: string; chamador: string }): Promise<SessaoMenu>;
}

/** mp3 → PCM 16 bits, 48 kHz, mono (o ffmpeg já está na imagem da api). */
export function paraPcm(mp3: Uint8Array): Promise<Int16Array> {
  return new Promise((ok, falha) => {
    const p = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      'pipe:0',
      '-f',
      's16le',
      '-ac',
      '1',
      '-ar',
      String(TAXA),
      'pipe:1',
    ]);
    const partes: Buffer[] = [];
    let erro = '';
    p.stdout.on('data', (b: Buffer) => partes.push(b));
    p.stderr.on('data', (b: Buffer) => {
      erro += b.toString();
    });
    p.on('error', falha);
    p.on('close', (codigo) => {
      if (codigo !== 0) return falha(new Error(`ffmpeg: ${erro.trim() || codigo}`));
      const b = Buffer.concat(partes);
      const copia = new Int16Array(Math.floor(b.length / 2));
      for (let i = 0; i < copia.length; i++) copia[i] = b.readInt16LE(i * 2);
      ok(copia);
    });
    p.stdin.on('error', () => undefined);
    p.stdin.end(Buffer.from(mp3));
  });
}

/** Tom de chamada brasileiro: 425 Hz, 1 s tocando e 4 s em silêncio. */
export function tomDeChamada(): Int16Array {
  const s = new Int16Array(TAXA * 5);
  for (let i = 0; i < TAXA; i++) {
    // Entrada e saída suaves (sem estalo).
    const env = Math.min(1, i / 480, (TAXA - i) / 480);
    s[i] = Math.round(Math.sin((2 * Math.PI * 425 * i) / TAXA) * 7000 * env);
  }
  return s;
}

/** Robô de verdade (LiveKit em tempo real). O módulo nativo só carrega na primeira ligação com menu. */
export function criarRoboMenu(): RoboMenu {
  const pcms = new Map<string, Promise<Int16Array>>();
  const pcmDe = (mp3: Uint8Array) => {
    const chave = `${mp3.length}:${Buffer.from(mp3.subarray(0, 64)).toString('base64')}:${Buffer.from(mp3.subarray(-64)).toString('base64')}`;
    let p = pcms.get(chave);
    if (!p) {
      if (pcms.size > 100) pcms.clear();
      p = paraPcm(mp3);
      p.catch(() => pcms.delete(chave));
      pcms.set(chave, p);
    }
    return p;
  };
  const tom = tomDeChamada();

  return {
    async entrar({ url, token, chamador }) {
      const rtc = await import('@livekit/rtc-node');
      const sala = new rtc.Room();
      await sala.connect(url, token, { autoSubscribe: true, dynacast: false });
      // Fila curta: a tecla e quem atende cortam o som na hora.
      const fonte = new rtc.AudioSource(TAXA, 1, 200);
      const faixa = rtc.LocalAudioTrack.createAudioTrack('menu', fonte);
      const opcoes = new rtc.TrackPublishOptions();
      opcoes.source = rtc.TrackSource.SOURCE_MICROPHONE;
      await sala.localParticipant!.publishTrack(faixa, opcoes);

      let desligou = false;
      let atendeu = false;
      let aoMudar: (() => void) | null = null;
      let teclas: string[] = [];
      const avisar = () => aoMudar?.();
      const ehVendedor = (id: string) => id !== chamador && id !== SIGA_ME && !id.startsWith('sip_');
      sala.on(rtc.RoomEvent.DtmfReceived, (_c, digito, p) => {
        if (p.identity !== chamador) return;
        teclas.push(digito);
        avisar();
      });
      sala.on(rtc.RoomEvent.ParticipantDisconnected, (p) => {
        if (p.identity === chamador) desligou = true;
        avisar();
      });
      sala.on(rtc.RoomEvent.Disconnected, () => {
        desligou = true;
        avisar();
      });
      sala.on(rtc.RoomEvent.ParticipantConnected, (p) => {
        if (ehVendedor(p.identity)) atendeu = true;
        avisar();
      });
      // O celular do siga-me entra na sala enquanto toca; "atendeu" quando começa a mandar som.
      sala.on(rtc.RoomEvent.TrackSubscribed, (_t, _pub, p) => {
        if (p.identity !== chamador) atendeu = true;
        avisar();
      });
      // Quem ligou já tinha desligado antes do menu entrar.
      if (!sala.remoteParticipants.has(chamador)) desligou = true;
      for (const p of sala.remoteParticipants.values()) if (ehVendedor(p.identity)) atendeu = true;

      /** Toca o som em quadros de 20 ms até acabar ou `parar()` dizer que é para cortar. */
      const tocar = async (pcm: Int16Array, parar: () => boolean) => {
        for (let i = 0; i < pcm.length; i += QUADRO) {
          if (parar()) {
            fonte.clearQueue();
            return false;
          }
          const pedaco = new Int16Array(QUADRO);
          pedaco.set(pcm.subarray(i, i + QUADRO));
          await fonte.captureFrame(new rtc.AudioFrame(pedaco, TAXA, 1, QUADRO));
        }
        await fonte.waitForPlayout();
        return true;
      };
      const esperar = (ms: number, ate: () => boolean) =>
        new Promise<void>((ok) => {
          if (ate()) return ok();
          const fim = () => {
            clearTimeout(relogio);
            aoMudar = null;
            ok();
          };
          const relogio = setTimeout(fim, ms);
          aoMudar = () => ate() && fim();
        });

      return {
        async perguntar(mp3, esperaMs) {
          teclas = [];
          const pcm = await pcmDe(mp3);
          await tocar(pcm, () => desligou || teclas.length > 0);
          await esperar(esperaMs, () => desligou || teclas.length > 0);
          if (desligou) return { desligou: true };
          const tecla = teclas[0];
          return tecla ? { tecla } : { semResposta: true };
        },
        async falar(mp3) {
          const pcm = await pcmDe(mp3);
          await tocar(pcm, () => desligou);
          return desligou ? 'desligou' : 'ok';
        },
        async chamar(limiteMs) {
          const ate = Date.now() + limiteMs;
          while (!desligou && !atendeu && Date.now() < ate) await tocar(tom, () => desligou || atendeu);
          return desligou ? 'desligou' : atendeu ? 'atendeu' : 'limite';
        },
        async sair() {
          aoMudar = null;
          await fonte.close().catch(() => undefined);
          await sala.disconnect().catch(() => undefined);
        },
      };
    },
  };
}
