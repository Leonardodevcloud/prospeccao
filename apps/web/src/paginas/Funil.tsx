import { Badge, Button, EmptyState, Icon, ScoreBadge, TextField } from '@prospeccao/ui';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type CSSProperties, type DragEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  api,
  type Campanha,
  type CardFunil,
  type EtapaFunil,
  type EtapaPipeline,
  type Quadro,
  qs,
  ROTULO_PAPEL,
} from '../api';
import { ConfigurarCadencia, EnvioRapido } from '../componentes/Cadencia';
import { FichaEmpresa } from '../componentes/FichaEmpresa';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { EditarPipelines, usePipelines } from '../componentes/Pipelines';
import { Dono, useEquipe, useSessao } from '../componentes/Sessao';
import {
  diaDaqui,
  diasDesde,
  fmtCidade,
  fmtCompromisso,
  fmtNome,
  fmtNumero,
  fmtPrazo,
  fmtQuando,
  fmtReais,
  formatarTelefone,
  instanteDoInput,
} from '../formatar';

/** Etapas em que a cadência tem uma mensagem pronta para mandar. */
const COM_MENSAGEM = new Set<EtapaFunil>(['a_abordar', 'abordado', 'respondeu', 'proposta']);

/** Etapas de fechamento mostram só os mais recentes, para a coluna não crescer sem fim. */
const FECHADAS = new Set<EtapaFunil>(['ganho', 'perdido']);
const LIMITE_FECHADAS = 20;

const ORDENS = [
  { id: 'manual', rotulo: 'Ordem do quadro' },
  { id: 'proximo', rotulo: 'Ordenar: próximo passo' },
  { id: 'recentes', rotulo: 'Ordenar: entraram por último' },
  { id: 'contato', rotulo: 'Ordenar: último contato' },
  { id: 'nota', rotulo: 'Ordenar: maior nota' },
  { id: 'valor', rotulo: 'Ordenar: maior valor' },
] as const;

