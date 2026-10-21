import { Button, Icon } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, type Notificacao } from '../api';
import { fmtQuando } from '../formatar';
import { Drawer } from './Drawer';

const ICONE: Record<Notificacao['tipo'], string> = {
  mensagem: 'message-circle',
  atribuido: 'user-plus',
  reuniao: 'calendar-clock',
  tarefa: 'check',
  sistema: 'circle-help',
};

export function useAvisos() {
  return useQuery({
    queryKey: ['notificacoes'],
    queryFn: () => api<{ naoLidas: number; itens: Notificacao[] }>('/notificacoes'),
    refetchInterval: 20_000,
    refetchIntervalInBackground: true,
  });
}

/** Para onde o aviso leva: mensagem → conversa; o resto → ficha do lead no funil. */
export function destinoDoAviso(n: Pick<Notificacao, 'tipo' | 'empresaId' | 'link'>): string | null {
  if (n.link) return n.link;
  if (!n.empresaId) return n.tipo === 'reuniao' || n.tipo === 'tarefa' ? '/hoje' : null;
  return n.tipo === 'mensagem' ? `/conversas?lead=${n.empresaId}` : `/funil?empresa=${n.empresaId}`;
}

const podeNotificar = () => typeof Notification !== 'undefined';

/**
 * Avisos do navegador (lead respondeu, lead novo, reunião daqui a pouco) enquanto o sistema está
 * aberto em alguma aba, e o número no título da aba.
 */
export function useAvisosNoNavegador(itens: Notificacao[] | undefined, naoLidas: number) {
  const vistos = useRef<Set<number> | null>(null);
  const navegar = useNavigate();
  useEffect(() => {
    document.title = naoLidas > 0 ? `(${naoLidas}) Prospect Team` : 'Prospect Team';
  }, [naoLidas]);
  useEffect(() => {
    if (!itens) return;
    // Primeira carga: só lembra o que já existia (não dispara aviso velho).
    if (!vistos.current) {
      vistos.current = new Set(itens.map((i) => i.id));
      return;
    }
    for (const n of itens) {
      if (vistos.current.has(n.id) || n.lidaEm) continue;
      vistos.current.add(n.id);
      if (podeNotificar() && Notification.permission === 'granted') {
        const aviso = new Notification(n.titulo, { body: n.texto ?? undefined, tag: `aviso-${n.id}` });
        aviso.onclick = () => {
          window.focus();
          const destino = destinoDoAviso(n);
          if (destino) navegar(destino);
          aviso.close();
        };
      }
    }
  }, [itens, navegar]);
}

export function BotaoAvisos(props: { naoLidas: number; aoAbrir: () => void }) {
  return (
    <button
      type="button"
      className="nav__sino"
      onClick={props.aoAbrir}
      aria-label={props.naoLidas ? `Avisos: ${props.naoLidas} novos` : 'Avisos'}
      title="Avisos"
    >
      <Icon name="bell" size={18} />
      {props.naoLidas > 0 && (
        <span className="nav__sino-conta">{props.naoLidas > 99 ? '99+' : props.naoLidas}</span>
      )}
    </button>
  );
}

export function PainelAvisos(props: { aoFechar: () => void }) {
  const q = useAvisos();
  const cliente = useQueryClient();
  const navegar = useNavigate();
  const [permissao, setPermissao] = useState(podeNotificar() ? Notification.permission : 'denied');
  const ler = useMutation({
    mutationFn: (id?: number) =>
      api(id ? `/notificacoes/${id}/lida` : '/notificacoes/lidas', { metodo: 'POST' }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['notificacoes'] }),
  });

  return (
    <Drawer titulo="Avisos" barra="Avisos" aoFechar={props.aoFechar}>
      <div className="drawer__corpo">
        <div className="pilha" style={{ gap: 12 }}>
          {permissao === 'default' && (
            <div className="confirmar">
              <span>
                Quer ser avisado no computador quando um lead responder, mesmo com outra aba aberta?
              </span>
              <div className="acoes">
                <Button
                  size="sm"
                  variant="primary"
                  icon="bell"
                  onClick={() => void Notification.requestPermission().then(setPermissao)}
                >
                  Ativar avisos no navegador
                </Button>
              </div>
            </div>
          )}
          <div className="acoes" style={{ justifyContent: 'space-between' }}>
            <span className="quieto">{q.data?.naoLidas ? `${q.data.naoLidas} não lidos` : 'Tudo lido'}</span>
            {!!q.data?.naoLidas && (
              <Button size="sm" variant="ghost" icon="check-check" onClick={() => ler.mutate(undefined)}>
                Marcar todos como lidos
              </Button>
            )}
          </div>
          {q.isPending ? (
            <div className="esqueleto" />
          ) : !q.data?.itens.length ? (
            <p className="quieto">
              Nenhum aviso ainda. Aqui aparecem os leads que responderam, os leads novos para você e as
              reuniões que estão chegando.
            </p>
          ) : (
            <ul className="avisos">
              {q.data.itens.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className="aviso"
                    data-novo={!n.lidaEm || undefined}
                    onClick={() => {
                      if (!n.lidaEm) ler.mutate(n.id);
                      const destino = destinoDoAviso(n);
                      if (destino) {
                        props.aoFechar();
                        navegar(destino);
                      }
                    }}
                  >
                    <Icon name={ICONE[n.tipo]} size={16} />
                    <span className="aviso__corpo">
                      <b>{n.titulo}</b>
                      {n.texto && <span className="aviso__texto">{n.texto}</span>}
                      <span className="quieto">{fmtQuando(n.criadoEm)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Drawer>
  );
}
