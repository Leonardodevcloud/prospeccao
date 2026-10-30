import { fmtDuracaoReuniao } from '@prospeccao/shared/reunioes';
import { Badge, Button, EmptyState, Icon, Panel } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, type Tarefa } from '../api';
import { LinkAjuda } from '../componentes/Ajuda';
import { ForaDoPlano } from '../componentes/ForaDoPlano';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { useEquipe, useSessao, useSoLeitura } from '../componentes/Sessao';
import { ConvidarPeloWhatsapp, CopiarLinkSala, FormTarefa, useEstadoReunioes } from '../componentes/Tarefas';
import { fmtCompromisso, fmtNome } from '../formatar';
import type { SalaResumo, SessaoResumo, SituacaoSessao } from '../reuniao/api';

/**
 * Reuniões por vídeo: as que vão acontecer (com o link para entrar, copiar e mandar ao lead) e as
 * que aconteceram (gravação, resumo da IA, transcrição).
 */

const SITUACAO: Record<SituacaoSessao, { texto: string; tom: 'brand' | 'warning' | 'neutral' | 'danger' }> = {
  ao_vivo: { texto: 'Acontecendo agora', tom: 'brand' },
  processando: { texto: 'Preparando o resumo', tom: 'warning' },
  pronta: { texto: 'Pronta', tom: 'brand' },
  encerrada: { texto: 'Sem gravação', tom: 'neutral' },
  erro: { texto: 'Resumo falhou', tom: 'danger' },
};

const INTERESSE: Record<string, string> = {
  alto: 'Interesse alto',
  medio: 'Interesse médio',
  baixo: 'Interesse baixo',
};

const fmtDiaHora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

