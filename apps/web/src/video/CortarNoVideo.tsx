import { type DetalheVideo, trechosQueFicam } from '@prospeccao/shared/videos';
import { Button, Icon } from '@prospeccao/ui';
import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ErroDaApi } from '../componentes/Formulario';
import { useRevisao } from './dados';

/**
 * v145: cortar direto no vídeo, sem depender da transcrição. O vídeo original toca com a prévia dos
 * cortes (os trechos cortados são pulados na hora); a linha do tempo mostra o que fica e o que sai,
 * os silêncios e as palavras; arraste nela para escolher um trecho (ou marque início e fim no ponto
 * exato do play) e corte ou devolva. O vídeo final muda ao gerar de novo, a prévia muda na hora.
 */

const ZOOMS = [
  { id: 'tudo', rotulo: 'Tudo', seg: 0 },
  { id: '20', rotulo: '20 s', seg: 20 },
  { id: '8', rotulo: '8 s', seg: 8 },
] as const;
type Zoom = (typeof ZOOMS)[number]['id'];

/** 0:10,35 (minuto, segundo e centésimo: o corte é fino). */
export function fmtPreciso(t: number): string {
  const v = Math.max(0, t);
  const m = Math.floor(v / 60);
  const s = Math.floor(v % 60);
  const c = Math.floor((v * 100) % 100);
  return `${m}:${String(s).padStart(2, '0')},${String(c).padStart(2, '0')}`;
}

/** Os trechos que saem (o contrário dos que ficam), para a prévia pular. */
export function trechosQueSaem(total: number, ficam: { inicio: number; fim: number }[]) {
  const fora: { inicio: number; fim: number }[] = [];
  let t = 0;
  for (const f of ficam) {
    if (f.inicio - t > 0.01) fora.push({ inicio: t, fim: f.inicio });
    t = f.fim;
  }
  if (total - t > 0.01) fora.push({ inicio: t, fim: total });
  return fora;
}

