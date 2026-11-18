import {
  CAPA,
  CAPA_PADRAO,
  type CapaDoVideo,
  type DetalheVideo,
  FONTES_LEGENDA,
  type FonteLegenda,
  fmtDuracao,
  LEGENDA_PADRAO,
  MODELOS_CAPA,
  type ModeloCapa,
} from '@prospeccao/shared/videos';
import { Button } from '@prospeccao/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type PointerEvent as PonteiroReact, useEffect, useId, useRef, useState } from 'react';
import { api } from '../api';
import { ErroDaApi } from '../componentes/Formulario';
import { Cor, FAMILIA } from './AjustarLegenda';
import { enviarCapa, useQuadroDaCapa } from './dados';

/**
 * A capa do vídeo (v170): a pessoa escolhe um quadro do vídeo cortado (sem legenda), escreve o título
 * e o destaque, escolhe o modelo e arrasta o texto. A capa é desenhada aqui, num canvas de
 * 1080 × 1920, e salva sozinha: é ela que vai junto ao publicar o Reels. Não gera o vídeo de novo.
 */

const MARGEM = 72;
const LARGURA_TEXTO = CAPA.largura - MARGEM * 2;
const TAMANHOS = [150, 138, 126, 114, 102, 90, 80, 72];
const TAM_DESTAQUE = 63;
const limitar = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

interface Cores {
  primaria: string;
  destaque: string;
}