export function Reunioes() {
  const [busca, setBusca] = useSearchParams();
  const aba = busca.get('ver') === 'gravadas' ? 'realizadas' : 'proximas';
  const quem = busca.get('de') ?? 'todos';
  const sessao = useSessao();
  const equipe = useEquipe();
  const soLeitura = useSoLeitura();
  const estado = useEstadoReunioes();
  const cliente = useQueryClient();
  const [marcar, setMarcar] = useState(false);
  const mudar = (x: Record<string, string | null>) => {
    const p = new URLSearchParams(busca);
    for (const [k, v] of Object.entries(x)) v === null ? p.delete(k) : p.set(k, v);
    setBusca(p, { replace: true });
  };
  const lista = useQuery({
    queryKey: ['reunioes', aba, quem],
    queryFn: () => api<(SalaResumo | SessaoResumo)[]>(`/reunioes?quais=${aba}&usuario=${quem}`),
    refetchInterval: aba === 'proximas' ? 30_000 : 60_000,
  });

  // Reunião agora: marca para este minuto e abre a sala.
  const agora = useMutation({
    mutationFn: () =>
      api<Tarefa>('/agenda', {
        metodo: 'POST',
        corpo: {
          tipo: 'reuniao',
          titulo: `Reunião rápida · ${sessao.data?.nome.split(' ')[0] ?? 'time'}`,
          inicio: new Date().toISOString(),
          sala: {
            entrada: 'livre',
            gravar: !!estado.data?.gravacao,
            transcrever: !!estado.data?.transcricao,
            abreMinutosAntes: 10,
          },
        },
      }),
    onSuccess: (t) => {
      cliente.invalidateQueries({ queryKey: ['reunioes'] });
      if (t.sala) window.open(`/r/${t.sala.codigo}`, '_blank', 'noopener');
    },
  });

  const ativos = equipe.data?.usuarios.filter((u) => u.ativo) ?? [];
  return (
    <>
      <div className="topo">
        <div>
          <h1>Reuniões</h1>
          <p>
            Sala de vídeo com link para o lead, gravação e resumo da IA na ficha.{' '}
            <LinkAjuda artigo="reunioes" />
          </p>
        </div>
        <div className="acoes">
          {ativos.length > 1 && (
            <>
              <label className="pp-sr" htmlFor="reunioes-de">
                De quem
              </label>
              <select
                id="reunioes-de"
                className="filtro"
                value={quem}
                onChange={(e) => mudar({ de: e.target.value === 'todos' ? null : e.target.value })}
              >
                <option value="todos">Toda a equipe</option>
                <option value="eu">Minhas</option>
                {ativos
                  .filter((u) => u.id !== sessao.data?.id)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nome}
                    </option>
                  ))}
              </select>
            </>
          )}
          {!soLeitura && estado.data?.video && (
            <>
              <Button icon="calendar-plus" onClick={() => setMarcar(true)}>
                Marcar reunião
              </Button>
              <Button
                variant="primary"
                icon="video"
                disabled={agora.isPending}
                onClick={() => agora.mutate()}
              >
                {agora.isPending ? 'Abrindo…' : 'Reunião agora'}
              </Button>
            </>
          )}
        </div>
      </div>

      {estado.data?.foraDoPlano && <ForaDoPlano recurso="reunioes" compacto />}
      {estado.data && !estado.data.video && !estado.data.foraDoPlano && (
        <Mensagem tipo="aviso">
          A sala de vídeo ainda não foi configurada neste sistema. Quem administra a plataforma liga em poucos
          minutos (veja a ajuda).
        </Mensagem>
      )}
      {estado.data?.video && !estado.data.gravacao && (
        <Mensagem tipo="aviso">
          As reuniões acontecem normalmente, mas ainda sem gravação nem resumo da IA.
        </Mensagem>
      )}
      <ErroDaApi erro={agora.error} />

      <div className="segmentos" role="tablist" aria-label="Quais reuniões">
        <button
          type="button"
          role="tab"
          aria-selected={aba === 'proximas'}
          className="segmento"
          data-ativo={aba === 'proximas' || undefined}
          onClick={() => mudar({ ver: null })}
        >
          <Icon name="calendar" size={14} />
          &nbsp;Próximas
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={aba === 'realizadas'}
          className="segmento"
          data-ativo={aba === 'realizadas' || undefined}
          onClick={() => mudar({ ver: 'gravadas' })}
        >
          <Icon name="video" size={14} />
          &nbsp;Realizadas
        </button>
      </div>

      {lista.isPending ? (
        <div className="esqueleto" />
      ) : !lista.data?.length ? (
        <EmptyState
          icone={aba === 'proximas' ? 'calendar' : 'video'}
          titulo={aba === 'proximas' ? 'Nenhuma reunião marcada' : 'Nenhuma reunião aconteceu ainda'}
          texto={
            aba === 'proximas'
              ? 'Marque pela ficha do lead ou pelo botão "Marcar reunião". O link vai junto no lembrete.'
              : 'Depois da primeira reunião na sala, a gravação e o resumo aparecem aqui.'
          }
        />
      ) : aba === 'proximas' ? (
        <ul className="reunioes">
          {(lista.data as SalaResumo[]).map((s) => (
            <LinhaProxima key={s.salaId} s={s} />
          ))}
        </ul>
      ) : (
        <ul className="reunioes">
          {(lista.data as SessaoResumo[]).map((s) => (
            <LinhaRealizada key={s.id} s={s} />
          ))}
        </ul>
      )}

      {marcar && <FormTarefa tipoInicial="reuniao" aoFechar={() => setMarcar(false)} />}
    </>
  );
}

