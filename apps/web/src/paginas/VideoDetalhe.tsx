import {
  type CorteVideo,
  caixaNaTrilha,
  type DetalheVideo,
  ESTILOS_LEGENDA,
  type EstiloLegenda,
  ETAPAS_VIDEO,
  fmtDuracao,
  linhaDoAndamento,
  mapaDaPrevia,
  type PalavraVideo,
  quantoFalta,
  RITMOS,
  type RitmoCortes,
  ROTULO_CHAMADA,
  ROTULO_CORTE,
  ROTULO_SITUACAO_VIDEO,
  type TipoChamada,
  TRANSICOES,
  type TransicaoCortes,
  trechosQueFicam,
} from '@prospeccao/shared/videos';
import { Badge, Button, Icon } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { api } from '../api';
import { LinkAjuda } from '../componentes/Ajuda';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { useEhAdmin } from '../componentes/Sessao';
import { type DetalheComFila, useArquivo, useRevisao, useSituacaoVideos, useVideo } from '../video/dados';
import { AbaImagens, AbaSomCompleta, MomentosDaFala } from '../video/Enfeites';
import { AbaPublicacao, SeloPublicacao } from '../video/Publicacao';

/**
 * Um vídeo: enquanto a IA edita, as etapas; depois, a revisão (o vídeo pronto, o que foi cortado e
 * por quê, a legenda, o título e a chamada). As mudanças ficam salvas na hora e o vídeo muda ao
 * "Gerar de novo".
 */

export function VideoDetalhe() {
  const admin = useEhAdmin();
  const { id: bruto } = useParams();
  const id = Number(bruto);
  const q = useVideo(id);
  if (!admin) return <Navigate to="/" replace />;
  if (q.isPending) return <div className="esqueleto" style={{ height: 480 }} />;
  if (q.error) return <ErroDaApi erro={q.error} />;
  const v = q.data;
  const editando = v.situacao === 'na_fila' || v.situacao === 'editando' || v.situacao === 'enviando';
  return (
    <div className="video">
      <Topo v={v} />
      {editando ? (
        <Editando v={v} />
      ) : v.situacao === 'falhou' && !v.palavras.length ? (
        <Falhou v={v} />
      ) : (
        <Revisao v={v} />
      )}
    </div>
  );
}

