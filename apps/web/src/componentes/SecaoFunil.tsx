import type { TimelineItem } from '@prospeccao/ui';
import { Badge, Button, Panel, Timeline } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  type AtividadeFunil,
  api,
  type DetalheFunil,
  type EtapaFunil,
  type ResultadoAdicionar,
  ROTULO_ETAPA,
  type TipoAtividade,
} from '../api';
import { diaDaqui, diaDoInput, fmtHora, fmtNome, fmtPrazo, formatarTelefone } from '../formatar';
import { ProximaMensagem } from './Cadencia';
import { ErroDaApi, Mensagem } from './Formulario';
import { usePipelines } from './Pipelines';

const TIPOS: { id: Exclude<TipoAtividade, 'etapa'>; rotulo: string }[] = [
  { id: 'whatsapp', rotulo: 'WhatsApp' },
  { id: 'ligacao', rotulo: 'Ligação' },
  { id: 'email', rotulo: 'E-mail' },
  { id: 'visita', rotulo: 'Visita' },
  { id: 'reuniao', rotulo: 'Reunião' },
  { id: 'nota', rotulo: 'Nota' },
];

const NOME_TIPO: Record<TipoAtividade, string> = {
  whatsapp: 'WhatsApp',
  ligacao: 'Ligação',
  email: 'E-mail',
  visita: 'Visita',
  reuniao: 'Reunião',
  nota: 'Nota',
  etapa: 'Etapa',
};

/** Atalhos de prazo para o próximo passo. */
const PRAZOS = [
  { rotulo: 'Amanhã', dias: 1 },
  { rotulo: '3 dias', dias: 3 },
  { rotulo: '1 semana', dias: 7 },
];

/** Etapas que pedem motivo (ajuda a entender o que não funcionou). */
const PEDE_MOTIVO = new Set<EtapaFunil>(['perdido', 'descartado']);

function itemDaTimeline(a: AtividadeFunil): TimelineItem {
  if (a.tipo === 'etapa') {
    return {
      tipo: 'etapa',
      titulo: a.deEtapa
        ? `${a.deNome ?? ROTULO_ETAPA[a.deEtapa]} → ${a.paraNome ?? ROTULO_ETAPA[a.paraEtapa ?? 'a_abordar']}`
        : `Entrou no funil em ${a.paraNome ?? ROTULO_ETAPA[a.paraEtapa ?? 'a_abordar']}`,
      quando: fmtHora(a.em),
      texto: a.texto ?? undefined,
    };
  }
  const contato = a.contato
    ? ` · ${/^\d{10,11}$/.test(a.contato) ? formatarTelefone(a.contato) : a.contato}`
    : '';
  const sentido = a.direcao === 'recebida' ? 'recebido' : a.direcao === 'enviada' ? 'enviado' : '';
  return {
    tipo:
      a.tipo === 'nota'
        ? 'nota'
        : a.tipo === 'ligacao'
          ? 'ligacao'
          : a.tipo === 'email'
            ? 'email'
            : a.tipo === 'whatsapp'
              ? a.direcao === 'recebida'
                ? 'mensagem_recebida'
                : 'mensagem_enviada'
              : 'tarefa',
    titulo: `${NOME_TIPO[a.tipo]}${sentido ? ` ${sentido}` : ''}${contato}`,
    quando: fmtHora(a.em),
    texto: a.texto ?? undefined,
  };
}

