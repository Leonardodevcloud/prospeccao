import { type ResultadoLigacao, ROTULO_RESULTADO_LIGACAO } from '@prospeccao/shared/ligacoes';
import { Button, EmptyState, Icon, Panel } from '@prospeccao/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { usePipelines } from '../componentes/Pipelines';
import { useEquipe, useSessao, useSoLeitura, useSoPropriaBase } from '../componentes/Sessao';
import { fmtNome, fmtNumero, formatarTelefone } from '../formatar';
import { discador, type ItemDaLista, type LinhaNaTela, type ListaAtual, useDiscador } from './discador';
import { useSituacaoTelefonia } from './tipos';

/**
 * Ligações › Lista de ligação: escolher os leads e deixar o CRM discar um depois do outro (ou até 3
 * ao mesmo tempo), com o "Como foi?" entre uma ligação e outra.
 */

interface Candidato {
  empresaId: number;
  nome: string;
  etapa: string;
  etapaNome: string | null;
  proximaAcaoEm: string | null;
  telefone: string;
  tipo: string | null;
  numeros: number;
  tentativas: number;
}

export function ListaDeLigacao() {
  const d = useDiscador();
  useEffect(() => {
    if (!d.carregado) void discador.carregar();
  }, [d.carregado]);
  if (!d.carregado) return <div className="esqueleto" style={{ height: 320 }} />;
  return d.lista ? <Discando lista={d.lista} /> : <MontarLista concluida={d.concluida} />;
}