function Topo({ v }: { v: DetalheComFila }) {
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const baixar = useMutation({
    mutationFn: () => api<{ url: string }>(`/videos/${v.id}/arquivo?tipo=final&baixar=sim`),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
  });
  const gerar = useMutation({
    mutationFn: () => api<DetalheVideo>(`/videos/${v.id}/gerar`, { metodo: 'POST' }),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['videos'] }),
  });
  const apagar = useMutation({
    mutationFn: () => api(`/videos/${v.id}`, { metodo: 'DELETE' }),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['videos'] });
      navegar('/videos');
    },
  });
  const pronto = v.situacao === 'pronto' || v.situacao === 'revisar';
  return (
    <>
      <div className="video__topo">
        <Link to="/videos" className="video__voltar">
          <Icon name="chevron-left" size={16} />
          Vídeos
        </Link>
        <h1 className="video__titulo">{v.titulo}</h1>
        <Badge
          tone={
            v.situacao === 'revisar'
              ? 'warning'
              : v.situacao === 'falhou'
                ? 'danger'
                : v.situacao === 'pronto'
                  ? 'brand'
                  : 'neutral'
          }
        >
          {v.situacao === 'revisar' && v.duvidas
            ? `${v.duvidas} ${v.duvidas === 1 ? 'corte' : 'cortes'} para você decidir`
            : ROTULO_SITUACAO_VIDEO[v.situacao]}
        </Badge>
        <SeloPublicacao videoId={v.id} ligado={pronto} />
        <span className="video__espaco" />
        <LinkAjuda artigo="videos">Como funciona</LinkAjuda>
        {pronto && (
          <Button
            size="sm"
            variant="secondary"
            icon="download"
            onClick={() => baixar.mutate()}
            disabled={baixar.isPending}
          >
            Baixar o vídeo
          </Button>
        )}
        {(pronto || (v.situacao === 'falhou' && v.palavras.length > 0)) && (
          <Button
            size="sm"
            variant={v.mudancasPendentes || v.situacao === 'falhou' ? 'primary' : 'secondary'}
            icon="refresh-cw"
            onClick={() => gerar.mutate()}
            disabled={gerar.isPending || (!v.mudancasPendentes && v.situacao !== 'falhou')}
            title={v.mudancasPendentes ? undefined : 'Mude algo na revisão para gerar de novo'}
          >
            {v.situacao === 'falhou' ? 'Tentar de novo' : 'Gerar de novo com as mudanças'}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          icon="trash-2"
          aria-label="Apagar o vídeo"
          onClick={() => {
            if (window.confirm(`Apagar o vídeo "${v.titulo}"? O original e o editado saem do sistema.`))
              apagar.mutate();
          }}
        />
      </div>
      <ErroDaApi erro={baixar.error ?? gerar.error ?? apagar.error} />
    </>
  );
}

/* ───────────────────────────── Editando ───────────────────────────── */

function Editando({ v }: { v: DetalheComFila }) {
  const atual = ETAPAS_VIDEO.findIndex((e) => e.id === v.etapa);
  const falta = v.situacao === 'editando' ? quantoFalta(v.andamento?.inicio, v.progresso) : null;
  return (
    <div className="video__editando-corpo">
      <PreviaDoMapa v={v} />
      <section className="video__editando" aria-label="Etapas da edição">
        <div className="video__editando-topo">
          <span className="video__editando-titulo">
            {v.situacao === 'na_fila' ? 'Na fila para editar' : 'A IA está editando o seu vídeo'}
          </span>
          <span className="quieto">
            {v.situacao === 'na_fila'
              ? v.naFrente
                ? `${v.naFrente} ${v.naFrente === 1 ? 'vídeo' : 'vídeos'} antes do seu`
                : 'Começa em instantes'
              : [
                  v.duracaoOriginal != null ? `${fmtDuracao(v.duracaoOriginal)} de vídeo` : '',
                  falta ? `faltam ${falta}` : `${v.progresso}%`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
          </span>
          <span className="video__progresso" aria-hidden="true">
            <span style={{ width: `${Math.max(3, v.progresso)}%` }} />
          </span>
        </div>
        <ol className="video__etapas">
          {ETAPAS_VIDEO.map((e, k) => {
            const feito = atual > k || v.progresso >= 100;
            const agora = atual === k;
            // O que a etapa achou de verdade (palavras, cortes, rosto, imagens), quando já passou.
            const achou = feito ? linhaDoAndamento(e.id, v.andamento) : null;
            return (
              <li
                key={e.id}
                className="video__etapa"
                data-agora={agora || undefined}
                data-feito={feito || undefined}
              >
                <Icon
                  name={feito ? 'check' : agora ? 'refresh-cw' : 'circle-dashed'}
                  size={18}
                  spin={agora}
                />
                <span>
                  <b>{e.nome}</b>
                  <span className="campo__dica">{achou ?? e.dica}</span>
                </span>
              </li>
            );
          })}
        </ol>
        <FalaOuvida v={v} />
        {v.erro && v.situacao === 'na_fila' && (
          <Mensagem tipo="aviso">Na tentativa anterior: {v.erro} Vamos tentar de novo.</Mensagem>
        )}
        <p className="quieto video__editando-pe">
          Pode fechar esta tela. Quando ficar pronto, chega um aviso no sino e o vídeo aparece em Vídeos.
        </p>
      </section>
    </div>
  );
}

/**
 * A prévia do mapa: os primeiros segundos do vídeo em pé tocando em loop, sem som (v138), com o
 * rosto, a faixa da legenda e o espaço dos gráficos acompanhando a pessoa. Antes do vídeo, o quadro
 * parado; antes do rosto, só a imagem.
 */
function PreviaDoMapa({ v }: { v: DetalheComFila }) {
  const quadro = useArquivo(v.id, 'previa', v.temPrevia, v.temPrevia ? 'sim' : 'nao');
  const filme = useArquivo(v.id, 'previa-video', v.temPreviaVideo, v.temPreviaVideo ? 'sim' : 'nao');
  const [t, setT] = useState(0);
  const tocador = useRef<HTMLVideoElement>(null);
  const trilha = v.andamento?.trilha;
  useEffect(() => {
    if (!filme.data?.url || !trilha?.length) return;
    let pedido = 0;
    const andar = () => {
      setT(tocador.current?.currentTime ?? 0);
      pedido = requestAnimationFrame(andar);
    };
    pedido = requestAnimationFrame(andar);
    return () => cancelAnimationFrame(pedido);
  }, [filme.data?.url, trilha?.length]);
  const rosto = v.andamento?.rosto;
  const caixa = filme.data?.url && trilha?.length ? caixaNaTrilha(trilha, t) : (rosto?.caixa ?? null);
  const mapa = rosto ? mapaDaPrevia(caixa) : null;
  const pos = (r: { x: number; y: number; w: number; h: number }) => ({
    left: `${r.x * 100}%`,
    top: `${r.y * 100}%`,
    width: `${r.w * 100}%`,
    height: `${r.h * 100}%`,
  });
  return (
    <figure className="video__previa">
      <div className="video__previa-quadro">
        {filme.data?.url ? (
          <video
            ref={tocador}
            src={filme.data.url}
            poster={quadro.data?.url}
            autoPlay
            muted
            loop
            playsInline
            aria-label="O começo do seu vídeo, já em pé"
          />
        ) : quadro.data?.url ? (
          <img src={quadro.data.url} alt="Um quadro do seu vídeo, já em pé" />
        ) : (
          <span className="video__previa-vazio">
            {v.situacao === 'na_fila' ? 'A prévia aparece quando a edição começar' : 'Preparando a prévia…'}
          </span>
        )}
        {mapa?.rosto && (
          <span className="video__previa-marca video__previa-marca--rosto" style={pos(mapa.rosto)}>
            <span>rosto</span>
          </span>
        )}
        {mapa?.graficos && (
          <span className="video__previa-marca video__previa-marca--graficos" style={pos(mapa.graficos)}>
            <span>espaço dos gráficos</span>
          </span>
        )}
        {mapa && (
          <span className="video__previa-marca video__previa-marca--legenda" style={pos(mapa.legenda)}>
            <span>faixa da legenda</span>
          </span>
        )}
      </div>
      <figcaption className="quieto">
        {mapa
          ? 'O mapa acompanha você: a legenda fica abaixo do queixo e os gráficos acima da cabeça.'
          : 'Quando a IA mapear o rosto, aparece aqui onde a legenda e os gráficos vão ficar.'}
      </figcaption>
    </figure>
  );
}

/** A fala que a IA ouviu (o começo), com o que ela cortou riscado e onde tirou fala embolada (v138). */
function FalaOuvida({ v }: { v: DetalheComFila }) {
  const f = v.andamento?.fala;
  if (!f?.palavras.length) return null;
  const cortadas = new Set(f.cortadas ?? []);
  const emboladas = new Set(f.emboladas ?? []);
  return (
    <section className="video__fala" aria-label="A fala que a IA ouviu">
      <span className="video__fala-titulo">{f.cortadas ? 'O que fica e o que sai' : 'Ouvindo…'}</span>
      <p className="video__fala-texto">
        {f.palavras.map((p, k) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a posição da palavra na fala é a identidade dela
          <span key={k}>
            {emboladas.has(k) && <span className="video__fala-embolada">fala embolada</span>}
            <span
              className={
                cortadas.has(k) ? 'video__fala-palavra video__fala-palavra--sai' : 'video__fala-palavra'
              }
              style={{ animationDelay: `${Math.min(k, 60) * 35}ms` }}
            >
              {p}
            </span>{' '}
          </span>
        ))}
        {v.andamento?.ouvindo && v.andamento.ouvindo.palavras > f.palavras.length && (
          <span className="quieto">…</span>
        )}
      </p>
    </section>
  );
}

function Falhou({ v }: { v: DetalheComFila }) {
  return (
    <section className="video__falhou">
      <Mensagem tipo="erro">{v.erro ?? 'A edição não deu certo.'}</Mensagem>
      <p className="quieto">Este vídeo não contou na franquia do mês.</p>
      <Button href="/videos" variant="secondary">
        Enviar outro vídeo
      </Button>
    </section>
  );
}

/* ───────────────────────────── Revisão ───────────────────────────── */

type Aba = 'cortes' | 'legenda' | 'imagens' | 'animacoes' | 'som' | 'publicacao';

function Revisao({ v }: { v: DetalheComFila }) {
  // O aviso de "o vídeo está no Instagram" abre direto na aba Publicação (?aba=publicacao).
  const [busca, setBusca] = useSearchParams();
  const [aba, setAbaLocal] = useState<Aba>(busca.get('aba') === 'publicacao' ? 'publicacao' : 'cortes');
  const setAba = (a: Aba) => {
    setAbaLocal(a);
    const n = new URLSearchParams(busca);
    if (a === 'publicacao') n.set('aba', 'publicacao');
    else n.delete('aba');
    setBusca(n, { replace: true });
  };
  const baixar = useMutation({
    mutationFn: () => api<{ url: string }>(`/videos/${v.id}/arquivo?tipo=final&baixar=sim`),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
  });
  const final = useArquivo(v.id, 'final', true, v.prontoEm ?? undefined);
  const original = useArquivo(v.id, 'original', true);
  const ouvinte = useRef<HTMLVideoElement>(null);
  const [ouvindo, setOuvindo] = useState<string | null>(null);
  const ouvir = (c: CorteVideo) => {
    const el = ouvinte.current;
    if (!el) return;
    const fim = c.fim + 1.0;
    el.currentTime = Math.max(0, c.inicio - 1.2);
    setOuvindo(c.id);
    const parar = () => {
      if (el.currentTime >= fim) {
        el.pause();
        el.removeEventListener('timeupdate', parar);
        setOuvindo(null);
      }
    };
    el.addEventListener('timeupdate', parar);
    void el.play().catch(() => setOuvindo(null));
  };
  const revisao = useRevisao(v.id);
  const situacao = useSituacaoVideos();
  const abas: { id: Aba; rotulo: string; aviso?: boolean }[] = [
    { id: 'cortes', rotulo: 'Cortes', aviso: v.duvidas > 0 },
    { id: 'legenda', rotulo: 'Legenda', aviso: v.palavras.some((p) => p.conferir) },
    {
      id: 'imagens',
      rotulo: 'Imagens',
      aviso: v.imagens.some((i) => i.usar && !i.pedido && i.conferencia?.startsWith('Não entrou')),
    },
    { id: 'animacoes', rotulo: 'Animações' },
    { id: 'som', rotulo: 'Som' },
    { id: 'publicacao', rotulo: 'Publicação' },
  ];
  return (
    <div className="video__corpo">
      <section className="video__palco" aria-label="Vídeo">
        {final.data ? (
          // biome-ignore lint/a11y/useMediaCaption: a legenda já vai dentro do vídeo (é o que a IA fez)
          <video className="video__player" src={final.data.url} controls playsInline preload="metadata" />
        ) : (
          <div className="video__player video__player--vazio">
            {final.error ? <ErroDaApi erro={final.error} /> : null}
          </div>
        )}
        {original.data && (
          // biome-ignore lint/a11y/useMediaCaption: só toca o áudio do trecho cortado para conferir
          <video ref={ouvinte} className="pp-sr" src={original.data.url} preload="auto" playsInline />
        )}
        <LinhaDoTempo v={v} />
        {v.conferencia && (
          <p className="campo__dica video__conferido">
            <Icon name="badge-check" size={14} />{' '}
            {v.conferencia.sobreposicoes === 0
              ? `Conferido quadro a quadro: nenhum texto encostou no rosto (${v.conferencia.quadros} quadros).`
              : `Em ${v.conferencia.sobreposicoes} de ${v.conferencia.quadros} quadros um texto chegou perto do rosto. Gere de novo ou fale com a gente.`}
          </p>
        )}
      </section>
      <aside className="video__painel" aria-label="Revisão">
        <div className="pipelines video__abas" role="tablist" aria-label="Revisão">
          {abas.map((a) => (
            <button
              key={a.id}
              type="button"
              role="tab"
              className="pipelines__aba"
              aria-selected={aba === a.id}
              onClick={() => setAba(a.id)}
            >
              {a.rotulo}
              {a.aviso && (
                <>
                  <span className="video__ponto" aria-hidden="true" />
                  <span className="pp-sr">tem o que conferir</span>
                </>
              )}
            </button>
          ))}
        </div>
        <div className="video__conteudo">
          <ErroDaApi erro={revisao.error} />
          {v.mudancasPendentes && (
            <Mensagem tipo="aviso">
              As mudanças estão salvas. Clique em "Gerar de novo com as mudanças" para o vídeo mudar.
            </Mensagem>
          )}
          {aba === 'cortes' && (
            <AbaCortes v={v} ouvir={ouvir} ouvindo={ouvindo} podeOuvir={!!original.data} />
          )}
          {aba === 'legenda' && <AbaLegenda v={v} />}
          {aba === 'imagens' && <AbaImagens v={v} situacao={situacao.data} />}
          {aba === 'animacoes' && <AbaAnimacoes v={v} />}
          {aba === 'som' && <AbaSomCompleta v={v} situacao={situacao.data} />}
          {aba === 'publicacao' && <AbaPublicacao v={v} aoBaixar={() => baixar.mutate()} />}
          {aba === 'publicacao' && <ErroDaApi erro={baixar.error} />}
        </div>
      </aside>
    </div>
  );
}

function LinhaDoTempo({ v }: { v: DetalheVideo }) {
  const total = v.duracaoOriginal ?? Math.max(1, ...v.cortes.map((c) => c.fim));
  const ficam = trechosQueFicam(total, v.cortes);
  const pedacos: { ini: number; fim: number; tipo: 'ficou' | 'saiu' | 'duvida' }[] = [];
  let t = 0;
  for (const f of ficam) {
    if (f.inicio > t) pedacos.push({ ini: t, fim: f.inicio, tipo: 'saiu' });
    pedacos.push({ ini: f.inicio, fim: f.fim, tipo: 'ficou' });
    t = f.fim;
  }
  if (t < total) pedacos.push({ ini: t, fim: total, tipo: 'saiu' });
  for (const p of pedacos)
    if (
      p.tipo === 'saiu' &&
      v.cortes.some(
        (c) => c.duvida && !c.conferido && c.decisao === 'cortar' && c.inicio < p.fim && c.fim > p.ini,
      )
    )
      p.tipo = 'duvida';
  const saiu = total - ficam.reduce((s, f) => s + (f.fim - f.inicio), 0);
  return (
    <div className="video__tempo">
      <div className="video__tempo-numeros mono">
        <span>0:00</span>
        <span>
          original {fmtDuracao(total)} → editado {fmtDuracao(total - saiu)}
        </span>
        <span>{fmtDuracao(total)}</span>
      </div>
      <div
        className="video__tempo-barra"
        role="img"
        aria-label={`Linha do tempo: saíram ${Math.round(saiu)} segundos`}
      >
        {pedacos.map((p) => (
          <span key={`${p.ini}`} data-tipo={p.tipo} style={{ flexGrow: Math.max(0.001, p.fim - p.ini) }} />
        ))}
      </div>
      <div className="video__tempo-legenda">
        <span>
          <i data-tipo="ficou" />
          ficou
        </span>
        <span>
          <i data-tipo="saiu" />
          saiu
        </span>
        <span>
          <i data-tipo="duvida" />
          saiu, mas a IA ficou em dúvida
        </span>
      </div>
    </div>
  );
}

/* ── Cortes ── */

const seg = (n: number) => `${n.toFixed(1).replace('.', ',')} s`;

function AbaCortes(props: {
  v: DetalheVideo;
  ouvir: (c: CorteVideo) => void;
  ouvindo: string | null;
  podeOuvir: boolean;
}) {
  const { v } = props;
  const revisao = useRevisao(v.id);
  const [verPausas, setVerPausas] = useState(false);
  // v142: "Ajustar" leva às palavras do corte no Texto do vídeo, já escolhidas.
  const [ajustar, setAjustar] = useState<{ a: number; b: number; vez: number } | null>(null);
  const palavrasDoCorte = (c: CorteVideo) => {
    const dentro = v.palavras
      .map((p, i) => ({ m: (p.i + p.f) / 2, i }))
      .filter((x) => x.m >= c.inicio && x.m <= c.fim)
      .map((x) => x.i);
    return dentro.length ? { a: dentro[0]!, b: dentro[dentro.length - 1]! } : null;
  };
  const botaoAjustar = (c: CorteVideo, link = false) => {
    const faixa = palavrasDoCorte(c);
    if (!faixa) return null;
    const ir = () => setAjustar({ ...faixa, vez: Date.now() });
    return link ? (
      <button type="button" className="link-botao" onClick={ir}>
        Ajustar
      </button>
    ) : (
      <Button size="sm" variant="secondary" icon="scissors" onClick={ir}>
        Ajustar
      </Button>
    );
  };
  const decidir = (c: CorteVideo, decisao: CorteVideo['decisao']) =>
    revisao.mutate({ cortes: [{ id: c.id, decisao, conferido: true }] });
  const duvidas = v.cortes.filter((c) => c.duvida && !c.conferido && c.decisao === 'cortar');
  const outros = v.cortes.filter((c) => c.tipo !== 'pausa' && !duvidas.includes(c));
  const pausas = v.cortes.filter((c) => c.tipo === 'pausa');
  const tirado = v.cortes.filter((c) => c.decisao === 'cortar').reduce((s, c) => s + (c.fim - c.inicio), 0);
  const botaoOuvir = (c: CorteVideo) =>
    props.podeOuvir && (
      <Button
        size="sm"
        variant="secondary"
        icon={props.ouvindo === c.id ? 'volume-2' : 'play'}
        onClick={() => props.ouvir(c)}
      >
        Ouvir
      </Button>
    );
  return (
    <div className="video__cortes">
      <p className="quieto">
        A IA tirou {seg(tirado)}. "Ouvir" toca o trecho com um pouco antes e depois; "Devolver" põe de volta
        no vídeo.
      </p>
      {duvidas.map((c) => (
        <div key={c.id} className="video__duvida">
          <span className="video__corte-cabeca">
            <b>
              {fmtDuracao(c.inicio)} a {fmtDuracao(c.fim)} · {ROTULO_CORTE[c.tipo].toLowerCase()}
            </b>
            <span className="mono quieto">{seg(c.fim - c.inicio)}</span>
          </span>
          {c.trecho && <span className="video__trecho">"{c.trecho}"</span>}
          <span className="video__motivo">{c.motivo}</span>
          <span className="acoes">
            {botaoOuvir(c)}
            {botaoAjustar(c)}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => decidir(c, 'devolver')}
              disabled={revisao.isPending}
            >
              Devolver
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => decidir(c, 'cortar')}
              disabled={revisao.isPending}
            >
              Está certo
            </Button>
          </span>
        </div>
      ))}
      {outros.length > 0 && (
        <>
          <span className="video__secao">Outros cortes</span>
          <ul className="video__lista">
            {outros.map((c) => (
              <li key={c.id} data-devolvido={c.decisao === 'devolver' || undefined}>
                <span className="mono quieto video__quando">{fmtDuracao(c.inicio)}</span>
                <span className="video__lista-texto">
                  {c.trecho ? `"${c.trecho}"` : ROTULO_CORTE[c.tipo]}
                  <span className="campo__dica">
                    {c.decisao === 'devolver' ? 'Devolvido: fica no vídeo' : c.motivo} ·{' '}
                    {seg(c.fim - c.inicio)}
                  </span>
                </span>
                {props.podeOuvir && (
                  <button type="button" className="link-botao" onClick={() => props.ouvir(c)}>
                    Ouvir
                  </button>
                )}
                {botaoAjustar(c, true)}
                <button
                  type="button"
                  className="link-botao"
                  onClick={() => decidir(c, c.decisao === 'cortar' ? 'devolver' : 'cortar')}
                  disabled={revisao.isPending}
                >
                  {c.decisao === 'cortar' ? 'Devolver' : 'Cortar de novo'}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {pausas.length > 0 && (
        <ul className="video__lista">
          <li>
            <span className="quieto video__quando" aria-hidden="true">
              <Icon name="pause" size={14} />
            </span>
            <span className="video__lista-texto">
              {pausas.length} {pausas.length === 1 ? 'pausa encurtada' : 'pausas encurtadas'} (
              {seg(pausas.filter((p) => p.decisao === 'cortar').reduce((s, p) => s + p.fim - p.inicio, 0))} no
              total)
            </span>
            <button
              type="button"
              className="link-botao"
              onClick={() => setVerPausas((x) => !x)}
              aria-expanded={verPausas}
            >
              {verPausas ? 'Esconder' : 'Ver'}
            </button>
          </li>
          {verPausas &&
            pausas.map((c) => (
              <li key={c.id} data-devolvido={c.decisao === 'devolver' || undefined}>
                <span className="mono quieto video__quando">{fmtDuracao(c.inicio)}</span>
                <span className="video__lista-texto">
                  {c.decisao === 'devolver' ? 'Pausa devolvida' : c.motivo}
                </span>
                <button
                  type="button"
                  className="link-botao"
                  onClick={() => decidir(c, c.decisao === 'cortar' ? 'devolver' : 'cortar')}
                  disabled={revisao.isPending}
                >
                  {c.decisao === 'cortar' ? 'Devolver' : 'Encurtar de novo'}
                </button>
              </li>
            ))}
        </ul>
      )}
      <TextoDoVideo
        v={v}
        ouvir={props.ouvir}
        ouvindo={props.ouvindo}
        podeOuvir={props.podeOuvir}
        ajustar={ajustar}
      />
      <Seletor
        rotulo="Ritmo dos cortes"
        valor={v.opcoes.ritmo}
        opcoes={RITMOS.map((r) => ({ id: r.id, nome: r.nome }))}
        aoMudar={(ritmo) => revisao.mutate({ ritmo: ritmo as RitmoCortes })}
        dica={`${RITMOS.find((r) => r.id === v.opcoes.ritmo)?.dica}. Muda só as pausas; os cortes de palavras continuam como estão.`}
      />
    </div>
  );
}

/**
 * v142: o texto do vídeo palavra por palavra. Riscado sai do vídeo. Clique numa palavra e depois
 * em outra (ou arraste) para escolher um trecho e cortar ou devolver só ele.
 */
function TextoDoVideo(props: {
  v: DetalheVideo;
  ouvir: (c: CorteVideo) => void;
  ouvindo: string | null;
  podeOuvir: boolean;
  ajustar: { a: number; b: number; vez: number } | null;
}) {
  const { v } = props;
  const revisao = useRevisao(v.id);
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);
  const arrastando = useRef(false);
  const caixa = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!props.ajustar) return;
    setSel({ a: props.ajustar.a, b: props.ajustar.b });
    caixa.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [props.ajustar]);
  useEffect(() => {
    const solta = () => {
      arrastando.current = false;
    };
    window.addEventListener('pointerup', solta);
    return () => window.removeEventListener('pointerup', solta);
  }, []);
  const palavras = v.palavras;
  const total = v.duracaoOriginal ?? Math.max(1, ...v.cortes.map((c) => c.fim), ...palavras.map((p) => p.f));
  const ficam = useMemo(() => trechosQueFicam(total, v.cortes), [total, v.cortes]);
  const sai = (p: PalavraVideo) => {
    const m = (p.i + p.f) / 2;
    return !ficam.some((t) => m >= t.inicio && m <= t.fim);
  };
  if (!palavras.length) return null;
  const ini = sel ? Math.min(sel.a, sel.b) : -1;
  const fim = sel ? Math.max(sel.a, sel.b) : -1;
  const escolhidas = sel ? palavras.slice(ini, fim + 1) : [];
  const cortadas = escolhidas.filter(sai).length;
  const anterior = palavras[ini - 1];
  const seguinte = palavras[fim + 1];
  const primeira = palavras[ini];
  const ultima = palavras[fim];
  // Cortar leva um respiro em volta (até a palavra vizinha); devolver guarda a palavra inteira.
  const trecho = (folga: number) =>
    primeira && ultima
      ? {
          inicio: Math.max(anterior ? anterior.f : 0, primeira.i - folga),
          fim: Math.min(seguinte ? seguinte.i : total, ultima.f + folga),
        }
      : null;
  const aplicar = (acao: 'cortar' | 'devolver') => {
    const t = trecho(acao === 'cortar' ? 0.12 : 0.06);
    if (!t) return;
    revisao.mutate({ trechos: [{ acao, ...t }] }, { onSuccess: () => setSel(null) });
  };
  const tocar = (i: number) => {
    if (sel && sel.a === sel.b && i !== sel.a) setSel({ a: sel.a, b: i });
    else if (sel && sel.a === sel.b && i === sel.a) setSel(null);
    else setSel({ a: i, b: i });
  };
  const ouvirTrecho = () => {
    const t = trecho(0.06);
    if (t)
      props.ouvir({
        id: 'trecho-escolhido',
        ...t,
        tipo: 'manual',
        motivo: '',
        trecho: '',
        duvida: false,
        decisao: 'cortar',
        conferido: true,
      });
  };
  return (
    <section className="video__texto" aria-label="Texto do vídeo" ref={caixa}>
      <span className="video__secao">Texto do vídeo · ajuste os cortes aqui</span>
      <p className="video__texto-dica">
        <Icon name="scissors" size={14} /> Riscado sai do vídeo. <b>Clique numa palavra</b> e depois em outra
        (ou arraste) para escolher o trecho; aparecem Cortar e Devolver.
      </p>
      <div className="video__texto-palavras">
        {palavras.map((p, i) => (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: a posição é a identidade da palavra
            key={i}
            type="button"
            className="video__palavra"
            data-sai={sai(p) || undefined}
            data-sel={(i >= ini && i <= fim) || undefined}
            onPointerDown={(e) => {
              e.preventDefault();
              arrastando.current = true;
              tocar(i);
            }}
            onPointerEnter={() => {
              if (arrastando.current) setSel((s) => (s ? { a: s.a, b: i } : s));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                tocar(i);
              }
            }}
          >
            {p.t}
          </button>
        ))}
      </div>
      <div className="video__texto-barra" aria-live="polite">
        <span className="quieto">
          {sel
            ? `${escolhidas.length} ${escolhidas.length === 1 ? 'palavra' : 'palavras'}: "${escolhidas.map((p) => p.t).join(' ')}"`
            : 'Clique numa palavra para começar.'}
        </span>
        {sel && (
          <span className="video__texto-acoes">
            {props.podeOuvir && (
              <Button
                size="sm"
                variant="secondary"
                icon={props.ouvindo === 'trecho-escolhido' ? 'volume-2' : 'play'}
                onClick={ouvirTrecho}
              >
                Ouvir
              </Button>
            )}
            {cortadas < escolhidas.length && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => aplicar('cortar')}
                disabled={revisao.isPending}
              >
                Cortar
              </Button>
            )}
            {cortadas > 0 && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => aplicar('devolver')}
                disabled={revisao.isPending}
              >
                Devolver
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setSel(null)}>
              Limpar
            </Button>
          </span>
        )}
      </div>
      <ErroDaApi erro={revisao.error} />
    </section>
  );
}

