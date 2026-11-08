import {
  type CartaoQuadro,
  CORES_COLUNA,
  type ColunaQuadroEntrada,
  type CorColuna,
  MAX_COLUNAS_QUADRO,
  type Quadro,
} from '@prospeccao/shared/quadros';
import { Button, EmptyState, Icon } from '@prospeccao/ui';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type CSSProperties, type FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api } from '../api';
import { LinkAjuda } from '../componentes/Ajuda';
import { Drawer } from '../componentes/Drawer';
import { FichaEmpresa } from '../componentes/FichaEmpresa';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { Dono, useEhAdmin, useEquipe, useSoLeitura, useSoPropriaBase } from '../componentes/Sessao';
import { fmtNome, fmtNumero, fmtQuando } from '../formatar';

/**
 * Quadros com gatilhos da IA: colunas que o cliente monta (ex.: "Achou caro", "Sem estoque"). A IA
 * lê as conversas que pararam e põe o lead na coluna cujo gatilho aconteceu, com o trecho que mostra
 * isso; o vendedor confirma ou descarta. Também dá para arrastar à mão.
 */

export const COR_COLUNA: Record<CorColuna, string> = {
  cinza: '#94a3b8',
  azul: '#3b82f6',
  verde: '#16a34a',
  amarelo: '#f59e0b',
  laranja: '#f97316',
  vermelho: '#e11d48',
  roxo: '#8b5cf6',
};
const ROTULO_COR: Record<CorColuna, string> = {
  cinza: 'Cinza',
  azul: 'Azul',
  verde: 'Verde',
  amarelo: 'Amarelo',
  laranja: 'Laranja',
  vermelho: 'Vermelho',
  roxo: 'Roxo',
};

/** Pontos de partida para o primeiro quadro (dá para mudar tudo depois). */
const MODELOS: { nome: string; colunas: ColunaQuadroEntrada[] }[] = [
  {
    nome: 'Objeções',
    colunas: [
      {
        nome: 'Achou caro',
        gatilho: 'o cliente disse que o preço está caro ou pediu desconto',
        cor: 'laranja',
      },
      { nome: 'Sem estoque', gatilho: 'faltou a peça ou o produto que o cliente pediu', cor: 'vermelho' },
      {
        nome: 'Vai pensar',
        gatilho: 'o cliente disse que vai pensar, ver depois ou falar com alguém',
        cor: 'amarelo',
      },
      { nome: 'Concorrente', gatilho: 'o cliente citou outra loja ou um preço de concorrente', cor: 'roxo' },
      { nome: 'Resolvido', gatilho: null, cor: 'verde' },
    ],
  },
  {
    nome: 'Atendimento',
    colunas: [
      { nome: 'Pediu orçamento', gatilho: 'o cliente pediu preço ou orçamento de uma peça', cor: 'azul' },
      { nome: 'Orçamento enviado', gatilho: 'a loja mandou o preço ou o orçamento', cor: 'amarelo' },
      {
        nome: 'Fechou',
        gatilho: 'o cliente confirmou a compra ou pediu para separar ou entregar',
        cor: 'verde',
      },
      { nome: 'Não fechou', gatilho: 'o cliente desistiu ou disse que comprou em outro lugar', cor: 'cinza' },
    ],
  },
];

function useQuadros() {
  return useQuery({ queryKey: ['quadros'], queryFn: () => api<Quadro[]>('/quadros') });
}

