import { type Achado, nomeDoFormato, ROTULO_INTERESSE } from '@prospeccao/shared/instagram';
import { Badge, Button, EmptyState, Icon } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, qs } from '../api';
import { Modal } from '../componentes/Drawer';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { useSessao, useSoLeitura } from '../componentes/Sessao';
import { fmtData, fmtNumero, fmtQuando, fmtReais } from '../formatar';
import { FormRegra } from './Instagram';

/**
 * Instagram › Conteúdo: o que cada publicação trouxe de alcance (números do Instagram) e de
 * negócio (leads, reuniões e vendas que só o CRM sabe), os achados do período e, num post, todos os
 * comentários, com os que demonstram interesse em destaque.
 */

interface PostLinha {
  midiaId: string;
  legenda: string | null;
  tipo: string | null;
  link: string | null;
  imagem: string | null;
  publicadoEm: string | null;
  alcance: number | null;
  visualizacoes: number | null;
  curtidas: number | null;
  comentarios: number | null;
  salvos: number | null;
  compartilhamentos: number | null;
  interacoes: number | null;
  leads: number;
  reunioes: number;
  vendas: number;
  valorVendas: number;
  interesse: number;
  regraId: number | null;
}

interface Conteudo {
  dias: number;
  atualizadoEm: string | null;
  estatisticasErro: string | null;
  formatos: Record<string, number>;
  total: {
    alcance: number | null;
    alcanceAntes: number | null;
    interacoes: number | null;
    leads: number;
    leadsComentario: number;
    leadsDirect: number;
    reunioes: number;
    vendas: number;
    valorVendas: number;
  };
  achados: Achado[];
  posts: PostLinha[];
}

const FORMATOS = ['REELS', 'CAROUSEL_ALBUM', 'IMAGE', 'VIDEO'] as const;
const CORES_CAPA = ['#0b6b63', '#7c3aed', '#b45309', '#1e40af', '#be123c', '#27272a'];