function Seletor(props: {
  rotulo: string;
  valor: string;
  opcoes: { id: string; nome: string }[];
  aoMudar: (v: string) => void;
  dica?: string;
}) {
  const id = useId();
  return (
    <div className="campo">
      <label htmlFor={id}>{props.rotulo}</label>
      <select id={id} className="filtro" value={props.valor} onChange={(e) => props.aoMudar(e.target.value)}>
        {props.opcoes.map((o) => (
          <option key={o.id} value={o.id}>
            {o.nome}
          </option>
        ))}
      </select>
      {props.dica && <span className="campo__dica">{props.dica}</span>}
    </div>
  );
}

/* ── Legenda ── */

interface Linha {
  inicio: number;
  indices: number[];
}

/** A fala em frases curtas (até 7 palavras), só com o que ficou no vídeo. */
function linhasDaFala(v: DetalheVideo): Linha[] {
  const total = v.duracaoOriginal ?? 0;
  const ficam = trechosQueFicam(total, v.cortes);
  const ficou = (p: PalavraVideo) =>
    ficam.some((f) => Math.min(f.fim, Math.max(p.f, p.i + 0.08)) - Math.max(f.inicio, p.i) >= 0.04);
  const linhas: Linha[] = [];
  let atual: number[] = [];
  v.palavras.forEach((p, k) => {
    if (!ficou(p)) return;
    atual.push(k);
    if (atual.length >= 7 || /[.!?…]$/.test(p.t)) {
      linhas.push({ inicio: v.palavras[atual[0]!]!.i, indices: atual });
      atual = [];
    }
  });
  if (atual.length) linhas.push({ inicio: v.palavras[atual[0]!]!.i, indices: atual });
  return linhas;
}

