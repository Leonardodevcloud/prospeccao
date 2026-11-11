import {
  ETAPA_TIME,
  MAX_RODADAS_TIME,
  type PerguntaDoTime,
  type RespostaDoTime,
  type RodadaDoTime,
} from '@prospeccao/shared/carrosseis-time';
import { Button } from '@prospeccao/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { ErroDaApi } from '../componentes/Formulario';

/**
 * v148/v149: antes de criar, a estrategista conversa com quem pediu, como num briefing de agência. Ela
 * pergunta, a pessoa responde (tocando numa sugestão ou escrevendo), e ela pergunta de novo, indo fundo no
 * que foi respondido, até ter o que a peça precisa (no máximo 3 rodadas). No fim, mostra o que entendeu;
 * a pessoa corrige o que quiser e cria. As respostas e o resumo conferido viram fonte do pedido: o time
 * pode afirmar o que foi confirmado aqui. Vale para os carrosséis e os cards.
 */

export interface RascunhoDoPedido {
  tipo: 'carrossel' | 'cards';
  assunto: string;
  divulgarId: number | null;
  objetivo: string;
  chamada: string;
  formato?: string;
  fotos: number;
}

export interface ConversaRespondida {
  respostas: RespostaDoTime[];
  briefing: string;
}

export const SEM_CONVERSA: ConversaRespondida = { respostas: [], briefing: '' };

export const usePerguntas = () =>
  useMutation({
    mutationFn: (r: RascunhoDoPedido & { conversa?: RespostaDoTime[]; rodada?: number }) =>
      api<RodadaDoTime>('/carrosseis/perguntas', { metodo: 'POST', corpo: r }),
  });

interface Feita extends PerguntaDoTime {
  resposta: string;
}

