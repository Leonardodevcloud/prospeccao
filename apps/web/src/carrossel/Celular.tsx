import type { PublicacaoCarrossel } from '@prospeccao/shared/carrosseis-publicacao';
import { comNome } from '@prospeccao/shared/instagram';
import { Button } from '@prospeccao/ui';
import { type ReactNode, useEffect, useRef, useState } from 'react';

/**
 * "Ver no celular": as três telas que o cliente vai ver (o post com os slides, os comentários com a
 * resposta e o direct com o botão), com o nome, o @ e a foto da empresa. A moldura e os ícones são
 * da prévia; não aparece número de curtida.
 */

type Tela = 'post' | 'comentarios' | 'direct';

const EXEMPLOS = [
  { usuario: 'maria.exemplo', nome: 'Maria', cor: '#b45309' },
  { usuario: 'joao.exemplo', nome: 'João', cor: '#1e40af' },
];

/* Ícones da barra do post (traço simples). */
const Svg = (props: { children: ReactNode; tamanho?: number }) => (
  <svg
    width={props.tamanho ?? 24}
    height={props.tamanho ?? 24}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.9}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {props.children}
  </svg>
);
const Coracao = () => (
  <Svg>
    <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
  </Svg>
);
const Balao = () => (
  <Svg>
    <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
  </Svg>
);
const Aviao = () => (
  <Svg>
    <path d="m22 2-7 20-4-9-9-4Z" />
    <path d="M22 2 11 13" />
  </Svg>
);
const Salvar = () => (
  <Svg>
    <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
  </Svg>
);
const Voltar = () => (
  <Svg tamanho={22}>
    <path d="m15 18-6-6 6-6" />
  </Svg>
);