function AbaLegenda({ v }: { v: DetalheVideo }) {
  const revisao = useRevisao(v.id);
  const linhas = useMemo(() => linhasDaFala(v), [v]);
  return (
    <div className="video__legenda">
      <p className="quieto">
        Corrija uma palavra que a IA ouviu errado. Troque palavra por palavra: o tempo de cada uma fica.
      </p>
      <ul className="video__frases">
        {linhas.map((l) => (
          <FraseEditavel
            key={l.indices[0]}
            v={v}
            linha={l}
            aoSalvar={(palavras) => revisao.mutate({ palavras })}
          />
        ))}
      </ul>
      <Seletor
        rotulo="Estilo"
        valor={v.opcoes.estilo}
        opcoes={ESTILOS_LEGENDA.map((e) => ({ id: e.id, nome: e.nome }))}
        aoMudar={(estilo) => revisao.mutate({ estilo: estilo as EstiloLegenda })}
        dica={`${ESTILOS_LEGENDA.find((e) => e.id === v.opcoes.estilo)?.dica}.`}
      />
      <Vocabulario />
    </div>
  );
}

function FraseEditavel(props: {
  v: DetalheVideo;
  linha: Linha;
  aoSalvar: (palavras: { indice: number; texto: string }[]) => void;
}) {
  const { v, linha } = props;
  const original = linha.indices.map((k) => v.palavras[k]!.t).join(' ');
  const [texto, setTexto] = useState(original);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => setTexto(original), [original]);
  const conferir = linha.indices.filter((k) => v.palavras[k]!.conferir).map((k) => v.palavras[k]!.t);
  const id = useId();
  const salvar = () => {
    setErro(null);
    if (texto.trim() === original) return;
    const novas = texto.trim().split(/\s+/);
    if (novas.length !== linha.indices.length) {
      setErro(`Mantenha ${linha.indices.length} palavras (troque uma por uma).`);
      return;
    }
    props.aoSalvar(
      linha.indices.flatMap((k, n) =>
        v.palavras[k]!.t === novas[n] ? [] : [{ indice: k, texto: novas[n]!.slice(0, 40) }],
      ),
    );
  };
  return (
    <li className="video__frase">
      <label htmlFor={id} className="mono quieto video__quando">
        {fmtDuracao(linha.inicio)}
      </label>
      <span className="video__frase-campo">
        <input
          id={id}
          className="filtro"
          value={texto}
          data-conferir={conferir.length ? true : undefined}
          onChange={(e) => setTexto(e.target.value)}
          onBlur={salvar}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
        {conferir.length > 0 && !erro && (
          <span className="campo__dica video__conferir">Confira: {conferir.join(', ')}</span>
        )}
        {erro && <span className="campo__dica video__erro">{erro}</span>}
      </span>
    </li>
  );
}

