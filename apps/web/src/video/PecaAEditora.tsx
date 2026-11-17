import {
  type DetalheVideo,
  fmtDuracao,
  juntarPropostas,
  type PropostaDaEditora,
  quandoDaProposta,
  type RespostaDaEditora,
  ROTULO_AREA_PROPOSTA,
} from '@prospeccao/shared/videos';
import { Button, Icon } from '@prospeccao/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../api';
import { ErroDaApi } from '../componentes/Formulario';
import { type DetalheComFila, useRevisao } from './dados';

/**
 * Peça à editora (v161): a conversa da revisão. A pessoa escreve o que quer cortar, refazer ou
 * mudar; a editora devolve as mudanças em itens de marcar. Nada muda até aplicar, e o vídeo só
 * muda ao gerar de novo. A conversa vive na tela (não é guardada): ao recarregar, começa do zero.
 */

export type FalaDaEditora = Fala;
interface Fala {
  id: number;
  de: 'voce' | 'editora';
  texto: string;
  /** O momento apontado no pedido (s do vídeo). */
  em?: number;
  propostas?: PropostaDaEditora[];
  opcoes?: string[];
  marcadas?: string[];
  /** O que a pessoa fez com as propostas. */
  estado?: 'aberta' | 'aplicada' | 'descartada';
}

const EXEMPLOS = [
  'Corta do começo até eu falar “bom dia”',
  'Põe uma lista quando eu falo as vantagens',
  'Mais elementos na tela',
  'Refaz as animações do zero',
  'A música está alta',
];

