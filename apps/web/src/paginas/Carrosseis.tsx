import {
  ESTILO,
  ESTILOS,
  type EstiloCarrossel,
  FONTES_DO_PAR,
  type IdentidadeCarrossel,
  montarSlide,
  PARES_FONTES,
  paletaDaIdentidade,
  type ResumoCarrossel,
  ROTULO_SITUACAO_CARROSSEL,
  type SlideCarrossel,
  slideNovo,
} from '@prospeccao/shared/carrosseis';
import { MODULOS } from '@prospeccao/shared/planos';
import { Badge, Button, EmptyState, Icon } from '@prospeccao/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { api } from '../api';
import { AbaCerebro } from '../carrossel/Cerebro';
import {
  enviarImagem,
  type IdentidadeDaConta,
  logosDaIdentidade,
  type SituacaoCarrosseis,
  urlFoto,
  useFotos,
  useIdentidade,
  useListaCarrosseis,
  useSituacaoCarrosseis,
} from '../carrossel/dados';
import { SlideHtml } from '../carrossel/SlideHtml';
import { CartaoPedido, NovoComTime } from '../carrossel/Time';
import { ApresentacaoDoTime, FaixaDoTime } from '../carrossel/TimeDeIa';
import { LinkAjuda } from '../componentes/Ajuda';
import { Drawer } from '../componentes/Drawer';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { useEhAdmin } from '../componentes/Sessao';
import { fmtNumero, fmtQuando } from '../formatar';

/**
 * Carrosséis com IA (módulo à parte, só o administrador): a lista dos carrosséis (e os pedidos que
 * o time de IA está fazendo), o cérebro da marca que o time lê e a identidade visual que todos
 * seguem (cores, fontes, estilo, logo e as fotos da empresa). O editor fica em CarrosselEditor.
 */

type Aba = 'carrosseis' | 'cerebro' | 'identidade';
const ABAS: { id: Aba; rotulo: string }[] = [
  { id: 'carrosseis', rotulo: 'Carrosséis' },
  { id: 'cerebro', rotulo: 'Cérebro da marca' },
  { id: 'identidade', rotulo: 'Identidade visual' },
];

export function Carrosseis() {
  const admin = useEhAdmin();
  const [params, setParams] = useSearchParams();
  const situacao = useSituacaoCarrosseis();
  const pedida = params.get('aba');
  const aba: Aba = pedida === 'identidade' || pedida === 'cerebro' ? pedida : 'carrosseis';
  const [novo, setNovo] = useState(false);
  // A apresentação do time: abre sozinha na primeira entrada (uma vez por pessoa) e pela faixa.
  const [apresentar, setApresentar] = useState<'primeira' | 'de-novo' | null>(null);
  const cliente = useQueryClient();
  const d = situacao.data;
  const mostrarTime = !!d?.modulo && !!d.ia.ligada;
  const jaApresentou = useRef(false);
  useEffect(() => {
    if (mostrarTime && d && !d.timeVisto && !jaApresentou.current) {
      jaApresentou.current = true;
      setApresentar('primeira');
    }
  }, [mostrarTime, d]);
  const marcarVisto = useMutation({
    mutationFn: () => api('/carrosseis/time-visto', { metodo: 'POST' }),
    onSuccess: () =>
      cliente.setQueryData<SituacaoCarrosseis>(['carrosseis', 'situacao'], (x) =>
        x ? { ...x, timeVisto: true } : x,
      ),
  });
  const fecharApresentacao = () => {
    if (apresentar === 'primeira') marcarVisto.mutate();
    setApresentar(null);
  };

  if (!admin) return <Navigate to="/" replace />;
  if (situacao.isPending) return <div className="esqueleto" style={{ height: 320 }} />;
  if (situacao.error) return <ErroDaApi erro={situacao.error} />;
  if (!situacao.data.modulo) return <ModuloFora />;

  return (
    <div className="carrosseis">
      <div className="topo">
        <div>
          <h1>Carrosséis</h1>
          <p>Carrosséis do Instagram com a identidade da empresa, prontos para postar.</p>
        </div>
        <div className="acoes">
          <LinkAjuda artigo="carrosseis">Como funciona</LinkAjuda>
          <Button variant="primary" icon="plus" onClick={() => setNovo(true)}>
            Novo carrossel
          </Button>
        </div>
      </div>
      {!situacao.data.armazenamento && (
        <Mensagem tipo="aviso">
          O armazenamento de arquivos não está ligado: dá para montar carrosséis só com texto, mas as fotos e
          as logos próprias não podem ser enviadas. Fale com a gente.
        </Mensagem>
      )}
      {mostrarTime && aba === 'carrosseis' && apresentar !== 'primeira' && (
        <FaixaDoTime aoConhecer={() => setApresentar('de-novo')} />
      )}
      <div className="pipelines" role="tablist" aria-label="Seções dos carrosséis">
        {ABAS.map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={aba === a.id}
            className="pipelines__aba"
            onClick={() => setParams({ aba: a.id }, { replace: true })}
          >
            {a.rotulo}
          </button>
        ))}
      </div>
      {aba === 'carrosseis' ? (
        <AbaCarrosseis
          situacao={situacao.data}
          aoNovo={() => setNovo(true)}
          aoIdentidade={() => setParams({ aba: 'identidade' })}
          aoCerebro={() => setParams({ aba: 'cerebro' })}
        />
      ) : aba === 'cerebro' ? (
        <AbaCerebro />
      ) : (
        <AbaIdentidade />
      )}
      {apresentar && (
        <ApresentacaoDoTime
          primeiraVez={apresentar === 'primeira'}
          aoFechar={fecharApresentacao}
          aoCriar={() => {
            fecharApresentacao();
            setNovo(true);
          }}
        />
      )}
      {novo && (
        <NovoCarrossel
          situacao={situacao.data}
          aoFechar={() => setNovo(false)}
          aoCerebro={() => {
            setNovo(false);
            setParams({ aba: 'cerebro' });
          }}
        />
      )}
    </div>
  );
}