export function VerNoCelular(props: {
  carrosselId: number;
  versao: number;
  slides: { id: string }[];
  legenda: string;
  /** Nome da empresa e o @ (do Instagram conectado ou da identidade visual). */
  empresa: string;
  usuario: string;
  foto: string | null;
  publicacao: PublicacaoCarrossel | null;
  aoFechar: () => void;
}) {
  const [tela, setTela] = useState<Tela>('post');
  const [escuro, setEscuro] = useState(false);
  const [i, setI] = useState(0);
  const [mais, setMais] = useState(false);
  const trilho = useRef<HTMLDivElement>(null);
  const painel = useRef<HTMLDivElement>(null);
  const total = props.slides.length;
  const regra = props.publicacao?.regra ?? null;
  const palavra = regra?.palavras[0] ?? props.publicacao?.palavraDoSlide ?? null;
  const ir = (n: number) => {
    const alvo = Math.max(0, Math.min(total - 1, n));
    trilho.current?.scrollTo({ left: alvo * (trilho.current.clientWidth || 0), behavior: 'smooth' });
  };
  const aoFechar = useRef(props.aoFechar);
  aoFechar.current = props.aoFechar;
  useEffect(() => {
    const antes = document.activeElement as HTMLElement | null;
    painel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const t = (e: KeyboardEvent) => {
      if (e.key === 'Escape') aoFechar.current();
    };
    document.addEventListener('keydown', t);
    return () => {
      document.removeEventListener('keydown', t);
      antes?.focus?.();
    };
  }, []);

  const avatar = (tamanho: 'p' | 'm' | 'g') => (
    <span className={`celular__av celular__av--${tamanho}`} aria-hidden="true">
      {props.foto ? (
        <img src={props.foto} alt="" referrerPolicy="no-referrer" />
      ) : (
        (props.empresa || props.usuario || 'A').slice(0, 2).toUpperCase()
      )}
    </span>
  );
  const corte = 125;
  const legenda = props.legenda.trim();

  return (
    <>
      <div className="scrim" onClick={props.aoFechar} aria-hidden="true" />
      <div
        ref={painel}
        className="celular-previa"
        role="dialog"
        aria-modal="true"
        aria-label="Ver no celular"
      >
        <div className="celular-previa__barra">
          <div className="celular-previa__telas" role="tablist" aria-label="Tela">
            {(
              [
                ['post', 'Post'],
                ...(regra
                  ? ([
                      ['comentarios', 'Comentários'],
                      ['direct', 'Direct'],
                    ] as const)
                  : []),
              ] as const
            ).map(([id, rotulo]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tela === id}
                className="celular-previa__tela"
                onClick={() => setTela(id)}
              >
                {rotulo}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="celular-previa__tela"
            aria-pressed={escuro}
            onClick={() => setEscuro((x) => !x)}
          >
            Modo escuro
          </button>
        </div>

        <div className="celular" data-escuro={escuro || undefined}>
          <div className="celular__tela">
            <div className="celular__notch" aria-hidden="true" />
            {tela === 'post' && (
              <>
                <div className="celular__topo">
                  <Voltar />
                  <span className="celular__topo-meio">
                    <small>{props.usuario.toUpperCase()}</small>
                    <b>Publicações</b>
                  </span>
                  <span style={{ width: 22 }} />
                </div>
                <div className="celular__autor">
                  {avatar('m')}
                  <b>{props.usuario}</b>
                </div>
                <div className="celular__midia">
                  <div
                    className="celular__trilho"
                    ref={trilho}
                    onScroll={(e) => {
                      const el = e.currentTarget;
                      setI(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
                    }}
                  >
                    {props.slides.map((x, n) => (
                      <img
                        key={x.id}
                        src={`/api/carrosseis/${props.carrosselId}/slides/${n}?largura=720&v=${props.versao}`}
                        alt={`Slide ${n + 1}`}
                        loading={n < 2 ? 'eager' : 'lazy'}
                      />
                    ))}
                  </div>
                  {total > 1 && (
                    <span className="celular__contador">
                      {i + 1}/{total}
                    </span>
                  )}
                </div>
                <div className="celular__acoes">
                  <Coracao />
                  <button
                    type="button"
                    className="celular__icone"
                    aria-label="Ver comentários"
                    onClick={() => regra && setTela('comentarios')}
                  >
                    <Balao />
                  </button>
                  <Aviao />
                  {total > 1 && (
                    <span className="celular__pontos" aria-hidden="true">
                      {props.slides.map((x, n) => (
                        <span key={x.id} data-atual={n === i || undefined} />
                      ))}
                    </span>
                  )}
                  <span className="celular__espaco" />
                  <Salvar />
                </div>
                <p className="celular__legenda">
                  <b>{props.usuario}</b>{' '}
                  {mais || legenda.length <= corte
                    ? legenda || <i>sem legenda</i>
                    : `${legenda.slice(0, corte).trimEnd()}`}
                  {!mais && legenda.length > corte && (
                    <button type="button" className="celular__mais" onClick={() => setMais(true)}>
                      … mais
                    </button>
                  )}
                </p>
                {regra && (
                  <button type="button" className="celular__ver" onClick={() => setTela('comentarios')}>
                    Ver comentários
                  </button>
                )}
                <small className="celular__quando">Agora</small>
              </>
            )}

            {tela === 'comentarios' && regra && (
              <>
                <div className="celular__titulo">Comentários</div>
                <div className="celular__comentarios">
                  {EXEMPLOS.map((p, n) => (
                    <div key={p.usuario} className="celular__grupo">
                      <div className="celular__comentario">
                        <span
                          className="celular__av celular__av--m"
                          style={{ background: p.cor }}
                          aria-hidden="true"
                        />
                        <span>
                          <b>{p.usuario}</b> <small>{n * 3 + 2} min</small>
                          <span className="celular__texto">{n ? palavra?.toLowerCase() : palavra}</span>
                        </span>
                      </div>
                      {regra.respostas[0] && (
                        <div className="celular__comentario celular__comentario--resposta">
                          {avatar('p')}
                          <span>
                            <b>{props.usuario}</b> <small>{n * 3 + 2} min</small>
                            <span className="celular__texto">{comNome(regra.respostas[0], p.nome)}</span>
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="celular__rodape">
                  <span className="celular__campo">Adicione um comentário…</span>
                </div>
              </>
            )}

            {tela === 'direct' && regra && (
              <>
                <div className="celular__topo celular__topo--direct">
                  <Voltar />
                  {avatar('m')}
                  <span className="celular__topo-nome">
                    <b>{props.empresa}</b>
                    <small>{props.usuario}</small>
                  </span>
                </div>
                <div className="celular__conversa">
                  <small className="celular__hora">Hoje</small>
                  <span className="celular__aviso">Respondeu ao seu comentário em uma publicação</span>
                  <div className="celular__linha">
                    {avatar('p')}
                    <span className="celular__bolha">
                      <span>{comNome(regra.mensagem, EXEMPLOS[0]!.nome)}</span>
                      {regra.entrega !== 'conversa' && regra.botaoTexto && (
                        <span className="celular__botao">{regra.botaoTexto}</span>
                      )}
                    </span>
                  </div>
                </div>
                <div className="celular__rodape">
                  <span className="celular__campo">Mensagem…</span>
                </div>
              </>
            )}
          </div>
        </div>

        <p className="celular-previa__nota">
          {tela === 'post'
            ? 'Arraste para passar os slides.'
            : tela === 'comentarios'
              ? 'Comentários de exemplo com a palavra e a sua resposta.'
              : 'O direct exatamente com o texto e o botão da regra (o {nome} vira o nome de quem comentou).'}
        </p>
        <div className="celular-previa__acoes">
          {tela === 'post' && total > 1 && (
            <>
              <Button
                size="sm"
                variant="secondary"
                icon="chevron-left"
                onClick={() => ir(i - 1)}
                disabled={i === 0}
              >
                Anterior
              </Button>
              <Button
                size="sm"
                variant="secondary"
                iconRight="arrow-right"
                onClick={() => ir(i + 1)}
                disabled={i >= total - 1}
              >
                Próximo
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" icon="x" onClick={props.aoFechar}>
            Fechar
          </Button>
        </div>
      </div>
    </>
  );
}
