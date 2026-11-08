import {
  ESTILO,
  ESTILOS,
  type EstiloCarrossel,
  MAX_SLIDES,
  type SlideCarrossel,
} from '@prospeccao/shared/carrosseis';
import {
  type AvisoTime,
  CHAMADA_FINAL,
  CHAMADAS_FINAIS,
  type ChamadaFinal,
  CRITERIO,
  CRITERIOS_REVISOR,
  ETAPA_TIME,
  ETAPAS_TIME,
  OBJETIVO,
  OBJETIVOS_CARROSSEL,
  type ObjetivoCarrossel,
  PALAVRA_COMENTAR,
  PEDIDO_RAPIDO,
  PEDIDOS_RAPIDOS,
  type PedidoDoTime,
  type PedidoRapido,
  type RelatorioTime,
  ROTULO_AVISO_TIME,
  ROTULO_DIVULGAR,
} from '@prospeccao/shared/carrosseis-time';
import { Badge, Button, Icon } from '@prospeccao/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api';
import { ErroDaApi, Mensagem } from '../componentes/Formulario';
import { fmtNumero, fmtQuando } from '../formatar';
import { type SituacaoCarrosseis, useDivulgar, useFotos, usePedidoDoTime } from './dados';

/**
 * As telas do time de IA: o pedido de um carrossel (o que o time precisa saber), o time
 * trabalhando etapa por etapa, o pedido ao redator num slide e o que o revisor deixou para decidir.
 */

/* ───────────────────────────── O pedido ───────────────────────────── */