function Vocabulario() {
  const id = useId();
  const cliente = useQueryClient();
  const q = useQuery({
    queryKey: ['videos', 'vocabulario'],
    queryFn: () => api<{ palavras: string[] }>('/videos/preferencias/vocabulario'),
  });
  const [texto, setTexto] = useState<string | null>(null);
  const salvar = useMutation({
    mutationFn: (palavras: string[]) =>
      api<{ palavras: string[] }>('/videos/preferencias/vocabulario', { metodo: 'PUT', corpo: { palavras } }),
    onSuccess: (d) => {
      cliente.setQueryData(['videos', 'vocabulario'], d);
      setTexto(null);
    },
  });
  const valor = texto ?? (q.data?.palavras ?? []).join(', ');
  return (
    <div className="campo">
      <label htmlFor={id}>Palavras sempre escritas assim</label>
      <input
        id={id}
        className="filtro"
        value={valor}
        placeholder="Ex.: Horizonte, 5W30, Bosch"
        onChange={(e) => setTexto(e.target.value)}
        onBlur={() => {
          if (texto == null) return;
          salvar.mutate(
            texto
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
              .slice(0, 60),
          );
        }}
      />
      <span className="campo__dica">
        Separe por vírgula. Vale para os próximos vídeos da empresa (marca, produtos, siglas).
      </span>
      <ErroDaApi erro={salvar.error} />
    </div>
  );
}

