import { linkGoogleMaps, linkWaze, ROTULO_RESULTADO } from '@prospeccao/shared/rua';
import { Avatar, Badge, Button, EmptyState, Icon, ScoreBadge } from '@prospeccao/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { localizacaoAgora, nomeBonito, type ParadaRua, type RoteiroRua, useHoje } from './api';
import { MapaRua } from './Mapa';
import { fmtDiaCurto } from './Planejar';

/**
 * O dia do vendedor no celular: a próxima visita em destaque (com quem falar, o caminho e o
 * "Cheguei"), as que vêm depois e as já feitas.
 */

/** Há quantos dias (para "proposta enviada há 6 dias"). */
export function haDias(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

const ETAPA_TEXTO: Record<string, string> = {
  abordado: 'Abordado',
  respondeu: 'Em conversa',
  reuniao: 'Reunião marcada',
  proposta: 'Proposta enviada',
  ganho: 'Cliente',
};

export function selosDaParada(
  p: ParadaRua,
): { tom: 'neutral' | 'warning' | 'brand'; icone: string; texto: string }[] {
  const s: { tom: 'neutral' | 'warning' | 'brand'; icone: string; texto: string }[] = [];
  if (p.kmTrecho != null && p.minutosTrecho != null)
    s.push({
      tom: 'neutral',
      icone: 'map-pin',
      texto: `${p.kmTrecho.toLocaleString('pt-BR')} km · ${p.minutosTrecho} min`,
    });
  const etapa = p.etapa ? ETAPA_TEXTO[p.etapa] : null;
  const dias = haDias(p.etapaDesde);
  if (etapa)
    s.push({
      tom: p.etapa === 'proposta' ? 'warning' : 'brand',
      icone: 'file-text',
      texto: dias != null && dias > 0 ? `${etapa} há ${dias} ${dias === 1 ? 'dia' : 'dias'}` : etapa,
    });
  return s;
}

export function MeuRoteiro(props: { podePlanejar: boolean; aoPlanejar: () => void }) {
  const hoje = useHoje();
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const [verMapa, setVerMapa] = useState(false);

  const cheguei = useMutation({
    mutationFn: async (p: ParadaRua) => {
      const local = await localizacaoAgora(8000);
      await api(`/rua/paradas/${p.id}/chegada`, {
        metodo: 'POST',
        corpo: { lat: local?.lat ?? null, lng: local?.lng ?? null, precisao: local?.precisao ?? null },
      });
      return p;
    },
    onSuccess: (p) => {
      cliente.invalidateQueries({ queryKey: ['rua', 'hoje'] });
      navegar(`/rua/visita/${p.id}`);
    },
  });
  const reabrir = useMutation({
    mutationFn: (p: ParadaRua) => api(`/rua/paradas/${p.id}/reabrir`, { metodo: 'POST' }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['rua', 'hoje'] }),
  });

  if (hoje.isLoading) return <p className="quieto">Abrindo o seu dia…</p>;
  const r: RoteiroRua | null | undefined = hoje.data;
  if (!r?.paradas.length)
    return (
      <EmptyState
        icone="route"
        titulo="Nenhuma visita para hoje"
        texto="Quando o seu roteiro do dia for montado, ele aparece aqui, com o caminho e o que falar em cada visita."
        acao={
          props.podePlanejar ? (
            <Button variant="primary" icon="route" onClick={props.aoPlanejar}>
              Planejar o dia
            </Button>
          ) : undefined
        }
      />
    );

  const emVisita = r.paradas.find((p) => p.situacao === 'em_visita');
  const pendentes = r.paradas.filter((p) => p.situacao === 'pendente');
  const proxima = emVisita ?? pendentes[0] ?? null;
  const depois = pendentes.filter((p) => p.id !== proxima?.id);
  const feitas = r.paradas.filter((p) => p.situacao === 'feita' || p.situacao === 'pulada');
  const kmFalta = [proxima, ...depois].reduce((t, p) => t + (p?.kmTrecho ?? 0), 0);
  const pct = Math.round((feitas.length / r.paradas.length) * 100);
  const restantes = [...(proxima ? [proxima] : []), ...depois];
  const caminhoTodo =
    restantes.length > 0
      ? linkGoogleMaps(restantes[restantes.length - 1]!, undefined, restantes.slice(0, -1))
      : null;

  return (
    <div className="rua-celular">
      <header className="rua-celular__topo">
        <div>
          <span className="rotulo-campo">{fmtDiaCurto(r.dia)}</span>
          <h2 className="rua-celular__titulo">Visitas de hoje</h2>
        </div>
        <Avatar nome={r.vendedorNome} size={36} />
      </header>
      <div className="rua-progresso">
        <div className="rua-progresso__txt">
          <span>
            <b>
              {feitas.length} de {r.paradas.length}
            </b>{' '}
            feitas
          </span>
          {kmFalta > 0 && <span className="quieto mono">{Math.round(kmFalta)} km a percorrer</span>}
        </div>
        <div className="rua-barra" aria-hidden="true">
          <div style={{ width: `${pct}%` }} />
        </div>
      </div>

      <ErroDaApi erro={cheguei.error ?? reabrir.error} />

      {proxima ? (
        <section className="rua-proxima" aria-label="Próxima visita">
          <div className="rua-proxima__topo">
            <span className="rua-num rua-num--grande">{proxima.ordem}</span>
            <div className="rua-proxima__txt">
              <span className="rua-sobretitulo">
                {proxima.situacao === 'em_visita'
                  ? 'Você está aqui'
                  : `Próxima${proxima.chegada ? ` · chegar ${proxima.chegada}` : ''}`}
              </span>
              <b>{nomeBonito(proxima.nome)}</b>
              {proxima.endereco && <span className="quieto">{nomeBonito(proxima.endereco)}</span>}
            </div>
            {proxima.faixa && <ScoreBadge faixa={proxima.faixa} score={proxima.score ?? undefined} />}
          </div>
          <div className="rua-selos">
            {selosDaParada(proxima).map((s) => (
              <Badge key={s.texto} tone={s.tom} icon={s.icone}>
                {s.texto}
              </Badge>
            ))}
          </div>
          {(proxima.decisor || proxima.proximaAcao) && (
            <p className="rua-briefing">
              {proxima.decisor && (
                <>
                  <b>Fale com</b> {nomeBonito(proxima.decisor.nome)}
                  {proxima.decisor.cargo ? `, ${proxima.decisor.cargo.toLowerCase()}` : ''}.{' '}
                </>
              )}
              {proxima.proximaAcao && <>Próximo passo no funil: {proxima.proximaAcao}.</>}
            </p>
          )}
          <div className="rua-proxima__botoes">
            <a className="rua-botao" href={linkWaze(proxima)} target="_blank" rel="noopener">
              <Icon name="navigation" size={18} /> Ir com o Waze
            </a>
            {proxima.situacao === 'em_visita' ? (
              <button
                type="button"
                className="rua-botao rua-botao--primario"
                onClick={() => navegar(`/rua/visita/${proxima.id}`)}
              >
                <Icon name="check" size={18} /> Registrar a visita
              </button>
            ) : (
              <button
                type="button"
                className="rua-botao rua-botao--primario"
                disabled={cheguei.isPending}
                onClick={() => cheguei.mutate(proxima)}
              >
                <Icon name="map-pin" size={18} /> {cheguei.isPending ? 'Registrando…' : 'Cheguei'}
              </button>
            )}
          </div>
          <a className="rua-link-pequeno" href={linkGoogleMaps(proxima)} target="_blank" rel="noopener">
            Abrir no Google Maps
          </a>
        </section>
      ) : (
        <Mensagem tipo="ok">Todas as visitas de hoje foram registradas. Bom trabalho!</Mensagem>
      )}

      {depois.length > 0 && (
        <section aria-label="Próximas paradas">
          <h3 className="rua-sobretitulo">Depois</h3>
          <ol className="rua-lista-celular">
            {depois.map((p) => (
              <li key={p.id} className="rua-item-celular">
                {p.almocoAntes && <span className="rua-almoco-linha">Almoço</span>}
                <span className="rua-num">{p.ordem}</span>
                <div className="rua-lista-celular__txt">
                  <b>{nomeBonito(p.nome)}</b>
                  <span className="quieto">
                    <span className="mono">{p.chegada}</span>
                    {p.bairro ? ` · ${nomeBonito(p.bairro)}` : ''}
                  </span>
                </div>
                {p.faixa && <ScoreBadge faixa={p.faixa} />}
              </li>
            ))}
          </ol>
        </section>
      )}

      {feitas.length > 0 && (
        <section aria-label="Feitas">
          <h3 className="rua-sobretitulo">Feitas</h3>
          <ol className="rua-lista-celular">
            {feitas.map((p) => (
              <li key={p.id} className="rua-item-celular">
                <span className="rua-num rua-num--feito">{p.ordem}</span>
                <div className="rua-lista-celular__txt">
                  <span>{nomeBonito(p.nome)}</span>
                </div>
                {p.situacao === 'pulada' ? (
                  <button type="button" className="rua-link-pequeno" onClick={() => reabrir.mutate(p)}>
                    Pulada · voltar
                  </button>
                ) : (
                  <span className="rua-resultado" data-resultado={p.resultado}>
                    {p.resultado ? ROTULO_RESULTADO[p.resultado] : 'Feita'}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="rua-celular__rodape">
        <button type="button" className="rua-link-pequeno" onClick={() => setVerMapa((v) => !v)}>
          {verMapa ? 'Esconder o mapa' : 'Ver o dia no mapa'}
        </button>
        {caminhoTodo && (
          <a className="rua-link-pequeno" href={caminhoTodo} target="_blank" rel="noopener">
            Caminho todo no Google Maps
          </a>
        )}
      </div>
      {verMapa && (
        <MapaRua
          className="rua-mapa--celular"
          rotulo="Mapa das visitas de hoje"
          partida={r.partida}
          paradas={r.paradas.map((p) => ({
            id: p.id,
            ordem: p.ordem,
            nome: nomeBonito(p.nome),
            lat: p.lat,
            lng: p.lng,
            situacao: p.situacao,
            proxima: p.id === proxima?.id,
          }))}
          tracado={r.tracado}
        />
      )}
    </div>
  );
}
