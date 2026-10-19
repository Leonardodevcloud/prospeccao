import { Badge, Button, EmptyState, Icon, ScoreBadge, TextField } from '@prospeccao/ui';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type DragEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  api,
  type Campanha,
  type CardFunil,
  COLUNAS_FUNIL,
  type EtapaFunil,
  type Quadro,
  qs,
  ROTULO_ETAPA,
} from '../api';
import { ConfigurarCadencia, EnvioRapido } from '../componentes/Cadencia';
import { FichaEmpresa } from '../componentes/FichaEmpresa';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { diasDesde, fmtCidade, fmtNome, fmtNumero, fmtPrazo, fmtReais, formatarTelefone } from '../formatar';

/** Etapas em que a cadência tem uma mensagem pronta para mandar. */
const COM_MENSAGEM = new Set<EtapaFunil>(['a_abordar', 'abordado', 'respondeu', 'proposta']);

/** Colunas de fechamento mostram só os mais recentes, para o quadro não crescer sem fim. */
const FECHADAS = new Set<EtapaFunil>(['ganho', 'perdido']);
const LIMITE_FECHADAS = 20;

const DICA_COLUNA: Record<EtapaFunil, string> = {
  a_abordar: 'Ainda não falamos com eles',
  abordado: 'Mandamos mensagem, sem resposta',
  respondeu: 'Responderam: conversa em andamento',
  reuniao: 'Reunião ou visita marcada',
  proposta: 'Proposta enviada',
  ganho: 'Viraram clientes',
  perdido: 'Não fecharam',
  descartado: '',
};

/** Contagem de follow-ups vencidos para o menu lateral (consulta leve). */
export function useFollowupsPendentes() {
  return useQuery({
    queryKey: ['quadro', 'resumo'],
    queryFn: () => api<{ pendentes: number }>('/funil/resumo'),
    refetchInterval: 120_000,
  });
}

function Card(props: {
  c: CardFunil;
  totalTentativas: number;
  arrastando: boolean;
  aoAbrir: () => void;
  aoMandarMensagem: () => void;
  aoArrastar: (e: DragEvent) => void;
  aoSoltarSobre: (e: DragEvent, depois: boolean) => void;
  marcadorAntes: boolean;
}) {
  const { c } = props;
  const prazo = fmtPrazo(c.proximaAcaoEm);
  const fechado = FECHADAS.has(c.etapa);
  const dias = diasDesde(c.etapaDesde);
  const fone = c.telefone ? formatarTelefone(c.telefone) : null;
  return (
    <>
      {props.marcadorAntes && <div className="quadro__marcador" aria-hidden="true" />}
      <article
        className="cartao"
        data-arrastando={props.arrastando || undefined}
        draggable
        onDragStart={props.aoArrastar}
        onDragOver={(e) => {
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          props.aoSoltarSobre(e, e.clientY > r.top + r.height / 2);
        }}
      >
        <button type="button" className="cartao__abrir" onClick={props.aoAbrir}>
          <span className="cartao__topo">
            <b>{fmtNome(c.nome)}</b>
            {c.faixa && <ScoreBadge faixa={c.faixa} score={c.score ?? undefined} />}
          </span>
          <span className="cartao__sub">
            {[fmtCidade(c.cidade), c.categoria].filter(Boolean).join(' · ')}
          </span>
          {c.decisorNome && (
            <span className="cartao__linha">
              <Icon name="user-round" size={14} />
              <span>
                {fmtNome(c.decisorNome)}
                {c.decisorCargo && <span className="quieto"> · {c.decisorCargo}</span>}
              </span>
            </span>
          )}
          {fone && (
            <span className="cartao__linha mono">
              <Icon name={c.contatoCanal === 'whatsapp' ? 'message-circle' : 'phone'} size={14} />
              {fone}
            </span>
          )}
          {fechado ? (
            c.etapa === 'perdido' && c.motivo ? (
              <span className="cartao__motivo">{c.motivo}</span>
            ) : c.valorMensal ? (
              <span className="cartao__linha">{fmtReais(c.valorMensal)}/mês</span>
            ) : null
          ) : (
            <span className="cartao__rodape">
              {prazo ? (
                <Badge
                  tone={prazo.tom === 'atrasado' ? 'danger' : prazo.tom === 'hoje' ? 'warning' : 'neutral'}
                >
                  <Icon name="calendar" size={12} /> {c.proximaAcao ? `${c.proximaAcao} · ` : ''}
                  {prazo.texto}
                </Badge>
              ) : (
                <span className="quieto">Sem próximo passo</span>
              )}
              <span className="quieto" title="Tempo nesta etapa">
                {c.etapa === 'abordado' && c.tentativas > 0
                  ? `msg ${Math.min(c.tentativas, props.totalTentativas)}/${props.totalTentativas} · `
                  : ''}
                {dias === 0 ? 'hoje' : `${dias} d`}
                {c.etapa !== 'abordado' &&
                  c.contatos > 0 &&
                  ` · ${c.contatos} contato${c.contatos === 1 ? '' : 's'}`}
              </span>
            </span>
          )}
        </button>
        {COM_MENSAGEM.has(c.etapa) && c.telefone && !c.encerrarEm && (
          <div className="cartao__acoes">
            <Button
              size="sm"
              variant={c.pendente ? 'primary' : 'secondary'}
              icon="message-circle"
              onClick={props.aoMandarMensagem}
            >
              {c.etapa === 'a_abordar' ? 'Abordar' : c.etapa === 'abordado' ? 'Follow-up' : 'Mensagem'}
            </Button>
          </div>
        )}
      </article>
    </>
  );
}

