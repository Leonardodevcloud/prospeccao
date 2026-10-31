import { Button, Icon } from '@prospeccao/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { fmtNome, formatarTelefone } from '../formatar';
import { telefone } from './ligacao';
import { useModuloLigacoes, useSituacaoTelefonia, useTelefone } from './tipos';

/**
 * Ligação chegando no número da empresa: o aviso aparece em qualquer tela. Primeiro só para o dono
 * do lead; depois do tempo combinado (ou se ele passar), para o time todo. Quem clicar primeiro em
 * Atender leva a ligação.
 */

interface Entrando {
  id: number;
  empresaId: number | null;
  lead: string | null;
  telefone: string;
  numeroEmpresa: string | null;
  iniciadaEm: string;
  meu: boolean;
  donoNome: string | null;
  etapa: string | null;
  ultimoContatoEm: string | null;
  proximaReuniao: string | null;
}

/** Um toque de telefone feito no navegador (sem arquivo de som). */
function useToque(tocar: boolean) {
  useEffect(() => {
    if (!tocar) return;
    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    const c = ctx;
    const tom = () => {
      if (c.state !== 'running') return;
      const g = c.createGain();
      g.gain.value = 0.06;
      g.connect(c.destination);
      for (const f of [440, 480]) {
        const o = c.createOscillator();
        o.frequency.value = f;
        o.connect(g);
        o.start();
        o.stop(c.currentTime + 1);
      }
    };
    void c.resume().catch(() => undefined);
    tom();
    const t = setInterval(tom, 3000);
    return () => {
      clearInterval(t);
      void c.close().catch(() => undefined);
    };
  }, [tocar]);
}

const quando = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

export function ChamadaEntrando() {
  const modulo = useModuloLigacoes();
  const situacao = useSituacaoTelefonia(modulo);
  const e = useTelefone();
  const cliente = useQueryClient();
  const ligado = modulo && !!situacao.data?.disponivel && situacao.data.config.receber !== false;
  const q = useQuery({
    queryKey: ['ligacoes-entrando'],
    queryFn: () => api<Entrando[]>('/ligacoes/entrando'),
    enabled: ligado,
    refetchInterval: 3_000,
    refetchIntervalInBackground: true,
  });
  const [ignoradas, setIgnoradas] = useState<number[]>([]);
  const tituloOriginal = useRef(document.title);
  const ocupado = telefone.ocupado || e.aberto;
  const lista = (q.data ?? []).filter((x) => !ignoradas.includes(x.id));
  const primeira = lista[0];
  useToque(!!primeira && !ocupado);

  // O título da aba pisca (para quem está em outra aba).
  useEffect(() => {
    if (!primeira) return;
    const t0 = tituloOriginal.current;
    let alt = false;
    const t = setInterval(() => {
      alt = !alt;
      document.title = alt ? '📞 Ligação chegando' : t0;
    }, 1000);
    return () => {
      clearInterval(t);
      document.title = t0;
    };
  }, [primeira]);

  if (!primeira) return null;
  const nome = primeira.lead ? fmtNome(primeira.lead) : formatarTelefone(primeira.telefone);

  const atender = async () => {
    // Se outra pessoa atendeu antes, o painel da ligação avisa.
    await telefone.atender(primeira.id);
    cliente.invalidateQueries({ queryKey: ['ligacoes-entrando'] });
  };
  const passar = async () => {
    await api(`/ligacoes/${primeira.id}/passar`, { metodo: 'POST' }).catch(() => undefined);
    setIgnoradas([...ignoradas, primeira.id]);
  };

  return (
    <div className="lig-entrando" role="alertdialog" aria-label="Ligação chegando" aria-live="assertive">
      <div className="lig-entrando__topo">
        <span className="lig-entrando__icone" aria-hidden="true">
          <Icon name="phone-incoming" size={18} />
        </span>
        <div>
          <small>
            Ligação entrando{primeira.meu ? ' · para você' : ''}
            {lista.length > 1 ? ` · +${lista.length - 1} na espera` : ''}
          </small>
          <b>{nome}</b>
          {primeira.lead && <span className="quieto mono">{formatarTelefone(primeira.telefone)}</span>}
        </div>
      </div>
      <ul className="lig-entrando__sobre">
        {primeira.lead ? (
          <>
            <li>
              {primeira.meu
                ? 'seu lead'
                : primeira.donoNome
                  ? `lead de ${primeira.donoNome}`
                  : 'lead sem dono'}
            </li>
            {primeira.etapa && <li>{primeira.etapa}</li>}
            {primeira.proximaReuniao && <li>reunião {quando(primeira.proximaReuniao)}</li>}
          </>
        ) : (
          <li>não é lead · tocando para o time</li>
        )}
        {primeira.numeroEmpresa && <li>para {formatarTelefone(primeira.numeroEmpresa)}</li>}
      </ul>
      {ocupado && <p className="quieto">Termine a ligação atual para atender.</p>}
      <div className="lig-entrando__acoes">
        <Button variant="primary" icon="phone" disabled={ocupado} onClick={() => void atender()}>
          Atender
        </Button>
        {primeira.meu ? (
          <Button variant="secondary" onClick={() => void passar()}>
            Passar para o time
          </Button>
        ) : (
          <Button variant="ghost" onClick={() => setIgnoradas([...ignoradas, primeira.id])}>
            Ignorar
          </Button>
        )}
      </div>
    </div>
  );
}