export function PecaAEditora({
  v,
  tempoDoVideo,
  verNoVideo,
  aoMudarPropostas,
  conversaInicial,
}: {
  v: DetalheVideo;
  /** O segundo em que o vídeo pronto está parado (null: o vídeo não está na tela). */
  tempoDoVideo: () => number | null;
  verNoVideo: (segundo: number) => void;
  /** As propostas em aberto (as abas mostram como proposta até aplicar). */
  aoMudarPropostas?: (p: PropostaDaEditora[]) => void;
  /** Só para a prova visual da tela: a conversa já começada. */
  conversaInicial?: FalaDaEditora[];
}) {
  const id = useId();
  const cliente = useQueryClient();
  const [falas, setFalas] = useState<Fala[]>(conversaInicial ?? []);
  const [texto, setTexto] = useState('');
  const [em, setEm] = useState<number | null>(null);
  const [aplicadas, setAplicadas] = useState(0);
  const fim = useRef<HTMLDivElement>(null);
  const vez = useRef(conversaInicial?.length ?? 0);
  const revisao = useRevisao(v.id);

  const abertas = falas.findLast((f) => f.estado === 'aberta');
  // biome-ignore lint/correctness/useExhaustiveDependencies: avisa as abas só quando a proposta em aberto muda
  useEffect(() => {
    aoMudarPropostas?.(abertas?.propostas?.filter((p) => abertas.marcadas?.includes(p.id)) ?? []);
  }, [abertas?.id, abertas?.marcadas?.join('|')]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: rola para a última fala quando a conversa cresce
  useEffect(() => {
    fim.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [falas.length]);

  const pedir = useMutation({
    mutationFn: (p: {
      texto: string;
      em: number | null;
      historico: { de: 'voce' | 'editora'; texto: string }[];
    }) =>
      api<RespostaDaEditora>(`/videos/${v.id}/pedido`, {
        metodo: 'POST',
        corpo: { texto: p.texto, ...(p.em != null ? { em: p.em } : {}), historico: p.historico },
      }),
    onSuccess: (r) =>
      setFalas((x) => [
        // Uma proposta nova fecha a anterior que ficou sem resposta.
        ...x.map((f) =>
          f.estado === 'aberta' && r.propostas.length ? { ...f, estado: 'descartada' as const } : f,
        ),
        {
          id: ++vez.current,
          de: 'editora',
          texto: r.resposta,
          propostas: r.propostas,
          opcoes: r.opcoes,
          marcadas: r.propostas.map((p) => p.id),
          estado: r.propostas.length ? 'aberta' : undefined,
        },
      ]),
  });
  const gerar = useMutation({
    mutationFn: () => api<DetalheVideo>(`/videos/${v.id}/gerar`, { metodo: 'POST' }),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['videos'] }),
  });
  const desfazer = useMutation({
    mutationFn: () =>
      api<DetalheVideo>(`/videos/${v.id}/pedido/desfazer`, { metodo: 'POST', corpo: { versao: v.versao } }),
    onSuccess: (d) => {
      cliente.setQueryData<DetalheComFila>(['videos', v.id], (x) =>
        x ? { ...x, ...d } : { ...d, naFrente: 0 },
      );
      setAplicadas(0);
      setFalas((x) => [
        ...x,
        {
          id: ++vez.current,
          de: 'editora',
          texto: 'Desfeito: a revisão voltou a como estava antes do pedido.',
        },
      ]);
    },
  });

  const mandar = (frase = texto) => {
    const t = frase.trim();
    if (t.length < 2 || pedir.isPending) return;
    const historico = falas.slice(-6).map((f) => ({ de: f.de, texto: f.texto.slice(0, 800) }));
    setFalas((x) => [...x, { id: ++vez.current, de: 'voce', texto: t, ...(em != null ? { em } : {}) }]);
    pedir.mutate({ texto: t, em, historico });
    setTexto('');
    setEm(null);
  };
  const marcar = (falaId: number, propostaId: string, sim: boolean) =>
    setFalas((x) =>
      x.map((f) =>
        f.id === falaId
          ? {
              ...f,
              marcadas: sim
                ? [...(f.marcadas ?? []), propostaId]
                : (f.marcadas ?? []).filter((m) => m !== propostaId),
            }
          : f,
      ),
    );
  const fechar = (falaId: number, estado: 'aplicada' | 'descartada') =>
    setFalas((x) => x.map((f) => (f.id === falaId ? { ...f, estado } : f)));
  const aplicar = (f: Fala) => {
    const escolhidas = (f.propostas ?? []).filter((p) => f.marcadas?.includes(p.id));
    if (!escolhidas.length) return;
    revisao.mutate(
      { ...juntarPropostas(escolhidas), doPedido: true },
      {
        onSuccess: () => {
          fechar(f.id, 'aplicada');
          setAplicadas(escolhidas.length);
        },
      },
    );
  };
  const apontar = () => {
    const t = tempoDoVideo();
    if (t != null) setEm(Math.round(t * 10) / 10);
  };
  const agora = tempoDoVideo();
  const ocupado = pedir.isPending || revisao.isPending;

  return (
    <section className="editora" aria-label="Peça à editora">
      <header className="editora__topo">
        <Icon name="message-circle" size={18} />
        <span>
          <b>Peça à editora</b>
          <small>Diga com as suas palavras. Nada muda até você aplicar.</small>
        </span>
      </header>
      <div className="editora__conversa" aria-live="polite">
        {falas.length === 0 && (
          <>
            <div className="editora__fala editora__fala--dela">
              <span className="editora__rosto" aria-hidden="true">
                <Icon name="scissors" size={16} />
              </span>
              <p>
                Assista ao vídeo e me diga o que mudar. Eu mexo nos cortes, nas animações, no título, na
                chamada, na legenda e na música, e mostro tudo antes de aplicar.
              </p>
            </div>
            <div className="editora__exemplos">
              <span className="video__secao">Exemplos de pedido</span>
              <div className="editora__chips">
                {EXEMPLOS.map((e) => (
                  <button key={e} type="button" className="editora__chip" onClick={() => setTexto(e)}>
                    {e}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
        {falas.map((f) =>
          f.de === 'voce' ? (
            <p key={f.id} className="editora__fala editora__fala--minha">
              {f.em != null && (
                <span className="editora__marca">
                  <Icon name="map-pin" size={12} /> {fmtDuracao(f.em)}
                </span>
              )}
              {f.texto}
            </p>
          ) : (
            <div key={f.id} className="editora__fala editora__fala--dela">
              <span className="editora__rosto" aria-hidden="true">
                <Icon name="scissors" size={16} />
              </span>
              <div className="editora__corpo">
                <p>{f.texto}</p>
                {!!f.opcoes?.length && f.id === falas.at(-1)?.id && (
                  <div className="editora__chips">
                    {f.opcoes.map((o) => (
                      <button
                        key={o}
                        type="button"
                        className="editora__chip"
                        disabled={ocupado}
                        onClick={() => mandar(o)}
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                )}
                {!!f.propostas?.length && (
                  <ul className="editora__propostas" data-estado={f.estado}>
                    {f.propostas.map((p) => {
                      const marcada = !!f.marcadas?.includes(p.id);
                      return (
                        <li
                          key={p.id}
                          className="editora__proposta"
                          data-area={p.area}
                          data-fora={!marcada || undefined}
                        >
                          <label className="editora__marcar">
                            <input
                              type="checkbox"
                              checked={marcada}
                              disabled={f.estado !== 'aberta' || ocupado}
                              onChange={(e) => marcar(f.id, p.id, e.target.checked)}
                            />
                            <span className="pp-sr">Aplicar: {p.titulo}</span>
                          </label>
                          <div className="editora__proposta-texto">
                            <span className="editora__proposta-cabeca">
                              <b className="editora__area">{ROTULO_AREA_PROPOSTA[p.area]}</b>
                              <span className="mono quieto">{quandoDaProposta(p)}</span>
                              {p.quando != null && (
                                <button
                                  type="button"
                                  className="editora__ver"
                                  onClick={() => verNoVideo(p.quando!)}
                                >
                                  Ver no vídeo
                                </button>
                              )}
                            </span>
                            <strong>{p.titulo}</strong>
                            {p.detalhe && <span className="editora__detalhe">{p.detalhe}</span>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {f.estado === 'aberta' && (
                  <div className="editora__acoes">
                    <Button
                      size="sm"
                      variant="primary"
                      icon="check"
                      onClick={() => aplicar(f)}
                      disabled={ocupado || !f.marcadas?.length}
                    >
                      {f.marcadas?.length === 1
                        ? 'Aplicar 1 mudança'
                        : `Aplicar as ${f.marcadas?.length ?? 0} mudanças`}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => fechar(f.id, 'descartada')}
                      disabled={ocupado}
                    >
                      Descartar
                    </Button>
                  </div>
                )}
                {f.estado === 'aplicada' && <span className="editora__estado">Aplicado.</span>}
                {f.estado === 'descartada' && (
                  <span className="editora__estado">Descartado: nada mudou.</span>
                )}
              </div>
            </div>
          ),
        )}
        {pedir.isPending && (
          <div className="editora__fala editora__fala--dela">
            <span className="editora__rosto" aria-hidden="true">
              <Icon name="scissors" size={16} />
            </span>
            <p className="quieto">Lendo a fala e procurando o trecho…</p>
          </div>
        )}
        <ErroDaApi erro={pedir.error ?? revisao.error ?? desfazer.error ?? gerar.error} />
        {(aplicadas > 0 || v.podeDesfazerPedido) && v.mudancasPendentes && (
          <div className="editora__feito">
            <span className="editora__feito-texto">
              <b>
                {aplicadas > 0
                  ? aplicadas === 1
                    ? '1 mudança aplicada'
                    : `${aplicadas} mudanças aplicadas`
                  : 'Há um pedido aplicado'}
              </b>
              <small>O vídeo que você está vendo ainda é o anterior.</small>
            </span>
            <span className="editora__acoes">
              <Button
                size="sm"
                variant="primary"
                icon="refresh-cw"
                onClick={() => gerar.mutate()}
                disabled={gerar.isPending || ocupado}
              >
                Gerar o vídeo de novo
              </Button>
              {v.podeDesfazerPedido && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon="rotate-ccw"
                  onClick={() => desfazer.mutate()}
                  disabled={desfazer.isPending || ocupado}
                >
                  Desfazer
                </Button>
              )}
            </span>
          </div>
        )}
        <div ref={fim} />
      </div>
      <form
        className="editora__pe"
        onSubmit={(e) => {
          e.preventDefault();
          mandar();
        }}
      >
        <div className="editora__apontar">
          {em != null ? (
            <span className="editora__marca editora__marca--clara">
              <Icon name="map-pin" size={12} /> {fmtDuracao(em)}
              <button type="button" aria-label="Tirar o momento do pedido" onClick={() => setEm(null)}>
                ×
              </button>
            </span>
          ) : (
            <button type="button" className="editora__chip" onClick={apontar} disabled={agora == null}>
              <Icon name="map-pin" size={14} /> Falar deste momento
              {agora != null ? ` (${fmtDuracao(agora)})` : ''}
            </button>
          )}
          <small className="quieto">Pare o vídeo onde quer mexer e toque aqui.</small>
        </div>
        <div className="editora__campo">
          <label htmlFor={`${id}-t`} className="pp-sr">
            O que você quer mudar
          </label>
          <textarea
            id={`${id}-t`}
            rows={2}
            maxLength={600}
            value={texto}
            placeholder="Escreva o que quer cortar, refazer ou mudar…"
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                mandar();
              }
            }}
          />
          <Button
            type="submit"
            size="sm"
            variant="primary"
            icon="send"
            aria-label="Enviar o pedido"
            disabled={ocupado || texto.trim().length < 2}
          />
        </div>
      </form>
    </section>
  );
}

/** As propostas em aberto de uma área, no alto da aba (até aplicar, são só proposta). */
export function PropostasNaAba({
  propostas,
  area,
}: {
  propostas: PropostaDaEditora[];
  area: PropostaDaEditora['area'][];
}) {
  const lista = propostas.filter((p) => area.includes(p.area));
  if (!lista.length) return null;
  return (
    <ul className="editora__na-aba" aria-label="Propostas da editora ainda não aplicadas">
      {lista.map((p) => (
        <li key={p.id}>
          <span className="editora__selo-proposta">Proposta</span>
          <span className="mono quieto">{quandoDaProposta(p)}</span>
          <b>{p.titulo}</b>
        </li>
      ))}
    </ul>
  );
}
