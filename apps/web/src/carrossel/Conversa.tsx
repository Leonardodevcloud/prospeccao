import type { No, SlideCarrossel } from '@prospeccao/shared/carrosseis';
import {
  ALCANCES_CONVERSA,
  type AlcanceConversa,
  aplicarProposta,
  type EstadoCarrossel,
  type MensagemConversa,
  mudancasEntre,
  mudouDesdeOPedido,
  PEDIDO_RAPIDO,
  PEDIDOS_RAPIDOS,
  type PedidoRapido,
  ROTULO_ALCANCE,
} from '@prospeccao/shared/carrosseis-time';
import { Badge, Button, Icon } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { SlideHtml } from './SlideHtml';

/**
 * A conversa com o time de IA no editor: a pessoa diz o que mudar (um slide, o carrossel inteiro
 * ou a legenda) e o time responde com a proposta montada. Nada muda no carrossel até a pessoa
 * aplicar; depois de aplicar, dá para desfazer.
 */

export interface PedidoConversa {
  alcance: AlcanceConversa;
  slideId: string | null;
  texto: string;
  rapido: PedidoRapido | null;
}

const pensando = (m: MensagemConversa[] | undefined) => !!m?.some((x) => x.situacao === 'pensando');

/** A conversa do carrossel e as ações (o editor usa nos dois lugares: a aba e o atalho do slide). */
export function useConversaComOTime(carrosselId: number, ligado: boolean) {
  const cliente = useQueryClient();
  const chave = ['carrosseis', 'conversa', carrosselId];
  const q = useQuery({
    queryKey: chave,
    queryFn: () => api<{ mensagens: MensagemConversa[] }>(`/carrosseis/${carrosselId}/conversa`),
    enabled: ligado,
    refetchInterval: (x) => (pensando(x.state.data?.mensagens) ? 2000 : false),
  });
  const pedir = useMutation({
    mutationFn: (p: PedidoConversa & { estado: EstadoCarrossel & { estilo: string } }) =>
      api<{ pessoa: MensagemConversa; time: MensagemConversa }>(`/carrosseis/${carrosselId}/conversa`, {
        metodo: 'POST',
        corpo: {
          alcance: p.alcance,
          slideId: p.alcance === 'slide' ? p.slideId : null,
          texto: p.texto,
          rapido: p.alcance === 'slide' ? p.rapido : null,
          slides: p.estado.slides,
          legenda: p.estado.legenda,
          estilo: p.estado.estilo,
        },
      }),
    onSuccess: (r) =>
      cliente.setQueryData<{ mensagens: MensagemConversa[] }>(chave, (x) => ({
        mensagens: [...(x?.mensagens ?? []), r.pessoa, r.time],
      })),
  });
  const decidir = useMutation({
    mutationFn: (p: { id: number; acao: 'aplicar' | 'descartar' | 'desfazer' }) =>
      api<MensagemConversa>(`/carrosseis/${carrosselId}/conversa/${p.id}`, {
        metodo: 'POST',
        corpo: { acao: p.acao },
      }),
    onSuccess: (m) =>
      cliente.setQueryData<{ mensagens: MensagemConversa[] }>(chave, (x) => ({
        mensagens: (x?.mensagens ?? []).map((y) => (y.id === m.id ? m : y)),
      })),
    onError: () => cliente.invalidateQueries({ queryKey: chave }),
  });
  const mensagens = q.data?.mensagens ?? [];
  return {
    mensagens,
    carregando: q.isLoading,
    pensando: pensando(mensagens),
    aberta: mensagens.find((m) => m.situacao === 'proposta') ?? null,
    pedir,
    decidir,
  };
}
export type ConversaDoEditor = ReturnType<typeof useConversaComOTime>;

/* ───────────────────────────── O atalho no slide ───────────────────────────── */

