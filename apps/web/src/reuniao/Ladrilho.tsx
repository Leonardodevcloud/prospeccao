import {
  isTrackReference,
  type TrackReferenceOrPlaceholder,
  useConnectionQualityIndicator,
  useIsSpeaking,
  useParticipantAttributes,
  useTrackMutedIndicator,
  VideoTrack,
} from '@livekit/components-react';
import { Icon } from '@prospeccao/ui';
import { ConnectionQuality, type Participant, Track } from 'livekit-client';
import { iniciais } from '../formatar';

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
 * Uma pessoa na grade: o vídeo da câmera (ou as iniciais, com a câmera desligada), o nome, o
 * microfone desligado, a mão levantada, quem está falando (contorno) e a internet fraca.
 */
export function Ladrilho(props: {
  trackRef: TrackReferenceOrPlaceholder;
  className?: string;
  mini?: boolean;
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
  return (
    <div
      className={['ladrilho', props.className].filter(Boolean).join(' ')}
      data-falando={(falando && !tela) || undefined}
      data-video={comVideo || undefined}
      data-espelho={(p.isLocal && trackRef.source === Track.Source.Camera) || undefined}
    >
      {comVideo && isTrackReference(trackRef) ? (
        <VideoTrack trackRef={trackRef} style={tela ? { objectFit: 'contain' } : undefined} />
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