export function Funil() {
  const [params, setParams] = useSearchParams();
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const campanhaId = params.get('campanhaId') ?? '';
  const faixa = params.get('faixa') ?? '';
  const pendentes = params.get('pendentes') === '1';
  const empresaAberta = params.get('empresa');
  const [busca, setBusca] = useState(params.get('busca') ?? '');
  const [arrastado, setArrastado] = useState<CardFunil | null>(null);
  const [alvo, setAlvo] = useState<{ etapa: EtapaFunil; antesDe: number | null } | null>(null);
  const [perda, setPerda] = useState<{ card: CardFunil; antesDe: number | null } | null>(null);
  const [motivo, setMotivo] = useState('');
  const [verTodas, setVerTodas] = useState<Set<EtapaFunil>>(new Set());
  const [mensagemPara, setMensagemPara] = useState<CardFunil | null>(null);
  const [configurando, setConfigurando] = useState(false);

  const mudar = (novos: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(novos)) v ? p.set(k, v) : p.delete(k);
    setParams(p, { replace: true });
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: só a digitação dispara
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get('busca') ?? '') !== busca) mudar({ busca: busca || null });
    }, 350);
    return () => clearTimeout(t);
  }, [busca]);

  const filtros = {
    campanhaId: campanhaId || undefined,
    faixa: faixa || undefined,
    busca: params.get('busca') || undefined,
    pendentes: pendentes || undefined,
  };
  const chave = ['quadro', filtros];
  const quadro = useQuery({
    queryKey: chave,
    queryFn: () => api<Quadro>(`/funil${qs(filtros)}`),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const campanhas = useQuery({ queryKey: ['campanhas'], queryFn: () => api<Campanha[]>('/campanhas') });

  const mover = useMutation({
    mutationFn: (d: { empresaId: number; etapa: EtapaFunil; antesDe: number | null; motivo?: string }) =>
      api(`/funil/${d.empresaId}`, {
        metodo: 'PATCH',
        corpo: { etapa: d.etapa, antesDe: d.antesDe, ...(d.motivo ? { motivo: d.motivo } : {}) },
      }),
    // Move na tela na hora; se a API recusar, volta ao que estava.
    onMutate: async (d) => {
      await cliente.cancelQueries({ queryKey: chave });
      const antes = cliente.getQueryData<Quadro>(chave);
      if (antes) {
        const cards = antes.cards.filter((c) => c.empresaId !== d.empresaId);
        const card = antes.cards.find((c) => c.empresaId === d.empresaId);
        if (card) {
          const novo = {
            ...card,
            etapa: d.etapa,
            motivo: d.motivo ?? card.motivo,
            etapaDesde: card.etapa === d.etapa ? card.etapaDesde : new Date().toISOString(),
          };
          const i = d.antesDe != null ? cards.findIndex((c) => c.empresaId === d.antesDe) : -1;
          if (i >= 0) cards.splice(i, 0, novo);
          else cards.push(novo);
        }
        cliente.setQueryData<Quadro>(chave, { ...antes, cards });
      }
      return { antes };
    },
    onError: (_e, _d, ctx) => {
      if (ctx?.antes) cliente.setQueryData(chave, ctx.antes);
    },
    onSettled: (_r, _e, d) => {
      cliente.invalidateQueries({ queryKey: ['quadro'] });
      cliente.invalidateQueries({ queryKey: ['funil', d.empresaId] });
    },
  });

  const colunas = useMemo(() => {
    const grupos = new Map<EtapaFunil, CardFunil[]>(COLUNAS_FUNIL.map((e) => [e, []]));
    for (const c of quadro.data?.cards ?? []) grupos.get(c.etapa)?.push(c);
    // Fechados: os mais recentes primeiro.
    for (const e of FECHADAS) grupos.get(e)?.sort((a, b) => b.etapaDesde.localeCompare(a.etapaDesde));
    return grupos;
  }, [quadro.data]);

  const soltar = (etapa: EtapaFunil) => {
    const card = arrastado;
    const destino = alvo?.etapa === etapa ? alvo.antesDe : null;
    setArrastado(null);
    setAlvo(null);
    if (!card) return;
    if (card.etapa === etapa && destino === null && colunas.get(etapa)?.at(-1)?.empresaId === card.empresaId)
      return;
    if (destino === card.empresaId) return;
    if (etapa === 'perdido' && card.etapa !== 'perdido') {
      setPerda({ card, antesDe: destino });
      setMotivo('');
      return;
    }
    mover.mutate({ empresaId: card.empresaId, etapa, antesDe: destino });
  };

  const cards = quadro.data?.cards ?? [];
  const ativos = cards.filter((c) => !FECHADAS.has(c.etapa));
  const potencial = ativos.reduce((s, c) => s + (c.valorMensal ?? 0), 0);
  const filtrando = !!(filtros.campanhaId || filtros.faixa || filtros.busca || filtros.pendentes);

  return (
    <>
      <div className="topo">
        <div>
          <h1>Funil</h1>
          <p>
            {fmtNumero(ativos.length)} {ativos.length === 1 ? 'lead em andamento' : 'leads em andamento'}
            {potencial > 0 && ` · ${fmtReais(potencial)}/mês em potencial`}
            {quadro.data?.descartados ? ` · ${fmtNumero(quadro.data.descartados)} descartados` : ''}
          </p>
        </div>
        <div className="acoes">
          <label className="pp-sr" htmlFor="funil-campanha">
            Campanha
          </label>
          <select
            id="funil-campanha"
            className="filtro"
            value={campanhaId}
            onChange={(e) => mudar({ campanhaId: e.target.value || null })}
          >
            <option value="">Todas as campanhas</option>
            {campanhas.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
          <label className="pp-sr" htmlFor="funil-faixa">
            Nota
          </label>
          <select
            id="funil-faixa"
            className="filtro"
            value={faixa}
            onChange={(e) => mudar({ faixa: e.target.value || null })}
          >
            <option value="">Todas as notas</option>
            <option value="A">Nota A</option>
            <option value="B">Nota B</option>
            <option value="C">Nota C</option>
          </select>
        </div>
      </div>

      <div className="barra">
        <TextField
          rotulo="Buscar no funil"
          rotuloOculto
          icone="search"
          placeholder="Nome da empresa"
          value={busca}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBusca(e.target.value)}
        />
        <Button
          icon="calendar"
          variant={pendentes ? 'primary' : 'secondary'}
          aria-pressed={pendentes}
          onClick={() => mudar({ pendentes: pendentes ? null : '1' })}
        >
          Follow-ups de hoje{quadro.data ? ` (${fmtNumero(quadro.data.pendentes)})` : ''}
        </Button>
        <Button icon="clock" variant="ghost" onClick={() => setConfigurando(true)}>
          Cadência e mensagens
        </Button>
      </div>

      {perda && (
        <div className="confirmar" role="dialog" aria-label="Motivo da perda">
          <label htmlFor="motivo-perda" style={{ fontWeight: 500 }}>
            Por que perdeu {fmtNome(perda.card.nome)}?
          </label>
          <div className="barra">
            <input
              id="motivo-perda"
              className="filtro"
              style={{ flex: '1 1 260px' }}
              placeholder="Ex.: já tem motoboy próprio, achou caro, fechou com concorrente"
              value={motivo}
              // biome-ignore lint/a11y/noAutofocus: aparece por ação do usuário
              autoFocus
              onChange={(e) => setMotivo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && motivo.trim()) {
                  mover.mutate({
                    empresaId: perda.card.empresaId,
                    etapa: 'perdido',
                    antesDe: perda.antesDe,
                    motivo: motivo.trim(),
                  });
                  setPerda(null);
                }
                if (e.key === 'Escape') setPerda(null);
              }}
            />
            <Button
              size="sm"
              variant="danger"
              disabled={!motivo.trim()}
              onClick={() => {
                mover.mutate({
                  empresaId: perda.card.empresaId,
                  etapa: 'perdido',
                  antesDe: perda.antesDe,
                  motivo: motivo.trim(),
                });
                setPerda(null);
              }}
            >
              Marcar como perdido
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPerda(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      <ErroDaApi erro={quadro.error ?? mover.error} />

      {quadro.isPending ? (
        <div className="quadro" aria-busy="true">
          {COLUNAS_FUNIL.slice(0, 4).map((e) => (
            <div key={e} className="coluna">
              <div className="esqueleto" />
            </div>
          ))}
        </div>
      ) : cards.length === 0 && !filtrando ? (
        <div className="pp-panel">
          <EmptyState
            icone="kanban"
            titulo="O funil está vazio"
            texto="Na tela de Leads, marque os leads que valem a abordagem e clique em Mandar para o funil. Cada empresa vira um card só, mesmo que apareça em outra campanha."
            acao={
              <Button size="sm" variant="primary" onClick={() => navegar('/')}>
                Ir para os leads novos
              </Button>
            }
          />
        </div>
      ) : (
        <>
          {cards.length === 0 && (
            <Mensagem tipo="aviso">
              Nenhum card com esses filtros.{' '}
              <button
                type="button"
                className="link-botao"
                onClick={() => {
                  setBusca('');
                  mudar({ campanhaId: null, faixa: null, busca: null, pendentes: null });
                }}
              >
                Limpar filtros
              </button>
            </Mensagem>
          )}
          <div className="quadro">
            {COLUNAS_FUNIL.map((etapa) => {
              const lista = colunas.get(etapa) ?? [];
              const limitar = FECHADAS.has(etapa) && !verTodas.has(etapa);
              const visiveis = limitar ? lista.slice(0, LIMITE_FECHADAS) : lista;
              const soma = lista.reduce((s, c) => s + (c.valorMensal ?? 0), 0);
              const recebendo = !!arrastado && alvo?.etapa === etapa;
              return (
                <section
                  key={etapa}
                  className="coluna"
                  data-etapa={etapa}
                  data-recebendo={recebendo || undefined}
                  aria-label={`${ROTULO_ETAPA[etapa]}: ${lista.length}`}
                  onDragOver={(e) => {
                    if (!arrastado) return;
                    e.preventDefault();
                    // Sobre a área vazia da coluna: vai para o fim.
                    if (e.target === e.currentTarget || (e.target as HTMLElement).closest('.coluna__fim'))
                      setAlvo({ etapa, antesDe: null });
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setAlvo(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    soltar(etapa);
                  }}
                >
                  <header className="coluna__topo">
                    <span>
                      <b>{ROTULO_ETAPA[etapa]}</b>{' '}
                      <span className="coluna__conta">{fmtNumero(lista.length)}</span>
                    </span>
                    {soma > 0 && <span className="quieto mono">{fmtReais(soma)}</span>}
                  </header>
                  <p className="coluna__dica">{DICA_COLUNA[etapa]}</p>
                  <div className="coluna__cards">
                    {visiveis.map((c, i) => (
                      <Card
                        key={c.empresaId}
                        c={c}
                        totalTentativas={quadro.data?.totalTentativas ?? 4}
                        aoMandarMensagem={() => setMensagemPara(c)}
                        arrastando={arrastado?.empresaId === c.empresaId}
                        marcadorAntes={recebendo && alvo?.antesDe === c.empresaId}
                        aoAbrir={() => mudar({ empresa: String(c.empresaId) })}
                        aoArrastar={(e) => {
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', String(c.empresaId));
                          setArrastado(c);
                        }}
                        aoSoltarSobre={(_e, depois) =>
                          setAlvo({
                            etapa,
                            antesDe: depois ? (visiveis[i + 1]?.empresaId ?? null) : c.empresaId,
                          })
                        }
                      />
                    ))}
                    {recebendo && alvo?.antesDe === null && (
                      <div className="quadro__marcador" aria-hidden="true" />
                    )}
                    <div className="coluna__fim" />
                  </div>
                  {limitar && lista.length > LIMITE_FECHADAS && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setVerTodas((s) => new Set([...s, etapa]))}
                    >
                      Ver todos os {fmtNumero(lista.length)}
                    </Button>
                  )}
                </section>
              );
            })}
          </div>
          <p className="quieto" style={{ margin: 0, fontSize: 12, lineHeight: '16px' }}>
            O próximo passo é marcado sozinho: cada mensagem sem resposta agenda o follow-up seguinte, e quem
            não responde a nenhuma vai para Perdido. Use "Follow-ups de hoje" para ver o que mandar agora.
          </p>
        </>
      )}

      {mensagemPara && (
        <EnvioRapido
          empresaId={mensagemPara.empresaId}
          nome={mensagemPara.nome}
          aoFechar={() => setMensagemPara(null)}
        />
      )}
      {configurando && <ConfigurarCadencia aoFechar={() => setConfigurando(false)} />}

      {empresaAberta && (
        <FichaEmpresa
          id={Number(empresaAberta)}
          aoFechar={() => mudar({ empresa: null })}
          aoAbrir={(id) => mudar({ empresa: String(id) })}
        />
      )}
    </>
  );
}