/** Suas etiquetas no lead (Indicação, Farma, +50 entregas…). Enter adiciona; × tira. */
function Etiquetas(props: { atuais: string[]; salvando: boolean; aoSalvar: (e: string[]) => void }) {
  const [nova, setNova] = useState('');
  const sugestoes = useQuery({
    queryKey: ['etiquetas'],
    queryFn: () => api<string[]>('/funil/etiquetas'),
    staleTime: 60_000,
  });
  const adicionar = () => {
    const t = nova.trim().slice(0, 30);
    setNova('');
    if (!t || props.atuais.some((a) => a.toLowerCase() === t.toLowerCase()) || props.atuais.length >= 12)
      return;
    props.aoSalvar([...props.atuais, t]);
  };
  return (
    <div className="campo" style={{ marginTop: 12 }}>
      <label htmlFor="funil-etiqueta-nova">Etiquetas</label>
      <div className="etiquetas-edit">
        {props.atuais.map((t) => (
          <span key={t} className="etiqueta etiqueta--sua">
            {t}
            <button
              type="button"
              className="etiqueta__tirar"
              aria-label={`Tirar a etiqueta ${t}`}
              disabled={props.salvando}
              onClick={() => props.aoSalvar(props.atuais.filter((a) => a !== t))}
            >
              ×
            </button>
          </span>
        ))}
        <input
          id="funil-etiqueta-nova"
          className="etiquetas-edit__campo"
          list="funil-etiquetas-sugestoes"
          placeholder={props.atuais.length ? 'Adicionar' : 'Ex.: Indicação, Farma, Prioridade'}
          maxLength={30}
          value={nova}
          onChange={(e) => setNova(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              adicionar();
            }
          }}
          onBlur={adicionar}
        />
        <datalist id="funil-etiquetas-sugestoes">
          {(sugestoes.data ?? [])
            .filter((t) => !props.atuais.includes(t))
            .map((t) => (
              <option key={t} value={t} />
            ))}
        </datalist>
      </div>
    </div>
  );
}

/** Campo de motivo + confirmação para perdido/descartado. */
function PedirMotivo(props: {
  etapa: EtapaFunil;
  enviando: boolean;
  aoConfirmar: (motivo: string) => void;
  aoCancelar: () => void;
}) {
  const [motivo, setMotivo] = useState('');
  const id = `motivo-${props.etapa}`;
  return (
    <div className="confirmar" style={{ display: 'grid', gap: 8 }}>
      <div className="campo">
        <label htmlFor={id}>{props.etapa === 'perdido' ? 'Por que perdeu?' : 'Por que descartar?'}</label>
        <input
          id={id}
          className="filtro"
          value={motivo}
          // biome-ignore lint/a11y/noAutofocus: o campo aparece por ação do usuário
          autoFocus
          placeholder={
            props.etapa === 'perdido'
              ? 'Ex.: já tem motoboy próprio, achou caro'
              : 'Ex.: atacadista, não entrega'
          }
          onChange={(e) => setMotivo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && motivo.trim()) props.aoConfirmar(motivo.trim());
          }}
        />
      </div>
      <div className="acoes">
        <Button
          size="sm"
          variant={props.etapa === 'perdido' ? 'danger' : 'secondary'}
          disabled={!motivo.trim() || props.enviando}
          onClick={() => props.aoConfirmar(motivo.trim())}
        >
          {props.enviando
            ? 'Salvando…'
            : props.etapa === 'perdido'
              ? 'Marcar como perdido'
              : 'Descartar lead'}
        </Button>
        <Button size="sm" variant="ghost" onClick={props.aoCancelar}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

/**
 * O que foi feito com o lead: etapa, próximo passo, contatos registrados e histórico.
 * Antes de entrar no funil, oferece "Mandar para o funil" ou "Descartar".
 */
