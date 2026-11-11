import {
  ESTILO,
  ESTILOS,
  type EstiloCarrossel,
  FORMATO_PECA,
  FORMATOS_PECA,
  type FormatoPeca,
} from '@prospeccao/shared/carrosseis';
import {
  CHAMADA_FINAL,
  CHAMADAS_FINAIS,
  type ChamadaFinal,
  ETAPA_TIME,
  type FotoDoPedido,
  type LoteCards,
  MAX_CARDS_PEDIDO,
  MAX_PECAS_PEDIDO,
  MAX_VARIACOES_CARD,
  OBJETIVO_CARD,
  OBJETIVOS_CARD,
  type ObjetivoCard,
  PALAVRA_COMENTAR,
  type PerguntaDoTime,
  type RespostaDoTime,
  ROTULO_DIVULGAR,
  type VariacaoCard,
} from '@prospeccao/shared/carrosseis-time';
import { Badge, Button, EmptyState, Icon } from '@prospeccao/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { Modal } from '../componentes/Drawer';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { fmtNumero, fmtQuando } from '../formatar';
import { type SituacaoCarrosseis, useDivulgar, useFotos, useIdentidade } from './dados';
import { FotosDoPedido } from './Imagens';
import { PerguntasDoTime, usePerguntas } from './Perguntas';
import { PreviaDoCard } from './PreviaDoCard';

/**
 * Cards avulsos (v144): peças de um slide só, no feed (4:5) ou no story (9:16). A pessoa diz o que
 * quer, quantos cards e quantas variações de cada; o mesmo time de IA dos carrosséis (cérebro da
 * marca, identidade visual, fontes, revisor) faz tudo. Cada variação abre no editor do carrossel.
 */

interface ListaCards {
  lotes: LoteCards[];
  franquia: SituacaoCarrosseis['franquia'];
  iaLigada: boolean;
}

const andando = (l: LoteCards) =>
  l.situacao === 'fila' || l.situacao === 'trabalhando' || l.trabalhando.length > 0;

export const useCards = () =>
  useQuery({
    queryKey: ['carrosseis', 'cards'],
    queryFn: () => api<ListaCards>('/carrosseis/cards'),
    refetchInterval: (q) => (q.state.data?.lotes.some(andando) ? 4000 : false),
  });

