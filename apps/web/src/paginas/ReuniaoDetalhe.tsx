import {
  fmtDuracaoReuniao,
  fmtTempoReuniao,
  type ResumoReuniao,
  ROTULO_DESTAQUE,
} from '@prospeccao/shared/reunioes';
import { Avatar, Badge, Button, Icon, Panel, SourceTag } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { useEhAdmin, useSessao, useSoLeitura } from '../componentes/Sessao';
import { diaDaqui, fmtNome, instanteDoInput } from '../formatar';
import type { DetalheReuniao } from '../reuniao/api';
import { fmtTamanho } from '../reuniao/PainelChat';

/**
 * Uma reunião que aconteceu: a gravação (com os momentos para pular), o resumo da IA, a transcrição
 * com quem falou, os próximos passos (viram tarefas), quem participou e o chat.
 */

const ETAPA_SUGERIDA: Record<string, string> = {
  reuniao: 'Reunião',
  proposta: 'Proposta',
  ganho: 'Ganho',
  perdido: 'Perdido',
};

const fmtDia = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
const fmtHora = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Botão "12:40" que pula a gravação para aquele momento. */
function Tempo(props: { segundo: number; aoPular: (s: number) => void; podePular: boolean }) {
  if (!props.podePular) return <span className="tempo-reuniao">{fmtTempoReuniao(props.segundo)}</span>;
  return (
    <button
      type="button"
      className="tempo-reuniao"
      title="Ver este momento na gravação"
      onClick={() => props.aoPular(props.segundo)}
    >
      {fmtTempoReuniao(props.segundo)}
    </button>
  );
}

