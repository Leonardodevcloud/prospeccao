import { useLocalParticipant, useParticipants, useTrackMutedIndicator } from '@livekit/components-react';
import { Avatar, Button, Icon } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type Participant, Track } from 'livekit-client';
import { useState } from 'react';
import { ErroDaApi } from '../componentes/Formulario';
import { apiSala, type PessoaNaEspera } from './api';
import { nomeDe } from './Ladrilho';

const PAPEL: Record<string, string> = {
  anfitriao: 'Anfitrião',
  equipe: 'Do time',
  convidado: 'Convidado',
};

/** Quem levantou a mão, na ordem em que levantou. */
export function maosLevantadas(pessoas: Participant[]): Participant[] {
  return pessoas
    .filter((p) => p.attributes.mao)
    .sort((a, b) => Number(a.attributes.mao) - Number(b.attributes.mao));
}

function EstadoMicrofone(props: { p: Participant }) {
  const { isMuted } = useTrackMutedIndicator({ participant: props.p, source: Track.Source.Microphone });
  return isMuted ? (
    <Icon name="mic-off" size={16} label="Microfone desligado" className="ladrilho__mudo" />
  ) : (
    <Icon name="mic" size={16} label="Microfone ligado" />
  );
}

/**
 * Pessoas da sala: a sala de espera (o time deixa entrar ou recusa), a fila de mãos levantadas e quem
 * está na sala. O time silencia, baixa a mão e tira alguém da sala.
 */
export function PainelPessoas(props: {
  codigo: string;
  credencial: string;
  doTime: boolean;
  /** Muda quando chega um aviso da sala de espera (busca de novo na hora). */
  versaoEspera: number;
}) {
  const pessoas = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const cliente = useQueryClient();
  const [confirmarTirar, setConfirmarTirar] = useState<string | null>(null);
  const espera = useQuery({
    queryKey: ['sala', props.codigo, 'na-espera', props.versaoEspera],
    queryFn: () => apiSala<PessoaNaEspera[]>(`/${props.codigo}/espera`, { credencial: props.credencial }),
    enabled: props.doTime,
    refetchInterval: 5000,
  });
  const acao = useMutation({
    mutationFn: (a: { caminho: string; corpo?: object }) =>
      apiSala(`/${props.codigo}${a.caminho}`, {
        metodo: 'POST',
        corpo: a.corpo ?? {},
        credencial: props.credencial,
      }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['sala', props.codigo, 'na-espera'] }),
  });
  const maos = maosLevantadas(pessoas);
  const baixarMao = (p: Participant) =>
    p.isLocal
      ? void localParticipant.setAttributes({ mao: '' })
      : acao.mutate({ caminho: `/pessoas/${p.identity}/baixar-mao` });

  return (
    <div className="painel-sala__lista">
      {props.doTime && !!espera.data?.length && (
        <section className="painel-sala__grupo" aria-label="Aguardando para entrar">
          <span className="painel-sala__titulo">Aguardando para entrar</span>
          {espera.data.map((e) => (
            <div key={e.id} className="pessoa pessoa--espera">
              <div className="pessoa__linha">
                <Avatar nome={e.nome} size={28} />
                <div className="pessoa__texto">
                  <b>{e.nome}</b>
                  <span>Pediu para entrar</span>
                </div>
              </div>
              <div className="acoes">
                <Button
                  size="sm"
                  variant="primary"
                  icon="check"
                  disabled={acao.isPending}
                  onClick={() =>
                    acao.mutate({ caminho: `/espera/${e.id}`, corpo: { decisao: 'deixar_entrar' } })
                  }
                >
                  Deixar entrar
                </Button>
                <Button
                  size="sm"
                  disabled={acao.isPending}
                  onClick={() => acao.mutate({ caminho: `/espera/${e.id}`, corpo: { decisao: 'recusar' } })}
                >
                  Recusar
                </Button>
              </div>
            </div>
          ))}
        </section>
      )}

      {maos.length > 0 && (
        <section className="painel-sala__grupo" aria-label="Mãos levantadas">
          <span className="painel-sala__titulo">Mãos levantadas</span>
          {maos.map((p, i) => (
            <div key={p.identity} className="pessoa pessoa--mao">
              <span className="pessoa__ordem">{i + 1}º</span>
              <Avatar nome={nomeDe(p)} size={28} />
              <div className="pessoa__texto">
                <b>{p.isLocal ? 'Você' : nomeDe(p)}</b>
              </div>
              {(props.doTime || p.isLocal) && (
                <Button size="sm" disabled={acao.isPending} onClick={() => baixarMao(p)}>
                  Baixar a mão
                </Button>
              )}
            </div>
          ))}
        </section>
      )}

      <section className="painel-sala__grupo" aria-label="Na sala">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="painel-sala__titulo">Na sala ({pessoas.length})</span>
          {props.doTime && pessoas.length > 1 && (
            <Button
              size="sm"
              variant="ghost"
              icon="mic-off"
              disabled={acao.isPending}
              onClick={() => acao.mutate({ caminho: '/silenciar-todos' })}
            >
              Silenciar todos
            </Button>
          )}
        </div>
        {pessoas.map((p) => (
          <div key={p.identity}>
            <div className="pessoa">
              <Avatar nome={nomeDe(p)} size={28} />
              <div className="pessoa__texto">
                <b>
                  {nomeDe(p)}
                  {p.isLocal ? ' (você)' : ''}
                </b>
                <span>
                  {PAPEL[p.attributes.papel ?? ''] ?? 'Convidado'}
                  {p.isScreenShareEnabled ? ' · mostrando a tela' : ''}
                </span>
              </div>
              <EstadoMicrofone p={p} />
              {props.doTime && !p.isLocal && (
                <>
                  <button
                    type="button"
                    className="ico"
                    title={`Silenciar ${nomeDe(p)}`}
                    aria-label={`Silenciar ${nomeDe(p)}`}
                    disabled={acao.isPending || !p.isMicrophoneEnabled}
                    onClick={() => acao.mutate({ caminho: `/pessoas/${p.identity}/silenciar` })}
                  >
                    <Icon name="mic-off" size={16} />
                  </button>
                  {p.attributes.papel === 'convidado' && (
                    <button
                      type="button"
                      className="ico"
                      title={`Tirar ${nomeDe(p)} da sala`}
                      aria-label={`Tirar ${nomeDe(p)} da sala`}
                      onClick={() => setConfirmarTirar(p.identity)}
                    >
                      <Icon name="user-x" size={16} />
                    </button>
                  )}
                </>
              )}
            </div>
            {confirmarTirar === p.identity && (
              <div className="confirmar">
                <span>Tirar {nomeDe(p)} da sala? Pelo mesmo link, a pessoa não entra de novo.</span>
                <div className="acoes">
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      acao.mutate({ caminho: `/pessoas/${p.identity}/remover` });
                      setConfirmarTirar(null);
                    }}
                  >
                    Tirar da sala
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmarTirar(null)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </section>
      <ErroDaApi erro={acao.error} />
    </div>
  );
}