function ModuloFora() {
  const m = MODULOS.carrosseis;
  return (
    <section className="fora-plano" aria-labelledby="carrosseis-fora">
      <span className="fora-plano__icone" aria-hidden="true">
        <Icon name="lock" size={22} />
      </span>
      <h1 id="carrosseis-fora" className="fora-plano__titulo">
        {m.nome}
      </h1>
      <p className="fora-plano__texto">{m.descricao}</p>
      <p className="fora-plano__texto fora-plano__plano">
        <b>É um módulo à parte</b>, sem limite de carrosséis. O preço aparece ao assinar.
      </p>
      <Button variant="primary" href="/plano/assinar">
        Assinar o módulo
      </Button>
    </section>
  );
}

/* ───────────────────────────── Lista ───────────────────────────── */

type Filtro = 'todos' | 'rascunho' | 'pronto';

function AbaCarrosseis(props: {
  situacao: SituacaoCarrosseis;
  aoNovo: () => void;
  aoIdentidade: () => void;
  aoCerebro: () => void;
}) {
  const q = useListaCarrosseis();
  const identidade = useIdentidade();
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const cliente = useQueryClient();
  const navegar = useNavigate();
  const acao = useMutation({
    mutationFn: (p: { id: number; tipo: 'duplicar' | 'apagar' }) =>
      p.tipo === 'duplicar'
        ? api<{ id: number }>(`/carrosseis/${p.id}/duplicar`, { metodo: 'POST' })
        : api(`/carrosseis/${p.id}`, { metodo: 'DELETE' }),
    onSuccess: (r, p) => {
      void cliente.invalidateQueries({ queryKey: ['carrosseis'] });
      if (p.tipo === 'duplicar' && r && typeof r === 'object' && 'id' in r)
        navegar(`/carrosseis/${(r as { id: number }).id}`);
    },
  });

  if (q.isPending) return <div className="esqueleto" style={{ height: 320 }} />;
  if (q.error) return <ErroDaApi erro={q.error} />;
  const lista = q.data.carrosseis.filter((c) => filtro === 'todos' || c.situacao === filtro);
  // Os pedidos ao time são rascunhos que ainda não nasceram: aparecem em Todos e em Rascunhos.
  const pedidos = filtro === 'pronto' ? [] : q.data.pedidos;
  const { franquia } = q.data;

  return (
    <div className="carrosseis__lista">
      {identidade.data && !identidade.data.salva ? (
        <div className="carrosseis__comece" role="note">
          <Icon name="palette" size={18} />
          <span>
            <b>Comece pela identidade visual.</b> Cores, fontes, estilo e logo: todos os carrosséis saem dela,
            para o feed ter cara de uma marca só.
          </span>
          <Button size="sm" variant="secondary" onClick={props.aoIdentidade}>
            Montar a identidade
          </Button>
        </div>
      ) : props.situacao.ia.ligada && !props.situacao.ia.cerebroConferido ? (
        <div className="carrosseis__comece" role="note">
          <Icon name="sparkles" size={18} />
          <span>
            <b>Agora, o cérebro da marca.</b> A IA lê o que o CRM já sabe da empresa e monta o dossiê; você
            confere e o time passa a escrever os carrosséis.
          </span>
          <Button size="sm" variant="secondary" onClick={props.aoCerebro}>
            Abrir o cérebro da marca
          </Button>
        </div>
      ) : null}
      <div className="barra carrosseis__barra">
        <div className="segmentos" role="radiogroup" aria-label="Situação">
          {(
            [
              ['todos', 'Todos'],
              ['rascunho', 'Rascunhos'],
              ['pronto', 'Prontos'],
            ] as const
          ).map(([id, rotulo]) => (
            <label key={id} className="segmento">
              <input
                type="radio"
                name="carrosseis-filtro"
                className="pp-sr"
                checked={filtro === id}
                onChange={() => setFiltro(id)}
              />
              {rotulo}
            </label>
          ))}
        </div>
        {franquia.limite != null && (
          <span className="quieto carrosseis__franquia">
            Feitos pelo time de IA no mês: <b className="mono">{fmtNumero(franquia.usados)}</b> de{' '}
            {fmtNumero(franquia.limite)}
          </span>
        )}
      </div>
      {acao.error && <ErroDaApi erro={acao.error} />}
      {!q.data.carrosseis.length && !q.data.pedidos.length ? (
        <EmptyState
          icone="gallery-horizontal-end"
          titulo="Nenhum carrossel ainda"
          texto="Peça o primeiro ao time de IA ou monte à mão: capa, os pontos principais e a chamada final, com a identidade da empresa."
          acao={
            <Button variant="primary" icon="plus" onClick={props.aoNovo}>
              Novo carrossel
            </Button>
          }
        />
      ) : !lista.length && !pedidos.length ? (
        <p className="quieto">Nenhum carrossel nesta situação.</p>
      ) : (
        <ul className="carrosseis__grade">
          {/* O que o time ainda está fazendo vem primeiro, no mesmo lugar onde o carrossel vai aparecer. */}
          {pedidos.map((p) => (
            <CartaoPedido key={`p${p.id}`} p={p} />
          ))}
          {lista.map((c) => (
            <CartaoCarrossel
              key={c.id}
              c={c}
              aoDuplicar={() => acao.mutate({ id: c.id, tipo: 'duplicar' })}
              aoApagar={() => {
                if (window.confirm(`Apagar o carrossel "${c.titulo}"? Não dá para desfazer.`))
                  acao.mutate({ id: c.id, tipo: 'apagar' });
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

const TOM_SITUACAO = {
  rascunho: 'neutral',
  pronto: 'brand',
  agendado: 'warning',
  publicado: 'brand',
  falhou: 'danger',
} as const;

function CartaoCarrossel(props: { c: ResumoCarrossel; aoDuplicar: () => void; aoApagar: () => void }) {
  const { c } = props;
  return (
    <li className="carrossel-cartao">
      <Link to={`/carrosseis/${c.id}`} className="carrossel-cartao__capa" aria-label={`Abrir ${c.titulo}`}>
        <img
          className="carrossel-cartao__img"
          src={`/api/carrosseis/${c.id}/slides/0?largura=360&v=${c.versao}`}
          alt=""
          loading="lazy"
        />
      </Link>
      <div className="carrossel-cartao__info">
        <Link to={`/carrosseis/${c.id}`} className="carrossel-cartao__titulo">
          {c.titulo}
        </Link>
        <div className="carrossel-cartao__meta">
          {c.situacao === 'pronto' && c.publicacao?.esperando ? (
            <Badge tone="warning">Esperando postar</Badge>
          ) : (
            <Badge tone={TOM_SITUACAO[c.situacao]}>{ROTULO_SITUACAO_CARROSSEL[c.situacao]}</Badge>
          )}
          {c.origem === 'ia' && (
            <Badge tone="neutral">
              <Icon name="sparkles" size={11} /> Time de IA
            </Badge>
          )}
          {c.avisosAbertos > 0 && (
            <Badge tone="warning">
              {c.avisosAbertos} {c.avisosAbertos === 1 ? 'ponto' : 'pontos'} da revisora
            </Badge>
          )}
          <span className="quieto">
            {c.slides} slides · {ESTILO[c.estilo].nome} · {fmtQuando(c.atualizadoEm)}
          </span>
        </div>
        {c.publicacao?.palavra && (
          <Link to={`/carrosseis/${c.id}?aba=publicacao`} className="carrossel-cartao__pub">
            Comente {c.publicacao.palavra}
            {' · '}
            {!c.publicacao.ligada
              ? 'regra desligada'
              : c.publicacao.esperando
                ? 'regra pronta, liga quando o post aparecer'
                : `${fmtNumero(c.publicacao.comentaram)} comentaram · ${fmtNumero(c.publicacao.leads)} ${c.publicacao.leads === 1 ? 'lead' : 'leads'}`}
          </Link>
        )}
        <div className="carrossel-cartao__acoes">
          <Button size="sm" variant="ghost" icon="copy" onClick={props.aoDuplicar}>
            Duplicar
          </Button>
          <Button size="sm" variant="ghost" icon="trash-2" onClick={props.aoApagar}>
            Apagar
          </Button>
        </div>
      </div>
    </li>
  );
}

function NovoCarrossel(props: { situacao: SituacaoCarrosseis; aoFechar: () => void; aoCerebro: () => void }) {
  const identidade = useIdentidade();
  const [modo, setModo] = useState<'time' | 'branco'>(props.situacao.ia.ligada ? 'time' : 'branco');
  const [titulo, setTitulo] = useState('');
  const [estilo, setEstilo] = useState<EstiloCarrossel | null>(null);
  const [comeco, setComeco] = useState<'roteiro' | 'capa'>('roteiro');
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const criar = useMutation({
    mutationFn: () =>
      api<{ id: number }>('/carrosseis', {
        metodo: 'POST',
        corpo: { titulo, estilo: estilo ?? identidade.data?.identidade.estilo, comeco },
      }),
    onSuccess: (r) => {
      void cliente.invalidateQueries({ queryKey: ['carrosseis'] });
      navegar(`/carrosseis/${r.id}`);
    },
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    criar.mutate();
  };
  const estiloAtual = estilo ?? identidade.data?.identidade.estilo ?? 'editorial';
  if (modo === 'time')
    return (
      <Drawer titulo="Novo carrossel" barra="Novo carrossel" aoFechar={props.aoFechar}>
        <div className="drawer__corpo">
          <NovoComTime
            situacao={props.situacao}
            estiloDaIdentidade={identidade.data?.identidade.estilo ?? 'editorial'}
            aoEmBranco={() => setModo('branco')}
            aoFechar={props.aoFechar}
            aoCerebro={props.aoCerebro}
          />
        </div>
      </Drawer>
    );
  return (
    <Drawer titulo="Novo carrossel" barra="Novo carrossel em branco" aoFechar={props.aoFechar}>
      <div className="drawer__corpo">
        <form className="form" onSubmit={enviar}>
          <div className="campo">
            <label htmlFor="nc-titulo">Sobre o que é o carrossel</label>
            <input
              id="nc-titulo"
              className="filtro"
              value={titulo}
              maxLength={120}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ex.: 5 sinais de que está na hora de trocar a pastilha de freio"
              required
            />
            <span className="campo__dica">Vira o título da capa. Dá para mudar tudo depois.</span>
          </div>
          <fieldset className="campo">
            <legend>Estilo</legend>
            <div className="segmentos">
              {ESTILOS.map((e) => (
                <label key={e} className="segmento">
                  <input
                    type="radio"
                    name="nc-estilo"
                    className="pp-sr"
                    checked={estiloAtual === e}
                    onChange={() => setEstilo(e)}
                  />
                  {ESTILO[e].nome}
                  {identidade.data?.identidade.estilo === e ? ' (da identidade)' : ''}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="campo">
            <legend>Começar com</legend>
            <label className="opcao">
              <input
                type="radio"
                name="nc-comeco"
                checked={comeco === 'roteiro'}
                onChange={() => setComeco('roteiro')}
              />
              <span>
                <b>Roteiro pronto</b>{' '}
                <span className="quieto">· capa, 3 pontos e a chamada final, para trocar o texto</span>
              </span>
            </label>
            <label className="opcao">
              <input
                type="radio"
                name="nc-comeco"
                checked={comeco === 'capa'}
                onChange={() => setComeco('capa')}
              />
              <span>
                <b>Só a capa</b> <span className="quieto">· você monta o resto</span>
              </span>
            </label>
          </fieldset>
          {props.situacao.ia.ligada && (
            <button type="button" className="link-botao" onClick={() => setModo('time')}>
              <Icon name="sparkles" size={14} /> Prefiro que o time de IA escreva
            </button>
          )}
          {criar.error && <ErroDaApi erro={criar.error} />}
          <div className="acoes">
            <Button type="submit" variant="primary" disabled={!titulo.trim() || criar.isPending}>
              {criar.isPending ? 'Criando…' : 'Criar e abrir o editor'}
            </Button>
            <Button type="button" variant="ghost" onClick={props.aoFechar}>
              Cancelar
            </Button>
          </div>
        </form>
      </div>
    </Drawer>
  );
}

/* ───────────────────────────── Identidade visual ───────────────────────────── */

/** Carrossel de exemplo da prévia da identidade (texto genérico, troca só a marca). */
function exemplo(id: IdentidadeCarrossel): SlideCarrossel[] {
  const marcaNome = id.marcaTexto || 'sua empresa';
  return [
    {
      ...slideNovo('capa', 'e1'),
      sobretitulo: 'Dica rápida',
      titulo: 'Como responder o cliente em menos de 5 minutos',
    },
    {
      ...slideNovo('item', 'e2'),
      destaque: '1',
      titulo: 'Deixe a primeira mensagem pronta',
      texto: 'Um texto curto que já pergunta o que a pessoa precisa. Quem atende só troca o nome.',
    },
    { ...slideNovo('citacao', 'e3'), titulo: 'Quem responde primeiro costuma levar a conversa.' },
    {
      ...slideNovo('chamada', 'e4'),
      titulo: `Fale com a ${marcaNome}`,
      botao: 'Comente QUERO',
      texto: 'A gente te manda no direct.',
    },
  ];
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const ROTULO_COR = {
  principal: 'Principal',
  destaque: 'Destaque',
  claro: 'Fundo claro',
  texto: 'Texto',
} as const;
const DICA_COR = {
  principal: 'Fundos fortes e botões',
  destaque: 'Números, aspas e a chamada final',
  claro: 'Fundo dos slides claros',
  texto: 'Títulos e texto sobre o claro',
} as const;

function AbaIdentidade() {
  const q = useIdentidade();
  if (q.isPending) return <div className="esqueleto" style={{ height: 480 }} />;
  if (q.error) return <ErroDaApi erro={q.error} />;
  return <FormIdentidade d={q.data} />;
}

function FormIdentidade(props: { d: IdentidadeDaConta }) {
  const cliente = useQueryClient();
  const [f, setF] = useState<IdentidadeCarrossel>(props.d.identidade);
  const [hex, setHex] = useState<Record<keyof IdentidadeCarrossel['cores'], string>>(
    props.d.identidade.cores,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: recarrega quando o servidor devolve a identidade salva
  useEffect(() => {
    setF(props.d.identidade);
    setHex(props.d.identidade.cores);
  }, [props.d.atualizadaEm]);
  const mudouAlgo = JSON.stringify(f) !== JSON.stringify(props.d.identidade);
  const salvar = useMutation({
    mutationFn: () => api('/carrosseis/identidade', { metodo: 'PUT', corpo: f }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['carrosseis'] }),
  });
  const paleta = useMemo(() => paletaDaIdentidade(f.cores), [f.cores]);
  const cor = (k: keyof IdentidadeCarrossel['cores'], v: string) => {
    setHex((h) => ({ ...h, [k]: v }));
    if (HEX.test(v)) setF((x) => ({ ...x, cores: { ...x.cores, [k]: v.toUpperCase() } }));
  };
  const marca = props.d.marca.cores;
  const temCoresDaMarca = !!(marca.principal || marca.destaque || marca.claro);
  const usarMarca = () => {
    const novas = {
      ...f.cores,
      ...(marca.principal ? { principal: marca.principal.toUpperCase() } : {}),
      ...(marca.destaque ? { destaque: marca.destaque.toUpperCase() } : {}),
      ...(marca.claro ? { claro: marca.claro.toUpperCase() } : {}),
    };
    setF((x) => ({ ...x, cores: novas }));
    setHex(novas);
  };

  return (
    <form
      className="identidade"
      onSubmit={(e) => {
        e.preventDefault();
        salvar.mutate();
      }}
    >
      <div className="identidade__campos">
        <section className="pp-panel identidade__bloco" aria-labelledby="id-cores">
          <div className="identidade__titulo">
            <h2 id="id-cores">Cores</h2>
            {temCoresDaMarca && (
              <Button type="button" size="sm" variant="ghost" onClick={usarMarca}>
                Usar as cores de Marca e domínio
              </Button>
            )}
          </div>
          <div className="identidade__cores">
            {(Object.keys(ROTULO_COR) as (keyof typeof ROTULO_COR)[]).map((k) => (
              <div key={k} className="campo">
                <label htmlFor={`id-cor-${k}`}>{ROTULO_COR[k]}</label>
                <span className="identidade__cor">
                  <input
                    type="color"
                    aria-label={`${ROTULO_COR[k]}: escolher`}
                    value={f.cores[k].toLowerCase()}
                    onChange={(e) => cor(k, e.target.value)}
                  />
                  <input
                    id={`id-cor-${k}`}
                    className="filtro mono"
                    value={hex[k]}
                    maxLength={7}
                    onChange={(e) => cor(k, e.target.value.trim())}
                    aria-invalid={!HEX.test(hex[k]) || undefined}
                  />
                </span>
                <span className="campo__dica">{DICA_COR[k]}</span>
              </div>
            ))}
          </div>
          {paleta.ajustes.length ? (
            <ul className="identidade__ajustes">
              {paleta.ajustes.map((a) => (
                <li key={a}>
                  <Icon name="circle-help" size={14} /> {a}
                </li>
              ))}
            </ul>
          ) : (
            <p className="identidade__ok">
              <Icon name="badge-check" size={14} /> Leitura conferida: o texto passa de 4,5:1 sobre todos os
              fundos.
            </p>
          )}
        </section>

        <section className="pp-panel identidade__bloco" aria-labelledby="id-estilo">
          <h2 id="id-estilo">Estilo dos slides</h2>
          <p className="quieto">
            Cada estilo tem os seus modelos de capa, item, texto, lista, número, citação, antes e depois, foto
            e chamada final. Os carrosséis saem dele, para o feed ter cara de uma marca só.
          </p>
          <div className="identidade__estilos" role="radiogroup" aria-label="Estilo">
            {ESTILOS.map((e) => (
              <label key={e} className="identidade__estilo" data-ativo={f.estilo === e || undefined}>
                <input
                  type="radio"
                  name="id-estilo"
                  className="pp-sr"
                  checked={f.estilo === e}
                  onChange={() => setF({ ...f, estilo: e })}
                />
                <SlideHtml
                  largura={150}
                  no={
                    montarSlide({
                      slide: exemplo(f)[0]!,
                      indice: 0,
                      total: 4,
                      identidade: f,
                      estilo: e,
                      ...logosDaIdentidade(props.d, f),
                    }).no
                  }
                />
                <b>{ESTILO[e].nome}</b>
                <span className="quieto">{ESTILO[e].descricao}</span>
              </label>
            ))}
          </div>
        </section>

        <section
          className="pp-panel identidade__bloco identidade__duas"
          aria-label="Fontes, logo e assinatura"
        >
          <div>
            <h2>Fontes</h2>
            <div className="campo">
              <label htmlFor="id-fontes">Par de fontes</label>
              <select
                id="id-fontes"
                value={f.fontes}
                onChange={(e) => setF({ ...f, fontes: e.target.value as IdentidadeCarrossel['fontes'] })}
              >
                {PARES_FONTES.map((p) => (
                  <option key={p} value={p}>
                    {FONTES_DO_PAR[p].nome}
                  </option>
                ))}
              </select>
            </div>
            <p
              className="identidade__amostra"
              style={{
                fontFamily: FONTES_DO_PAR[f.fontes].titulo.familia,
                fontWeight: FONTES_DO_PAR[f.fontes].titulo.peso,
                textTransform: FONTES_DO_PAR[f.fontes].titulo.caixaAlta ? 'uppercase' : undefined,
              }}
            >
              Títulos assim
            </p>
            <p className="identidade__amostra-texto" style={{ fontFamily: FONTES_DO_PAR[f.fontes].corpo }}>
              E o texto dos slides assim, fácil de ler no celular.
            </p>
          </div>
          <div>
            <h2>Logo e assinatura</h2>
            <Logos
              d={props.d}
              usarMarca={f.usarLogoDaMarca}
              aoUsarMarca={(v) => setF({ ...f, usarLogoDaMarca: v })}
            />
            <div className="campo">
              <label htmlFor="id-assinatura">Assinatura no rodapé</label>
              <input
                id="id-assinatura"
                className="filtro"
                value={f.assinatura}
                maxLength={40}
                placeholder="@suaempresa"
                onChange={(e) => setF({ ...f, assinatura: e.target.value })}
              />
            </div>
            <div className="campo">
              <label htmlFor="id-marca-texto">Nome no lugar da logo</label>
              <input
                id="id-marca-texto"
                className="filtro"
                value={f.marcaTexto}
                maxLength={30}
                placeholder="Usado quando não há logo"
                onChange={(e) => setF({ ...f, marcaTexto: e.target.value })}
              />
            </div>
            <label className="opcao">
              <input
                type="checkbox"
                checked={f.logoNaCapa}
                onChange={(e) => setF({ ...f, logoNaCapa: e.target.checked })}
              />
              <span>Logo na capa</span>
            </label>
            <label className="opcao">
              <input
                type="checkbox"
                checked={f.logoNaChamada}
                onChange={(e) => setF({ ...f, logoNaChamada: e.target.checked })}
              />
              <span>Logo na chamada final</span>
            </label>
            <label className="opcao">
              <input
                type="checkbox"
                checked={f.numeroDoSlide}
                onChange={(e) => setF({ ...f, numeroDoSlide: e.target.checked })}
              />
              <span>Número do slide (2/7) no rodapé</span>
            </label>
          </div>
        </section>

        <section className="pp-panel identidade__bloco" aria-labelledby="id-fala">
          <h2 id="id-fala">Como a empresa fala</h2>
          <p className="quieto">
            O público, o tom de voz, o que a empresa vende e o que nunca dizer ficam no{' '}
            <Link to="/carrosseis?aba=cerebro">cérebro da marca</Link>, junto com as provas e o que os
            clientes perguntam. É de lá que o time de IA escreve.
          </p>
        </section>

        <FotosDaEmpresa />

        <div className="acoes identidade__salvar">
          {salvar.error && <ErroDaApi erro={salvar.error} />}
          {salvar.isSuccess && !mudouAlgo && <Mensagem tipo="ok">Identidade salva.</Mensagem>}
          <Button type="submit" variant="primary" icon="check" disabled={!mudouAlgo || salvar.isPending}>
            {salvar.isPending ? 'Salvando…' : 'Salvar a identidade'}
          </Button>
        </div>
      </div>

      <aside className="pp-panel identidade__previa" aria-labelledby="id-previa">
        <h2 id="id-previa">Como fica</h2>
        <p className="quieto">Prévia ao vivo com um carrossel de exemplo, no estilo escolhido.</p>
        <div className="identidade__previa-grade">
          {exemplo(f).map((s, i) => (
            <SlideHtml
              key={s.id}
              largura={168}
              rotulo={`Slide ${i + 1} de exemplo`}
              no={
                montarSlide({
                  slide: s,
                  indice: i,
                  total: 4,
                  identidade: f,
                  estilo: f.estilo,
                  ...logosDaIdentidade(props.d, f),
                }).no
              }
            />
          ))}
        </div>
      </aside>
    </form>
  );
}

function Logos(props: { d: IdentidadeDaConta; usarMarca: boolean; aoUsarMarca: (v: boolean) => void }) {
  const cliente = useQueryClient();
  const enviar = useMutation({
    mutationFn: (p: { tipo: 'claro' | 'escuro'; arquivo: File }) =>
      enviarImagem(`/carrosseis/identidade/logo/${p.tipo}`, p.arquivo),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['carrosseis'] }),
  });
  const tirar = useMutation({
    mutationFn: (tipo: 'claro' | 'escuro') =>
      api(`/carrosseis/identidade/logo/${tipo}`, { metodo: 'DELETE' }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['carrosseis'] }),
  });
  const temDaMarca = props.d.logos.claro?.origem === 'marca' || props.d.logos.escuro?.origem === 'marca';
  return (
    <div className="identidade__logos">
      {(['claro', 'escuro'] as const).map((tipo) => {
        const l = props.d.logos[tipo];
        return (
          <div key={tipo} className="identidade__logo">
            <span className="identidade__logo-caixa" data-escuro={tipo === 'escuro' || undefined}>
              {l ? (
                <img
                  className="identidade__logo-img"
                  src={`/api/carrosseis/identidade/logo/${tipo}?v=${props.d.versao}`}
                  alt={`Logo para fundo ${tipo}`}
                />
              ) : (
                <span className="quieto">Sem logo</span>
              )}
            </span>
            <span className="identidade__logo-info">
              <b>Para fundo {tipo}</b>
              <span className="quieto">
                {l?.origem === 'propria'
                  ? 'Enviada aqui'
                  : l?.origem === 'marca'
                    ? 'De Marca e domínio'
                    : 'PNG ou SVG'}
              </span>
              <span className="acoes">
                <label className="pp-btn pp-btn--secondary pp-btn--sm">
                  <Icon name="upload" size={14} />
                  {l?.origem === 'propria' ? 'Trocar' : 'Enviar'}
                  <input
                    type="file"
                    className="pp-sr"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    onChange={(e) => {
                      const arquivo = e.target.files?.[0];
                      e.target.value = '';
                      if (arquivo) enviar.mutate({ tipo, arquivo });
                    }}
                  />
                </label>
                {l?.origem === 'propria' && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => tirar.mutate(tipo)}>
                    Tirar
                  </Button>
                )}
              </span>
            </span>
          </div>
        );
      })}
      {temDaMarca && (
        <label className="opcao">
          <input
            type="checkbox"
            checked={props.usarMarca}
            onChange={(e) => props.aoUsarMarca(e.target.checked)}
          />
          <span>Usar a logo de Marca e domínio quando não houver uma enviada aqui</span>
        </label>
      )}
      {enviar.isPending && <p className="quieto">Enviando a logo…</p>}
      {(enviar.error || tirar.error) && <ErroDaApi erro={enviar.error ?? tirar.error} />}
    </div>
  );
}

export function FotosDaEmpresa(props: { escolher?: (id: number) => void; escolhida?: number | null }) {
  const q = useFotos();
  const cliente = useQueryClient();
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState<{ feito: number; total: number } | null>(null);
  const [erro, setErro] = useState<unknown>(null);
  const apagar = useMutation({
    mutationFn: (id: number) => api(`/carrosseis/fotos/${id}`, { metodo: 'DELETE' }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['carrosseis'] }),
  });
  const enviar = async (arquivos: File[]) => {
    setErro(null);
    setEnviando({ feito: 0, total: arquivos.length });
    for (const [i, a] of arquivos.entries()) {
      try {
        await enviarImagem(`/carrosseis/fotos?nome=${encodeURIComponent(a.name.slice(0, 80))}`, a);
      } catch (e) {
        setErro(e);
        break;
      }
      setEnviando({ feito: i + 1, total: arquivos.length });
    }
    setEnviando(null);
    await cliente.invalidateQueries({ queryKey: ['carrosseis', 'fotos'] });
  };
  const fotos = q.data?.fotos ?? [];
  return (
    <section className="pp-panel identidade__bloco" aria-labelledby="id-fotos">
      <div className="identidade__titulo">
        <h2 id="id-fotos">Fotos da empresa</h2>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          icon="upload"
          onClick={() => entrada.current?.click()}
          disabled={!!enviando || (q.data ? fotos.length >= q.data.max : false)}
        >
          {enviando ? `Enviando ${enviando.feito + 1} de ${enviando.total}…` : 'Enviar fotos'}
        </Button>
        <input
          ref={entrada}
          type="file"
          multiple
          className="pp-sr"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => {
            const lista = [...(e.target.files ?? [])];
            e.target.value = '';
            if (lista.length) void enviar(lista);
          }}
        />
      </div>
      <p className="quieto">
        Produtos, loja, equipe, bastidores. Foto real costuma render mais que imagem genérica. A foto é
        reduzida e os dados do aparelho (como a localização) saem antes de guardar.
      </p>
      {!!erro && <ErroDaApi erro={erro} />}
      {apagar.error && <ErroDaApi erro={apagar.error} />}
      {q.isPending ? (
        <div className="esqueleto" style={{ height: 120 }} />
      ) : !fotos.length ? (
        <p className="quieto">Nenhuma foto ainda.</p>
      ) : (
        <ul className="fotos-empresa">
          {fotos.map((f) => (
            <li
              key={f.id}
              className="fotos-empresa__item"
              data-escolhida={props.escolhida === f.id || undefined}
            >
              {props.escolher ? (
                <button
                  type="button"
                  className="fotos-empresa__botao"
                  onClick={() => props.escolher!(f.id)}
                  aria-pressed={props.escolhida === f.id}
                  aria-label={`Usar a foto ${f.nome}`}
                >
                  <img className="fotos-empresa__img" src={urlFoto(f.id, 320)} alt="" loading="lazy" />
                </button>
              ) : (
                <img className="fotos-empresa__img" src={urlFoto(f.id, 320)} alt={f.nome} loading="lazy" />
              )}
              {!props.escolher && (
                <button
                  type="button"
                  className="botao-icone fotos-empresa__apagar"
                  aria-label={`Apagar a foto ${f.nome}`}
                  title="Apagar"
                  onClick={() => {
                    if (window.confirm(`Apagar a foto "${f.nome}"? Os slides que usam ficam sem foto.`))
                      apagar.mutate(f.id);
                  }}
                >
                  <Icon name="trash-2" size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
