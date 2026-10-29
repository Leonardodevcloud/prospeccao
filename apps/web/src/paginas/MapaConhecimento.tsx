import type { MapaDTO, NoMapaDTO } from '@prospeccao/shared/assistente';
import { Badge, Button, Icon } from '@prospeccao/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api';
import { Cena3D } from '../componentes/argos/mapa/cena3d';
import { COR_AREA, ROTULO_AREA } from '../componentes/argos/mapa/cores';
import { idDe, type Ligacao, type No } from '../componentes/argos/mapa/tipos';
import { carregarThree, webglDisponivel } from '../componentes/argos/nebulosa';
import { ErroDaApi } from '../componentes/Formulario';
import { useSessao } from '../componentes/Sessao';
import { useEntrarNaUnidade } from './Organizacao';

/**
 * Mapa do conhecimento: o comercial como uma galáxia. Cada etapa do funil é um aglomerado, cada
 * empresa em negociação uma estrela, e as pessoas da equipe ficam no meio das empresas que conduzem.
 * Os dados vêm do mesmo acesso do Argos: cada pessoa só vê o próprio escopo.
 */

const LARGURA_PAINEL = 340;
const reais = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const semAcento = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function MapaConhecimento() {
  const navegar = useNavigate();
  const sessao = useSessao();
  const [unidade, setUnidade] = useState('');
  const [ocultas, setOcultas] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState('');
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [apontado, setApontado] = useState<string | null>(null);
  const [falhou3d, setFalhou3d] = useState(() => !webglDisponivel());
  const [movimento] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const cena = useRef<Cena3D | null>(null);

  const q = useQuery({
    queryKey: ['argos', 'mapa', unidade],
    queryFn: () => api<MapaDTO>(`/assistente/mapa${unidade ? `?unidade=${unidade}` : ''}`),
    staleTime: 60_000,
  });
  const dados = q.data;

  // O que aparece: sem as etapas desligadas na legenda; pessoas só se ainda conduzem algo visível.
  const visiveis = useMemo(() => {
    if (!dados) return { nos: [] as No[], ligacoes: [] as Ligacao[] };
    const fora = (n: NoMapaDTO) => n.categoria !== 'cliente' && !!n.area && ocultas.has(n.area);
    const base = dados.nos.filter((n) => !fora(n));
    const ids = new Set(base.map((n) => n.id));
    const ligacoes = dados.ligacoes.filter((l) => ids.has(l.origem) && ids.has(l.destino));
    const comLigacao = new Set(ligacoes.flatMap((l) => [l.origem, l.destino]));
    const nos = base.filter((n) => n.categoria !== 'cliente' || comLigacao.has(n.id));
    return { nos, ligacoes };
  }, [dados, ocultas]);

  const porId = useMemo(() => new Map((dados?.nos ?? []).map((n) => [n.id, n])), [dados]);
  const vizinhos = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of visiveis.ligacoes) {
      const a = idDe(l.origem);
      const b = idDe(l.destino);
      if (!m.has(a)) m.set(a, new Set());
      if (!m.has(b)) m.set(b, new Set());
      m.get(a)!.add(b);
      m.get(b)!.add(a);
    }
    return m;
  }, [visiveis]);
  const foco = selecionado ?? apontado;
  const destaque = useMemo(
    () => (foco ? new Set([foco, ...(vizinhos.get(foco) ?? [])]) : new Set<string>()),
    [foco, vizinhos],
  );

  // Busca: a primeira empresa ou pessoa que bate, a câmera voa até ela.
  const achados = useMemo(() => {
    const t = semAcento(busca.trim());
    if (t.length < 2) return [];
    return visiveis.nos.filter((n) => n.categoria !== 'area' && semAcento(n.rotulo).includes(t)).slice(0, 8);
  }, [busca, visiveis]);

  const irPara = (id: string) => {
    setSelecionado(id);
    cena.current?.focar(id);
  };

  const contagem = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of dados?.nos ?? [])
      if (n.categoria === 'registro' && n.area) m.set(n.area, (m.get(n.area) ?? 0) + 1);
    return m;
  }, [dados]);
  const etapas = Object.keys(ROTULO_AREA).filter((e) => contagem.has(e));
  const sel = selecionado ? porId.get(selecionado) : undefined;
  const empresas = visiveis.nos.filter((n) => n.categoria === 'registro').length;

  return (
    <div className="mapa-tela">
      <div
        className="mapa-tela__palco"
        role="img"
        aria-label="Mapa: negociações agrupadas por etapa do funil, ligadas às pessoas da equipe"
      >
        {!falhou3d && empresas > 0 && (
          <Mapa3D
            nos={visiveis.nos}
            ligacoes={visiveis.ligacoes}
            destaque={destaque}
            principal={foco}
            movimento={movimento}
            deslocamento={sel ? { x: LARGURA_PAINEL / 2, y: 0 } : { x: 0, y: 0 }}
            aoApontar={setApontado}
            aoClicar={(id) => {
              if (!id) setSelecionado(null);
              else irPara(id);
            }}
            aoPronto={(c) => {
              cena.current = c;
            }}
            aoFalhar={() => setFalhou3d(true)}
          />
        )}
      </div>

      <div className="mapa-tela__barra">
        <div className="mapa-tela__busca">
          <label className="mapa-tela__campo">
            <Icon name="search" size={14} />
            <span className="pp-sr">Buscar empresa ou pessoa</span>
            <input
              type="search"
              placeholder="Buscar empresa ou pessoa"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && achados[0]) {
                  irPara(achados[0].id);
                  setBusca('');
                }
              }}
            />
          </label>
          {achados.length > 0 && (
            <ul className="mapa-tela__achados">
              {achados.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => {
                      irPara(n.id);
                      setBusca('');
                    }}
                  >
                    <b>{n.rotulo}</b>
                    <span>
                      {n.categoria === 'cliente' ? 'Pessoa da equipe' : (ROTULO_AREA[n.area ?? ''] ?? '')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {(dados?.unidades.length ?? 0) > 1 && (
          <label className="mapa-tela__campo">
            Unidade
            <select value={unidade} onChange={(e) => setUnidade(e.target.value)}>
              <option value="">Todas</option>
              {dados?.unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nome}
                </option>
              ))}
            </select>
          </label>
        )}
        <fieldset className="mapa-tela__legenda">
          <legend className="pp-sr">Etapas no mapa</legend>
          {etapas.map((e) => {
            const ligada = !ocultas.has(e);
            return (
              <button
                key={e}
                type="button"
                className="mapa-tela__etapa"
                aria-pressed={ligada}
                onClick={() =>
                  setOcultas((o) => {
                    const n = new Set(o);
                    if (ligada) n.add(e);
                    else n.delete(e);
                    return n;
                  })
                }
              >
                <span style={{ background: COR_AREA[e] }} aria-hidden="true" />
                {ROTULO_AREA[e]} <b>{contagem.get(e)}</b>
              </button>
            );
          })}
        </fieldset>
        <button type="button" className="mapa-tela__enquadrar" onClick={() => cena.current?.enquadrar()}>
          Ver tudo
        </button>
      </div>

      {q.isPending && <p className="mapa-tela__aviso">Montando o mapa…</p>}
      {q.error && (
        <div className="mapa-tela__aviso">
          <ErroDaApi erro={q.error} />
        </div>
      )}
      {dados && !empresas && (
        <p className="mapa-tela__aviso">
          {dados.soPropriaBase
            ? 'Você ainda não é responsável por nenhuma negociação. Quando um lead ficar com você no funil, ele aparece aqui.'
            : 'Ainda não há negociações para mostrar. Quando a equipe mandar leads para o funil, eles aparecem aqui.'}
        </p>
      )}
      {dados && empresas > 0 && falhou3d && (
        <div className="mapa-tela__aviso">
          <p>Este aparelho não desenha o mapa em 3D. As negociações por etapa:</p>
          <ul>
            {etapas.map((e) => (
              <li key={e}>
                {ROTULO_AREA[e]}: {contagem.get(e)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {dados?.soPropriaBase && empresas > 0 && (
        <p className="mapa-tela__selo">
          Mostrando só a sua base: as negociações em que você é a responsável.
        </p>
      )}
      {dados?.cortado && (
        <p className="mapa-tela__dica">
          Mostrando as 1.500 negociações mais recentes. Filtre por unidade para ver todas.
        </p>
      )}
      {!dados?.cortado && empresas > 0 && !falhou3d && (
        <p className="mapa-tela__dica">
          Arraste para girar · role para aproximar · clique numa estrela para ver a negociação
        </p>
      )}

      {sel && (
        <aside
          className="mapa-tela__painel"
          aria-label={sel.categoria === 'cliente' ? 'Pessoa selecionada' : 'Negociação selecionada'}
        >
          <div className="mapa-tela__painel-topo">
            <span className="mapa-tela__sobre">
              {sel.categoria === 'cliente'
                ? 'PESSOA DA EQUIPE'
                : sel.categoria === 'area'
                  ? 'ETAPA'
                  : 'NEGOCIAÇÃO'}
            </span>
            <button
              type="button"
              className="mapa-tela__fechar"
              aria-label="Fechar"
              onClick={() => setSelecionado(null)}
            >
              <Icon name="x" size={16} />
            </button>
          </div>
          <h2>{sel.rotulo}</h2>
          {sel.categoria === 'registro' && sel.detalhe && (
            <>
              <div className="acoes">
                <Badge tone={sel.area === 'perdido' ? 'danger' : 'brand'}>
                  {ROTULO_AREA[sel.area ?? ''] ?? sel.detalhe.etapa}
                </Badge>
                {sel.detalhe.cidade && <Badge>{sel.detalhe.cidade}</Badge>}
              </div>
              <dl className="mapa-tela__dados">
                <div>
                  <dt>Potencial</dt>
                  <dd className={sel.detalhe.valorMensal ? 'mono' : undefined}>
                    {sel.detalhe.valorMensal ? `${reais(sel.detalhe.valorMensal)}/mês` : 'Não informado'}
                  </dd>
                </div>
                <div>
                  <dt>Responsável</dt>
                  <dd>{sel.detalhe.responsavel ?? 'Sem responsável'}</dd>
                </div>
                {sel.detalhe.unidade && (
                  <div>
                    <dt>Unidade</dt>
                    <dd>{sel.detalhe.unidade}</dd>
                  </div>
                )}
                <div className="mapa-tela__largo">
                  <dt>Próximo passo</dt>
                  <dd>{sel.detalhe.proximaAcao ?? 'Nenhum marcado'}</dd>
                </div>
              </dl>
              <div className="mapa-tela__acoes">
                <AbrirFicha
                  empresaId={sel.detalhe.empresaId ?? 0}
                  unidadeId={sel.detalhe.unidadeId ?? 0}
                  unidade={sel.detalhe.unidade ?? undefined}
                  contaAtual={sessao.data?.conta.id}
                  podeTrocar={!!sessao.data?.papelOrganizacao}
                />
                <Button
                  variant="ghost"
                  className="mapa-tela__fantasma"
                  icon="orbit"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent('argos:perguntar', {
                        detail: `Me conta como está a negociação com a ${sel.rotulo} e o que eu deveria fazer agora.`,
                      }),
                    )
                  }
                >
                  Perguntar ao Argos sobre esta empresa
                </Button>
              </div>
            </>
          )}
          {sel.categoria === 'cliente' && sel.detalhe && (
            <dl className="mapa-tela__dados">
              <div>
                <dt>Negociações no mapa</dt>
                <dd className="mono">{sel.detalhe.negociacoes ?? 0}</dd>
              </div>
              {sel.detalhe.unidade && (
                <div>
                  <dt>Unidade</dt>
                  <dd>{sel.detalhe.unidade}</dd>
                </div>
              )}
            </dl>
          )}
          {sel.categoria === 'area' && (
            <p className="mapa-tela__texto">{contagem.get(sel.area ?? '') ?? 0} negociações nesta etapa.</p>
          )}
          {sel.categoria !== 'registro' && (
            <Button variant="ghost" className="mapa-tela__fantasma" onClick={() => navegar('/funil')}>
              Abrir o funil
            </Button>
          )}
        </aside>
      )}
    </div>
  );
}

/** A ficha abre na unidade da empresa: se for outra, o gestor entra nela antes. */
function AbrirFicha(props: {
  empresaId: number;
  unidadeId: number;
  unidade?: string;
  contaAtual?: number;
  podeTrocar: boolean;
}) {
  const navegar = useNavigate();
  const entrar = useEntrarNaUnidade();
  const mesma = props.unidadeId === props.contaAtual;
  if (!mesma && !props.podeTrocar)
    return (
      <p className="mapa-tela__texto">Esta negociação é da unidade {props.unidade ?? 'de outro cliente'}.</p>
    );
  return (
    <Button
      variant="primary"
      icon="external-link"
      disabled={entrar.isPending}
      onClick={() =>
        mesma
          ? navegar(`/funil?empresa=${props.empresaId}`)
          : entrar.mutate(props.unidadeId, { onSuccess: () => navegar(`/funil?empresa=${props.empresaId}`) })
      }
    >
      {mesma ? 'Abrir a ficha' : `Abrir na unidade ${props.unidade ?? ''}`.trim()}
    </Button>
  );
}

/** O mapa em partículas (Three.js só carrega quando a tela abre). */
function Mapa3D(props: {
  nos: No[];
  ligacoes: Ligacao[];
  destaque: Set<string>;
  principal: string | null;
  movimento: boolean;
  deslocamento: { x: number; y: number };
  aoApontar: (id: string | null) => void;
  aoClicar: (id: string | null) => void;
  aoPronto: (cena: Cena3D | null) => void;
  aoFalhar: () => void;
}) {
  const tela = useRef<HTMLCanvasElement>(null);
  const camada = useRef<HTMLDivElement>(null);
  const [cena, setCena] = useState<Cena3D | null>(null);
  const eventos = useRef({ apontou: props.aoApontar, clicou: props.aoClicar });
  eventos.current = { apontou: props.aoApontar, clicou: props.aoClicar };
  const pronto = useRef(props.aoPronto);
  pronto.current = props.aoPronto;
  const falhou = useRef(props.aoFalhar);
  falhou.current = props.aoFalhar;
  const { movimento } = props;

  useEffect(() => {
    const canvas = tela.current;
    const rotulos = camada.current;
    if (!canvas || !rotulos) return;
    let vivo = true;
    let criada: Cena3D | null = null;
    carregarThree()
      .then((THREE) => {
        if (!vivo) return;
        const leve = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 860;
        criada = new Cena3D(
          THREE,
          canvas,
          rotulos,
          { apontou: (id) => eventos.current.apontou(id), clicou: (id) => eventos.current.clicou(id) },
          movimento,
          leve,
        );
        setCena(criada);
      })
      .catch(() => {
        if (vivo) falhou.current();
      });
    return () => {
      vivo = false;
      criada?.destruir();
      setCena(null);
      pronto.current(null);
    };
  }, [movimento]);

  // Dados novos (ou filtros): monta de novo e enquadra na primeira vez.
  const primeira = useRef(true);
  useEffect(() => {
    if (!cena) return;
    cena.definirDados(props.nos, props.ligacoes);
    if (primeira.current) {
      primeira.current = false;
      cena.enquadrar();
    }
    pronto.current(cena);
  }, [cena, props.nos, props.ligacoes]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refaz o destaque quando os dados mudam
  useEffect(() => {
    cena?.destacar(props.destaque, props.principal);
  }, [cena, props.destaque, props.principal, props.nos, props.ligacoes]);

  useEffect(() => {
    cena?.deslocar(props.deslocamento.x, props.deslocamento.y);
  }, [cena, props.deslocamento.x, props.deslocamento.y]);

  return (
    <>
      <canvas ref={tela} className="mapa-tela__canvas" />
      <div ref={camada} className="mapa-tela__rotulos" aria-hidden="true" />
    </>
  );
}