/** "Pedir ao time" na aba do slide: o pedido vai para a conversa (e a tela abre a conversa). */
export function PedirAoTime(props: {
  conversa: ConversaDoEditor;
  indice: number;
  aoPedir: (p: { texto: string; rapido: PedidoRapido | null }) => void;
}) {
  const [texto, setTexto] = useState('');
  const { pensando: ocupado, aberta } = props.conversa;
  const bloqueado = ocupado || !!aberta || props.conversa.pedir.isPending;
  const mandar = (rapido: PedidoRapido | null) => {
    props.aoPedir({ texto: rapido ? '' : texto.trim(), rapido });
    setTexto('');
  };
  return (
    <section className="pedir-redator" aria-labelledby="pt-titulo">
      <h3 id="pt-titulo" className="pedir-redator__titulo">
        <Icon name="sparkles" size={14} /> Pedir ao time · slide {props.indice + 1}
      </h3>
      <div className="pedir-redator__rapidos">
        {PEDIDOS_RAPIDOS.map((r) => (
          <Button key={r} size="sm" variant="secondary" onClick={() => mandar(r)} disabled={bloqueado}>
            {PEDIDO_RAPIDO[r].rotulo}
          </Button>
        ))}
      </div>
      <div className="pedir-redator__livre">
        <label className="pp-sr" htmlFor="pt-texto">
          O que mudar neste slide
        </label>
        <input
          id="pt-texto"
          className="filtro"
          value={texto}
          maxLength={800}
          placeholder="Ou diga o que mudar (ex.: cite a garantia de 6 meses)"
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && texto.trim().length >= 3 && !bloqueado) {
              e.preventDefault();
              mandar(null);
            }
          }}
        />
        <Button
          size="sm"
          variant="ghost"
          icon="send"
          aria-label="Pedir ao time"
          onClick={() => mandar(null)}
          disabled={bloqueado || texto.trim().length < 3}
        />
      </div>
      {(ocupado || aberta) && (
        <p className="quieto">
          {ocupado ? 'O time está respondendo na Conversa.' : 'Há uma proposta esperando na Conversa.'}
        </p>
      )}
    </section>
  );
}

/* ───────────────────────────── A aba da conversa ───────────────────────────── */

