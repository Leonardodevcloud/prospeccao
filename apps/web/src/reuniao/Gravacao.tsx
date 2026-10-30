import {
  RoomAudioRenderer,
  RoomContext,
  useParticipants,
  useRoomInfo,
  useTracks,
} from '@livekit/components-react';
import { Avatar, Icon } from '@prospeccao/ui';
import { type Participant, type RemoteParticipant, Room, RoomEvent, Track } from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MensagemChat } from './api';
import { GradeEncaixada, Ladrilho, nomeDe } from './Ladrilho';
import { fmtTamanho } from './PainelChat';
import { maosLevantadas } from './PainelPessoas';
import { Cronometro } from './Sala';
import './reuniao.css';

/**
 * Página que a gravação filma (o LiveKit abre esta página num navegador dele e grava o que aparece).
 * É a visão de quem conduz a reunião, sem os botões: os vídeos em grade com nome e iniciais de quem
 * está sem câmera, quem está falando, mãos levantadas, a tela compartilhada em destaque, o chat ao
 * lado e os avisos de quem entrou e saiu.
 *
 * Protocolo do LiveKit: o endereço e o acesso chegam em ?url=&token=; a página escreve
 * START_RECORDING no console quando está pronta e END_RECORDING quando a reunião acaba.
 */

const decodificar = new TextDecoder();
const fmtHora = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

interface DadosSala {
  titulo?: string;
  empresa?: string;
}

interface Aviso {
  id: number;
  texto: string;
  icone: string;
  tom?: 'atencao';
}

export function PaginaGravacao() {
  const [room] = useState(
    () =>
      // Quem grava recebe todos os vídeos na qualidade máxima (sem economizar pelo tamanho na tela).
      new Room({ adaptiveStream: false, dynacast: false }),
  );
  const [estado, setEstado] = useState<'conectando' | 'na_sala' | 'erro'>('conectando');

  useEffect(() => {
    const busca = new URLSearchParams(location.search);
    const url = busca.get('url');
    const token = busca.get('token');
    if (!url || !token) {
      setEstado('erro');
      return;
    }
    const fim = () => console.log('END_RECORDING');
    room.on(RoomEvent.Disconnected, fim);
    room
      .connect(url, token)
      .then(() => {
        setEstado('na_sala');
        // Um instante para os vídeos aparecerem antes de começar a filmar.
        setTimeout(() => console.log('START_RECORDING'), 600);
      })
      .catch(() => setEstado('erro'));
    return () => {
      room.off(RoomEvent.Disconnected, fim);
      void room.disconnect();
    };
  }, [room]);

  if (estado === 'erro')
    return (
      <div className="sala" data-theme="dark" style={{ display: 'grid', placeItems: 'center' }}>
        <p className="quieto">Endereço da gravação incompleto.</p>
      </div>
    );
  return (
    <RoomContext.Provider value={room}>
      <div className="sala sala--gravacao" data-theme="dark">
        <RoomAudioRenderer />
        {estado === 'na_sala' && <TelaGravada room={room} />}
      </div>
    </RoomContext.Provider>
  );
}