/** Texto escuro ou claro, o que ler melhor sobre a cor. */
function sobre(cor: string): string {
  const n = Number.parseInt(cor.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#18181b' : '#ffffff';
}

interface Bloco {
  linhas: string[];
  tam: number;
  destaque: string;
  x: number;
  topo: number;
  altura: number;
}

/** Quebra o título em até 3 linhas no maior tamanho que couber, e diz onde o bloco fica. */
export function blocoDaCapa(
  ctx: CanvasRenderingContext2D,
  a: CapaDoVideo,
  familia: string,
  peso: number,
): Bloco {
  const palavras = a.titulo.trim().toUpperCase().split(/\s+/).filter(Boolean);
  let linhas: string[] = [];
  let tam = TAMANHOS.at(-1)!;
  for (const t of TAMANHOS) {
    ctx.font = `${peso} ${t}px ${familia}`;
    const feitas: string[] = [];
    let atual = '';
    for (const p of palavras) {
      const tenta = atual ? `${atual} ${p}` : p;
      if (atual && ctx.measureText(tenta).width > LARGURA_TEXTO) {
        feitas.push(atual);
        atual = p;
      } else atual = tenta;
    }
    if (atual) feitas.push(atual);
    linhas = feitas;
    tam = t;
    if (feitas.length <= 3 && feitas.every((l) => ctx.measureText(l).width <= LARGURA_TEXTO)) break;
  }
  const destaque = a.destaque.trim().toUpperCase();
  const alturaTitulo = linhas.length * tam * 0.98;
  const alturaDestaque = destaque ? TAM_DESTAQUE + 42 : 0;
  const altura = alturaTitulo + (linhas.length && destaque ? 24 : 0) + alturaDestaque;
  const fimDoPerfil = CAPA.perfilTopo + CAPA.perfilAltura;
  const base =
    a.modelo === 'alto' ? CAPA.perfilTopo + 70 : a.modelo === 'faixa' ? 1150 : fimDoPerfil - 70 - altura;
  return {
    linhas,
    tam,
    destaque,
    x: MARGEM + a.dx,
    topo: limitar(base + a.dy, 40, CAPA.altura - altura - 40),
    altura,
  };
}

/** Desenha a capa inteira (1080 × 1920) no canvas. Devolve o bloco do texto (para as guias). */
export function desenharCapa(
  ctx: CanvasRenderingContext2D,
  foto: CanvasImageSource | null,
  a: CapaDoVideo,
  cores: Cores,
  fonte: FonteLegenda,
): Bloco {
  const { largura: L, altura: A } = CAPA;
  const f = FONTES_LEGENDA.find((x) => x.id === fonte) ?? FONTES_LEGENDA[0];
  const familia = `${FAMILIA[fonte]}, sans-serif`;
  ctx.save();
  ctx.fillStyle = '#18181b';
  ctx.fillRect(0, 0, L, A);
  if (foto) {
    // A foto cobre a capa inteira (corta as sobras, sem esticar).
    const fl = 'videoWidth' in foto ? foto.videoWidth : (foto as HTMLImageElement).naturalWidth || L;
    const fa = 'videoHeight' in foto ? foto.videoHeight : (foto as HTMLImageElement).naturalHeight || A;
    const e = Math.max(L / fl, A / fa);
    ctx.drawImage(foto, (L - fl * e) / 2, (A - fa * e) / 2, fl * e, fa * e);
  }
  const b = blocoDaCapa(ctx, a, familia, f.forte);
  const temTexto = a.modelo !== 'foto' && (b.linhas.length > 0 || !!b.destaque);
  if (!temTexto) {
    ctx.restore();
    return b;
  }
  if (a.modelo === 'faixa') {
    ctx.globalAlpha = 0.94;
    ctx.fillStyle = cores.primaria;
    ctx.fillRect(0, b.topo - 48, L, b.altura + 96);
    ctx.globalAlpha = 1;
  } else {
    // Um escurecido só onde o texto está, para ele ler em qualquer foto.
    const meio = b.topo + b.altura / 2;
    const g = ctx.createLinearGradient(0, meio - 620, 0, meio + 620);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, 'rgba(0,0,0,.62)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, meio - 620, L, 1240);
  }
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.font = `${f.forte} ${b.tam}px ${familia}`;
  ctx.fillStyle = a.corTexto ?? '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,.55)';
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 6;
  b.linhas.forEach((l, k) => {
    ctx.fillText(l, b.x, b.topo + k * b.tam * 0.98 + b.tam * 0.06);
  });
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  if (b.destaque) {
    const y = b.topo + b.linhas.length * b.tam * 0.98 + (b.linhas.length ? 24 : 0);
    let tam = TAM_DESTAQUE;
    ctx.font = `${f.forte} ${tam}px ${familia}`;
    while (tam > 36 && ctx.measureText(b.destaque).width > LARGURA_TEXTO - 66) {
      tam -= 3;
      ctx.font = `${f.forte} ${tam}px ${familia}`;
    }
    const largura = ctx.measureText(b.destaque).width + 66;
    const fundo = a.corDestaque ?? cores.destaque;
    ctx.fillStyle = fundo;
    ctx.beginPath();
    ctx.roundRect(b.x, y, largura, TAM_DESTAQUE + 42, 24);
    ctx.fill();
    ctx.fillStyle = sobre(fundo);
    ctx.fillText(b.destaque, b.x + 33, y + (TAM_DESTAQUE + 42 - tam) / 2 + tam * 0.06);
  }
  ctx.restore();
  return b;
}

const emJpeg = (tela: HTMLCanvasElement) =>
  new Promise<Blob>((ok, falha) =>
    tela.toBlob((b) => (b ? ok(b) : falha(new Error('O navegador não gerou a imagem.'))), 'image/jpeg', 0.9),
  );

function baixar(blob: Blob, nome: string) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = nome;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
}

/** O estado que o palco e o painel dividem. */
export interface AjusteDaCapa {
  capa: CapaDoVideo;
  mudar: (parte: Partial<CapaDoVideo>) => void;
  cores: Cores;
  fonte: FonteLegenda;
  /** Qual quadro está em uso (o guardado ou um ponto do vídeo). */
  quadro: { n: number } | { t: number } | null;
  tela: React.RefObject<HTMLCanvasElement | null>;
  estado: 'parada' | 'salvando' | 'salva';
  erro: unknown;
  /** O palco avisa que a capa foi desenhada de novo com a foto certa (aí pode salvar). */
  desenhada: () => void;
}

