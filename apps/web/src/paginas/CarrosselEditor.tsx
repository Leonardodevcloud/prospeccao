import {
  ACABAMENTOS_CAMADAS,
  alturaDoFormato,
  avisosDoCarrossel,
  type Carrossel,
  type CarrosselEntrada,
  COMPOSICOES_CAMADAS,
  ESTILO,
  ESTILOS,
  type EstiloCarrossel,
  FORMAS_CAMADAS,
  FORMATO_PECA,
  type FormatoPeca,
  FUNDOS_SLIDE,
  type IdentidadeCarrossel,
  MAX_SLIDES,
  MODELO,
  MODELOS_A_MAO,
  type ModeloSlide,
  montarSlide,
  ROTULO_ACABAMENTO,
  ROTULO_COMPOSICAO,
  ROTULO_FORMA,
  ROTULO_FUNDO,
  type SlideCarrossel,
  slideNovo,
} from '@prospeccao/shared/carrosseis';
import { type AvisoTime, aplicarSugestao, type RelatorioTime } from '@prospeccao/shared/carrosseis-time';
import { Button, Icon } from '@prospeccao/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router';
import { api, ErroApi } from '../api';
import { VerNoCelular } from '../carrossel/Celular';
import { ConversaComOTime, PedirAoTime, useConversaComOTime } from '../carrossel/Conversa';
import {
  type IdentidadeDaConta,
  logosDaIdentidade,
  urlFoto,
  useCarrossel,
  useFotos,
  useIdentidade,
  useSituacaoCarrosseis,
} from '../carrossel/dados';
import { CenariosDoProduto } from '../carrossel/Imagens';
import { PainelPublicacao, usePublicacao } from '../carrossel/Publicacao';
import { SlideHtml } from '../carrossel/SlideHtml';
import { AvisosDoRevisor, PainelTime } from '../carrossel/Time';
import { LinkAjuda } from '../componentes/Ajuda';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { useEhAdmin } from '../componentes/Sessao';
import { FotosDaEmpresa } from './Carrosseis';

/**
 * Editor de um carrossel: os slides à esquerda, a imagem final no meio (desenhada pelo servidor, a
 * mesma que vai para o Instagram) e a edição do slide à direita. Salva sozinho enquanto a pessoa
 * edita; a miniatura da lateral e a prévia que aparece enquanto digita são desenhadas no navegador.
 */

type Rascunho = Pick<CarrosselEntrada, 'titulo' | 'estilo' | 'slides' | 'legenda' | 'situacao'>;
type Aba = 'slide' | 'legenda' | 'carrossel' | 'time' | 'conversa' | 'publicacao';