export function NovoComTime(props: {
  situacao: SituacaoCarrosseis;
  estiloDaIdentidade: EstiloCarrossel;
  aoEmBranco: () => void;
  aoFechar: () => void;
  aoCerebro: () => void;
}) {
  const divulgar = useDivulgar();
  const fotos = useFotos();
  const cliente = useQueryClient();
  const [assunto, setAssunto] = useState('');
  const [divulgarId, setDivulgarId] = useState<number | null>(null);
  const [objetivo, setObjetivo] = useState<ObjetivoCarrossel>('ensinar');
  const [slides, setSlides] = useState<number | null>(null);
  const [estilo, setEstilo] = useState<EstiloCarrossel>(props.estiloDaIdentidade);
  const [chamada, setChamada] = useState<ChamadaFinal>('salvar');
  const [palavra, setPalavra] = useState('');
  const [usarFotos, setUsarFotos] = useState(true);
  const [pedidoId, setPedidoId] = useState<number | null>(null);
  const pedir = useMutation({
    mutationFn: () =>
      api<PedidoDoTime>('/carrosseis/time', {
        metodo: 'POST',
        corpo: { assunto, divulgarId, objetivo, slides, estilo, chamada, palavra, usarFotos },
      }),
    onSuccess: (p) => {
      setPedidoId(p.id);
      void cliente.invalidateQueries({ queryKey: ['carrosseis', 'lista'] });
    },
  });
  const { ia, franquia } = props.situacao;
  const nFotos = fotos.data?.fotos.length ?? 0;
  const itens = divulgar.data?.itens ?? [];
  const escolhido = itens.find((i) => i.id === divulgarId) ?? null;
  const esgotou = franquia.limite != null && franquia.usados >= franquia.limite;
  const palavraOk = chamada !== 'comentar' || PALAVRA_COMENTAR.test(palavra);
  const pode =
    ia.ligada && ia.cerebroConferido && !esgotou && (assunto.trim().length >= 3 || divulgarId) && palavraOk;

  if (pedidoId) return <TimeTrabalhando id={pedidoId} aoFechar={props.aoFechar} />;

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (pode) pedir.mutate();
  };

  return (
    <form className="form novo-time" onSubmit={enviar}>
      {!ia.ligada ? (
        <Mensagem tipo="aviso">
          O time de IA ainda não foi ligado na plataforma. Enquanto isso, comece em branco e monte à mão.
        </Mensagem>
      ) : !ia.cerebroConferido ? (
        <div className="novo-time__antes" role="note">
          <Icon name="sparkles" size={18} />
          <span>
            <b>Antes do primeiro carrossel com IA, confira o cérebro da marca.</b> É de lá que o time tira o
            que a empresa vende, para quem e como fala. A IA monta o rascunho para você.
          </span>
          <Button size="sm" variant="secondary" onClick={props.aoCerebro}>
            Abrir o cérebro da marca
          </Button>
        </div>
      ) : esgotou ? (
        <Mensagem tipo="aviso">
          Os {fmtNumero(franquia.limite ?? 0)} carrosséis do time de IA deste mês já foram usados. A franquia
          volta no dia 1º; dá para montar à mão enquanto isso.
        </Mensagem>
      ) : null}

      <div className="campo">
        <label htmlFor="nt-assunto">Sobre o que é o carrossel</label>
        <textarea
          id="nt-assunto"
          rows={3}
          maxLength={500}
          value={assunto}
          onChange={(e) => setAssunto(e.target.value)}
          placeholder="Ex.: os sinais de que a pastilha de freio está no fim"
        />
        <span className="campo__dica">Pode ser uma frase solta. Ou escolha o que divulgar logo abaixo.</span>
      </div>

      {itens.length > 0 && (
        <div className="campo">
          <label htmlFor="nt-divulgar">O que divulgar (opcional)</label>
          <select
            id="nt-divulgar"
            className="filtro"
            value={divulgarId ?? ''}
            onChange={(e) => {
              const id = e.target.value ? Number(e.target.value) : null;
              setDivulgarId(id);
              if (id && itens.find((i) => i.id === id)?.tipo === 'promocao') setObjetivo('vender');
            }}
          >
            <option value="">Nada específico</option>
            {itens.map((i) => (
              <option key={i.id} value={i.id}>
                {ROTULO_DIVULGAR[i.tipo]}: {i.titulo}
                {i.usado ? ` (${i.usado} carrossel${i.usado > 1 ? 'éis' : ''})` : ''}
              </option>
            ))}
          </select>
          {escolhido?.tipo === 'promocao' && (escolhido.precoPor || escolhido.validade) && (
            <span className="campo__dica">
              Sai exatamente assim:{' '}
              {[
                escolhido.precoDe && `de ${escolhido.precoDe}`,
                escolhido.precoPor && `por ${escolhido.precoPor}`,
                escolhido.validade,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          )}
        </div>
      )}

      <fieldset className="campo">
        <legend>Objetivo</legend>
        <div className="novo-time__opcoes">
          {OBJETIVOS_CARROSSEL.map((o) => (
            <label key={o} className="novo-time__opcao" data-ativo={objetivo === o || undefined}>
              <input
                type="radio"
                name="nt-objetivo"
                className="pp-sr"
                checked={objetivo === o}
                onChange={() => setObjetivo(o)}
              />
              <b>{OBJETIVO[o].nome}</b>
              <span className="quieto">{OBJETIVO[o].dica}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="form__duas">
        <div className="campo">
          <label htmlFor="nt-slides">Quantos slides</label>
          <select
            id="nt-slides"
            className="filtro"
            value={slides ?? ''}
            onChange={(e) => setSlides(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Deixar a IA decidir (5 a 10)</option>
            {Array.from({ length: MAX_SLIDES - 3 }, (_, i) => i + 4).map((n) => (
              <option key={n} value={n}>
                {n} slides
              </option>
            ))}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="nt-estilo">Estilo</label>
          <select
            id="nt-estilo"
            className="filtro"
            value={estilo}
            onChange={(e) => setEstilo(e.target.value as EstiloCarrossel)}
          >
            {ESTILOS.map((e) => (
              <option key={e} value={e}>
                {ESTILO[e].nome}
                {e === props.estiloDaIdentidade ? ' (o da identidade)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="campo">
        <legend>Chamada no último slide</legend>
        {CHAMADAS_FINAIS.map((c) => (
          <label key={c} className="opcao">
            <input type="radio" name="nt-chamada" checked={chamada === c} onChange={() => setChamada(c)} />
            <span>{CHAMADA_FINAL[c]}</span>
          </label>
        ))}
        {chamada === 'comentar' && (
          <div className="campo novo-time__palavra">
            <label htmlFor="nt-palavra">Palavra que a pessoa comenta</label>
            <input
              id="nt-palavra"
              className="filtro mono"
              value={palavra}
              maxLength={20}
              onChange={(e) => setPalavra(e.target.value.replace(/\s+/g, '').toUpperCase())}
              placeholder="QUERO"
              aria-invalid={!palavraOk || undefined}
            />
            <span className="campo__dica">
              Uma palavra só. O botão do último slide sai como “Comente {palavra || 'QUERO'}”. Para responder
              quem comentar, crie a regra em Instagram › Comente e receba.
            </span>
          </div>
        )}
      </fieldset>

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
            ·{' '}
            {nFotos
              ? `${fmtNumero(nFotos)} foto${nFotos > 1 ? 's' : ''} guardada${nFotos > 1 ? 's' : ''}`
              : 'nenhuma foto guardada ainda'}
          </span>
        </span>
      </label>

      <p className="quieto novo-time__sabe">
        <Icon name="sparkles" size={14} /> O time lê o cérebro da marca, a identidade visual, o que divulgar e
        os posts que mais funcionaram no Instagram.
        {franquia.limite != null && (
          <>
            {' '}
            Este mês: <b className="mono">{fmtNumero(franquia.usados)}</b> de {fmtNumero(franquia.limite)}.
          </>
        )}
      </p>
      {pedir.error && <ErroDaApi erro={pedir.error} />}
      <div className="acoes">
        <Button type="submit" variant="primary" icon="sparkles" disabled={!pode || pedir.isPending}>
          {pedir.isPending ? 'Chamando o time…' : 'Criar com o time de IA'}
        </Button>
        <Button type="button" variant="ghost" onClick={props.aoEmBranco}>
          Começar em branco
        </Button>
      </div>
    </form>
  );
}

/* ───────────────────────────── O time trabalhando ───────────────────────────── */

function estadoDaEtapa(p: PedidoDoTime, e: (typeof ETAPAS_TIME)[number]): 'feito' | 'agora' | 'depois' {
  if (p.situacao === 'pronto') return 'feito';
  const atual = p.etapa ? ETAPAS_TIME.indexOf(p.etapa) : -1;
  const esta = ETAPAS_TIME.indexOf(e);
  if (p.etapa === e) return 'agora';
  // O revisor pode devolver ao redator: o que já tem detalhe e veio antes do atual está feito.
  return esta < atual || (p.detalhes[e] && esta !== atual) ? 'feito' : 'depois';
}

export function TimeTrabalhando(props: { id: number; aoFechar: () => void }) {
  const q = usePedidoDoTime(props.id);
  const navegar = useNavigate();
  const p = q.data;
  useEffect(() => {
    if (p?.situacao === 'pronto' && p.carrosselId) navegar(`/carrosseis/${p.carrosselId}`);
  }, [p?.situacao, p?.carrosselId, navegar]);
  if (!p) return <div className="esqueleto" style={{ height: 240 }} />;
  return (
    <div className="time-trabalhando" aria-live="polite">
      <h3 className="time-trabalhando__titulo">O time trabalhando</h3>
      {p.situacao === 'falhou' ? (
        <Mensagem tipo="erro">{p.erro ?? 'O time não conseguiu terminar. Peça de novo.'}</Mensagem>
      ) : (
        <p className="quieto">
          {p.situacao === 'fila'
            ? 'Na fila: começa em instantes.'
            : 'Leva cerca de 1 a 2 minutos. Pode fechar: avisamos quando o carrossel ficar pronto.'}
        </p>
      )}
      <ol className="time-trabalhando__etapas">
        {ETAPAS_TIME.map((e) => {
          const est = estadoDaEtapa(p, e);
          return (
            <li key={e} className="time-trabalhando__etapa" data-estado={est}>
              <span className="time-trabalhando__marca" aria-hidden="true">
                {est === 'feito' ? (
                  <Icon name="check" size={14} />
                ) : est === 'agora' ? (
                  <Icon name="loader" size={14} />
                ) : null}
              </span>
              <span>
                <b>{ETAPA_TIME[e].nome}</b>
                <span className="quieto time-trabalhando__faz">{p.detalhes[e] ?? ETAPA_TIME[e].faz}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <div className="acoes">
        <Button variant="secondary" onClick={props.aoFechar}>
          Fechar e avisar quando ficar pronto
        </Button>
      </div>
    </div>
  );
}

/** O pedido que ainda está com o time, como um cartão na lista. */
export function CartaoPedido(props: { p: PedidoDoTime }) {
  const { p } = props;
  const cliente = useQueryClient();
  const cancelar = useMutation({
    mutationFn: () => api(`/carrosseis/time/${p.id}/cancelar`, { metodo: 'POST' }),
    onSettled: () => void cliente.invalidateQueries({ queryKey: ['carrosseis', 'lista'] }),
  });
  const falhou = p.situacao === 'falhou';
  return (
    <li className="carrossel-cartao carrossel-cartao--pedido" data-falhou={falhou || undefined}>
      <div className="carrossel-cartao__trabalhando" aria-hidden="true">
        <Icon name={falhou ? 'circle-x' : 'sparkles'} size={26} />
      </div>
      <div className="carrossel-cartao__info">
        <span className="carrossel-cartao__titulo">{p.assunto || 'Carrossel do time de IA'}</span>
        <div className="carrossel-cartao__meta">
          <Badge tone={falhou ? 'danger' : 'brand'}>
            {falhou ? 'Não terminou' : p.situacao === 'fila' ? 'Na fila' : 'Time trabalhando'}
          </Badge>
          <span className="quieto">
            {falhou
              ? (p.erro ?? 'Peça de novo.')
              : p.etapa
                ? `${ETAPA_TIME[p.etapa].nome}…`
                : fmtQuando(p.criadoEm)}
          </span>
        </div>
        {p.situacao === 'fila' && (
          <div className="carrossel-cartao__acoes">
            <Button
              size="sm"
              variant="ghost"
              icon="x"
              onClick={() => cancelar.mutate()}
              disabled={cancelar.isPending}
            >
              Cancelar
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

/* ───────────────────────────── Pedir ao redator ───────────────────────────── */

export function PedirAoRedator(props: {
  carrosselId: number;
  slides: SlideCarrossel[];
  indice: number;
  estilo: EstiloCarrossel;
  aoTrocar: (s: SlideCarrossel) => void;
}) {
  const [texto, setTexto] = useState('');
  const [avisos, setAvisos] = useState<string[]>([]);
  const pedir = useMutation({
    mutationFn: (rapido: PedidoRapido | null) =>
      api<{ slide: SlideCarrossel; avisos: string[] }>(
        `/carrosseis/${props.carrosselId}/slides/${props.indice}/pedir`,
        {
          metodo: 'POST',
          corpo: {
            pedido: { rapido, texto: rapido ? '' : texto },
            slides: props.slides,
            estilo: props.estilo,
          },
        },
      ),
    onSuccess: (r) => {
      props.aoTrocar(r.slide);
      setAvisos(r.avisos);
      setTexto('');
    },
  });
  return (
    <section className="pedir-redator" aria-labelledby="pr-titulo">
      <h3 id="pr-titulo" className="pedir-redator__titulo">
        <Icon name="sparkles" size={14} /> Pedir ao redator
      </h3>
      <div className="pedir-redator__rapidos">
        {PEDIDOS_RAPIDOS.map((r) => (
          <Button
            key={r}
            size="sm"
            variant="secondary"
            onClick={() => pedir.mutate(r)}
            disabled={pedir.isPending}
          >
            {PEDIDO_RAPIDO[r].rotulo}
          </Button>
        ))}
      </div>
      <div className="pedir-redator__livre">
        <label className="pp-sr" htmlFor="pr-texto">
          O que mudar neste slide
        </label>
        <input
          id="pr-texto"
          className="filtro"
          value={texto}
          maxLength={300}
          placeholder="Ou diga o que mudar (ex.: cite a garantia de 6 meses)"
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && texto.trim().length >= 3) {
              e.preventDefault();
              pedir.mutate(null);
            }
          }}
        />
        <Button
          size="sm"
          variant="ghost"
          icon="send"
          aria-label="Pedir"
          onClick={() => pedir.mutate(null)}
          disabled={pedir.isPending || texto.trim().length < 3}
        />
      </div>
      {pedir.isPending && <p className="quieto">O redator está reescrevendo…</p>}
      {pedir.error && <ErroDaApi erro={pedir.error} />}
      {!!avisos.length && <Mensagem tipo="aviso">{avisos.join(' ')}</Mensagem>}
    </section>
  );
}

/* ───────────────────────────── O que o revisor deixou ───────────────────────────── */

export function AvisosDoRevisor(props: {
  avisos: AvisoTime[];
  rotulo: string;
  aoDecidir: (a: AvisoTime, acao: 'usar' | 'manter') => void;
  decidindo: boolean;
}) {
  const abertos = props.avisos.filter((a) => !a.resolvido);
  if (!abertos.length) return null;
  return (
    <ul className="avisos-revisor" aria-label={`Revisor · ${props.rotulo}`}>
      {abertos.map((a) => (
        <li key={a.id} className="avisos-revisor__item" data-tipo={a.tipo}>
          <span className="avisos-revisor__quem">
            Revisor · {props.rotulo} · {ROTULO_AVISO_TIME[a.tipo]}
          </span>
          <p className="avisos-revisor__texto">{a.texto}</p>
          {a.sugestao && <p className="avisos-revisor__sugestao">Sugestão: “{a.sugestao.valor}”</p>}
          <div className="avisos-revisor__acoes">
            {a.sugestao && (
              <Button
                size="sm"
                variant="primary"
                onClick={() => props.aoDecidir(a, 'usar')}
                disabled={props.decidindo}
              >
                Usar a sugestão
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => props.aoDecidir(a, 'manter')}
              disabled={props.decidindo}
            >
              {a.sugestao ? 'Manter como está' : 'Já resolvi'}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ───────────────────────────── O relatório do time ───────────────────────────── */

export function PainelTime(props: { r: RelatorioTime; aoUsarGancho: (g: string) => void; travado: boolean }) {
  const { r } = props;
  const media = CRITERIOS_REVISOR.reduce((s, c) => s + (r.notas[c] ?? 0), 0) / CRITERIOS_REVISOR.length;
  const abertos = r.avisos.filter((a) => !a.resolvido).length;
  return (
    <div className="painel-time">
      <section>
        <h3 className="painel-time__titulo">O ângulo</h3>
        <p>{r.angulo || r.assunto}</p>
        {r.porque && <p className="quieto">{r.porque}</p>}
        {!!r.fontes.length && (
          <ul className="painel-time__fontes" aria-label="O que o time usou">
            {r.fontes.map((f) => (
              <li key={f} className="painel-time__fonte">
                {f}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="painel-time__titulo">O gancho da capa</h3>
        <p className="painel-time__gancho">“{r.gancho}”</p>
        {!!r.ganchosAlternativos.length && (
          <>
            <p className="quieto">Outros que o estrategista pensou:</p>
            <ul className="painel-time__ganchos">
              {r.ganchosAlternativos.map((g) => (
                <li key={g} className="painel-time__alt">
                  <span>“{g}”</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => props.aoUsarGancho(g)}
                    disabled={props.travado}
                  >
                    Usar na capa
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <section>
        <h3 className="painel-time__titulo">
          Revisor{' '}
          <span className="quieto">
            · nota {media.toFixed(1)}
            {r.voltas ? ` · ${r.voltas} volta${r.voltas > 1 ? 's' : ''} ao redator` : ''}
          </span>
        </h3>
        <ul className="painel-time__notas">
          {CRITERIOS_REVISOR.map((c) => (
            <li key={c} className="painel-time__nota">
              <span>{CRITERIO[c]}</span>
              <span className="painel-time__barra" role="img" aria-label={`${r.notas[c] ?? 0} de 5`}>
                <span className="painel-time__cheio" style={{ width: `${((r.notas[c] ?? 0) / 5) * 100}%` }} />
              </span>
              <b className="mono">{r.notas[c] ?? '–'}</b>
            </li>
          ))}
        </ul>
        <p className="quieto">
          {abertos
            ? `${abertos} ponto${abertos > 1 ? 's' : ''} esperando você decidir (aparecem no slide e na legenda).`
            : 'Nada esperando decisão.'}
        </p>
      </section>
      {!!r.hashtags.length && (
        <section>
          <h3 className="painel-time__titulo">Hashtags</h3>
          <p className="mono quieto">{r.hashtags.map((h) => `#${h}`).join(' ')}</p>
        </section>
      )}
      <p className="quieto">
        Ficou bom? <Link to="/carrosseis?aba=cerebro">O cérebro da marca</Link> é o que mais muda o resultado.
      </p>
    </div>
  );
}