export function Quadros() {
  const [params, setParams] = useSearchParams();
  const admin = useEhAdmin();
  const soLeitura = useSoLeitura();
  const soPropria = useSoPropriaBase();
  const equipe = useEquipe();
  const q = useQuadros();
  const cliente = useQueryClient();
  const [editando, setEditando] = useState<Quadro | 'novo' | null>(null);
  const [pondo, setPondo] = useState<number | null>(null);
  const [arrastado, setArrastado] = useState<CartaoQuadro | null>(null);
  const [alvo, setAlvo] = useState<number | null>(null);
  const [erro, setErro] = useState<unknown>(null);
  const navegar = useNavigate();

  const quadro = q.data?.find((x) => x.id === Number(params.get('quadro'))) ?? q.data?.[0];
  const responsavel = params.get('responsavel') ?? 'todos';
  const empresaAberta = params.get('empresa');
  const mudar = (p: Record<string, string | null>) =>
    setParams((atual) => {
      const n = new URLSearchParams(atual);
      for (const [k, v] of Object.entries(p)) v === null ? n.delete(k) : n.set(k, v);
      return n;
    });

  const cartoes = useQuery({
    queryKey: ['quadros', quadro?.id, 'cartoes', responsavel],
    queryFn: () => api<CartaoQuadro[]>(`/quadros/${quadro!.id}/cartoes?responsavel=${responsavel}`),
    enabled: !!quadro,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const atualizar = () => {
    void cliente.invalidateQueries({ queryKey: ['quadros'] });
  };
  const acao = useMutation({
    mutationFn: (p: { caminho: string; metodo: string; corpo?: unknown }) =>
      api(`/quadros/${quadro!.id}/cartoes${p.caminho}`, { metodo: p.metodo, corpo: p.corpo }),
    onMutate: () => setErro(null),
    onSuccess: atualizar,
    onError: (e) => {
      setErro(e);
      atualizar();
    },
  });

  const porColuna = useMemo(() => {
    const m = new Map<number, CartaoQuadro[]>();
    for (const c of cartoes.data ?? []) {
      // A sugestão aparece na coluna sugerida (tracejada), esperando confirmar.
      const onde = c.sugeridaId ?? c.colunaId;
      if (onde) m.set(onde, [...(m.get(onde) ?? []), c]);
    }
    return m;
  }, [cartoes.data]);

  const soltar = (colunaId: number) => {
    const c = arrastado;
    setArrastado(null);
    setAlvo(null);
    if (!c || (c.colunaId === colunaId && !c.sugeridaId)) return;
    acao.mutate({ caminho: `/${c.empresaId}`, metodo: 'PATCH', corpo: { colunaId } });
  };

  const topo = (
    <div className="topo">
      <div>
        <h1>Quadros</h1>
        <p>
          Colunas com gatilhos: a IA lê as conversas e põe cada lead onde ele está.{' '}
          <LinkAjuda artigo="quadros" />
        </p>
      </div>
      {admin && q.data && q.data.length > 0 && (
        <div className="acoes">
          {quadro && (
            <Button variant="secondary" icon="settings" onClick={() => setEditando(quadro)}>
              Editar quadro
            </Button>
          )}
          <Button variant="secondary" icon="plus" onClick={() => setEditando('novo')}>
            Novo quadro
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <>
      {topo}
      {q.isPending ? (
        <div className="esqueleto" style={{ height: 320 }} />
      ) : q.error ? (
        <ErroDaApi erro={q.error} />
      ) : !quadro ? (
        <EmptyState
          icone="layout-grid"
          titulo="Nenhum quadro ainda"
          texto={
            admin
              ? 'Monte um quadro com as situações que importam para a sua venda (achou caro, sem estoque, vai pensar). A IA lê as conversas e põe cada lead na coluna certa.'
              : 'Quem administra a conta monta os quadros. Depois, os seus leads aparecem aqui.'
          }
          acao={
            admin && (
              <Button variant="primary" icon="plus" onClick={() => setEditando('novo')}>
                Criar o primeiro quadro
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="barra quadros__barra">
            {q.data.length > 1 && (
              <div className="segmentos" role="tablist" aria-label="Quadro">
                {q.data.map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    role="tab"
                    aria-selected={x.id === quadro.id}
                    className="segmento"
                    data-ativo={x.id === quadro.id || undefined}
                    onClick={() => mudar({ quadro: String(x.id) })}
                  >
                    {x.nome}
                    {x.sugestoes > 0 && <span className="quadros__sugestoes">{x.sugestoes}</span>}
                  </button>
                ))}
              </div>
            )}
            {!soPropria && (
              <select
                className="filtro"
                aria-label="Responsável"
                value={responsavel}
                onChange={(e) => mudar({ responsavel: e.target.value === 'todos' ? null : e.target.value })}
              >
                <option value="todos">Todos os responsáveis</option>
                <option value="eu">Os meus</option>
                {equipe.data?.usuarios
                  .filter((u) => u.ativo)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nome}
                    </option>
                  ))}
              </select>
            )}
            <span className="quieto quadros__estado">
              <Icon name={quadro.ia ? 'sparkles' : 'pause'} size={14} />{' '}
              {!quadro.ia
                ? 'IA desligada neste quadro: só à mão'
                : quadro.confirmar
                  ? 'A IA sugere e alguém confirma'
                  : 'A IA já move os leads'}
            </span>
          </div>
          <ErroDaApi erro={erro} />
          {quadro.sugestoes > 0 && (
            <Mensagem tipo="aviso">
              {quadro.sugestoes === 1
                ? '1 sugestão da IA esperando confirmar'
                : `${fmtNumero(quadro.sugestoes)} sugestões da IA esperando confirmar`}{' '}
              (tracejadas). Confirme se a IA acertou ou descarte.
            </Mensagem>
          )}
          <div className="quadro">
            {quadro.colunas.map((col) => {
              const lista = porColuna.get(col.id) ?? [];
              const recebendo = !!arrastado && alvo === col.id;
              return (
                <section
                  key={col.id}
                  className="coluna"
                  style={{ '--cor-etapa': COR_COLUNA[col.cor] } as CSSProperties}
                  data-recebendo={recebendo || undefined}
                  aria-label={`${col.nome}: ${lista.length}`}
                  onDragOver={(e) => {
                    if (!arrastado) return;
                    e.preventDefault();
                    setAlvo(col.id);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setAlvo(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    soltar(col.id);
                  }}
                >
                  <header className="coluna__topo">
                    <span className="coluna__nome">
                      <b>{col.nome}</b>
                      <span className="coluna__conta">{fmtNumero(lista.length)}</span>
                    </span>
                    {!soLeitura && (
                      <button
                        type="button"
                        className="botao-icone coluna__novo"
                        aria-label={`Pôr um lead em ${col.nome}`}
                        title={`Pôr um lead em ${col.nome}`}
                        onClick={() => setPondo(col.id)}
                      >
                        <Icon name="plus" size={14} />
                      </button>
                    )}
                  </header>
                  {col.gatilho && quadro.ia ? (
                    <p className="coluna__dica" title="Gatilho da IA">
                      <Icon name="sparkles" size={12} /> {col.gatilho}
                    </p>
                  ) : (
                    <p className="coluna__dica">Só à mão</p>
                  )}
                  <div className="coluna__cards">
                    {lista.map((c) => (
                      <Cartao
                        key={c.empresaId}
                        c={c}
                        quadro={quadro}
                        soLeitura={soLeitura}
                        arrastando={arrastado?.empresaId === c.empresaId}
                        aoArrastar={() => setArrastado(c)}
                        aoAbrir={() => mudar({ empresa: String(c.empresaId) })}
                        aoConversa={() => navegar(`/conversas?lead=${c.empresaId}`)}
                        ocupado={acao.isPending}
                        aoConfirmar={() =>
                          acao.mutate({ caminho: `/${c.empresaId}/confirmar`, metodo: 'POST' })
                        }
                        aoDescartar={() =>
                          acao.mutate({ caminho: `/${c.empresaId}/descartar`, metodo: 'POST' })
                        }
                        aoTirar={() => acao.mutate({ caminho: `/${c.empresaId}`, metodo: 'DELETE' })}
                      />
                    ))}
                    {lista.length === 0 && !recebendo && <p className="coluna__vazia">Nenhum lead aqui</p>}
                    <div className="coluna__fim" />
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}

      {editando && (
        <EditarQuadro
          quadro={editando === 'novo' ? null : editando}
          primeiro={!q.data?.length}
          aoFechar={() => setEditando(null)}
          aoSalvar={(id) => {
            setEditando(null);
            atualizar();
            mudar({ quadro: id ? String(id) : null });
          }}
        />
      )}
      {pondo && quadro && (
        <PorLead
          coluna={quadro.colunas.find((c) => c.id === pondo)?.nome ?? ''}
          aoFechar={() => setPondo(null)}
          aoEscolher={(empresaId) => {
            acao.mutate({ caminho: '', metodo: 'POST', corpo: { empresaId, colunaId: pondo } });
            setPondo(null);
          }}
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

function Cartao(props: {
  c: CartaoQuadro;
  quadro: Quadro;
  soLeitura: boolean;
  arrastando: boolean;
  ocupado: boolean;
  aoArrastar: () => void;
  aoAbrir: () => void;
  aoConversa: () => void;
  aoConfirmar: () => void;
  aoDescartar: () => void;
  aoTirar: () => void;
}) {
  const { c } = props;
  const sugestao = c.sugeridaId !== null;
  const estava = sugestao ? props.quadro.colunas.find((x) => x.id === c.colunaId)?.nome : null;
  return (
    <article
      className="cartao cartao--quadro"
      data-sugestao={sugestao || undefined}
      data-arrastando={props.arrastando || undefined}
      draggable={!props.soLeitura}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(c.empresaId));
        props.aoArrastar();
      }}
    >
      <button type="button" className="cartao__abrir" onClick={props.aoAbrir}>
        <span className="cartao__topo">
          <b>{fmtNome(c.nome)}</b>
          <span className="cartao__cantos">
            <Dono id={c.responsavelId} nome={c.responsavelNome} />
          </span>
        </span>
        {sugestao && (
          <span className="etiqueta etiqueta--nova">
            <Icon name="sparkles" size={12} /> Sugestão da IA{estava ? ` · estava em ${estava}` : ''}
          </span>
        )}
        {c.trecho && (
          <span className="cartao__fala">
            <span className="cartao__fala-texto">“{c.trecho}”</span>
            {c.motivo && <span className="quieto">{c.motivo}</span>}
          </span>
        )}
        <span className="cartao__sub">
          {sugestao
            ? `sugerido ${fmtQuando(c.sugeridaEm)}`
            : c.origem === 'ia'
              ? `${c.movidoPor ? `IA, confirmado por ${c.movidoPor}` : 'pela IA'} · ${fmtQuando(c.movidoEm)}`
              : `${c.movidoPor ?? 'à mão'} · ${fmtQuando(c.movidoEm)}`}
        </span>
      </button>
      {!props.soLeitura && (
        <div className="cartao__acoes">
          {sugestao ? (
            <>
              <Button
                size="sm"
                variant="primary"
                icon="check"
                disabled={props.ocupado}
                onClick={props.aoConfirmar}
              >
                Confirmar
              </Button>
              <Button size="sm" variant="ghost" disabled={props.ocupado} onClick={props.aoDescartar}>
                Descartar
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" icon="message-circle" onClick={props.aoConversa}>
                Conversa
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon="x"
                aria-label={`Tirar ${c.nome} do quadro`}
                title="Tirar do quadro"
                disabled={props.ocupado}
                onClick={props.aoTirar}
              />
            </>
          )}
        </div>
      )}
    </article>
  );
}

/** Pôr um lead do funil numa coluna (à mão). */
function PorLead(props: { coluna: string; aoFechar: () => void; aoEscolher: (empresaId: number) => void }) {
  const [busca, setBusca] = useState('');
  const [atraso, setAtraso] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setAtraso(busca.trim()), 300);
    return () => clearTimeout(t);
  }, [busca]);
  const q = useQuery({
    queryKey: ['quadros', 'leads', atraso],
    queryFn: () =>
      api<{ empresaId: number; nome: string; responsavelNome: string | null }[]>(
        `/quadros/leads?busca=${encodeURIComponent(atraso)}`,
      ),
    placeholderData: keepPreviousData,
  });
  return (
    <Drawer titulo={`Pôr em ${props.coluna}`} barra="Quadros" aoFechar={props.aoFechar}>
      <div className="drawer__corpo pilha">
        <div className="campo">
          <label htmlFor="quadro-busca">Lead</label>
          <input
            id="quadro-busca"
            className="filtro"
            type="search"
            placeholder="Buscar pelo nome"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <ErroDaApi erro={q.error} />
        <ul className="quadros__leads">
          {q.data?.map((l) => (
            <li key={l.empresaId}>
              <button type="button" className="quadros__lead" onClick={() => props.aoEscolher(l.empresaId)}>
                <b>{fmtNome(l.nome)}</b>
                <span className="quieto">{l.responsavelNome ?? 'sem dono'}</span>
              </button>
            </li>
          ))}
          {q.data?.length === 0 && <li className="quieto">Nenhum lead do funil com esse nome.</li>}
        </ul>
      </div>
    </Drawer>
  );
}

type ColunaForm = ColunaQuadroEntrada & { chave: string };
let sequencia = 0;
const chave = () => `c${++sequencia}`;

/** Montar ou editar o quadro (só o administrador). */
function EditarQuadro(props: {
  quadro: Quadro | null;
  primeiro: boolean;
  aoFechar: () => void;
  aoSalvar: (id: number | null) => void;
}) {
  const [nome, setNome] = useState(props.quadro?.nome ?? '');
  const [ia, setIa] = useState(props.quadro?.ia ?? true);
  const [confirmar, setConfirmar] = useState(props.quadro?.confirmar ?? true);
  const [colunas, setColunas] = useState<ColunaForm[]>(
    props.quadro?.colunas.map((c) => ({ ...c, chave: chave() })) ?? [],
  );
  const [apagando, setApagando] = useState(false);
  const salvar = useMutation({
    mutationFn: () =>
      api<Quadro>(props.quadro ? `/quadros/${props.quadro.id}` : '/quadros', {
        metodo: props.quadro ? 'PUT' : 'POST',
        corpo: {
          nome,
          ia,
          confirmar,
          colunas: colunas.map(({ chave: _c, ...c }) => ({ ...c, gatilho: c.gatilho?.trim() || null })),
        },
      }),
    onSuccess: (q) => props.aoSalvar(q.id),
  });
  const apagar = useMutation({
    mutationFn: () => api(`/quadros/${props.quadro!.id}`, { metodo: 'DELETE' }),
    onSuccess: () => props.aoSalvar(null),
  });
  const mexer = (i: number, d: Partial<ColunaForm>) =>
    setColunas((cs) => cs.map((c, j) => (j === i ? { ...c, ...d } : c)));
  const trocar = (i: number, j: number) =>
    setColunas((cs) => {
      const n = [...cs];
      [n[i], n[j]] = [n[j]!, n[i]!];
      return n;
    });
  const usarModelo = (m: (typeof MODELOS)[number]) => {
    setNome(m.nome);
    setColunas(m.colunas.map((c) => ({ ...c, chave: chave() })));
  };
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    salvar.mutate();
  };
  const semGatilho = colunas.every((c) => !c.gatilho?.trim());

  return (
    <Drawer
      titulo={props.quadro ? 'Editar quadro' : 'Novo quadro'}
      barra="Quadros"
      aoFechar={props.aoFechar}
      largo
    >
      <form className="drawer__corpo form" onSubmit={enviar}>
        {!props.quadro && (
          <div className="quadros__modelos">
            <span className="quieto">Começar com um modelo:</span>
            {MODELOS.map((m) => (
              <Button key={m.nome} type="button" size="sm" variant="secondary" onClick={() => usarModelo(m)}>
                {m.nome}
              </Button>
            ))}
          </div>
        )}
        <div className="campo">
          <label htmlFor="quadro-nome">Nome do quadro</label>
          <input
            id="quadro-nome"
            className="filtro"
            maxLength={60}
            required
            placeholder="Ex.: Objeções"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
        </div>
        <label className="opcao">
          <input type="checkbox" checked={ia} onChange={(e) => setIa(e.target.checked)} />
          <span>
            <b>A IA lê as conversas</b> do WhatsApp e do Instagram e põe os leads nas colunas pelos gatilhos
            (gasta IA da conta: uma leitura por conversa que parou, só quando chega mensagem nova)
          </span>
        </label>
        {ia && (
          <fieldset className="quadros__modo">
            <legend className="pp-sr">Quando a IA acha um gatilho</legend>
            <label className="opcao">
              <input
                type="radio"
                name="quadro-modo"
                checked={confirmar}
                onChange={() => setConfirmar(true)}
              />
              <span>
                <b>Sugere e alguém confirma</b> (o dono do lead recebe um aviso). Bom para começar.
              </span>
            </label>
            <label className="opcao">
              <input
                type="radio"
                name="quadro-modo"
                checked={!confirmar}
                onChange={() => setConfirmar(false)}
              />
              <span>
                <b>Já move</b> o lead, com o trecho da conversa no cartão.
              </span>
            </label>
          </fieldset>
        )}

        <h3 className="subtitulo">Colunas</h3>
        <p className="quieto" style={{ margin: 0 }}>
          Escreva o gatilho como você explicaria para um vendedor novo: “o cliente disse que achou caro ou
          pediu desconto”. Coluna sem gatilho é só para mover à mão.
        </p>
        <ol className="quadros__colunas">
          {colunas.map((c, i) => (
            <li
              key={c.chave}
              className="quadros__coluna"
              style={{ '--cor-etapa': COR_COLUNA[c.cor] } as CSSProperties}
            >
              <div className="barra">
                <label className="pp-sr" htmlFor={`col-nome-${c.chave}`}>
                  Nome da coluna {i + 1}
                </label>
                <input
                  id={`col-nome-${c.chave}`}
                  className="filtro"
                  style={{ flex: '1 1 160px' }}
                  maxLength={40}
                  required
                  placeholder="Nome da coluna"
                  value={c.nome}
                  onChange={(e) => mexer(i, { nome: e.target.value })}
                />
                <label className="pp-sr" htmlFor={`col-cor-${c.chave}`}>
                  Cor
                </label>
                <select
                  id={`col-cor-${c.chave}`}
                  className="filtro"
                  value={c.cor}
                  onChange={(e) => mexer(i, { cor: e.target.value as CorColuna })}
                >
                  {CORES_COLUNA.map((k) => (
                    <option key={k} value={k}>
                      {ROTULO_COR[k]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="botao-icone"
                  aria-label="Subir"
                  disabled={i === 0}
                  onClick={() => trocar(i, i - 1)}
                >
                  <Icon name="arrow-up" size={14} />
                </button>
                <button
                  type="button"
                  className="botao-icone"
                  aria-label="Descer"
                  disabled={i === colunas.length - 1}
                  onClick={() => trocar(i, i + 1)}
                >
                  <Icon name="arrow-down" size={14} />
                </button>
                <button
                  type="button"
                  className="botao-icone"
                  aria-label={`Tirar a coluna ${c.nome || i + 1}`}
                  onClick={() => setColunas((cs) => cs.filter((_, j) => j !== i))}
                >
                  <Icon name="trash-2" size={14} />
                </button>
              </div>
              <label className="pp-sr" htmlFor={`col-gatilho-${c.chave}`}>
                Gatilho da coluna {c.nome}
              </label>
              <textarea
                id={`col-gatilho-${c.chave}`}
                className="filtro"
                rows={2}
                maxLength={300}
                placeholder="Gatilho (opcional): quando o lead vem para cá"
                value={c.gatilho ?? ''}
                onChange={(e) => mexer(i, { gatilho: e.target.value })}
              />
            </li>
          ))}
        </ol>
        {colunas.length < MAX_COLUNAS_QUADRO && (
          <div>
            <Button
              type="button"
              variant="secondary"
              icon="plus"
              size="sm"
              onClick={() =>
                setColunas((cs) => [...cs, { nome: '', gatilho: null, cor: 'cinza', chave: chave() }])
              }
            >
              Adicionar coluna
            </Button>
          </div>
        )}
        {props.quadro && (
          <span className="campo__dica">Tirar uma coluna tira do quadro os leads que estão nela.</span>
        )}
        {ia && semGatilho && colunas.length > 0 && (
          <Mensagem tipo="aviso">
            Nenhuma coluna tem gatilho: a IA não tem o que procurar neste quadro.
          </Mensagem>
        )}
        <ErroDaApi erro={salvar.error ?? apagar.error} />
        <div className="acoes">
          {props.quadro &&
            (apagando ? (
              <>
                <span className="quieto">Apagar “{props.quadro.nome}” e tirar todos os leads dele?</span>
                <Button
                  type="button"
                  variant="danger"
                  disabled={apagar.isPending}
                  onClick={() => apagar.mutate()}
                >
                  Apagar o quadro
                </Button>
                <Button type="button" variant="ghost" onClick={() => setApagando(false)}>
                  Manter
                </Button>
              </>
            ) : (
              <Button type="button" variant="ghost" icon="trash-2" onClick={() => setApagando(true)}>
                Apagar quadro
              </Button>
            ))}
          <Button
            type="submit"
            variant="primary"
            disabled={salvar.isPending || !colunas.length || !nome.trim()}
          >
            {salvar.isPending ? 'Salvando…' : props.quadro ? 'Salvar' : 'Criar quadro'}
          </Button>
        </div>
        {props.primeiro && (
          <p className="quieto" style={{ margin: 0 }}>
            Os leads entram no quadro sozinhos quando a IA acha um gatilho numa conversa nova, ou à mão pelo{' '}
            <b>+</b> de cada coluna. Veja como funciona na <Link to="/ajuda/quadros">ajuda</Link>.
          </p>
        )}
      </form>
    </Drawer>
  );
}