export function useCapa(v: DetalheVideo): AjusteDaCapa {
  const cliente = useQueryClient();
  const tela = useRef<HTMLCanvasElement | null>(null);
  const [capa, setCapa] = useState<CapaDoVideo>(v.opcoes.capa ?? CAPA_PADRAO);
  const [estado, setEstado] = useState<'parada' | 'salvando' | 'salva'>(v.capaPropria ? 'salva' : 'parada');
  const [erro, setErro] = useState<unknown>(null);
  const suja = useRef(false);
  const vez = useRef(0);
  const relogio = useRef<ReturnType<typeof setTimeout> | null>(null);
  const atual = useRef(capa);
  atual.current = capa;
  const quadros = v.desenho?.quadros ?? [];
  const quadro =
    capa.segundo != null
      ? { t: capa.segundo }
      : quadros.length
        ? { n: limitar(capa.quadro ?? Math.floor(quadros.length / 3), 0, quadros.length - 1) }
        : null;

  const salvar = async () => {
    const minha = ++vez.current;
    const el = tela.current;
    if (!el) return;
    setEstado('salvando');
    setErro(null);
    try {
      await api<DetalheVideo>(`/videos/${v.id}/capa/ajuste`, { metodo: 'PUT', corpo: atual.current });
      const d = await enviarCapa(v.id, await emJpeg(el));
      // Mudou de novo enquanto salvava: a próxima volta salva a mais nova.
      if (minha !== vez.current) return;
      cliente.setQueryData(['videos', v.id], (antes: object | undefined) => ({ ...antes, ...d }));
      void cliente.invalidateQueries({ queryKey: ['videos', v.id, 'arquivo', 'capa'] });
      void cliente.invalidateQueries({ queryKey: ['videos'], exact: true });
      setEstado('salva');
    } catch (e) {
      if (minha !== vez.current) return;
      setErro(e);
      setEstado('parada');
    }
  };
  const salvarRef = useRef(salvar);
  salvarRef.current = salvar;
  useEffect(
    () => () => {
      if (relogio.current) clearTimeout(relogio.current);
    },
    [],
  );
  return {
    capa,
    mudar: (parte) => {
      suja.current = true;
      setCapa((c) => ({ ...c, ...parte }));
    },
    cores: v.opcoes.cores ?? v.desenho?.cores ?? { primaria: '#7c3aed', destaque: '#facc15' },
    fonte: (v.opcoes.legenda ?? LEGENDA_PADRAO).fonte,
    quadro,
    tela,
    estado,
    erro,
    desenhada: () => {
      if (!suja.current) return;
      suja.current = false;
      if (relogio.current) clearTimeout(relogio.current);
      relogio.current = setTimeout(() => void salvarRef.current(), 900);
    },
  };
}

/* ───────────────────────────── O palco ───────────────────────────── */

function Miniatura(props: { id: number; n: number; t: number; marcada: boolean; aoEscolher: () => void }) {
  const q = useQuadroDaCapa(props.id, { n: props.n });
  return (
    <button
      type="button"
      className="capa__mini"
      aria-pressed={props.marcada}
      aria-label={`Usar o quadro de ${fmtDuracao(props.t)}`}
      onClick={props.aoEscolher}
    >
      {q.data ? <img src={q.data} alt="" /> : null}
      <span>{fmtDuracao(props.t)}</span>
    </button>
  );
}