const PERIODOS = [
  { id: '', rotulo: 'Qualquer data' },
  { id: '7', rotulo: 'Entraram em 7 dias' },
  { id: '30', rotulo: 'Entraram em 30 dias' },
  { id: '90', rotulo: 'Entraram em 90 dias' },
] as const;

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
  const cidade = c.cidade ? fmtCidade(c.cidade) : null;
  const comIa = c.agente && !c.agentePausa;
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
            <span className="cartao__cantos">
              {c.faixa && <ScoreBadge faixa={c.faixa} score={c.score ?? undefined} />}
              <Dono id={c.responsavelId} nome={c.responsavelNome} />
            </span>
          </span>
          {(c.naoLidas > 0 || c.reuniaoEm || c.indicacoesNovas > 0) && (
            <span className="cartao__alertas">
              {c.indicacoesNovas > 0 && (
                <span className="etiqueta etiqueta--nova">
                  <Icon name="user-plus" size={12} />{' '}
                  {c.indicacoesNovas === 1
                    ? '1 indicação para confirmar'
                    : `${c.indicacoesNovas} indicações para confirmar`}
                </span>
              )}
              {c.naoLidas > 0 && (
                <span className="etiqueta etiqueta--nova">
                  <Icon name="message-circle" size={12} /> {c.naoLidas}{' '}
                  {c.naoLidas === 1 ? 'mensagem nova' : 'mensagens novas'}
                </span>
              )}
              {c.reuniaoEm && (
                <span className="etiqueta etiqueta--reuniao">
                  <Icon name="calendar-clock" size={12} /> {fmtCompromisso(c.reuniaoEm)}
                </span>
              )}
            </span>
          )}

          {/* Etiquetas: o que é, onde fica, quem está cuidando e as suas. */}
          <span className="etiquetas">
            {c.risco && (
              <span
                className={`etiqueta etiqueta--${c.risco.nivel === 'critico' ? 'critico' : 'risco'}`}
                title={c.risco.motivo}
              >
                <Icon name={c.risco.nivel === 'critico' ? 'circle-x' : 'clock'} size={12} />{' '}
                {c.risco.nivel === 'critico' ? 'Crítico' : 'Em risco'}
              </span>
            )}
            {c.agente && (
              <span className={`etiqueta ${c.agentePausa ? 'etiqueta--aviso' : 'etiqueta--marca'}`}>
                <Icon name="bot" size={12} /> {c.agentePausa ? 'IA passou para você' : 'Com a IA'}
              </span>
            )}
            {c.etiquetas.map((t) => (
              <span key={t} className="etiqueta etiqueta--sua">
                {t}
              </span>
            ))}
            {c.categoria && <span className="etiqueta">{c.categoria}</span>}
            {cidade && (
              <span className="etiqueta">
                <Icon name="map-pin" size={12} /> {cidade}
              </span>
            )}
          </span>

          {/* Contato e decisor */}
          {(c.decisorNome || fone || c.falandoCom) && (
            <span className="cartao__contato">
              {c.decisorNome && (
                <span className="cartao__linha">
                  <Icon name="user-round" size={14} />
                  <span>
                    {fmtNome(c.decisorNome)}
                    {c.decisorCargo && <span className="quieto"> · {c.decisorCargo}</span>}
                  </span>
                </span>
              )}
              {c.falandoCom && (
                <span className="cartao__linha">
                  <Icon name="users" size={14} />
                  <span>
                    Falando com {c.falandoCom}
                    {c.contatosNegociacao > 1 && (
                      <span className="quieto"> · {c.contatosNegociacao} pessoas na negociação</span>
                    )}
                  </span>
                </span>
              )}
              {fone && (
                <span className="cartao__linha mono">
                  <Icon name={c.contatoCanal === 'whatsapp' ? 'message-circle' : 'phone'} size={14} />
                  {fone}
                </span>
              )}
            </span>
          )}

          {/* Atividade: a última fala do lead vale mais que qualquer data. */}
          {c.ultimaDoLead && c.ultimaDoLeadEm ? (
            <span className="cartao__fala">
              <span className="cartao__fala-texto">“{c.ultimaDoLead}”</span>
              <span className="quieto">respondeu {fmtQuando(c.ultimaDoLeadEm)}</span>
            </span>
          ) : c.ultimoContatoEm ? (
            <span className="cartao__linha quieto">
              <Icon name="clock" size={14} />
              <span>
                Último contato {fmtQuando(c.ultimoContatoEm)}
                {c.contatos > 0 && ` · ${c.contatos} ${c.contatos === 1 ? 'contato' : 'contatos'}`}
              </span>
            </span>
          ) : null}

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
              <span className="quieto" title="Mensagens da cadência, valor e tempo nesta etapa">
                {c.etapa === 'abordado' && c.tentativas > 0
                  ? `msg ${Math.min(c.tentativas, props.totalTentativas)}/${props.totalTentativas} · `
                  : ''}
                {c.valorMensal ? `${fmtReais(c.valorMensal)} · ` : ''}
                {dias === 0 ? 'hoje' : `${dias} d`}
              </span>
            </span>
          )}
        </button>
        {COM_MENSAGEM.has(c.etapa) && c.telefone && !c.encerrarEm && !comIa && (
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

type Alvo = { etapaId: number; antesDe: number | null };

export function Funil() {
  const [params, setParams] = useSearchParams();
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const campanhaId = params.get('campanhaId') ?? '';
  const faixa = params.get('faixa') ?? '';
  const pendentes = params.get('pendentes') === '1';
  const ordem = params.get('ordem') ?? 'manual';
  const dias = params.get('dias') ?? '';
  const etiqueta = params.get('etiqueta') ?? '';
  const responsavel = params.get('responsavel') ?? '';
  const sessao = useSessao();
  const equipe = useEquipe();
  const empresaAberta = params.get('empresa');
  const [busca, setBusca] = useState(params.get('busca') ?? '');
  const [arrastado, setArrastado] = useState<CardFunil | null>(null);
  const [alvo, setAlvo] = useState<Alvo | null>(null);
  const [perda, setPerda] = useState<{ card: CardFunil; alvo: Alvo } | null>(null);
  const [reuniao, setReuniao] = useState<{ card: CardFunil; alvo: Alvo } | null>(null);
  const [reuniaoDia, setReuniaoDia] = useState('');
  const [reuniaoHora, setReuniaoHora] = useState('10:00');
  const [reuniaoLocal, setReuniaoLocal] = useState('');
  const [motivo, setMotivo] = useState('');
  const [verTodas, setVerTodas] = useState<Set<number>>(new Set());
  const [mensagemPara, setMensagemPara] = useState<CardFunil | null>(null);
  const [configurando, setConfigurando] = useState(false);
  const [editando, setEditando] = useState(false);

  const pipelines = usePipelines();
  const pedido = Number(params.get('pipeline')) || null;
  const pipeline = pipelines.data?.find((p) => p.id === pedido) ?? pipelines.data?.[0];
  const etapas = useMemo(() => pipeline?.etapas ?? [], [pipeline]);

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
    pipelineId: pipeline?.id,
    campanhaId: campanhaId || undefined,
    faixa: faixa || undefined,
    busca: params.get('busca') || undefined,
    pendentes: pendentes || undefined,
    ordem: ordem !== 'manual' ? ordem : undefined,
    dias: dias || undefined,
    etiqueta: etiqueta || undefined,
    responsavel: responsavel === 'eu' ? sessao.data?.id : responsavel || undefined,
  };
  const chave = ['quadro', filtros];
  const quadro = useQuery({
    queryKey: chave,
    queryFn: () => api<Quadro>(`/funil${qs(filtros)}`),
    enabled: !!pipeline,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const campanhas = useQuery({ queryKey: ['campanhas'], queryFn: () => api<Campanha[]>('/campanhas') });

  const mover = useMutation({
    mutationFn: (d: {
      empresaId: number;
      etapaId: number;
      antesDe: number | null;
      motivo?: string;
      reuniao?: { inicio: string; local?: string };
    }) =>
      api(`/funil/${d.empresaId}`, {
        metodo: 'PATCH',
        corpo: {
          etapaId: d.etapaId,
          antesDe: d.antesDe,
          ...(d.motivo ? { motivo: d.motivo } : {}),
          ...(d.reuniao ? { reuniao: d.reuniao } : {}),
        },
      }),
    // Move na tela na hora; se a API recusar, volta ao que estava.
    onMutate: async (d) => {
      await cliente.cancelQueries({ queryKey: chave });
      const antes = cliente.getQueryData<Quadro>(chave);
      if (antes) {
        const cards = antes.cards.filter((c) => c.empresaId !== d.empresaId);
        const card = antes.cards.find((c) => c.empresaId === d.empresaId);
        if (card) {
          const novo: CardFunil = {
            ...card,
            etapaId: d.etapaId,
            etapa: etapas.find((e) => e.id === d.etapaId)?.papel ?? card.etapa,
            motivo: d.motivo ?? card.motivo,
            etapaDesde: card.etapaId === d.etapaId ? card.etapaDesde : new Date().toISOString(),
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
      cliente.invalidateQueries({ queryKey: ['pipelines'] });
      cliente.invalidateQueries({ queryKey: ['funil', d.empresaId] });
      if (d.reuniao) {
        cliente.invalidateQueries({ queryKey: ['agenda'] });
        cliente.invalidateQueries({ queryKey: ['meu-dia'] });
      }
    },
  });

  const colunas = useMemo(() => {
    const grupos = new Map<number, CardFunil[]>(etapas.map((e) => [e.id, []]));
    for (const c of quadro.data?.cards ?? []) if (c.etapaId != null) grupos.get(c.etapaId)?.push(c);
    // Fechados, na ordem do quadro: os mais recentes primeiro.
    if (ordem === 'manual')
      for (const e of etapas)
        if (FECHADAS.has(e.papel)) grupos.get(e.id)?.sort((a, b) => b.etapaDesde.localeCompare(a.etapaDesde));
    return grupos;
  }, [quadro.data, etapas, ordem]);

  const soltar = (etapa: EtapaPipeline) => {
    const card = arrastado;
    const destino = alvo?.etapaId === etapa.id ? alvo.antesDe : null;
    setArrastado(null);
    setAlvo(null);
    if (!card) return;
    if (
      card.etapaId === etapa.id &&
      destino === null &&
      colunas.get(etapa.id)?.at(-1)?.empresaId === card.empresaId
    )
      return;
    if (destino === card.empresaId) return;
    if (etapa.papel === 'perdido' && card.etapa !== 'perdido') {
      setPerda({ card, alvo: { etapaId: etapa.id, antesDe: destino } });
      setMotivo('');
      return;
    }
    // Entrou em reunião agora: pergunta dia e hora (vai para a agenda e o lembrete sai sozinho).
    if (etapa.papel === 'reuniao' && card.etapa !== 'reuniao' && !card.reuniaoEm) {
      setReuniao({ card, alvo: { etapaId: etapa.id, antesDe: destino } });
      setReuniaoDia(diaDaqui(1));
      setReuniaoLocal('');
      return;
    }
    mover.mutate({ empresaId: card.empresaId, etapaId: etapa.id, antesDe: destino });
  };

  const confirmarReuniao = (comData: boolean) => {
    if (!reuniao) return;
    mover.mutate({
      empresaId: reuniao.card.empresaId,
      etapaId: reuniao.alvo.etapaId,
      antesDe: reuniao.alvo.antesDe,
      ...(comData && reuniaoDia
        ? {
            reuniao: {
              inicio: instanteDoInput(reuniaoDia, reuniaoHora),
              local: reuniaoLocal.trim() || undefined,
            },
          }
        : {}),
    });
    setReuniao(null);
  };

  const confirmarPerda = () => {
    if (!perda || !motivo.trim()) return;
    mover.mutate({
      empresaId: perda.card.empresaId,
      etapaId: perda.alvo.etapaId,
      antesDe: perda.alvo.antesDe,
      motivo: motivo.trim(),
    });
    setPerda(null);
  };

  const cards = quadro.data?.cards ?? [];
  const ativos = cards.filter((c) => !FECHADAS.has(c.etapa));
  const potencial = ativos.reduce((s, c) => s + (c.valorMensal ?? 0), 0);
  const filtrando = !!(
    filtros.campanhaId ||
    filtros.faixa ||
    filtros.busca ||
    filtros.pendentes ||
    filtros.dias ||
    filtros.etiqueta ||
    filtros.responsavel
  );
  const funilVazio = (pipelines.data ?? []).every((p) => p.abertos === 0) && cards.length === 0;
  const todasEtiquetas = quadro.data?.etiquetas ?? [];

  return (
    <>
      <div className="topo">
        <div>
          <h1>Funil</h1>
          <p>
            {fmtNumero(ativos.length)} {ativos.length === 1 ? 'lead em andamento' : 'leads em andamento'}
            {pipeline ? ` no ${pipeline.nome}` : ''}
            {potencial > 0 && ` · ${fmtReais(potencial)}/mês em potencial`}
            {quadro.data?.descartados ? ` · ${fmtNumero(quadro.data.descartados)} descartados` : ''}
          </p>
        </div>
        {sessao.data?.papel === 'admin' && (
          <div className="acoes">
            <Button
              icon="file-down"
              variant="ghost"
              href={`/api/exportar/funil${qs(filtros)}`}
              title="Baixa os leads deste pipeline, com os filtros da tela, numa planilha do Excel"
            >
              Exportar
            </Button>
            <Button icon="clock" variant="ghost" onClick={() => setConfigurando(true)}>
              Cadência e mensagens
            </Button>
            <Button icon="layers" variant="secondary" onClick={() => setEditando(true)}>
              Editar etapas
            </Button>
          </div>
        )}
      </div>

      {/* Pipelines (SDR, Closer…) */}
      <div className="pipelines" role="tablist" aria-label="Pipeline">
        {pipelines.data?.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={p.id === pipeline?.id}
            className="pipelines__aba"
            onClick={() => mudar({ pipeline: String(p.id), empresa: null })}
          >
            {p.nome}
            <span className="pipelines__conta">{fmtNumero(p.abertos)}</span>
          </button>
        ))}
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
        <label className="pp-sr" htmlFor="funil-ordem">
          Ordenar
        </label>
        <select
          id="funil-ordem"
          className="filtro"
          value={ordem}
          onChange={(e) => mudar({ ordem: e.target.value === 'manual' ? null : e.target.value })}
        >
          {ORDENS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.rotulo}
            </option>
          ))}
        </select>
        <label className="pp-sr" htmlFor="funil-periodo">
          Entrou no funil
        </label>
        <select
          id="funil-periodo"
          className="filtro"
          value={dias}
          onChange={(e) => mudar({ dias: e.target.value || null })}
        >
          {PERIODOS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.rotulo}
            </option>
          ))}
        </select>
        {todasEtiquetas.length > 0 && (
          <>
            <label className="pp-sr" htmlFor="funil-etiqueta">
              Etiqueta
            </label>
            <select
              id="funil-etiqueta"
              className="filtro"
              value={etiqueta}
              onChange={(e) => mudar({ etiqueta: e.target.value || null })}
            >
              <option value="">Todas as etiquetas</option>
              {todasEtiquetas.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </>
        )}
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
        {(equipe.data?.usuarios.filter((u) => u.ativo).length ?? 0) > 1 && (
          <>
            <label className="pp-sr" htmlFor="funil-responsavel">
              Responsável
            </label>
            <select
              id="funil-responsavel"
              className="filtro"
              value={responsavel}
              onChange={(e) => mudar({ responsavel: e.target.value || null })}
            >
              <option value="">Todos os responsáveis</option>
              <option value="eu">Meus leads</option>
              <option value="sem">Sem responsável</option>
              {equipe.data?.usuarios
                .filter((u) => u.ativo && u.id !== sessao.data?.id)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nome}
                  </option>
                ))}
            </select>
          </>
        )}
      </div>

      {reuniao && (
        <div className="confirmar" role="dialog" aria-label="Quando é a reunião">
          <span style={{ fontWeight: 500 }}>Quando é a reunião com {fmtNome(reuniao.card.nome)}?</span>
          <div className="barra">
            <label className="pp-sr" htmlFor="reuniao-dia">
              Dia
            </label>
            <input
              id="reuniao-dia"
              className="filtro"
              type="date"
              value={reuniaoDia}
              onChange={(e) => setReuniaoDia(e.target.value)}
            />
            <label className="pp-sr" htmlFor="reuniao-hora">
              Hora
            </label>
            <input
              id="reuniao-hora"
              className="filtro"
              type="time"
              value={reuniaoHora}
              onChange={(e) => setReuniaoHora(e.target.value)}
            />
            <label className="pp-sr" htmlFor="reuniao-local">
              Link ou local
            </label>
            <input
              id="reuniao-local"
              className="filtro"
              style={{ flex: '1 1 220px' }}
              placeholder="Link do Meet ou endereço (opcional)"
              value={reuniaoLocal}
              onChange={(e) => setReuniaoLocal(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && confirmarReuniao(true)}
            />
            <Button
              size="sm"
              variant="primary"
              icon="calendar-plus"
              disabled={!reuniaoDia}
              onClick={() => confirmarReuniao(true)}
            >
              Marcar reunião
            </Button>
            <Button size="sm" variant="ghost" onClick={() => confirmarReuniao(false)}>
              Mover sem data
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setReuniao(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

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
              placeholder="Ex.: já tem fornecedor, achou caro, fechou com concorrente"
              value={motivo}
              // biome-ignore lint/a11y/noAutofocus: aparece por ação do usuário
              autoFocus
              onChange={(e) => setMotivo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmarPerda();
                if (e.key === 'Escape') setPerda(null);
              }}
            />
            <Button size="sm" variant="danger" disabled={!motivo.trim()} onClick={confirmarPerda}>
              Marcar como perdido
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPerda(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      <ErroDaApi erro={pipelines.error ?? quadro.error ?? mover.error} />

      {pipelines.isPending || (quadro.isPending && !!pipeline) ? (
        <div className="quadro" aria-busy="true">
          {[1, 2, 3, 4].map((e) => (
            <div key={e} className="coluna">
              <div className="esqueleto" />
            </div>
          ))}
        </div>
      ) : funilVazio && !filtrando ? (
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
          {cards.length === 0 && filtrando && (
            <Mensagem tipo="aviso">
              Nenhum card com esses filtros.{' '}
              <button
                type="button"
                className="link-botao"
                onClick={() => {
                  setBusca('');
                  mudar({
                    campanhaId: null,
                    faixa: null,
                    busca: null,
                    pendentes: null,
                    dias: null,
                    etiqueta: null,
                    responsavel: null,
                  });
                }}
              >
                Limpar filtros
              </button>
            </Mensagem>
          )}
          <div className="quadro">
            {etapas.map((etapa) => {
              const lista = colunas.get(etapa.id) ?? [];
              const limitar = FECHADAS.has(etapa.papel) && !verTodas.has(etapa.id);
              const visiveis = limitar ? lista.slice(0, LIMITE_FECHADAS) : lista;
              const soma = lista.reduce((s, c) => s + (c.valorMensal ?? 0), 0);
              const recebendo = !!arrastado && alvo?.etapaId === etapa.id;
              return (
                <section
                  key={etapa.id}
                  className="coluna"
                  style={{ '--cor-etapa': etapa.cor } as CSSProperties}
                  data-recebendo={recebendo || undefined}
                  aria-label={`${etapa.nome}: ${lista.length}`}
                  onDragOver={(e) => {
                    if (!arrastado) return;
                    e.preventDefault();
                    // Sobre a área vazia da coluna: vai para o fim.
                    if (
                      e.target === e.currentTarget ||
                      (e.target as HTMLElement).closest('.coluna__fim, .coluna__vazia')
                    )
                      setAlvo({ etapaId: etapa.id, antesDe: null });
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
                    <span className="coluna__nome" title={`Funciona como: ${ROTULO_PAPEL[etapa.papel]}`}>
                      <b>{etapa.nome}</b>
                      <span className="coluna__conta">{fmtNumero(lista.length)}</span>
                    </span>
                    {soma > 0 && <span className="coluna__soma mono">{fmtReais(soma)}</span>}
                  </header>
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
                            etapaId: etapa.id,
                            antesDe: depois ? (visiveis[i + 1]?.empresaId ?? null) : c.empresaId,
                          })
                        }
                      />
                    ))}
                    {lista.length === 0 && !recebendo && <p className="coluna__vazia">Nenhum lead aqui</p>}
                    {recebendo && alvo?.antesDe === null && (
                      <div className="quadro__marcador" aria-hidden="true" />
                    )}
                    <div className="coluna__fim" />
                  </div>
                  {limitar && lista.length > LIMITE_FECHADAS && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setVerTodas((s) => new Set([...s, etapa.id]))}
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
            não responde vai para Perdido. Quando a reunião é marcada, o lead passa sozinho do SDR para o
            Closer.
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
      {editando && (
        <EditarPipelines
          pipelineId={pipeline?.id ?? null}
          aoFechar={() => setEditando(false)}
          aoTrocar={(id) => mudar({ pipeline: String(id) })}
        />
      )}

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