export function SecaoFunil(props: {
  empresaId: number;
  /** Contato principal (para pré-preencher o registro e abrir o WhatsApp). */
  contatoPrincipal: { canal: string; valor: string } | null;
  aoAbrirEmpresa?: (id: number) => void;
}) {
  const { empresaId } = props;
  const cliente = useQueryClient();
  const q = useQuery({
    queryKey: ['funil', empresaId],
    queryFn: () => api<DetalheFunil>(`/funil/${empresaId}`),
  });
  const atualizarCache = (d: DetalheFunil) => {
    cliente.setQueryData(['funil', empresaId], d);
    cliente.invalidateQueries({ queryKey: ['funil', empresaId, 'mensagem'] });
    cliente.invalidateQueries({ queryKey: ['quadro'] });
    cliente.invalidateQueries({ queryKey: ['pipelines'] });
    cliente.invalidateQueries({ queryKey: ['etiquetas'] });
    cliente.invalidateQueries({ queryKey: ['empresas'] });
  };

  const adicionar = useMutation({
    mutationFn: (d: { etapa: 'a_abordar' | 'descartado'; motivo?: string; forcar?: boolean }) =>
      api<ResultadoAdicionar>('/funil', { metodo: 'POST', corpo: { empresaIds: [empresaId], ...d } }),
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: ['funil', empresaId] });
      cliente.invalidateQueries({ queryKey: ['quadro'] });
      cliente.invalidateQueries({ queryKey: ['empresas'] });
    },
  });
  const atualizar = useMutation({
    mutationFn: (corpo: Record<string, unknown>) =>
      api<DetalheFunil>(`/funil/${empresaId}`, { metodo: 'PATCH', corpo }),
    onSuccess: atualizarCache,
  });
  const registrar = useMutation({
    mutationFn: (corpo: Record<string, unknown>) =>
      api<DetalheFunil>(`/funil/${empresaId}/atividades`, { metodo: 'POST', corpo }),
    onSuccess: (d) => {
      atualizarCache(d);
      setTexto('');
    },
  });
  const remover = useMutation({
    mutationFn: () => api(`/funil/${empresaId}`, { metodo: 'DELETE' }),
    onSuccess: () => {
      setConfirmarRemover(false);
      cliente.invalidateQueries({ queryKey: ['funil', empresaId] });
      cliente.invalidateQueries({ queryKey: ['quadro'] });
      cliente.invalidateQueries({ queryKey: ['empresas'] });
    },
  });

  const [motivoPara, setMotivoPara] = useState<EtapaFunil | null>(null);
  /** Etapa do pipeline escolhida enquanto pede o motivo da perda. */
  const [motivoEtapaId, setMotivoEtapaId] = useState<number | null>(null);
  const pipelines = usePipelines();
  const [confirmarRemover, setConfirmarRemover] = useState(false);
  const [tipo, setTipo] = useState<Exclude<TipoAtividade, 'etapa'>>('whatsapp');
  const [direcao, setDirecao] = useState<'enviada' | 'recebida'>('enviada');
  const [texto, setTexto] = useState('');
  const [proximaAcao, setProximaAcao] = useState('');
  const [proximaEm, setProximaEm] = useState('');
  const [valor, setValor] = useState('');

  const op = q.data?.oportunidade ?? null;
  // Mantém os campos de próximo passo e valor em dia com o que vem do servidor.
  useEffect(() => {
    setProximaAcao(op?.proximaAcao ?? '');
    setProximaEm(diaDoInput(op?.proximaAcaoEm));
    setValor(op?.valorMensal != null ? String(op.valorMensal) : '');
  }, [op?.proximaAcao, op?.proximaAcaoEm, op?.valorMensal]);

  if (q.isPending) return <div className="esqueleto" />;
  if (q.error) return <ErroDaApi erro={q.error} />;
  const d = q.data;
  const dup = d.duplicada;
  const prazo = fmtPrazo(op?.proximaAcaoEm);
  const whatsapp =
    props.contatoPrincipal?.canal === 'whatsapp' || props.contatoPrincipal?.canal === 'telefone'
      ? props.contatoPrincipal.valor
      : null;

  const aviso = dup && (
    <Mensagem tipo="aviso">
      O telefone {formatarTelefone(dup.telefone)} também é de{' '}
      {props.aoAbrirEmpresa ? (
        <button
          type="button"
          className="link-botao"
          onClick={() => props.aoAbrirEmpresa?.(dup.outraEmpresaId)}
        >
          {fmtNome(dup.outraNome)}
        </button>
      ) : (
        <b>{fmtNome(dup.outraNome)}</b>
      )}
      , que já está no funil em <b>{ROTULO_ETAPA[dup.outraEtapa]}</b>. Pode ser a mesma loja: cuidado para não
      abordar duas vezes.
    </Mensagem>
  );

  // Ainda não trabalhado.
  if (!op) {
    const resultado = adicionar.data;
    return (
      <section className="secao">
        <h2>Funil</h2>
        <div className="pilha">
          {aviso}
          {resultado?.duplicadas.length ? (
            <Mensagem tipo="aviso">
              Não entrou no funil porque o telefone já está em outra empresa trabalhada. Se for outra loja,
              use "Mandar mesmo assim".
            </Mensagem>
          ) : null}
          <Panel>
            <p style={{ margin: '0 0 12px', fontSize: 14 }}>
              Lead ainda não trabalhado. Mande para o funil para abordar, ou descarte se estiver fora do
              perfil: ele não volta a aparecer como novo quando a campanha rodar de novo.
            </p>
            {motivoPara === 'descartado' ? (
              <PedirMotivo
                etapa="descartado"
                enviando={adicionar.isPending}
                aoCancelar={() => setMotivoPara(null)}
                aoConfirmar={(motivo) =>
                  adicionar.mutate({ etapa: 'descartado', motivo }, { onSuccess: () => setMotivoPara(null) })
                }
              />
            ) : (
              <div className="acoes">
                <Button
                  variant="primary"
                  icon="kanban"
                  disabled={adicionar.isPending}
                  onClick={() =>
                    adicionar.mutate({ etapa: 'a_abordar', forcar: !!resultado?.duplicadas.length })
                  }
                >
                  {resultado?.duplicadas.length ? 'Mandar mesmo assim' : 'Mandar para o funil'}
                </Button>
                <Button variant="ghost" icon="x" onClick={() => setMotivoPara('descartado')}>
                  Descartar
                </Button>
              </div>
            )}
          </Panel>
          <ErroDaApi erro={adicionar.error} />
        </div>
      </section>
    );
  }

  // Valor do select: "e:<id>" para etapas do pipeline, "descartado" para tirar do funil.
  const etapasTodas = (pipelines.data ?? []).flatMap((p) => p.etapas);
  const valorEtapa =
    motivoPara === 'descartado'
      ? 'descartado'
      : motivoEtapaId
        ? `e:${motivoEtapaId}`
        : op.etapa === 'descartado'
          ? 'descartado'
          : op.etapaId
            ? `e:${op.etapaId}`
            : '';
  const mudarEtapa = (v: string) => {
    if (v === valorEtapa) return;
    if (v === 'descartado') {
      setMotivoEtapaId(null);
      setMotivoPara('descartado');
      return;
    }
    const et = etapasTodas.find((e) => `e:${e.id}` === v);
    if (!et) return;
    if (et.papel === 'perdido' && op.etapa !== 'perdido') {
      setMotivoEtapaId(et.id);
      setMotivoPara('perdido');
    } else atualizar.mutate({ etapaId: et.id });
  };
  const cancelarMotivo = () => {
    setMotivoPara(null);
    setMotivoEtapaId(null);
  };

  const salvarProximo = (dia: string, acao = proximaAcao) =>
    atualizar.mutate({ proximaAcao: acao, proximaAcaoEm: dia || null });

  return (
    <section className="secao">
      <h2>
        Funil{' '}
        <small>
          {op.pipelineNome ? `${op.pipelineNome} · ` : ''}
          {op.etapaNome ?? ROTULO_ETAPA[op.etapa]} desde {fmtHora(op.etapaDesde)}
        </small>
      </h2>
      <div className="pilha">
        {aviso}
        {op.agente && op.agentePausa && (
          <Mensagem tipo="aviso">
            A IA passou este lead para você: {op.agentePausa}{' '}
            <button
              type="button"
              className="link-botao"
              onClick={() => atualizar.mutate({ devolverParaIa: true })}
            >
              Devolver para a IA
            </button>
          </Mensagem>
        )}
        {op.encerrarEm && op.etapa === 'abordado' && (
          <Mensagem tipo="aviso">
            Todas as mensagens da cadência foram enviadas. Se não responder até {fmtHora(op.encerrarEm)}, o
            lead vai sozinho para Perdido (sem resposta).
          </Mensagem>
        )}
        {op.motivo && PEDE_MOTIVO.has(op.etapa) && (
          <Mensagem tipo="aviso">
            {op.etapa === 'perdido' ? 'Perdido' : 'Descartado'}: {op.motivo}
          </Mensagem>
        )}

        <Panel>
          <div className="funil-ficha">
            <div className="campo">
              <label htmlFor="funil-etapa">Etapa</label>
              <select
                id="funil-etapa"
                value={valorEtapa}
                disabled={atualizar.isPending || pipelines.isPending}
                onChange={(e) => mudarEtapa(e.target.value)}
              >
                {!valorEtapa && <option value="">{ROTULO_ETAPA[op.etapa]}</option>}
                {pipelines.data?.map((p) => (
                  <optgroup key={p.id} label={p.nome}>
                    {p.etapas.map((et) => (
                      <option key={et.id} value={`e:${et.id}`}>
                        {et.nome}
                      </option>
                    ))}
                  </optgroup>
                ))}
                <optgroup label="Fora do funil">
                  <option value="descartado">Descartado</option>
                </optgroup>
              </select>
            </div>
            <div className="campo">
              <label htmlFor="funil-valor">Potencial (R$/mês)</label>
              <input
                id="funil-valor"
                className="filtro"
                inputMode="decimal"
                placeholder="Ex.: 1500"
                value={valor}
                onChange={(e) => setValor(e.target.value.replace(/[^\d,.]/g, ''))}
                onBlur={() => {
                  const n = valor ? Number(valor.replace(/\./g, '').replace(',', '.')) : null;
                  if (n !== (op.valorMensal ?? null) && (n == null || Number.isFinite(n)))
                    atualizar.mutate({ valorMensal: n });
                }}
              />
            </div>
          </div>
          {!['ganho', 'perdido', 'descartado'].includes(op.etapa) && (
            <label className="opcao" style={{ marginTop: 12 }}>
              <input
                type="checkbox"
                checked={!!op.agente}
                disabled={atualizar.isPending}
                onChange={(e) => atualizar.mutate({ agente: e.target.checked })}
              />
              A IA conduz este lead (aborda, responde e marca reunião pelo WhatsApp; ligue o agente na tela
              Agente)
            </label>
          )}
          <Etiquetas
            atuais={op.etiquetas ?? []}
            salvando={atualizar.isPending}
            aoSalvar={(etiquetas) => atualizar.mutate({ etiquetas })}
          />
          {motivoPara && (
            <div style={{ marginTop: 12 }}>
              <PedirMotivo
                etapa={motivoPara}
                enviando={atualizar.isPending}
                aoCancelar={cancelarMotivo}
                aoConfirmar={(motivo) =>
                  atualizar.mutate(
                    motivoEtapaId ? { etapaId: motivoEtapaId, motivo } : { etapa: motivoPara, motivo },
                    { onSuccess: cancelarMotivo },
                  )
                }
              />
            </div>
          )}

          <div className="campo" style={{ marginTop: 16 }}>
            <label htmlFor="funil-proximo">
              Próximo passo{' '}
              {prazo && (
                <Badge
                  tone={prazo.tom === 'atrasado' ? 'danger' : prazo.tom === 'hoje' ? 'warning' : 'neutral'}
                >
                  {prazo.texto}
                </Badge>
              )}
            </label>
            <div className="funil-proximo">
              <input
                id="funil-proximo"
                className="filtro"
                placeholder="Ex.: cobrar resposta, mandar proposta"
                value={proximaAcao}
                onChange={(e) => setProximaAcao(e.target.value)}
                onBlur={() => {
                  if (proximaAcao !== (op.proximaAcao ?? '')) salvarProximo(proximaEm);
                }}
              />
              <label className="pp-sr" htmlFor="funil-proximo-dia">
                Data do próximo passo
              </label>
              <input
                id="funil-proximo-dia"
                className="filtro"
                type="date"
                value={proximaEm}
                onChange={(e) => {
                  setProximaEm(e.target.value);
                  salvarProximo(e.target.value);
                }}
              />
            </div>
            <div className="acoes">
              {PRAZOS.map((p) => (
                <Button
                  key={p.dias}
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const dia = diaDaqui(p.dias);
                    setProximaEm(dia);
                    salvarProximo(dia, proximaAcao || 'Retomar contato');
                  }}
                >
                  {p.rotulo}
                </Button>
              ))}
              {op.proximaAcaoEm && (
                <Button size="sm" variant="ghost" onClick={() => salvarProximo('', '')}>
                  Limpar
                </Button>
              )}
            </div>
          </div>
          <ErroDaApi erro={atualizar.error} />
        </Panel>

        {['a_abordar', 'abordado', 'respondeu', 'proposta'].includes(op.etapa) && !op.encerrarEm && (
          <Panel titulo="Próxima mensagem">
            <ProximaMensagem empresaId={empresaId} />
          </Panel>
        )}

        <Panel
          titulo="Registrar contato"
          acoes={
            whatsapp ? (
              <Button
                size="sm"
                icon="message-circle"
                href={`https://wa.me/55${whatsapp.replace(/\D/g, '')}`}
                target="_blank"
                rel="noreferrer"
              >
                Abrir WhatsApp
              </Button>
            ) : undefined
          }
        >
          <form
            className="form"
            style={{ gap: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              registrar.mutate({
                tipo,
                direcao: tipo === 'nota' ? null : direcao,
                texto,
                contato: tipo === 'nota' ? null : (whatsapp ?? null),
              });
            }}
          >
            <fieldset className="segmentos">
              <legend className="pp-sr">Tipo de contato</legend>
              {TIPOS.map((t) => (
                <label key={t.id} className="segmento">
                  <input
                    type="radio"
                    name="tipo-contato"
                    className="pp-sr"
                    checked={tipo === t.id}
                    onChange={() => setTipo(t.id)}
                  />
                  {t.rotulo}
                </label>
              ))}
            </fieldset>
            {tipo !== 'nota' && (
              <div className="opcoes" role="radiogroup" aria-label="Quem falou">
                <label className="opcao">
                  <input
                    type="radio"
                    name="direcao"
                    checked={direcao === 'enviada'}
                    onChange={() => setDirecao('enviada')}
                  />
                  Eu entrei em contato
                </label>
                <label className="opcao">
                  <input
                    type="radio"
                    name="direcao"
                    checked={direcao === 'recebida'}
                    onChange={() => setDirecao('recebida')}
                  />
                  O lead respondeu / me procurou
                </label>
              </div>
            )}
            <div className="campo">
              <label htmlFor="funil-texto">{tipo === 'nota' ? 'Nota' : 'O que foi dito'}</label>
              <textarea
                id="funil-texto"
                value={texto}
                placeholder={
                  tipo === 'nota'
                    ? 'Ex.: dono só atende depois das 14h'
                    : 'Ex.: apresentei a Tutts, pediu tabela de preço'
                }
                onChange={(e) => setTexto(e.target.value)}
              />
              <span className="campo__dica">
                A etapa e o próximo passo andam sozinhos: contato feito → Abordado e follow-up agendado;
                resposta → Respondeu para responder hoje; reunião → Reunião e proposta amanhã.
              </span>
            </div>
            <div className="acoes">
              <Button type="submit" variant="primary" disabled={registrar.isPending}>
                {registrar.isPending ? 'Registrando…' : 'Registrar'}
              </Button>
            </div>
            <ErroDaApi erro={registrar.error} />
          </form>
        </Panel>

        <Panel titulo="Histórico" contagem={d.atividades.length}>
          {d.atividades.length ? (
            <Timeline itens={d.atividades.map(itemDaTimeline)} />
          ) : (
            <p className="quieto" style={{ margin: 0, fontSize: 13 }}>
              Nada registrado ainda.
            </p>
          )}
        </Panel>

        {confirmarRemover ? (
          <div className="confirmar">
            <span>Tirar do funil e apagar o histórico? O lead volta a aparecer como novo.</span>
            <div className="acoes">
              <Button
                size="sm"
                variant="danger"
                disabled={remover.isPending}
                onClick={() => remover.mutate()}
              >
                Tirar do funil
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmarRemover(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button size="sm" variant="ghost" onClick={() => setConfirmarRemover(true)}>
              Tirar do funil
            </Button>
          </div>
        )}
        <ErroDaApi erro={remover.error} />
      </div>
    </section>
  );
}
