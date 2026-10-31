import {
  RoomAudioRenderer,
  RoomContext,
  type TrackReferenceOrPlaceholder,
  useAudioPlayback,
  useConnectionQualityIndicator,
  useConnectionState,
  useIsRecording,
  useLocalParticipant,
  useMediaDeviceSelect,
  useParticipants,
  useSpeakingParticipants,
  useTracks,
} from '@livekit/components-react';
import { Avatar, Button, Icon } from '@prospeccao/ui';
import {
  ConnectionQuality,
  ConnectionState,
  DisconnectReason,
  type LocalVideoTrack,
  type Participant,
  ParticipantEvent,
  type RemoteParticipant,
  type RemoteVideoTrack,
  Room,
  RoomEvent,
  ScreenSharePresets,
  Track,
  VideoPresets,
} from 'livekit-client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { linkDaSala } from '../endereco';
import type { Escolhas } from './Antessala';
import { apiSala, type InfoSala, type Liberado, type MensagemChat } from './api';
import {
  aplicarFundo,
  criarProcessador,
  esquecerFundo,
  lembrarFundo,
  opcoesDeFundo,
  suportaFundos,
} from './fundos';
import { useFundosPessoais } from './fundosPessoais';
import { type EstadoGravador, gravador, pedirCapturaDaAba, podeGravarAba } from './gravador';
import { GradeEncaixada, Ladrilho, nomeDe } from './Ladrilho';
import { PainelChat } from './PainelChat';
import { maosLevantadas, PainelPessoas } from './PainelPessoas';
import { GradeDeFundos, marcaDaSala } from './SeletorFundo';
import { avisarNaAba, destravarSons, ehCelular, guardarSons, type Som, sonsLigados, tocar } from './sons';

/**
 * A sala de reunião: vídeos (grade, ou a tela compartilhada em destaque), controles (microfone,
 * câmera, tela, mão, mais opções, sair), chat com arquivos e pessoas. A qualidade fica com o LiveKit:
 * cada câmera manda o vídeo em três qualidades e cada pessoa recebe a que a internet dela aguenta;
 * o áudio tem prioridade e redundância contra perda de pacotes.
 */

export type MotivoSaida = 'saiu' | 'encerrada' | 'removido' | 'erro';

/**
 * Opções da conexão (as mesmas para todo mundo).
 * - Recebe cada vídeo na qualidade do tamanho dele na tela, contando 2 pixels por ponto (nítido como no
 *   Meet também em telas comuns; com a internet fraca, o servidor baixa a qualidade sozinho).
 * - Câmera em 720p a até 2,9 Mbps; tela compartilhada em 1080p a 30 quadros e até 5,2 Mbps.
 * - Quem assiste a tela compartilhada recebe com o menor atraso possível (sem folga no buffer).
 * - Com a rede apertada, reduz um pouco a nitidez e os quadros juntos ("balanced") em vez de travar
 *   a imagem ou borrar tudo.
 */
function criarSala(escolhas: Escolhas): Room {
  return new Room({
    adaptiveStream: { pixelDensity: 2 },
    dynacast: true,
    disconnectOnPageLeave: true,
    videoCaptureDefaults: {
      resolution: VideoPresets.h720.resolution,
      ...(escolhas.cameraId ? { deviceId: escolhas.cameraId } : { facingMode: escolhas.frente }),
    },
    audioCaptureDefaults: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      ...(escolhas.microfoneId ? { deviceId: escolhas.microfoneId } : {}),
    },
    publishDefaults: {
      simulcast: true,
      // Camada do meio em 540p (antes 360p): quem tem internet mais fraca recebe imagem melhor.
      videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h540],
      videoEncoding: { maxBitrate: 2_900_000, maxFramerate: 30 },
      degradationPreference: 'balanced',
      // Áudio com redundância (perda de pacotes no 4G) e sem mandar silêncio.
      red: true,
      dtx: true,
      screenShareEncoding: { maxBitrate: 5_200_000, maxFramerate: 30 },
    },
  });
}

/** Estado da gravação pelo navegador (gravando, subindo o que falta…). */
export function useEstadoGravador(): EstadoGravador {
  const [estado, setEstado] = useState(gravador.estado);
  useEffect(() => gravador.ouvir(setEstado), []);
  return estado;
}

function useTelaPequena(): boolean {
  const consulta = '(max-width: 760px)';
  const [pequena, setPequena] = useState(() => globalThis.matchMedia?.(consulta).matches ?? false);
  useEffect(() => {
    const m = globalThis.matchMedia?.(consulta);
    if (!m) return;
    const mudar = () => setPequena(m.matches);
    m.addEventListener('change', mudar);
    return () => m.removeEventListener('change', mudar);
  }, []);
  return pequena;
}

const decodificar = new TextDecoder();

interface Aviso {
  id: number;
  texto: string;
  icone?: string;
  tom?: 'atencao';
  acao?: { rotulo: string; fazer: () => void };
}