function TelaGravada(props: { room: Room }) {
  const { room } = props;
  const info = useRoomInfo();
  let dados: DadosSala = {};
  try {
    dados = info.metadata ? (JSON.parse(info.metadata) as DadosSala) : {};
  } catch {
    dados = {};
  }
  const [inicio] = useState(() => Date.now());
  // Quem grava é um participante escondido: fica fora da grade e da lista.
  const pessoas = useParticipants().filter((p) => !p.isLocal);
  const cameras = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], {
    onlySubscribed: false,
  }).filter((t) => !t.participant.isLocal);
  const tela = useTracks([Track.Source.ScreenShare], { onlySubscribed: false }).find(
    (t) => !t.participant.isLocal,
  );
  const [mensagens, setMensagens] = useState<MensagemChat[]>([]);
  const [avisos, setAvisos] = useState<Aviso[]>([]);

  const avisar = useCallback((a: Omit<Aviso, 'id'>, ms = 5000) => {
    const id = Date.now() + Math.random();
    setAvisos((x) => [...x.slice(-2), { ...a, id }]);
    setTimeout(() => setAvisos((x) => x.filter((y) => y.id !== id)), ms);
  }, []);

  useEffect(() => {
    const aoReceber = (dados: Uint8Array, _p?: RemoteParticipant, _k?: unknown, topico?: string) => {
      if (topico !== 'chat') return;
      try {
        const msg = JSON.parse(decodificar.decode(dados)) as { mensagem?: MensagemChat };
        const m = msg.mensagem;
        if (m)
          setMensagens((x) => (x.some((y) => y.id === m.id) ? x : [...x, m].sort((a, b) => a.id - b.id)));
      } catch {
        // pacote que não é do chat
      }
    };
    const entrou = (p: RemoteParticipant) =>
      avisar({ texto: `${nomeDe(p)} entrou na reunião`, icone: 'user-plus' });
    const saiu = (p: RemoteParticipant) =>
      avisar({ texto: `${nomeDe(p)} saiu da reunião`, icone: 'log-out' });
    const mao = (mudou: Record<string, string>, p: Participant) => {
      if ('mao' in mudou && mudou.mao && !p.isLocal)
        avisar({ texto: `${nomeDe(p)} levantou a mão`, icone: 'hand', tom: 'atencao' }, 8000);
    };
    room.on(RoomEvent.DataReceived, aoReceber);
    room.on(RoomEvent.ParticipantConnected, entrou);
    room.on(RoomEvent.ParticipantDisconnected, saiu);
    room.on(RoomEvent.ParticipantAttributesChanged, mao);
    return () => {
      room.off(RoomEvent.DataReceived, aoReceber);
      room.off(RoomEvent.ParticipantConnected, entrou);
      room.off(RoomEvent.ParticipantDisconnected, saiu);
      room.off(RoomEvent.ParticipantAttributesChanged, mao);
    };
  }, [room, avisar]);

  // O chat fica sempre rolado para a última mensagem (como na tela de quem conduz).
  const fimChat = useRef<HTMLDivElement>(null);
  const total = mensagens.length;
  useEffect(() => {
    if (total) fimChat.current?.scrollIntoView({ block: 'end' });
  }, [total]);

  const maos = maosLevantadas(pessoas);
  const lateral = mensagens.length > 0 || maos.length > 0;

  let palco: React.ReactNode;
  if (tela) {
    palco = (
      <>
        <div className="destaque-tela">
          <Ladrilho trackRef={tela} className="ladrilho--tela" />
        </div>
        <div className="fita">
          {cameras.map((t) => (
            <Ladrilho key={`${t.participant.identity}-${t.source}`} trackRef={t} mini />
          ))}
        </div>
      </>
    );
  } else if (!cameras.length) {
    palco = (
      <div className="gravacao-vazia">
        <Icon name="users" size={32} />
        <span>Esperando as pessoas entrarem…</span>
      </div>
    );
  } else {
    palco = (
      <GradeEncaixada quantos={Math.min(cameras.length, 16)}>
        {cameras.slice(0, 16).map((t) => (
          <Ladrilho key={`${t.participant.identity}-${t.source}`} trackRef={t} />
        ))}
      </GradeEncaixada>
    );
  }

  return (
    <>
      <header className="sala__topo">
        <span className="sala__gravando">
          <span className="ponto-gravando" aria-hidden="true" />
          Gravando
          <Cronometro desde={inicio} />
        </span>
        <div className="sala__titulo">
          <b>{dados.titulo ?? 'Reunião'}</b>
          <span>
            {[dados.empresa, `${pessoas.length} ${pessoas.length === 1 ? 'pessoa' : 'pessoas'}`]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
      </header>

      <div className="sala__corpo">
        <main className="sala__palco">{palco}</main>
        {lateral && (
          <aside className="painel-sala">
            <div className="painel-sala__lista">
              {maos.length > 0 && (
                <section className="painel-sala__grupo">
                  <span className="painel-sala__titulo">Mãos levantadas</span>
                  {maos.map((p, i) => (
                    <div key={p.identity} className="pessoa pessoa--mao">
                      <span className="pessoa__ordem">{i + 1}º</span>
                      <Avatar nome={nomeDe(p)} size={28} />
                      <div className="pessoa__texto">
                        <b>{nomeDe(p)}</b>
                      </div>
                    </div>
                  ))}
                </section>
              )}
              {mensagens.length > 0 && (
                <section className="painel-sala__grupo">
                  <span className="painel-sala__titulo">Chat</span>
                  {mensagens.map((m) => (
                    <div key={m.id} className="msg">
                      <div className="msg__quem">
                        <span>{m.autor}</span>
                        <time dateTime={m.criadoEm}>{fmtHora.format(new Date(m.criadoEm))}</time>
                      </div>
                      {m.texto && <div className="msg__bolha">{m.texto}</div>}
                      {m.arquivo && (
                        <div className="msg__arquivo">
                          <span className="msg__arquivo-icone">
                            <Icon
                              name={m.arquivo.mime.startsWith('image/') ? 'image' : 'file-text'}
                              size={18}
                            />
                          </span>
                          <span className="msg__arquivo-texto">
                            <b>{m.arquivo.nome}</b>
                            <span>{fmtTamanho(m.arquivo.tamanho)}</span>
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                  <div ref={fimChat} />
                </section>
              )}
            </div>
          </aside>
        )}
      </div>

      <div className="avisos-sala">
        {avisos.map((a) => (
          <div key={a.id} className="aviso-flutuante" data-tom={a.tom}>
            <Icon name={a.icone} size={18} />
            <span>{a.texto}</span>
          </div>
        ))}
      </div>
    </>
  );
}