/** 12,1 mil (o alcance cabe na coluna). */
export function fmtMil(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n < 10_000) return fmtNumero(n);
  return `${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
}

const porMil = (p: { leads: number; alcance: number | null }) =>
  p.alcance ? (p.leads / p.alcance) * 1000 : null;

const tituloDoPost = (p: { legenda: string | null; tipo: string | null }) =>
  p.legenda?.split('\n')[0]?.trim().slice(0, 80) || `${nomeDoFormato(p.tipo)} sem legenda`;

function CapaPost(props: {
  p: { imagem: string | null; midiaId: string; tipo: string | null };
  tamanho?: number;
}) {
  const t = props.tamanho ?? 44;
  const cor = CORES_CAPA[[...props.p.midiaId].reduce((s, c) => s + c.charCodeAt(0), 0) % CORES_CAPA.length];
  return (
    <span className="ig-capa" style={{ width: t, height: t, background: cor }}>
      {props.p.imagem ? (
        <img src={props.p.imagem} alt="" loading="lazy" referrerPolicy="no-referrer" />
      ) : (
        <Icon
          name={props.p.tipo === 'REELS' || props.p.tipo === 'VIDEO' ? 'play' : 'image'}
          size={t > 60 ? 24 : 16}
        />
      )}
    </span>
  );
}

type Coluna =
  | 'alcance'
  | 'curtidas'
  | 'comentarios'
  | 'salvos'
  | 'compartilhamentos'
  | 'leads'
  | 'reunioes'
  | 'valorVendas'
  | 'porMil';

const COLUNAS: { id: Coluna; rotulo: string }[] = [
  { id: 'alcance', rotulo: 'Alcance' },
  { id: 'curtidas', rotulo: 'Curtidas' },
  { id: 'comentarios', rotulo: 'Coment.' },
  { id: 'salvos', rotulo: 'Salvos' },
  { id: 'compartilhamentos', rotulo: 'Compart.' },
  { id: 'leads', rotulo: 'Leads' },
  { id: 'reunioes', rotulo: 'Reuniões' },
  { id: 'valorVendas', rotulo: 'Vendas' },
  { id: 'porMil', rotulo: 'Leads / mil alc.' },
];

const valorDe = (p: PostLinha, c: Coluna) => (c === 'porMil' ? porMil(p) : p[c]);

export function AbaConteudo(props: { admin: boolean }) {
  const [dias, setDias] = useState(30);
  const [tipo, setTipo] = useState<string | null>(null);
  const [ordem, setOrdem] = useState<Coluna>('leads');
  const cliente = useQueryClient();
  const navegar = useNavigate();
  const q = useQuery({
    queryKey: ['instagram-conteudo', dias, tipo],
    queryFn: () => api<Conteudo>(`/instagram/conteudo${qs({ dias, tipo })}`),
  });
  const atualizar = useMutation({
    mutationFn: () => api('/instagram/conteudo/atualizar', { metodo: 'POST' }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['instagram-conteudo'] }),
  });
  const posts = useMemo(
    () =>
      [...(q.data?.posts ?? [])].sort(
        (a, b) => (valorDe(b, ordem) ?? -1) - (valorDe(a, ordem) ?? -1) || b.leads - a.leads,
      ),
    [q.data, ordem],
  );
  if (q.isPending) return <div className="esqueleto" style={{ height: 420 }} />;
  if (q.error || !q.data) return <ErroDaApi erro={q.error} />;
  const d = q.data;
  const t = d.total;
  const variacao =
    t.alcance != null && t.alcanceAntes
      ? Math.round(((t.alcance - t.alcanceAntes) / t.alcanceAntes) * 100)
      : null;
  const totalPosts = Object.values(d.formatos).reduce((s, n) => s + n, 0);
  const exportar = () => {
    const linhas = [
      [
        'Publicação',
        'Formato',
        'Data',
        'Alcance',
        'Curtidas',
        'Comentários',
        'Salvos',
        'Compartilhamentos',
        'Leads',
        'Reuniões',
        'Vendas (R$/mês)',
        'Link',
      ],
      ...posts.map((p) => [
        tituloDoPost(p),
        nomeDoFormato(p.tipo),
        p.publicadoEm?.slice(0, 10) ?? '',
        p.alcance ?? '',
        p.curtidas ?? '',
        p.comentarios ?? '',
        p.salvos ?? '',
        p.compartilhamentos ?? '',
        p.leads,
        p.reunioes,
        p.valorVendas,
        p.link ?? '',
      ]),
    ];
    const csv = linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    a.download = `instagram-conteudo-${dias}-dias.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  // O gráfico: as 8 publicações com mais alcance, cada medida na sua própria escala.
  const doGrafico = [...d.posts]
    .filter((p) => p.alcance != null)
    .sort((a, b) => (b.alcance ?? 0) - (a.alcance ?? 0))
    .slice(0, 8);
  const maxAlcance = Math.max(1, ...doGrafico.map((p) => p.alcance ?? 0));
  const maxLeads = Math.max(1, ...doGrafico.map((p) => p.leads));

  return (
    <div className="ig">
      <div className="ig__titulo">
        <div className="ig-filtros-conteudo">
          <label className="pp-sr" htmlFor="igc-periodo">
            Período
          </label>
          <select
            id="igc-periodo"
            className="filtro"
            value={dias}
            onChange={(e) => setDias(Number(e.target.value))}
          >
            <option value={7}>Últimos 7 dias</option>
            <option value={30}>Últimos 30 dias</option>
            <option value={90}>Últimos 90 dias</option>
            <option value={180}>Últimos 6 meses</option>
          </select>
          <div className="segmentos" role="tablist" aria-label="Formato">
            <button
              type="button"
              role="tab"
              aria-selected={!tipo}
              className="segmento"
              data-ativo={!tipo || undefined}
              onClick={() => setTipo(null)}
            >
              Tudo {totalPosts}
            </button>
            {FORMATOS.filter((f) => d.formatos[f]).map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={tipo === f}
                className="segmento"
                data-ativo={tipo === f || undefined}
                onClick={() => setTipo(f)}
              >
                {nomeDoFormato(f)} {d.formatos[f]}
              </button>
            ))}
          </div>
        </div>
        <div className="ig-filtros-conteudo">
          <span className="quieto ig-atualizado">
            {d.atualizadoEm ? `Números do Instagram de ${fmtQuando(d.atualizadoEm)}` : 'Ainda sem números'} ·
            podem levar até 48 h para fechar
          </span>
          {props.admin && (
            <Button
              size="sm"
              variant="ghost"
              icon={atualizar.isPending ? 'loader' : 'refresh-cw'}
              disabled={atualizar.isPending}
              onClick={() => atualizar.mutate()}
            >
              Atualizar
            </Button>
          )}
          <Button size="sm" variant="secondary" icon="file-down" disabled={!posts.length} onClick={exportar}>
            Exportar
          </Button>
        </div>
      </div>
      {d.estatisticasErro && <Mensagem tipo="aviso">{d.estatisticasErro}</Mensagem>}
      <ErroDaApi erro={atualizar.error} />
      <div className="ig-funil">
        <div>
          <small>Alcance</small>
          <b>{fmtMil(t.alcance)}</b>
          <span>
            {variacao != null ? (
              <span className={variacao >= 0 ? 'ig-funil__ok' : 'ig-funil__cai'}>
                {variacao >= 0 ? '↑' : '↓'} {Math.abs(variacao)}%
              </span>
            ) : null}
            {variacao != null
              ? ` vs. ${d.dias} dias antes`
              : 'pessoas diferentes que viram, somadas por post'}
          </span>
        </div>
        <div>
          <small>Interações</small>
          <b>{fmtNumero(t.interacoes)}</b>
          <span>curtidas, comentários, salvos e compartilhamentos</span>
        </div>
        <div>
          <small>Leads do Instagram</small>
          <b>{fmtNumero(t.leads)}</b>
          <span>
            {fmtNumero(t.leadsComentario)} de comentários · {fmtNumero(t.leadsDirect)} de direct
          </span>
        </div>
        <div>
          <small>Reuniões</small>
          <b>{fmtNumero(t.reunioes)}</b>
          <span>{t.leads ? `${Math.round((t.reunioes / t.leads) * 100)}% dos leads` : '—'}</span>
        </div>
        <div>
          <small>Vendas</small>
          <b>
            {t.vendas ? fmtReais(t.valorVendas) : '0'}
            {t.vendas ? <span className="ig-funil__mes">/mês</span> : null}
          </b>
          <span>
            {t.vendas
              ? `${t.vendas} ${t.vendas === 1 ? 'cliente que veio' : 'clientes que vieram'} do Instagram`
              : 'nenhuma venda ainda'}
          </span>
        </div>
      </div>
      {!!d.achados.length && (
        <div className="ig-achados">
          {d.achados.map((a) => (
            <section key={a.tipo} className="ig-achado" data-tipo={a.tipo}>
              <span className="ig-achado__tag">
                {a.tipo === 'formato'
                  ? 'O que mais vende'
                  : a.tipo === 'destaque'
                    ? 'Post do período'
                    : 'Atenção'}
              </span>
              <b>{a.titulo}</b>
              <p>{a.texto}</p>
              {a.midiaId && (
                <Link to={`/instagram/post/${a.midiaId}`} className="ig-achado__link">
                  Ver o post
                </Link>
              )}
            </section>
          ))}
        </div>
      )}
      {!d.posts.length ? (
        <EmptyState
          icone="image"
          titulo="Nenhuma publicação no período"
          texto="As publicações do perfil aparecem aqui com o alcance, as interações e os leads que trouxeram."
        />
      ) : (
        <>
          {doGrafico.length > 1 && (
            <section className="ig-grafico" aria-labelledby="ig-grafico-titulo">
              <h3 id="ig-grafico-titulo">Alcance e leads por publicação</h3>
              <p className="quieto">
                Cada medida na sua escala. Muito alcance e poucos leads chama atenção, mas não traz cliente.
              </p>
              <div className="ig-grafico__grade">
                <div className="ig-grafico__cab" aria-hidden="true">
                  <span>Publicação</span>
                  <span>Alcance</span>
                  <span>Leads</span>
                </div>
                {doGrafico.map((p) => (
                  <Link
                    key={p.midiaId}
                    to={`/instagram/post/${p.midiaId}`}
                    className="ig-grafico__linha"
                    title={`${tituloDoPost(p)} · ${fmtMil(p.alcance)} de alcance · ${p.leads} leads`}
                  >
                    <span className="ig-grafico__nome">
                      <span className="ig-grafico__titulo">{tituloDoPost(p)}</span>
                      <small>{nomeDoFormato(p.tipo)}</small>
                    </span>
                    <span className="ig-grafico__barra">
                      <i
                        className="ig-grafico__alcance"
                        style={{ width: `${((p.alcance ?? 0) / maxAlcance) * 100}%` }}
                      />
                      <em>{fmtMil(p.alcance)}</em>
                    </span>
                    <span className="ig-grafico__barra">
                      <i className="ig-grafico__leads" style={{ width: `${(p.leads / maxLeads) * 100}%` }} />
                      <em>{p.leads}</em>
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}
          <div className="pp-tablewrap">
            <table className="pp-table ig-tabela">
              <thead>
                <tr>
                  <th>Publicação</th>
                  {COLUNAS.map((c) => (
                    <th key={c.id} className="num" aria-sort={ordem === c.id ? 'descending' : undefined}>
                      <button
                        type="button"
                        className="ig-ordenar"
                        data-ativo={ordem === c.id || undefined}
                        onClick={() => setOrdem(c.id)}
                      >
                        {c.rotulo}
                        {ordem === c.id && <Icon name="arrow-down" size={11} />}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {posts.map((p) => {
                  const taxa = porMil(p);
                  const destaque = d.achados.find((a) => a.midiaId === p.midiaId && a.tipo === 'destaque');
                  return (
                    <tr
                      key={p.midiaId}
                      className="ig-tabela__linha"
                      onClick={() => navegar(`/instagram/post/${p.midiaId}`)}
                    >
                      <td>
                        <Link
                          className="ig-post"
                          to={`/instagram/post/${p.midiaId}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <CapaPost p={p} />
                          <span>
                            <b>
                              {tituloDoPost(p)}
                              {destaque && <span className="ig-selo">post do período</span>}
                            </b>
                            <small>
                              {nomeDoFormato(p.tipo)} · {fmtData(p.publicadoEm)}
                              {p.visualizacoes ? ` · ${fmtMil(p.visualizacoes)} views` : ''}
                              {p.interesse ? ` · ${p.interesse} com interesse` : ''}
                            </small>
                          </span>
                        </Link>
                      </td>
                      <td className="num">{fmtMil(p.alcance)}</td>
                      <td className="num">{fmtNumero(p.curtidas)}</td>
                      <td className="num">{fmtNumero(p.comentarios)}</td>
                      <td className="num">{fmtNumero(p.salvos)}</td>
                      <td className="num">{fmtNumero(p.compartilhamentos)}</td>
                      <td className="num">
                        <b>{p.leads}</b>
                      </td>
                      <td className="num">{p.reunioes}</td>
                      <td className="num">
                        {p.valorVendas ? <span className="ig-ok">{fmtReais(p.valorVendas)}</span> : '—'}
                      </td>
                      <td className="num">
                        {taxa == null ? (
                          '—'
                        ) : (
                          <span className={taxa === 0 && (p.alcance ?? 0) > 0 ? 'ig-zero' : undefined}>
                            {taxa.toLocaleString('pt-BR', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="quieto ig-nota">
        Leads, reuniões e vendas contam quem veio de um comentário ou de um direct daquele post (comente e
        receba, ou “Criar lead” num comentário). Cadastros de anúncio aparecem em Formulários. Stories ficam
        de fora: o Instagram só guarda os números deles por 24 horas.
      </p>
    </div>
  );
}

/* ───────────────────────── Um post aberto ───────────────────────── */

interface ComentarioPost {
  id: string;
  usuario: string | null;
  texto: string;
  comentadoEm: string;
  interesse: 'preco' | 'informacao' | 'contato' | null;
  respondidoEm: string | null;
  resposta: string | null;
  directEm: string | null;
  empresaId: number | null;
  etapa: string | null;
  etapaNome: string | null;
  etapaCor: string | null;
}

interface PostAberto {
  midiaId: string;
  legenda: string | null;
  tipo: string | null;
  link: string | null;
  imagem: string | null;
  publicadoEm: string | null;
  alcance: number | null;
  visualizacoes: number | null;
  curtidas: number | null;
  comentarios: number | null;
  salvos: number | null;
  compartilhamentos: number | null;
  visitasPerfil: number | null;
  seguiram: number | null;
  interacoes: number | null;
  numerosEm: string | null;
  regraId: number | null;
  funil: {
    leads: number;
    reunioes: number;
    vendas: number;
    valor: number;
    clientes: string[] | null;
    comentaram: number;
  };
  listaComentarios: ComentarioPost[];
}

type FiltroComentarios = 'interesse' | 'todos' | 'leads';

export function InstagramPost() {
  const { midiaId } = useParams();
  const sessao = useSessao();
  const admin = sessao.data?.papel === 'admin';
  const soLeitura = useSoLeitura();
  const cliente = useQueryClient();
  const navegar = useNavigate();
  const [filtro, setFiltro] = useState<FiltroComentarios | null>(null);
  const [acao, setAcao] = useState<{ tipo: 'responder' | 'direct'; c: ComentarioPost } | null>(null);
  const [novaRegra, setNovaRegra] = useState(false);
  const chave = ['instagram-post', midiaId];
  const q = useQuery({
    queryKey: chave,
    queryFn: () => api<PostAberto>(`/instagram/conteudo/${encodeURIComponent(midiaId ?? '')}`),
  });
  const criarLead = useMutation({
    mutationFn: (id: string) =>
      api<{ empresaId: number }>(`/instagram/comentarios/${id}/lead`, { metodo: 'POST' }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: chave }),
  });
  if (q.isPending) return <div className="esqueleto" style={{ height: 420 }} />;
  if (q.error || !q.data) return <ErroDaApi erro={q.error} />;
  const p = q.data;
  const f = p.funil;
  const comInteresse = p.listaComentarios.filter((c) => c.interesse && !c.empresaId);
  const viraramLead = p.listaComentarios.filter((c) => c.empresaId);
  const aba: FiltroComentarios = filtro ?? (comInteresse.length ? 'interesse' : 'todos');
  const lista = aba === 'interesse' ? comInteresse : aba === 'leads' ? viraramLead : p.listaComentarios;
  const interagiram = p.interacoes ?? null;
  const etapas = [
    { rotulo: 'Alcance', n: p.alcance },
    { rotulo: 'Interagiram', n: interagiram },
    { rotulo: 'Comentaram', n: p.comentarios ?? f.comentaram },
    { rotulo: 'Viraram lead', n: f.leads },
    { rotulo: 'Reunião', n: f.reunioes },
    { rotulo: 'Viraram cliente', n: f.vendas, ok: true },
  ];
  const topo = Math.max(1, ...etapas.map((e) => e.n ?? 0));
  const numeros: [string, number | null, boolean?][] = [
    ['Alcance', p.alcance, true],
    ['Visualizações', p.visualizacoes, true],
    ['Curtidas', p.curtidas],
    ['Comentários', p.comentarios],
    ['Salvos', p.salvos],
    ['Compartilh.', p.compartilhamentos],
    ['Visitas ao perfil', p.visitasPerfil],
    ['Seguiram', p.seguiram],
  ];
  return (
    <>
      <Link to="/instagram?aba=conteudo" className="voltar">
        <Icon name="arrow-right" size={14} className="girar-180" /> Conteúdo
      </Link>
      <div className="topo ig-pub">
        <div>
          <h1>{tituloDoPost(p)}</h1>
          <p className="ig-pub__sub">
            {nomeDoFormato(p.tipo)} · publicado em {fmtData(p.publicadoEm)}
            {' · '}
            {p.regraId ? (
              <Link to={`/instagram/regra/${p.regraId}`}>com regra de comente e receba</Link>
            ) : (
              'sem regra de comente e receba'
            )}
          </p>
        </div>
        <div className="topo__acoes">
          {p.link && (
            <a className="pp-btn" href={p.link} target="_blank" rel="noreferrer">
              <Icon name="external-link" size={16} /> Abrir no Instagram
            </a>
          )}
          {admin && !p.regraId && (
            <Button variant="primary" icon="plus" onClick={() => setNovaRegra(true)}>
              Criar regra neste post
            </Button>
          )}
        </div>
      </div>
      <div className="ig-post-det">
        <div className="ig-post-det__lado">
          <CapaPost p={p} tamanho={300} />
          <dl className="ig-numeros">
            {numeros
              .filter(([, n]) => n != null)
              .map(([rotulo, n, mil]) => (
                <div key={rotulo}>
                  <dt>{rotulo}</dt>
                  <dd>{mil ? fmtMil(n) : fmtNumero(n)}</dd>
                </div>
              ))}
            {p.alcance && p.salvos != null ? (
              <div>
                <dt>Salvos / alcance</dt>
                <dd>
                  {((p.salvos / p.alcance) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
                </dd>
              </div>
            ) : null}
          </dl>
          {!p.numerosEm && (
            <p className="quieto ig-nota">Os números do Instagram ainda não chegaram para este post.</p>
          )}
        </div>
        <div className="ig-post-det__meio">
          <section className="pp-panel ig-funilv">
            <h3>Do alcance à venda</h3>
            {etapas
              .filter((e) => e.n != null)
              .map((e) => (
                <div key={e.rotulo} className="ig-funilv__linha">
                  <span>{e.rotulo}</span>
                  <span className="ig-funilv__barra">
                    <i
                      data-ok={e.ok || undefined}
                      style={{ width: `${Math.max(e.n ? 1.5 : 0, ((e.n ?? 0) / topo) * 100)}%` }}
                    />
                  </span>
                  <b>{fmtMil(e.n)}</b>
                </div>
              ))}
            {!!f.vendas && (
              <p className="quieto ig-nota">
                {f.vendas} {f.vendas === 1 ? 'cliente' : 'clientes'} · {fmtReais(f.valor)}/mês
                {f.clientes?.length ? `: ${f.clientes.join(', ')}` : ''}.
              </p>
            )}
          </section>
          <section className="pp-panel ig-comentarios">
            <div className="pipelines" role="tablist" aria-label="Comentários">
              {(
                [
                  ['interesse', 'Com interesse', comInteresse.length],
                  ['todos', 'Todos', p.listaComentarios.length],
                  ['leads', 'Viraram lead', viraramLead.length],
                ] as const
              ).map(([id, rotulo, n]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={aba === id}
                  className="pipelines__aba"
                  onClick={() => setFiltro(id)}
                >
                  {rotulo}
                  <span className="pipelines__conta">{n}</span>
                </button>
              ))}
            </div>
            <ErroDaApi erro={criarLead.error} />
            {!lista.length ? (
              <p className="quieto ig-comentarios__vazio">
                {aba === 'interesse'
                  ? 'Ninguém perguntou preço, pediu informação ou contato neste post (ou já virou lead).'
                  : aba === 'leads'
                    ? 'Ninguém deste post virou lead ainda.'
                    : 'Nenhum comentário ainda.'}
              </p>
            ) : (
              <ul className="ig-comentarios__lista">
                {lista.map((c) => (
                  <li key={c.id} data-interesse={(c.interesse && !c.empresaId) || undefined}>
                    <div className="ig-comentario__texto">
                      <span>
                        <b>@{c.usuario ?? 'alguém'}</b> “{c.texto}”
                      </span>
                      <small>
                        {fmtQuando(c.comentadoEm)}
                        {c.interesse && ` · ${ROTULO_INTERESSE[c.interesse]}`}
                        {c.respondidoEm && ' · respondido'}
                        {c.directEm && ' · direct enviado'}
                        {c.empresaId && (
                          <>
                            {' · '}
                            <Badge tone="brand">lead{c.etapaNome ? ` · ${c.etapaNome}` : ''}</Badge>
                          </>
                        )}
                      </small>
                    </div>
                    <div className="ig-comentario__acoes">
                      {c.empresaId ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => navegar(`/conversas?lead=${c.empresaId}`)}
                        >
                          Abrir conversa
                        </Button>
                      ) : (
                        !soLeitura && (
                          <>
                            {!c.respondidoEm && (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => setAcao({ tipo: 'responder', c })}
                              >
                                Responder
                              </Button>
                            )}
                            {!c.directEm && (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => setAcao({ tipo: 'direct', c })}
                              >
                                Mandar direct
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="primary"
                              disabled={criarLead.isPending}
                              onClick={() => criarLead.mutate(c.id)}
                            >
                              Criar lead
                            </Button>
                          </>
                        )
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p className="quieto ig-nota">
            “Com interesse”: comentários que perguntam preço, pedem informação ou contato. “Mandar direct” usa
            a resposta privada do Instagram: uma por comentário, até 7 dias depois dele. Quem responder o
            direct vira lead sozinho.
          </p>
        </div>
      </div>
      {acao && (
        <AcaoComentario
          acao={acao}
          aoFechar={() => setAcao(null)}
          aoFeito={() => cliente.invalidateQueries({ queryKey: chave })}
        />
      )}
      {novaRegra && <FormRegra midiaInicial={p.midiaId} aoFechar={() => setNovaRegra(false)} />}
    </>
  );
}

function AcaoComentario(props: {
  acao: { tipo: 'responder' | 'direct'; c: ComentarioPost };
  aoFechar: () => void;
  aoFeito: () => void;
}) {
  const { tipo, c } = props.acao;
  const [texto, setTexto] = useState(
    tipo === 'direct'
      ? 'Oi! Vi seu comentário no nosso post. Posso te explicar melhor por aqui? Se preferir, me passa seu WhatsApp.'
      : 'Te chamei no direct! 📩',
  );
  const enviar = useMutation({
    mutationFn: () =>
      api(`/instagram/comentarios/${c.id}/${tipo === 'direct' ? 'direct' : 'responder'}`, {
        metodo: 'POST',
        corpo: { texto },
      }),
    onSuccess: () => {
      props.aoFeito();
      props.aoFechar();
    },
  });
  return (
    <Modal
      titulo={
        tipo === 'direct' ? `Direct para @${c.usuario ?? 'quem comentou'}` : `Responder @${c.usuario ?? ''}`
      }
      subtitulo={`“${c.texto.slice(0, 120)}”`}
      aoFechar={props.aoFechar}
      rodape={
        <>
          <ErroDaApi erro={enviar.error} />
          <Button variant="ghost" onClick={props.aoFechar}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            disabled={enviar.isPending || !texto.trim()}
            onClick={() => enviar.mutate()}
          >
            {enviar.isPending ? 'Enviando…' : tipo === 'direct' ? 'Mandar direct' : 'Responder em público'}
          </Button>
        </>
      }
    >
      <div className="campo">
        <label htmlFor="igc-texto">
          {tipo === 'direct' ? 'Mensagem no direct' : 'Resposta (aparece para todos)'}
        </label>
        <textarea
          id="igc-texto"
          className="filtro"
          rows={4}
          maxLength={1000}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
        <span className="campo__dica">
          {tipo === 'direct'
            ? 'O Instagram deixa mandar só um direct por comentário. Quando a pessoa responder, ela vira lead e a conversa aparece em Conversas.'
            : 'Fica embaixo do comentário, no post.'}
        </span>
      </div>
    </Modal>
  );
}