export function Sala(props: {
  info: InfoSala;
  acesso: Liberado;
  escolhas: Escolhas;
  aoSair: (motivo: MotivoSaida, detalhe?: string) => void;
}) {
  const { acesso, escolhas, aoSair } = props;
  const [room] = useState(() => criarSala(escolhas));
  const [conectado, setConectado] = useState(false);
  const infoRef = useRef(props.info);
  infoRef.current = props.info;
  const saida = useRef(aoSair);
  saida.current = aoSair;

  useEffect(() => {
    let vivo = true;
    const aoDesconectar = (motivo?: DisconnectReason) => {
      if (!vivo) return;
      if (motivo === DisconnectReason.ROOM_DELETED) saida.current('encerrada');
      else if (motivo === DisconnectReason.PARTICIPANT_REMOVED) saida.current('removido');
      else if (motivo === DisconnectReason.CLIENT_INITIATED) saida.current('saiu');
      else if (motivo === DisconnectReason.DUPLICATE_IDENTITY)
        saida.current('erro', 'Você entrou nesta reunião em outra aba ou aparelho.');
      else saida.current('erro', 'A internet caiu e não deu para voltar sozinho. Tente entrar de novo.');
    };
    room.on(RoomEvent.Disconnected, aoDesconectar);
    room
      .connect(acesso.url, acesso.token)
      .then(async () => {
        if (!vivo) return;
        setConectado(true);
        if (escolhas.altoFalanteId)
          await room.switchActiveDevice('audiooutput', escolhas.altoFalanteId).catch(() => undefined);
        // A câmera já nasce com o fundo escolhido na antessala (ninguém vê o fundo real).
        const processor =
          escolhas.camera && escolhas.fundo && escolhas.fundo !== 'nenhum' && suportaFundos()
            ? await criarProcessador(escolhas.fundo, marcaDaSala(infoRef.current)).catch(() => undefined)
            : undefined;
        await Promise.allSettled([
          room.localParticipant.setMicrophoneEnabled(escolhas.microfone),
          room.localParticipant.setCameraEnabled(escolhas.camera, processor ? { processor } : undefined),
        ]);
      })
      .catch((erro: Error) => {
        if (vivo)
          saida.current(
            'erro',
            /permission|notallowed/i.test(erro.message)
              ? 'O navegador bloqueou a conexão. Recarregue a página e tente de novo.'
              : 'Não deu para conectar na sala. Confira a internet e tente de novo.',
          );
      });
    return () => {
      vivo = false;
      room.off(RoomEvent.Disconnected, aoDesconectar);
      void room.disconnect();
    };
  }, [room, acesso.url, acesso.token, escolhas]);

  return (
    <RoomContext.Provider value={room}>
      <div className="sala" data-theme="dark">
        <RoomAudioRenderer />
        <ConteudoSala {...props} room={room} conectado={conectado} />
      </div>
    </RoomContext.Provider>
  );
}

export function Cronometro(props: { desde: number }) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((agora - props.desde) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const dois = (n: number) => String(n).padStart(2, '0');
  return <span className="mono">{h ? `${h}:${dois(m)}:${dois(s % 60)}` : `${dois(m)}:${dois(s % 60)}`}</span>;
}

/** Quem aparece em destaque no celular (ou no modo "destaque"): quem falou por último, sem ser você. */
function useEmDestaque(pessoas: Participant[], fixado: string | null): Participant | undefined {
  const falando = useSpeakingParticipants();
  const ultimo = useRef<string | null>(null);
  const outro = falando.find((p) => !p.isLocal);
  if (outro) ultimo.current = outro.identity;
  const achar = (id: string | null) => (id ? pessoas.find((p) => p.identity === id) : undefined);
  return achar(fixado) ?? achar(ultimo.current) ?? pessoas.find((p) => !p.isLocal) ?? pessoas[0];
}