const idNovo = () => `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

export function CarrosselEditor() {
  const admin = useEhAdmin();
  const id = Number(useParams().id);
  const q = useCarrossel(id);
  const identidade = useIdentidade();
  if (!admin) return <Navigate to="/" replace />;
  if (q.isPending || identidade.isPending) return <div className="esqueleto" style={{ height: 520 }} />;
  if (q.error) return <ErroDaApi erro={q.error} />;
  if (identidade.error) return <ErroDaApi erro={identidade.error} />;
  // Publicado (o post foi reconhecido) ou de volta: o editor abre de novo, no modo certo.
  return <Editor key={`${q.data.id}:${q.data.situacao === 'publicado'}`} c={q.data} d={identidade.data} />;
}

function rascunhoDe(c: Carrossel): Rascunho {
  return {
    titulo: c.titulo,
    estilo: c.estilo,
    slides: c.conteudo,
    legenda: c.legenda,
    situacao: c.situacao === 'pronto' ? 'pronto' : 'rascunho',
  };
}

/** Salva sozinho 1,2 s depois da última mudança (e na hora de baixar ou sair). */
function useSalvarSozinho(c: Carrossel, r: Rascunho) {
  const cliente = useQueryClient();
  const [base, setBase] = useState(() => JSON.stringify(rascunhoDe(c)));
  const versao = useRef(c.versao);
  const [erro, setErro] = useState<unknown>(null);
  const atual = JSON.stringify(r);
  const sujo = atual !== base;
  const travado = c.situacao === 'publicado' || c.situacao === 'agendado';
  const salvar = useMutation({
    mutationFn: (corpo: Rascunho) =>
      api<Carrossel>(`/carrosseis/${c.id}`, { metodo: 'PUT', corpo: { ...corpo, versao: versao.current } }),
    onSuccess: (salvo, corpo) => {
      versao.current = salvo.versao;
      setBase(JSON.stringify(corpo));
      setErro(null);
      cliente.setQueryData(['carrosseis', 'um', c.id], salvo);
      void cliente.invalidateQueries({ queryKey: ['carrosseis', 'lista'] });
    },
    onError: setErro,
  });
  const conflito = erro instanceof ErroApi && erro.codigo === 'versao';
  useEffect(() => {
    if (!sujo || travado || conflito || salvar.isPending) return;
    const t = setTimeout(() => salvar.mutate(JSON.parse(atual) as Rascunho), 1200);
    return () => clearTimeout(t);
  }, [atual, sujo, travado, conflito, salvar]);
  const salvarAgora = useCallback(async () => {
    if (sujo && !travado) await salvar.mutateAsync(JSON.parse(atual) as Rascunho);
  }, [sujo, travado, salvar, atual]);
  // Saindo com mudança não salva: o navegador pergunta.
  useEffect(() => {
    if (!sujo) return;
    const aviso = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', aviso);
    return () => window.removeEventListener('beforeunload', aviso);
  }, [sujo]);
  return { sujo, salvando: salvar.isPending, erro, conflito, versao: versao.current, salvarAgora, travado };
}

/** A imagem final do slide, pedida ao servidor um pouco depois da última mudança. */
function usePreviaDoServidor(p: {
  slide: SlideCarrossel;
  indice: number;
  total: number;
  estilo: EstiloCarrossel;
  identidade: IdentidadeCarrossel;
  /** v144: feed ou story. */
  formato: FormatoPeca;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [chaveDaImagem, setChaveDaImagem] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const chave = JSON.stringify(p);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a chave resume o pedido inteiro
  useEffect(() => {
    let cancelado = false;
    const pedido = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch('/api/carrosseis/previa', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...p, largura: 900 }),
          signal: pedido.signal,
        });
        if (!r.ok)
          throw new Error(
            (await r.json().catch(() => null))?.erro?.mensagem ?? 'Não deu para desenhar o slide.',
          );
        const blob = await r.blob();
        if (cancelado) return;
        setUrl((antigo) => {
          if (antigo) URL.revokeObjectURL(antigo);
          return URL.createObjectURL(blob);
        });
        setChaveDaImagem(chave);
        setErro(null);
      } catch (e) {
        if (!cancelado && (e as Error).name !== 'AbortError') setErro((e as Error).message);
      }
    }, 350);
    return () => {
      cancelado = true;
      clearTimeout(t);
      pedido.abort();
    };
  }, [chave]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return { url, atualizada: chaveDaImagem === chave, erro };
}

function Editor(props: { c: Carrossel; d: IdentidadeDaConta }) {
  const { c, d } = props;
  const [r, setR] = useState<Rascunho>(() => rascunhoDe(c));
  const [atual, setAtual] = useState(0);
  const [busca, setBusca] = useSearchParams();
  const [aba, setAbaAgora] = useState<Aba>(() =>
    busca.get('aba') === 'publicacao' ? 'publicacao' : 'slide',
  );
  const setAba = (a: Aba) => {
    setAbaAgora(a);
    // A aba Publicação fica no endereço (o aviso do sino abre direto nela).
    const n = new URLSearchParams(busca);
    if (a === 'publicacao') n.set('aba', 'publicacao');
    else n.delete('aba');
    setBusca(n, { replace: true });
  };
  const pub = usePublicacao({ tipo: 'carrossel', id: c.id });
  const pedeAtencao = pub.data?.situacao === 'nao_achado' || pub.data?.situacao === 'sem_instagram';
  const cliente = useQueryClient();
  const situacao = useSituacaoCarrosseis();
  const iaLigada = !!situacao.data?.ia.ligada;
  const conversa = useConversaComOTime(c.id, iaLigada);
  // O que o revisor deixou para decidir: a decisão vai para o servidor, a sugestão entra no rascunho.
  const [relatorio, setRelatorio] = useState<RelatorioTime | null>(c.relatorio);
  const decidir = useMutation({
    mutationFn: (p: { a: AvisoTime; acao: 'usar' | 'manter' }) =>
      api<{ relatorio: RelatorioTime }>(`/carrosseis/${c.id}/avisos/${p.a.id}`, {
        metodo: 'POST',
        corpo: { acao: p.acao },
      }),
    onSuccess: (x) => setRelatorio(x.relatorio),
  });
  const [instagram, setInstagram] = useState(false);
  const [baixando, setBaixando] = useState(false);
  const s = useSalvarSozinho(c, r);
  const identidade = d.identidade;
  const logos = useMemo(() => logosDaIdentidade(d, identidade), [d, identidade]);
  // v144: o card avulso é um slide só, no feed ou no story.
  const ehCard = c.tipo === 'card';
  const formato: FormatoPeca = c.formato ?? 'feed';
  const largPalco = formato === 'story' ? 324 : 432;
  const largMini = formato === 'story' ? 80 : 104;
  const slide = r.slides[Math.min(atual, r.slides.length - 1)]!;
  const indice = Math.min(atual, r.slides.length - 1);

  const montados = useMemo(
    () =>
      r.slides.map((x, i) =>
        montarSlide({
          slide: x,
          indice: i,
          total: r.slides.length,
          identidade,
          estilo: r.estilo,
          foto: x.fotoId && MODELO[x.modelo].foto ? urlFoto(x.fotoId) : null,
          elementos: (x.elementoIds ?? []).map((id) => ({ src: urlFoto(id, 480) })),
          ...logos,
          formato,
        }),
      ),
    [r.slides, r.estilo, identidade, logos, formato],
  );
  const previa = usePreviaDoServidor({
    slide,
    indice,
    total: r.slides.length,
    estilo: r.estilo,
    identidade,
    formato,
  });

  const mudarSlide = (patch: Partial<SlideCarrossel>) =>
    setR((x) => ({ ...x, slides: x.slides.map((y, i) => (i === indice ? { ...y, ...patch } : y)) }));
  const trocarModelo = (modelo: ModeloSlide) =>
    setR((x) => ({
      ...x,
      slides: x.slides.map((y, i) => {
        if (i !== indice) return y;
        const p = slideNovo(modelo, y.id);
        return {
          ...p,
          sobretitulo: y.sobretitulo || p.sobretitulo,
          titulo: y.titulo || p.titulo,
          texto: y.texto || p.texto,
          destaque: y.destaque || p.destaque,
          botao: y.botao || p.botao,
          itens: y.itens.length ? y.itens : p.itens,
          colunas: y.colunas.length ? y.colunas : p.colunas,
          // v150: a imagem da arte da IA é a peça inteira: não vira a foto de um modelo.
          // v152: o recorte (PNG sem fundo) também não: só serve na peça em camadas.
          fotoId: MODELO[modelo].foto && y.modelo !== 'arte' && y.modelo !== 'camadas' ? y.fotoId : null,
          fundo: y.fundo,
        };
      }),
    }));
  const adicionar = (modelo: ModeloSlide) => {
    if (r.slides.length >= MAX_SLIDES) return;
    setR((x) => {
      const slides = [...x.slides];
      slides.splice(indice + 1, 0, slideNovo(modelo, idNovo()));
      return { ...x, slides };
    });
    setAtual(indice + 1);
  };
  const mover = (de: number, para: number) => {
    if (para < 0 || para >= r.slides.length) return;
    setR((x) => {
      const slides = [...x.slides];
      const [um] = slides.splice(de, 1);
      slides.splice(para, 0, um!);
      return { ...x, slides };
    });
    setAtual(para);
  };
  const duplicar = (i: number) => {
    if (r.slides.length >= MAX_SLIDES) return;
    setR((x) => {
      const slides = [...x.slides];
      slides.splice(i + 1, 0, { ...x.slides[i]!, id: idNovo() });
      return { ...x, slides };
    });
    setAtual(i + 1);
  };
  const tirar = (i: number) => {
    if (r.slides.length <= 1) return;
    setR((x) => ({ ...x, slides: x.slides.filter((_, j) => j !== i) }));
    setAtual(Math.max(0, i - 1));
  };
  const baixar = async () => {
    setBaixando(true);
    try {
      await s.salvarAgora();
      const a = document.createElement('a');
      a.href = `/api/carrosseis/${c.id}/imagens.zip`;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setTimeout(() => setBaixando(false), 1500);
    }
  };

  const aoDecidir = (a: AvisoTime, acao: 'usar' | 'manter') => {
    if (acao === 'usar')
      setR((x) => {
        const n = aplicarSugestao(a, x.slides, x.legenda);
        return { ...x, slides: n.slides, legenda: n.legenda };
      });
    decidir.mutate({ a, acao });
  };
  const avisosDoSlide = (id: string) =>
    relatorio?.avisos.filter((a) => a.slideId === id && !a.resolvido) ?? [];
  const avisosDaLegenda = relatorio?.avisos.filter((a) => a.slideId === null) ?? [];
  const usarGancho = (g: string) => {
    const i = r.slides.findIndex((x) => x.modelo === 'capa');
    if (i < 0) return;
    setR((x) => ({
      ...x,
      slides: x.slides.map((y, j) => (j === i ? { ...y, titulo: g.slice(0, 160) } : y)),
    }));
    setAtual(i);
    setAba('slide');
  };

  const desenhar = (slides: SlideCarrossel[]) =>
    slides.map(
      (x, i) =>
        montarSlide({
          slide: x,
          indice: i,
          total: slides.length,
          identidade,
          estilo: r.estilo,
          foto: x.fotoId && MODELO[x.modelo].foto ? urlFoto(x.fotoId) : null,
          elementos: (x.elementoIds ?? []).map((id) => ({ src: urlFoto(id, 480) })),
          ...logos,
          formato,
        }).no,
    );
  // A proposta aplicada entra no rascunho (e o editor salva sozinho, como qualquer mudança).
  const aplicarDoTime = (novo: { slides: SlideCarrossel[]; legenda: string }) => {
    setR((x) => ({ ...x, slides: novo.slides, legenda: novo.legenda }));
    setAtual((i) => Math.min(i, novo.slides.length - 1));
  };
  const verSlide = (id: string) => {
    const i = r.slides.findIndex((x) => x.id === id);
    if (i >= 0) setAtual(i);
    setAba('slide');
  };

  const avisosGerais = ehCard ? [] : avisosDoCarrossel(r.slides);
  const avisosSlide = montados[indice]?.avisos ?? [];
  const estado = s.travado
    ? 'Publicado: só leitura'
    : s.salvando
      ? 'Salvando…'
      : s.sujo
        ? 'Alterações ainda não salvas'
        : 'Tudo salvo';

  return (
    <div className="editor-carrossel">
      <header className="editor-carrossel__topo">
        <Link
          to={ehCard ? '/carrosseis?aba=cards' : '/carrosseis'}
          className="link-botao editor-carrossel__voltar"
        >
          <Icon name="chevron-left" size={16} /> {ehCard ? 'Cards avulsos' : 'Carrosséis'}
        </Link>
        <label className="pp-sr" htmlFor="ec-titulo">
          {ehCard ? 'Nome do card' : 'Nome do carrossel'}
        </label>
        <input
          id="ec-titulo"
          className="editor-carrossel__nome"
          value={r.titulo}
          maxLength={120}
          onChange={(e) => setR({ ...r, titulo: e.target.value })}
          disabled={s.travado}
        />
        <span className="quieto editor-carrossel__estado" aria-live="polite">
          {estado}
        </span>
        <span className="editor-carrossel__espaco" />
        <LinkAjuda artigo="carrosseis" />
        {formato === 'feed' && (
          <Button
            size="sm"
            variant="ghost"
            icon="smartphone"
            onClick={() => setInstagram(true)}
            disabled={s.sujo}
          >
            Ver no celular
          </Button>
        )}
        <Button size="sm" variant="secondary" icon="download" onClick={baixar} disabled={baixando}>
          {baixando ? 'Preparando…' : 'Baixar as imagens'}
        </Button>
        <Button
          size="sm"
          variant={r.situacao === 'pronto' ? 'secondary' : 'primary'}
          icon={r.situacao === 'pronto' ? 'rotate-ccw' : 'check'}
          onClick={() => setR({ ...r, situacao: r.situacao === 'pronto' ? 'rascunho' : 'pronto' })}
          disabled={s.travado}
        >
          {r.situacao === 'pronto' ? 'Voltar para rascunho' : 'Marcar como pronto'}
        </Button>
      </header>
      {s.conflito ? (
        <Mensagem tipo="erro">
          Outra pessoa salvou este carrossel enquanto você editava.{' '}
          <button type="button" className="link-botao" onClick={() => window.location.reload()}>
            Abrir de novo
          </button>
        </Mensagem>
      ) : s.erro ? (
        <ErroDaApi erro={s.erro} />
      ) : null}
      {!!avisosGerais.length && (
        <ul className="editor-carrossel__avisos" aria-label="Avisos do carrossel">
          {avisosGerais.map((a) => (
            <li key={a}>
              <Icon name="circle-help" size={14} /> {a}
            </li>
          ))}
        </ul>
      )}

      <div className="editor-carrossel__corpo">
        <nav className="editor-carrossel__tira" aria-label="Slides">
          <ol className="editor-carrossel__lista">
            {r.slides.map((x, i) => (
              <li key={x.id} className="editor-carrossel__item" data-atual={i === indice || undefined}>
                <button
                  type="button"
                  className="editor-carrossel__mini"
                  aria-current={i === indice || undefined}
                  aria-label={`Slide ${i + 1}: ${MODELO[x.modelo].nome}`}
                  onClick={() => setAtual(i)}
                >
                  <span className="editor-carrossel__num">{i + 1}</span>
                  <SlideHtml no={montados[i]!.no} largura={largMini} formato={formato} />
                  {(!!montados[i]!.avisos.length || avisosDoSlide(x.id).length > 0) && (
                    <span className="editor-carrossel__ponto" title="Tem aviso" />
                  )}
                </button>
                {i === indice && !s.travado && !ehCard && (
                  <span className="editor-carrossel__mini-acoes">
                    <button
                      type="button"
                      className="botao-icone"
                      aria-label="Subir"
                      title="Subir"
                      onClick={() => mover(i, i - 1)}
                      disabled={i === 0}
                    >
                      <Icon name="arrow-up" size={14} />
                    </button>
                    <button
                      type="button"
                      className="botao-icone"
                      aria-label="Descer"
                      title="Descer"
                      onClick={() => mover(i, i + 1)}
                      disabled={i === r.slides.length - 1}
                    >
                      <Icon name="arrow-down" size={14} />
                    </button>
                    <button
                      type="button"
                      className="botao-icone"
                      aria-label="Duplicar o slide"
                      title="Duplicar"
                      onClick={() => duplicar(i)}
                      disabled={r.slides.length >= MAX_SLIDES}
                    >
                      <Icon name="copy" size={14} />
                    </button>
                    <button
                      type="button"
                      className="botao-icone"
                      aria-label="Tirar o slide"
                      title="Tirar"
                      onClick={() => tirar(i)}
                      disabled={r.slides.length <= 1}
                    >
                      <Icon name="trash-2" size={14} />
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ol>
          {!s.travado && !ehCard && (
            <NovoSlide cheio={r.slides.length >= MAX_SLIDES} aoEscolher={adicionar} />
          )}
        </nav>

        <section className="editor-carrossel__palco" aria-label={`Slide ${indice + 1}`}>
          <div
            className="editor-carrossel__imagem"
            data-carregando={!previa.atualizada || undefined}
            data-formato={formato}
          >
            {/* Enquanto o servidor desenha, a prévia do navegador fica por baixo. */}
            <SlideHtml no={montados[indice]!.no} largura={largPalco} formato={formato} />
            {previa.url && (
              <img
                src={previa.url}
                alt={`Slide ${indice + 1} como vai para o Instagram`}
                className="editor-carrossel__final"
                data-velha={!previa.atualizada || undefined}
              />
            )}
          </div>
          <div className="editor-carrossel__nav">
            <button
              type="button"
              className="botao-icone"
              aria-label="Slide anterior"
              onClick={() => setAtual(Math.max(0, indice - 1))}
              disabled={indice === 0}
            >
              <Icon name="chevron-left" size={16} />
            </button>
            <span className="quieto">
              {ehCard ? FORMATO_PECA[formato].nome : `Slide ${indice + 1} de ${r.slides.length}`} · 1080 ×{' '}
              {alturaDoFormato(formato)}
            </span>
            <button
              type="button"
              className="botao-icone"
              aria-label="Próximo slide"
              onClick={() => setAtual(Math.min(r.slides.length - 1, indice + 1))}
              disabled={indice === r.slides.length - 1}
            >
              <Icon name="arrow-right" size={16} />
            </button>
          </div>
          {previa.erro && <Mensagem tipo="erro">{previa.erro}</Mensagem>}
        </section>

        <aside className="editor-carrossel__painel" aria-label="Edição">
          <div className="pipelines" role="tablist" aria-label="Edição">
            {(
              [
                ['slide', 'Slide'],
                ['legenda', 'Legenda'],
                ['carrossel', 'Estilo'],
                ...(relatorio ? ([['time', 'Time de IA']] as const) : []),
                ...(iaLigada && !s.travado ? ([['conversa', 'Conversa']] as const) : []),
                ['publicacao', 'Publicação'],
              ] as const
            ).map(([idAba, rotulo]) => (
              <button
                key={idAba}
                type="button"
                role="tab"
                aria-selected={aba === idAba}
                className="pipelines__aba"
                onClick={() => setAba(idAba)}
              >
                {rotulo}
                {idAba === 'publicacao' && pedeAtencao && (
                  <>
                    <span className="pipelines__ponto" aria-hidden="true" />
                    <span className="pp-sr">(precisa de você)</span>
                  </>
                )}
                {idAba === 'conversa' && (conversa.aberta || conversa.pensando) && (
                  <>
                    <span className="pipelines__ponto" aria-hidden="true" />
                    <span className="pp-sr">
                      {conversa.aberta ? '(proposta esperando)' : '(o time está respondendo)'}
                    </span>
                  </>
                )}
              </button>
            ))}
          </div>
          {aba === 'publicacao' ? (
            <div className="editor-carrossel__campos">
              <PainelPublicacao
                peca={{ tipo: 'carrossel', id: c.id }}
                legenda={r.legenda}
                salvarAntes={s.salvarAgora}
                aoMudarSituacao={() => cliente.invalidateQueries({ queryKey: ['carrosseis', 'um', c.id] })}
                aoBaixar={baixar}
              />
            </div>
          ) : (
            <fieldset className="editor-carrossel__campos" disabled={s.travado}>
              {aba === 'slide' ? (
                <>
                  <AvisosDoRevisor
                    avisos={avisosDoSlide(slide.id)}
                    rotulo={`slide ${indice + 1}`}
                    aoDecidir={aoDecidir}
                    decidindo={decidir.isPending}
                  />
                  <PainelSlide
                    slide={slide}
                    avisos={avisosSlide}
                    aoMudar={mudarSlide}
                    aoModelo={trocarModelo}
                    imagens={!!situacao.data?.ia.imagens}
                    carrosselId={c.id}
                    ehCard={ehCard}
                  />
                  {iaLigada && !s.travado && (
                    <PedirAoTime
                      key={slide.id}
                      conversa={conversa}
                      indice={indice}
                      aoPedir={(p) => {
                        conversa.pedir.mutate({
                          alcance: 'slide',
                          slideId: slide.id,
                          ...p,
                          estado: { slides: r.slides, legenda: r.legenda, estilo: r.estilo },
                        });
                        setAba('conversa');
                      }}
                    />
                  )}
                </>
              ) : aba === 'legenda' ? (
                <>
                  <AvisosDoRevisor
                    avisos={avisosDaLegenda}
                    rotulo="legenda"
                    aoDecidir={aoDecidir}
                    decidindo={decidir.isPending}
                  />
                  <PainelLegenda legenda={r.legenda} aoMudar={(legenda) => setR({ ...r, legenda })} />
                </>
              ) : aba === 'conversa' && iaLigada && !s.travado ? (
                <ConversaComOTime
                  conversa={conversa}
                  estado={{ slides: r.slides, legenda: r.legenda, estilo: r.estilo }}
                  slideAtual={{ id: slide.id, indice }}
                  desenhar={desenhar}
                  aoAplicar={aplicarDoTime}
                  aoVerSlide={verSlide}
                />
              ) : aba === 'time' && relatorio ? (
                <PainelTime r={relatorio} aoUsarGancho={usarGancho} travado={s.travado} card={ehCard} />
              ) : (
                <PainelEstilo estilo={r.estilo} aoMudar={(estilo) => setR({ ...r, estilo })} />
              )}
              {decidir.error && <ErroDaApi erro={decidir.error} />}
            </fieldset>
          )}
        </aside>
      </div>
      {instagram && (
        <VerNoCelular
          carrosselId={c.id}
          versao={s.versao}
          slides={r.slides}
          legenda={r.legenda}
          empresa={pub.data?.instagram.nome || identidade.marcaTexto || 'Sua empresa'}
          usuario={
            pub.data?.instagram.usuario ||
            (identidade.assinatura || identidade.marcaTexto || 'suaempresa')
              .replace(/^@/, '')
              .replace(/\s+/g, '')
              .toLowerCase()
          }
          foto={pub.data?.instagram.foto ?? null}
          publicacao={pub.data ?? null}
          aoFechar={() => setInstagram(false)}
        />
      )}
    </div>
  );
}

function NovoSlide(props: { cheio: boolean; aoEscolher: (m: ModeloSlide) => void }) {
  const [aberto, setAberto] = useState(false);
  if (props.cheio)
    return <p className="quieto editor-carrossel__cheio">Até 10 slides (limite do Instagram).</p>;
  return (
    <div className="editor-carrossel__novo">
      <Button
        size="sm"
        variant="ghost"
        icon="plus"
        onClick={() => setAberto((x) => !x)}
        aria-expanded={aberto}
      >
        Slide
      </Button>
      {aberto && (
        <ul className="editor-carrossel__menu">
          {MODELOS_A_MAO.map((m) => (
            <li key={m}>
              <button
                type="button"
                className="editor-carrossel__opcao"
                onClick={() => {
                  props.aoEscolher(m);
                  setAberto(false);
                }}
              >
                <b>{MODELO[m].nome}</b>
                <span className="quieto">{MODELO[m].descricao}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Contador(props: { n: number; limite: number }) {
  return (
    <span className="campo__contador" data-passou={props.n > props.limite || undefined}>
      {props.n} de {props.limite}
    </span>
  );
}

/**
 * v150: a arte da IA tem o texto desenhado nela. O editor guarda o texto; para a imagem acompanhar,
 * a pessoa pede para desenhar de novo (a tela recarrega com a arte nova). Trocar para um modelo volta
 * a montar a peça por código, com o mesmo texto.
 */
function ArteDaIa(props: { carrosselId: number; imagens: boolean; textoDoSistema: boolean }) {
  const desenhar = useMutation({
    mutationFn: () =>
      api<{ carrosselId: number }>(`/carrosseis/${props.carrosselId}/arte`, { metodo: 'POST' }),
    onSuccess: () => window.location.reload(),
  });
  return (
    <div className="campo painel-slide__arte" role="note">
      <span className="campo__rotulo">Arte desenhada pela IA</span>
      {props.textoDoSistema ? (
        <p className="quieto">
          A IA desenhou só a cena. O texto, o selo, a logo e o botão são escritos pelo sistema, com as suas
          fontes: mude qualquer um aqui e a peça muda na hora, sem desenhar de novo. Quer outra cena? Peça
          abaixo.
        </p>
      ) : (
        <p className="quieto">
          O texto está desenhado na arte. Mudou o texto aqui? Espere salvar e clique em desenhar de novo: a IA
          refaz a peça com a cena nova e o texto passa a ser escrito pelo sistema. Para mexer livre, troque
          para um modelo acima.
        </p>
      )}
      {props.imagens && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          icon="sparkles"
          disabled={desenhar.isPending}
          onClick={() => desenhar.mutate()}
        >
          {desenhar.isPending
            ? 'Desenhando… (até 3 min)'
            : props.textoDoSistema
              ? 'Desenhar outra cena'
              : 'Desenhar de novo com este texto'}
        </Button>
      )}
      <ErroDaApi erro={desenhar.error} />
    </div>
  );
}

/**
 * v152: a peça em camadas. O texto, o fundo e a logo são os campos de sempre; aqui ficam as duas coisas
 * que são só dela: onde a foto recortada entra e qual foto é (trocar pede um recorte novo à IA).
 */
function CamadasDaPeca(props: {
  slide: SlideCarrossel;
  imagens: boolean;
  aoMudar: (p: Partial<SlideCarrossel>) => void;
}) {
  const [fotos, setFotos] = useState(false);
  const recortar = useMutation({
    mutationFn: (fotoId: number) =>
      api<{ foto: { id: number } }>(`/carrosseis/fotos/${fotoId}/recorte`, { metodo: 'POST' }),
    onSuccess: (r) => {
      props.aoMudar({ fotoId: r.foto.id });
      setFotos(false);
    },
  });
  const elemento = useMutation({
    mutationFn: () =>
      api<{ foto: { id: number } }>('/carrosseis/elementos', {
        metodo: 'POST',
        corpo: {
          titulo: props.slide.titulo.replace(/\*/g, ''),
          destaque: props.slide.destaque,
          texto: props.slide.texto,
        },
      }),
    onSuccess: (r) => props.aoMudar({ elementoIds: [r.foto.id] }),
  });
  const temElemento = (props.slide.elementoIds ?? []).length > 0;
  const composicao = props.slide.composicao ?? 'lado';
  return (
    <div className="campo painel-slide__arte">
      <span className="campo__rotulo">Peça em camadas</span>
      <p className="quieto">
        A foto é a sua, com o fundo tirado pela IA. O texto é escrito pelo sistema: pode mudar à vontade, sem
        refazer a imagem. A cor de trás é a do campo Fundo, mais abaixo.
      </p>
      <div className="painel-slide__modelos" role="radiogroup" aria-label="Onde a foto entra">
        {COMPOSICOES_CAMADAS.map((x) => (
          <label key={x} className="painel-slide__modelo" data-ativo={composicao === x || undefined}>
            <input
              type="radio"
              name="ps-composicao"
              className="pp-sr"
              checked={composicao === x}
              onChange={() => props.aoMudar({ composicao: x })}
            />
            {ROTULO_COMPOSICAO[x]}
          </label>
        ))}
      </div>
      <span className="campo__rotulo">Forma atrás da foto</span>
      <div className="painel-slide__modelos" role="radiogroup" aria-label="Forma atrás da foto">
        {FORMAS_CAMADAS.map((x) => (
          <label
            key={x}
            className="painel-slide__modelo"
            data-ativo={(props.slide.forma ?? 'circulo') === x || undefined}
          >
            <input
              type="radio"
              name="ps-forma"
              className="pp-sr"
              checked={(props.slide.forma ?? 'circulo') === x}
              onChange={() => props.aoMudar({ forma: x })}
            />
            {ROTULO_FORMA[x]}
          </label>
        ))}
      </div>
      <span className="campo__rotulo">Acabamento do recorte</span>
      <div className="painel-slide__modelos" role="radiogroup" aria-label="Acabamento do recorte">
        {ACABAMENTOS_CAMADAS.map((x) => (
          <label
            key={x}
            className="painel-slide__modelo"
            data-ativo={(props.slide.acabamento ?? 'sombra') === x || undefined}
          >
            <input
              type="radio"
              name="ps-acabamento"
              className="pp-sr"
              checked={(props.slide.acabamento ?? 'sombra') === x}
              onChange={() => props.aoMudar({ acabamento: x })}
            />
            {ROTULO_ACABAMENTO[x]}
          </label>
        ))}
      </div>
      <p className="quieto">
        A sombra e o contorno aparecem na imagem final (Ver no celular e ao baixar), não na prévia enquanto
        você edita.
      </p>
      <div className="painel-slide__foto">
        {props.slide.fotoId ? (
          <img
            className="painel-slide__foto-img"
            src={urlFoto(props.slide.fotoId, 240)}
            alt="A foto recortada"
            style={{ background: 'var(--surface-sunken)' }}
          />
        ) : (
          <span className="quieto">Sem o recorte: a peça aparece no modelo Capa.</span>
        )}
        {props.imagens && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            icon="image"
            disabled={recortar.isPending}
            onClick={() => setFotos((x) => !x)}
          >
            {recortar.isPending ? 'Recortando… (até 2 min)' : fotos ? 'Fechar as fotos' : 'Trocar a foto'}
          </Button>
        )}
      </div>
      {fotos && !recortar.isPending && (
        <FotosDaEmpresa escolhida={null} escolher={(id) => recortar.mutate(id)} />
      )}
      <ErroDaApi erro={recortar.error} />
      {props.imagens && (
        <div className="acoes">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            icon="sparkles"
            disabled={elemento.isPending || !props.slide.titulo.trim()}
            onClick={() => elemento.mutate()}
          >
            {elemento.isPending
              ? 'Fazendo o elemento… (até 2 min)'
              : temElemento
                ? 'Outro elemento em 3D'
                : 'Pôr um elemento em 3D'}
          </Button>
          {temElemento && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => props.aoMudar({ elementoIds: [] })}
            >
              Tirar o elemento
            </Button>
          )}
        </div>
      )}
      {temElemento && props.slide.fundo === 'destaque' && (
        <p className="quieto">O elemento é da cor de destaque: sobre o fundo de destaque ele não aparece.</p>
      )}
      <ErroDaApi erro={elemento.error} />
    </div>
  );
}

function PainelSlide(props: {
  slide: SlideCarrossel;
  avisos: string[];
  aoMudar: (p: Partial<SlideCarrossel>) => void;
  aoModelo: (m: ModeloSlide) => void;
  /** v132: o time pode fazer imagens (cenários para o produto). */
  imagens: boolean;
  carrosselId: number;
  /** v148: card avulso: o selo e o botão valem em qualquer modelo. */
  ehCard?: boolean;
}) {
  const { slide } = props;
  const m = MODELO[slide.modelo];
  const campos = [
    ...m.campos,
    ...(props.ehCard
      ? (
          [
            { campo: 'sobretitulo', rotulo: 'Selo', limite: 24, dica: 'Ex.: Chegamos a Brasília' },
            { campo: 'botao', rotulo: 'Botão', limite: 22, dica: 'Ex.: Chame no WhatsApp' },
          ] as const
        ).filter((x) => !m.campos.some((c) => c.campo === x.campo))
      : []),
  ];
  const [fotos, setFotos] = useState(false);
  const todas = useFotos(props.imagens).data?.fotos ?? [];
  // O produto de onde saem os cenários: a própria foto enviada ou a foto de onde o cenário saiu.
  const produtoDe = (id: number): number | null => {
    const f = todas.find((x) => x.id === id);
    if (!f) return null;
    if ((f.origem ?? 'enviada') === 'enviada') return f.id;
    return f.origem === 'cenario' ? (f.baseFotoId ?? null) : null;
  };
  return (
    <div className="painel-slide">
      <div className="campo">
        <span className="campo__rotulo">Modelo do slide</span>
        <div className="painel-slide__modelos" role="radiogroup" aria-label="Modelo do slide">
          {(slide.modelo === 'arte' || slide.modelo === 'camadas'
            ? [...MODELOS_A_MAO, slide.modelo]
            : MODELOS_A_MAO
          ).map((x) => (
            <label
              key={x}
              className="painel-slide__modelo"
              data-ativo={slide.modelo === x || undefined}
              title={MODELO[x].descricao}
            >
              <input
                type="radio"
                name="ps-modelo"
                className="pp-sr"
                checked={slide.modelo === x}
                onChange={() => props.aoModelo(x)}
              />
              {MODELO[x].nome}
            </label>
          ))}
        </div>
      </div>

      {campos.map((cp) => {
        const valor = slide[cp.campo];
        const longo = cp.limite > 60;
        const idCampo = `ps-${cp.campo}`;
        return (
          <div key={cp.campo} className="campo">
            <label htmlFor={idCampo}>
              {cp.rotulo} <Contador n={valor.length} limite={cp.limite} />
            </label>
            {longo ? (
              <textarea
                id={idCampo}
                rows={cp.limite > 150 ? 4 : 2}
                value={valor}
                maxLength={cp.campo === 'texto' ? 400 : 160}
                placeholder={cp.dica}
                onChange={(e) => props.aoMudar({ [cp.campo]: e.target.value })}
              />
            ) : (
              <input
                id={idCampo}
                className="filtro"
                value={valor}
                maxLength={cp.campo === 'destaque' ? 24 : 40}
                placeholder={cp.dica}
                onChange={(e) => props.aoMudar({ [cp.campo]: e.target.value })}
              />
            )}
            {cp.campo === 'titulo' && (
              <span className="campo__dica">
                Ponha *entre asteriscos* a palavra que sai na cor de destaque.
              </span>
            )}
          </div>
        );
      })}

      {m.itens && (
        <fieldset className="campo">
          <legend>Itens (até {m.itens.max})</legend>
          {slide.itens.map((it, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: os itens não têm id; a ordem é a identidade
            <div key={i} className="painel-slide__item">
              <span className="mono quieto">{i + 1}</span>
              <input
                className="filtro"
                aria-label={`Item ${i + 1}`}
                value={it}
                maxLength={120}
                onChange={(e) =>
                  props.aoMudar({ itens: slide.itens.map((x, j) => (j === i ? e.target.value : x)) })
                }
              />
              <Contador n={it.length} limite={m.itens!.limite} />
              <button
                type="button"
                className="botao-icone"
                aria-label={`Tirar o item ${i + 1}`}
                onClick={() => props.aoMudar({ itens: slide.itens.filter((_, j) => j !== i) })}
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
          {slide.itens.length < m.itens.max && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              icon="plus"
              onClick={() => props.aoMudar({ itens: [...slide.itens, ''] })}
            >
              Item
            </Button>
          )}
        </fieldset>
      )}

      {m.colunas &&
        [0, 1].map((i) => {
          const col = slide.colunas[i] ?? { rotulo: '', texto: '' };
          const mudar = (p: Partial<typeof col>) => {
            const colunas = [0, 1].map((j) => slide.colunas[j] ?? { rotulo: '', texto: '' });
            colunas[i] = { ...col, ...p };
            props.aoMudar({ colunas });
          };
          return (
            <fieldset key={i} className="campo painel-slide__coluna">
              <legend>{i === 0 ? 'Lado esquerdo (o comum)' : 'Lado direito (o certo)'}</legend>
              <input
                className="filtro"
                aria-label="Rótulo"
                placeholder={i === 0 ? 'Hoje' : 'O certo'}
                value={col.rotulo}
                maxLength={24}
                onChange={(e) => mudar({ rotulo: e.target.value })}
              />
              <textarea
                aria-label="Texto"
                rows={3}
                value={col.texto}
                maxLength={160}
                onChange={(e) => mudar({ texto: e.target.value })}
              />
              <Contador n={col.texto.length} limite={120} />
            </fieldset>
          );
        })}

      {slide.modelo === 'arte' && (
        <ArteDaIa
          carrosselId={props.carrosselId}
          imagens={props.imagens}
          textoDoSistema={!!slide.zonaTexto}
        />
      )}
      {slide.modelo === 'camadas' && (
        <CamadasDaPeca slide={slide} imagens={props.imagens} aoMudar={props.aoMudar} />
      )}

      {m.foto && slide.modelo !== 'arte' && slide.modelo !== 'camadas' && (
        <div className="campo">
          <span className="campo__rotulo">Foto</span>
          <div className="painel-slide__foto">
            {slide.fotoId ? (
              <img className="painel-slide__foto-img" src={urlFoto(slide.fotoId, 240)} alt="Foto do slide" />
            ) : (
              <span className="quieto">Sem foto</span>
            )}
            <span className="acoes">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                icon="image"
                onClick={() => setFotos((x) => !x)}
              >
                {fotos ? 'Fechar as fotos' : 'Escolher foto'}
              </Button>
              {slide.fotoId && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => props.aoMudar({ fotoId: null })}
                >
                  Tirar a foto
                </Button>
              )}
            </span>
          </div>
          {fotos && (
            <FotosDaEmpresa
              escolhida={slide.fotoId}
              escolher={(id) => {
                props.aoMudar({ fotoId: id });
                setFotos(false);
              }}
            />
          )}
          {props.imagens && slide.fotoId && produtoDe(slide.fotoId) && (
            <CenariosDoProduto
              fotoId={produtoDe(slide.fotoId)!}
              carrosselId={props.carrosselId}
              escolhida={slide.fotoId}
              aoUsar={(id) => props.aoMudar({ fotoId: id })}
            />
          )}
        </div>
      )}

      <fieldset className="campo">
        <legend>Fundo</legend>
        <div className="segmentos">
          {FUNDOS_SLIDE.map((fd) => (
            <label key={fd} className="segmento">
              <input
                type="radio"
                name="ps-fundo"
                className="pp-sr"
                checked={slide.fundo === fd}
                onChange={() => props.aoMudar({ fundo: fd })}
              />
              {ROTULO_FUNDO[fd]}
            </label>
          ))}
        </div>
      </fieldset>

      {!!props.avisos.length && (
        <ul className="editor-carrossel__avisos" aria-label="Avisos deste slide">
          {props.avisos.map((a) => (
            <li key={a}>
              <Icon name="circle-help" size={14} /> {a}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PainelLegenda(props: { legenda: string; aoMudar: (v: string) => void }) {
  const [copiada, setCopiada] = useState(false);
  return (
    <div className="painel-slide">
      <div className="campo">
        <label htmlFor="pl-legenda">
          Legenda do post <Contador n={props.legenda.length} limite={2200} />
        </label>
        <textarea
          id="pl-legenda"
          rows={12}
          maxLength={2200}
          value={props.legenda}
          placeholder="A primeira frase é o gancho: só ela aparece antes do “mais”."
          onChange={(e) => props.aoMudar(e.target.value)}
        />
        <span className="campo__dica">
          Antes do “mais” aparece: <i>{props.legenda.slice(0, 125) || '—'}</i>
          {props.legenda.length > 125 ? '…' : ''}
        </span>
      </div>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        icon="copy"
        disabled={!props.legenda.trim()}
        onClick={() => {
          void navigator.clipboard.writeText(props.legenda).then(() => {
            setCopiada(true);
            setTimeout(() => setCopiada(false), 1600);
          });
        }}
      >
        {copiada ? 'Copiada' : 'Copiar a legenda'}
      </Button>
    </div>
  );
}

function PainelEstilo(props: { estilo: EstiloCarrossel; aoMudar: (e: EstiloCarrossel) => void }) {
  return (
    <div className="painel-slide">
      <p className="quieto">
        O estilo vale para o carrossel inteiro. Cores, fontes e logo vêm da identidade visual.
      </p>
      <div className="painel-slide__estilos" role="radiogroup" aria-label="Estilo do carrossel">
        {ESTILOS.map((e) => (
          <label key={e} className="painel-slide__estilo" data-ativo={props.estilo === e || undefined}>
            <input
              type="radio"
              name="pe-estilo"
              className="pp-sr"
              checked={props.estilo === e}
              onChange={() => props.aoMudar(e)}
            />
            <b>{ESTILO[e].nome}</b>
            <span className="quieto">{ESTILO[e].descricao}</span>
          </label>
        ))}
      </div>
      <Link to="/carrosseis?aba=identidade" className="link-botao">
        Mudar a identidade visual
      </Link>
    </div>
  );
}
