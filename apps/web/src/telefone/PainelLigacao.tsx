import {
  fmtDuracaoLigacao,
  RESULTADOS_LIGACAO,
  type ResultadoLigacao,
  ROTULO_CLIMA,
  ROTULO_RESULTADO_LIGACAO,
} from '@prospeccao/shared/ligacoes';
import { Badge, Button, Icon } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api, type DetalheFunil, ROTULO_ETAPA } from '../api';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { usePipelines } from '../componentes/Pipelines';
import { fmtNome, formatarTelefone } from '../formatar';
import { type EstadoLigacao, telefone } from './ligacao';
import type { LigacaoDetalhe } from './tipos';
import { useTelefone } from './tipos';

/**
 * O painel da ligação, por cima de qualquer tela (dá para navegar no CRM durante a ligação):
 * chamando, tocando, em ligação (mudo, teclado, desligar, anotações) e, ao desligar, o "Como foi?"
 * com o resumo da IA e o que aplicar no lead.
 */

const ROTULO_FASE: Record<EstadoLigacao['fase'], string> = {
  parado: '',
  preparando: 'Preparando…',
  chamando: 'Chamando…',
  tocando: 'Tocando…',
  em_andamento: 'Em ligação',
  encerrada: 'Ligação encerrada',
  falhou: 'Não completou',
};

const iniciais = (nome: string) =>
  nome
    .split(/\s+/)
    .filter((p) => p.length > 2 || /^[A-ZÀ-Ú]/.test(p))
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('') || '?';

function Cronometro(props: { desde: number | null; fixo?: number }) {
  const [agora, setAgora] = useState(Date.now());
  useEffect(() => {
    if (props.fixo != null || !props.desde) return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [props.desde, props.fixo]);
  const s = props.fixo ?? (props.desde ? Math.max(0, Math.round((agora - props.desde) / 1000)) : 0);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return <b className="lig-tempo mono">{`${mm}:${ss}`}</b>;
}

export function PainelLigacao() {
  const e = useTelefone();
  // Anotações durante a ligação (vão para a nota do "Como foi?").
  const [notas, setNotas] = useState('');
  const [teclado, setTeclado] = useState(false);
  useEffect(() => {
    if (e.fase === 'preparando') {
      setNotas('');
      setTeclado(false);
    }
  }, [e.fase]);
  if (!e.aberto) return null;
  const l = e.ligacao;
  const nome = l?.lead ? fmtNome(l.lead) : l ? formatarTelefone(l.telefone) : 'Ligação';
  const emCurso = ['preparando', 'chamando', 'tocando', 'em_andamento'].includes(e.fase);

  return (
    <aside className="lig-painel" aria-label="Ligação">
      <header className="lig-topo">
        <span className="lig-avatar" aria-hidden="true">
          {iniciais(nome)}
        </span>
        <div className="lig-topo__quem">
          <b>{nome}</b>
          <span className="quieto mono">{l ? formatarTelefone(l.telefone) : null}</span>
        </div>
        <div className="lig-topo__tempo">
          {e.fase === 'em_andamento' ? (
            <Cronometro desde={e.atendidaEm} />
          ) : e.fase === 'encerrada' && e.atendeu ? (
            <Cronometro desde={null} fixo={e.duracao} />
          ) : null}
          <span className={`lig-fase lig-fase--${e.fase}`}>
            {e.fase === 'em_andamento' && l?.gravar ? 'Gravando' : ROTULO_FASE[e.fase]}
          </span>
        </div>
      </header>

      {emCurso && (
        <>
          <div className="lig-controles">
            <button
              type="button"
              className="lig-botao"
              aria-pressed={e.mudo}
              disabled={e.fase !== 'em_andamento'}
              onClick={() => telefone.alternarMudo()}
            >
              <Icon name={e.mudo ? 'mic-off' : 'mic'} size={18} />
              <span>{e.mudo ? 'Sem som' : 'Mudo'}</span>
            </button>
            <button
              type="button"
              className="lig-botao"
              aria-pressed={teclado}
              disabled={e.fase !== 'em_andamento'}
              onClick={() => setTeclado(!teclado)}
            >
              <Icon name="keyboard" size={18} />
              <span>Teclado</span>
            </button>
            <button
              type="button"
              className="lig-botao lig-botao--fim"
              onClick={() => void telefone.desligar()}
            >
              <Icon name="phone-off" size={18} />
              <span>{e.fase === 'em_andamento' ? 'Desligar' : 'Cancelar'}</span>
            </button>
          </div>
          {teclado && (
            <fieldset className="lig-teclado" aria-label="Teclado">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((d) => (
                <button key={d} type="button" onClick={() => void telefone.tecla(d)}>
                  {d}
                </button>
              ))}
            </fieldset>
          )}
          <div className="lig-corpo">
            {l?.numeroEmpresa && (
              <span className="lig-saida">
                Saindo pelo número da empresa {formatarTelefone(l.numeroEmpresa)}
              </span>
            )}
            {e.aviso === 'tocando' && (
              <Mensagem tipo="aviso">Tocando o aviso de gravação para o lead…</Mensagem>
            )}
            {e.aviso === 'ler' && l?.aviso && (
              <div className="lig-aviso">
                <span>
                  <b>Avise o lead:</b> “{l.aviso.texto}”
                </span>
                <Button size="sm" variant="secondary" onClick={() => telefone.avisoLido()}>
                  Avisei
                </Button>
              </div>
            )}
            {e.gravacaoFalhou && (
              <Mensagem tipo="aviso">Este navegador não conseguiu gravar; a ligação segue normal.</Mensagem>
            )}
            {l?.empresaId ? <SobreOLead empresaId={l.empresaId} /> : null}
            <div className="campo">
              <label htmlFor="lig-notas">Anotações</label>
              <textarea
                id="lig-notas"
                rows={4}
                placeholder="O que for importante: quem decide, quando ligar de novo…"
                value={notas}
                onChange={(ev) => setNotas(ev.target.value)}
              />
            </div>
          </div>
        </>
      )}

      {e.fase === 'falhou' && (
        <div className="lig-corpo">
          <Mensagem tipo="erro">{e.erro ?? 'A ligação não completou.'}</Mensagem>
          <div className="acoes">
            <Button variant="secondary" onClick={() => telefone.fechar()}>
              Fechar
            </Button>
          </div>
        </div>
      )}

      {e.fase === 'encerrada' && l && <ComoFoi estado={e} notas={notas} />}
    </aside>
  );
}