export function AbaCards(props: {
  situacao: SituacaoCarrosseis;
  aoCerebro: () => void;
  aoIdentidade: () => void;
  /** v146: o pedido abre numa janela centralizada; a aba é a biblioteca. */
  novo: boolean;
  aoNovo: () => void;
  aoFecharNovo: () => void;
}) {
  const q = useCards();
  const identidade = useIdentidade();
  return (
    <div className="cards">
      {identidade.data && !identidade.data.salva && (
        <div className="carrosseis__comece" role="note">
          <Icon name="palette" size={18} />
          <span>
            <b>Comece pela identidade visual.</b> Cores, fontes, estilo e logo: os cards saem dela, como os
            carrosséis.
          </span>
          <Button size="sm" variant="secondary" onClick={props.aoIdentidade}>
            Montar a identidade
          </Button>
        </div>
      )}
      {props.novo && (
        <Modal
          titulo="Novos cards"
          subtitulo="Diga ao time o que os cards precisam dizer, quantos quer e quantas variações de cada: saem com as cores, as fontes e a logo da empresa."
          largura="larga"
          aoFechar={props.aoFecharNovo}
        >
          <NovoPedidoDeCards
            situacao={props.situacao}
            aoCerebro={() => {
              props.aoFecharNovo();
              props.aoCerebro();
            }}
            aoPedido={props.aoFecharNovo}
          />
        </Modal>
      )}
      <div className="cards__corpo">
        <div className="cards__lotes">
          {q.isPending ? (
            <div className="esqueleto" style={{ height: 320 }} />
          ) : q.error ? (
            <ErroDaApi erro={q.error} />
          ) : !q.data.lotes.length ? (
            <EmptyState
              icone="layers"
              titulo="Nenhum card ainda"
              texto="Diga ao time o que os cards precisam dizer, quantos quer e quantas variações de cada. Eles saem com as cores, as fontes e a logo da empresa."
              acao={
                <Button variant="primary" icon="plus" onClick={props.aoNovo}>
                  Novos cards
                </Button>
              }
            />
          ) : (
            q.data.lotes.map((l) => <Lote key={l.pedidoId} l={l} />)
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── O pedido ───────────────────────────── */

function Escolhas<T extends string | number>(props: {
  nome: string;
  rotulo: string;
  opcoes: readonly T[];
  valor: T;
  mudar: (v: T) => void;
  texto?: (v: T) => string;
}) {
  return (
    <fieldset className="campo cards__escolhas">
      <legend>{props.rotulo}</legend>
      <div className="cards__chips">
        {props.opcoes.map((o) => (
          <label key={String(o)} className="cards__chip" data-ativo={props.valor === o || undefined}>
            <input
              type="radio"
              name={props.nome}
              className="pp-sr"
              checked={props.valor === o}
              onChange={() => props.mudar(o)}
            />
            {props.texto ? props.texto(o) : String(o)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const QUANTIDADES = [1, 2, 3, 4, 5, 6, 8, MAX_CARDS_PEDIDO] as const;
const VARIACOES = Array.from({ length: MAX_VARIACOES_CARD }, (_, i) => i + 1);

function NovoPedidoDeCards(props: {
  situacao: SituacaoCarrosseis;
  aoCerebro: () => void;
  aoPedido: () => void;
}) {
  const cliente = useQueryClient();
  const divulgar = useDivulgar();
  const fotos = useFotos();
  const identidade = useIdentidade();
  const [assunto, setAssunto] = useState('');
  const [divulgarId, setDivulgarId] = useState<number | null>(null);
  const [objetivo, setObjetivo] = useState<ObjetivoCard>('promocao');
  const [quantidade, setQuantidade] = useState(3);
  const [variacoes, setVariacoes] = useState(2);
  const [formato, setFormato] = useState<FormatoPeca>('feed');
  const [estilo, setEstilo] = useState<EstiloCarrossel | null>(null);
  const [chamada, setChamada] = useState<ChamadaFinal>('whatsapp');
  const [palavra, setPalavra] = useState('');
  const [usarFotos, setUsarFotos] = useState(true);
  const [gerarImagens, setGerarImagens] = useState(false);
  const [fotosPedido, setFotosPedido] = useState<FotoDoPedido[]>([]);
  // v148: antes de criar, a estrategista pode perguntar (sem perguntas, cria direto).
  const [perguntas, setPerguntas] = useState<PerguntaDoTime[] | null>(null);
  const perguntar = usePerguntas();
  const pedir = useMutation({
    mutationFn: (respostas: RespostaDoTime[]) =>
      api('/carrosseis/cards', {
        metodo: 'POST',
        corpo: {
          assunto,
          divulgarId,
          objetivo,
          quantidade,
          variacoes,
          formato,
          estilo,
          chamada,
          palavra,
          usarFotos,
          gerarImagens,
          fotos: fotosPedido,
          respostas,
        },
      }),
    onSuccess: () => {
      setAssunto('');
      setFotosPedido([]);
      setPerguntas(null);
      void cliente.invalidateQueries({ queryKey: ['carrosseis', 'cards'] });
      props.aoPedido();
    },
  });
  const { ia, franquia } = props.situacao;
  const itens = divulgar.data?.itens ?? [];
  const pecas = quantidade * variacoes;
  const esgotou = franquia.limite != null && franquia.usados >= franquia.limite;
  const palavraOk = chamada !== 'comentar' || PALAVRA_COMENTAR.test(palavra);
  const nFotos = (fotos.data?.fotos ?? []).filter((f) => f.origem !== 'referencia').length;
  const pode =
    ia.ligada &&
    ia.cerebroConferido &&
    !esgotou &&
    (assunto.trim().length >= 3 || divulgarId != null) &&
    palavraOk &&
    pecas <= MAX_PECAS_PEDIDO;
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (!pode) return;
    perguntar.mutate(
      { tipo: 'cards', assunto, divulgarId, objetivo, chamada, formato, fotos: fotosPedido.length },
      {
        onSuccess: (r) => (r.perguntas.length ? setPerguntas(r.perguntas) : pedir.mutate([])),
        // A pergunta é ajuda: se falhar, o pedido segue sem ela.
        onError: () => pedir.mutate([]),
      },
    );
  };
  const textoCriar = `Criar ${pecas} ${pecas === 1 ? 'peça' : 'peças'} com o time`;
  if (perguntas)
    return (
      <PerguntasDoTime
        perguntas={perguntas}
        criando={pedir.isPending}
        erro={pedir.error}
        textoCriar={textoCriar}
        aoCriar={(r) => pedir.mutate(r)}
        aoVoltar={() => setPerguntas(null)}
      />
    );
  const estiloDaIdentidade = identidade.data?.identidade.estilo;

  return (
    <form className="form cards__pedido janela-pedido" onSubmit={enviar}>
      {!ia.ligada ? (
        <Mensagem tipo="aviso">O time de IA ainda não foi ligado na plataforma. Fale com a gente.</Mensagem>
      ) : !ia.cerebroConferido ? (
        <div className="novo-time__antes" role="note">
          <Icon name="sparkles" size={18} />
          <span>
            <b>Antes dos primeiros cards, confira o cérebro da marca.</b> É de lá que o time tira o que a
            empresa vende, para quem e como fala.
          </span>
          <Button size="sm" variant="secondary" onClick={props.aoCerebro}>
            Abrir o cérebro da marca
          </Button>
        </div>
      ) : esgotou ? (
        <Mensagem tipo="aviso">
          Os {fmtNumero(franquia.limite ?? 0)} pedidos do time de IA deste mês já foram usados. A franquia
          volta no dia 1º.
        </Mensagem>
      ) : null}

      <div className="campo">
        <label htmlFor="cards-assunto">O que você quer (fale com o time)</label>
        <textarea
          id="cards-assunto"
          rows={5}
          maxLength={1000}
          value={assunto}
          onChange={(e) => setAssunto(e.target.value)}
          placeholder={
            'Ex.: 3 cards de promoção da semana: pastilha de freio, óleo 5W30 e amortecedor. Preço grande, "só até sexta". Sem foto de pessoa.'
          }
        />
        <span className="campo__dica">
          O que os cards dizem e o que não pode faltar. Se listar coisas (produtos, avisos, datas), cada card
          é uma delas.
        </span>
      </div>

      {itens.length > 0 && (
        <div className="campo">
          <label htmlFor="cards-divulgar">O que divulgar (opcional)</label>
          <select
            id="cards-divulgar"
            className="filtro"
            value={divulgarId ?? ''}
            onChange={(e) => setDivulgarId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Nada específico</option>
            {itens.map((i) => (
              <option key={i.id} value={i.id}>
                {ROTULO_DIVULGAR[i.tipo]}: {i.titulo}
              </option>
            ))}
          </select>
        </div>
      )}

      <Escolhas
        nome="cards-quantos"
        rotulo="Quantos cards"
        opcoes={QUANTIDADES}
        valor={quantidade as (typeof QUANTIDADES)[number]}
        mudar={setQuantidade}
      />
      <Escolhas
        nome="cards-variacoes"
        rotulo="Variações de cada"
        opcoes={VARIACOES}
        valor={variacoes}
        mudar={setVariacoes}
      />
      <Escolhas
        nome="cards-formato"
        rotulo="Formato"
        opcoes={FORMATOS_PECA}
        valor={formato}
        mudar={setFormato}
        texto={(f) => FORMATO_PECA[f].nome}
      />
      <Escolhas
        nome="cards-objetivo"
        rotulo="Objetivo"
        opcoes={OBJETIVOS_CARD}
        valor={objetivo}
        mudar={setObjetivo}
        texto={(o) => OBJETIVO_CARD[o].nome}
      />

      <div className="campo">
        <label htmlFor="cards-estilo">Estilo</label>
        <select
          id="cards-estilo"
          className="filtro"
          value={estilo ?? ''}
          onChange={(e) => setEstilo((e.target.value || null) as EstiloCarrossel | null)}
        >
          <option value="">
            O da identidade{estiloDaIdentidade ? ` (${ESTILO[estiloDaIdentidade].nome})` : ''}
          </option>
          {ESTILOS.map((e) => (
            <option key={e} value={e}>
              {ESTILO[e].nome}
            </option>
          ))}
        </select>
      </div>
      <div className="campo">
        <label htmlFor="cards-chamada">A ação na peça</label>
        <select
          id="cards-chamada"
          className="filtro"
          value={chamada}
          onChange={(e) => setChamada(e.target.value as ChamadaFinal)}
        >
          {CHAMADAS_FINAIS.map((c) => (
            <option key={c} value={c}>
              {CHAMADA_FINAL[c]}
            </option>
          ))}
        </select>
      </div>
      {chamada === 'comentar' && (
        <div className="campo">
          <label htmlFor="cards-palavra">Palavra que a pessoa comenta</label>
          <input
            id="cards-palavra"
            className="filtro mono"
            value={palavra}
            maxLength={20}
            onChange={(e) => setPalavra(e.target.value.replace(/\s+/g, '').toUpperCase())}
            placeholder="QUERO"
            aria-invalid={!palavraOk || undefined}
          />
          <span className="campo__dica">
            Uma palavra só. A regra do Comente e receba de cada card fica na aba Publicação do editor.
          </span>
        </div>
      )}

      <label className="opcao">
        <input
          type="checkbox"
          checked={usarFotos && nFotos > 0}
          disabled={!nFotos}
          onChange={(e) => setUsarFotos(e.target.checked)}
        />
        <span>
          Usar as fotos da empresa quando combinarem{' '}
          <span className="quieto">
            · {nFotos ? `${fmtNumero(nFotos)} guardada${nFotos > 1 ? 's' : ''}` : 'nenhuma ainda'}
          </span>
        </span>
      </label>
      {ia.imagens && (
        <label className="opcao">
          <input type="checkbox" checked={gerarImagens} onChange={(e) => setGerarImagens(e.target.checked)} />
          <span>
            A IA pode gerar as imagens que faltarem
            <span className="campo__dica" style={{ display: 'block' }}>
              Sem texto e nas cores da marca, até 6 por pedido, no tamanho do formato. O revisor visual
              confere.
            </span>
          </span>
        </label>
      )}
      <FotosDoPedido
        fotos={fotos.data?.fotos ?? []}
        valor={fotosPedido}
        mudar={setFotosPedido}
        imagensLigadas={!!ia.imagens}
        podeEnviar={props.situacao.armazenamento}
      />

      <p className="quieto novo-time__sabe">
        <Icon name="sparkles" size={14} /> Usa o cérebro da marca, a identidade visual e o mesmo revisor dos
        carrosséis. O pedido conta 1 na franquia do mês
        {franquia.limite != null && (
          <>
            {' '}
            (<b className="mono">{fmtNumero(franquia.usados)}</b> de {fmtNumero(franquia.limite)})
          </>
        )}
        .
      </p>
      {pecas > MAX_PECAS_PEDIDO && (
        <Mensagem tipo="aviso">Até {MAX_PECAS_PEDIDO} peças por pedido (cards × variações).</Mensagem>
      )}
      {pedir.error && <ErroDaApi erro={pedir.error} />}
      <Button
        type="submit"
        variant="primary"
        icon="arrow-right"
        disabled={!pode || pedir.isPending || perguntar.isPending}
      >
        {perguntar.isPending
          ? 'A estrategista está lendo…'
          : pedir.isPending
            ? 'Chamando o time…'
            : 'Continuar'}
      </Button>
    </form>
  );
}

/* ───────────────────────────── Um pedido (o lote) ───────────────────────────── */

const imagemDaPeca = (v: VariacaoCard) => `/api/carrosseis/${v.id}/slides/0?largura=480&v=${v.versao}`;

function Lote(props: { l: LoteCards }) {
  const { l } = props;
  const cliente = useQueryClient();
  const atualizar = () => void cliente.invalidateQueries({ queryKey: ['carrosseis', 'cards'] });
  const [pedidoCard, setPedidoCard] = useState(1);
  const [pedidoTexto, setPedidoTexto] = useState('');
  // v148: a prévia grande (o card e a variação abertos).
  const [previa, setPrevia] = useState<{ card: number; variacao: number } | null>(null);
  const escolher = useMutation({
    mutationFn: (id: number) => api(`/carrosseis/cards/escolher/${id}`, { metodo: 'POST' }),
    onSuccess: atualizar,
  });
  const outra = useMutation({
    mutationFn: (p: { card: number; pedido: string }) =>
      api(`/carrosseis/cards/${l.pedidoId}/${p.card}/outra`, { metodo: 'POST', corpo: { pedido: p.pedido } }),
    onSuccess: () => {
      setPedidoTexto('');
      atualizar();
    },
  });
  const apagar = useMutation({
    mutationFn: () => api(`/carrosseis/cards/${l.pedidoId}`, { metodo: 'DELETE' }),
    onSuccess: atualizar,
  });
  const trabalhando = l.situacao === 'fila' || l.situacao === 'trabalhando';
  const falhou = l.situacao === 'falhou';
  const pecas = l.cards.reduce((s, c) => s + c.variacoes.length, 0);

  return (
    <section className="cards-lote" aria-label={l.titulo} data-formato={l.formato}>
      <header className="cards-lote__topo">
        <div>
          <h3 className="cards-lote__titulo">{l.titulo}</h3>
          <span className="quieto">
            {FORMATO_PECA[l.formato].nome} · {OBJETIVO_CARD[l.objetivo].nome} · {fmtQuando(l.criadoEm)}
          </span>
        </div>
        <Badge tone={falhou ? 'danger' : trabalhando ? 'brand' : 'neutral'}>
          {falhou
            ? 'Não terminou'
            : trabalhando
              ? l.situacao === 'fila'
                ? 'Na fila'
                : 'Time trabalhando'
              : `Pronto · ${l.cards.length} ${l.cards.length === 1 ? 'card' : 'cards'} · ${pecas} ${pecas === 1 ? 'peça' : 'peças'}`}
        </Badge>
      </header>

      {trabalhando && (
        <p className="cards-lote__andamento" aria-live="polite">
          <Icon name="loader" size={14} />{' '}
          {l.etapa
            ? `${ETAPA_TIME[l.etapa].nome}: ${l.detalhes[l.etapa] ?? ETAPA_TIME[l.etapa].faz}`
            : 'Começa em instantes.'}
          <span className="quieto"> Leva de 1 a 3 minutos; pode sair desta tela, o aviso chega no sino.</span>
        </p>
      )}
      {falhou && <Mensagem tipo="erro">{l.erro ?? 'O time não conseguiu terminar. Peça de novo.'}</Mensagem>}

      {l.cards.length > 0 && (
        <>
          <p className="quieto cards-lote__dica">Clique na variação que vai ser usada em cada card.</p>
          <ul className="cards-lote__grade">
            {l.cards.map((c) => {
              const escolhida = c.variacoes.find((v) => v.escolhido) ?? c.variacoes[0]!;
              const fazendo = l.trabalhando.includes(c.card);
              return (
                <li key={c.card} className="cards-card">
                  <span className="cards-card__rotulo">
                    Card {c.card}
                    {escolhida.slide?.titulo ? ` · ${escolhida.slide.titulo.replace(/\*/g, '')}` : ''}
                  </span>
                  <div className="cards-card__variacoes">
                    {c.variacoes.map((v, k) => (
                      <div key={v.id} className="cards-card__peca">
                        <button
                          type="button"
                          className="cards-card__variacao"
                          data-escolhida={v.escolhido || undefined}
                          aria-label={`Ver o card ${c.card}, variação ${v.variacao}, grande${v.escolhido ? ' (escolhida)' : ''}`}
                          onClick={() => setPrevia({ card: c.card, variacao: k })}
                        >
                          <img src={imagemDaPeca(v)} alt="" loading="lazy" />
                          {v.escolhido && (
                            <span className="cards-card__marca" aria-hidden="true">
                              <Icon name="check" size={12} />
                            </span>
                          )}
                          <span className="cards-card__ampliar" aria-hidden="true">
                            <Icon name="maximize-2" size={14} />
                          </span>
                        </button>
                        {v.escolhido ? (
                          <span className="cards-card__estado">Escolhida</span>
                        ) : (
                          <button
                            type="button"
                            className="link-botao cards-card__usar"
                            disabled={escolher.isPending}
                            onClick={() => escolher.mutate(v.id)}
                          >
                            Usar esta
                          </button>
                        )}
                      </div>
                    ))}
                    {fazendo && (
                      <span className="cards-card__variacao cards-card__variacao--fazendo" aria-live="polite">
                        <Icon name="loader" size={18} />
                        <span>Nova variação…</span>
                      </span>
                    )}
                  </div>
                  <div className="cards-card__acoes">
                    <Link className="link-botao" to={`/carrosseis/${escolhida.id}`}>
                      Editar
                    </Link>
                    <button
                      type="button"
                      className="link-botao"
                      disabled={fazendo || outra.isPending}
                      onClick={() => outra.mutate({ card: c.card, pedido: '' })}
                    >
                      Outra variação
                    </button>
                    <Link className="link-botao" to={`/carrosseis/${escolhida.id}?aba=publicacao`}>
                      Publicar
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="cards-lote__acoes">
            <Button
              size="sm"
              variant="secondary"
              icon="download"
              href={`/api/carrosseis/cards/${l.pedidoId}/imagens.zip`}
            >
              Baixar os escolhidos
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon="trash-2"
              disabled={apagar.isPending || trabalhando}
              onClick={() => {
                if (window.confirm(`Apagar "${l.titulo}" e as ${pecas} peças? Não dá para desfazer.`))
                  apagar.mutate();
              }}
            >
              Apagar
            </Button>
          </div>

          <form
            className="cards-lote__conversa"
            onSubmit={(e) => {
              e.preventDefault();
              if (pedidoTexto.trim().length >= 3)
                outra.mutate({ card: pedidoCard, pedido: pedidoTexto.trim() });
            }}
          >
            <Icon name="message-circle" size={16} />
            <label className="pp-sr" htmlFor={`cards-conversa-${l.pedidoId}`}>
              Pedir ao time uma variação nova
            </label>
            {l.cards.length > 1 && (
              <select
                className="filtro"
                aria-label="Para qual card"
                value={pedidoCard}
                onChange={(e) => setPedidoCard(Number(e.target.value))}
              >
                {l.cards.map((c) => (
                  <option key={c.card} value={c.card}>
                    Card {c.card}
                  </option>
                ))}
              </select>
            )}
            <input
              id={`cards-conversa-${l.pedidoId}`}
              className="filtro"
              maxLength={400}
              value={pedidoTexto}
              onChange={(e) => setPedidoTexto(e.target.value)}
              placeholder="Ex.: deixa o preço maior e usa a foto do galão"
            />
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              disabled={pedidoTexto.trim().length < 3 || outra.isPending}
            >
              Pedir ao time
            </Button>
          </form>
        </>
      )}
      {previa &&
        (() => {
          const c = l.cards.find((x) => x.card === previa.card);
          if (!c) return null;
          return (
            <PreviaDoCard
              card={c.card}
              variacoes={c.variacoes}
              inicial={previa.variacao}
              formato={l.formato}
              fazendoOutra={l.trabalhando.includes(c.card) || outra.isPending}
              aoEscolher={(id) => escolher.mutate(id)}
              aoOutra={() => {
                outra.mutate({ card: c.card, pedido: '' });
                setPrevia(null);
              }}
              aoFechar={() => setPrevia(null)}
            />
          );
        })()}
      {(escolher.error || outra.error || apagar.error) && (
        <ErroDaApi erro={escolher.error ?? outra.error ?? apagar.error} />
      )}
      {!l.cards.length && !trabalhando && !falhou && <p className="quieto">Sem peças.</p>}
    </section>
  );
}