function LinhaProxima(props: { s: SalaResumo }) {
  const { s } = props;
  const cliente = useQueryClient();
  const aoVivo = s.status === 'ao_vivo';
  return (
    <li className="reuniao-linha">
      <span className="reuniao-linha__icone" data-ao-vivo={aoVivo || undefined}>
        <Icon name="video" size={16} />
      </span>
      <div className="reuniao-linha__corpo">
        <b>{s.titulo}</b>
        <span className="quieto">
          {aoVivo ? 'Acontecendo agora' : fmtCompromisso(s.inicio)}
          {s.empresaId && s.empresaNome && (
            <>
              {' · '}
              <Link to={`/funil?empresa=${s.empresaId}`}>{fmtNome(s.empresaNome)}</Link>
            </>
          )}
          {s.anfitriaoNome && <> · {s.anfitriaoNome}</>}
        </span>
        <span className="reuniao-linha__selos">
          {aoVivo && (
            <Badge tone="brand" icon="radio">
              Ao vivo
            </Badge>
          )}
          {s.gravar && <Badge tone="outline">Gravada</Badge>}
          {s.entrada === 'aprovacao' && <Badge tone="outline">Você aprova quem entra</Badge>}
          {s.conviteEnviadoEm && <Badge tone="neutral">Convite mandado</Badge>}
        </span>
      </div>
      <div className="reuniao-linha__acoes">
        {s.empresaId && !aoVivo && (
          <ConvidarPeloWhatsapp
            salaId={s.salaId}
            jaEnviado={s.conviteEnviadoEm}
            aoEnviar={() => cliente.invalidateQueries({ queryKey: ['reunioes'] })}
          />
        )}
        <CopiarLinkSala codigo={s.codigo} />
        <Button
          size="sm"
          variant={aoVivo ? 'primary' : 'secondary'}
          icon="video"
          href={`/r/${s.codigo}`}
          target="_blank"
          rel="noreferrer"
        >
          Entrar
        </Button>
      </div>
    </li>
  );
}

function LinhaRealizada(props: { s: SessaoResumo }) {
  const { s } = props;
  const sit = SITUACAO[s.situacao];
  return (
    <li className="reuniao-linha">
      <span className="reuniao-linha__icone">
        <Icon name={s.temVideo ? 'play' : 'video-off'} size={16} />
      </span>
      <div className="reuniao-linha__corpo">
        <Link to={`/reunioes/${s.id}`} className="reuniao-linha__titulo">
          {s.titulo}
        </Link>
        <span className="quieto">
          {fmtDiaHora(s.iniciadaEm)}
          {s.duracaoSegundos ? ` · ${fmtDuracaoReuniao(s.duracaoSegundos)}` : ''}
          {s.pessoas ? ` · ${s.pessoas} ${s.pessoas === 1 ? 'pessoa' : 'pessoas'}` : ''}
          {s.empresaNome && <> · {fmtNome(s.empresaNome)}</>}
        </span>
        {s.resumo && <span className="reuniao-linha__resumo">{s.resumo}</span>}
        <span className="reuniao-linha__selos">
          <Badge tone={sit.tom}>{sit.texto}</Badge>
          {s.interesse && INTERESSE[s.interesse] && <Badge tone="outline">{INTERESSE[s.interesse]}</Badge>}
        </span>
      </div>
      <div className="reuniao-linha__acoes">
        <Button size="sm" iconRight="arrow-right" href={`/reunioes/${s.id}`}>
          Abrir
        </Button>
      </div>
    </li>
  );
}

/** Na ficha do lead: as reuniões por vídeo que aconteceram com ele (some quando não há nenhuma). */
export function ReunioesDoLead(props: { empresaId: number }) {
  const q = useQuery({
    queryKey: ['reunioes', 'lead', props.empresaId],
    queryFn: () => api<SessaoResumo[]>(`/reunioes/lead/${props.empresaId}`),
  });
  if (!q.data?.length) return null;
  return (
    <Panel titulo="Reuniões gravadas" contagem={q.data.length} acoes={<LinkAjuda artigo="reunioes" />}>
      <ul className="lista-limpa reunioes-lead">
        {q.data.slice(0, 5).map((s) => (
          <li key={s.id}>
            <Link to={`/reunioes/${s.id}`} className="reunioes-lead__item">
              <Icon name={s.temVideo ? 'play' : 'video-off'} size={16} />
              <span className="reunioes-lead__texto">
                <b>{s.titulo}</b>
                <span className="quieto">
                  {fmtDiaHora(s.iniciadaEm)}
                  {s.duracaoSegundos ? ` · ${fmtDuracaoReuniao(s.duracaoSegundos)}` : ''}
                  {` · ${SITUACAO[s.situacao].texto.toLowerCase()}`}
                </span>
                {s.resumo && <span className="reunioes-lead__resumo">{s.resumo}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