export function CortarNoVideo(props: {
  v: DetalheVideo;
  url: string;
  /** Um corte da lista pediu "Ajustar": o trecho já vem escolhido. */
  pedido: { inicio: number; fim: number; vez: number } | null;
}) {
  const { v } = props;
  const revisao = useRevisao(v.id);
  const video = useRef<HTMLVideoElement>(null);
  const trilha = useRef<HTMLDivElement>(null);
  const [t, setT] = useState(0);
  const [tocando, setTocando] = useState(false);
  const [previa, setPrevia] = useState(true);
  const [zoom, setZoom] = useState<Zoom>('20');
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);
  const arrasto = useRef<{ x: number; tempo: number; moveu: boolean } | null>(null);
  // "Ouvir o trecho": toca o original de um ponto a outro, sem pular os cortes.
  const ouvirAte = useRef<number | null>(null);
  const [duracaoVideo, setDuracaoVideo] = useState(0);

  const total = v.duracaoOriginal ?? (duracaoVideo || Math.max(1, ...v.cortes.map((c) => c.fim)));
  const ficam = useMemo(() => trechosQueFicam(total, v.cortes), [total, v.cortes]);
  const saem = useMemo(() => trechosQueSaem(total, ficam), [total, ficam]);
  const editado = ficam.reduce((s, f) => s + (f.fim - f.inicio), 0);

  // A janela visível da linha do tempo: tudo, ou 20 s / 8 s acompanhando o play.
  const larguraJanela = ZOOMS.find((z) => z.id === zoom)!.seg || total;
  const [inicioJanela, setInicioJanela] = useState(0);
  useEffect(() => {
    if (larguraJanela >= total) return setInicioJanela(0);
    setInicioJanela((j) => {
      if (t < j || t > j + larguraJanela * 0.85)
        return Math.max(0, Math.min(total - larguraJanela, t - larguraJanela * 0.3));
      return j;
    });
  }, [t, larguraJanela, total]);
  const j0 = larguraJanela >= total ? 0 : inicioJanela;
  const j1 = j0 + Math.min(larguraJanela, total);
  const pct = (x: number) => `${((Math.max(j0, Math.min(j1, x)) - j0) / (j1 - j0)) * 100}%`;
  const largura = (a: number, b: number) =>
    `${((Math.max(j0, Math.min(j1, b)) - Math.max(j0, Math.min(j1, a))) / (j1 - j0)) * 100}%`;

  // O pedido de "Ajustar" vindo da lista de cortes.
  useEffect(() => {
    if (!props.pedido) return;
    // Só abrir o editor (sem trecho): fica como está.
    if (props.pedido.fim - props.pedido.inicio < 0.05) return;
    setSel({ a: props.pedido.inicio, b: props.pedido.fim });
    setZoom('8');
    const el = video.current;
    if (el) {
      el.pause();
      el.currentTime = Math.max(0, props.pedido.inicio - 1);
      setT(el.currentTime);
    }
  }, [props.pedido]);

  // O play: acompanha o tempo (liso, por quadro) e, na prévia, pula os trechos cortados.
  useEffect(() => {
    if (!tocando) return;
    let id = 0;
    const passo = () => {
      const el = video.current;
      if (!el) return;
      const agora = el.currentTime;
      if (ouvirAte.current != null && agora >= ouvirAte.current) {
        el.pause();
        ouvirAte.current = null;
      } else if (previa && ouvirAte.current == null) {
        const dentro = saem.find((s) => agora >= s.inicio && agora < s.fim - 0.02);
        if (dentro) el.currentTime = Math.min(total, dentro.fim + 0.005);
      }
      setT(el.currentTime);
      id = requestAnimationFrame(passo);
    };
    id = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(id);
  }, [tocando, previa, saem, total]);

  const ir = useCallback(
    (x: number) => {
      const el = video.current;
      if (!el) return;
      el.currentTime = Math.max(0, Math.min(total, x));
      setT(el.currentTime);
    },
    [total],
  );
  const alternar = () => {
    const el = video.current;
    if (!el) return;
    ouvirAte.current = null;
    if (el.paused) {
      // Na prévia, começar dentro de um corte já pula para depois dele.
      if (previa) {
        const dentro = saem.find((s) => el.currentTime >= s.inicio && el.currentTime < s.fim - 0.02);
        if (dentro) el.currentTime = dentro.fim + 0.005;
      }
      void el.play().catch(() => undefined);
    } else el.pause();
  };
  const ouvirTrecho = () => {
    const el = video.current;
    if (!el || !sel) return;
    const a = Math.min(sel.a, sel.b);
    const b = Math.max(sel.a, sel.b);
    el.currentTime = Math.max(0, a - 0.8);
    ouvirAte.current = Math.min(total, b + 0.8);
    void el.play().catch(() => undefined);
  };
  const tempoDoPonto = (clientX: number) => {
    const r = trilha.current!.getBoundingClientRect();
    return j0 + ((clientX - r.left) / r.width) * (j1 - j0);
  };
  const baixar = (e: PointerEvent<HTMLDivElement>) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    arrasto.current = { x: e.clientX, tempo: tempoDoPonto(e.clientX), moveu: false };
  };
  const mover = (e: PointerEvent<HTMLDivElement>) => {
    const d = arrasto.current;
    if (!d) return;
    if (!d.moveu && Math.abs(e.clientX - d.x) < 4) return;
    d.moveu = true;
    setSel({ a: d.tempo, b: tempoDoPonto(e.clientX) });
  };
  const soltar = (e: PointerEvent<HTMLDivElement>) => {
    const d = arrasto.current;
    arrasto.current = null;
    if (!d) return;
    if (!d.moveu) ir(tempoDoPonto(e.clientX));
    else setSel((s) => (s && Math.abs(s.b - s.a) < 0.05 ? null : s));
  };
  const marcar = (lado: 'a' | 'b') =>
    setSel((s) => {
      const outro = s
        ? lado === 'a'
          ? s.b
          : s.a
        : lado === 'a'
          ? Math.min(total, t + 1)
          : Math.max(0, t - 1);
      return lado === 'a' ? { a: t, b: outro } : { a: outro, b: t };
    });
  const ajustar = (lado: 'a' | 'b', d: number) =>
    setSel((s) => {
      if (!s) return s;
      const ini = Math.min(s.a, s.b);
      const fim = Math.max(s.a, s.b);
      return lado === 'a'
        ? { a: Math.max(0, Math.min(fim - 0.05, ini + d)), b: fim }
        : { a: ini, b: Math.min(total, Math.max(ini + 0.05, fim + d)) };
    });
  const teclas = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('input, select, textarea')) return;
    const passo = e.shiftKey ? 1 : 0.1;
    if (e.key === ' ') alternar();
    else if (e.key === 'ArrowLeft') ir(t - passo);
    else if (e.key === 'ArrowRight') ir(t + passo);
    else if (e.key.toLowerCase() === 'i') marcar('a');
    else if (e.key.toLowerCase() === 'o') marcar('b');
    else if (e.key === 'Escape') setSel(null);
    else return;
    e.preventDefault();
  };

  const a = sel ? Math.min(sel.a, sel.b) : 0;
  const b = sel ? Math.max(sel.a, sel.b) : 0;
  const temCorteDentro = !!sel && saem.some((s) => s.fim > a && s.inicio < b);
  const temFalaDentro = !!sel && ficam.some((f) => f.fim > a && f.inicio < b);
  const aplicar = (acao: 'cortar' | 'devolver') => {
    if (!sel || b - a < 0.05) return;
    revisao.mutate(
      { trechos: [{ acao, inicio: Math.round(a * 1000) / 1000, fim: Math.round(b * 1000) / 1000 }] },
      {
        onSuccess: () => {
          setSel(null);
          // Volta um pouco antes do trecho para ouvir como ficou.
          ir(Math.max(0, a - 1.5));
        },
      },
    );
  };
  const palavrasVisiveis = j1 - j0 <= 20 ? v.palavras.filter((p) => p.f > j0 && p.i < j1).slice(0, 120) : [];
  const silencios = (v.silencios ?? []).filter((s) => s.fim > j0 && s.inicio < j1);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: os atalhos de teclado valem na área do editor
    <div className="cortar" onKeyDown={teclas}>
      <div className="cortar__video">
        {/* biome-ignore lint/a11y/useMediaCaption: é o vídeo original, para cortar; a legenda vem na edição */}
        <video
          ref={video}
          src={props.url}
          playsInline
          preload="auto"
          onPlay={() => setTocando(true)}
          onPause={() => {
            setTocando(false);
            if (video.current) setT(video.current.currentTime);
          }}
          onLoadedMetadata={(e) => setDuracaoVideo(e.currentTarget.duration || 0)}
          onClick={alternar}
        />
      </div>

      <div className="cortar__controles">
        <Button size="sm" variant="primary" icon={tocando ? 'pause' : 'play'} onClick={alternar}>
          {tocando ? 'Pausar' : 'Tocar'}
        </Button>
        <button
          type="button"
          className="botao-icone"
          title="Voltar 0,1 s (←)"
          aria-label="Voltar 0,1 s"
          onClick={() => ir(t - 0.1)}
        >
          −0,1
        </button>
        <button
          type="button"
          className="botao-icone"
          title="Avançar 0,1 s (→)"
          aria-label="Avançar 0,1 s"
          onClick={() => ir(t + 0.1)}
        >
          +0,1
        </button>
        <span className="mono cortar__tempo">
          {fmtPreciso(t)} <span className="quieto">/ {fmtPreciso(total)}</span>
        </span>
        <label className="opcao cortar__previa">
          <input type="checkbox" checked={previa} onChange={(e) => setPrevia(e.target.checked)} />
          <span>Prévia com os cortes</span>
        </label>
        <span className="cortar__zoom" role="radiogroup" aria-label="Zoom da linha do tempo">
          {ZOOMS.map((z) => (
            <label key={z.id} className="cards__chip" data-ativo={zoom === z.id || undefined}>
              <input
                type="radio"
                name={`cortar-zoom-${v.id}`}
                className="pp-sr"
                checked={zoom === z.id}
                onChange={() => setZoom(z.id)}
              />
              {z.rotulo}
            </label>
          ))}
        </span>
      </div>

      <div
        ref={trilha}
        className="cortar__trilha"
        role="slider"
        tabIndex={0}
        aria-label="Linha do tempo: clique para ir, arraste para escolher o trecho"
        aria-valuemin={0}
        aria-valuemax={Math.round(total * 10) / 10}
        aria-valuenow={Math.round(t * 10) / 10}
        aria-valuetext={fmtPreciso(t)}
        onPointerDown={baixar}
        onPointerMove={mover}
        onPointerUp={soltar}
      >
        {ficam
          .filter((f) => f.fim > j0 && f.inicio < j1)
          .map((f) => (
            <span
              key={`f${f.inicio}`}
              className="cortar__fica"
              style={{ left: pct(f.inicio), width: largura(f.inicio, f.fim) }}
            />
          ))}
        {saem
          .filter((s) => s.fim > j0 && s.inicio < j1)
          .map((s) => (
            <span
              key={`s${s.inicio}`}
              className="cortar__sai"
              style={{ left: pct(s.inicio), width: largura(s.inicio, s.fim) }}
            />
          ))}
        {silencios.map((s) => (
          <span
            key={`q${s.inicio}`}
            className="cortar__silencio"
            style={{ left: pct(s.inicio), width: largura(s.inicio, s.fim) }}
          />
        ))}
        {palavrasVisiveis.map((p, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: a posição na janela basta
            key={i}
            className="cortar__palavra"
            style={{ left: pct(p.i), width: largura(p.i, p.f) }}
            title={p.t}
          >
            {p.t}
          </span>
        ))}
        {sel && <span className="cortar__sel" style={{ left: pct(a), width: largura(a, b) }} />}
        <span className="cortar__agulha" style={{ left: pct(t) }} />
      </div>
      <div className="cortar__escala mono quieto" aria-hidden="true">
        <span>{fmtPreciso(j0)}</span>
        <span>{fmtPreciso((j0 + j1) / 2)}</span>
        <span>{fmtPreciso(j1)}</span>
      </div>
      <p className="cortar__legenda quieto">
        <span className="cortar__amostra cortar__amostra--fica" /> fica
        <span className="cortar__amostra cortar__amostra--sai" /> sai
        <span className="cortar__amostra cortar__amostra--silencio" /> silêncio
        <span className="cortar__amostra cortar__amostra--sel" /> trecho escolhido · editado{' '}
        <b className="mono">{fmtPreciso(editado)}</b>
      </p>

      <div className="cortar__barra" aria-live="polite">
        {sel ? (
          <>
            <span className="cortar__trecho mono">
              <span className="cortar__ponta">
                <button
                  type="button"
                  className="botao-icone"
                  aria-label="Início 0,05 s antes"
                  onClick={() => ajustar('a', -0.05)}
                >
                  ‹
                </button>
                {fmtPreciso(a)}
                <button
                  type="button"
                  className="botao-icone"
                  aria-label="Início 0,05 s depois"
                  onClick={() => ajustar('a', 0.05)}
                >
                  ›
                </button>
              </span>
              →
              <span className="cortar__ponta">
                <button
                  type="button"
                  className="botao-icone"
                  aria-label="Fim 0,05 s antes"
                  onClick={() => ajustar('b', -0.05)}
                >
                  ‹
                </button>
                {fmtPreciso(b)}
                <button
                  type="button"
                  className="botao-icone"
                  aria-label="Fim 0,05 s depois"
                  onClick={() => ajustar('b', 0.05)}
                >
                  ›
                </button>
              </span>
              <span className="quieto">({(b - a).toFixed(2).replace('.', ',')} s)</span>
            </span>
            <span className="cortar__acoes">
              <Button size="sm" variant="secondary" icon="play" onClick={ouvirTrecho}>
                Ouvir o trecho
              </Button>
              {temFalaDentro && (
                <Button
                  size="sm"
                  variant="primary"
                  icon="scissors"
                  onClick={() => aplicar('cortar')}
                  disabled={revisao.isPending}
                >
                  Cortar este trecho
                </Button>
              )}
              {temCorteDentro && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => aplicar('devolver')}
                  disabled={revisao.isPending}
                >
                  Devolver este trecho
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setSel(null)}>
                Limpar
              </Button>
            </span>
          </>
        ) : (
          <span className="quieto">
            Arraste na linha do tempo para escolher o trecho, ou use <b>Marcar início</b> e <b>Marcar fim</b>{' '}
            no ponto do play.
          </span>
        )}
        <span className="cortar__marcar">
          <Button size="sm" variant="ghost" onClick={() => marcar('a')}>
            Marcar início (I)
          </Button>
          <Button size="sm" variant="ghost" onClick={() => marcar('b')}>
            Marcar fim (O)
          </Button>
        </span>
      </div>
      <p className="campo__dica">
        Atalhos: espaço toca e pausa, ← e → andam 0,1 s (com Shift, 1 s), I e O marcam o início e o fim. A
        prévia já pula os cortes; o vídeo pronto muda ao clicar em "Gerar de novo com as mudanças".
      </p>
      <ErroDaApi erro={revisao.error} />
    </div>
  );
}