export function PerguntasDoTime(props: {
  rascunho: RascunhoDoPedido;
  inicial: RodadaDoTime;
  criando: boolean;
  erro: unknown;
  textoCriar: string;
  aoCriar: (c: ConversaRespondida) => void;
  aoVoltar: () => void;
}) {
  const [feitas, setFeitas] = useState<Feita[][]>([]);
  const [rodada, setRodada] = useState<RodadaDoTime>(props.inicial);
  const [texto, setTexto] = useState<Record<number, string>>({});
  const [briefing, setBriefing] = useState(props.inicial.pronto ? props.inicial.entendi : '');
  const [semResposta, setSemResposta] = useState(false);
  const perguntar = usePerguntas();
  const estrategista = ETAPA_TIME.estrategista;

  const todas = feitas.flat();
  const atuais: Feita[] = rodada.perguntas.map((p, i) => ({ ...p, resposta: (texto[i] ?? '').trim() }));
  const respondidas = atuais.filter((a) => a.resposta).length;
  const respostasDe = (lista: Feita[]): RespostaDoTime[] =>
    lista.filter((f) => f.resposta).map((f) => ({ pergunta: f.pergunta, resposta: f.resposta }));
  const ocupado = props.criando || perguntar.isPending;

  const responder = () => {
    const nova = [...feitas, atuais];
    setFeitas(nova);
    setTexto({});
    perguntar.mutate(
      {
        ...props.rascunho,
        conversa: nova.flat().map((f) => ({ pergunta: f.pergunta, resposta: f.resposta })),
        rodada: nova.length,
      },
      {
        onSuccess: (r) => {
          setRodada(r);
          if (r.pronto) setBriefing(r.entendi);
        },
        // A conversa é ajuda: se a estrategista falhar, a pessoa cria com o que já respondeu.
        onError: () => {
          setRodada({ pronto: true, entendi: rodada.entendi, perguntas: [], rodada: nova.length });
          setBriefing(rodada.entendi);
          setSemResposta(true);
        },
      },
    );
  };
  const criar = (lista: Feita[], resumo: string) =>
    props.aoCriar({ respostas: respostasDe(lista), briefing: resumo.trim() });

  return (
    <div className="perguntas-time">
      <div className="perguntas-time__quem">
        {estrategista.foto && <img src={estrategista.foto} alt="" className="perguntas-time__foto" />}
        <p>
          <b>{estrategista.nome}</b> vai entender o pedido antes de chamar o time.
          <span className="quieto"> O que você responder entra no pedido como fato confirmado.</span>
        </p>
      </div>

      {todas.length > 0 && (
        <ol className="perguntas-time__historico" aria-label="O que você já respondeu">
          {todas.map((f) => (
            <li key={f.pergunta}>
              <span className="quieto">{f.pergunta}</span>
              <b>{f.resposta || 'Não respondeu'}</b>
            </li>
          ))}
        </ol>
      )}

      {perguntar.isPending ? (
        <p className="perguntas-time__pensando" role="status">
          <span className="perguntas-time__pontos" aria-hidden="true" />
          {estrategista.nome} está lendo suas respostas…
        </p>
      ) : !rodada.pronto ? (
        <>
          <div className="perguntas-time__rodada">
            <span className="perguntas-time__selo">
              Rodada {rodada.rodada + 1} de até {MAX_RODADAS_TIME}
            </span>
            {rodada.entendi && rodada.rodada > 0 && (
              <p className="quieto perguntas-time__ate-aqui">Até aqui entendi: {rodada.entendi}</p>
            )}
          </div>
          <ol className="perguntas-time__lista">
            {rodada.perguntas.map((p, i) => (
              <li key={p.pergunta} className="perguntas-time__item">
                <label className="perguntas-time__pergunta" htmlFor={`pergunta-${rodada.rodada}-${i}`}>
                  {p.pergunta}
                </label>
                {p.porque && <p className="quieto perguntas-time__porque">{p.porque}</p>}
                {p.sugestoes.length > 0 && (
                  <div className="cards__chips">
                    {p.sugestoes.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className="cards__chip"
                        data-ativo={texto[i] === s || undefined}
                        onClick={() => setTexto({ ...texto, [i]: s })}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
                <textarea
                  id={`pergunta-${rodada.rodada}-${i}`}
                  className="filtro perguntas-time__livre"
                  rows={2}
                  maxLength={400}
                  placeholder={p.sugestoes.length ? 'Toque numa sugestão ou escreva do seu jeito' : undefined}
                  value={texto[i] ?? ''}
                  onChange={(e) => setTexto({ ...texto, [i]: e.target.value })}
                />
              </li>
            ))}
          </ol>
          <p className="quieto perguntas-time__dica">
            Não sabe alguma? Deixe em branco: ela segue sem e não pergunta de novo.
          </p>
        </>
      ) : (
        <div className="perguntas-time__resumo">
          <label htmlFor="briefing-do-time" className="perguntas-time__pergunta">
            {briefing ? 'Entendi assim. Confere?' : 'Pronto para criar.'}
          </label>
          {semResposta && (
            <p className="quieto">
              A estrategista não respondeu agora; dá para criar com o que você já contou.
            </p>
          )}
          {(briefing || rodada.entendi) && (
            <>
              <textarea
                id="briefing-do-time"
                className="filtro perguntas-time__briefing"
                rows={5}
                maxLength={1500}
                value={briefing}
                onChange={(e) => setBriefing(e.target.value)}
              />
              <p className="quieto perguntas-time__dica">
                Corrija ou acrescente o que quiser: o time segue este resumo e pode afirmar o que está nele.
              </p>
            </>
          )}
        </div>
      )}

      <ErroDaApi erro={props.erro} />
      <div className="perguntas-time__acoes">
        <Button type="button" variant="ghost" onClick={props.aoVoltar} disabled={ocupado}>
          Voltar ao pedido
        </Button>
        {!rodada.pronto ? (
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={ocupado}
              // O resumo ainda não foi conferido: vão só as respostas.
              onClick={() => criar([...todas, ...atuais], '')}
            >
              {todas.length + respondidas > 0 ? 'Criar com o que já contei' : 'Pular e criar'}
            </Button>
            <Button
              type="button"
              variant="primary"
              icon="chevron-right"
              disabled={ocupado || respondidas === 0}
              onClick={responder}
            >
              Responder
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="primary"
            icon="sparkles"
            disabled={ocupado}
            onClick={() => criar(todas, briefing)}
          >
            {props.criando ? 'Chamando o time…' : props.textoCriar}
          </Button>
        )}
      </div>
    </div>
  );
}
