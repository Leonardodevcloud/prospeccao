import {
  isTrackReference,
  type TrackReferenceOrPlaceholder,
  useConnectionQualityIndicator,
  useIsSpeaking,
  useParticipantAttributes,
  useTrackMutedIndicator,
  VideoTrack,
} from '@livekit/components-react';
import { encaixeDoVideo, gradeEncaixada } from '@prospeccao/shared/reunioes';
import { Icon } from '@prospeccao/ui';
import { ConnectionQuality, type Participant, Track } from 'livekit-client';
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { iniciais } from '../formatar';
import { fundoSemEspelho, useFundoAtual } from './fundos';

/** Nome de quem está na sala (o do time vem com "(você)" quando é a própria pessoa). */
export function nomeDe(p: Participant): string {
  return p.name || p.identity;
}

/** Barrinhas que mexem enquanto a pessoa fala. */
export function Falando() {
  return (
    <span className="barrinhas" role="img" aria-label="Falando">
      <span />
      <span />
      <span />
    </span>
  );
}

/**
 * Como o vídeo ocupa o quadro: preenche (cortando pouco) quando a proporção do vídeo e a do quadro
 * são parecidas; senão aparece inteiro. Recalcula quando o quadro muda de tamanho (janela,
 * grade) e quando o vídeo muda de formato (celular girado, outra câmera).
 */
function useEncaixe(
  caixa: RefObject<HTMLDivElement | null>,
  ativo: boolean,
  sempreInteiro: boolean,
  chave: string,
) {
  const [encaixe, setEncaixe] = useState<'cover' | 'contain'>('contain');
  // biome-ignore lint/correctness/useExhaustiveDependencies: a chave (faixa de vídeo) troca o elemento <video>
  useEffect(() => {
    const el = caixa.current;
    if (!el || !ativo) return;
    let video: HTMLVideoElement | null = null;
    const calcular = () => {
      setEncaixe(
        encaixeDoVideo(
          video?.videoWidth ? { largura: video.videoWidth, altura: video.videoHeight } : null,
          { largura: el.clientWidth, altura: el.clientHeight },
          sempreInteiro,
        ),
      );
    };
    const ligar = () => {
      const atual = el.querySelector('video');
      if (atual === video) return;
      video?.removeEventListener('resize', calcular);
      video?.removeEventListener('loadedmetadata', calcular);
      video = atual;
      video?.addEventListener('resize', calcular);
      video?.addEventListener('loadedmetadata', calcular);
      calcular();
    };
    ligar();
    const tamanho = new ResizeObserver(calcular);
    tamanho.observe(el);
    const filhos = new MutationObserver(ligar);
    filhos.observe(el, { childList: true });
    return () => {
      tamanho.disconnect();
      filhos.disconnect();
      video?.removeEventListener('resize', calcular);
      video?.removeEventListener('loadedmetadata', calcular);
    };
  }, [caixa, ativo, sempreInteiro, chave]);
  return encaixe;
}

/**
 * Grade que se encaixa no espaço (como no Meet): quadros em 16:9, do maior tamanho que cabe, no
 * centro. Com uma pessoa só, o quadro ocupa o espaço todo.
 */
export function GradeEncaixada(props: {
  quantos: number;
  children: ReactNode;
  vao?: number;
  className?: string;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const [tam, setTam] = useState({ largura: 0, altura: 0 });
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const medir = () => setTam({ largura: el.clientWidth, altura: el.clientHeight });
    medir();
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  const vao = props.vao ?? 12;
  const g = gradeEncaixada(props.quantos, tam, vao);
  const sozinho = props.quantos <= 1;
  return (
    <div ref={caixa} className={['grade-encaixada', props.className].filter(Boolean).join(' ')}>
      <div
        className="grade-encaixada__vidros"
        style={
          sozinho
            ? { gridTemplateColumns: '100%', gridAutoRows: '100%', width: '100%', height: '100%' }
            : {
                gridTemplateColumns: `repeat(${g.colunas}, ${g.largura}px)`,
                gridAutoRows: `${g.altura}px`,
                gap: vao,
              }
        }
      >
        {props.children}
      </div>
    </div>
  );
}

/**
 * Uma pessoa na grade: o vídeo da câmera (ou as iniciais, com a câmera desligada), o nome, o
 * microfone desligado, a mão levantada, quem está falando (contorno) e a internet fraca.
 */
export function Ladrilho(props: {
  trackRef: TrackReferenceOrPlaceholder;
  className?: string;
  mini?: boolean;
  /** Sempre preenche o quadro (a própria imagem no cantinho). */
  preencher?: boolean;
}) {
  const { trackRef } = props;
  const p = trackRef.participant;
  const falando = useIsSpeaking(p);
  const { attributes } = useParticipantAttributes({ participant: p });
  const mic = useTrackMutedIndicator({ participant: p, source: Track.Source.Microphone });
  const { quality } = useConnectionQualityIndicator({ participant: p });
  const pub = isTrackReference(trackRef) ? trackRef.publication : undefined;
  const comVideo = !!pub && !pub.isMuted && (p.isLocal || pub.isSubscribed);
  const nome = nomeDe(p);
  const mao = !!attributes?.mao;
  const tela = trackRef.source === Track.Source.ScreenShare;
  // A câmera de trás do celular não fica espelhada (o texto de um papel, por exemplo, sai legível).
  const traseira = pub?.track?.mediaStreamTrack?.getSettings?.().facingMode === 'environment';
  // Fundo com a logo: sem espelho (a logo aparece certa, como os outros veem).
  const semEspelho = fundoSemEspelho(useFundoAtual());
  const caixa = useRef<HTMLDivElement>(null);
  const encaixe = useEncaixe(caixa, comVideo, tela, pub?.trackSid ?? '');
  return (
    <div
      ref={caixa}
      className={['ladrilho', props.className].filter(Boolean).join(' ')}
      data-falando={(falando && !tela) || undefined}
      data-video={comVideo || undefined}
      data-espelho={
        (p.isLocal && trackRef.source === Track.Source.Camera && !traseira && !semEspelho) || undefined
      }
    >
      {comVideo && isTrackReference(trackRef) ? (
        <VideoTrack trackRef={trackRef} style={{ objectFit: props.preencher ? 'cover' : encaixe }} />
      ) : (
        <span className="ladrilho__avatar" aria-hidden="true">
          {iniciais(nome)}
        </span>
      )}
      {mao && !props.mini && (
        <span className="ladrilho__mao">
          <Icon name="hand" size={14} />
          Mão levantada
        </span>
      )}
      {quality === ConnectionQuality.Poor && !props.mini && (
        <span className="ladrilho__sinal" title="Internet fraca">
          <Icon name="wifi-off" size={14} label="Internet fraca" />
        </span>
      )}
      <span className="ladrilho__nome">
        {mic.isMuted && !tela && (
          <Icon name="mic-off" size={14} className="ladrilho__mudo" label="Microfone desligado" />
        )}
        {falando && !mic.isMuted && !tela && <Falando />}
        <span>
          {tela ? `Tela de ${nome}` : nome}
          {p.isLocal && !tela ? ' (você)' : ''}
        </span>
      </span>
    </div>
  );
}
