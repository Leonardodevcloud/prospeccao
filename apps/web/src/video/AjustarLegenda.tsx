import '@fontsource/montserrat/latin-800.css';
import '@fontsource/montserrat/latin-900.css';
import '@fontsource/poppins/latin-800.css';
import '@fontsource/poppins/latin-900.css';
import '@fontsource/inter/latin-800.css';
import '@fontsource/inter/latin-900.css';
import '@fontsource/archivo/latin-800.css';
import '@fontsource/archivo/latin-900.css';
import '@fontsource/bebas-neue/latin-400.css';
import '@fontsource/plus-jakarta-sans/latin-800.css';
import {
  CAMADAS_PADRAO,
  type CamadasDoVideo,
  type DesenhoDoVideo,
  type DetalheVideo,
  type EstiloLegenda,
  FAIXA_DO_INSTAGRAM,
  FONTES_LEGENDA,
  type FonteLegenda,
  fmtDuracao,
  LEGENDA_PADRAO,
  type LegendaDoVideo,
  lugarDoTrecho,
  TELA_DO_VIDEO,
} from '@prospeccao/shared/videos';
import { Button, Icon } from '@prospeccao/ui';
import {
  type PointerEvent as PonteiroReact,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { ErroDaApi } from '../componentes/Formulario';
import { useArquivo, useRevisao } from './dados';

/**
 * Legenda em camadas (v166): a prévia ao vivo da legenda sobre o vídeo cortado (sem a legenda
 * gravada), com a legenda, o título e as animações arrastáveis, e a fonte, o tamanho e as cores à
 * escolha. A prévia desenha com o desenho que o editor guardou na última edição; o vídeo final só
 * muda ao gerar de novo.
 */

export type Camada = 'legenda' | 'titulo' | 'animacoes';

export const FAMILIA: Record<FonteLegenda, string> = {
  montserrat: '"Montserrat"',
  poppins: '"Poppins"',
  inter: '"Inter"',
  archivo: '"Archivo"',
  bebas: '"Bebas Neue"',
  jakarta: '"Plus Jakarta Sans"',
};
const fonteDe = (id: FonteLegenda) => FONTES_LEGENDA.find((f) => f.id === id) ?? FONTES_LEGENDA[0];
const limitar = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

/** O ajuste que o palco e o painel dividem: o que está na tela agora e como salvar. */
export interface AjusteDaLegenda {
  legenda: LegendaDoVideo;
  camadas: CamadasDoVideo;
  camada: Camada;
  alcance: 'trecho' | 'tudo';
  /** O trecho da legenda em foco (o índice da primeira palavra). */
  trecho: number | null;
  video: RefObject<HTMLVideoElement | null>;
  setCamada: (c: Camada) => void;
  setAlcance: (a: 'trecho' | 'tudo') => void;
  setTrecho: (k: number | null) => void;
  /** Muda na tela sem salvar (enquanto arrasta). */
  mostrar: (l: LegendaDoVideo, c?: CamadasDoVideo) => void;
  /** Muda e salva. */
  salvar: (l: LegendaDoVideo, c?: CamadasDoVideo) => void;
  irPara: (segundo: number) => void;
  salvando: boolean;
  erro: unknown;
}

export function useAjusteDaLegenda(v: DetalheVideo): AjusteDaLegenda {
  const revisao = useRevisao(v.id);
  const video = useRef<HTMLVideoElement | null>(null);
  const [legenda, setLegenda] = useState<LegendaDoVideo>(v.opcoes.legenda ?? LEGENDA_PADRAO);
  const [camadas, setCamadas] = useState<CamadasDoVideo>(v.opcoes.camadas ?? CAMADAS_PADRAO);
  const [camada, setCamada] = useState<Camada>('legenda');
  const [alcance, setAlcance] = useState<'trecho' | 'tudo'>('trecho');
  const [trecho, setTrecho] = useState<number | null>(null);
  // O que veio do servidor vale quando a versão muda (outra aba, a editora, o Desfazer).
  // biome-ignore lint/correctness/useExhaustiveDependencies: só a versão dispara
  useEffect(() => {
    setLegenda(v.opcoes.legenda ?? LEGENDA_PADRAO);
    setCamadas(v.opcoes.camadas ?? CAMADAS_PADRAO);
  }, [v.versao]);
  return {
    legenda,
    camadas,
    camada,
    alcance,
    trecho,
    video,
    setCamada,
    setAlcance,
    setTrecho,
    mostrar: (l, c) => {
      setLegenda(l);
      if (c) setCamadas(c);
    },
    salvar: (l, c) => {
      setLegenda(l);
      if (c) setCamadas(c);
      revisao.mutate({ legenda: l, camadas: c ?? camadas });
    },
    irPara: (segundo) => {
      const el = video.current;
      if (!el) return;
      el.pause();
      el.currentTime = Math.max(0, segundo);
    },
    salvando: revisao.isPending,
    erro: revisao.error,
  };
}

/* ───────────────────────────── O palco ───────────────────────────── */

function estiloDaPalavra(
  estilo: EstiloLegenda,
  o: {
    tam: number;
    forte: boolean;
    acesa: boolean;
    /** A palavra já começou a ser falada (fora do tempo do trecho, todas contam como ditas). */
    dita: boolean;
    legenda: LegendaDoVideo;
    cores: DesenhoDoVideo['cores'];
  },
): React.CSSProperties {
  const f = fonteDe(o.legenda.fonte);
  const texto = o.legenda.corTexto ?? '#ffffff';
  const contorno = o.legenda.corContorno ?? 'rgba(10,0,25,.92)';
  // v167: a cor das palavras em destaque (escolhida, ou a de destaque da marca).
  const forte = o.legenda.corForte ?? o.cores.destaque;
  const base: React.CSSProperties = {
    fontFamily: `${FAMILIA[o.legenda.fonte]}, sans-serif`,
    fontSize: o.tam,
    lineHeight: 1.12,
    display: 'inline-block',
  };
  if (estilo === 'balao')
    return {
      ...base,
      fontWeight: f.normal,
      lineHeight: 1.25,
      color: o.forte ? (o.legenda.corForte ?? o.cores.primaria) : '#18181b',
    };
  // v167: karaokê (a palavra falada acende; as que ainda não foram ditas ficam apagadas) e impacto
  // (palavras gigantes, que só aparecem quando são faladas).
  if (estilo === 'pilula')
    return {
      ...base,
      fontWeight: f.normal,
      lineHeight: 1.3,
      padding: '0 12px',
      borderRadius: 14,
      color: o.forte ? forte : texto,
      background: o.acesa ? (o.legenda.corAcesa ?? o.cores.primaria) : 'transparent',
      opacity: o.dita ? 1 : 0.55,
    };
  if (estilo === 'impacto')
    return {
      ...base,
      fontWeight: f.forte,
      textTransform: 'uppercase',
      letterSpacing: '-.02em',
      lineHeight: 1.02,
      color: o.forte ? forte : texto,
      WebkitTextStroke: `${Math.round(o.tam * 0.1)}px ${contorno}`,
      paintOrder: 'stroke fill',
      opacity: o.dita ? 1 : 0.25,
    };
  if (estilo === 'simples')
    return {
      ...base,
      fontWeight: f.normal,
      lineHeight: 1.18,
      color: o.forte ? forte : texto,
      WebkitTextStroke: `${Math.round(o.tam * 0.09)}px ${contorno}`,
      paintOrder: 'stroke fill',
    };
  return {
    ...base,
    fontWeight: f.forte,
    textTransform: 'uppercase',
    letterSpacing: '-.01em',
    padding: '0 14px',
    borderRadius: 16,
    color: o.acesa ? texto : o.forte ? forte : texto,
    background: o.acesa ? (o.forte ? forte : (o.legenda.corAcesa ?? o.cores.primaria)) : 'transparent',
    WebkitTextStroke: `${Math.round(o.tam * 0.13)}px ${contorno}`,
    paintOrder: 'stroke fill',
    transform: o.acesa ? 'scale(1.06)' : undefined,
  };
}

export function PalcoDaLegenda({ v, ajuste }: { v: DetalheVideo; ajuste: AjusteDaLegenda }) {
  const d = v.desenho;
  const limpo = useArquivo(v.id, 'limpo', !!d?.temVideo, String(v.prontoEm ?? ''));
  const moldura = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(360);
  const [t, setT] = useState(0);
  const [arrastando, setArrastando] = useState(false);
  const inicio = useRef<{ x: number; y: number; legenda: LegendaDoVideo; camadas: CamadasDoVideo } | null>(
    null,
  );
  const { legenda, camadas, camada, alcance } = ajuste;

  useEffect(() => {
    const el = moldura.current;
    if (!el) return;
    const medir = () => setLargura(el.clientWidth || 360);
    medir();
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  // O tempo do vídeo, quadro a quadro enquanto toca.
  useEffect(() => {
    let quadro = 0;
    const laco = () => {
      const el = ajuste.video.current;
      if (el) setT(el.currentTime);
      quadro = requestAnimationFrame(laco);
    };
    quadro = requestAnimationFrame(laco);
    return () => cancelAnimationFrame(quadro);
  }, [ajuste.video]);

  if (!d)
    return (
      <div className="video__player video__player--vazio lg-vazio">
        <p>
          Gere o vídeo de novo uma vez para liberar o ajuste da legenda: o editor passa a guardar o vídeo
          cortado sem a legenda e o lugar de cada trecho.
        </p>
      </div>
    );

  const escala = largura / TELA_DO_VIDEO.largura;
  const noTempo = d.legendas.find((l) => t >= l.ini && t < l.fim);
  const maisPerto = [...d.legendas].sort((a, b) => Math.abs(a.ini - t) - Math.abs(b.ini - t))[0];
  const atual =
    (ajuste.trecho != null && d.legendas.find((l) => l.k === ajuste.trecho && !noTempo)) ||
    noTempo ||
    maisPerto;
  const fator = legenda.tamanho / (d.tamanho || 1);
  const lugar = atual ? lugarDoTrecho(legenda, atual.k, atual) : null;
  const rosto = d.rostos.length
    ? d.rostos.reduce((m, r) => (Math.abs(r[0] - t) < Math.abs(m[0] - t) ? r : m), d.rostos[0]!)
    : null;
  const animacao =
    d.animacoes.find((a) => t >= a.ini && t < a.fim) ??
    [...d.animacoes].sort((a, b) => Math.abs(a.ini - t) - Math.abs(b.ini - t))[0];

  const aoPegar = (e: PonteiroReact<HTMLElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    inicio.current = { x: e.clientX, y: e.clientY, legenda, camadas };
    setArrastando(true);
    ajuste.video.current?.pause();
    if (atual && camada === 'legenda') ajuste.setTrecho(atual.k);
  };
  /** O ajuste depois de andar (dx, dy) pontos do quadro, ou de mudar a escala. */
  const depois = (dx: number, dy: number, escalaNova?: number): [LegendaDoVideo, CamadasDoVideo] => {
    const i = inicio.current!;
    if (camada !== 'legenda') {
      const antes = i.camadas[camada];
      let x = antes.dx + dx;
      if (Math.abs(x) < 14) x = 0;
      return [
        i.legenda,
        { ...i.camadas, [camada]: { dx: limitar(Math.round(x), -500, 500), dy: Math.round(antes.dy + dy) } },
      ];
    }
    if (alcance === 'tudo' || !atual) {
      let x = i.legenda.dx + dx;
      if (Math.abs(x) < 14) x = 0;
      return [
        {
          ...i.legenda,
          dx: limitar(Math.round(x), -400, 400),
          dy: Math.round(i.legenda.dy + dy),
          ...(escalaNova
            ? { tamanho: limitar(Math.round(i.legenda.tamanho * escalaNova * 20) / 20, 0.6, 1.6) }
            : {}),
        },
        i.camadas,
      ];
    }
    const antes = i.legenda.trechos[String(atual.k)] ?? { dx: 0, dy: 0, escala: 1 };
    let x = antes.dx + dx;
    // Encaixa no centro (somando o deslocamento do vídeo todo).
    if (Math.abs(i.legenda.dx + x) < 14) x = -i.legenda.dx;
    return [
      {
        ...i.legenda,
        trechos: {
          ...i.legenda.trechos,
          [String(atual.k)]: {
            dx: Math.round(x),
            dy: Math.round(antes.dy + dy),
            escala: escalaNova
              ? limitar(Math.round(antes.escala * escalaNova * 20) / 20, 0.5, 1.8)
              : antes.escala,
          },
        },
      },
      i.camadas,
    ];
  };
  const aoMover = (e: PonteiroReact<HTMLElement>, tamanho = false) => {
    const i = inicio.current;
    if (!i) return;
    const dx = (e.clientX - i.x) / escala;
    const dy = (e.clientY - i.y) / escala;
    const [l, c] = tamanho ? depois(0, 0, limitar(1 + (dx + dy) / 500, 0.4, 2.5)) : depois(dx, dy);
    ajuste.mostrar(l, c);
  };
  const aoSoltar = () => {
    if (!inicio.current) return;
    inicio.current = null;
    setArrastando(false);
    ajuste.salvar(ajuste.legenda, ajuste.camadas);
  };

  const dxAtual = camada === 'legenda' ? (lugar?.dx ?? 0) : camadas[camada].dx;
  const caixaLegenda =
    atual && lugar ? { y0: lugar.topo, y1: lugar.topo + atual.altura * fator * lugar.escala } : null;
  const noInstagram = !!caixaLegenda && caixaLegenda.y1 > FAIXA_DO_INSTAGRAM;
  const noRosto = !!caixaLegenda && !!rosto && caixaLegenda.y0 < rosto[4] && caixaLegenda.y1 > rosto[2];
  const pega = {
    onPointerMove: (e: PonteiroReact<HTMLElement>) => aoMover(e),
    onPointerUp: aoSoltar,
    onPointerCancel: aoSoltar,
  };

  return (
    <div className="lg-palco">
      <div ref={moldura} className="lg-moldura">
        {limpo.data ? (
          // biome-ignore lint/a11y/useMediaCaption: a legenda é desenhada por cima, ao vivo
          <video
            ref={ajuste.video}
            className="lg-video"
            src={limpo.data.url}
            controls
            playsInline
            preload="metadata"
          />
        ) : (
          <div className="lg-video lg-video--vazio">
            {limpo.error ? (
              <ErroDaApi erro={limpo.error} />
            ) : (
              'A prévia sem legenda aparece depois do próximo "Gerar de novo".'
            )}
          </div>
        )}
        <div className="lg-tela" style={{ transform: `scale(${escala})` }}>
          {rosto && (
            <div
              className="lg-rosto"
              style={{
                left: rosto[1],
                top: rosto[2],
                width: rosto[3] - rosto[1],
                height: rosto[4] - rosto[2],
              }}
            >
              <span>rosto</span>
            </div>
          )}
          <div className="lg-instagram" style={{ top: FAIXA_DO_INSTAGRAM }}>
            <span>abaixo daqui o Instagram cobre</span>
          </div>
          {arrastando && dxAtual === 0 && <div className="lg-centro" aria-hidden="true" />}
          {d.titulo && (camada === 'titulo' || (t >= d.titulo.ini && t < d.titulo.fim)) && (
            <div
              className="lg-caixa"
              data-ativa={camada === 'titulo' || undefined}
              style={{
                left: 110 + camadas.titulo.dx,
                top: limitar(d.titulo.topo + camadas.titulo.dy, 40, TELA_DO_VIDEO.altura - 200),
                height: d.titulo.altura,
              }}
              {...(camada === 'titulo' ? { onPointerDown: aoPegar, ...pega } : {})}
            >
              <b>Título de abertura</b>
              <span>{d.titulo.texto}</span>
            </div>
          )}
          {animacao && (camada === 'animacoes' || (t >= animacao.ini && t < animacao.fim)) && (
            <div
              className="lg-caixa"
              data-ativa={camada === 'animacoes' || undefined}
              style={{
                left: 110 + camadas.animacoes.dx,
                top: limitar(animacao.topo + camadas.animacoes.dy, 40, TELA_DO_VIDEO.altura - 200),
                height: animacao.altura,
              }}
              {...(camada === 'animacoes' ? { onPointerDown: aoPegar, ...pega } : {})}
            >
              <b>Animação</b>
              <span>{animacao.rotulo}</span>
            </div>
          )}
          {atual && lugar && (
            <div
              className="lg-bloco"
              data-estilo={d.estilo}
              data-ativa={camada === 'legenda' || undefined}
              data-fora={(!noTempo && !arrastando) || undefined}
              style={{
                left: 110 + lugar.dx,
                top: lugar.topo,
                columnGap: Math.round(atual.tam * fator * 0.32),
                transform: `scale(${lugar.escala})`,
              }}
              {...(camada === 'legenda' ? { onPointerDown: aoPegar, ...pega } : {})}
            >
              {atual.palavras.map(([texto, i, f, forte]) => (
                <span
                  key={`${i}-${texto}`}
                  style={estiloDaPalavra(d.estilo, {
                    tam: Math.round(atual.tam * fator),
                    forte: !!forte,
                    acesa: !!noTempo && t >= i && t < f,
                    dita: !noTempo || t >= i,
                    legenda,
                    cores: v.opcoes.cores ?? d.cores,
                  })}
                >
                  {texto}
                </span>
              ))}
              {camada === 'legenda' && (
                <button
                  type="button"
                  className="lg-tamanho"
                  aria-label="Arrastar para mudar o tamanho"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    aoPegar(e);
                  }}
                  onPointerMove={(e) => {
                    e.stopPropagation();
                    aoMover(e, true);
                  }}
                  onPointerUp={(e) => {
                    e.stopPropagation();
                    aoSoltar();
                  }}
                  onPointerCancel={aoSoltar}
                />
              )}
            </div>
          )}
        </div>
      </div>
      <p
        className="campo__dica lg-aviso"
        data-alerta={noInstagram || noRosto || undefined}
        aria-live="polite"
      >
        {noRosto
          ? 'A legenda está em cima do rosto neste trecho.'
          : noInstagram
            ? 'A legenda entrou na faixa que o Instagram cobre com os botões.'
            : camada === 'legenda'
              ? 'Arraste a legenda no vídeo. A bolinha no canto muda o tamanho.'
              : `Arraste ${camada === 'titulo' ? 'o título' : 'as animações'} no vídeo.`}
      </p>
    </div>
  );
}

/* ───────────────────────────── O painel ───────────────────────────── */

/**
 * Um seletor de cor. Salva quando a pessoa fecha a paleta (o evento "change" do navegador) e, por
 * garantia, ao sair do campo. v167: antes só salvava ao sair do campo, e quem escolhia a cor e ia
 * direto em "Gerar de novo" gerava sem ela.
 */
export function Cor(props: {
  rotulo: string;
  valor: string | null;
  padrao: string;
  aoMudar: (c: string | null) => void;
}) {
  const id = useId();
  const campo = useRef<HTMLInputElement>(null);
  const [cor, setCor] = useState(props.valor ?? props.padrao);
  useEffect(() => setCor(props.valor ?? props.padrao), [props.valor, props.padrao]);
  const atual = useRef({ salva: props.valor ?? props.padrao, aoMudar: props.aoMudar });
  atual.current = { salva: props.valor ?? props.padrao, aoMudar: props.aoMudar };
  useEffect(() => {
    const el = campo.current;
    if (!el) return;
    // A paleta fechando e a saída do campo podem vir juntas: a mesma cor só é enviada uma vez.
    let enviada = '';
    const salvar = () => {
      const cor = el.value.toLowerCase();
      if (cor === atual.current.salva.toLowerCase() || cor === enviada) return;
      enviada = cor;
      atual.current.aoMudar(el.value);
    };
    el.addEventListener('change', salvar);
    el.addEventListener('blur', salvar);
    return () => {
      el.removeEventListener('change', salvar);
      el.removeEventListener('blur', salvar);
    };
  }, []);
  return (
    <label htmlFor={id} className="lg-cor">
      <input ref={campo} id={id} type="color" value={cor} onChange={(e) => setCor(e.target.value)} />
      <span>{props.rotulo}</span>
      <span className="mono quieto">{props.valor ?? 'padrão'}</span>
    </label>
  );
}

export function PainelDaLegenda({ v, ajuste }: { v: DetalheVideo; ajuste: AjusteDaLegenda }) {
  const id = useId();
  const d = v.desenho;
  const { legenda, camadas, camada, alcance } = ajuste;
  const [tamanho, setTamanho] = useState(legenda.tamanho);
  useEffect(() => setTamanho(legenda.tamanho), [legenda.tamanho]);
  if (!d) return null;
  // As cores só deste vídeo (v163) valem mais que as da última edição.
  const cores = v.opcoes.cores ?? d.cores;
  const movidos = Object.keys(legenda.trechos).length;
  const legendaMovida = legenda.dx !== 0 || legenda.dy !== 0 || movidos > 0;
  const camadasDaTela: { id: Camada; nome: string; detalhe: string; tem: boolean }[] = [
    {
      id: 'legenda',
      nome: 'Legenda',
      detalhe: legendaMovida
        ? movidos
          ? `${movidos} ${movidos === 1 ? 'trecho movido' : 'trechos movidos'}`
          : 'Movida no vídeo todo'
        : 'No lugar automático',
      tem: d.legendas.length > 0,
    },
    {
      id: 'titulo',
      nome: 'Título de abertura',
      detalhe: !d.titulo
        ? 'Este vídeo não tem'
        : camadas.titulo.dx || camadas.titulo.dy
          ? 'Movido'
          : 'No lugar automático',
      tem: !!d.titulo,
    },
    {
      id: 'animacoes',
      nome: 'Animações',
      detalhe: !d.animacoes.length
        ? 'Este vídeo não tem'
        : camadas.animacoes.dx || camadas.animacoes.dy
          ? 'Movidas'
          : 'Acima da cabeça',
      tem: d.animacoes.length > 0,
    },
  ];
  const escolher = (c: Camada) => {
    ajuste.setCamada(c);
    if (c === 'titulo' && d.titulo) ajuste.irPara(Math.min(d.titulo.fim - 0.2, 0.8));
    if (c === 'animacoes' && d.animacoes[0]) ajuste.irPara(d.animacoes[0].ini + 0.4);
  };
  const voltar = () => {
    if (camada !== 'legenda') return ajuste.salvar(legenda, { ...camadas, [camada]: { dx: 0, dy: 0 } });
    if (alcance === 'trecho' && ajuste.trecho != null) {
      const { [String(ajuste.trecho)]: _fora, ...resto } = legenda.trechos;
      return ajuste.salvar({ ...legenda, trechos: resto });
    }
    ajuste.salvar({ ...legenda, dx: 0, dy: 0, trechos: {} });
  };
  return (
    <div className="lg-painel">
      <fieldset className="campo">
        <legend>Camadas (escolha uma e arraste no vídeo)</legend>
        <div className="lg-camadas">
          {camadasDaTela.map((c) => (
            <button
              key={c.id}
              type="button"
              className="lg-camada"
              aria-pressed={camada === c.id}
              disabled={!c.tem}
              onClick={() => escolher(c.id)}
            >
              <Icon name="layers" size={18} />
              <span>
                <b>{c.nome}</b>
                <small>{c.detalhe}</small>
              </span>
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="campo">
        <legend>Fonte</legend>
        <div className="lg-fontes">
          {FONTES_LEGENDA.map((f) => (
            <button
              key={f.id}
              type="button"
              className="lg-fonte"
              aria-pressed={legenda.fonte === f.id}
              onClick={() => ajuste.salvar({ ...legenda, fonte: f.id })}
            >
              <span style={{ fontFamily: `${FAMILIA[f.id]}, sans-serif`, fontWeight: f.forte }}>MOTO</span>
              <small>{f.nome}</small>
            </button>
          ))}
        </div>
      </fieldset>
      <div className="campo">
        <label htmlFor={`${id}-tam`}>Tamanho da letra: {Math.round(tamanho * 100)}%</label>
        <input
          id={`${id}-tam`}
          type="range"
          min={0.6}
          max={1.6}
          step={0.05}
          value={tamanho}
          onChange={(e) => {
            const n = Number(e.target.value);
            setTamanho(n);
            ajuste.mostrar({ ...legenda, tamanho: n });
          }}
          onPointerUp={() =>
            tamanho !== (v.opcoes.legenda ?? LEGENDA_PADRAO).tamanho && ajuste.salvar({ ...legenda, tamanho })
          }
          onKeyUp={() =>
            tamanho !== (v.opcoes.legenda ?? LEGENDA_PADRAO).tamanho && ajuste.salvar({ ...legenda, tamanho })
          }
        />
        <span className="campo__dica">
          Na prévia a quebra das linhas é aproximada; no vídeo o editor quebra de novo com a fonte certa.
        </span>
      </div>
      <fieldset className="campo">
        <legend>Cores</legend>
        <div className="lg-cores">
          {d.estilo !== 'balao' && (
            <Cor
              rotulo="Texto"
              valor={legenda.corTexto}
              padrao="#ffffff"
              aoMudar={(c) => ajuste.salvar({ ...legenda, corTexto: c })}
            />
          )}
          {(d.estilo === 'acesa' || d.estilo === 'pilula') && (
            <Cor
              rotulo="Palavra acesa"
              valor={legenda.corAcesa}
              padrao={cores.primaria}
              aoMudar={(c) => ajuste.salvar({ ...legenda, corAcesa: c })}
            />
          )}
          <Cor
            rotulo="Palavras em destaque"
            valor={legenda.corForte}
            padrao={d.estilo === 'balao' ? cores.primaria : cores.destaque}
            aoMudar={(c) => ajuste.salvar({ ...legenda, corForte: c })}
          />
          {d.estilo !== 'balao' && d.estilo !== 'pilula' && (
            <Cor
              rotulo="Contorno"
              valor={legenda.corContorno}
              padrao="#0a0019"
              aoMudar={(c) => ajuste.salvar({ ...legenda, corContorno: c })}
            />
          )}
        </div>
        {(legenda.corTexto || legenda.corAcesa || legenda.corContorno || legenda.corForte) && (
          <button
            type="button"
            className="video__link"
            onClick={() =>
              ajuste.salvar({ ...legenda, corTexto: null, corAcesa: null, corContorno: null, corForte: null })
            }
          >
            Usar as cores da marca
          </button>
        )}
      </fieldset>
      {camada === 'legenda' && (
        <fieldset className="campo">
          <legend>Arrastar vale para</legend>
          <div className="segmentos" role="radiogroup" aria-label="Arrastar vale para">
            {(
              [
                ['trecho', 'Só este trecho'],
                ['tudo', 'O vídeo todo'],
              ] as const
            ).map(([a, rotulo]) => (
              <label key={a} className="segmento">
                <input
                  type="radio"
                  name={`${id}-alcance`}
                  className="pp-sr"
                  checked={alcance === a}
                  onChange={() => ajuste.setAlcance(a)}
                />
                {rotulo}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <Button size="sm" variant="secondary" icon="rotate-ccw" onClick={voltar} disabled={ajuste.salvando}>
        {camada === 'legenda'
          ? alcance === 'trecho' && ajuste.trecho != null
            ? 'Voltar este trecho ao automático'
            : 'Voltar a legenda ao automático'
          : 'Voltar ao automático'}
      </Button>
      <fieldset className="campo">
        <legend>Trechos da legenda (toque para ir até ele)</legend>
        <ul className="lg-trechos">
          {d.legendas.map((l) => (
            <li key={l.k}>
              <button
                type="button"
                aria-pressed={ajuste.trecho === l.k}
                onClick={() => {
                  ajuste.setCamada('legenda');
                  ajuste.setTrecho(l.k);
                  ajuste.irPara(l.ini + 0.05);
                }}
              >
                <span className="mono quieto">{fmtDuracao(l.ini)}</span>
                <span className="lg-trecho-texto">{l.palavras.map((p) => p[0]).join(' ')}</span>
                {legenda.trechos[String(l.k)] && <span className="editora__selo-proposta">movido</span>}
              </button>
            </li>
          ))}
        </ul>
      </fieldset>
      <p className="campo__dica">
        O que você vê é a prévia: o vídeo só muda quando você gerar de novo. Fonte, tamanho e estilo valem
        para o vídeo todo.
      </p>
      <ErroDaApi erro={ajuste.erro} />
    </div>
  );
}
