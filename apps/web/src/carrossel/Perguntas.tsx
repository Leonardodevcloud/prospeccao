import { ETAPA_TIME, type PerguntaDoTime, type RespostaDoTime } from '@prospeccao/shared/carrosseis-time';
import { Button } from '@prospeccao/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { ErroDaApi } from '../componentes/Formulario';

/**
 * v148: antes de criar, a estrategista pergunta o que falta para a peça vender (o benefício, a oferta,
 * a ação, o lugar). A pessoa toca numa sugestão, escreve a dela ou pula. O que responder vira fonte do
 * pedido: o time pode afirmar o que foi confirmado aqui. Vale para os carrosséis e os cards.
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

export const usePerguntas = () =>
  useMutation({
    mutationFn: (r: RascunhoDoPedido) =>
      api<{ perguntas: PerguntaDoTime[] }>('/carrosseis/perguntas', { metodo: 'POST', corpo: r }),
  });

const OUTRO = 'Outra resposta…';

export function PerguntasDoTime(props: {
  perguntas: PerguntaDoTime[];
  criando: boolean;
  erro: unknown;
  textoCriar: string;
  aoCriar: (respostas: RespostaDoTime[]) => void;
  aoVoltar: () => void;
}) {
  const [escolha, setEscolha] = useState<Record<number, string>>({});
  const [livre, setLivre] = useState<Record<number, string>>({});
  const estrategista = ETAPA_TIME.estrategista;
  const respostas = (): RespostaDoTime[] =>
    props.perguntas
      .map((p, i) => ({
        pergunta: p.pergunta,
        resposta: (escolha[i] === OUTRO ? (livre[i] ?? '') : (escolha[i] ?? '')).trim(),
      }))
      .filter((r) => r.resposta.length > 0);
  const respondidas = respostas().length;

  return (
    <div className="perguntas-time">
      <div className="perguntas-time__quem">
        {estrategista.foto && <img src={estrategista.foto} alt="" className="perguntas-time__foto" />}
        <p>
          <b>{estrategista.nome}</b> antes de começar, me conta:
          <span className="quieto"> o que você responder entra no pedido como fato confirmado.</span>
        </p>
      </div>
      <ol className="perguntas-time__lista">
        {props.perguntas.map((p, i) => (
          <li key={p.pergunta} className="perguntas-time__item">
            <fieldset>
              <legend className="perguntas-time__pergunta">{p.pergunta}</legend>
              {p.porque && <p className="quieto perguntas-time__porque">{p.porque}</p>}
              <div className="cards__chips">
                {[...p.sugestoes, OUTRO].map((s) => (
                  <label key={s} className="cards__chip" data-ativo={escolha[i] === s || undefined}>
                    <input
                      type="radio"
                      className="pp-sr"
                      name={`pergunta-${i}`}
                      checked={escolha[i] === s}
                      onChange={() => setEscolha({ ...escolha, [i]: s })}
                    />
                    {s}
                  </label>
                ))}
              </div>
              {escolha[i] === OUTRO && (
                <input
                  className="filtro perguntas-time__livre"
                  aria-label={`Sua resposta: ${p.pergunta}`}
                  maxLength={400}
                  value={livre[i] ?? ''}
                  onChange={(e) => setLivre({ ...livre, [i]: e.target.value })}
                />
              )}
            </fieldset>
          </li>
        ))}
      </ol>
      <ErroDaApi erro={props.erro} />
      <div className="perguntas-time__acoes">
        <Button type="button" variant="ghost" onClick={props.aoVoltar} disabled={props.criando}>
          Voltar ao pedido
        </Button>
        <Button type="button" variant="secondary" onClick={() => props.aoCriar([])} disabled={props.criando}>
          Pular e criar
        </Button>
        <Button
          type="button"
          variant="primary"
          icon="sparkles"
          disabled={props.criando || respondidas === 0}
          onClick={() => props.aoCriar(respostas())}
        >
          {props.criando ? 'Chamando o time…' : props.textoCriar}
        </Button>
      </div>
    </div>
  );
}