export function ReuniaoDetalhe() {
  const { id = '' } = useParams();
  const navegar = useNavigate();
  const sessao = useSessao();
  const admin = useEhAdmin();
  const soLeitura = useSoLeitura();
  const cliente = useQueryClient();
  const q = useQuery({
    queryKey: ['reuniao', id],
    queryFn: () => api<DetalheReuniao>(`/reunioes/${id}`),
    refetchInterval: (x) => (x.state.data?.situacao === 'processando' ? 15_000 : false),
  });
  const video = useRef<HTMLVideoElement>(null);
  const pular = (s: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = s;
    void v.play().catch(() => undefined);
    v.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const reprocessar = useMutation({
    mutationFn: () => api(`/reunioes/${id}/processar`, { metodo: 'POST', corpo: {} }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['reuniao', id] }),
  });
  const mover = useMutation({
    mutationFn: (etapa: string) => api(`/funil/${q.data?.empresaId}`, { metodo: 'PATCH', corpo: { etapa } }),
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: ['reuniao', id] });
      cliente.invalidateQueries({ queryKey: ['quadro'] });
    },
  });
  const [confirmarApagar, setConfirmarApagar] = useState(false);
  const apagar = useMutation({
    mutationFn: () => api(`/reunioes/${id}/gravacao`, { metodo: 'DELETE' }),
    onSuccess: () => {
      setConfirmarApagar(false);
      cliente.invalidateQueries({ queryKey: ['reuniao', id] });
    },
  });

  if (q.isPending) return <div className="esqueleto" />;
  if (q.isError || !q.data)
    return (
      <>
        <ErroDaApi erro={q.error} />
        <Link to="/reunioes?ver=gravadas">Voltar para as reuniões</Link>
      </>
    );

  const d = q.data;
  const r = d.resumo;
  const podePular = !!d.videoUrl;
  const anfitriao = sessao.data?.id === d.anfitriaoId;

  return (
    <>
      <div className="topo">
        <div>
          <Link to="/reunioes?ver=gravadas" className="voltar">
            <Icon name="chevron-left" size={14} />
            Reuniões
          </Link>
          <h1>{d.titulo}</h1>
          <p>
            {fmtDia(d.iniciadaEm)}
            {d.encerradaEm ? ` às ${fmtHora(d.encerradaEm)}` : ''}
            {d.duracaoSegundos ? ` · ${fmtDuracaoReuniao(d.duracaoSegundos)}` : ''}
            {d.participantes.length ? ` · ${d.participantes.length} pessoas` : ''}
            {d.anfitriaoNome ? ` · com ${d.anfitriaoNome}` : ''}
          </p>
        </div>
        <div className="acoes">
          {d.empresaId && (
            <Button icon="users" href={`/funil?empresa=${d.empresaId}`}>
              Abrir o lead{d.empresaNome ? `: ${fmtNome(d.empresaNome)}` : ''}
            </Button>
          )}
          {d.videoUrl && (
            <Button icon="download" href={`${d.videoUrl}?baixar=1`}>
              Baixar a gravação
            </Button>
          )}
        </div>
      </div>

      {d.situacao === 'processando' && (
        <Mensagem tipo="aviso">
          Preparando a gravação, a transcrição e o resumo. Leva alguns minutos depois que a reunião acaba;
          esta tela se atualiza sozinha.
        </Mensagem>
      )}
      {d.situacao === 'erro' && (
        <Mensagem tipo="erro">
          Não deu para terminar a transcrição ou o resumo{d.erro ? ` (${d.erro})` : ''}.
          {!soLeitura && (admin || anfitriao) && (
            <>
              {' '}
              <button type="button" className="link-botao" onClick={() => reprocessar.mutate()}>
                Tentar de novo
              </button>
            </>
          )}
        </Mensagem>
      )}
      <ErroDaApi erro={reprocessar.error ?? mover.error ?? apagar.error} />

      <div className="reuniao-colunas">
        <div className="pilha" style={{ gap: 24 }}>
          <Panel semPadding>
            {d.videoUrl ? (
              <>
                {/* biome-ignore lint/a11y/useMediaCaption: a transcrição completa está logo abaixo */}
                <video ref={video} className="reuniao-video" src={d.videoUrl} controls preload="metadata" />
                {r && r.momentos.length > 0 && (
                  <section className="momentos" aria-label="Momentos da reunião">
                    {r.momentos.map((m) => (
                      <button
                        key={`${m.segundo}-${m.titulo}`}
                        type="button"
                        className="momento"
                        data-tipo={m.tipo}
                        onClick={() => pular(m.segundo)}
                      >
                        <span className="mono">{fmtTempoReuniao(m.segundo)}</span>
                        {m.titulo}
                      </button>
                    ))}
                  </section>
                )}
              </>
            ) : (
              <div className="reuniao-sem-video">
                <Icon
                  name={d.situacao === 'processando' ? 'loader' : 'video-off'}
                  spin={d.situacao === 'processando'}
                  size={20}
                />
                <span>
                  {d.situacao === 'processando'
                    ? 'A gravação aparece aqui em instantes.'
                    : d.gravou
                      ? 'A gravação não está mais disponível.'
                      : 'Esta reunião não foi gravada.'}
                </span>
              </div>
            )}
          </Panel>

          {r && (
            <PainelResumo
              d={d}
              r={r}
              pular={pular}
              podePular={podePular}
              mover={mover}
              soLeitura={soLeitura}
            />
          )}

          <Transcricao d={d} pular={pular} podePular={podePular} />

          {admin && !soLeitura && (d.videoUrl || d.falas.length > 0) && (
            <section className="secao">
              {!confirmarApagar ? (
                <button
                  type="button"
                  className="link-botao"
                  style={{ fontSize: 13 }}
                  onClick={() => setConfirmarApagar(true)}
                >
                  Apagar a gravação e a transcrição
                </button>
              ) : (
                <div className="confirmar">
                  <span>
                    Apagar a gravação e a transcrição desta reunião? O resumo e o histórico ficam. Não dá para
                    desfazer.
                  </span>
                  <div className="acoes">
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={apagar.isPending}
                      onClick={() => apagar.mutate()}
                    >
                      Apagar gravação
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmarApagar(false)}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>

        <div className="pilha" style={{ gap: 24 }}>
          {r && r.proximosPassos.length > 0 && <ProximosPassos d={d} r={r} soLeitura={soLeitura} />}

          <Panel titulo="Quem participou" contagem={d.participantes.length}>
            <ul className="lista-limpa">
              {d.participantes.map((p) => (
                <li key={p.identidade} className="pessoa-reuniao">
                  <Avatar nome={p.nome} size={28} />
                  <span className="pessoa-reuniao__nome">
                    {p.nome}
                    <span className="quieto">{p.tipo === 'equipe' ? ' · do time' : ''}</span>
                  </span>
                  <span className="mono quieto">
                    {fmtDuracaoReuniao(p.segundos)}
                    {p.parteDaFala !== null ? ` · falou ${p.parteDaFala}%` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          {d.mensagens.length > 0 && (
            <Panel titulo="Chat e arquivos" contagem={d.mensagens.length}>
              <ul className="lista-limpa chat-reuniao">
                {d.mensagens.map((m) => (
                  <li key={m.id}>
                    <b>{m.autor}</b> <span className="quieto mono">{fmtHora(m.criadoEm)}</span>
                    {m.texto && <p>{m.texto}</p>}
                    {m.arquivo && (
                      <a href={m.arquivo.url} className="arquivo-reuniao" download={m.arquivo.nome}>
                        <Icon name="file-text" size={16} />
                        <span>{m.arquivo.nome}</span>
                        <span className="quieto">{fmtTamanho(m.arquivo.tamanho)}</span>
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <PergunteAoArgos d={d} aoPerguntar={(p) => navegar(`/argos?pergunta=${encodeURIComponent(p)}`)} />
        </div>
      </div>
    </>
  );
}

function PainelResumo(props: {
  d: DetalheReuniao;
  r: ResumoReuniao;
  pular: (s: number) => void;
  podePular: boolean;
  mover: { mutate: (etapa: string) => void; isPending: boolean; isSuccess: boolean };
  soLeitura: boolean;
}) {
  const { d, r } = props;
  const sugestao =
    r.sugestaoEtapa && r.sugestaoEtapa !== 'perdido' && r.sugestaoEtapa !== d.etapa ? r.sugestaoEtapa : null;
  return (
    <Panel
      titulo={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Icon name="bot" size={16} />
          Resumo da reunião
        </span>
      }
      acoes={<SourceTag fonte="ia" />}
    >
      <div className="pilha" style={{ gap: 16 }}>
        <p className="resumo-reuniao">{r.resumo}</p>
        {r.destaques.length > 0 && (
          <dl className="destaques">
            {r.destaques.map((x) => (
              <div key={`${x.tipo}-${x.texto}`}>
                <dt>{ROTULO_DESTAQUE[x.tipo]}</dt>
                <dd>
                  {x.texto}{' '}
                  {x.segundo !== null && (
                    <Tempo segundo={x.segundo} aoPular={props.pular} podePular={props.podePular} />
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {sugestao && d.empresaId && !props.soLeitura && (
          <div className="sugestao-etapa">
            <span>
              A IA sugere mover o lead para <b>{ETAPA_SUGERIDA[sugestao]}</b>
              {r.motivoSugestao ? `: ${r.motivoSugestao}` : '.'}
            </span>
            <Button
              size="sm"
              variant="primary"
              icon="arrow-right"
              disabled={props.mover.isPending || props.mover.isSuccess}
              onClick={() => props.mover.mutate(sugestao)}
            >
              {props.mover.isSuccess ? 'Movido' : `Mover para ${ETAPA_SUGERIDA[sugestao]}`}
            </Button>
          </div>
        )}
      </div>
    </Panel>
  );
}

function Transcricao(props: { d: DetalheReuniao; pular: (s: number) => void; podePular: boolean }) {
  const { d } = props;
  const [busca, setBusca] = useState('');
  const [tudo, setTudo] = useState(false);
  const achadas = useMemo(() => {
    const b = busca.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (!b) return d.falas;
    return d.falas.filter((f) =>
      `${f.nome} ${f.texto}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(b),
    );
  }, [busca, d.falas]);
  const mostradas = tudo || busca ? achadas : achadas.slice(0, 12);
  return (
    <Panel
      titulo="Transcrição"
      contagem={d.falas.length || undefined}
      acoes={
        d.falas.length > 0 ? (
          <>
            <label htmlFor="busca-transcricao" className="pp-sr">
              Buscar na transcrição
            </label>
            <input
              id="busca-transcricao"
              type="search"
              className="filtro filtro--mini"
              placeholder="Buscar"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </>
        ) : undefined
      }
    >
      {!d.falas.length ? (
        <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
          {d.situacao === 'processando'
            ? 'Transcrevendo…'
            : d.transcricao === 'sem_audio'
              ? 'Ninguém falou com o microfone ligado (ou o áudio não foi gravado).'
              : d.transcricao === 'erro'
                ? 'A transcrição falhou.'
                : 'Esta reunião não foi transcrita.'}
        </p>
      ) : (
        <>
          <ol className="falas">
            {mostradas.map((f) => (
              <li key={`${f.identidade}-${f.inicioMs}`} className="fala">
                <Tempo
                  segundo={Math.floor(f.inicioMs / 1000)}
                  aoPular={props.pular}
                  podePular={props.podePular}
                />
                <div>
                  <b>{f.nome}</b>
                  <p>{f.texto}</p>
                </div>
              </li>
            ))}
          </ol>
          {busca && !achadas.length && <p className="quieto">Nada encontrado.</p>}
          {!busca && !tudo && achadas.length > 12 && (
            <Button size="sm" variant="ghost" icon="chevron-down" onClick={() => setTudo(true)}>
              Ver a transcrição completa ({achadas.length} trechos)
            </Button>
          )}
        </>
      )}
    </Panel>
  );
}

function ProximosPassos(props: { d: DetalheReuniao; r: ResumoReuniao; soLeitura: boolean }) {
  const { d, r } = props;
  const cliente = useQueryClient();
  const [marcados, setMarcados] = useState<boolean[]>(() => r.proximosPassos.map(() => true));
  const criar = useMutation({
    mutationFn: () =>
      api<{ criadas: number }>(`/reunioes/${d.id}/tarefas`, {
        metodo: 'POST',
        corpo: {
          // Para amanhã às 9h (a pessoa ajusta na agenda).
          passos: r.proximosPassos
            .filter((_, i) => marcados[i])
            .map((p) => ({ texto: p.texto, inicio: instanteDoInput(diaDaqui(1), '09:00') })),
        },
      }),
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: ['reuniao', String(d.id)] });
      cliente.invalidateQueries({ queryKey: ['agenda'] });
      cliente.invalidateQueries({ queryKey: ['meu-dia'] });
    },
  });
  const n = marcados.filter(Boolean).length;
  return (
    <Panel titulo="Próximos passos">
      <form
        className="pilha"
        style={{ gap: 12 }}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          criar.mutate();
        }}
      >
        {r.proximosPassos.map((p, i) => (
          <label key={p.texto} className="passo">
            <input
              type="checkbox"
              checked={marcados[i] ?? false}
              disabled={props.soLeitura || !!d.tarefasCriadasEm}
              onChange={(e) => setMarcados((x) => x.map((v, j) => (j === i ? e.target.checked : v)))}
            />
            <span>
              {p.texto}
              {(p.quem || p.prazo) && (
                <span className="quieto passo__meta">{[p.quem, p.prazo].filter(Boolean).join(' · ')}</span>
              )}
            </span>
          </label>
        ))}
        <ErroDaApi erro={criar.error} />
        {d.tarefasCriadasEm || criar.isSuccess ? (
          <Badge tone="brand" icon="check">
            Tarefas criadas na agenda
          </Badge>
        ) : (
          !props.soLeitura && (
            <div>
              <Button type="submit" size="sm" icon="plus" disabled={!n || criar.isPending}>
                {n === 1 ? 'Criar 1 tarefa' : `Criar ${n} tarefas`}
              </Button>
            </div>
          )
        )}
      </form>
    </Panel>
  );
}

function PergunteAoArgos(props: { d: DetalheReuniao; aoPerguntar: (p: string) => void }) {
  const [p, setP] = useState('');
  const sobre = props.d.empresaNome ? ` com ${fmtNome(props.d.empresaNome)}` : '';
  return (
    <Panel titulo="Pergunte ao Argos">
      <form
        className="barra"
        onSubmit={(e) => {
          e.preventDefault();
          if (p.trim()) props.aoPerguntar(`Na reunião "${props.d.titulo}"${sobre}: ${p.trim()}`);
        }}
      >
        <label htmlFor="argos-reuniao" className="pp-sr">
          Pergunta sobre esta reunião
        </label>
        <input
          id="argos-reuniao"
          className="filtro"
          style={{ flex: 1, minWidth: 0 }}
          placeholder="Ex.: o que ele falou sobre prazo?"
          value={p}
          onChange={(e) => setP(e.target.value)}
        />
        <Button
          type="submit"
          variant="primary"
          icon="send"
          aria-label="Perguntar ao Argos"
          disabled={!p.trim()}
        />
      </form>
    </Panel>
  );
}