export function ConversaComOTime(props: {
  conversa: ConversaDoEditor;
  estado: EstadoCarrossel & { estilo: string };
  slideAtual: { id: string; indice: number };
  /** O alcance que o atalho do slide escolheu (a aba abre nele). */
  alcanceInicial?: AlcanceConversa;
  desenhar: (slides: SlideCarrossel[]) => No[];
  aoAplicar: (novo: EstadoCarrossel) => void;
  aoVerSlide: (id: string) => void;
}) {
  const { conversa, estado } = props;
  const [alcance, setAlcance] = useState<AlcanceConversa>(props.alcanceInicial ?? 'slide');
  const [texto, setTexto] = useState('');
  const lista = useRef<HTMLOListElement>(null);
  const bloqueado = conversa.pensando || !!conversa.aberta || conversa.pedir.isPending;
  const quantas = conversa.mensagens.length;
  const ultimaSituacao = conversa.mensagens.at(-1)?.situacao;

  // A conversa rola para a última mensagem quando chega uma nova (ou a resposta do time).
  // biome-ignore lint/correctness/useExhaustiveDependencies: rola quando muda a conversa.
  useEffect(() => {
    const l = lista.current;
    if (l) l.scrollTop = l.scrollHeight;
  }, [quantas, ultimaSituacao]);

  const mandar = () => {
    if (texto.trim().length < 3 || bloqueado) return;
    conversa.pedir.mutate(
      { alcance, slideId: props.slideAtual.id, texto: texto.trim(), rapido: null, estado },
      { onSuccess: () => setTexto('') },
    );
  };

  const aplicar = (m: MensagemConversa) => {
    if (
      mudouDesdeOPedido(m, estado) &&
      !window.confirm(
        m.alcance === 'carrossel'
          ? 'Você mexeu no carrossel depois de pedir. Aplicar troca o carrossel inteiro pela proposta (o que você mexeu se perde). Aplicar mesmo assim?'
          : `Você mexeu ${m.alcance === 'legenda' ? 'na legenda' : 'neste slide'} depois de pedir. Aplicar troca pelo que o time propôs. Aplicar mesmo assim?`,
      )
    )
      return;
    conversa.decidir.mutate(
      { id: m.id, acao: 'aplicar' },
      { onSuccess: () => props.aoAplicar(aplicarProposta(m, estado)) },
    );
  };
  const desfazer = (m: MensagemConversa) => {
    const mexeuDepois = mudancasEntre(estado, aplicarProposta(m, estado)).length > 0;
    if (
      mexeuDepois &&
      !window.confirm(
        'Você mexeu depois de aplicar. Desfazer volta ao que estava antes do pedido. Desfazer mesmo assim?',
      )
    )
      return;
    conversa.decidir.mutate(
      { id: m.id, acao: 'desfazer' },
      { onSuccess: () => props.aoAplicar(aplicarProposta(m, estado, 'antes')) },
    );
  };
  const ultimaAplicada = [...conversa.mensagens].reverse().find((m) => m.situacao === 'aplicada')?.id;

  return (
    <section className="conversa-time" aria-label="Conversa com o time">
      {conversa.mensagens.length === 0 && !conversa.carregando ? (
        <div className="conversa-time__vazio">
          <p>
            <b>Peça o que precisar.</b> O time responde com a mudança montada; você vê antes e decide se
            aplica.
          </p>
          <ul>
            <li>“Coloque a entrega no mesmo dia no slide 3”</li>
            <li>“Inclua um slide com as 3 marcas que trabalhamos”</li>
            <li>“Deixe a legenda mais curta e termine perguntando”</li>
          </ul>
        </div>
      ) : (
        <ol ref={lista} className="conversa-time__lista">
          {conversa.mensagens.map((m) =>
            m.autor === 'pessoa' ? (
              <li key={m.id} className="conversa-time__pessoa">
                <span className="conversa-time__alcance">
                  {m.alcance === 'slide'
                    ? slideDoPedido(m, conversa.mensagens, estado)
                    : ROTULO_ALCANCE[m.alcance]}
                </span>
                {m.texto}
              </li>
            ) : (
              <li key={m.id} className="conversa-time__time" data-situacao={m.situacao ?? 'resposta'}>
                <RespostaDoTime
                  m={m}
                  desenhar={props.desenhar}
                  decidindo={conversa.decidir.isPending}
                  podeDesfazer={m.id === ultimaAplicada}
                  aoAplicar={() => aplicar(m)}
                  aoDescartar={() => conversa.decidir.mutate({ id: m.id, acao: 'descartar' })}
                  aoDesfazer={() => desfazer(m)}
                  aoVerSlide={props.aoVerSlide}
                />
              </li>
            ),
          )}
        </ol>
      )}
      {conversa.decidir.error && <ErroDaApi erro={conversa.decidir.error} />}

      <div className="conversa-time__pedir">
        <fieldset className="conversa-time__alcances">
          <legend className="pp-sr">O que mudar</legend>
          {ALCANCES_CONVERSA.map((a) => (
            <label key={a} className="conversa-time__alcance-botao">
              <input
                type="radio"
                name="ct-alcance"
                className="pp-sr"
                checked={alcance === a}
                onChange={() => setAlcance(a)}
              />
              {a === 'slide' ? `Slide ${props.slideAtual.indice + 1}` : ROTULO_ALCANCE[a]}
            </label>
          ))}
        </fieldset>
        <label className="pp-sr" htmlFor="ct-texto">
          O que o time deve mudar
        </label>
        <textarea
          id="ct-texto"
          className="filtro conversa-time__texto"
          rows={3}
          maxLength={800}
          value={texto}
          placeholder={
            alcance === 'slide'
              ? `O que mudar no slide ${props.slideAtual.indice + 1}?`
              : alcance === 'legenda'
                ? 'O que mudar na legenda?'
                : 'O que mudar no carrossel? (pode incluir, tirar ou trocar a ordem dos slides)'
          }
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              mandar();
            }
          }}
        />
        <div className="conversa-time__rodape">
          <span className="quieto">
            {conversa.pensando
              ? 'O time está trabalhando…'
              : conversa.aberta
                ? 'Aplique ou descarte a proposta para pedir outra coisa.'
                : 'Enter manda · Shift+Enter quebra a linha'}
          </span>
          <Button size="sm" icon="send" onClick={mandar} disabled={bloqueado || texto.trim().length < 3}>
            Pedir ao time
          </Button>
        </div>
        {conversa.pedir.error && <ErroDaApi erro={conversa.pedir.error} />}
      </div>
    </section>
  );
}