export function PalcoDaCapa({ v, ajuste }: { v: DetalheVideo; ajuste: AjusteDaCapa }) {
  const id = useId();
  const d = v.desenho;
  const quadros = d?.quadros ?? [];
  const foto = useQuadroDaCapa(v.id, ajuste.quadro);
  const [imagem, setImagem] = useState<HTMLImageElement | null>(null);
  const [bloco, setBloco] = useState<{ topo: number; altura: number } | null>(null);
  const [momento, setMomento] = useState(
    ajuste.capa.segundo ?? Math.round(((d?.duracao ?? 10) / 2) * 10) / 10,
  );
  const inicio = useRef<{ x: number; y: number; dx: number; dy: number; escala: number } | null>(null);
  const { capa, cores, fonte, tela } = ajuste;

  useEffect(() => {
    if (!foto.data) return;
    const img = new Image();
    img.onload = () => setImagem(img);
    img.src = foto.data;
  }, [foto.data]);

  // Desenha de novo a cada mudança (depois de a fonte carregar, para o texto sair na letra certa).
  // biome-ignore lint/correctness/useExhaustiveDependencies: o ajuste inteiro entra pelo `capa`
  useEffect(() => {
    let vale = true;
    const f = FONTES_LEGENDA.find((x) => x.id === fonte) ?? FONTES_LEGENDA[0];
    const desenhar = () => {
      const ctx = tela.current?.getContext('2d');
      if (!vale || !ctx) return;
      const b = desenharCapa(ctx, imagem, capa, cores, fonte);
      setBloco(
        capa.modelo === 'foto' || (!b.linhas.length && !b.destaque)
          ? null
          : { topo: b.topo, altura: b.altura },
      );
      if (imagem) ajuste.desenhada();
    };
    document.fonts
      .load(`${f.forte} 100px ${FAMILIA[fonte]}`)
      .catch(() => undefined)
      .then(desenhar);
    return () => {
      vale = false;
    };
  }, [imagem, capa, cores.primaria, cores.destaque, fonte]);

  if (!quadros.length)
    return (
      <div className="video__player video__player--vazio lg-vazio">
        <p>
          Gere o vídeo de novo uma vez para liberar a capa: o editor passa a guardar quadros do vídeo, sem a
          legenda, para você escolher.
        </p>
      </div>
    );

  const aoPegar = (e: PonteiroReact<HTMLCanvasElement>) => {
    if (capa.modelo === 'foto') return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    inicio.current = {
      x: e.clientX,
      y: e.clientY,
      dx: capa.dx,
      dy: capa.dy,
      escala: e.currentTarget.clientWidth / CAPA.largura,
    };
  };
  const aoMover = (e: PonteiroReact<HTMLCanvasElement>) => {
    const i = inicio.current;
    if (!i) return;
    let dx = i.dx + (e.clientX - i.x) / i.escala;
    if (Math.abs(dx) < 16) dx = 0;
    ajuste.mudar({
      dx: Math.round(limitar(dx, -400, 400)),
      dy: Math.round(limitar(i.dy + (e.clientY - i.y) / i.escala, -1400, 1400)),
    });
  };
  const aoSoltar = () => {
    inicio.current = null;
  };
  const fimDoPerfil = CAPA.perfilTopo + CAPA.perfilAltura;
  const fora = !!bloco && (bloco.topo < CAPA.perfilTopo || bloco.topo + bloco.altura > fimDoPerfil);
  const marcado = 'n' in (ajuste.quadro ?? {}) ? (ajuste.quadro as { n: number }).n : -1;

  return (
    <div className="capa">
      <div className="capa__palco">
        <div className="capa__moldura">
          <canvas
            ref={tela}
            width={CAPA.largura}
            height={CAPA.altura}
            className="capa__tela"
            data-arrasta={capa.modelo !== 'foto' || undefined}
            aria-label="A capa do vídeo. Arraste para mudar o texto de lugar."
            onPointerDown={aoPegar}
            onPointerMove={aoMover}
            onPointerUp={aoSoltar}
            onPointerCancel={aoSoltar}
          />
          <div className="capa__perfil" aria-hidden="true">
            <span>entre as linhas: o que aparece no seu perfil</span>
          </div>
          {foto.isLoading && <span className="capa__carregando">Abrindo o quadro…</span>}
        </div>
        <div className="capa__quadros">
          <span className="capa__rotulo">Quadro da capa</span>
          <div className="capa__minis">
            {quadros.map((q, n) => (
              <Miniatura
                key={q.t}
                id={v.id}
                n={n}
                t={q.t}
                marcada={capa.segundo == null && marcado === n}
                aoEscolher={() => ajuste.mudar({ quadro: n, segundo: null })}
              />
            ))}
          </div>
        </div>
      </div>
      {d?.temVideo && d.duracao ? (
        <div className="campo capa__momento">
          <label htmlFor={`${id}-momento`}>Outro momento do vídeo: {fmtDuracao(momento)}</label>
          <div className="capa__momento-linha">
            <input
              id={`${id}-momento`}
              type="range"
              min={0.2}
              max={Math.max(0.4, d.duracao - 0.2)}
              step={0.1}
              value={momento}
              onChange={(e) => setMomento(Number(e.target.value))}
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => ajuste.mudar({ segundo: momento, quadro: null })}
            >
              Usar este momento
            </Button>
          </div>
          <span className="campo__dica">
            Sai menos nítido que os quadros sugeridos (vem da prévia do vídeo, que é menor).
          </span>
        </div>
      ) : null}
      <p className="campo__dica capa__aviso" data-alerta={fora || undefined} aria-live="polite">
        {fora
          ? 'O texto saiu das linhas tracejadas: no perfil ele vai aparecer cortado.'
          : capa.modelo === 'foto'
            ? 'Capa só com a foto. Escolha outro modelo para pôr o texto.'
            : 'Arraste o texto na capa para mudar de lugar. Entre as linhas tracejadas, o perfil não corta.'}
      </p>
      <ErroDaApi erro={foto.error} />
    </div>
  );
}