function MontarLista(props: { concluida: boolean }) {
  const sessao = useSessao();
  const equipe = useEquipe();
  const pipelines = usePipelines();
  const soPropria = useSoPropriaBase();
  const soLeitura = useSoLeitura();
  const situacao = useSituacaoTelefonia();
  const [etapaId, setEtapaId] = useState('');
  const [responsavel, setResponsavel] = useState('eu');
  const [fora, setFora] = useState<Set<number>>(new Set());
  const [linhas, setLinhas] = useState(1);
  const [tentarProximo, setTentarProximo] = useState(true);
  const [pausa, setPausa] = useState(10);
  const [nome, setNome] = useState('');
  const q = useQuery({
    queryKey: ['lista-candidatos', etapaId, responsavel],
    queryFn: () =>
      api<Candidato[]>(
        `/ligacoes/listas/candidatos?responsavel=${responsavel}${etapaId ? `&etapaId=${etapaId}` : ''}`,
      ),
  });
  // Filtro novo: todos marcados de novo.
  // biome-ignore lint/correctness/useExhaustiveDependencies: só quando o filtro muda
  useEffect(() => setFora(new Set()), [etapaId, responsavel]);
  const cands = q.data ?? [];
  const escolhidos = cands.filter((c) => !fora.has(c.empresaId));
  const etapas = useMemo(
    () =>
      (pipelines.data ?? []).flatMap((p) =>
        p.etapas
          .filter((e) => !['ganho', 'perdido'].includes(e.papel))
          .map((e) => ({
            id: e.id,
            nome: (pipelines.data?.length ?? 0) > 1 ? `${p.nome} · ${e.nome}` : e.nome,
          })),
      ),
    [pipelines.data],
  );
  const ativos = equipe.data?.usuarios.filter((u) => u.ativo && u.id !== sessao.data?.id) ?? [];
  const criar = useMutation({
    mutationFn: () =>
      api<{ entraram: number; ficaramFora: number; lista: ListaAtual }>('/ligacoes/listas', {
        metodo: 'POST',
        corpo: {
          nome: nome.trim() || null,
          empresaIds: escolhidos.slice(0, 200).map((c) => c.empresaId),
          linhas,
          tentarProximo,
          pausaSegundos: pausa,
        },
      }),
    onSuccess: (r) => {
      discador.usar(r.lista);
      void discador.comecar();
    },
  });
  const alternar = (id: number) => {
    const n = new Set(fora);
    n.has(id) ? n.delete(id) : n.add(id);
    setFora(n);
  };
  const todos = escolhidos.length === cands.length;

  return (
    <div className="lista-lig">
      {props.concluida && (
        <Mensagem tipo="ok">
          Lista concluída: todos os leads foram chamados. Monte a próxima quando quiser.
        </Mensagem>
      )}
      <div className="lista-lig__grade">
        <Panel titulo="Quem entra na lista" semPadding>
          <div className="lig-filtros lista-lig__filtros">
            <label className="pp-sr" htmlFor="ll-etapa">
              Etapa
            </label>
            <select
              id="ll-etapa"
              className="filtro"
              value={etapaId}
              onChange={(e) => setEtapaId(e.target.value)}
            >
              <option value="">Todas as etapas em aberto</option>
              {etapas.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nome}
                </option>
              ))}
            </select>
            {!soPropria && (
              <>
                <label className="pp-sr" htmlFor="ll-resp">
                  Responsável
                </label>
                <select
                  id="ll-resp"
                  className="filtro"
                  value={responsavel}
                  onChange={(e) => setResponsavel(e.target.value)}
                >
                  <option value="eu">Meus leads</option>
                  <option value="todos">Toda a equipe</option>
                  {ativos.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nome}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
          {q.isPending ? (
            <div className="esqueleto" style={{ height: 240, margin: 16 }} />
          ) : q.error ? (
            <ErroDaApi erro={q.error} />
          ) : !cands.length ? (
            <EmptyState
              icone="phone"
              titulo="Nenhum lead para ligar com esse filtro"
              texto="Entram os leads do funil em aberto que têm telefone e não pediram para não receber ligação."
            />
          ) : (
            <div className="pp-tablewrap lista-lig__tabela">
              <table className="pp-table">
                <thead>
                  <tr>
                    <th className="lista-lig__marca">
                      <input
                        type="checkbox"
                        aria-label="Marcar todos"
                        checked={todos}
                        onChange={() => setFora(todos ? new Set(cands.map((c) => c.empresaId)) : new Set())}
                      />
                    </th>
                    <th>Lead</th>
                    <th>Etapa</th>
                    <th>Número</th>
                    <th className="num">Tentativas</th>
                  </tr>
                </thead>
                <tbody>
                  {cands.map((c) => (
                    <tr key={c.empresaId}>
                      <td className="lista-lig__marca">
                        <input
                          type="checkbox"
                          aria-label={`Incluir ${c.nome}`}
                          checked={!fora.has(c.empresaId)}
                          onChange={() => alternar(c.empresaId)}
                        />
                      </td>
                      <td>
                        <b>{fmtNome(c.nome)}</b>
                      </td>
                      <td className="quieto">{c.etapaNome ?? c.etapa}</td>
                      <td className="mono">
                        {formatarTelefone(c.telefone)}
                        {c.numeros > 1 && <span className="quieto"> +{c.numeros - 1}</span>}
                      </td>
                      <td className="num mono">{fmtNumero(c.tentativas)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel titulo="Como discar">
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              criar.mutate();
            }}
          >
            <fieldset className="campo">
              <legend className="pp-sr">Modo de discar</legend>
              <div className="lista-lig__modos">
                <label className="lista-lig__modo" data-ativo={linhas === 1 || undefined}>
                  <input
                    type="radio"
                    name="ll-modo"
                    className="pp-sr"
                    checked={linhas === 1}
                    onChange={() => setLinhas(1)}
                  />
                  <b>Um de cada vez</b>
                  <small>Você salva o "Como foi?" e o CRM liga para o próximo.</small>
                </label>
                <label className="lista-lig__modo" data-ativo={linhas > 1 || undefined}>
                  <input
                    type="radio"
                    name="ll-modo"
                    className="pp-sr"
                    checked={linhas > 1}
                    onChange={() => setLinhas(3)}
                  />
                  <b>Paralelo · até 3</b>
                  <small>Chama vários ao mesmo tempo; o primeiro que atende vem para você.</small>
                </label>
              </div>
              {linhas > 1 && (
                <>
                  <div className="segmentos">
                    {[2, 3].map((n) => (
                      <label key={n} className="segmento">
                        <input
                          type="radio"
                          name="ll-linhas"
                          className="pp-sr"
                          checked={linhas === n}
                          onChange={() => setLinhas(n)}
                        />
                        {n} ao mesmo tempo
                      </label>
                    ))}
                  </div>
                  <span className="campo__dica">
                    Se outro atender enquanto você fala, ele ouve "estou terminando outra ligação e te retorno
                    em instantes" e volta para o começo da lista.
                  </span>
                </>
              )}
            </fieldset>
            <label className="lig-sug">
              <input
                type="checkbox"
                checked={tentarProximo}
                onChange={(e) => setTentarProximo(e.target.checked)}
              />
              <span>
                <b>Se não atender, tentar o outro número do lead</b>
                <small>Ele volta no fim da lista com o próximo número (até 3 tentativas).</small>
              </span>
            </label>
            <div className="campo">
              <label htmlFor="ll-pausa">Pausa entre uma ligação e outra</label>
              <select
                id="ll-pausa"
                className="filtro"
                value={pausa}
                onChange={(e) => setPausa(Number(e.target.value))}
              >
                <option value={0}>Sem pausa</option>
                <option value={5}>5 segundos</option>
                <option value={10}>10 segundos</option>
                <option value={20}>20 segundos</option>
                <option value={30}>30 segundos</option>
                <option value={60}>1 minuto</option>
              </select>
            </div>
            <div className="campo">
              <label htmlFor="ll-nome">Nome da lista (opcional)</label>
              <input
                id="ll-nome"
                className="filtro"
                value={nome}
                placeholder="Ex.: Retornos da semana"
                onChange={(e) => setNome(e.target.value)}
              />
            </div>
            <p className="lista-lig__regra">
              Só liga de segunda a sexta das 8h às 20h e sábado das 8h às 14h, e pula quem pediu para não
              receber ligação. Deixe esta aba aberta enquanto a lista anda.
            </p>
            <ErroDaApi erro={criar.error} />
            <Button
              type="submit"
              variant="primary"
              icon="phone"
              disabled={soLeitura || !escolhidos.length || criar.isPending || !situacao.data?.disponivel}
            >
              {criar.isPending
                ? 'Montando…'
                : `Começar a ligar (${fmtNumero(Math.min(escolhidos.length, 200))} ${escolhidos.length === 1 ? 'lead' : 'leads'})`}
            </Button>
            {escolhidos.length > 200 && (
              <span className="campo__dica">Entram os 200 primeiros (os com próximo passo mais antigo).</span>
            )}
          </form>
        </Panel>
      </div>
    </div>
  );
}

const ROTULO_LINHA: Record<LinhaNaTela['fase'], string> = {
  conectando: 'Preparando…',
  chamando: 'Chamando…',
  tocando: 'Tocando…',
  atendida: 'Atendeu',
  recado: 'Ouvindo o recado',
  encerrada: 'Encerrada',
};

const ROTULO_ITEM: Record<ItemDaLista['situacao'], string> = {
  na_fila: 'Na fila',
  chamando: 'Chamando',
  feito: 'Feito',
  retornar: 'Retornar primeiro',
  pulado: 'Pulado',
};

function Contagem(props: { ate: number }) {
  const [agora, setAgora] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  return <>{Math.max(0, Math.ceil((props.ate - agora) / 1000))}s</>;
}

function Discando(props: { lista: ListaAtual }) {
  const { lista: l } = props;
  const d = useDiscador();
  const soLeitura = useSoLeitura();
  const [ocupado, setOcupado] = useState(false);
  const feitos = l.itens.filter((i) => i.situacao === 'feito' || i.situacao === 'pulado').length;
  const conversas = l.itens.filter((i) => i.resultado === 'conversou').length;
  const falta = l.itens.filter((i) => ['na_fila', 'retornar', 'chamando'].includes(i.situacao)).length;
  const pct = l.itens.length ? Math.round((feitos / l.itens.length) * 100) : 0;
  const fazer = (f: () => Promise<void>) => async () => {
    setOcupado(true);
    try {
      await f();
    } finally {
      setOcupado(false);
    }
  };
  const situacaoTexto = d.rodando
    ? d.proximaEm
      ? 'Pausa'
      : 'Ligando'
    : l.foraDoHorario
      ? 'Fora do horário'
      : l.situacao === 'pausada'
        ? 'Pausada'
        : 'Parada';

  return (
    <div className="lista-lig">
      <div className="lista-lig__cabeca">
        <div>
          <div className="lista-lig__titulo">
            <h2>{l.nome}</h2>
            <span className={`lista-lig__estado${d.rodando ? ' lista-lig__estado--ligando' : ''}`}>
              {situacaoTexto}
            </span>
          </div>
          <p className="quieto">
            {l.linhas === 1 ? 'Uma de cada vez' : `${l.linhas} em paralelo`} · {fmtNumero(feitos)} de{' '}
            {fmtNumero(l.itens.length)} feitos · {fmtNumero(conversas)}{' '}
            {conversas === 1 ? 'conversa' : 'conversas'} · {fmtNumero(falta)} na fila
          </p>
        </div>
        {!soLeitura && (
          <div className="acoes">
            {d.rodando ? (
              <>
                {d.proximaEm && (
                  <Button variant="secondary" icon="phone" onClick={() => discador.agora()}>
                    Ligar agora (<Contagem ate={d.proximaEm} />)
                  </Button>
                )}
                <Button
                  variant="secondary"
                  icon="pause"
                  disabled={ocupado}
                  onClick={fazer(() => discador.pausar())}
                >
                  Pausar
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                icon="phone"
                disabled={ocupado || l.foraDoHorario || !falta}
                onClick={fazer(() => discador.comecar())}
              >
                {l.situacao === 'pausada' || feitos ? 'Continuar' : 'Começar'}
              </Button>
            )}
            <Button variant="ghost" disabled={ocupado} onClick={fazer(() => discador.encerrar())}>
              Encerrar lista
            </Button>
          </div>
        )}
      </div>
      <div
        className="lista-lig__progresso"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Andamento da lista"
      >
        <span style={{ width: `${pct}%` }} />
      </div>

      {d.erro && <Mensagem tipo="aviso">{d.erro}</Mensagem>}
      {!d.erro && l.foraDoHorario && (
        <Mensagem tipo="aviso">
          Fora do horário de ligar ({l.horario}). A lista continua de onde parou.
        </Mensagem>
      )}
      {!d.rodando && !l.foraDoHorario && falta > 0 && (
        <Mensagem tipo="ok">
          Clique em {l.situacao === 'pausada' || feitos ? 'Continuar' : 'Começar'}: o navegador pede o
          microfone e a lista anda sozinha enquanto esta aba estiver aberta.
        </Mensagem>
      )}

      {d.linhas.length > 0 && (
        <ul className="lista-lig__linhas" aria-label="Linhas">
          {d.linhas.map((x, i) => (
            <li key={x.ligacaoId} data-fase={x.comVoce ? 'comigo' : x.fase}>
              <span className="lista-lig__num mono">Linha {i + 1}</span>
              <b>{fmtNome(x.nome)}</b>
              <span className="mono quieto">{formatarTelefone(x.telefone)}</span>
              <span className="lista-lig__fase">
                {x.comVoce ? (
                  <>
                    <Icon name="headphones" size={14} /> Com você
                  </>
                ) : (
                  ROTULO_LINHA[x.fase]
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Panel titulo="Leads da lista" semPadding>
        <div className="pp-tablewrap">
          <table className="pp-table">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Número</th>
                <th>Situação</th>
                <th className="num">Duração</th>
                <th>
                  <span className="pp-sr">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {l.itens.map((i) => (
                <tr key={i.id} data-situacao={i.situacao}>
                  <td>
                    <b>{fmtNome(i.nome)}</b>
                    {i.tentativa > 1 && <span className="quieto"> · {i.tentativa}º número</span>}
                  </td>
                  <td className="mono">{formatarTelefone(i.telefone)}</td>
                  <td>
                    <span
                      className={`lista-lig__item lista-lig__item--${i.situacao}`}
                      data-resultado={i.resultado ?? undefined}
                    >
                      {i.resultado
                        ? (ROTULO_RESULTADO_LIGACAO[i.resultado as ResultadoLigacao] ?? i.resultado)
                        : ROTULO_ITEM[i.situacao]}
                    </span>
                  </td>
                  <td className="num mono">
                    {i.duracaoSegundos
                      ? `${Math.floor(i.duracaoSegundos / 60)}:${String(i.duracaoSegundos % 60).padStart(2, '0')}`
                      : '—'}
                  </td>
                  <td className="num">
                    {!soLeitura && (i.situacao === 'na_fila' || i.situacao === 'retornar') && (
                      <button type="button" className="link-botao" onClick={() => void discador.pular(i.id)}>
                        Pular
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