/* ── Animações ── */

function AbaAnimacoes({ v }: { v: DetalheVideo }) {
  const revisao = useRevisao(v.id);
  const a = v.animacoes;
  const [titulo, setTitulo] = useState(a?.titulo.texto ?? '');
  const [palavra, setPalavra] = useState(a?.chamada.palavra ?? '');
  const [frase, setFrase] = useState(a?.chamada.texto ?? '');
  const idT = useId();
  if (!a) return <p className="quieto">Este vídeo não tem animações para mudar.</p>;
  const chamada = (m: Partial<typeof a.chamada>) => revisao.mutate({ chamada: { ...a.chamada, ...m } });
  return (
    <div className="video__animacoes">
      <p className="quieto">A IA escolheu pelo que você fala. Tire a que não quiser ou troque o texto.</p>
      <div className="video__animacao">
        <span className="video__corte-cabeca">
          <b>Título de abertura</b>
          <label className="video__usar">
            <input
              type="checkbox"
              checked={a.titulo.usar}
              onChange={(e) => revisao.mutate({ titulo: { usar: e.target.checked, texto: titulo } })}
            />
            Usar
          </label>
        </span>
        <span className="campo__dica">
          Nos primeiros segundos. Quando não cabe acima da cabeça, o vídeo vira um cartão para dar espaço.
        </span>
        <label htmlFor={idT} className="pp-sr">
          Texto do título
        </label>
        <input
          id={idT}
          className="filtro"
          value={titulo}
          maxLength={60}
          onChange={(e) => setTitulo(e.target.value.toUpperCase())}
          onBlur={() =>
            titulo !== a.titulo.texto &&
            revisao.mutate({ titulo: { usar: a.titulo.usar || !!titulo, texto: titulo } })
          }
        />
      </div>
      <div className="video__animacao">
        <span className="video__corte-cabeca">
          <b>Chamada no fim</b>
          <label className="video__usar">
            <input
              type="checkbox"
              checked={a.chamada.usar}
              onChange={(e) => chamada({ usar: e.target.checked })}
            />
            Usar
          </label>
        </span>
        <Seletor
          rotulo="Tipo"
          valor={a.chamada.tipo}
          opcoes={(Object.keys(ROTULO_CHAMADA) as TipoChamada[]).map((t) => ({
            id: t,
            nome: ROTULO_CHAMADA[t],
          }))}
          aoMudar={(tipo) => chamada({ tipo: tipo as TipoChamada, usar: tipo !== 'nenhuma' })}
        />
        {a.chamada.tipo === 'comente' && (
          <div className="campo">
            <label htmlFor={`${idT}-p`}>Palavra</label>
            <input
              id={`${idT}-p`}
              className="filtro mono"
              value={palavra}
              maxLength={30}
              onChange={(e) => setPalavra(e.target.value.replace(/\s+/g, '').toUpperCase())}
              onBlur={() => palavra !== a.chamada.palavra && chamada({ palavra })}
            />
          </div>
        )}
        {a.chamada.tipo !== 'nenhuma' && (
          <div className="campo">
            <label htmlFor={`${idT}-f`}>Frase da tela final</label>
            <input
              id={`${idT}-f`}
              className="filtro"
              value={frase}
              maxLength={80}
              onChange={(e) => setFrase(e.target.value)}
              onBlur={() => frase !== a.chamada.texto && chamada({ texto: frase })}
            />
          </div>
        )}
      </div>
      <MomentosDaFala v={v} />
      <Seletor
        rotulo="Transição entre os cortes"
        valor={v.opcoes.transicao}
        opcoes={TRANSICOES.map((t) => ({ id: t.id, nome: t.nome }))}
        aoMudar={(transicao) => revisao.mutate({ transicao: transicao as TransicaoCortes })}
        dica={`${TRANSICOES.find((t) => t.id === v.opcoes.transicao)?.dica}.`}
      />
    </div>
  );
}