/** "Slide 2" no pedido: a posição que o slide tinha (ou tem agora) no carrossel. */
function slideDoPedido(m: MensagemConversa, todas: MensagemConversa[], estado: EstadoCarrossel): string {
  const resposta = todas.find((x) => x.autor === 'time' && x.id > m.id);
  const lista = resposta?.proposta?.antes.slides ?? estado.slides;
  const i = lista.findIndex((s) => s.id === m.slideId);
  return i >= 0 ? `Slide ${i + 1}` : 'Slide';
}

function RespostaDoTime(props: {
  m: MensagemConversa;
  desenhar: (slides: SlideCarrossel[]) => No[];
  decidindo: boolean;
  podeDesfazer: boolean;
  aoAplicar: () => void;
  aoDescartar: () => void;
  aoDesfazer: () => void;
  aoVerSlide: (id: string) => void;
}) {
  const { m } = props;
  if (m.situacao === 'pensando')
    return (
      <p className="conversa-time__pensando">
        <Icon name="loader" size={14} spin /> O redator está escrevendo; o diretor de arte e o revisor
        conferem em seguida.
      </p>
    );
  if (m.situacao === 'erro') return <Mensagem tipo="erro">{m.texto}</Mensagem>;
  const p = m.proposta;
  const mexidos = new Set(
    m.mudancas.filter((x) => x.tipo === 'mudou' || x.tipo === 'novo').map((x) => x.slideId),
  );
  const desenhos = p ? props.desenhar(p.depois.slides) : [];
  const mostrar = p ? p.depois.slides.map((s, i) => ({ s, i })).filter((x) => mexidos.has(x.s.id)) : [];
  const legendaMudou = m.mudancas.some((x) => x.tipo === 'legenda');
  return (
    <>
      <p className="conversa-time__resposta">{m.texto}</p>
      {p && (
        <div className="conversa-time__proposta">
          <ul className="conversa-time__mudancas">
            {m.mudancas.map((x, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a lista não muda depois de pronta.
              <li key={i}>{x.texto}</li>
            ))}
          </ul>
          {!!mostrar.length && (
            <div className="conversa-time__miniaturas">
              {mostrar.map(({ s, i }) => (
                <figure key={s.id} className="conversa-time__miniatura">
                  <SlideHtml no={desenhos[i]!} largura={112} rotulo={`Slide ${i + 1} proposto`} />
                  <figcaption>Slide {i + 1}</figcaption>
                </figure>
              ))}
            </div>
          )}
          {legendaMudou && <p className="conversa-time__legenda">{p.depois.legenda}</p>}
          {!!m.avisos.length && (
            <ul className="conversa-time__avisos">
              {m.avisos.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
          {m.situacao === 'proposta' ? (
            <div className="conversa-time__acoes">
              <Button size="sm" icon="check" onClick={props.aoAplicar} disabled={props.decidindo}>
                Aplicar
              </Button>
              <Button size="sm" variant="ghost" onClick={props.aoDescartar} disabled={props.decidindo}>
                Descartar
              </Button>
            </div>
          ) : (
            <div className="conversa-time__acoes">
              <Badge tone={m.situacao === 'aplicada' ? 'brand' : 'neutral'}>
                {m.situacao === 'aplicada'
                  ? 'Aplicada'
                  : m.situacao === 'desfeita'
                    ? 'Desfeita'
                    : 'Descartada'}
              </Badge>
              {m.situacao === 'aplicada' && props.podeDesfazer && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon="rotate-ccw"
                  onClick={props.aoDesfazer}
                  disabled={props.decidindo}
                >
                  Desfazer
                </Button>
              )}
              {m.situacao === 'aplicada' && mostrar[0] && (
                <Button size="sm" variant="ghost" onClick={() => props.aoVerSlide(mostrar[0]!.s.id)}>
                  Ver no editor
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
