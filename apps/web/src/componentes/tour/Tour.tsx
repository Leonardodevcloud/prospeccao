import {
  type CenaTour,
  cenasDoTour,
  frasesDaFala,
  paraFalarNoNavegador,
  varianteDoTour,
} from '@prospeccao/shared/tour';
import { Button, Icon } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { type EstadoOrbe, Orbe } from '../argos/Orbe';
import { useSessao } from '../Sessao';

/**
 * Tour do sistema: no primeiro acesso, um convite; se a pessoa aceitar, o Argos narra uma volta
 * pelas telas reais do que a conta contratou. Cada tela espera a fala terminar; o destaque muda
 * quando a fala chega na palavra marcada e a legenda mostra a frase da vez. Fica em Ajuda › Tour.
 */

export { abrirTour } from './abrir';

interface ConfigTour {
  vozServidor: boolean;
  velocidade: number;
}

const PAUSA_MS = 650;
/** Letras por segundo da fala na velocidade 1 (para a barra e o tempo estimado). */
const LETRAS_SEG = 15;

/** Controla o convite do primeiro acesso e o player (montado uma vez, no Shell). */
export function TourDoSistema(props: { convidar: boolean }) {
  const sessao = useSessao();
  const cliente = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [convite, setConvite] = useState(props.convidar);
  const visto = useMutation({
    mutationFn: () => api('/tour/visto', { metodo: 'POST' }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['sessao'] }),
  });

  useEffect(() => {
    const abrir = () => {
      setConvite(false);
      setAberto(true);
    };
    window.addEventListener('tour:abrir', abrir);
    return () => window.removeEventListener('tour:abrir', abrir);
  }, []);

  const conta = sessao.data?.conta;
  if (!conta || (!convite && !aberto)) return null;
  const ctx = { modulos: conta.modulos, recursos: conta.recursos };
  return (
    <PlayerTour
      ctx={ctx}
      convite={convite && !aberto ? (sessao.data?.nome.split(' ')[0] ?? '') : null}
      aoAssistir={() => {
        setConvite(false);
        setAberto(true);
        visto.mutate();
      }}
      aoFechar={() => {
        if (convite) visto.mutate();
        setConvite(false);
        setAberto(false);
      }}
    />
  );
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function PlayerTour(props: {
  ctx: { modulos: readonly string[]; recursos: readonly string[] };
  /** Primeiro acesso: o convite aparece por cima da tela (com o primeiro nome). */
  convite: string | null;
  aoAssistir: () => void;
  aoFechar: () => void;
}) {
  const cenas = useMemo(() => cenasDoTour(props.ctx), [props.ctx]);
  const variante = varianteDoTour(props.ctx);
  const cfgQ = useQuery({ queryKey: ['tour'], queryFn: () => api<ConfigTour>('/tour'), staleTime: 60_000 });
  const cfg = cfgQ.data;
  const velocidade = cfg?.velocidade ?? 1.1;

  const [i, setI] = useState(0);
  const [tocando, setTocando] = useState(false);
  const [frac, setFrac] = useState(0);
  const [acabou, setAcabou] = useState(false);
  const [navegador, setNavegador] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const analisador = useRef<AnalyserNode | null>(null);
  const proxima = useRef<number | null>(null);
  const seguranca = useRef<number | null>(null);
  const rodada = useRef(0);
  const cena = cenas[i]!;

  const duracao = useCallback(
    (c: CenaTour) => c.fala.length / (LETRAS_SEG * velocidade) + PAUSA_MS / 1000,
    [velocidade],
  );
  const inicioDe = (k: number) => cenas.slice(0, k).reduce((s, c) => s + duracao(c), 0);
  const total = cenas.reduce((s, c) => s + duracao(c), 0);

  const parar = useCallback(() => {
    rodada.current++;
    if (proxima.current) window.clearTimeout(proxima.current);
    if (seguranca.current) window.clearTimeout(seguranca.current);
    audio.current?.pause();
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* sem voz do navegador */
    }
  }, []);

  const terminou = useCallback(
    (de: number) => {
      if (seguranca.current) window.clearTimeout(seguranca.current);
      proxima.current = window.setTimeout(() => {
        if (de + 1 < cenas.length) {
          setI(de + 1);
          setFrac(0);
        } else {
          setTocando(false);
          setAcabou(true);
        }
      }, PAUSA_MS);
    },
    [cenas.length],
  );

  /** Voz do navegador (reserva): frase por frase, porque falas longas são cortadas pelo Chrome. */
  const falarNoNavegador = useCallback(
    (k: number, minha: number) => {
      const c = cenas[k]!;
      const frases = frasesDaFala(c.fala);
      let n = 0;
      const vozes = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('pt'));
      const voz = vozes.find((v) => v.lang === 'pt-BR') ?? vozes[0];
      const seguir = () => {
        if (rodada.current !== minha) return;
        if (n >= frases.length) return terminou(k);
        const f = frases[n]!;
        const u = new SpeechSynthesisUtterance(paraFalarNoNavegador(f.texto));
        u.lang = 'pt-BR';
        u.rate = velocidade;
        if (voz) u.voice = voz;
        setFrac(f.inicio / c.fala.length);
        u.onboundary = (e) => {
          if (rodada.current === minha)
            setFrac((f.inicio + (e.charIndex / u.text.length) * f.texto.length) / c.fala.length);
        };
        // Sem voz instalada, o navegador "termina" na hora: a frase fica na tela o tempo de ser lida.
        const minimo = (f.texto.length / (LETRAS_SEG * velocidade)) * 600;
        const t0 = performance.now();
        u.onend = () => {
          const falta = minimo - (performance.now() - t0);
          window.setTimeout(
            () => {
              n++;
              seguir();
            },
            Math.max(0, falta),
          );
        };
        u.onerror = u.onend;
        window.speechSynthesis.speak(u);
      };
      seguir();
    },
    [cenas, terminou, velocidade],
  );

  // Cada cena: começa a fala (do servidor ou do navegador) e avança quando ela termina.
  useEffect(() => {
    if (!tocando || !cfg) return;
    parar();
    const minha = rodada.current;
    setFrac(0);
    const usarNavegador = navegador || !cfg.vozServidor;
    if (usarNavegador) {
      if (!('speechSynthesis' in window)) {
        // Sem voz nenhuma: o relógio decide (a legenda segue no tempo estimado).
        const t0 = performance.now();
        const d = duracao(cena) * 1000 - PAUSA_MS;
        const passo = () => {
          if (rodada.current !== minha) return;
          const f = (performance.now() - t0) / d;
          setFrac(Math.min(1, f));
          if (f >= 1) terminou(i);
          else requestAnimationFrame(passo);
        };
        requestAnimationFrame(passo);
      } else {
        falarNoNavegador(i, minha);
        // Rede de segurança: se a voz do navegador travar (sem vozes instaladas), segue mesmo assim.
        seguranca.current = window.setTimeout(
          () => rodada.current === minha && terminou(i),
          (duracao(cena) * 2 + 3) * 1000,
        );
      }
      return;
    }
    const a = audio.current!;
    const url = `/api/tour/audio/${cena.id}?v=${variante}`;
    // Voltando da pausa na mesma cena: continua de onde parou.
    const retomar = a.dataset.cena === url && a.currentTime > 0 && !a.ended;
    if (!retomar) {
      a.dataset.cena = url;
      a.src = url;
    }
    a.onended = () => rodada.current === minha && terminou(i);
    a.ontimeupdate = () => {
      if (rodada.current === minha && a.duration > 0) setFrac(a.currentTime / a.duration);
    };
    a.onerror = () => {
      if (rodada.current === minha) setNavegador(true);
    };
    a.play().catch(() => rodada.current === minha && setNavegador(true));
    // A próxima já vai sendo gerada (fica guardada no servidor e no navegador).
    const seguinte = cenas[i + 1];
    if (seguinte?.fala) void fetch(`/api/tour/audio/${seguinte.id}?v=${variante}`).catch(() => undefined);
  }, [tocando, i, cfg, navegador, cena, cenas, variante, parar, terminou, falarNoNavegador, duracao]);

  useEffect(() => () => parar(), [parar]);

  const tocar = () => {
    if (acabou) {
      setAcabou(false);
      setI(0);
    }
    // Volume da fala para a esfera do Argos (só dá para medir depois de um clique).
    if (audio.current && !analisador.current) {
      try {
        const ctxAudio = new AudioContext();
        const fonte = ctxAudio.createMediaElementSource(audio.current);
        const an = ctxAudio.createAnalyser();
        an.fftSize = 256;
        fonte.connect(an);
        an.connect(ctxAudio.destination);
        analisador.current = an;
      } catch {
        /* sem medir o volume: a esfera pulsa sozinha */
      }
    }
    setTocando(true);
  };
  const pausar = () => {
    parar();
    setTocando(false);
  };
  const assistir = () => {
    props.aoAssistir();
    tocar();
  };
  const irPara = (k: number) => {
    setAcabou(false);
    setI(k);
    setFrac(0);
    if (!tocando) tocar();
  };
  const fechar = () => {
    parar();
    props.aoFechar();
  };

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fechar();
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  });

  const nivel = useCallback(() => {
    const an = analisador.current;
    if (!an) return 0.3 + Math.random() * 0.35;
    const buf = new Uint8Array(an.frequencyBinCount);
    an.getByteFrequencyData(buf);
    return Math.min(1, (buf.reduce((s, v) => s + v, 0) / buf.length / 255) * 2.4);
  }, []);
  const estado: EstadoOrbe = tocando ? 'falando' : 'ouvindo';

  // Legenda e destaque pela parte da fala que já foi dita.
  const letra = frac * cena.fala.length;
  const frases = frasesDaFala(cena.fala);
  const legenda = frases.filter((f) => letra >= f.inicio - 1).at(-1)?.texto ?? frases[0]?.texto ?? '';
  const focos = cena.focos ?? [];
  let k = 0;
  focos.forEach((f, j) => {
    const at = cena.fala.indexOf(f.em);
    if (at >= 0 && letra >= at) k = j;
  });
  const foco = focos[k];
  const grande = foco ? foco.r[2] * foco.r[3] > 1800 : true;
  const zoom = foco ? (grande ? 1.04 : 1.12) : 1;
  const pos = acabou ? total : inicioDe(i) + Math.min(1, frac) * duracao(cena);
  const capitulos = cenas.filter((c, j) => cenas.findIndex((x) => x.capitulo === c.capitulo) === j);

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="Tour do sistema">
      <div className="tour__janela">
        <div className="tour__topo">
          <b>Tour do sistema</b>
          <span className="quieto">{cena.capitulo}</span>
          <span className="tour__espaco" />
          <Button size="sm" variant="ghost" icon="x" onClick={fechar} aria-label="Fechar o tour">
            Fechar
          </Button>
        </div>
        <div className="tour__palco">
          {cena.img ? (
            <div
              key={cena.id}
              className="tour__tela"
              style={
                foco
                  ? {
                      transformOrigin: `${foco.r[0] + foco.r[2] / 2}% ${foco.r[1] + foco.r[3] / 2}%`,
                      transform: `scale(${zoom})`,
                    }
                  : undefined
              }
            >
              <img src={`/tour/${cena.img}.webp`} alt={`Tela: ${cena.capitulo}`} />
              {foco && (
                <>
                  <div
                    className="tour__foco"
                    style={{
                      left: `${foco.r[0]}%`,
                      top: `${foco.r[1]}%`,
                      width: `${foco.r[2]}%`,
                      height: `${foco.r[3]}%`,
                    }}
                  />
                  <div
                    className={`tour__rotulo${(foco.embaixo ?? foco.r[1] < 12) ? ' tour__rotulo--embaixo' : ''}`}
                    style={{
                      left: `${Math.min(foco.r[0], 68)}%`,
                      top: `${(foco.embaixo ?? foco.r[1] < 12) ? foco.r[1] + foco.r[3] : foco.r[1]}%`,
                    }}
                  >
                    {foco.rotulo}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div key={cena.id} className="tour__capa">
              <Orbe estado={estado} nivel={nivel} tamanho={200} />
              <h3>{cena.titulo}</h3>
            </div>
          )}
          {cena.img && (
            <div className="tour__narrador">
              <Orbe estado={estado} nivel={nivel} tamanho={56} />
            </div>
          )}
          {(tocando || frac > 0 || acabou) && <p className="tour__legenda">{legenda}</p>}
          {props.convite !== null && (
            <div className="tour__convite" role="document" aria-labelledby="tour-convite-titulo">
              <div className="tour__convite-cabeca">
                <Orbe estado="ouvindo" nivel={() => 0} tamanho={52} />
                <h2 id="tour-convite-titulo">Boas-vindas{props.convite ? `, ${props.convite}` : ''}!</h2>
              </div>
              <p>
                Quer uma volta pelo sistema? Em poucos minutos o Argos mostra o principal e onde fica cada
                coisa. Dá para pular partes ou parar quando quiser.
              </p>
              <div className="tour__convite-acoes">
                <Button variant="primary" icon="play" onClick={assistir}>
                  Assistir agora
                </Button>
                <Button variant="secondary" onClick={fechar}>
                  Pular, vejo depois
                </Button>
              </div>
              <small className="quieto">O tour fica em Ajuda › Tour do sistema para ver quando quiser.</small>
            </div>
          )}
          {props.convite === null && !tocando && !acabou && frac === 0 && (
            <button type="button" className="tour__comecar" onClick={tocar}>
              <Icon name="play" size={22} />
              {i === 0 ? 'Começar' : 'Continuar'}
            </button>
          )}
          {acabou && (
            <div className="tour__fim">
              <Button variant="primary" icon="rotate-ccw" onClick={() => irPara(0)}>
                Assistir de novo
              </Button>
              <Button variant="secondary" onClick={fechar}>
                Fechar
              </Button>
            </div>
          )}
        </div>
        <div className="tour__controles">
          <Button
            size="sm"
            variant="secondary"
            icon={tocando ? 'pause' : 'play'}
            onClick={tocando ? pausar : tocar}
            aria-label={tocando ? 'Pausar' : 'Tocar'}
          />
          <div className="tour__barra">
            {cenas.map((c, j) => (
              <button
                key={c.id}
                type="button"
                className="tour__seg"
                style={{ flex: duracao(c) }}
                onClick={() => irPara(j)}
                aria-label={`Ir para ${c.capitulo}`}
              >
                <i
                  style={{
                    width: `${j < i || acabou ? 100 : j === i ? Math.min(1, frac) * 100 : 0}%`,
                  }}
                />
              </button>
            ))}
          </div>
          <span className="tour__tempo mono">
            {mmss(pos)} / {mmss(total)}
          </span>
        </div>
        <div className="tour__capitulos">
          {capitulos.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`tour__chip${c.capitulo === cena.capitulo ? ' tour__chip--ativo' : ''}`}
              onClick={() => irPara(cenas.indexOf(c))}
            >
              {c.capitulo}
            </button>
          ))}
        </div>
        {/* biome-ignore lint/a11y/useMediaCaption: a legenda da fala aparece no palco */}
        <audio ref={audio} preload="auto" />
      </div>
    </div>
  );
}