/** O que o CRM sabe do lead (etapa, próximo passo, os últimos contatos), para ter na mão. */
function SobreOLead(props: { empresaId: number }) {
  const q = useQuery({
    queryKey: ['funil', props.empresaId],
    queryFn: () => api<DetalheFunil>(`/funil/${props.empresaId}`),
  });
  const op = q.data?.oportunidade;
  if (!op) return null;
  const ultimos = (q.data?.atividades ?? []).filter((a) => a.tipo !== 'etapa').slice(0, 3);
  return (
    <div className="lig-lead">
      <div className="kv-linha">
        <span>Etapa</span>
        <b>{op.etapaNome ?? ROTULO_ETAPA[op.etapa]}</b>
      </div>
      {op.proximaAcao && (
        <div className="kv-linha">
          <span>Próximo passo</span>
          <b>{op.proximaAcao}</b>
        </div>
      )}
      {ultimos.length > 0 && (
        <ul className="lig-lead__ultimos">
          {ultimos.map((a) => (
            <li key={a.id}>
              <span className="quieto">{a.tipo === 'ligacao' ? 'Ligação' : a.tipo}</span>{' '}
              {a.texto?.slice(0, 120)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const ORDEM_PAPEL: Record<string, number> = {
  a_abordar: 0,
  abordado: 1,
  respondeu: 2,
  reuniao: 3,
  proposta: 4,
  ganho: 5,
  perdido: 6,
};

/** ISO → valor do campo de data e hora (no fuso do navegador). */
function paraCampo(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function amanhaAs(hora: number, dias = 1): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  d.setHours(hora, 0, 0, 0);
  return d.toISOString();
}

/** "Como foi?": o resultado, o resumo da IA (quando chega) e o que aplicar no lead. */
function ComoFoi(props: { estado: EstadoLigacao; notas: string }) {
  const { estado: e } = props;
  const l = e.ligacao!;
  const cliente = useQueryClient();
  const pipelines = usePipelines();
  const detalhe = useQuery({
    queryKey: ['ligacao', l.id],
    queryFn: () => api<LigacaoDetalhe>(`/ligacoes/${l.id}`),
    // Enquanto a IA trabalha, confere a cada 3 s (até uns 3 minutos).
    refetchInterval: (q) => {
      const p = q.state.data?.processamento;
      return p === 'aguardando' || p === 'processando' || e.enviando ? 3_000 : false;
    },
  });
  const funil = useQuery({
    queryKey: ['funil', l.empresaId],
    queryFn: () => api<DetalheFunil>(`/funil/${l.empresaId}`),
    enabled: !!l.empresaId,
  });
  const resumo = detalhe.data?.resumoCompleto ?? null;
  const [resultado, setResultado] = useState<ResultadoLigacao>(e.atendeu ? 'conversou' : 'nao_atendeu');
  const [nota, setNota] = useState(props.notas);
  const [marcados, setMarcados] = useState<Record<string, boolean>>({});
  const [quando, setQuando] = useState('');
  const [retornar, setRetornar] = useState<string | null>(amanhaAs(10));
  // A IA ouviu caixa postal ou ninguém conversou: já sugere.
  // biome-ignore lint/correctness/useExhaustiveDependencies: só quando o resumo chega
  useEffect(() => {
    if (!resumo) return;
    if (resumo.caixaPostal) setResultado('caixa_postal');
    else if (resumo.numeroCerto === false) setResultado('numero_errado');
    setQuando(paraCampo(resumo.reuniao?.inicio));
    setMarcados({
      etapa: true,
      reuniao: !!resumo.reuniao,
      ...Object.fromEntries(resumo.contatos.map((_c, i) => [`contato-${i}`, true])),
    });
  }, [resumo?.resumo]);

  // Etapa sugerida: a do mesmo funil do lead com o papel que a IA disse (só para frente).
  const sugestaoEtapa = useMemo(() => {
    const op = funil.data?.oportunidade;
    if (!resumo?.sugestaoEtapa || !op || !pipelines.data) return null;
    // No mesmo funil do lead; se ele não tem a etapa (o SDR sem "reunião"), no funil que tem.
    const pipe = pipelines.data.find((p) => p.etapas.some((et) => et.id === op.etapaId));
    const et =
      pipe?.etapas.find((x) => x.papel === resumo.sugestaoEtapa) ??
      pipelines.data.flatMap((p) => p.etapas).find((x) => x.papel === resumo.sugestaoEtapa);
    if (!et || et.id === op.etapaId) return null;
    if (resumo.sugestaoEtapa !== 'perdido' && (ORDEM_PAPEL[et.papel] ?? 0) <= (ORDEM_PAPEL[op.etapa] ?? 0))
      return null;
    return et;
  }, [resumo, funil.data, pipelines.data]);

  const conversou = resultado === 'conversou';
  const salvar = useMutation({
    mutationFn: () =>
      api<LigacaoDetalhe>(`/ligacoes/${l.id}/resultado`, {
        metodo: 'POST',
        corpo: {
          resultado,
          nota: nota.trim() || null,
          etapaId: conversou && marcados.etapa && sugestaoEtapa ? sugestaoEtapa.id : null,
          motivo: sugestaoEtapa?.papel === 'perdido' ? (resumo?.resumo ?? nota).slice(0, 300) : null,
          reuniao:
            conversou && marcados.reuniao && quando
              ? { inicio: new Date(quando).toISOString(), sala: true }
              : null,
          contatos: conversou
            ? (resumo?.contatos ?? [])
                .filter((_c, i) => marcados[`contato-${i}`])
                .map((c) => ({ nome: c.nome, cargo: c.cargo, telefone: c.telefone, decisor: c.decisor }))
            : [],
          retornarEm:
            !conversou && ['nao_atendeu', 'caixa_postal', 'ocupado'].includes(resultado) ? retornar : null,
        },
      }),
    onSuccess: () => {
      if (l.empresaId) {
        cliente.invalidateQueries({ queryKey: ['funil', l.empresaId] });
        cliente.invalidateQueries({ queryKey: ['ligacoes-lead', l.empresaId] });
        cliente.invalidateQueries({ queryKey: ['contatos-lead', l.empresaId] });
      }
      for (const k of ['quadro', 'ligacoes', 'agenda', 'telefonia'])
        cliente.invalidateQueries({ queryKey: [k] });
      telefone.fechar();
    },
  });

  const proc = detalhe.data?.processamento;
  const marcar = (k: string, v: boolean) => setMarcados({ ...marcados, [k]: v });

  return (
    <form
      className="lig-corpo lig-como-foi"
      onSubmit={(ev) => {
        ev.preventDefault();
        salvar.mutate();
      }}
    >
      <fieldset className="campo">
        <legend>Como foi?</legend>
        <div className="lig-resultados">
          {RESULTADOS_LIGACAO.map((r) => (
            <label key={r} className="lig-resultado" data-ativo={resultado === r || undefined}>
              <input
                type="radio"
                name="resultado"
                className="pp-sr"
                checked={resultado === r}
                onChange={() => setResultado(r)}
              />
              {ROTULO_RESULTADO_LIGACAO[r]}
            </label>
          ))}
        </div>
      </fieldset>

      {e.atendeu && (
        <div className="lig-ia" aria-live="polite">
          <div className="lig-ia__titulo">
            <Icon name="sparkles" size={14} /> Resumo da IA
            {resumo && (
              <Badge
                tone={
                  resumo.clima === 'positivo' ? 'brand' : resumo.clima === 'negativo' ? 'danger' : 'neutral'
                }
              >
                {ROTULO_CLIMA[resumo.clima]}
              </Badge>
            )}
          </div>
          {e.enviando ? (
            <p className="quieto">Mandando a gravação…</p>
          ) : resumo ? (
            <>
              <p>{resumo.resumo}</p>
              {resumo.sentimento && <p className="quieto">{resumo.sentimento}</p>}
              {resumo.proximoPasso && (
                <p>
                  <b>Próximo passo:</b> {resumo.proximoPasso}
                </p>
              )}
            </>
          ) : proc === 'aguardando' || proc === 'processando' ? (
            <p className="quieto">
              <Icon name="loader" size={14} /> Transcrevendo e resumindo (leva uns segundos). Pode salvar sem
              esperar: o resumo vai para o histórico do lead quando ficar pronto.
            </p>
          ) : (
            <p className="quieto">
              {l.gravar
                ? 'Sem resumo desta ligação (a gravação não chegou ou ninguém falou).'
                : 'Ligação sem gravação.'}
            </p>
          )}
        </div>
      )}

      {conversou && resumo && (sugestaoEtapa || resumo.reuniao || resumo.contatos.length > 0) && (
        <div className="campo">
          <span className="campo__rotulo">O que fazer no lead (sugerido pela IA)</span>
          {sugestaoEtapa && (
            <label className="lig-sug">
              <input
                type="checkbox"
                checked={!!marcados.etapa}
                onChange={(ev) => marcar('etapa', ev.target.checked)}
              />
              <span>
                <b>Mover para {sugestaoEtapa.nome}</b>
                <small>
                  {funil.data?.oportunidade?.etapaNome ?? ''} → {sugestaoEtapa.nome}
                </small>
              </span>
            </label>
          )}
          {resumo.reuniao && (
            <label className="lig-sug">
              <input
                type="checkbox"
                checked={!!marcados.reuniao}
                onChange={(ev) => marcar('reuniao', ev.target.checked)}
              />
              <span>
                <b>Marcar reunião</b>
                <small>Combinado: {resumo.reuniao.texto} · com sala de vídeo e convite</small>
                <input
                  type="datetime-local"
                  className="filtro"
                  aria-label="Data e hora da reunião"
                  value={quando}
                  onChange={(ev) => setQuando(ev.target.value)}
                />
              </span>
            </label>
          )}
          {resumo.contatos.map((c, i) => (
            <label key={`${c.nome}-${c.cargo ?? ''}`} className="lig-sug">
              <input
                type="checkbox"
                checked={!!marcados[`contato-${i}`]}
                onChange={(ev) => marcar(`contato-${i}`, ev.target.checked)}
              />
              <span>
                <b>Contato novo: {c.nome}</b>
                <small>
                  {[c.cargo, c.decisor ? 'decide' : null, c.telefone ?? 'sem telefone ainda']
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </span>
            </label>
          ))}
        </div>
      )}

      {['nao_atendeu', 'caixa_postal', 'ocupado'].includes(resultado) && (
        <fieldset className="campo">
          <legend>Ligar de novo</legend>
          <div className="segmentos">
            {(
              [
                ['Amanhã 10h', amanhaAs(10)],
                ['Amanhã 15h', amanhaAs(15)],
                ['Em 3 dias', amanhaAs(10, 3)],
                ['Não agendar', null],
              ] as [string, string | null][]
            ).map(([rotulo, v]) => (
              <label key={rotulo} className="segmento">
                <input
                  type="radio"
                  name="retornar"
                  className="pp-sr"
                  checked={(retornar?.slice(0, 13) ?? null) === (v?.slice(0, 13) ?? null)}
                  onChange={() => setRetornar(v)}
                />
                {rotulo}
              </label>
            ))}
          </div>
          <span className="campo__dica">
            Vira uma tarefa na sua agenda; na próxima, o CRM tenta o número seguinte.
          </span>
        </fieldset>
      )}
      {resultado === 'nao_ligar' && (
        <Mensagem tipo="aviso">O lead sai da lista de ligação (os outros canais continuam).</Mensagem>
      )}

      <div className="campo">
        <label htmlFor="lig-nota">Nota</label>
        <textarea id="lig-nota" rows={3} value={nota} onChange={(ev) => setNota(ev.target.value)} />
      </div>
      <ErroDaApi erro={salvar.error} />
      <div className="lig-rodape">
        {e.atendeu && <span className="quieto">{fmtDuracaoLigacao(e.duracao)}</span>}
        <Button type="submit" variant="primary" disabled={salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </form>
  );
}
