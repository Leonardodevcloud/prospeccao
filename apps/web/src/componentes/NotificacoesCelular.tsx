import { Button } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { fmtQuando } from '../formatar';
import { ErroDaApi, Mensagem } from './Formulario';

interface TelaPush {
  /** Chave pública VAPID (null: o servidor ainda não ligou o envio). */
  chave: string | null;
  aparelhos: { id: number; aparelho: string | null; criadoEm: string; usadoEm: string | null }[];
}

/** A chave VAPID chega em base64url; o navegador quer os bytes. */
function bytesDaChave(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const bruto = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(bruto.length));
  for (let i = 0; i < bruto.length; i++) bytes[i] = bruto.charCodeAt(i);
  return bytes;
}

/** "Android · Chrome", "iPhone · Safari"…: para a pessoa reconhecer o aparelho na lista. */
function nomeDoAparelho(): string {
  const ua = navigator.userAgent;
  const so = /iPhone|iPad/.test(ua)
    ? 'iPhone'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X/.test(ua)
        ? 'Mac'
        : /Windows/.test(ua)
          ? 'Windows'
          : 'Computador';
  const nav = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'navegador';
  return `${so} · ${nav}`;
}

const suportado = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const ehIos = () => /iPhone|iPad/.test(navigator.userAgent);
const instalado = () => window.matchMedia?.('(display-mode: standalone)').matches;

/**
 * Notificações no celular: quando um lead responde (WhatsApp ou e-mail), uma tarefa vence ou algo
 * quebra, o aviso chega no aparelho mesmo com o sistema fechado.
 */
export function NotificacoesCelular() {
  const cliente = useQueryClient();
  const q = useQuery({ queryKey: ['push'], queryFn: () => api<TelaPush>('/notificacoes/push') });
  const [endpointAqui, setEndpointAqui] = useState<string | null>(null);
  const [permissao, setPermissao] = useState<NotificationPermission | 'indisponivel'>(
    suportado() ? Notification.permission : 'indisponivel',
  );
  useEffect(() => {
    if (!suportado()) return;
    void navigator.serviceWorker.getRegistration().then(async (reg) => {
      const sub = await reg?.pushManager.getSubscription();
      setEndpointAqui(sub?.endpoint ?? null);
    });
  }, []);

  const ativar = useMutation({
    mutationFn: async () => {
      const chave = q.data?.chave;
      if (!chave) throw new Error('O servidor ainda não está pronto para notificações.');
      const p = await Notification.requestPermission();
      setPermissao(p);
      if (p !== 'granted')
        throw new Error('Você não permitiu as notificações. Libere nas configurações do navegador.');
      const reg =
        (await navigator.serviceWorker.getRegistration()) ??
        (await navigator.serviceWorker.register('/sw.js'));
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: bytesDaChave(chave),
        }));
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await api('/notificacoes/push', {
        metodo: 'POST',
        corpo: { endpoint: json.endpoint, keys: json.keys, aparelho: nomeDoAparelho() },
      });
      setEndpointAqui(json.endpoint);
    },
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['push'] }),
  });
  const desativar = useMutation({
    mutationFn: async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await api('/notificacoes/push', { metodo: 'DELETE', corpo: { endpoint: sub.endpoint } });
        await sub.unsubscribe();
      }
      setEndpointAqui(null);
    },
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['push'] }),
  });
  const testar = useMutation({
    mutationFn: () => api<{ enviados: number }>('/notificacoes/push/teste', { metodo: 'POST' }),
  });

  const aparelhos = q.data?.aparelhos ?? [];
  const ativoAqui = !!endpointAqui;
  const erro = ativar.error instanceof Error && !('status' in ativar.error) ? ativar.error.message : null;

  return (
    <section className="pilha" style={{ gap: 12 }}>
      <h3 className="subtitulo">Notificações no celular</h3>
      <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
        Receba um aviso quando um lead responder (WhatsApp ou e-mail), quando uma tarefa vencer ou quando algo
        parar de funcionar, mesmo com o sistema fechado.
      </p>
      {!suportado() ? (
        <Mensagem tipo="aviso">
          {ehIos()
            ? 'No iPhone: abra o sistema no Safari, toque em Compartilhar → “Adicionar à Tela de Início” e abra pelo ícone. Aí as notificações aparecem aqui.'
            : 'Este navegador não recebe notificações. Use o Chrome, o Edge ou o Firefox.'}
        </Mensagem>
      ) : (
        <>
          {ehIos() && !instalado() && (
            <Mensagem tipo="aviso">
              No iPhone, as notificações só funcionam com o sistema na Tela de Início (Compartilhar →
              “Adicionar à Tela de Início”).
            </Mensagem>
          )}
          {permissao === 'denied' && (
            <Mensagem tipo="aviso">
              As notificações estão bloqueadas neste navegador. Libere em Configurações do site →
              Notificações.
            </Mensagem>
          )}
          <div className="acoes">
            {ativoAqui ? (
              <>
                <Button size="sm" icon="bell" disabled={testar.isPending} onClick={() => testar.mutate()}>
                  {testar.isPending ? 'Mandando…' : 'Mandar um teste'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={desativar.isPending}
                  onClick={() => desativar.mutate()}
                >
                  Desligar neste aparelho
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="primary"
                icon="bell"
                disabled={ativar.isPending || !q.data?.chave || permissao === 'denied'}
                onClick={() => ativar.mutate()}
              >
                {ativar.isPending ? 'Ligando…' : 'Ligar neste aparelho'}
              </Button>
            )}
          </div>
          {testar.data && (
            <Mensagem tipo={testar.data.enviados ? 'ok' : 'aviso'}>
              {testar.data.enviados
                ? `Teste enviado para ${testar.data.enviados} aparelho(s).`
                : 'Nenhum aparelho recebeu: ligue de novo neste aparelho.'}
            </Mensagem>
          )}
          {erro && <Mensagem tipo="erro">{erro}</Mensagem>}
          <ErroDaApi erro={erro ? null : (ativar.error ?? desativar.error ?? testar.error)} />
        </>
      )}
      {aparelhos.length > 0 && (
        <ul className="lista-status">
          {aparelhos.map((a) => (
            <li key={a.id} data-ok>
              <span aria-hidden="true">•</span>
              <span>
                {a.aparelho ?? 'Aparelho'}
                <span className="quieto">
                  {' '}
                  · ligado {fmtQuando(a.criadoEm)}
                  {a.usadoEm ? ` · último aviso ${fmtQuando(a.usadoEm)}` : ''}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