function ConteudoSala(props: {
  info: InfoSala;
  acesso: Liberado;
  escolhas: Escolhas;
  room: Room;
  conectado: boolean;
}) {
  const { info, acesso, room } = props;
  const [celular] = useState(ehCelular);
  const [frente, setFrente] = useState(props.escolhas.frente);
  const [sons, setSons] = useState(sonsLigados);
  const doTime = acesso.papel !== 'convidado';
  const pequena = useTelaPequena();
  const estado = useConnectionState();
  const naNuvem = useIsRecording();
  const estadoGravador = useEstadoGravador();
  const gravandoAqui = estadoGravador.fase === 'gravando';
  const { canPlayAudio, startAudio } = useAudioPlayback();
  const local = useLocalParticipant();
  const { quality } = useConnectionQualityIndicator({ participant: local.localParticipant });
  const pessoas = useParticipants();
  // Gravando: pelo servidor (LiveKit) ou pelo navegador de alguém do time (que avisa por um atributo).
  const gravando = naNuvem || gravandoAqui || pessoas.some((p) => p.attributes.gravando === '1');
  const cameras = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], {
    onlySubscribed: false,
  });
  const telas = useTracks([Track.Source.ScreenShare], { onlySubscribed: false });
  const [inicio] = useState(() => Date.now());
  const [painel, setPainel] = useState<'chat' | 'pessoas' | 'fundo' | null>(null);
  // Fundo da câmera (o escolhido na antessala; dá para trocar no botão Fundo).
  const [comFundos] = useState(suportaFundos);
  const [fundo, setFundo] = useState(props.escolhas.fundo || 'nenhum');
  const [erroFundo, setErroFundo] = useState<string | null>(null);
  const pessoais = useFundosPessoais(!!info.voce);
  const marcaFundo = useMemo(
    () => ({ ...marcaDaSala(info), pessoais: pessoais.lista.map((p) => ({ id: p.id, url: p.url })) }),
    [info, pessoais.lista],
  );
  const opcoesFundo = useMemo(
    () => opcoesDeFundo(info.fundos, !!info.fundos, pessoais.lista),
    [info.fundos, pessoais.lista],
  );
  const fundoTravado = !!info.fundos?.config.travar && opcoesFundo.length === 1;
  useEffect(() => {
    if (!comFundos) return;
    const lp = room.localParticipant;
    const aplicar = () => {
      const faixa = lp.getTrackPublication(Track.Source.Camera)?.track as LocalVideoTrack | undefined;
      if (!faixa) return;
      aplicarFundo(faixa, fundo, marcaFundo).catch(() => {
        setErroFundo('Não deu para usar o fundo neste aparelho. A câmera segue sem efeito.');
        setFundo('nenhum');
      });
    };
    aplicar();
    lp.on(ParticipantEvent.LocalTrackPublished, aplicar);
    lp.on(ParticipantEvent.TrackUnmuted, aplicar);
    return () => {
      lp.off(ParticipantEvent.LocalTrackPublished, aplicar);
      lp.off(ParticipantEvent.TrackUnmuted, aplicar);
    };
  }, [room, fundo, marcaFundo, comFundos]);
  useEffect(() => () => esquecerFundo(), []);
  const [menu, setMenu] = useState<'opcoes' | 'sair' | null>(null);
  const [modo, setModo] = useState<'grade' | 'destaque'>('grade');
  const [fixado, setFixado] = useState<string | null>(null);
  // Quem apresenta não vê a própria tela (evita o efeito "tela dentro da tela"), a não ser que peça.
  const [verMinhaTela, setVerMinhaTela] = useState(false);

  // Gravação pelo navegador: começa assim que conecta (a aba foi liberada no clique de entrar).
  const captura = props.escolhas.captura;
  const cfgGravacao = useMemo(
    () => ({ codigo: info.codigo, credencial: acesso.credencial, transcrever: acesso.transcrever }),
    [info.codigo, acesso.credencial, acesso.transcrever],
  );
  useEffect(() => {
    if (props.conectado && captura && acesso.gravacao === 'navegador')
      gravador.iniciar(room, captura, cfgGravacao);
  }, [props.conectado, captura, acesso.gravacao, room, cfgGravacao]);
  const gravarAgora = async () => {
    const c = await pedirCapturaDaAba();
    if (c) gravador.iniciar(room, c, cfgGravacao);
  };
  const apresentando = local.isScreenShareEnabled;
  useEffect(() => {
    if (!apresentando) setVerMinhaTela(false);
  }, [apresentando]);
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [mensagens, setMensagens] = useState<MensagemChat[]>([]);
  const [naoLidas, setNaoLidas] = useState(0);
  const [versaoEspera, setVersaoEspera] = useState(0);
  const [esperando, setEsperando] = useState(0);
  const painelRef = useRef(painel);
  painelRef.current = painel;

  const avisar = useCallback((a: Omit<Aviso, 'id'>, ms = 6000, som?: Som) => {
    const id = Date.now() + Math.random();
    setAvisos((x) => [...x.slice(-2), { ...a, id }]);
    setTimeout(() => setAvisos((x) => x.filter((y) => y.id !== id)), ms);
    if (som) tocar(som);
    avisarNaAba(a.texto);
  }, []);

  // O navegador só toca som depois de um toque na página: o primeiro toque libera.
  useEffect(() => {
    const liberar = () => destravarSons();
    window.addEventListener('pointerdown', liberar);
    window.addEventListener('keydown', liberar);
    return () => {
      window.removeEventListener('pointerdown', liberar);
      window.removeEventListener('keydown', liberar);
    };
  }, []);

  // Quem entrou e quem saiu (aviso na tela e som). Os que já estavam quando você entrou não contam.
  const conectadoEm = useRef(0);
  if (props.conectado && !conectadoEm.current) conectadoEm.current = Date.now();
  useEffect(() => {
    const recente = () => !conectadoEm.current || Date.now() - conectadoEm.current < 2500;
    const entrou = (p: RemoteParticipant) => {
      if (recente()) return;
      avisar({ texto: `${nomeDe(p)} entrou na reunião`, icone: 'user-plus' }, 5000, 'entrou');
    };
    const saiu = (p: RemoteParticipant) => {
      avisar({ texto: `${nomeDe(p)} saiu da reunião`, icone: 'log-out' }, 5000, 'saiu');
    };
    room.on(RoomEvent.ParticipantConnected, entrou);
    room.on(RoomEvent.ParticipantDisconnected, saiu);
    return () => {
      room.off(RoomEvent.ParticipantConnected, entrou);
      room.off(RoomEvent.ParticipantDisconnected, saiu);
    };
  }, [room, avisar]);

  const juntar = useCallback((m: MensagemChat) => {
    setMensagens((x) => (x.some((y) => y.id === m.id) ? x : [...x, m].sort((a, b) => a.id - b.id)));
  }, []);

  // O que já foi mandado no chat (quem entra no meio vê).
  useEffect(() => {
    apiSala<MensagemChat[]>(`/${info.codigo}/mensagens`, { credencial: acesso.credencial })
      .then((lista) => {
        for (const m of lista) juntar(m);
      })
      .catch(() => undefined);
  }, [info.codigo, acesso.credencial, juntar]);

  // Avisos da api pela sala: mensagem nova no chat, alguém na sala de espera.
  useEffect(() => {
    const aoReceber = (dados: Uint8Array, _p?: RemoteParticipant, _k?: unknown, topico?: string) => {
      let msg: { tipo?: string; mensagem?: MensagemChat; nome?: string };
      try {
        msg = JSON.parse(decodificar.decode(dados));
      } catch {
        return;
      }
      if (topico === 'chat' && msg.mensagem) {
        juntar(msg.mensagem);
        if (painelRef.current !== 'chat' && msg.mensagem.participanteId !== acesso.participanteId) {
          setNaoLidas((n) => n + 1);
          avisar(
            {
              texto: `${msg.mensagem.autor}: ${msg.mensagem.texto ?? msg.mensagem.arquivo?.nome ?? ''}`.slice(
                0,
                120,
              ),
              icone: 'message-circle',
              acao: { rotulo: 'Abrir chat', fazer: () => setPainel('chat') },
            },
            6000,
            'mensagem',
          );
        }
      }
      if (topico === 'sala' && msg.tipo === 'espera') {
        setVersaoEspera((v) => v + 1);
        if (doTime && msg.nome) {
          setEsperando((n) => n + 1);
          avisar(
            {
              texto: `${msg.nome} quer entrar na reunião`,
              icone: 'user-plus',
              tom: 'atencao',
              acao: { rotulo: 'Ver', fazer: () => setPainel('pessoas') },
            },
            15_000,
            'espera',
          );
        }
      }
    };
    room.on(RoomEvent.DataReceived, aoReceber);
    return () => {
      room.off(RoomEvent.DataReceived, aoReceber);
    };
  }, [room, juntar, avisar, doTime, acesso.participanteId]);

  // Mão levantada de outra pessoa: aviso em destaque, com som (e o título da aba pisca se estiver em outra).
  useEffect(() => {
    const aoMudar = (mudou: Record<string, string>, p: Participant) => {
      if ('mao' in mudou && mudou.mao && !p.isLocal)
        avisar(
          {
            texto: `${nomeDe(p)} levantou a mão`,
            icone: 'hand',
            tom: 'atencao',
            acao: { rotulo: 'Ver a fila', fazer: () => setPainel('pessoas') },
          },
          10_000,
          'mao',
        );
    };
    room.on(RoomEvent.ParticipantAttributesChanged, aoMudar);
    return () => {
      room.off(RoomEvent.ParticipantAttributesChanged, aoMudar);
    };
  }, [room, avisar]);

  useEffect(() => {
    if (painel === 'chat') setNaoLidas(0);
    if (painel === 'pessoas') setEsperando(0);
  }, [painel]);

  const lp = local.localParticipant;
  const minhaMao = !!lp.attributes.mao;
  const podeTela = !pequena && !!navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices;

  const falhou = useCallback(
    (o: string) => (erro: Error) =>
      avisar({
        tom: 'atencao',
        texto: /permission|notallowed/i.test(`${erro.name} ${erro.message}`)
          ? `O navegador bloqueou ${o}. Toque no cadeado ao lado do endereço e permita.`
          : `Não deu para ligar ${o}.`,
      }),
    [avisar],
  );
  const alternarMic = useCallback(
    () => void lp.setMicrophoneEnabled(!lp.isMicrophoneEnabled).catch(falhou('o microfone')),
    [lp, falhou],
  );
  const alternarCam = useCallback(
    () => void lp.setCameraEnabled(!lp.isCameraEnabled).catch(falhou('a câmera')),
    [lp, falhou],
  );
  // Celular: troca entre a câmera da frente e a de trás sem desligar o vídeo.
  const virarCamera = () => {
    const faixa = lp.getTrackPublication(Track.Source.Camera)?.track as LocalVideoTrack | undefined;
    if (!faixa) return;
    const nova = frente === 'user' ? 'environment' : 'user';
    faixa
      .restartTrack({ facingMode: nova, resolution: VideoPresets.h720.resolution })
      .then(() => {
        setFrente(nova);
        // Desligar e ligar a câmera depois continua na mesma.
        room.options.videoCaptureDefaults = {
          ...room.options.videoCaptureDefaults,
          facingMode: nova,
          deviceId: undefined,
        };
      })
      .catch(falhou('a outra câmera'));
  };
  const alternarTela = () => {
    const cancelou = (e: Error) => {
      // Cancelar a escolha da janela não é erro.
      if (!/notallowed|aborted|cancel/i.test(`${e.name} ${e.message}`)) falhou('o compartilhamento')(e);
    };
    if (lp.isScreenShareEnabled || !gravandoAqui) {
      void lp
        .setScreenShareEnabled(!lp.isScreenShareEnabled, {
          audio: true,
          contentHint: 'detail',
          resolution: ScreenSharePresets.h1080fps30.resolution,
          selfBrowserSurface: 'exclude',
          surfaceSwitching: 'include',
        })
        .catch(cancelou);
      return;
    }
    // Gravando por esta aba: só janela ou outra aba. A tela inteira mostraria a própria reunião
    // dentro dela, e a gravação sairia com uma tela dentro da outra.
    void navigator.mediaDevices
      .getDisplayMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 } },
        audio: true,
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include',
        monitorTypeSurfaces: 'exclude',
        systemAudio: 'exclude',
      } as DisplayMediaStreamOptions)
      .then(async (s) => {
        const [video] = s.getVideoTracks();
        if (!video) return;
        video.contentHint = 'detail';
        await lp.publishTrack(video, { source: Track.Source.ScreenShare });
        const [som] = s.getAudioTracks();
        if (som) await lp.publishTrack(som, { source: Track.Source.ScreenShareAudio });
      })
      .catch(cancelou);
  };
  const alternarMao = () => void lp.setAttributes({ mao: minhaMao ? '' : String(Date.now()) });

  // Atalhos como no Meet: Ctrl+D microfone, Ctrl+E câmera.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const alvo = e.target as HTMLElement | null;
      if (alvo && /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName)) return;
      if (e.key.toLowerCase() === 'd') {
        e.preventDefault();
        alternarMic();
      } else if (e.key.toLowerCase() === 'e') {
        e.preventDefault();
        alternarCam();
      }
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [alternarMic, alternarCam]);

  const sair = () => void room.disconnect();
  const encerrar = () => {
    setMenu(null);
    apiSala(`/${info.codigo}/encerrar`, { metodo: 'POST', corpo: {}, credencial: acesso.credencial }).catch(
      () => avisar({ tom: 'atencao', texto: 'Não deu para encerrar agora. Tente de novo.' }),
    );
  };
  const copiarLink = () =>
    void navigator.clipboard?.writeText(linkDaSala(info.codigo)).then(
      () => avisar({ texto: 'Link do convite copiado.' }),
      () => undefined,
    );

  const tela = telas[0];
  // Tela compartilhada de outra pessoa: o navegador mostra cada quadro assim que chega (sem segurar
  // no buffer). Mouse e rolagem aparecem com menos atraso; a câmera e o som seguem como estão.
  useEffect(() => {
    for (const t of telas) {
      const faixa = t.publication?.track;
      if (!t.participant.isLocal && faixa && faixa.kind === Track.Kind.Video && 'setPlayoutDelay' in faixa)
        (faixa as RemoteVideoTrack).setPlayoutDelay(0);
    }
  }, [telas]);
  const emDestaque = useEmDestaque(pessoas, fixado);
  const maos = maosLevantadas(pessoas).length;

  /* ── Palco ── */
  let palco: React.ReactNode;
  if (tela) {
    const meu = tela.participant.isLocal;
    palco = (
      <>
        {meu && (
          <div className="faixa-tela">
            <Icon name="monitor-up" size={18} />
            <span>
              Você está mostrando a sua tela. Todos veem{gravando ? ' e a gravação inclui a tela' : ''}.
              {gravandoAqui &&
                ' Enquanto grava, dá para mostrar uma janela ou outra aba (a tela inteira repetiria a reunião dentro dela).'}
            </span>
            <Button size="sm" onClick={alternarTela}>
              Parar de compartilhar
            </Button>
          </div>
        )}
        <div className="destaque-tela">
          {meu && !verMinhaTela && !gravandoAqui ? (
            <div className="apresentando">
              <Icon name="monitor-up" size={40} />
              <b>Você está apresentando para todos</b>
              <span>
                Sua tela fica escondida aqui para não aparecer uma tela dentro da outra. Os outros veem
                normalmente.
              </span>
              <div className="acoes">
                <Button size="sm" variant="ghost" onClick={() => setVerMinhaTela(true)}>
                  Ver mesmo assim
                </Button>
                <Button size="sm" onClick={alternarTela}>
                  Parar de apresentar
                </Button>
              </div>
            </div>
          ) : (
            <Ladrilho trackRef={tela} className="ladrilho--tela" />
          )}
        </div>
        {pequena ? (
          <Fichas pessoas={pessoas} fixado={fixado} aoFixar={setFixado} />
        ) : (
          <div className="fita">
            {cameras.map((t) => (
              <Ladrilho key={`${t.participant.identity}-${t.source}`} trackRef={t} mini />
            ))}
          </div>
        )}
      </>
    );
  } else if ((pequena || modo === 'destaque') && pessoas.length > 1 && emDestaque) {
    const principal = cameras.find((t) => t.participant.identity === emDestaque.identity);
    const meu = cameras.find((t) => t.participant.isLocal);
    palco = (
      <>
        <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'grid' }}>
          {principal && <Ladrilho trackRef={principal} />}
          {meu && !emDestaque.isLocal && <Ladrilho trackRef={meu} className="mini-voce" mini preencher />}
        </div>
        <Fichas pessoas={pessoas.filter((p) => !p.isLocal)} fixado={fixado} aoFixar={setFixado} />
      </>
    );
  } else {
    const mostrados = cameras.slice(0, 16);
    palco = (
      <GradeEncaixada quantos={mostrados.length}>
        {mostrados.map((t: TrackReferenceOrPlaceholder) => (
          <Ladrilho key={`${t.participant.identity}-${t.source}`} trackRef={t} />
        ))}
      </GradeEncaixada>
    );
  }

  return (
    <>
      <header className="sala__topo">
        {gravando && (
          <span className="sala__gravando" title="A reunião está sendo gravada">
            <span className="ponto-gravando" aria-hidden="true" />
            {pequena ? 'Gravando' : info.transcrever ? 'Gravando e transcrevendo' : 'Gravando'}
            <Cronometro desde={inicio} />
          </span>
        )}
        <div className="sala__titulo">
          <b>{info.titulo}</b>
          <span>
            {info.empresa.nome}
            {!gravando && (
              <>
                {' · '}
                <Cronometro desde={inicio} />
              </>
            )}
          </span>
        </div>
        <span className="sala__espaco" />
        {doTime && !pequena && (
          <Button size="sm" variant="ghost" icon="copy" onClick={copiarLink}>
            Copiar link do convite
          </Button>
        )}
      </header>

      {doTime && acesso.gravacao === 'navegador' && !gravando && (
        <div className="faixa-gravar" role="status">
          <span className="ponto-gravando ponto-gravando--parado" aria-hidden="true" />
          <span>
            {estadoGravador.aviso ??
              (podeGravarAba()
                ? 'Esta reunião é gravada, mas a gravação não está ligada.'
                : 'Esta reunião é gravada, mas só dá para gravar pelo computador, no Chrome ou no Edge.')}
          </span>
          {podeGravarAba() && (
            <Button size="sm" variant="primary" icon="radio" onClick={() => void gravarAgora()}>
              Gravar esta reunião
            </Button>
          )}
        </div>
      )}

      <div className="sala__corpo">
        <main className="sala__palco" aria-label="Vídeos da reunião">
          {props.conectado ? palco : <p className="quieto">Conectando…</p>}
        </main>
        {painel && (
          <aside
            className="painel-sala"
            aria-label={painel === 'chat' ? 'Chat' : painel === 'fundo' ? 'Fundo' : 'Pessoas'}
          >
            {painel === 'fundo' ? (
              <>
                <div className="painel-sala__topo">
                  <b className="painel-sala__titulo">Fundo</b>
                  <span className="sala__espaco" />
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="x"
                    aria-label="Fechar painel"
                    onClick={() => setPainel(null)}
                  />
                </div>
                <div className="painel-fundo">
                  {fundoTravado ? (
                    <p className="quieto painel-fundo__nota">
                      {info.empresa.nome} definiu o fundo das reuniões para o time.
                    </p>
                  ) : (
                    <GradeDeFundos
                      opcoes={opcoesFundo}
                      escolhido={fundo}
                      m={marcaFundo}
                      padrao={info.fundos?.config.padrao ?? null}
                      empresa={info.empresa.nome}
                      agrupar
                      desligado={!local.isCameraEnabled}
                      aoEscolher={(id) => {
                        setErroFundo(null);
                        setFundo(id);
                        lembrarFundo(id, !!info.voce);
                      }}
                      pessoais={
                        opcoesFundo.some((o) => o.id === 'desfoque-leve')
                          ? {
                              podeEnviar: pessoais.podeEnviar,
                              enviando: pessoais.enviando,
                              erro: pessoais.erro,
                              aoEnviar: async (f) => {
                                const id = await pessoais.enviar(f);
                                if (id) {
                                  setFundo(id);
                                  lembrarFundo(id, !!info.voce);
                                }
                              },
                              aoTirar: (id) => {
                                if (fundo === id) setFundo('nenhum');
                                pessoais.tirar(id);
                              },
                            }
                          : undefined
                      }
                    />
                  )}
                  {!local.isCameraEnabled && (
                    <p className="quieto painel-fundo__nota">Ligue a câmera para trocar o fundo.</p>
                  )}
                  {erroFundo && <p className="painel-fundo__nota painel-fundo__erro">{erroFundo}</p>}
                  <p className="quieto painel-fundo__nota">
                    Quem está na reunião vê o fundo escolhido, e a gravação também. Com a logo no fundo, você
                    vê a sua imagem sem o espelho, do jeito que os outros veem.
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="painel-sala__topo" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    className="aba-sala"
                    aria-selected={painel === 'chat'}
                    onClick={() => setPainel('chat')}
                  >
                    Chat
                  </button>
                  <button
                    type="button"
                    role="tab"
                    className="aba-sala"
                    aria-selected={painel === 'pessoas'}
                    onClick={() => setPainel('pessoas')}
                  >
                    Pessoas ({pessoas.length})
                  </button>
                  <span className="sala__espaco" />
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="x"
                    aria-label="Fechar painel"
                    onClick={() => setPainel(null)}
                  />
                </div>
                {painel === 'chat' ? (
                  <PainelChat
                    codigo={info.codigo}
                    credencial={acesso.credencial}
                    participanteId={acesso.participanteId}
                    mensagens={mensagens}
                    aoEnviar={juntar}
                  />
                ) : (
                  <PainelPessoas
                    codigo={info.codigo}
                    credencial={acesso.credencial}
                    doTime={doTime}
                    versaoEspera={versaoEspera}
                  />
                )}
              </>
            )}
          </aside>
        )}
      </div>

      <footer className="sala__rodape">
        <div className="sala__lado">
          <span className="mono" style={{ color: 'var(--ink)' }}>
            {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </span>
          <span aria-hidden="true">·</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {info.titulo}
          </span>
        </div>
        <div className="sala__controles" role="toolbar" aria-label="Controles da reunião">
          <button
            type="button"
            className="ctl"
            data-desligado={!local.isMicrophoneEnabled || undefined}
            aria-pressed={!local.isMicrophoneEnabled}
            aria-label={local.isMicrophoneEnabled ? 'Desligar o microfone' : 'Ligar o microfone'}
            title={`${local.isMicrophoneEnabled ? 'Desligar' : 'Ligar'} o microfone (Ctrl+D)`}
            onClick={alternarMic}
          >
            <Icon name={local.isMicrophoneEnabled ? 'mic' : 'mic-off'} size={22} />
          </button>
          <button
            type="button"
            className="ctl"
            data-desligado={!local.isCameraEnabled || undefined}
            aria-pressed={!local.isCameraEnabled}
            aria-label={local.isCameraEnabled ? 'Desligar a câmera' : 'Ligar a câmera'}
            title={`${local.isCameraEnabled ? 'Desligar' : 'Ligar'} a câmera (Ctrl+E)`}
            onClick={alternarCam}
          >
            <Icon name={local.isCameraEnabled ? 'video' : 'video-off'} size={22} />
          </button>
          {comFundos && local.isCameraEnabled && (
            <button
              type="button"
              className="ctl"
              data-ligado={painel === 'fundo' || undefined}
              aria-pressed={painel === 'fundo'}
              aria-label="Fundo da câmera"
              title="Fundo da câmera (desfoque, cenários)"
              onClick={() => setPainel(painel === 'fundo' ? null : 'fundo')}
            >
              <Icon name="sparkles" size={22} />
            </button>
          )}
          {celular && local.isCameraEnabled && (
            <button
              type="button"
              className="ctl"
              aria-label={frente === 'user' ? 'Usar a câmera de trás' : 'Usar a câmera da frente'}
              title={frente === 'user' ? 'Usar a câmera de trás' : 'Usar a câmera da frente'}
              onClick={virarCamera}
            >
              <Icon name="switch-camera" size={22} />
            </button>
          )}
          {podeTela && (
            <button
              type="button"
              className="ctl"
              data-ligado={local.isScreenShareEnabled || undefined}
              aria-pressed={local.isScreenShareEnabled}
              aria-label={local.isScreenShareEnabled ? 'Parar de compartilhar a tela' : 'Compartilhar a tela'}
              title={local.isScreenShareEnabled ? 'Parar de compartilhar a tela' : 'Compartilhar a tela'}
              onClick={alternarTela}
            >
              <Icon name={local.isScreenShareEnabled ? 'monitor-off' : 'monitor-up'} size={22} />
            </button>
          )}
          <button
            type="button"
            className="ctl"
            data-mao={minhaMao || undefined}
            aria-pressed={minhaMao}
            aria-label={minhaMao ? 'Baixar a mão' : 'Levantar a mão'}
            title={minhaMao ? 'Baixar a mão' : 'Levantar a mão'}
            onClick={alternarMao}
          >
            <Icon name="hand" size={22} />
          </button>
          {pequena && (
            <button
              type="button"
              className="ctl"
              aria-label={`Chat${naoLidas ? `, ${naoLidas} mensagens novas` : ''}`}
              title="Chat"
              onClick={() => setPainel(painel === 'chat' ? null : 'chat')}
            >
              <Icon name="message-circle" size={22} />
              {naoLidas > 0 && <span className="selo">{naoLidas}</span>}
            </button>
          )}
          <button
            type="button"
            className="ctl"
            aria-label="Mais opções"
            aria-expanded={menu === 'opcoes'}
            title="Mais opções"
            onClick={() => setMenu(menu === 'opcoes' ? null : 'opcoes')}
          >
            <Icon name="ellipsis" size={22} />
            {pequena && (esperando > 0 || maos > 0) && <span className="selo selo--ponto" />}
          </button>
          <button
            type="button"
            className="ctl ctl--sair"
            aria-label={doTime ? 'Sair ou encerrar a reunião' : 'Sair da reunião'}
            title="Sair"
            onClick={() => (doTime ? setMenu(menu === 'sair' ? null : 'sair') : sair())}
          >
            <Icon name="phone-off" size={20} />
            <span className="rotulo-sair">Sair</span>
          </button>
        </div>
        <div className="sala__lado sala__lado--fim">
          <button
            type="button"
            className="ico"
            data-ativo={painel === 'chat' || undefined}
            aria-label={`Chat${naoLidas ? `, ${naoLidas} mensagens novas` : ''}`}
            title="Chat"
            onClick={() => setPainel(painel === 'chat' ? null : 'chat')}
          >
            <Icon name="message-circle" size={22} />
            {naoLidas > 0 && <span className="selo">{naoLidas}</span>}
          </button>
          <button
            type="button"
            className="ico"
            data-ativo={painel === 'pessoas' || undefined}
            aria-label={`Pessoas na sala, ${pessoas.length}${esperando ? `, ${esperando} esperando para entrar` : ''}`}
            title="Pessoas"
            onClick={() => setPainel(painel === 'pessoas' ? null : 'pessoas')}
          >
            <Icon name="users" size={22} />
            {(esperando > 0 || maos > 0) && <span className="selo selo--ponto" />}
          </button>
        </div>
      </footer>

      {menu === 'opcoes' && (
        <MenuOpcoes
          room={room}
          pequena={pequena}
          celular={celular}
          sons={sons}
          aoSons={(x) => {
            setSons(x);
            guardarSons(x);
            if (x) tocar('entrou');
          }}
          doTime={doTime}
          modo={modo}
          aoModo={(m) => {
            setModo(m);
            setFixado(null);
            setMenu(null);
          }}
          aoPessoas={() => {
            setPainel('pessoas');
            setMenu(null);
          }}
          aoCopiar={() => {
            copiarLink();
            setMenu(null);
          }}
          aoFechar={() => setMenu(null)}
        />
      )}
      {menu === 'sair' && (
        <div className="menu-sala" role="menu" aria-label="Sair da reunião">
          <button type="button" role="menuitem" className="menu-sala__item" onClick={sair}>
            <Icon name="log-out" size={18} />
            Sair da reunião (ela continua para os outros)
          </button>
          <button type="button" role="menuitem" className="menu-sala__item" data-perigo onClick={encerrar}>
            <Icon name="phone-off" size={18} />
            Encerrar para todos
          </button>
          <button type="button" role="menuitem" className="menu-sala__item" onClick={() => setMenu(null)}>
            <Icon name="x" size={18} />
            Cancelar
          </button>
        </div>
      )}

      <div className="avisos-sala" aria-live="polite">
        {quality === ConnectionQuality.Poor && estado === ConnectionState.Connected && (
          <div className="aviso-flutuante" data-tom="atencao">
            <Icon name="wifi-off" size={18} />
            <span>Sua internet está instável. Desligar a câmera ajuda o som a não cortar.</span>
          </div>
        )}
        {!canPlayAudio && (
          <div className="aviso-flutuante" data-tom="atencao">
            <Icon name="volume-x" size={18} />
            <span>O navegador pausou o som da reunião.</span>
            <Button size="sm" onClick={() => void startAudio()}>
              Ativar o som
            </Button>
          </div>
        )}
        {avisos.map((a) => (
          <div key={a.id} className="aviso-flutuante" data-tom={a.tom}>
            {a.icone && <Icon name={a.icone} size={18} />}
            <span>{a.texto}</span>
            {a.acao && (
              <Button size="sm" variant={a.tom ? 'secondary' : 'ghost'} onClick={a.acao.fazer}>
                {a.acao.rotulo}
              </Button>
            )}
          </div>
        ))}
      </div>

      {estado === ConnectionState.Reconnecting || estado === ConnectionState.SignalReconnecting ? (
        <div className="cobertura" role="alert">
          <div className="cobertura__caixa">
            <Icon name="loader" spin size={28} />
            <h2>Reconectando…</h2>
            <p>A internet oscilou. Você volta sozinho para a reunião em instantes.</p>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** No celular (e no modo destaque): os outros participantes em fichas; tocar fixa a pessoa. */
function Fichas(props: {
  pessoas: Participant[];
  fixado: string | null;
  aoFixar: (id: string | null) => void;
}) {
  if (!props.pessoas.length) return null;
  return (
    <ul className="fichas" aria-label="Quem está na reunião">
      {props.pessoas.map((p) => (
        <li key={p.identity}>
          <button
            type="button"
            className="ficha-pessoa"
            data-ativo={props.fixado === p.identity || undefined}
            aria-pressed={props.fixado === p.identity}
            onClick={() => props.aoFixar(props.fixado === p.identity ? null : p.identity)}
          >
            <Avatar nome={nomeDe(p)} size={24} />
            {nomeDe(p).split(' ')[0]}
            {p.isLocal ? ' (você)' : ''}
          </button>
        </li>
      ))}
    </ul>
  );
}

function SeletorAparelho(props: { room: Room; tipo: MediaDeviceKind; rotulo: string }) {
  const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({
    kind: props.tipo,
    room: props.room,
  });
  if (!devices.length) return null;
  return (
    <label>
      {props.rotulo}
      <select value={activeDeviceId} onChange={(e) => void setActiveMediaDevice(e.target.value)}>
        {devices.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId}>
            {d.label || `${props.rotulo} ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}

function MenuOpcoes(props: {
  room: Room;
  pequena: boolean;
  celular: boolean;
  sons: boolean;
  aoSons: (ligados: boolean) => void;
  doTime: boolean;
  modo: 'grade' | 'destaque';
  aoModo: (m: 'grade' | 'destaque') => void;
  aoPessoas: () => void;
  aoCopiar: () => void;
  aoFechar: () => void;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    caixa.current?.querySelector<HTMLElement>('select, button')?.focus();
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.aoFechar();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [props.aoFechar]);
  const telaCheia = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
    props.aoFechar();
  };
  return (
    <div ref={caixa} className="menu-sala" role="dialog" aria-label="Mais opções">
      {!props.celular && (
        <>
          <SeletorAparelho room={props.room} tipo="audioinput" rotulo="Microfone" />
          <SeletorAparelho room={props.room} tipo="videoinput" rotulo="Câmera" />
          <SeletorAparelho room={props.room} tipo="audiooutput" rotulo="Alto-falante" />
          <hr />
        </>
      )}
      <button
        type="button"
        className="menu-sala__item"
        aria-pressed={props.sons}
        onClick={() => props.aoSons(!props.sons)}
      >
        <Icon name={props.sons ? 'volume-2' : 'volume-x'} size={18} />
        {props.sons
          ? 'Sons de aviso ligados (toque para desligar)'
          : 'Sons de aviso desligados (toque para ligar)'}
      </button>
      {props.pequena && (
        <button type="button" className="menu-sala__item" onClick={props.aoPessoas}>
          <Icon name="users" size={18} />
          Pessoas e mãos levantadas
        </button>
      )}
      {!props.pequena && (
        <button
          type="button"
          className="menu-sala__item"
          onClick={() => props.aoModo(props.modo === 'grade' ? 'destaque' : 'grade')}
        >
          <Icon name={props.modo === 'grade' ? 'maximize-2' : 'layout-grid'} size={18} />
          {props.modo === 'grade' ? 'Mostrar quem fala em destaque' : 'Mostrar todos em grade'}
        </button>
      )}
      <button type="button" className="menu-sala__item" onClick={telaCheia}>
        <Icon name="maximize-2" size={18} />
        Tela cheia
      </button>
      {props.doTime && (
        <button type="button" className="menu-sala__item" onClick={props.aoCopiar}>
          <Icon name="link" size={18} />
          Copiar link do convite
        </button>
      )}
      <button type="button" className="menu-sala__item" onClick={props.aoFechar}>
        <Icon name="x" size={18} />
        Fechar
      </button>
    </div>
  );
}