/* ───────────────────────────── O painel ───────────────────────────── */

const DESENHO_DO_MODELO: Record<ModeloCapa, string> = {
  embaixo: 'O texto na parte de baixo',
  alto: 'O texto na parte de cima',
  faixa: 'O texto sobre uma faixa na cor da marca',
  foto: 'Sem texto',
};

export function PainelDaCapa({ v, ajuste }: { v: DetalheVideo; ajuste: AjusteDaCapa }) {
  const id = useId();
  const cliente = useQueryClient();
  const { capa, cores } = ajuste;
  const [voltando, setVoltando] = useState(false);
  const [erro, setErro] = useState<unknown>(null);
  if (!v.desenho?.quadros?.length)
    return (
      <p className="campo__dica">
        A capa de hoje é um quadro do começo do vídeo. Gere o vídeo de novo uma vez para escolher o quadro e
        pôr o texto.
      </p>
    );
  const fonte = FONTES_LEGENDA.find((f) => f.id === ajuste.fonte) ?? FONTES_LEGENDA[0];
  const baixarCapa = async (perfil: boolean) => {
    const el = ajuste.tela.current;
    if (!el) return;
    setErro(null);
    try {
      let origem = el;
      if (perfil) {
        origem = document.createElement('canvas');
        origem.width = CAPA.largura;
        origem.height = CAPA.perfilAltura;
        origem
          .getContext('2d')
          ?.drawImage(
            el,
            0,
            CAPA.perfilTopo,
            CAPA.largura,
            CAPA.perfilAltura,
            0,
            0,
            CAPA.largura,
            CAPA.perfilAltura,
          );
      }
      const nome = (v.titulo || 'video')
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase();
      baixar(await emJpeg(origem), `capa-${nome}${perfil ? '-perfil' : ''}.jpg`);
    } catch (e) {
      setErro(e);
    }
  };
  const voltar = async () => {
    setVoltando(true);
    setErro(null);
    try {
      const d = await api<DetalheVideo>(`/videos/${v.id}/capa`, { metodo: 'DELETE' });
      cliente.setQueryData(['videos', v.id], (antes: object | undefined) => ({ ...antes, ...d }));
    } catch (e) {
      setErro(e);
    } finally {
      setVoltando(false);
    }
  };
  return (
    <div className="lg-painel capa__painel">
      <fieldset className="campo">
        <legend>Texto da capa</legend>
        <label htmlFor={`${id}-titulo`}>Título</label>
        <input
          id={`${id}-titulo`}
          className="filtro"
          value={capa.titulo}
          maxLength={48}
          placeholder="Ex.: Moto pra trabalhar"
          onChange={(e) => ajuste.mudar({ titulo: e.target.value })}
        />
        <span className="campo__dica">Até 5 palavras. É o que a pessoa lê em um segundo.</span>
        <label htmlFor={`${id}-destaque`}>Destaque (opcional)</label>
        <input
          id={`${id}-destaque`}
          className="filtro"
          value={capa.destaque}
          maxLength={40}
          placeholder="Ex.: Sem consulta ao SPC"
          onChange={(e) => ajuste.mudar({ destaque: e.target.value })}
        />
        <span className="campo__dica">Vai na etiqueta colorida, embaixo do título.</span>
      </fieldset>
      <fieldset className="campo">
        <legend>Modelo</legend>
        <div className="capa__modelos">
          {MODELOS_CAPA.map((m) => (
            <button
              key={m.id}
              type="button"
              className="capa__modelo"
              aria-pressed={capa.modelo === m.id}
              title={DESENHO_DO_MODELO[m.id]}
              onClick={() => ajuste.mudar({ modelo: m.id, dx: 0, dy: 0 })}
            >
              <span className="capa__modelo-desenho" data-modelo={m.id} aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              {m.nome}
            </button>
          ))}
        </div>
      </fieldset>
      {capa.modelo !== 'foto' && (
        <fieldset className="campo">
          <legend>Cores</legend>
          <div className="lg-cores">
            <Cor
              rotulo="Texto"
              valor={capa.corTexto}
              padrao="#ffffff"
              aoMudar={(c) => ajuste.mudar({ corTexto: c })}
            />
            <Cor
              rotulo="Etiqueta do destaque"
              valor={capa.corDestaque}
              padrao={cores.destaque}
              aoMudar={(c) => ajuste.mudar({ corDestaque: c })}
            />
          </div>
          {(capa.corTexto || capa.corDestaque) && (
            <button
              type="button"
              className="video__link"
              onClick={() => ajuste.mudar({ corTexto: null, corDestaque: null })}
            >
              Usar as cores do vídeo
            </button>
          )}
          <span className="campo__dica">
            Fonte: {fonte.nome}, a mesma da legenda (muda junto quando você troca a fonte da legenda).
          </span>
        </fieldset>
      )}
      <label className="capa__no-video">
        <input
          type="checkbox"
          checked={capa.noVideo}
          onChange={(e) => ajuste.mudar({ noVideo: e.target.checked })}
        />
        <span>
          <b>Começar o vídeo pela capa</b>
          <small>
            A capa aparece por um instante no começo do vídeo. Assim ela é a miniatura no WhatsApp e na
            galeria, e dá para escolher esse quadro como capa ao postar pelo aplicativo do Instagram. Vale no
            próximo "Gerar de novo".
          </small>
        </span>
      </label>
      <div className="capa__acoes">
        <Button variant="primary" icon="download" onClick={() => void baixarCapa(false)}>
          Baixar a capa
        </Button>
        <Button variant="secondary" onClick={() => void baixarCapa(true)}>
          Baixar no recorte do perfil
        </Button>
      </div>
      <p className="campo__dica" aria-live="polite">
        {ajuste.estado === 'salvando'
          ? 'Salvando a capa…'
          : v.capaPropria
            ? `Capa salva. Ao publicar o Reels por aqui, ela vai junto.${
                capa.noVideo && v.mudancasPendentes
                  ? ' Para ela entrar no começo do vídeo, clique em "Gerar de novo com as mudanças".'
                  : ''
              } A imagem baixada tem 1080 × 1920; a do recorte do perfil, 1080 × 1440.`
            : 'A capa é salva sozinha quando você muda alguma coisa. Hoje o vídeo usa um quadro do começo como capa.'}
      </p>
      {v.capaPropria && (
        <button type="button" className="video__link" disabled={voltando} onClick={() => void voltar()}>
          Voltar à capa automática
        </button>
      )}
      <ErroDaApi erro={ajuste.erro ?? erro} />
    </div>
  );
}
